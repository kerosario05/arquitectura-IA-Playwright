"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.__setExecFileForTesting = __setExecFileForTesting;
exports.resolveCodexCliPath = resolveCodexCliPath;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_child_process_1 = require("node:child_process");
let execFileFn = node_child_process_1.execFile;
function __setExecFileForTesting(fn) {
    execFileFn = fn ?? node_child_process_1.execFile;
}
const USER_PATH_PATTERN = /(^|[\\/])users?[\\/][^\\/]+/i;
function isAbsoluteCommand(candidate) {
    return node_path_1.default.isAbsolute(candidate) || /^[a-zA-Z]:[\\/]/.test(candidate);
}
function looksLikeRelativePath(candidate) {
    return candidate.includes("/") || candidate.includes("\\");
}
async function ensureCandidateExecutable(candidate, platform) {
    try {
        await (0, promises_1.access)(candidate, node_fs_1.constants.F_OK);
    }
    catch (err) {
        return { exists: false, executable: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (platform === "win32") {
        return { exists: true, executable: true };
    }
    try {
        await (0, promises_1.access)(candidate, node_fs_1.constants.X_OK);
        return { exists: true, executable: true };
    }
    catch (err) {
        return { exists: true, executable: false, error: err instanceof Error ? err.message : String(err) };
    }
}
function splitPathEnv(pathEnv) {
    if (!pathEnv)
        return [];
    return pathEnv.split(node_path_1.default.delimiter).map((p) => p.trim()).filter(Boolean);
}
function getPathCandidates(baseName, platform) {
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
async function resolveFromPath(baseName, env, platform, attempted) {
    const dirs = splitPathEnv(env.PATH);
    const names = getPathCandidates(baseName, platform);
    for (const dir of dirs) {
        for (const name of names) {
            const candidate = node_path_1.default.join(dir, name);
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
function execCommand(command, args, cwd) {
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
async function resolveFromNpmGlobalPrefix(baseName, env, platform, cwd, attempted) {
    const prefixes = new Set();
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
    const candidates = [];
    for (const prefix of prefixes) {
        if (platform === "win32") {
            candidates.push({ source: "npm_global_prefix", value: node_path_1.default.join(prefix, `${baseName}.cmd`) }, { source: "npm_global_prefix", value: node_path_1.default.join(prefix, `${baseName}.exe`) }, { source: "npm_global_prefix", value: node_path_1.default.join(prefix, "node_modules", ".bin", `${baseName}.cmd`) }, { source: "npm_bin", value: node_path_1.default.join(prefix, `${baseName}.cmd`) });
        }
        else {
            candidates.push({ source: "npm_global_prefix", value: node_path_1.default.join(prefix, "bin", baseName) }, { source: "npm_global_prefix", value: node_path_1.default.join(prefix, "lib", "node_modules", ".bin", baseName) }, { source: "npm_bin", value: node_path_1.default.join(prefix, baseName) });
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
function buildNotFoundResult(attempted) {
    return {
        found: false,
        reason: "codex_cli_not_found",
        attempted,
        message: "Codex CLI was not found in PATH or npm global locations.",
        recommendation: "Set CODEX_CLI_PATH or ensure codex is available in PATH."
    };
}
async function resolveCodexCliPath(options) {
    const env = options.env ?? process.env;
    const platform = options.platform ?? process.platform;
    const cwd = options.cwd ?? process.cwd();
    const attempted = [];
    const logger = options.logger;
    logger?.log("[auto-repair] Resolving Codex CLI...");
    const explicitPath = env.CODEX_CLI_PATH?.trim();
    if (explicitPath) {
        const resolved = node_path_1.default.resolve(explicitPath);
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
        const resolvedHint = node_path_1.default.resolve(hint);
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
