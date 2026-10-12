import { Router, type Request, type Response } from "express";
import { config, requireJiraConfig, requireTestRailConfig } from "../../config/env";
import { JiraClient } from "../../clients/jira.client";
import { TestRailClient } from "../../clients/testrail.client";
import { testRailRequiredCaseCustomFields } from "../services/testrail-case-publisher";
import {
  computeDraftStatus,
  publishDraftToJira,
  publishDraftToTestRail,
  type JiraPublishClient,
  type TestRailPublishClient,
} from "../../test-design/test-design-publisher";
import { resolveSubtaskType, SubtaskTypeNotFoundError } from "../../test-design/jira-subtask-type";
import { canAccessProject, canWriteProject, type Principal } from "../../auth/principal";
import { getProjectBySlug } from "../../db/project-repository";
import * as repo from "../../db/test-design-repository";
import { loadJiraIssue } from "../../scenarios/jira-scenario-source";
import {
  findPublishIssues,
  markEditedScenarios,
  normalizeScenarios,
  TestDesignValidationError,
} from "../../test-design/test-design.validation";
import { createTestDesignAiProvider } from "../../ai/ai-provider-factory";
import {
  GenerationConflictError,
  isStoryRunning,
  settleInterruptedStories,
  startGeneration,
  type GenerationDeps,
} from "../../test-design/test-design-generation-runner";
import type {
  TestDesignDraft,
  TestDesignDraftWithStories,
  TestDesignTestRailTarget,
} from "../../test-design/test-design.types";

/**
 * Test design module: drafts of manual test scenarios authored from Jira stories.
 *
 * Permissions per route live in route-policy.ts. Drafts are not always tied to
 * an automation project, so visibility is decided here: the author, anyone with
 * every project, or anyone granted the draft's project when it names one.
 */
export const testDesignRouter = Router();

const JIRA_PROJECT_KEY = /^[A-Z][A-Z0-9_]*$/;
const JIRA_ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

const defaultGenerationDeps: GenerationDeps = {
  createProvider: () => createTestDesignAiProvider(),
  loadIssue: (issueKey) => loadJiraIssue(requireJiraConfig(config), issueKey),
};
let generationDeps = defaultGenerationDeps;

/** Tests swap the AI provider and Jira loader; pass null to restore the real ones. */
export function setGenerationDepsForTesting(deps: GenerationDeps | null): void {
  generationDeps = deps ?? defaultGenerationDeps;
}

type PublishDeps = {
  testRail: () => { client: TestRailPublishClient; baseUrl: string };
  jira: () => JiraPublishClient;
};
const defaultPublishDeps: PublishDeps = {
  testRail: () => {
    const trConfig = requireTestRailConfig(config);
    return { client: new TestRailClient(trConfig), baseUrl: trConfig.url };
  },
  jira: () => jira(),
};
let publishDeps = defaultPublishDeps;

/** Tests swap the TestRail and Jira clients; pass null to restore the real ones. */
export function setPublishDepsForTesting(deps: PublishDeps | null): void {
  publishDeps = deps ?? defaultPublishDeps;
}

export function maxStoriesPerDraft(): number {
  const n = Number(process.env.TEST_DESIGN_MAX_STORIES);
  return Number.isInteger(n) && n > 0 ? n : 10;
}

function jira(): JiraClient {
  return new JiraClient(requireJiraConfig(config));
}

function principalOf(req: Request): Principal {
  // enforceRoutePolicy already rejected anonymous callers.
  return req.principal!;
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ ok: false, error: "invalid_request", message });
}

function notFound(res: Response): void {
  res.status(404).json({ ok: false, error: "draft_not_found", message: "Borrador no encontrado" });
}

function generating(res: Response, issueKeys: string[]): void {
  res.status(409).json({
    ok: false,
    error: "generation_in_progress",
    message: `Se están generando escenarios para ${issueKeys.join(", ")}; espera a que termine`,
    issueKeys,
  });
}

function isOwner(principal: Principal, draft: TestDesignDraft): boolean {
  return Boolean(principal.userId && draft.createdBy && principal.userId.toLowerCase() === draft.createdBy.toLowerCase());
}

export function canSeeDraft(principal: Principal, draft: TestDesignDraft): boolean {
  if (principal.allProjects || isOwner(principal, draft)) return true;
  return Boolean(draft.projectSlug && canAccessProject(principal, draft.projectSlug));
}

