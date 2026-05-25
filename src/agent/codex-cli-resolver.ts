import fs from "node:fs";
import path from "node:path";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile as nodeExecFile } from "node:child_process";

type AttemptedResolution = {
  source: string;
  command: string;
  exists: boolean;
  executable?: boolean;
  error?: string;
};

export type CodexCliResolution =
  | {
      found: true;
      command: string;
      argsPrefix?: string[];
      source: "CODEX_CLI_PATH" | "PATH" | "npm_global_prefix" | "npm_bin";
      displayCommand: string;
      diagnostics: {
        attempted: AttemptedResolution[];
      };
    }
  | {
      found: false;
      reason: "codex_cli_not_found" | "codex_cli_path_invalid" | "codex_cli_not_executable";
      attempted: AttemptedResolution[];
      message: string;
      recommendation: string;
    };

export type ResolveCodexCliPathOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  cwd?: string;
  logger?: { log: (message: string) => void };
  commandHint?: string;
};

let execFileFn: typeof nodeExecFile = nodeExecFile;
export function __setExecFileForTesting(fn: typeof nodeExecFile | undefined): void {
  execFileFn = fn ?? nodeExecFile;
}

const USER_PATH_PATTERN = /(^|[\\/])users?[\\/][^\\/]+/i;

function isAbsoluteCommand(candidate: string): boolean {
  return path.isAbsolute(candidate) || /^[a-zA-Z]:[\\/]/.test(candidate);
}

function looksLikeRelativePath(candidate: string): boolean {
  return candidate.includes("/") || candidate.includes("\\");
}

async function ensureCandidateExecutable(candidate: string, platform: string): Promise<{ exists: boolean; executable: boolean; error?: string }> {
  try {
    await access(candidate, fsConstants.F_OK);
  } catch (err) {
    return { exists: false, executable: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (platform === "win32") {
    return { exists: true, executable: true };
  }

  try {
    await access(candidate, fsConstants.X_OK);
    return { exists: true, executable: true };
  } catch (err) {
    return { exists: true, executable: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function splitPathEnv(pathEnv: string | undefined): string[] {
  if (!pathEnv) return [];
  return pathEnv.split(path.delimiter).map((p) => p.trim()).filter(Boolean);
}

function getPathCandidates(baseName: string, platform: string): string[] {
  if (platform === "win32") {
    return [
      `${baseName}.cmd`,
      `${baseName}.exe`,
      `${baseName}.ps1`,
      baseName
    ];
  }
  return [baseName];
}

async function resolveFromPath(
  baseName: string,
  env: NodeJS.ProcessEnv,
  platform: string,
  attempted: AttemptedResolution[]
): Promise<CodexCliResolution | undefined> {
  const dirs = splitPathEnv(env.PATH);
  const names = getPathCandidates(baseName, platform);
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      const { exists, executable, error } = await ensureCandidateExecutable(candidate, platform);
      attempted.push({ source: "PATH", command: candidate, exists, executable, error });
      if (exists && executable) {
        return {
          found: true,
          command: candidate,
          source: "PATH",
          displayCommand: candidate,
          diagnostics: { attempted }
        };
      }
    }
  }
  return undefined;
}

type ExecResult = { stdout: string; stderr: string; error?: string };

function execCommand(command: string, args: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFileFn(command, args, { cwd }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? "").trim(),
        stderr: String(stderr ?? "").trim(),
        error: error ? error.message : undefined
      });
    });
  });
}

