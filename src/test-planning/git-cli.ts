import { execFile } from "node:child_process";
import { resolveSecretRef } from "../db/secret-resolver";
import type { RepositoryConfig } from "./repository-config";

/**
 * Thin wrapper over the `git` CLI. Git must be on PATH on the machine running
 * the engine. Commands never prompt: with no credential configured they rely on
 * the machine's git credential helper; with `env:VAR` the PAT is injected as an
 * HTTP header through GIT_CONFIG_* env vars, so it never appears in argv, in a
 * remote URL or in `.git/config`.
 */

export class GitCommandError extends Error {
  readonly code: string;
  constructor(
    message: string,
    code: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.code = code;
  }
}

/**
 * HTTP status for a git failure. Never 401: the panel treats 401 as "session
 * expired" and logs the user out, while this is the repository's credential.
 */
export function gitErrorStatus(err: GitCommandError): number {
  switch (err.code) {
    case "git_repo_not_found":
      return 404;
    case "git_credential_missing":
    case "git_invalid_ref":
      return 400;
    case "git_push_rejected":
    case "git_conflict":
      return 409;
    case "git_push_denied":
      return 403;
    default:
      return 502;
  }
}

export interface GitRunOptions {
  cwd?: string;
  timeoutMs?: number;
  auth?: Pick<RepositoryConfig, "credentialSecretRef" | "repoUrl">;
  /** Extra environment (e.g. GIT_INDEX_FILE, author identity). */
  env?: Record<string, string>;
  maxBuffer?: number;
}

export interface GitResult {
  stdout: string;
  stderr: string;
}

export function authorizationHeader(token: string): string {
  return `Authorization: Basic ${Buffer.from(`:${token}`).toString("base64")}`;
}

/** Environment for a git child process. Exported for tests. */
export function buildGitEnv(options: Pick<GitRunOptions, "auth" | "env">, base: NodeJS.ProcessEnv = process.env): {
  env: NodeJS.ProcessEnv;
  secrets: string[];
} {
  const env: NodeJS.ProcessEnv = {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    // Only network transports; blocks file://, ext:: and other remote helpers.
    // QA_LAB_GIT_ALLOW_PROTOCOL exists only so tests can push to a local bare repo.
    GIT_ALLOW_PROTOCOL: base.QA_LAB_GIT_ALLOW_PROTOCOL || "https:ssh",
    LC_ALL: "C",
    ...options.env,
  };
  const secrets: string[] = [];
  const ref = options.auth?.credentialSecretRef;
  if (ref) {
    // Defence in depth: stored rows are validated, but never resolve other secrets here.
    if (!/^env:[A-Z0-9_]*GIT_(PAT|TOKEN)[A-Z0-9_]*$/.test(ref)) {
      throw new Error("credential ref must name a *GIT_PAT* / *GIT_TOKEN* variable");
    }
    const token = resolveSecretRef(ref);
    const header = authorizationHeader(token);
    secrets.push(token, header.slice("Authorization: Basic ".length));
    const configs: Array<[string, string]> = [
      ["http.extraHeader", header],
      // The header already authenticates; never fall back to a stored credential.
      ["credential.helper", ""],
    ];
    const offset = Number(base.GIT_CONFIG_COUNT ?? 0) || 0;
    configs.forEach(([key, value], i) => {
      env[`GIT_CONFIG_KEY_${offset + i}`] = key;
      env[`GIT_CONFIG_VALUE_${offset + i}`] = value;
    });
    env.GIT_CONFIG_COUNT = String(offset + configs.length);
  }
  return { env, secrets };
}

export function redact(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) if (secret) result = result.split(secret).join("***");
  // Credentials embedded in URLs by the remote itself.
  return result.replace(/(https:\/\/[^\s/:@]+):[^\s/@]+@/gi, "$1:***@");
}

function classify(stderr: string): string {
  if (/Authentication failed|could not read Username|terminal prompts disabled|403|401|Permission denied/i.test(stderr)) {
    return "git_auth_failed";
  }
  if (/Could not resolve host|unable to access|Connection (timed out|refused)|Failed to connect/i.test(stderr)) {
    return "git_unreachable";
  }
  if (/not found|does not appear to be a git repository|Repository not found/i.test(stderr)) return "git_repo_not_found";
  // Server-side refusal (branch policy, permissions): retrying cannot help.
  if (/remote rejected|TF\d{6}|pre-receive hook declined/i.test(stderr)) return "git_push_denied";
  if (/rejected|non-fast-forward|fetch first/i.test(stderr)) return "git_push_rejected";
  return "git_failed";
}

export function runGit(args: string[], options: GitRunOptions = {}): Promise<GitResult> {
  let built: ReturnType<typeof buildGitEnv>;
  try {
    built = buildGitEnv(options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Promise.reject(new GitCommandError(`Credencial del repositorio no disponible: ${message}`, "git_credential_missing", null));
  }
  const { env, secrets } = built;
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        env,
        timeout: options.timeoutMs ?? 60_000,
        maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }
        const err = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
        if (err.code === "ENOENT") {
          reject(new GitCommandError("git no está instalado o no está en el PATH del servidor.", "git_not_installed", null));
          return;
        }
        if (err.killed) {
          reject(new GitCommandError(`git ${args[0]} superó el tiempo límite.`, "git_timeout", null));
          return;
        }
        const detail = redact(String(stderr || err.message).trim(), secrets);
        reject(new GitCommandError(detail || `git ${args[0]} falló`, classify(detail), typeof err.code === "number" ? err.code : null));
      },
    );
  });
}

export interface RepositoryAccessResult {
  ok: true;
  branchCount: number;
  /** Branch the remote HEAD points to, when advertised. */
  remoteHead: string | null;
  defaultBranchExists: boolean;
  authMode: "pat" | "system";
  elapsedMs: number;
}

/** Parses `git ls-remote --symref <url> HEAD refs/heads/*` output. */
export function parseLsRemote(stdout: string): { branches: string[]; head: string | null } {
  const branches: string[] = [];
  let head: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const symref = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/.exec(line);
    if (symref) {
      head = symref[1];
      continue;
    }
    const ref = /^[0-9a-f]{40,64}\s+refs\/heads\/(\S+)$/.exec(line);
    if (ref) branches.push(ref[1]);
  }
  return { branches, head };
}

/** Checks the remote is reachable with the configured credentials (no clone). */
export async function testRepositoryAccess(config: RepositoryConfig): Promise<RepositoryAccessResult> {
  const started = Date.now();
  const { stdout } = await runGit(["ls-remote", "--symref", "--", config.repoUrl, "HEAD", "refs/heads/*"], {
    auth: config,
    timeoutMs: 30_000,
  });
  const { branches, head } = parseLsRemote(stdout);
  return {
    ok: true,
    branchCount: branches.length,
    remoteHead: head,
    defaultBranchExists: branches.includes(config.defaultBranch),
    authMode: config.credentialSecretRef ? "pat" : "system",
    elapsedMs: Date.now() - started,
  };
}