async function canEditDraft(principal: Principal, draft: TestDesignDraft): Promise<boolean> {
  if (principal.allProjects || isOwner(principal, draft)) return true;
  if (!draft.projectSlug) return false;
  const project = await getProjectBySlug(draft.projectSlug);
  return Boolean(project && canWriteProject(principal, project.id));
}

/**
 * Loads a draft the caller may act on. Answers 404 for a draft the caller cannot
 * see (its existence is not disclosed) and 403 when it is visible but read-only.
 */
export async function loadDraftFor(
  req: Request,
  res: Response,
  mode: "read" | "write",
): Promise<TestDesignDraftWithStories | null> {
  const draft = await repo.getDraft(String(req.params.draftId));
  const principal = principalOf(req);
  if (!draft || !canSeeDraft(principal, draft)) {
    notFound(res);
    return null;
  }
  if (mode === "write") {
    if (!(await canEditDraft(principal, draft))) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Solo puedes ver este borrador" });
      return null;
    }
    if (draft.status === "archived") {
      res.status(409).json({ ok: false, error: "draft_archived", message: "El borrador está archivado" });
      return null;
    }
  }
  return draft;
}

function parseIssues(raw: unknown, jiraProjectKey: string): repo.DraftIssueInput[] {
  if (!Array.isArray(raw)) throw new TestDesignValidationError("issues debe ser una lista");
  return raw.map((item, index) => {
    const value = typeof item === "string" ? { issueKey: item } : (item as Record<string, unknown>);
    const key = typeof value?.issueKey === "string" ? value.issueKey.trim().toUpperCase() : "";
    if (!JIRA_ISSUE_KEY.test(key)) {
      throw new TestDesignValidationError(`issues[${index}] no es una key de Jira válida`);
    }
    if (!key.startsWith(`${jiraProjectKey}-`)) {
      throw new TestDesignValidationError(`${key} no pertenece al proyecto ${jiraProjectKey}`);
    }
    const summary = typeof value.issueSummary === "string" ? value.issueSummary : "";
    return { issueKey: key, issueSummary: summary };
  });
}

function parsePositiveIntOrNull(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new TestDesignValidationError(`${field} debe ser un entero positivo`);
  return n;
}

function parseTestRail(raw: unknown): Partial<TestDesignTestRailTarget> | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object") throw new TestDesignValidationError("testRail debe ser un objeto");
  const value = raw as Record<string, unknown>;
  const target: Partial<TestDesignTestRailTarget> = {};
  if ("projectId" in value) target.projectId = parsePositiveIntOrNull(value.projectId, "testRail.projectId");
  if ("suiteId" in value) target.suiteId = parsePositiveIntOrNull(value.suiteId, "testRail.suiteId");
  if ("sectionId" in value) target.sectionId = parsePositiveIntOrNull(value.sectionId, "testRail.sectionId");
  return target;
}

function optionalText(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new TestDesignValidationError(`${field} debe ser texto`);
  return value;
}

/** Validation errors become 400s; anything else goes to the app's error handler. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: (err?: unknown) => void) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof TestDesignValidationError) {
        badRequest(res, err.message);
        return;
      }
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// Jira stories
// ---------------------------------------------------------------------------

/** Stories of one Jira project, by key or text. Without `q`, the most recently updated. */
testDesignRouter.get(
  "/jira/issues/search",
  handle(async (req, res) => {
    const projectKey = String(req.query.projectKey ?? "").trim().toUpperCase();
    if (!JIRA_PROJECT_KEY.test(projectKey)) {
      badRequest(res, "projectKey es obligatorio");
      return;
    }
    const query = String(req.query.q ?? "").trim();
    const clauses = [`project = "${projectKey}"`, "issuetype not in subTaskIssueTypes()"];
    if (query) {
      const escaped = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const byKey = JIRA_ISSUE_KEY.test(query.toUpperCase()) ? `key = ${query.toUpperCase()} OR ` : "";
      clauses.push(`(${byKey}text ~ "${escaped}")`);
    }
    const issues = await jira().searchIssues(
      `${clauses.join(" AND ")} ORDER BY updated DESC`,
      ["summary", "status", "issuetype"],
      50,
    );
    res.json({
      issues: issues.map((issue) => ({
        key: issue.key,
        summary: issue.fields?.summary ?? "",
        status: issue.fields?.status?.name ?? "",
        issueType: issue.fields?.issuetype?.name ?? "",
      })),
    });
  }),
);

