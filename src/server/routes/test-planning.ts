import { Router, type Request, type Response } from "express";
import { listProjects } from "../../db/project-repository";
import { getRepositoryConfigBySlug, listRepositoryConfigs, type ProjectRepositoryConfig } from "../../db/project-repository-config-service";
import { latestReviewsByFile, listReviews, recordReview, type TestPlanReview } from "../../db/test-plan-review-repository";
import { getUserById } from "../../db/user-repository";
import { filterByProjectAccess } from "../middleware/route-policy";
import { GitCommandError, gitErrorStatus } from "../../test-planning/git-cli";
import { isProtectedBranch } from "../../test-planning/repository-config";
import { getWorkspace, type PlanFileRef } from "../../test-planning/repo-workspace";
import { gherkinIssues, parseTestPlan, stepKeywordOptions } from "../../test-planning/test-plan-markdown";
import { applyPlanEdit, PlanEditError } from "../../test-planning/plan-edit";
import { computeTestPlanningMetrics } from "../../test-planning/test-planning-metrics";

/**
 * Planificación de pruebas: browse a project's repository branches and the
 * test-plan-<HU>.md files they contain, edit their scenarios, commit and push
 * the changes, or accept a plan as valid. Mounted at /api/test-planning; the
 * route policy enforces testplanning.* and project access before any handler.
 */
export const testPlanningRouter = Router();

class NotConfiguredError extends Error {}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: (err?: unknown) => void) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof PlanEditError) {
        res.status(400).json({ ok: false, error: err.code, message: err.message });
        return;
      }
      if (err instanceof NotConfiguredError) {
        res.status(404).json({ ok: false, error: "repository_not_configured", message: err.message });
        return;
      }
      if (err instanceof GitCommandError) {
        const status = err.code === "git_branch_not_found" || err.code === "plan_not_found" ? 404 : gitErrorStatus(err);
        res.status(status).json({ ok: false, error: err.code, message: err.message });
        return;
      }
      next(err);
    }
  };
}

async function configFor(slug: string): Promise<ProjectRepositoryConfig> {
  const config = await getRepositoryConfigBySlug(slug);
  if (!config || !config.enabled) {
    throw new NotConfiguredError("El proyecto no tiene un repositorio de planes configurado (Configuración → proyecto → Repositorio).");
  }
  return config;
}

function workspaceFor(config: ProjectRepositoryConfig) {
  return getWorkspace(config.projectSlug, config);
}

function branchParam(req: Request): string {
  const value = (req.method === "GET" ? req.query.branch : req.body?.branch) ?? "";
  return String(value).trim();
}

function repoLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function branchesPayload(config: ProjectRepositoryConfig) {
  const workspace = workspaceFor(config);
  const branches = await workspace.listBranches();
  return {
    status: workspace.status(),
    defaultBranch: config.defaultBranch,
    branches: branches.map((b) => ({ ...b, protected: isProtectedBranch(config, b.name) })),
  };
}

function reviewSummary(review: TestPlanReview | undefined, currentBlobSha: string) {
  if (!review) return null;
  return {
    outcome: review.outcome,
    userName: review.userName,
    reviewedAt: review.reviewedAt,
    commitSha: review.commitSha,
    /** False when the file changed in the repo after this review. */
    current: review.blobSha === currentBlobSha,
  };
}

async function plansWithReviews(config: ProjectRepositoryConfig, plans: PlanFileRef[]) {
  const reviews = await latestReviewsByFile(config.projectSlug, plans.map((p) => p.path));
  return plans.map((plan) => ({ ...plan, review: reviewSummary(reviews.get(plan.path), plan.blobSha) }));
}

async function planPayload(config: ProjectRepositoryConfig, branch: string, planPath: string) {
  const { headSha, file, text } = await workspaceFor(config).readPlan(branch, planPath);
  const plan = parseTestPlan(text);
  const heading = /^#\s+(.+)$/m.exec(plan.head)?.[1]?.trim() ?? file.key;
  const reviews = await latestReviewsByFile(config.projectSlug, [file.path]);
  return {
    branch,
    headSha,
    protected: isProtectedBranch(config, branch),
    file,
    title: heading,
    frontmatter: plan.frontmatter,
    language: plan.language,
    keywordOptions: stepKeywordOptions(plan.language),
    readOnlyReason: plan.readOnlyReason,
    issues: gherkinIssues(text, plan.language),
    scenarios: plan.scenarios,
    review: reviewSummary(reviews.get(file.path), file.blobSha),
  };
}

