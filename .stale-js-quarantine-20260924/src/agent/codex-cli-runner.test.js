"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_events_1 = require("node:events");
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const promises_1 = require("node:fs/promises");
const node_child_process_1 = require("node:child_process");
const codex_cli_runner_1 = require("./codex-cli-runner");
const tests = [];
function test(label, fn) { tests.push({ label, fn }); }
function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}
class FakeChildProcess extends node_events_1.EventEmitter {
    stdout = new node_events_1.EventEmitter();
    stderr = new node_events_1.EventEmitter();
    kill(_signal) {
        this.emit("close", null, "SIGTERM");
        return true;
    }
}
function installSpawnPlan(plan) {
    (0, codex_cli_runner_1.__setSpawnForTesting)((() => {
        const child = new FakeChildProcess();
        setTimeout(() => {
            for (const line of plan.stdoutLines) {
                child.stdout.emit("data", `${line}\n`);
            }
            for (const line of plan.stderrLines ?? []) {
                child.stderr.emit("data", `${line}\n`);
            }
            child.emit("close", plan.exitCode ?? 0, plan.signal ?? null);
        }, 0);
        return child;
    }));
}
async function withTempCwd(fn) {
    const originalCwd = process.cwd();
    const tempDir = await (0, promises_1.mkdtemp)(node_path_1.default.join(node_os_1.default.tmpdir(), "codex-cli-runner-test-"));
    process.chdir(tempDir);
    try {
        await fn(tempDir);
    }
    finally {
        process.chdir(originalCwd);
        await (0, promises_1.rm)(tempDir, { recursive: true, force: true });
    }
}
function readLastJsonlLine(content) {
    const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    node_assert_1.default.ok(lines.length > 0, "metrics file should contain at least one line");
    return JSON.parse(lines[lines.length - 1]);
}
describe("runCodexCli usage instrumentation", () => {
    test("parses turn.completed usage, keeps last agent_message, and persists JSONL", async () => {
        await withTempCwd(async (cwd) => {
            installSpawnPlan({
                stdoutLines: [
                    JSON.stringify({ type: "item.completed", item: { type: "agent_message", content: [{ type: "output_text", text: "first draft" }] } }),
                    JSON.stringify({ type: "item.completed", item: { type: "agent_message", content: [{ type: "output_text", text: "final answer" }] } }),
                    JSON.stringify({
                        type: "turn.completed",
                        model: "gpt-5.4",
                        usage: {
                            inputTokens: 120,
                            cachedInputTokens: 20,
                            cacheWriteInputTokens: 7,
                            outputTokens: 40,
                            reasoningOutputTokens: 9
                        }
                    })
                ]
            });
            const result = await (0, codex_cli_runner_1.runCodexCli)({
                command: "codex",
                extraArgs: ["--model", "gpt-5.4"],
                prompt: "safe prompt",
                cwd,
                timeoutMs: 5000,
                taskType: "generation"
            });
            node_assert_1.default.strictEqual(result.exitCode, 0);
            node_assert_1.default.strictEqual(result.stdout, "final answer");
            node_assert_1.default.ok(result.usage, "usage should be present when turn.completed is emitted");
            node_assert_1.default.strictEqual(result.usage?.inputTokens, 120);
            node_assert_1.default.strictEqual(result.usage?.cachedInputTokens, 20);
            node_assert_1.default.strictEqual(result.usage?.cacheWriteInputTokens, 7);
            node_assert_1.default.strictEqual(result.usage?.nonCachedInputTokens, 100);
            node_assert_1.default.strictEqual(result.usage?.outputTokens, 40);
            node_assert_1.default.strictEqual(result.usage?.reasoningOutputTokens, 9);
            node_assert_1.default.strictEqual(result.usage?.totalPhysicalTokens, 160, "reasoningOutputTokens must not be re-added");
            const metricsPath = node_path_1.default.join(cwd, ".artifacts", "metrics", "codex-usage.jsonl");
            const metricsContent = await (0, promises_1.readFile)(metricsPath, "utf-8");
            const record = readLastJsonlLine(metricsContent);
            node_assert_1.default.strictEqual(record.provider, "codex_cli");
            node_assert_1.default.strictEqual(record.model, "gpt-5.4");
            node_assert_1.default.strictEqual(record.taskType, "generation");
            node_assert_1.default.strictEqual(record.nonCachedInputTokens, 100);
            node_assert_1.default.strictEqual(record.totalPhysicalTokens, 160);
            node_assert_1.default.strictEqual(record.success, true);
        });
    });
    test("missing usage does not break response and keeps compatibility", async () => {
        await withTempCwd(async (cwd) => {
            installSpawnPlan({
                stdoutLines: [
                    JSON.stringify({ type: "item.completed", item: { type: "agent_message", content: [{ text: "{\"ok\":true}" }] } })
                ]
            });
            const result = await (0, codex_cli_runner_1.runCodexCli)({
                command: "codex",
                extraArgs: [],
                prompt: "prompt",
                cwd,
                timeoutMs: 5000
            });
            node_assert_1.default.strictEqual(result.exitCode, 0);
            node_assert_1.default.strictEqual(result.stdout, "{\"ok\":true}");
            node_assert_1.default.strictEqual(result.usage, undefined, "usage should remain optional when unavailable");
            const metricsPath = node_path_1.default.join(cwd, ".artifacts", "metrics", "codex-usage.jsonl");
            const metricsContent = await (0, promises_1.readFile)(metricsPath, "utf-8");
            const record = readLastJsonlLine(metricsContent);
            node_assert_1.default.strictEqual(record.taskType, "unknown");
            node_assert_1.default.strictEqual(record.inputTokens, 0);
            node_assert_1.default.strictEqual(record.outputTokens, 0);
            node_assert_1.default.strictEqual(record.success, true);
        });
    });
    test("invalid JSONL line is tolerated without leaking prompt content", async () => {
        await withTempCwd(async (cwd) => {
            const logs = [];
            const originalLog = console.log;
            console.log = (...args) => {
                logs.push(args.map(arg => String(arg)).join(" "));
            };
            try {
                installSpawnPlan({
                    stdoutLines: [
                        "NOT_JSON_LINE",
                        JSON.stringify({ type: "item.completed", item: { type: "agent_message", content: [{ text: "safe result" }] } })
                    ]
                });
                const result = await (0, codex_cli_runner_1.runCodexCli)({
                    command: "codex",
                    extraArgs: ["--model", "gpt-5.3-codex"],
                    prompt: "very-secret-prompt-123",
                    cwd,
                    timeoutMs: 5000,
                    taskType: "repair"
                });
                node_assert_1.default.strictEqual(result.exitCode, 0);
                node_assert_1.default.strictEqual(result.stdout, "safe result");
                node_assert_1.default.ok(!logs.join("\n").includes("very-secret-prompt-123"), "logs must not contain prompt content");
            }
            finally {
                console.log = originalLog;
            }
        });
    });
});
void (async () => {
    try {
        for (const t of tests) {
            try {
                await t.fn();
                console.log(`  PASS  ${t.label}`);
            }
            catch (err) {
                console.error(`  FAIL  ${t.label}: ${err instanceof Error ? err.message : String(err)}`);
                process.exitCode = 1;
            }
        }
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(node_child_process_1.spawn);
    }
})();