async function resolveFromNpmGlobalPrefix(
  baseName: string,
  env: NodeJS.ProcessEnv,
  platform: string,
  cwd: string,
  attempted: AttemptedResolution[]
): Promise<CodexCliResolution | undefined> {
  const prefixes = new Set<string>();
  if (env.NPM_CONFIG_PREFIX?.trim()) {
    prefixes.add(env.NPM_CONFIG_PREFIX.trim());
  }

  const prefixResult = await execCommand("npm", ["prefix", "-g"], cwd);
  if (prefixResult.stdout) {
    prefixes.add(prefixResult.stdout);
  }

  const binResult = await execCommand("npm", ["bin", "-g"], cwd);
  if (binResult.stdout) {
    prefixes.add(binResult.stdout);
  }

  const candidates: Array<{ source: "npm_global_prefix" | "npm_bin"; value: string }> = [];
  for (const prefix of prefixes) {
    if (platform === "win32") {
      candidates.push(
        { source: "npm_global_prefix", value: path.join(prefix, `${baseName}.cmd`) },
        { source: "npm_global_prefix", value: path.join(prefix, `${baseName}.exe`) },
        { source: "npm_global_prefix", value: path.join(prefix, "node_modules", ".bin", `${baseName}.cmd`) },
        { source: "npm_bin", value: path.join(prefix, `${baseName}.cmd`) }
      );
    } else {
      candidates.push(
        { source: "npm_global_prefix", value: path.join(prefix, "bin", baseName) },
        { source: "npm_global_prefix", value: path.join(prefix, "lib", "node_modules", ".bin", baseName) },
        { source: "npm_bin", value: path.join(prefix, baseName) }
      );
    }
  }

  for (const candidate of candidates) {
    const { exists, executable, error } = await ensureCandidateExecutable(candidate.value, platform);
    attempted.push({ source: candidate.source, command: candidate.value, exists, executable, error });
    if (exists && executable) {
      return {
        found: true,
        command: candidate.value,
        source: candidate.source,
        displayCommand: candidate.value,
        diagnostics: { attempted }
      };
    }
  }

  return undefined;
}

function buildNotFoundResult(attempted: AttemptedResolution[]): CodexCliResolution {
  return {
    found: false,
    reason: "codex_cli_not_found",
    attempted,
    message: "Codex CLI was not found in PATH or npm global locations.",
    recommendation: "Set CODEX_CLI_PATH or ensure codex is available in PATH."
  };
}

export async function resolveCodexCliPath(options: ResolveCodexCliPathOptions): Promise<CodexCliResolution> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = options.cwd ?? process.cwd();
  const attempted: AttemptedResolution[] = [];
  const logger = options.logger;

  logger?.log("[auto-repair] Resolving Codex CLI...");

  const explicitPath = env.CODEX_CLI_PATH?.trim();
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    const check = await ensureCandidateExecutable(resolved, platform);
    attempted.push({ source: "CODEX_CLI_PATH", command: resolved, exists: check.exists, executable: check.executable, error: check.error });
    if (!check.exists) {
      return {
        found: false,
        reason: "codex_cli_path_invalid",
        attempted,
        message: "CODEX_CLI_PATH points to a missing file.",
        recommendation: "Update CODEX_CLI_PATH to a valid codex executable path."
      };
    }
    if (!check.executable) {
      return {
        found: false,
        reason: "codex_cli_not_executable",
        attempted,
        message: "CODEX_CLI_PATH exists but is not executable.",
        recommendation: "Point CODEX_CLI_PATH to an executable codex binary/script."
      };
    }
    return {
      found: true,
      command: resolved,
      source: "CODEX_CLI_PATH",
      displayCommand: resolved,
      diagnostics: { attempted }
    };
  }

  const hint = options.commandHint?.trim();
  const candidateBaseName = hint && !isAbsoluteCommand(hint) && !looksLikeRelativePath(hint) ? hint : "codex";
  if (hint && (isAbsoluteCommand(hint) || looksLikeRelativePath(hint))) {
    const resolvedHint = path.resolve(hint);
    const check = await ensureCandidateExecutable(resolvedHint, platform);
    attempted.push({ source: "PATH", command: resolvedHint, exists: check.exists, executable: check.executable, error: check.error });
    if (check.exists && check.executable) {
      return {
        found: true,
        command: resolvedHint,
        source: "PATH",
        displayCommand: resolvedHint,
        diagnostics: { attempted }
      };
    }
  }

  const fromPath = await resolveFromPath(candidateBaseName, env, platform, attempted);
  if (fromPath) {
    return fromPath;
  }

  const fromPrefix = await resolveFromNpmGlobalPrefix(candidateBaseName, env, platform, cwd, attempted);
  if (fromPrefix) {
    return fromPrefix;
  }

  const filteredAttempts = attempted.filter((a) => !USER_PATH_PATTERN.test(a.command) || a.exists);
  return buildNotFoundResult(filteredAttempts);
}