/** Commit author: the QA Lab user (full name and email), never a shared identity. */
async function commitAuthor(req: Request): Promise<{ name: string; email: string }> {
  const principal = req.principal!;
  const user = principal.userId ? await getUserById(principal.userId) : null;
  const name = user?.fullName?.trim() || principal.username || "QA Lab";
  const email = user?.email?.trim() || `${(principal.username || "qa-lab").replace(/[^\w.-]/g, "")}@users.qa-lab.local`;
  return { name, email };
}

function reviewer(req: Request) {
  return { userId: req.principal?.userId ?? null, userName: req.principal?.username ?? null };
}

function editBody(req: Request) {
  const body = req.body ?? {};
  const planPath = String(body.path ?? "");
  const baseBlobSha = String(body.baseBlobSha ?? body.blobSha ?? "");
  if (!planPath || !/^[0-9a-f]{40,64}$/.test(baseBlobSha)) throw new PlanEditError("path y baseBlobSha son obligatorios.");
  return { branch: branchParam(req), planPath, baseBlobSha, scenarios: body.scenarios };
}

/** Reads the file at the branch head and checks it is still the version the user edited. */
async function currentVersion(config: ProjectRepositoryConfig, branch: string, planPath: string, baseBlobSha: string) {
  const read = await workspaceFor(config).readPlan(branch, planPath);
  if (read.file.blobSha !== baseBlobSha) {
    throw new GitCommandError(
      "El plan cambió en la rama desde que lo abriste (Pull o un commit de otra persona). Recárgalo y vuelve a aplicar tus cambios.",
      "git_conflict",
      null,
    );
  }
  return read;
}

// GET /api/test-planning/projects — every project the caller can see, flagged with
// whether it has a repository configured.
testPlanningRouter.get(
  "/projects",
  handle(async (req, res) => {
    const projects = filterByProjectAccess(
      req.principal,
      (await listProjects()).filter((p) => p.enabled),
      (p) => p.slug,
    );
    const configs = new Map((await listRepositoryConfigs()).map((c) => [c.projectSlug.toLowerCase(), c]));
    res.json({
      projects: projects
        .map((project) => {
          const config = configs.get(project.slug.toLowerCase());
          return {
            slug: project.slug,
            name: project.name,
            configured: !!config,
            repository: config ? repoLabel(config.repoUrl) : null,
            defaultBranch: config?.defaultBranch ?? null,
            specsPath: config?.specsPath ?? null,
            ...(config ? workspaceFor(config).status() : { cloned: false, lastFetchAt: null }),
          };
        })
        .sort((a, b) => Number(b.configured) - Number(a.configured) || a.name.localeCompare(b.name)),
    });
  }),
);

// GET /api/test-planning/projects/:slug/branches — clones on first use.
testPlanningRouter.get(
  "/projects/:slug/branches",
  handle(async (req, res) => {
    const config = await configFor(String(req.params.slug));
    await workspaceFor(config).ensureReady();
    res.json(await branchesPayload(config));
  }),
);

// POST /api/test-planning/projects/:slug/fetch — git fetch --prune of every branch.
testPlanningRouter.post(
  "/projects/:slug/fetch",
  handle(async (req, res) => {
    const config = await configFor(String(req.params.slug));
    await workspaceFor(config).fetchAll();
    res.json(await branchesPayload(config));
  }),
);

// POST /api/test-planning/projects/:slug/pull { branch } — brings the branch to its latest remote commit.
testPlanningRouter.post(
  "/projects/:slug/pull",
  handle(async (req, res) => {
    const config = await configFor(String(req.params.slug));
    const branch = branchParam(req);
    const workspace = workspaceFor(config);
    await workspace.fetchBranch(branch);
    const { headSha, plans } = await workspace.listPlans(branch);
    res.json({
      branch,
      headSha,
      protected: isProtectedBranch(config, branch),
      plans: await plansWithReviews(config, plans),
      status: workspace.status(),
    });
  }),
);

// GET /api/test-planning/projects/:slug/plans?branch=&since=<sha>
testPlanningRouter.get(
  "/projects/:slug/plans",
  handle(async (req, res) => {
    const config = await configFor(String(req.params.slug));
    const branch = branchParam(req);
    const workspace = workspaceFor(config);
    await workspace.ensureReady();
    const { headSha, plans } = await workspace.listPlans(branch);
    const since = typeof req.query.since === "string" ? req.query.since : "";
    res.json({
      branch,
      headSha,
      protected: isProtectedBranch(config, branch),
      newCommits: since ? await workspace.commitsSince(branch, since) : 0,
      plans: await plansWithReviews(config, plans),
    });
  }),
);

// GET /api/test-planning/projects/:slug/plan?branch=&path= — one plan, parsed into scenarios.
testPlanningRouter.get(
  "/projects/:slug/plan",
  handle(async (req, res) => {
    const config = await configFor(String(req.params.slug));
    await workspaceFor(config).ensureReady();
    res.json(await planPayload(config, branchParam(req), String(req.query.path ?? "")));
  }),
);