/** The sub-task type a publish would use in this project, so the panel can say so beforehand. */
testDesignRouter.get(
  "/jira/subtask-type",
  handle(async (req, res) => {
    const projectKey = String(req.query.projectKey ?? "").trim().toUpperCase();
    if (!JIRA_PROJECT_KEY.test(projectKey)) {
      badRequest(res, "projectKey es obligatorio");
      return;
    }
    const client = publishDeps.jira();
    try {
      const type = await resolveSubtaskType(projectKey, (key) => client.getSubtaskIssueTypes(key));
      res.json({ issueType: type });
    } catch (err) {
      if (err instanceof SubtaskTypeNotFoundError) {
        res.json({ issueType: null, message: err.message, available: err.available });
        return;
      }
      throw err;
    }
  }),
);

/** Full story, as the generator will read it: description and acceptance criteria as text. */
testDesignRouter.get(
  "/jira/issues/:issueKey",
  handle(async (req, res) => {
    const key = String(req.params.issueKey).trim().toUpperCase();
    if (!JIRA_ISSUE_KEY.test(key)) {
      badRequest(res, "issueKey no es una key de Jira válida");
      return;
    }
    res.json({ issue: await loadJiraIssue(requireJiraConfig(config), key) });
  }),
);

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

testDesignRouter.get(
  "/drafts",
  handle(async (req, res) => {
    const principal = principalOf(req);
    const mine = req.query.mine === "true";
    const drafts = await repo.listDrafts({
      createdBy: mine ? principal.userId ?? "__none__" : undefined,
      jiraProjectKey: typeof req.query.jiraProjectKey === "string" ? req.query.jiraProjectKey : undefined,
      includeArchived: req.query.includeArchived === "true",
    });
    res.json({ drafts: drafts.filter((draft) => canSeeDraft(principal, draft)) });
  }),
);

testDesignRouter.post(
  "/drafts",
  handle(async (req, res) => {
    const principal = principalOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const jiraProjectKey = String(body.jiraProjectKey ?? "").trim().toUpperCase();
    if (!JIRA_PROJECT_KEY.test(jiraProjectKey)) {
      badRequest(res, "jiraProjectKey es obligatorio");
      return;
    }
    const issues = parseIssues(body.issues ?? [], jiraProjectKey);
    const unique = new Set(issues.map((i) => i.issueKey));
    if (unique.size === 0) {
      badRequest(res, "Selecciona al menos una historia");
      return;
    }
    if (unique.size > maxStoriesPerDraft()) {
      badRequest(res, `Un borrador admite como máximo ${maxStoriesPerDraft()} historias`);
      return;
    }

    const projectSlug = optionalText(body.projectSlug, "projectSlug")?.trim() || null;
    if (projectSlug && !(await getProjectBySlug(projectSlug))) {
      badRequest(res, `No existe el proyecto ${projectSlug}`);
      return;
    }

    const draft = await repo.createDraft({
      jiraProjectKey,
      projectSlug,
      title: optionalText(body.title, "title"),
      testRail: parseTestRail(body.testRail),
      instructions: optionalText(body.instructions, "instructions"),
      createdBy: principal.userId,
      createdByName: principal.username,
      issues,
    });
    res.status(201).json({ draft });
  }),
);

testDesignRouter.get(
  "/drafts/:draftId",
  handle(async (req, res) => {
    const draft = await loadDraftFor(req, res, "read");
    if (draft) res.json({ draft: await settleInterruptedStories(draft) });
  }),
);

/**
 * Edits the draft itself: title, instructions, TestRail destination, and the
 * story list (`addIssues`, `removeStoryIds`). Scenarios are saved per story.
 */
