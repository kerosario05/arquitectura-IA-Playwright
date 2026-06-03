"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const codex_cli_runner_1 = require("../src/agent/codex-cli-runner");
const agent_auto_repair_1 = require("../src/agent/agent-auto-repair");
const node_events_1 = require("node:events");
const test_temp_dir_1 = require("./helpers/test-temp-dir");
const tmpDir = (0, test_temp_dir_1.getTestTempDir)("test-agent-auto-repair-context-pack");
function mockSpawnExit(input) {
    const fn = (command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        queueMicrotask(() => {
            if (input.stdout)
                child.stdout.emit("data", input.stdout);
            if (input.stderr)
                child.stderr.emit("data", input.stderr);
            child.emit("close", input.exitCode, null);
        });
        return child;
    };
    return fn;
}
function configWithAgentEnabled() {
    return {
        app: {
            baseUrl: "https://example.com",
            loginMode: "no_login",
            testData: {},
            testDataAliases: {},
            missingInputBehavior: "fail",
            appProfile: "default"
        },
        execution: {
            browser: "chromium",
            headless: true,
            evidenceDir: "evidence",
            defaultTimeoutMs: 30000
        },
        integrations: {
            ai: { discoveryMaxAttempts: 1 },
            agent: {
                provider: "codex",
                autoRepairEnabled: true,
                command: "codex",
                extraArgs: "--skip-git-repo-check",
                autoRepairTimeoutMs: 1000,
                autoRepairPromptMode: "compact"
            }
        }
    };
}
test_1.test.beforeAll(async () => {
    await (0, test_temp_dir_1.ensureTestTempDir)("test-agent-auto-repair-context-pack");
});
test_1.test.afterAll(async () => {
    try {
        await (0, test_temp_dir_1.cleanTestTempDir)("test-agent-auto-repair-context-pack");
    }
    catch {
    }
});
(0, test_1.test)("auto-repair creates context-pack.json and request references it", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 1, stderr: "mock failure" }));
    const outputDir = node_path_1.default.join(tmpDir, "run1");
    await promises_1.default.mkdir(outputDir, { recursive: true });
    const result = await (0, agent_auto_repair_1.runAgentAutoRepairAttempt)({
        fullConfig: configWithAgentEnabled(),
        outputDir,
        attemptNumber: 1,
        kind: "plan_repair",
        failureSummary: "target_not_found",
        failedReason: "target_not_found",
        failedTarget: "Continue",
        failedAtStep: 1
    });
    const handoffDir = node_path_1.default.join(outputDir, "handoff-attempt-1");
    const contextPath = node_path_1.default.join(handoffDir, "context-pack.json");
    const requestPath = node_path_1.default.join(handoffDir, "handoff-request.json");
    const contextExists = await promises_1.default.stat(contextPath).then(() => true).catch(() => false);
    (0, test_1.expect)(contextExists).toBe(true);
    const req = await promises_1.default.readFile(requestPath, "utf-8");
    (0, test_1.expect)(req).toContain("contextPackPath");
    (0, test_1.expect)(req).toContain("context-pack.json");
    (0, test_1.expect)(result.attempted).toBe(true);
});
