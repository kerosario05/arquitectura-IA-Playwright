import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GitCommandError, runGit } from "./git-cli";
import { isValidBranchName, keyFromPlanFileName, type RepositoryConfig } from "./repository-config";

/**
 * The engine's own clone of each project's repository.
 *
 * One bare, blob-less partial clone per project under GIT_REPOS_DIR
 * (default data/repos/<slug>.git). Remote branches live under
 * refs/remotes/origin/*; everything is read straight from those refs with
 * `ls-tree` / `cat-file`, so there is no working tree, no checkout and nothing
 * a concurrent request could leave half-switched. Blobs are downloaded lazily,
 * only for the plan files that are actually opened.
 */

export interface BranchInfo {
  name: string;
  headSha: string;
  committedAt: string;
  subject: string;
  /** Number of plan files in the branch (null when not counted yet). */
  planCount: number;
}

export interface PlanFileRef {
  key: string;
  /** Repo-relative path, e.g. docs/specs/GEN-827-x/test-plan-GEN-827.md */
  path: string;
  /** Folder directly containing the file (usually the spec folder). */
  folder: string;
  blobSha: string;
  /** True when the HU key also appears in the branch name. */
  matchesBranch: boolean;
}

export interface WorkspaceStatus {
  cloned: boolean;
  lastFetchAt: string | null;
}

const DEFAULT_REPOS_DIR = path.join("data", "repos");

export function reposRoot(): string {
  return path.resolve(process.cwd(), process.env.GIT_REPOS_DIR?.trim() || DEFAULT_REPOS_DIR);
}

export function workspacePath(slug: string): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  return path.join(reposRoot(), `${safe}.git`);
}

/** Serializes clone/fetch per repository; reads do not need the lock. */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  locks.set(key, next);
  const release = () => {
    if (locks.get(key) === next) locks.delete(key);
  };
  // Cleanup must not create a second, unhandled rejection; the caller gets `next`.
  next.then(release, release);
  return next;
}

function assertBranch(branch: string): void {
  if (!isValidBranchName(branch)) throw new GitCommandError(`Rama no válida: ${branch}`, "git_invalid_ref", null);
}

/** Extracts an issue key such as GEN-827 from a branch name. */
export function branchIssueKeys(branch: string): string[] {
  return [...branch.matchAll(/([A-Za-z][A-Za-z0-9]+-\d+)/g)].map((m) => m[1].toUpperCase());
}

export class RepoWorkspace {
  readonly dir: string;

  constructor(
    readonly slug: string,
    readonly config: RepositoryConfig,
  ) {
    this.dir = workspacePath(slug);
  }

  private git(args: string[], timeoutMs = 60_000) {
    return runGit(args, { cwd: this.dir, auth: this.config, timeoutMs });
  }

  status(): WorkspaceStatus {
    const cloned = fs.existsSync(path.join(this.dir, "HEAD"));
    let lastFetchAt: string | null = null;
    try {
      lastFetchAt = fs.statSync(path.join(this.dir, "FETCH_HEAD")).mtime.toISOString();
    } catch {
      /* never fetched */
    }
    return { cloned, lastFetchAt };
  }

  /** Creates the clone on first use and keeps the remote URL in sync with the config. */
  private async ensureInitialized(): Promise<void> {
    if (!this.status().cloned) {
      fs.mkdirSync(this.dir, { recursive: true });
      await runGit(["init", "--bare", "--quiet", this.dir], { timeoutMs: 30_000 });
      await this.git(["remote", "add", "origin", "--", this.config.repoUrl]);
      await this.git(["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"]);
      await this.git(["config", "remote.origin.promisor", "true"]);
      await this.git(["config", "remote.origin.partialclonefilter", "blob:none"]);
      // Never pack or prune behind our back while requests read the repo.
      await this.git(["config", "gc.auto", "0"]);
      return;
    }
    const { stdout } = await this.git(["remote", "get-url", "origin"]);
    if (stdout.trim() !== this.config.repoUrl) {
      await this.git(["remote", "set-url", "origin", "--", this.config.repoUrl]);
    }
  }

  /** Fetches every branch (prunes deleted ones). Clones on first use. */
  fetchAll(): Promise<WorkspaceStatus> {
    return withLock(this.dir, async () => {
      await this.ensureInitialized();
      await this.git(["fetch", "--prune", "--quiet", "--filter=blob:none", "origin"], 180_000);
      return this.status();
    });
  }

