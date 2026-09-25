"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.__setSpawnForTesting = __setSpawnForTesting;
exports.__setPlatformForTesting = __setPlatformForTesting;
exports.__getLastRunnerInputForTesting = __getLastRunnerInputForTesting;
exports.needsCmdExe = needsCmdExe;
exports.resolveSpawnCommand = resolveSpawnCommand;
exports.escapeDoubleQuotes = escapeDoubleQuotes;
exports.buildCommandArgs = buildCommandArgs;
exports.buildCommand = buildCommand;
exports.truncateForLog = truncateForLog;
exports.buildErrorSuggestions = buildErrorSuggestions;
exports.runCodexCli = runCodexCli;
exports.formatCodexCliError = formatCodexCliError;
exports.formatCodexTimeoutError = formatCodexTimeoutError;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const node_child_process_1 = require("node:child_process");
const SAFE_ENV_KEYS = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "NODE_PATH",
    "NPM_CONFIG_PREFIX",
    "CODEX_CONFIG_DIR",
    "CODEX_STATE_DIR"
];
// Test seam: Playwright tests don't include a built-in module mocking system like Jest.
// This allows unit tests to replace the process runner without spawning real processes.
let spawnFn = node_child_process_1.spawn;
function __setSpawnForTesting(fn) {
    spawnFn = fn;
}
// Test seam for platform detection — lets unit tests simulate win32/linux.
let currentPlatform;
function __setPlatformForTesting(p) {
    currentPlatform = p;
}
let lastRunnerInput;
function __getLastRunnerInputForTesting() {
    return lastRunnerInput;
}
/**
 * Returns true when the command must be launched via cmd.exe on Windows.
 * .cmd / .bat files cannot be spawned directly by Node.js child_process.spawn on win32.
 * The platform parameter is a test seam (defaults to process.platform).
 */
function needsCmdExe(command, platform = currentPlatform ?? process.platform) {
    if (platform !== "win32")
        return false;
    return command.endsWith(".cmd") || command.endsWith(".bat");
}
/**
 * Resolves the platform-appropriate spawn command and arguments.
 * On Windows, .cmd/.bat files are executed through `cmd.exe /d /s /c`.
 * On other platforms the command is used directly.
 * The platform parameter is a test seam (defaults to process.platform).
 */