testDesignRouter.put(
  "/drafts/:draftId",
  handle(async (req, res) => {
    const draft = await loadDraftFor(req, res, "write");
    if (!draft) return;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const addIssues = body.addIssues === undefined ? [] : parseIssues(body.addIssues, draft.jiraProjectKey);
    const removeIds = Array.isArray(body.removeStoryIds) ? body.removeStoryIds.map(String) : [];
    const removingBusy = draft.stories.filter((s) => removeIds.includes(s.id) && isStoryRunning(s.id));
    if (removingBusy.length > 0) {
      generating(res, removingBusy.map((s) => s.issueKey));
      return;
    }
    const remaining = draft.stories.filter((s) => !removeIds.includes(s.id)).map((s) => s.issueKey);
    const finalCount = new Set([...remaining, ...addIssues.map((i) => i.issueKey)]).size;
    if (finalCount > maxStoriesPerDraft()) {
      badRequest(res, `Un borrador admite como máximo ${maxStoriesPerDraft()} historias`);
      return;
    }
    if (finalCount === 0) {
      badRequest(res, "El borrador debe conservar al menos una historia");
      return;
    }

    await repo.updateDraft(draft.id, {
      title: optionalText(body.title, "title"),
      instructions: optionalText(body.instructions, "instructions"),
      testRail: parseTestRail(body.testRail),
    });
    for (const storyId of removeIds) await repo.removeStory(draft.id, storyId);
    if (addIssues.length > 0) await repo.addStories(draft.id, addIssues);

    res.json({ draft: await repo.getDraft(draft.id) });
  }),
);

testDesignRouter.delete(
  "/drafts/:draftId",
  handle(async (req, res) => {
    const draft = await loadDraftFor(req, res, "write");
    if (!draft) return;
    await repo.archiveDraft(draft.id);
    res.json({ ok: true });
  }),
);

/** Replaces a story's scenario list: the panel's autosave target. */
testDesignRouter.put(
  "/drafts/:draftId/stories/:storyId/scenarios",
  handle(async (req, res) => {
    const draft = await loadDraftFor(req, res, "write");
    if (!draft) return;
    const story = draft.stories.find((s) => s.id.toLowerCase() === String(req.params.storyId).toLowerCase());
    if (!story) {
      res.status(404).json({ ok: false, error: "story_not_found", message: "Historia no encontrada en el borrador" });
      return;
    }
    if (isStoryRunning(story.id)) {
      generating(res, [story.issueKey]);
      return;
    }
    const incoming = normalizeScenarios((req.body ?? {}).scenarios, { origin: "manual" });
    const scenarios = markEditedScenarios(story.scenarios, incoming);
    const saved = await repo.saveStoryScenarios(draft.id, story.id, scenarios);
    res.json({ story: saved });
  }),
);

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

async function launch(
  res: Response,
  draft: TestDesignDraftWithStories,
  stories: TestDesignDraftWithStories["stories"],
  instructions: string | null | undefined,
): Promise<void> {
  try {
    await startGeneration(draft.id, stories, draft.instructions, generationDeps, { instructions });
  } catch (err) {
    if (err instanceof GenerationConflictError) {
      generating(res, err.issueKeys);
      return;
    }
    throw err;
  }
  res.status(202).json({ draft: await repo.getDraft(draft.id) });
}

/**
 * Generates the draft's stories in the background. Without `storyIds`, only the
 * ones never generated or that failed; the panel polls GET /drafts/:id.
 */
testDesignRouter.post(
  "/drafts/:draftId/generate",
  handle(async (req, res) => {
    const draft = await loadDraftFor(req, res, "write");
    if (!draft) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requested = Array.isArray(body.storyIds) ? body.storyIds.map((id) => String(id).toLowerCase()) : null;
    const stories = requested
      ? draft.stories.filter((s) => requested.includes(s.id.toLowerCase()))
      : (await settleInterruptedStories(draft)).stories.filter(
          (s) => s.generationStatus === "pending" || s.generationStatus === "failed",
        );
    if (requested && stories.length !== requested.length) {
      res.status(404).json({ ok: false, error: "story_not_found", message: "Alguna historia no pertenece al borrador" });
      return;
    }
    if (stories.length === 0) {
      badRequest(res, "No hay historias pendientes de generar");
      return;
    }
    await launch(res, draft, stories, optionalText(body.instructions, "instructions"));
  }),
);

/** Regenerates one story: scenarios a person wrote, edited or published are kept. */
testDesignRouter.post(
  "/drafts/:draftId/stories/:storyId/regenerate",
  handle(async (req, res) => {
    const draft = await loadDraftFor(req, res, "write");
    if (!draft) return;
    const story = draft.stories.find((s) => s.id.toLowerCase() === String(req.params.storyId).toLowerCase());
    if (!story) {
      res.status(404).json({ ok: false, error: "story_not_found", message: "Historia no encontrada en el borrador" });
      return;
    }
    await launch(res, draft, [story], optionalText((req.body ?? {}).instructions, "instructions"));
  }),
);

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/**
 * Stories to publish (all, or `storyIds`), after the checks every destination
 * shares: nothing generating, and no selected scenario incomplete. Answers the
 * request itself and returns null when publishing must not start.
 */