  /** Fetches a single branch; returns its new head. */
  fetchBranch(branch: string): Promise<string> {
    assertBranch(branch);
    return withLock(this.dir, async () => {
      await this.ensureInitialized();
      await this.git(
        ["fetch", "--quiet", "--filter=blob:none", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
        120_000,
      );
      return this.headOf(branch);
    });
  }

  /** Clones and fetches when the workspace does not exist yet. */
  async ensureReady(): Promise<void> {
    if (!this.status().cloned || !this.status().lastFetchAt) await this.fetchAll();
  }

  async headOf(branch: string): Promise<string> {
    assertBranch(branch);
    try {
      const { stdout } = await this.git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}^{commit}`]);
      return stdout.trim();
    } catch {
      throw new GitCommandError(`La rama "${branch}" no existe en el remoto (haz Fetch para actualizar).`, "git_branch_not_found", null);
    }
  }

  /** Remote branches with their head and how many plan files each one has. */
  async listBranches(): Promise<BranchInfo[]> {
    const { stdout } = await this.git([
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname:lstrip=3)%00%(objectname)%00%(committerdate:iso-strict)%00%(contents:subject)",
      "refs/remotes/origin",
    ]);
    const branches: BranchInfo[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const [name, headSha, committedAt, subject] = line.split("\0");
      if (name === "HEAD") continue;
      branches.push({ name, headSha, committedAt, subject: subject ?? "", planCount: 0 });
    }
    await Promise.all(
      branches.map(async (branch) => {
        branch.planCount = (await this.planFilesAt(branch.headSha, branch.name)).length;
      }),
    );
    return branches;
  }

  /** Plan files of a branch, read from its remote head. */
  async listPlans(branch: string): Promise<{ headSha: string; plans: PlanFileRef[] }> {
    const headSha = await this.headOf(branch);
    return { headSha, plans: await this.planFilesAt(headSha, branch) };
  }

  private planCache = new Map<string, PlanFileRef[]>();

  private async planFilesAt(commitSha: string, branch: string): Promise<PlanFileRef[]> {
    const cacheKey = `${commitSha}:${this.config.specsPath}:${this.config.filePattern}`;
    let files = this.planCache.get(cacheKey);
    if (!files) {
      // Trees are present in a blob:none clone, so this never touches the network.
      const { stdout } = await this.git(["ls-tree", "-r", "-z", commitSha, "--", this.config.specsPath]);
      files = [];
      for (const entry of stdout.split("\0")) {
        const match = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(entry);
        if (!match) continue;
        const filePath = match[2];
        const key = keyFromPlanFileName(this.config, path.posix.basename(filePath));
        if (!key) continue;
        files.push({
          key,
          path: filePath,
          folder: path.posix.basename(path.posix.dirname(filePath)),
          blobSha: match[1],
          matchesBranch: false,
        });
      }
      files.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
      this.planCache.set(cacheKey, files);
    }
    const keys = new Set(branchIssueKeys(branch));
    return files
      .map((file) => ({ ...file, matchesBranch: keys.has(file.key) }))
      .sort((a, b) => Number(b.matchesBranch) - Number(a.matchesBranch));
  }

  /** Reads one plan file from the branch head (downloads its blob on demand). */
  async readPlan(branch: string, planPath: string): Promise<{ headSha: string; file: PlanFileRef; text: string }> {
    const { headSha, plans } = await this.listPlans(branch);
    const file = plans.find((p) => p.path === planPath);
    if (!file) {
      throw new GitCommandError(`No existe el plan ${planPath} en la rama ${branch}.`, "plan_not_found", null);
    }
    const { stdout } = await this.git(["cat-file", "blob", file.blobSha], 120_000);
    return { headSha, file, text: stdout };
  }

  /** Stores `content` as a blob (exact bytes, no filters) and returns its sha. */
  async writeBlob(content: string): Promise<string> {
    const tmp = path.join(os.tmpdir(), `qa-lab-plan-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
    fs.writeFileSync(tmp, content, "utf8");
    try {
      const { stdout } = await this.git(["hash-object", "-w", "--no-filters", "--", tmp]);
      return stdout.trim();
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /** Unified diff between two blobs, labelled with the file path. */
  async diffBlobs(oldSha: string, newSha: string, filePath: string): Promise<string> {
    if (oldSha === newSha) return "";
    const { stdout } = await this.git([
      "diff",
      "--no-color",
      "--unified=3",
      `--src-prefix=a/`,
      `--dst-prefix=b/`,
      oldSha,
      newSha,
    ]);
    // Blob diffs carry the shas as names; show the real path instead.
    return stdout.replace(/^(---|\+\+\+) ([ab])\/[0-9a-f]+$/gm, `$1 $2/${filePath}`);
  }

  private async blobAt(commitSha: string, filePath: string): Promise<{ sha: string; mode: string } | null> {
    const { stdout } = await this.git(["ls-tree", "-z", commitSha, "--", filePath]);
    const match = /^(\d+) blob ([0-9a-f]+)\t/.exec(stdout);
    return match ? { mode: match[1], sha: match[2] } : null;
  }

  /**
   * Commits new contents for existing files on top of the remote head of
   * `branch` and pushes it. No working tree is involved: the tree is built in a
   * throw-away index. Each file must still have the blob the user edited
   * (`baseBlobSha`); otherwise someone changed it meanwhile and the commit is
   * refused with `git_conflict`. If the push loses a race with another push,
   * it refetches and rebuilds once.
   */
  commitFiles(input: {
    branch: string;
    files: Array<{ path: string; content: string; baseBlobSha: string }>;
    message: string;
    author: { name: string; email: string };
  }): Promise<{ commitSha: string; parentSha: string; blobs: Record<string, string> }> {
    assertBranch(input.branch);
    return withLock(this.dir, async () => {
      for (let attempt = 1; ; attempt += 1) {
        await this.git(
          ["fetch", "--quiet", "--filter=blob:none", "origin", `+refs/heads/${input.branch}:refs/remotes/origin/${input.branch}`],
          120_000,
        );
        const parentSha = await this.headOf(input.branch);
        const blobs: Record<string, string> = {};
        const index = path.join(os.tmpdir(), `qa-lab-index-${process.pid}-${Date.now()}`);
        const env = { GIT_INDEX_FILE: index };
        try {
          await runGit(["read-tree", parentSha], { cwd: this.dir, env });
          for (const file of input.files) {
            const current = await this.blobAt(parentSha, file.path);
            if (!current) throw new GitCommandError(`El archivo ${file.path} ya no existe en la rama.`, "git_conflict", null);
            if (current.sha !== file.baseBlobSha) {
              throw new GitCommandError(
                `Alguien modificó ${path.posix.basename(file.path)} en la rama después de que lo abriste. Recarga el plan y vuelve a aplicar tus cambios.`,
                "git_conflict",
                null,
              );
            }
            const sha = await this.writeBlob(file.content);
            blobs[file.path] = sha;
            await runGit(["update-index", "--cacheinfo", `${current.mode},${sha},${file.path}`], { cwd: this.dir, env });
          }
          const tree = (await runGit(["write-tree"], { cwd: this.dir, env })).stdout.trim();
          const identity = {
            GIT_AUTHOR_NAME: input.author.name,
            GIT_AUTHOR_EMAIL: input.author.email,
            GIT_COMMITTER_NAME: input.author.name,
            GIT_COMMITTER_EMAIL: input.author.email,
          };
          const commitSha = (
            await runGit(["commit-tree", tree, "-p", parentSha, "-m", input.message], { cwd: this.dir, env: identity })
          ).stdout.trim();
          try {
            await this.git(["push", "--quiet", "origin", `${commitSha}:refs/heads/${input.branch}`], 120_000);
          } catch (error) {
            if (error instanceof GitCommandError && error.code === "git_push_rejected" && attempt < 2) continue;
            throw error;
          }
          await this.git(["update-ref", `refs/remotes/origin/${input.branch}`, commitSha]);
          return { commitSha, parentSha, blobs };
        } finally {
          fs.rmSync(index, { force: true });
        }
      }
    });
  }

  /** Commits on the remote branch that are newer than `sinceSha`. */
  async commitsSince(branch: string, sinceSha: string): Promise<number> {
    if (!/^[0-9a-f]{40,64}$/.test(sinceSha)) return 0;
    const head = await this.headOf(branch);
    if (head === sinceSha) return 0;
    try {
      const { stdout } = await this.git(["rev-list", "--count", `${sinceSha}..${head}`]);
      return Number(stdout.trim()) || 0;
    } catch {
      // `sinceSha` is no longer reachable (force-push): treat as changed.
      return 1;
    }
  }
}

/** One workspace object per project, so the plan cache survives across requests. */
const workspaces = new Map<string, RepoWorkspace>();

export function getWorkspace(slug: string, config: RepositoryConfig): RepoWorkspace {
  const key = slug.toLowerCase();
  const existing = workspaces.get(key);
  if (existing && JSON.stringify(existing.config) === JSON.stringify(config)) return existing;
  const created = new RepoWorkspace(slug, config);
  workspaces.set(key, created);
  return created;
}