function resolveSpawnCommand(input, platform = currentPlatform ?? process.platform) {
    const displayCommand = buildCommand(input);
    const { command, args } = buildCommandArgs(input);
    if (needsCmdExe(command, platform)) {
        // /d — disable AutoRun, /s — strip outer quotes, /c — run and terminate
        const quotedCommand = command.includes(" ") ? `"${command}"` : command;
        return {
            spawnCommand: "cmd.exe",
            spawnArgs: ["/d", "/s", "/c", quotedCommand, ...args],
            displayCommand
        };
    }
    return {
        spawnCommand: command,
        spawnArgs: args,
        displayCommand
    };
}
function buildSafeEnv() {
    const safe = {};
    for (const key of SAFE_ENV_KEYS) {
        const value = process.env[key];
        if (value !== undefined) {
            safe[key] = value;
        }
    }
    return safe;
}
function escapeDoubleQuotes(s) {
    return s.replace(/"/g, '\\"');
}
function buildCommandArgs(input) {
    const hasJsonFlag = input.extraArgs.some(arg => arg === "--json");
    const extraArgs = hasJsonFlag ? [...input.extraArgs] : [...input.extraArgs, "--json"];
    const contextIsolationArgs = input.purpose === "spec_generation" || input.purpose === "scenario_generation"
        ? ["-c", "project_doc_max_bytes=0"]
        : [];
    // codex.cmd / codex -> "exec" "<prompt>"
    return {
        command: input.command,
        args: ["exec", ...contextIsolationArgs, ...extraArgs, input.prompt]
    };
}
// Back-compat helper used by tests and error formatting.
function buildCommand(input) {
    const commandPart = input.command.includes(" ") ? `"${escapeDoubleQuotes(input.command)}"` : input.command;
    const { args } = buildCommandArgs(input);
    const commandArgs = args.map((arg, index) => {
        if (index === args.length - 1) {
            return `"${escapeDoubleQuotes(arg)}"`;
        }
        return arg.includes(" ") ? `"${escapeDoubleQuotes(arg)}"` : arg;
    });
    const parts = [commandPart, ...commandArgs];
    return parts.join(" ");
}
function truncateForLog(text, maxLen = 500) {
    if (text.length <= maxLen)
        return text;
    return text.slice(0, maxLen) + `\n... [truncated, ${text.length - maxLen} more chars]`;
}
function buildErrorSuggestions(stderr, _command) {
    const suggestions = [];
    const lower = stderr.toLowerCase();
    if (lower.includes("trusted directory") || lower.includes("not inside a trusted")) {
        suggestions.push("Add --skip-git-repo-check to CODEX_CLI_EXTRA_ARGS.");
    }
    if (lower.includes("read-only") ||
        lower.includes("sandbox") ||
        lower.includes("cannot write") ||
        lower.includes("permission denied") ||
        lower.includes("eacces") ||
        lower.includes("eperm")) {
        suggestions.push("Add --sandbox workspace-write to CODEX_CLI_EXTRA_ARGS.");
    }
    if (lower.includes("not found") ||
        lower.includes("no such file") ||
        lower.includes("command not found") ||
        lower.includes("not recognized") ||
        lower.includes("is not a recognized")) {
        suggestions.push("If codex is not found, set CODEX_CLI_COMMAND to your codex.cmd path.");
    }
    return suggestions.length > 0 ? `\nSuggestions:\n${suggestions.map((s) => `  - ${s}`).join("\n")}` : "";
}
function ensureLogPath(p, fallbackDir, name) {
    if (p)
        return p;
    if (fallbackDir && name)
        return node_path_1.default.join(fallbackDir, name);
    return undefined;
}
function asObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return undefined;
    return value;
}
function readNumberField(obj, camelName, snakeName) {
    const value = obj[camelName] ?? obj[snakeName];
    if (typeof value !== "number" || !Number.isFinite(value))
        return 0;
    return Math.max(0, Math.floor(value));
}
function readStringField(obj, key) {
    const value = obj[key];
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
function extractAgentMessageText(item) {
    const direct = readStringField(item, "text")
        ?? readStringField(item, "output_text")
        ?? readStringField(item, "message");
    if (direct)
        return direct;
    const itemMessage = asObject(item.message);
    const messageContent = Array.isArray(itemMessage?.content) ? itemMessage.content : undefined;
    const itemContent = Array.isArray(item.content) ? item.content : undefined;
    const blocks = messageContent ?? itemContent;
    if (!blocks)
        return undefined;
    const parts = [];
    for (const block of blocks) {
        if (typeof block === "string") {
            if (block.trim().length > 0)
                parts.push(block);
            continue;
        }
        const blockObj = asObject(block);
        if (!blockObj)
            continue;
        const text = readStringField(blockObj, "text") ?? readStringField(blockObj, "content");
        if (text) {
            parts.push(text);
            continue;
        }
        if (Array.isArray(blockObj.content)) {
            for (const nested of blockObj.content) {
                const nestedObj = asObject(nested);
                const nestedText = nestedObj ? (readStringField(nestedObj, "text") ?? readStringField(nestedObj, "content")) : undefined;
                if (nestedText) {
                    parts.push(nestedText);
                }
            }
        }
    }
    if (parts.length === 0)
        return undefined;
    return parts.join("\n").trim() || undefined;
}
function parseCodexJsonl(stdout) {
    const state = {
        invalidJsonLines: 0,
        parsedJsonLines: 0
    };
    const lines = stdout.split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line)
            continue;
        try {
            const parsed = JSON.parse(line);
            state.parsedJsonLines += 1;
            if (parsed.type === "item.completed") {
                const item = asObject(parsed.item);
                if (item && readStringField(item, "type") === "agent_message") {
                    const text = extractAgentMessageText(item);
                    if (text) {
                        state.lastAgentMessage = text;
                    }
                }
            }
            else if (parsed.type === "turn.completed") {
                state.lastTurnCompleted = parsed;
            }
        }
        catch {
            state.invalidJsonLines += 1;
        }
    }
    return state;
}
function resolveModelFromArgs(extraArgs) {
    for (let i = 0; i < extraArgs.length; i += 1) {
        if ((extraArgs[i] === "--model" || extraArgs[i] === "-m") && typeof extraArgs[i + 1] === "string" && extraArgs[i + 1].trim()) {
            return extraArgs[i + 1].trim();
        }
    }
    return "unknown";
}
function buildUsageSnapshot(input, parsedJsonl, exitCode, timedOut, durationMs) {
    const turnObj = parsedJsonl.lastTurnCompleted ? asObject(parsedJsonl.lastTurnCompleted) : undefined;
    const usageObj = turnObj?.usage ? asObject(turnObj.usage) : undefined;
    const success = !timedOut && exitCode === 0;
    const modelFromTurn = turnObj ? readStringField(turnObj, "model") : undefined;
    const model = modelFromTurn ?? resolveModelFromArgs(input.extraArgs);
    const taskType = input.taskType ?? "unknown";
    const inputTokens = usageObj ? readNumberField(usageObj, "inputTokens", "input_tokens") : 0;
    const cachedInputTokens = usageObj ? readNumberField(usageObj, "cachedInputTokens", "cached_input_tokens") : 0;
    const cacheWriteInputTokens = usageObj ? readNumberField(usageObj, "cacheWriteInputTokens", "cache_write_input_tokens") : 0;
    const outputTokens = usageObj ? readNumberField(usageObj, "outputTokens", "output_tokens") : 0;
    const reasoningOutputTokens = usageObj ? readNumberField(usageObj, "reasoningOutputTokens", "reasoning_output_tokens") : 0;
    const nonCachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
    const totalPhysicalTokens = inputTokens + outputTokens;
    return {
        timestamp: new Date().toISOString(),
        provider: "codex_cli",
        model,
        taskType,
        inputTokens,
        cachedInputTokens,
        cacheWriteInputTokens,
        nonCachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalPhysicalTokens,
        durationMs,
        exitCode,
        success
    };
}
const CODEX_USAGE_METRICS_PATH = node_path_1.default.join(".artifacts", "metrics", "codex-usage.jsonl");
async function persistUsage(usage) {
    const metricsPath = node_path_1.default.join(process.cwd(), CODEX_USAGE_METRICS_PATH);
    await (0, promises_1.mkdir)(node_path_1.default.dirname(metricsPath), { recursive: true });
    await (0, promises_1.appendFile)(metricsPath, `${JSON.stringify(usage)}\n`, "utf-8");
}
function logUsageLine(usage, usageUnavailable) {
    console.log(`[codex-cli:usage] model=${usage.model} taskType=${usage.taskType} ` +
        `input=${usage.inputTokens} cached=${usage.cachedInputTokens} cacheWrite=${usage.cacheWriteInputTokens} ` +
        `nonCached=${usage.nonCachedInputTokens} output=${usage.outputTokens} reasoning=${usage.reasoningOutputTokens} ` +
        `total=${usage.totalPhysicalTokens} durationMs=${usage.durationMs} exitCode=${usage.exitCode} success=${usage.success}` +
        (usageUnavailable ? " usageUnavailable=true" : ""));
}
async function runCodexCli(input) {
    lastRunnerInput = { ...input };
    const resolved = resolveSpawnCommand(input);
    if (input.purpose === "spec_generation" || input.purpose === "scenario_generation") {
        console.log(`[codex-context-policy] purpose=${input.purpose} projectDocMaxBytes=0`);
    }
    const cwd = input.cwd;
    const timeoutMs = input.timeoutMs;
    const startedAt = Date.now();
    const heartbeatMs = input.heartbeatMs ?? 15000;
    const handoffDir = input.handoffDir;
    const attempt = input.attempt;
    const stdoutLogPath = ensureLogPath(input.stdoutLogPath, handoffDir, "codex.stdout.log");
    const stderrLogPath = ensureLogPath(input.stderrLogPath, handoffDir, "codex.stderr.log");
    if (input.showAgentLog) {
        console.log(`[codex-runner] taskType=${input.taskType ?? "unknown"} purpose=${input.purpose ?? "unknown"}`);
        console.log(`[codex-cli] displayCommand: ${resolved.displayCommand}`);
        console.log(`[codex-cli] spawnCommand: ${resolved.spawnCommand} ${resolved.spawnArgs.join(" ")}`);
        console.log(`[codex-cli] cwd: ${cwd}`);
        console.log(`[codex-cli] timeoutMs: ${timeoutMs}`);
        if (stdoutLogPath)
            console.log(`[codex-cli] stdoutLog: ${stdoutLogPath}`);
        if (stderrLogPath)
            console.log(`[codex-cli] stderrLog: ${stderrLogPath}`);
    }
    return await new Promise((resolve) => {
        const spawnOptions = {
            cwd,
            env: buildSafeEnv()
        };
        const child = spawnFn(resolved.spawnCommand, resolved.spawnArgs, { ...spawnOptions, stdio: ["ignore", "pipe", "pipe"] });
        let stdoutBuf = "";
        let stderrBuf = "";
        let settled = false;
        let lastOutputAt = Date.now();
        const stdoutStream = stdoutLogPath ? node_fs_1.default.createWriteStream(stdoutLogPath, { flags: "a" }) : undefined;
        const stderrStream = stderrLogPath ? node_fs_1.default.createWriteStream(stderrLogPath, { flags: "a" }) : undefined;
        const heartbeatTimer = setInterval(() => {
            const now = Date.now();
            if (now - lastOutputAt >= heartbeatMs) {
                const elapsedMs = now - startedAt;
                const prefix = attempt ? `[codex-cli] attempt ${attempt}` : "[codex-cli]";
                const out = stdoutLogPath ? ` stdoutLog=${stdoutLogPath}` : "";
                const err = stderrLogPath ? ` stderrLog=${stderrLogPath}` : "";
                console.log(`${prefix} Codex still running... elapsedMs=${elapsedMs} timeoutMs=${timeoutMs}${out}${err}`);
                lastOutputAt = now; // avoid spamming in case of totally quiet process
            }
        }, Math.max(50, Math.min(heartbeatMs, 1000)));
        const timeoutTimer = setTimeout(() => {
            if (!settled) {
                settled = true;
                child.kill("SIGTERM");
                cleanup();
                const durationMs = Date.now() - startedAt;
                resolve({
                    exitCode: -1,
                    stdout: stdoutBuf,
                    stderr: stderrBuf,
                    timedOut: true,
                    durationMs,
                    stdoutLogPath,
                    stderrLogPath
                });
            }
        }, timeoutMs);
        const cleanup = () => {
            clearTimeout(timeoutTimer);
            clearInterval(heartbeatTimer);
            try {
                stdoutStream?.end();
            }
            catch { }
            try {
                stderrStream?.end();
            }
            catch { }
        };
        child.stdout.on("data", (chunk) => {
            const s = String(chunk);
            stdoutBuf += s;
            lastOutputAt = Date.now();
            stdoutStream?.write(s);
        });
        child.stderr.on("data", (chunk) => {
            const s = String(chunk);
            stderrBuf += s;
            lastOutputAt = Date.now();
            stderrStream?.write(s);
        });
        child.on("close", (code, signal) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            const durationMs = Date.now() - startedAt;
            resolve({
                exitCode: code ?? 1,
                stdout: stdoutBuf,
                stderr: stderrBuf,
                timedOut: false,
                signal: signal ?? undefined,
                durationMs,
                stdoutLogPath,
                stderrLogPath
            });
        });
        child.on("error", (err) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            const durationMs = Date.now() - startedAt;
            resolve({
                exitCode: 1,
                stdout: stdoutBuf,
                stderr: `${stderrBuf}\n${err.message}`,
                timedOut: false,
                durationMs,
                stdoutLogPath,
                stderrLogPath
            });
        });
    }).then(async (rawResult) => {
        const parsedJsonl = parseCodexJsonl(rawResult.stdout);
        if (parsedJsonl.invalidJsonLines > 0 && parsedJsonl.parsedJsonLines > 0) {
            console.log(`[codex-cli] jsonl_parse_warning invalidLines=${parsedJsonl.invalidJsonLines}`);
        }
        const usage = buildUsageSnapshot(input, parsedJsonl, rawResult.exitCode, rawResult.timedOut, rawResult.durationMs);
        const usageUnavailable = !parsedJsonl.lastTurnCompleted?.usage;
        logUsageLine(usage, usageUnavailable);
        try {
            await persistUsage(usage);
        }
        catch {
            console.log("[codex-cli] usage_metrics_persist_failed");
        }
        const stdout = parsedJsonl.lastAgentMessage ?? rawResult.stdout;
        return {
            ...rawResult,
            stdout,
            usage: usageUnavailable ? undefined : usage
        };
    });
}
function formatCodexCliError(result, input) {
    const suggestions = buildErrorSuggestions(result.stderr);
    const command = buildCommand(input);
    const parts = [];
    parts.push(`Codex CLI exited with code ${result.exitCode}.`);
    parts.push(`Command: ${command.slice(0, 120)}...`);
    parts.push(`Cwd: ${input.cwd}`);
    parts.push(`DurationMs: ${result.durationMs}`);
    if (result.signal) {
        parts.push(`Signal: ${result.signal}`);
    }
    if (result.stdoutLogPath) {
        parts.push(`Stdout log: ${result.stdoutLogPath}`);
    }
    if (result.stderrLogPath) {
        parts.push(`Stderr log: ${result.stderrLogPath}`);
    }
    const stdoutSafe = truncateForLog(result.stdout.trim());
    if (stdoutSafe) {
        parts.push(`Stdout:\n${stdoutSafe}`);
    }
    const stderrSafe = truncateForLog(result.stderr.trim());
    if (stderrSafe) {
        parts.push(`Stderr:\n${stderrSafe}`);
    }
    if (suggestions) {
        parts.push(suggestions);
    }
    return parts.join("\n\n");
}
function formatCodexTimeoutError(input, handoffDir, responsePath) {
    const timeoutMinutes = (input.timeoutMs / 60000).toFixed(1);
    const recommendedMs = Math.max(input.timeoutMs * 2, 1800000);
    const recommendedMinutes = (recommendedMs / 60000).toFixed(0);
    const parts = [];
    parts.push(`Codex CLI timed out after ${timeoutMinutes} minutes (timeoutMs: ${input.timeoutMs}).`);
    parts.push(`Cwd: ${input.cwd}`);
    parts.push(`Handoff directory: ${handoffDir}`);
    parts.push(`Expected response path: ${responsePath}`);
    if (input.stdoutLogPath)
        parts.push(`Stdout log: ${input.stdoutLogPath}`);
    if (input.stderrLogPath)
        parts.push(`Stderr log: ${input.stderrLogPath}`);
    parts.push(``);
    parts.push(`Suggestions:`);
    parts.push(`  - Increase AGENT_AUTO_REPAIR_TIMEOUT_MS / CODEX_AUTO_REPAIR_TIMEOUT_MS (current: ${input.timeoutMs}ms, recommended: ${recommendedMs}ms / ${recommendedMinutes} min)`);
    parts.push(`  - Run manually:`);
    parts.push(`    ${buildCommand(input).slice(0, 120)}...`);
    parts.push(`  - Check handoff files in: ${handoffDir}`);
    parts.push(`  - After manual repair, run: npm run agent:validate`);
    return parts.join("\n");
}