async function storiesToPublish(
  req: Request,
  res: Response,
  draft: TestDesignDraftWithStories,
  destination: "testrail" | "jira",
): Promise<TestDesignDraftWithStories["stories"] | null> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const requested = Array.isArray(body.storyIds) ? body.storyIds.map((id) => String(id).toLowerCase()) : null;
  const stories = requested ? draft.stories.filter((s) => requested.includes(s.id.toLowerCase())) : draft.stories;
  if (requested && stories.length !== requested.length) {
    res.status(404).json({ ok: false, error: "story_not_found", message: "Alguna historia no pertenece al borrador" });
    return null;
  }
  const busy = stories.filter((s) => isStoryRunning(s.id) || s.generationStatus === "generating");
  if (busy.length > 0) {
    generating(res, busy.map((s) => s.issueKey));
    return null;
  }
  const issues = stories.flatMap((s) =>
    findPublishIssues(s.scenarios, destination).map((issue) => ({ ...issue, issueKey: s.issueKey })),
  );
  if (issues.length > 0) {
    res.status(422).json({
      ok: false,
      error: "scenarios_incomplete",
      message: `Hay ${issues.length} problema(s) en escenarios seleccionados; corrígelos o desmárcalos antes de publicar`,
      issues,
    });
    return null;
  }
  const selected = stories.filter((s) =>
    s.scenarios.some((sc) => (destination === "testrail" ? sc.selectedForTestRail : sc.selectedForJira)),
  );
  if (selected.length === 0) {
    badRequest(res, destination === "testrail" ? "No hay escenarios seleccionados para TestRail" : "No hay escenarios seleccionados para Jira");
    return null;
  }
  return stories;
}

async function finishPublish(draftId: string) {
  const fresh = await repo.getDraft(draftId);
  if (!fresh) return null;
  const status = computeDraftStatus(fresh);
  if (status !== fresh.status) {
    await repo.updateDraft(draftId, { status });
    return { ...fresh, status };
  }
  return fresh;
}

testDesignRouter.post(
  "/drafts/:draftId/publish/testrail",
  handle(async (req, res) => {
    const draft = await loadDraftFor(req, res, "write");
    if (!draft) return;
    if (!draft.testRail.projectId || !draft.testRail.sectionId) {
      badRequest(res, "Elige el proyecto y la sección de TestRail del borrador antes de publicar");
      return;
    }
    const stories = await storiesToPublish(req, res, draft, "testrail");
    if (!stories) return;

    const { client, baseUrl } = publishDeps.testRail();
    const results = await publishDraftToTestRail(draft, stories, {
      client,
      testRailBaseUrl: baseUrl,
      requiredCustomFields: testRailRequiredCaseCustomFields(),
      caseOracle: process.env.TESTRAIL_DEFAULT_CASE_ORACLE || "QA",
    });
    const updated = await finishPublish(draft.id);
    console.log(
      `[test-design:testrail] draft=${draft.id} historias=${results.length} ` +
        `casos=${results.flatMap((r) => r.scenarios).filter((s) => s.status !== "failed").length} ` +
        `fallidos=${results.flatMap((r) => r.scenarios).filter((s) => s.status === "failed").length}`,
    );
    res.json({ draft: updated, results });
  }),
);

testDesignRouter.post(
  "/drafts/:draftId/publish/jira",
  handle(async (req, res) => {
    const draft = await loadDraftFor(req, res, "write");
    if (!draft) return;
    const stories = await storiesToPublish(req, res, draft, "jira");
    if (!stories) return;

    let testRailBaseUrl: string | null = null;
    try {
      testRailBaseUrl = publishDeps.testRail().baseUrl;
    } catch {
      // Without TestRail configured the sub-task just shows case ids without links.
    }
    const results = await publishDraftToJira(draft, stories, {
      client: publishDeps.jira(),
      testRailBaseUrl,
      publishedBy: principalOf(req).username,
    });
    const updated = await finishPublish(draft.id);
    console.log(
      `[test-design:jira] draft=${draft.id} ` + results.map((r) => `${r.issueKey}:${r.status}${r.subtaskKey ? `->${r.subtaskKey}` : ""}`).join(" "),
    );
    res.json({ draft: updated, results });
  }),
);