// POST /api/test-planning/projects/:slug/plan/preview { branch, path, baseBlobSha, scenarios } — diff without committing.
testPlanningRouter.post(
  "/projects/:slug/plan/preview",
  handle(async (req, res) => {
    const config = await configFor(String(req.params.slug));
    const { branch, planPath, baseBlobSha, scenarios } = editBody(req);
    const workspace = workspaceFor(config);
    const { text } = await currentVersion(config, branch, planPath, baseBlobSha);
    const edit = applyPlanEdit(text, scenarios);
    const diff = edit.changed ? await workspace.diffBlobs(baseBlobSha, await workspace.writeBlob(edit.content), planPath) : "";
    res.json({
      changed: edit.changed,
      diff,
      stats: edit.stats,
      problems: edit.problems,
      danglingCoverage: edit.danglingCoverage,
      protected: isProtectedBranch(config, branch),
    });
  }),
);

// POST /api/test-planning/projects/:slug/plan/commit { branch, path, baseBlobSha, scenarios, message }
testPlanningRouter.post(
  "/projects/:slug/plan/commit",
  handle(async (req, res) => {
    const config = await configFor(String(req.params.slug));
    const { branch, planPath, baseBlobSha, scenarios } = editBody(req);
    if (isProtectedBranch(config, branch)) {
      res.status(403).json({ ok: false, error: "branch_protected", message: `La rama ${branch} está protegida: no se permite commit desde QA Lab.` });
      return;
    }
    const message = String(req.body?.message ?? "").trim();
    if (!message || message.length > 2000) throw new PlanEditError("El mensaje del commit es obligatorio (máx. 2000 caracteres).");

    const { file, headSha, text } = await currentVersion(config, branch, planPath, baseBlobSha);
    const edit = applyPlanEdit(text, scenarios);
    if (!edit.changed) throw new PlanEditError('No hay cambios para hacer commit. Usa "Aceptar como válido".');
    if (edit.problems.length) {
      res.status(422).json({
        ok: false,
        error: "invalid_scenarios",
        message: "Hay escenarios incompletos o con Gherkin no válido.",
        problems: edit.problems,
      });
      return;
    }

    const result = await workspaceFor(config).commitFiles({
      branch,
      files: [{ path: planPath, content: edit.content, baseBlobSha }],
      message,
      author: await commitAuthor(req),
    });
    try {
      await recordReview({
        projectSlug: config.projectSlug,
        branch,
        issueKey: file.key,
        filePath: planPath,
        outcome: "committed",
        headSha,
        blobSha: result.blobs[planPath],
        commitSha: result.commitSha,
        scenarioCount: edit.stats.total,
        editedCount: edit.stats.edited,
        addedCount: edit.stats.added,
        removedCount: edit.stats.removed,
        ...reviewer(req),
      });
    } catch (err) {
      // The push already happened; a lost history row must not report a failure.
      console.warn(
        `[test-planning] commit ${result.commitSha} hecho, pero no se pudo registrar la revisión: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    res.json({ ok: true, commitSha: result.commitSha, stats: edit.stats, plan: await planPayload(config, branch, planPath) });
  }),
);

// POST /api/test-planning/projects/:slug/plan/accept { branch, path, blobSha, note? } — valid as written.
testPlanningRouter.post(
  "/projects/:slug/plan/accept",
  handle(async (req, res) => {
    const config = await configFor(String(req.params.slug));
    const { branch, planPath, baseBlobSha } = editBody(req);
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 2000) : null;
    const { file, headSha, text } = await currentVersion(config, branch, planPath, baseBlobSha);
    await recordReview({
      projectSlug: config.projectSlug,
      branch,
      issueKey: file.key,
      filePath: planPath,
      outcome: "accepted",
      headSha,
      blobSha: baseBlobSha,
      scenarioCount: parseTestPlan(text).scenarios.length,
      note,
      ...reviewer(req),
    });
    res.json({ ok: true, plan: await planPayload(config, branch, planPath) });
  }),
);

// GET /api/test-planning/metrics?days=30&projectSlug= — dashboard numbers, narrowed to the caller's projects.
testPlanningRouter.get(
  "/metrics",
  handle(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const projectSlug = typeof req.query.projectSlug === "string" ? req.query.projectSlug.trim().toLowerCase() : "";
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const reviews = filterByProjectAccess(req.principal, await listReviews({ from, to }), (r) => r.projectSlug).filter(
      (r) => !projectSlug || r.projectSlug.toLowerCase() === projectSlug,
    );
    res.json({ days, ...computeTestPlanningMetrics(reviews) });
  }),
);
