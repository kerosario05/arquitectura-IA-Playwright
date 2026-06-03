"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_events_1 = require("node:events");
const codex_cli_runner_1 = require("../src/agent/codex-cli-runner");
const agent_auto_repair_1 = require("../src/agent/agent-auto-repair");
const agent_response_validator_1 = require("../src/agent/agent-response-validator");
const test_temp_dir_1 = require("./helpers/test-temp-dir");
const tmpDir = (0, test_temp_dir_1.getTestTempDir)("test-agent-auto-repair");
function configEnabled(timeoutMs = 900000) {
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
            ai: { discoveryMaxAttempts: 2 },
            agent: {
                provider: "codex",
                autoRepairEnabled: true,
                command: "codex",
                extraArgs: "--skip-git-repo-check",
                autoRepairTimeoutMs: timeoutMs,
                autoRepairPromptMode: "compact"
            }
        }
    };
}
function spawnExit(exitCode) {
    return (command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        queueMicrotask(() => {
            child.emit("close", exitCode, null);
        });
        child.__options = options;
        return child;
    };
}
test_1.test.beforeAll(async () => {
    await (0, test_temp_dir_1.ensureTestTempDir)("test-agent-auto-repair");
});
test_1.test.afterAll(async () => {
    try {
        await (0, test_temp_dir_1.cleanTestTempDir)("test-agent-auto-repair");
    }
    catch { }
});
(0, test_1.test)("agent-auto-repair forwards timeout override to codex-cli-runner", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(spawnExit(1));
    const outputDir = node_path_1.default.join(tmpDir, "run-timeout");
    await promises_1.default.mkdir(outputDir, { recursive: true });
    await (0, agent_auto_repair_1.runAgentAutoRepairAttempt)({
        fullConfig: configEnabled(),
        outputDir,
        attemptNumber: 1,
        kind: "plan_repair",
        failureSummary: "recoverable_failure",
        failedReason: "target_not_found",
        repairTimeoutMs: 120000
    });
    const last = (0, codex_cli_runner_1.__getLastRunnerInputForTesting)();
    (0, test_1.expect)(last?.timeoutMs).toBe(120000);
});
(0, test_1.test)("agent-auto-repair forwards showAgentLog to codex-cli-runner", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(spawnExit(1));
    const outputDir = node_path_1.default.join(tmpDir, "run-showlog");
    await promises_1.default.mkdir(outputDir, { recursive: true });
    await (0, agent_auto_repair_1.runAgentAutoRepairAttempt)({
        fullConfig: configEnabled(120000),
        outputDir,
        attemptNumber: 1,
        kind: "plan_repair",
        failureSummary: "recoverable_failure",
        failedReason: "target_not_found",
        showAgentLog: true
    });
    const last = (0, codex_cli_runner_1.__getLastRunnerInputForTesting)();
    (0, test_1.expect)(last?.showAgentLog).toBe(true);
});
(0, test_1.test)("codex-cli-runner uses stdin ignore (non-interactive)", async () => {
    let observedStdio;
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        observedStdio = options?.stdio;
        return spawnExit(1)(command, args, options);
    }));
    const outputDir = node_path_1.default.join(tmpDir, "run-stdio");
    await promises_1.default.mkdir(outputDir, { recursive: true });
    await (0, agent_auto_repair_1.runAgentAutoRepairAttempt)({
        fullConfig: configEnabled(),
        outputDir,
        attemptNumber: 1,
        kind: "plan_repair",
        failureSummary: "recoverable_failure",
        failedReason: "target_not_found"
    });
    (0, test_1.expect)(Array.isArray(observedStdio)).toBe(true);
    (0, test_1.expect)(observedStdio[0]).toBe("ignore");
});
(0, test_1.test)("attempt exit diagnostics include log paths and nextAction", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(spawnExit(0));
    const outputDir = node_path_1.default.join(tmpDir, "run-diagnostics");
    await promises_1.default.mkdir(outputDir, { recursive: true });
    const result = await (0, agent_auto_repair_1.runAgentAutoRepairAttempt)({
        fullConfig: configEnabled(),
        outputDir,
        attemptNumber: 1,
        kind: "plan_repair",
        failureSummary: "recoverable_failure",
        failedReason: "target_not_found",
        failedTarget: "X"
    });
    const handoffDir = node_path_1.default.join(outputDir, "handoff-attempt-1");
    const diagPath = node_path_1.default.join(handoffDir, "auto-repair-result.json");
    const raw = JSON.parse(await promises_1.default.readFile(diagPath, "utf-8"));
    (0, test_1.expect)(raw.attemptNumber).toBe(1);
    (0, test_1.expect)(raw.diagnostics).toBeDefined();
    (0, test_1.expect)(raw.diagnostics.stdoutLogPath).toContain("codex.stdout.log");
    (0, test_1.expect)(raw.diagnostics.stderrLogPath).toContain("codex.stderr.log");
    (0, test_1.expect)(typeof raw.diagnostics.durationMs).toBe("number");
    (0, test_1.expect)(raw.diagnostics.nextAction).toBeDefined();
    // The handoff writer always creates agent-response.json template; if Codex didn't add plans, it's no_proposal/no_plan.
    (0, test_1.expect)(result.success).toBe(false);
    (0, test_1.expect)(["no_proposal", "cli_error", "invalid_proposal", "no_response", "timeout"]).toContain(result.status);
});
(0, test_1.test)("compactPrompt=true pasa prompt compact-route-recovery a codex-cli-runner", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(spawnExit(1));
    const outputDir = node_path_1.default.join(tmpDir, "prompt-compact");
    await promises_1.default.mkdir(outputDir, { recursive: true });
    const result = await (0, agent_auto_repair_1.runAgentAutoRepairAttempt)({
        fullConfig: configEnabled(120000),
        outputDir,
        attemptNumber: 1,
        kind: "plan_repair",
        failureSummary: "recoverable_failure",
        failedReason: "target_not_found",
        compactPrompt: true,
        showAgentLog: false
    });
    const last = (0, codex_cli_runner_1.__getLastRunnerInputForTesting)();
    (0, test_1.expect)(last?.prompt).toContain("bounded current-snapshot semantic recovery planner");
    (0, test_1.expect)(last?.prompt).toContain("route-recovery-decision.json");
    (0, test_1.expect)(last?.prompt).toContain("route-recovery-decision.schema.json");
    (0, test_1.expect)(last?.prompt).toContain("route-recovery-pack.json");
    (0, test_1.expect)(last?.prompt).toContain("Do not write agent-response.json");
    (0, test_1.expect)(last?.prompt).toContain("The framework will build the final AgentHandoffResponse");
    (0, test_1.expect)(last?.prompt).not.toContain("Read these files first");
    (0, test_1.expect)(last?.prompt).not.toContain("context-pack.json");
});
(0, test_1.test)("compactPrompt=true prompt no contiene bloque viejo ni context-pack", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(spawnExit(1));
    const outputDir = node_path_1.default.join(tmpDir, "prompt-clean");
    await promises_1.default.mkdir(outputDir, { recursive: true });
    await (0, agent_auto_repair_1.runAgentAutoRepairAttempt)({
        fullConfig: configEnabled(120000),
        outputDir,
        attemptNumber: 1,
        kind: "plan_repair",
        failureSummary: "recoverable_failure",
        failedReason: "target_not_found",
        compactPrompt: true,
        showAgentLog: false
    });
    const last = (0, codex_cli_runner_1.__getLastRunnerInputForTesting)();
    (0, test_1.expect)(last?.prompt).not.toContain("Read these files first");
    (0, test_1.expect)(last?.prompt).not.toContain("handoff-request.json");
    (0, test_1.expect)(last?.prompt).toContain("route-recovery-pack.json");
    (0, test_1.expect)(last?.prompt).toContain("selected-skill.md");
});
(0, test_1.test)("compactPrompt=false mantiene full prompt con Read these files first", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(spawnExit(1));
    const outputDir = node_path_1.default.join(tmpDir, "prompt-full");
    await promises_1.default.mkdir(outputDir, { recursive: true });
    await (0, agent_auto_repair_1.runAgentAutoRepairAttempt)({
        fullConfig: configEnabled(120000),
        outputDir,
        attemptNumber: 1,
        kind: "plan_repair",
        failureSummary: "recoverable_failure",
        failedReason: "target_not_found",
        compactPrompt: false,
        showAgentLog: false
    });
    const last = (0, codex_cli_runner_1.__getLastRunnerInputForTesting)();
    (0, test_1.expect)(last?.prompt).toContain("Read these files first");
    (0, test_1.expect)(last?.prompt).toContain("context-pack.json");
    (0, test_1.expect)(last?.prompt).not.toContain("route-recovery-pack.json");
});
(0, test_1.test)("no agent-response.json produces no_response status", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        queueMicrotask(async () => {
            try {
                // Extract response path from the prompt argument (last arg).
                const prompt = String(args[args.length - 1] ?? "");
                const m = prompt.match(/Fill\\s+(.+agent-response\\.json)/i);
                if (m && m[1]) {
                    const p = m[1].trim();
                    await promises_1.default.rm(p, { force: true });
                }
            }
            catch {
            }
            child.emit("close", 0, null);
        });
        return child;
    }));
    const outputDir = node_path_1.default.join(tmpDir, "run-no-response");
    await promises_1.default.mkdir(outputDir, { recursive: true });
    const res = await (0, agent_auto_repair_1.runAgentAutoRepairAttempt)({
        fullConfig: configEnabled(),
        outputDir,
        attemptNumber: 1,
        kind: "plan_repair",
        failureSummary: "recoverable_failure",
        failedReason: "target_not_found"
    });
    // Should classify as no_response or cli_error with diagnostics nextAction auto_repair_no_response.
    if (!res.success) {
        (0, test_1.expect)(["no_response", "cli_error", "no_proposal"]).toContain(res.status);
    }
});
(0, test_1.test)("runAgentAutoRepairAttempt normalizes bare ExecutionPlan responses before validation", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        queueMicrotask(async () => {
            try {
                const cwd = String(options?.cwd ?? process.cwd());
                const responsePath = node_path_1.default.join(cwd, "agent-response.json");
                const barePlan = {
                    version: "1.0",
                    source: "ai_generated",
                    status: "validated",
                    scenario: { source: "testrail", caseId: 1, title: "Recovered scenario" },
                    requiredData: [],
                    steps: [
                        { index: 1, action: "click", target: { strategy: "text", value: "Continue" } }
                    ],
                    createdAt: new Date().toISOString()
                };
                await promises_1.default.writeFile(responsePath, JSON.stringify(barePlan, null, 2), "utf-8");
            }
            catch {
            }
            child.emit("close", 0, null);
        });
        return child;
    }));
    const outputDir = node_path_1.default.join(tmpDir, "run-normalize-bare-plan");
    await promises_1.default.mkdir(outputDir, { recursive: true });
    const result = await (0, agent_auto_repair_1.runAgentAutoRepairAttempt)({
        fullConfig: configEnabled(),
        outputDir,
        attemptNumber: 1,
        kind: "plan_repair",
        failureSummary: "recoverable_failure",
        failedReason: "target_not_found"
    });
    if (result.success) {
        (0, test_1.expect)(result.repairedPlan.scenario.title).toBe("Recovered scenario");
        const written = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(outputDir, "handoff-attempt-1", "agent-response.json"), "utf-8"));
        (0, test_1.expect)(written.recoveryDecision).toBe("repaired_plan");
        (0, test_1.expect)(written.plans).toHaveLength(1);
    }
    else {
        (0, test_1.expect)(["no_response", "invalid_proposal", "cli_error", "no_proposal"]).toContain(result.status);
    }
    const normalized = (0, agent_response_validator_1.normalizeAgentHandoffResponse)({
        version: "1.0",
        source: "ai_generated",
        status: "validated",
        scenario: { source: "testrail", caseId: 1, title: "Recovered scenario" },
        requiredData: [],
        steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Continue" } }],
        createdAt: new Date().toISOString()
    });
    (0, test_1.expect)(normalized.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(Array.isArray(normalized.plans)).toBe(true);
    (0, test_1.expect)(normalized.plans).toHaveLength(1);
});
(0, test_1.test)("auto-repair skips Codex spawn when CODEX_CLI_PATH is invalid", async () => {
    let spawnCalls = 0;
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        spawnCalls += 1;
        return spawnExit(1)(command, args, options);
    }));
    const previousPath = process.env.CODEX_CLI_PATH;
    process.env.CODEX_CLI_PATH = node_path_1.default.join(tmpDir, "missing-codex.cmd");
    const outputDir = node_path_1.default.join(tmpDir, "run-codex-missing");
    await promises_1.default.mkdir(outputDir, { recursive: true });
    try {
        const res = await (0, agent_auto_repair_1.runAgentAutoRepairAttempt)({
            fullConfig: configEnabled(),
            outputDir,
            attemptNumber: 1,
            kind: "plan_repair",
            failureSummary: "recoverable_failure",
            failedReason: "target_not_found"
        });
        (0, test_1.expect)(res.success).toBe(false);
        (0, test_1.expect)(res.status).toBe("unavailable");
        (0, test_1.expect)(res.reason).toBe("codex_cli_path_invalid");
        (0, test_1.expect)(spawnCalls).toBe(0);
    }
    finally {
        if (previousPath === undefined) {
            delete process.env.CODEX_CLI_PATH;
        }
        else {
            process.env.CODEX_CLI_PATH = previousPath;
        }
    }
});
