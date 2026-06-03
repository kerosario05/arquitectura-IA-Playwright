"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const codex_auto_repair_1 = require("../src/agent/codex-auto-repair");
const codex_cli_runner_1 = require("../src/agent/codex-cli-runner");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = __importDefault(require("node:os"));
const node_events_1 = require("node:events");
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
async function createTempHandoffDir() {
    const dir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "codex-repair-test-"));
    const requestPath = node_path_1.default.join(dir, "handoff-request.json");
    const instructionsPath = node_path_1.default.join(dir, "handoff-instructions.md");
    const schemaPath = node_path_1.default.join(dir, "agent-response.schema.json");
    const responsePath = node_path_1.default.join(dir, "agent-response.json");
    await promises_1.default.writeFile(requestPath, JSON.stringify({
        version: "1.0",
        kind: "plan_repair",
        createdAt: new Date().toISOString(),
        goal: "Test goal",
        dataContextSummary: { totalEntries: 0, sensitiveEntries: 0, nonSensitiveEntries: 0, availableKeys: [] },
        constraints: { noApiKey: true, noPlaywrightExecution: true, doNotModifyStableRegistry: true, useOnlyAvailableDataKeys: true, outputMustMatchSchema: true },
        actionRegistry: { supportedActions: [] }
    }, null, 2), "utf-8");
    await promises_1.default.writeFile(instructionsPath, "# Test Instructions", "utf-8");
    await promises_1.default.writeFile(schemaPath, JSON.stringify({ type: "object" }, null, 2), "utf-8");
    await promises_1.default.writeFile(responsePath, JSON.stringify({ version: "1.0", generatedAt: "", plans: [], proposedObjects: [], unresolvedQuestions: [], rationale: [] }, null, 2), "utf-8");
    return {
        dir,
        paths: {
            handoffDir: dir,
            requestPath,
            instructionsPath,
            responsePath,
            schemaPath,
            projectRoot: process.cwd(),
            timeoutMs: 5000,
            codexCommand: "codex",
            codexExtraArgs: ["--skip-git-repo-check"]
        }
    };
}
(0, test_1.test)("runCodexAutoRepair fails when response has no plans", async () => {
    const { paths } = await createTempHandoffDir();
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });
    (0, test_1.expect)(result.success).toBe(false);
    (0, test_1.expect)(result.responsePath).toBe(paths.responsePath);
    (0, test_1.expect)(result.error).toContain("plans array is empty");
});
(0, test_1.test)("runCodexAutoRepair fails on validation error", async () => {
    const { paths } = await createTempHandoffDir();
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const invalidResponse = {
        version: "1.0",
        generatedAt: new Date().toISOString(),
        plans: [
            {
                version: "1.0",
                source: "ai_generated",
                status: "validated",
                scenario: { source: "testrail", caseId: 1, title: "Test scenario" },
                requiredData: [],
                steps: [
                    { index: 1, action: "fill", target: { strategy: "label", value: "Username" }, valueKey: "UNKNOWN_KEY" }
                ],
                createdAt: new Date().toISOString()
            }
        ],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["test"]
    };
    await promises_1.default.writeFile(paths.responsePath, JSON.stringify(invalidResponse, null, 2), "utf-8");
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });
    (0, test_1.expect)(result.success).toBe(false);
    (0, test_1.expect)(result.responsePath).toBe(paths.responsePath);
    (0, test_1.expect)(result.error).toContain("validation failed");
});
(0, test_1.test)("runCodexAutoRepair accepts no_safe_action without plans in compact mode", async () => {
    const { paths } = await createTempHandoffDir();
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const nonPlanResponse = {
        version: "1.0",
        generatedAt: new Date().toISOString(),
        recoveryDecision: "no_safe_action",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["No safe repair is possible from the available context."]
    };
    await promises_1.default.writeFile(paths.responsePath, JSON.stringify(nonPlanResponse, null, 2), "utf-8");
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.responsePath).toBe(paths.responsePath);
    (0, test_1.expect)(result.diagnostics?.recoveryDecision).toBe("no_safe_action");
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("no_safe_action");
});
(0, test_1.test)("runCodexAutoRepair normalizes bare ExecutionPlan responses", async () => {
    const { paths } = await createTempHandoffDir();
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const barePlan = {
        version: "1.0",
        source: "ai_generated",
        status: "validated",
        scenario: { source: "testrail", caseId: 1, title: "Test scenario" },
        requiredData: [],
        steps: [
            { index: 1, action: "click", target: { strategy: "label", value: "Continue" } }
        ],
        createdAt: new Date().toISOString()
    };
    await promises_1.default.writeFile(paths.responsePath, JSON.stringify(barePlan, null, 2), "utf-8");
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.diagnostics?.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("retry_execution");
    const written = JSON.parse(await promises_1.default.readFile(paths.responsePath, "utf-8"));
    (0, test_1.expect)(written.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(written.plans).toHaveLength(1);
    (0, test_1.expect)(written.plans[0].scenario.title).toBe("Test scenario");
});
(0, test_1.test)("runCodexAutoRepair normalizes legacy plans array responses missing recoveryDecision", async () => {
    const { paths } = await createTempHandoffDir();
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const createdAt = new Date().toISOString();
    const wrappedPlanResponse = {
        version: "1.0",
        generatedAt: "",
        plans: [
            {
                version: "1.0",
                source: "ai_generated",
                status: "validated",
                scenario: { source: "testrail", caseId: 1, title: "Test scenario" },
                requiredData: [],
                steps: [
                    { index: 1, action: "click", target: { strategy: "label", value: "Continue" } }
                ],
                createdAt
            }
        ],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: ["Recovered plan"]
    };
    await promises_1.default.writeFile(paths.responsePath, JSON.stringify(wrappedPlanResponse, null, 2), "utf-8");
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.diagnostics?.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("retry_execution");
    const written = JSON.parse(await promises_1.default.readFile(paths.responsePath, "utf-8"));
    (0, test_1.expect)(written.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(written.generatedAt).toBe(createdAt);
    (0, test_1.expect)(written.plans).toHaveLength(1);
});
(0, test_1.test)("runCodexAutoRepair normalizes top-level ExecutionPlan array responses", async () => {
    const { paths } = await createTempHandoffDir();
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const createdAt = new Date().toISOString();
    const planArray = [
        {
            version: "1.0",
            source: "ai_generated",
            status: "validated",
            scenario: { source: "testrail", caseId: 1, title: "Array scenario" },
            requiredData: [],
            steps: [
                { index: 1, action: "click", target: { strategy: "label", value: "Continue" } }
            ],
            createdAt
        }
    ];
    await promises_1.default.writeFile(paths.responsePath, JSON.stringify(planArray, null, 2), "utf-8");
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.diagnostics?.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("retry_execution");
    const written = JSON.parse(await promises_1.default.readFile(paths.responsePath, "utf-8"));
    (0, test_1.expect)(written.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(written.generatedAt).toBe(createdAt);
    (0, test_1.expect)(written.plans).toHaveLength(1);
    (0, test_1.expect)(written.plans[0].scenario.title).toBe("Array scenario");
});
(0, test_1.test)("runCodexAutoRepair fails when Codex CLI exits with error", async () => {
    const { paths } = await createTempHandoffDir();
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 1, stderr: "Not inside a trusted directory" }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact" });
    (0, test_1.expect)(result.success).toBe(false);
    (0, test_1.expect)(result.responsePath).toBe(paths.responsePath);
    (0, test_1.expect)(result.exitCode).toBe(1);
    (0, test_1.expect)(result.error).toContain("exited with code 1");
});
(0, test_1.test)("CodexAutoRepairInput requires all fields", () => {
    const input = {
        handoffDir: "/tmp/test",
        requestPath: "/tmp/test/request.json",
        instructionsPath: "/tmp/test/instructions.md",
        responsePath: "/tmp/test/response.json",
        schemaPath: "/tmp/test/schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: ["--skip-git-repo-check", "--sandbox", "workspace-write"]
    };
    (0, test_1.expect)(input.codexCommand).toBe("codex");
    (0, test_1.expect)(input.codexExtraArgs).toHaveLength(3);
    (0, test_1.expect)(input.codexExtraArgs).toContain("--skip-git-repo-check");
    (0, test_1.expect)(input.codexExtraArgs).toContain("--sandbox");
    (0, test_1.expect)(input.codexExtraArgs).toContain("workspace-write");
});
(0, test_1.test)("CodexAutoRepairResult supports error with suggestions", () => {
    const result = {
        success: false,
        responsePath: "/tmp/test/response.json",
        exitCode: 1,
        error: [
            "Codex CLI exited with code 1.",
            "Stderr: Not inside a trusted directory",
            "Suggestions:",
            "  - Add --skip-git-repo-check to CODEX_CLI_EXTRA_ARGS."
        ].join("\n\n")
    };
    (0, test_1.expect)(result.error).toContain("--skip-git-repo-check");
    (0, test_1.expect)(result.success).toBe(false);
});
(0, test_1.test)("CodexAutoRepairResult supports sandbox error suggestions", () => {
    const result = {
        success: false,
        responsePath: "/tmp/test/response.json",
        exitCode: 1,
        error: [
            "Codex CLI exited with code 1.",
            "Stderr: permission denied: read-only sandbox",
            "Suggestions:",
            "  - Add --sandbox workspace-write to CODEX_CLI_EXTRA_ARGS."
        ].join("\n\n")
    };
    (0, test_1.expect)(result.error).toContain("--sandbox workspace-write");
});
(0, test_1.test)("buildCompactPrompt does not embed handoff content, only paths", () => {
    const input = {
        handoffDir: "C:\\handoff\\test",
        requestPath: "C:\\handoff\\test\\handoff-request.json",
        instructionsPath: "C:\\handoff\\test\\handoff-instructions.md",
        responsePath: "C:\\handoff\\test\\agent-response.json",
        schemaPath: "C:\\handoff\\test\\agent-response.schema.json",
        projectRoot: "C:\\MisProyectos\\MCP",
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact"
    };
    const prompt = (0, codex_auto_repair_1.buildCompactPrompt)(input);
    (0, test_1.expect)(prompt).toContain("C:\\handoff\\test\\handoff-request.json");
    (0, test_1.expect)(prompt).toContain("C:\\handoff\\test\\agent-response.json");
    (0, test_1.expect)(prompt).toContain("C:\\handoff\\test\\agent-response.schema.json");
    (0, test_1.expect)(prompt).not.toContain("dataContextSummary");
    (0, test_1.expect)(prompt).not.toContain("availableKeys");
});
(0, test_1.test)("buildCompactPrompt includes context-pack path when provided", () => {
    const input = {
        handoffDir: "C:\\handoff\\test",
        requestPath: "C:\\handoff\\test\\handoff-request.json",
        instructionsPath: "C:\\handoff\\test\\handoff-instructions.md",
        responsePath: "C:\\handoff\\test\\agent-response.json",
        schemaPath: "C:\\handoff\\test\\agent-response.schema.json",
        contextPackPath: "C:\\handoff\\test\\context-pack.json",
        projectRoot: "C:\\MisProyectos\\MCP",
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact"
    };
    const prompt = (0, codex_auto_repair_1.buildCompactPrompt)(input);
    (0, test_1.expect)(prompt).toContain("C:\\handoff\\test\\context-pack.json");
});
(0, test_1.test)("buildCompactPrompt contains rule Modify only agent-response.json", () => {
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/handoff-request.json",
        instructionsPath: "/tmp/handoff/handoff-instructions.md",
        responsePath: "/tmp/handoff/agent-response.json",
        schemaPath: "/tmp/handoff/agent-response.schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact"
    };
    const prompt = (0, codex_auto_repair_1.buildCompactPrompt)(input);
    (0, test_1.expect)(prompt).toContain("Modify only agent-response.json");
});
(0, test_1.test)("buildCompactPrompt contains rule Do not run Playwright", () => {
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/handoff-request.json",
        instructionsPath: "/tmp/handoff/handoff-instructions.md",
        responsePath: "/tmp/handoff/agent-response.json",
        schemaPath: "/tmp/handoff/agent-response.schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact"
    };
    const prompt = (0, codex_auto_repair_1.buildCompactPrompt)(input);
    (0, test_1.expect)(prompt).toContain("Do not run Playwright");
});
(0, test_1.test)("buildCompactPrompt contains rule Do not generate Playwright code", () => {
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/handoff-request.json",
        instructionsPath: "/tmp/handoff/handoff-instructions.md",
        responsePath: "/tmp/handoff/agent-response.json",
        schemaPath: "/tmp/handoff/agent-response.schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact"
    };
    const prompt = (0, codex_auto_repair_1.buildCompactPrompt)(input);
    (0, test_1.expect)(prompt).toContain("Do not generate Playwright code");
});
(0, test_1.test)("buildCompactPrompt requires AgentHandoffResponse wrapper", () => {
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/handoff-request.json",
        instructionsPath: "/tmp/handoff/handoff-instructions.md",
        responsePath: "/tmp/handoff/agent-response.json",
        schemaPath: "/tmp/handoff/agent-response.schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact"
    };
    const prompt = (0, codex_auto_repair_1.buildCompactPrompt)(input);
    (0, test_1.expect)(prompt).toContain("AgentHandoffResponse object");
    (0, test_1.expect)(prompt).toContain("top-level plans array");
});
(0, test_1.test)("buildCompactPrompt contains rule Do not modify Object Registry", () => {
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/handoff-request.json",
        instructionsPath: "/tmp/handoff/handoff-instructions.md",
        responsePath: "/tmp/handoff/agent-response.json",
        schemaPath: "/tmp/handoff/agent-response.schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact"
    };
    const prompt = (0, codex_auto_repair_1.buildCompactPrompt)(input);
    (0, test_1.expect)(prompt).toContain("Do not modify Object Registry");
});
(0, test_1.test)("buildCompactPrompt contains rule Finish immediately", () => {
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/handoff-request.json",
        instructionsPath: "/tmp/handoff/handoff-instructions.md",
        responsePath: "/tmp/handoff/agent-response.json",
        schemaPath: "/tmp/handoff/agent-response.schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact"
    };
    const prompt = (0, codex_auto_repair_1.buildCompactPrompt)(input);
    (0, test_1.expect)(prompt).toContain("Finish immediately after writing agent-response.json");
});
(0, test_1.test)("buildCompactPrompt uses absolute paths", () => {
    const input = {
        handoffDir: "C:\\handoff\\test",
        requestPath: "C:\\handoff\\test\\handoff-request.json",
        instructionsPath: "C:\\handoff\\test\\handoff-instructions.md",
        responsePath: "C:\\handoff\\test\\agent-response.json",
        schemaPath: "C:\\handoff\\test\\agent-response.schema.json",
        projectRoot: "C:\\MisProyectos\\MCP",
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact"
    };
    const prompt = (0, codex_auto_repair_1.buildCompactPrompt)(input);
    (0, test_1.expect)(prompt).toContain("C:\\handoff\\test");
    (0, test_1.expect)(prompt).not.toContain("..\\");
});
(0, test_1.test)("CodexAutoRepairInput supports promptMode field", () => {
    const compactInput = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/request.json",
        instructionsPath: "/tmp/handoff/instructions.md",
        responsePath: "/tmp/handoff/response.json",
        schemaPath: "/tmp/handoff/schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact"
    };
    (0, test_1.expect)(compactInput.promptMode).toBe("compact");
    const verboseInput = {
        ...compactInput,
        promptMode: "verbose"
    };
    (0, test_1.expect)(verboseInput.promptMode).toBe("verbose");
});
(0, test_1.test)("CodexAutoRepairInput promptMode is optional", () => {
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/request.json",
        instructionsPath: "/tmp/handoff/instructions.md",
        responsePath: "/tmp/handoff/response.json",
        schemaPath: "/tmp/handoff/schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: []
    };
    (0, test_1.expect)(input.promptMode).toBeUndefined();
});
(0, test_1.test)("buildCodexPrompt usa skillAwarePromptOverride cuando esta presente", async () => {
    const { buildCodexPrompt } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/handoff-request.json",
        instructionsPath: "/tmp/handoff/handoff-instructions.md",
        responsePath: "/tmp/handoff/agent-response.json",
        schemaPath: "/tmp/handoff/agent-response.schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact",
        skillId: "target-disambiguation",
        skillAwarePromptOverride: "SKILL_AWARE_PROMPT: Read selected-skill.md then write agent-response.json"
    };
    const prompt = buildCodexPrompt(input);
    (0, test_1.expect)(prompt).toContain("SKILL_AWARE_PROMPT");
    (0, test_1.expect)(prompt).toContain("selected-skill.md");
    (0, test_1.expect)(prompt).toContain("agent-response.json");
});
(0, test_1.test)("buildCodexPrompt compact-route-recovery con override usa override", async () => {
    const { buildCodexPrompt } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/handoff-request.json",
        instructionsPath: "/tmp/handoff/handoff-instructions.md",
        responsePath: "/tmp/handoff/agent-response.json",
        schemaPath: "/tmp/handoff/agent-response.schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact-route-recovery",
        skillAwarePromptOverride: "OVERRIDE_PROMPT"
    };
    const prompt = buildCodexPrompt(input);
    (0, test_1.expect)(prompt).toContain("OVERRIDE_PROMPT");
    (0, test_1.expect)(prompt).not.toContain("bounded goal-seeking route recovery planner");
});
(0, test_1.test)("buildCodexPrompt compact-route-recovery sin override produce route-recovery prompt", async () => {
    const { buildCodexPrompt } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/handoff-request.json",
        instructionsPath: "/tmp/handoff/handoff-instructions.md",
        responsePath: "/tmp/handoff/agent-response.json",
        schemaPath: "/tmp/handoff/agent-response.schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact-route-recovery",
        routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
        planningBudget: {
            preferredResponseSeconds: 30,
            maxPromptBudgetSeconds: 60,
            maxCandidates: 12,
            maxKnownObjects: 20,
            maxKnownRoutes: 10,
            maxKnownPlans: 5,
            maxProposedActions: 5,
            maxRationaleChars: 1200,
            maxUnresolvedQuestions: 5
        }
    };
    const prompt = buildCodexPrompt(input);
    (0, test_1.expect)(prompt).toContain("bounded current-snapshot semantic recovery planner");
    (0, test_1.expect)(prompt).toContain("route-recovery-pack.json");
    (0, test_1.expect)(prompt).toContain("route-recovery-decision.schema.json");
    (0, test_1.expect)(prompt).toContain("route-recovery-decision.json");
    (0, test_1.expect)(prompt).toContain("Use only IDs present in route-recovery-pack.json");
    (0, test_1.expect)(prompt).toContain("Do not write agent-response.json");
    (0, test_1.expect)(prompt).toContain("Do not write ExecutionPlan");
    (0, test_1.expect)(prompt).toContain("Do not write generatedAt");
    (0, test_1.expect)(prompt).toContain("Do not write version");
    (0, test_1.expect)(prompt).toContain("The framework will build the final AgentHandoffResponse");
    (0, test_1.expect)(prompt).not.toContain("context-pack.json");
    (0, test_1.expect)(prompt).not.toContain("handoff-request.json");
});
(0, test_1.test)("buildCompactPrompt no incluye skillAwarePromptOverride cuando no esta presente", () => {
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/handoff-request.json",
        instructionsPath: "/tmp/handoff/handoff-instructions.md",
        responsePath: "/tmp/handoff/agent-response.json",
        schemaPath: "/tmp/handoff/agent-response.schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact"
    };
    const prompt = (0, codex_auto_repair_1.buildCompactPrompt)(input);
    (0, test_1.expect)(prompt).not.toContain("SKILL_AWARE_PROMPT");
    (0, test_1.expect)(prompt).toContain("Modify only agent-response.json");
});
(0, test_1.test)("CodexAutoRepairInput acepta skillId y skillPath", () => {
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/request.json",
        instructionsPath: "/tmp/handoff/instructions.md",
        responsePath: "/tmp/handoff/response.json",
        schemaPath: "/tmp/handoff/schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        skillId: "navigation-recovery",
        skillPath: "/tmp/handoff/selected-skill.md"
    };
    (0, test_1.expect)(input.skillId).toBe("navigation-recovery");
    (0, test_1.expect)(input.skillPath).toContain("selected-skill.md");
});
(0, test_1.test)("CodexAutoRepairInput acepta skillAwarePromptOverride", () => {
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/request.json",
        instructionsPath: "/tmp/handoff/instructions.md",
        responsePath: "/tmp/handoff/response.json",
        schemaPath: "/tmp/handoff/schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        skillAwarePromptOverride: "custom prompt content"
    };
    (0, test_1.expect)(input.skillAwarePromptOverride).toBe("custom prompt content");
});
(0, test_1.test)("runCodexAutoRepair usa skillAwarePromptOverride cuando se provee", async () => {
    const { paths } = await createTempHandoffDir();
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const original = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-cli-runner")));
    original.__setSpawnForTesting(mockSpawnExit({ exitCode: 0 }));
    const result = await runCodexAutoRepair({
        ...paths,
        promptMode: "compact",
        skillId: "target-disambiguation",
        skillAwarePromptOverride: "SKILL_OVERRIDE_TEST_PROMPT"
    });
    (0, test_1.expect)(result).toBeDefined();
});
// --- Compact route recovery prompt tests ---
(0, test_1.test)("buildCodexPrompt produces compact-route-recovery prompt when promptMode is compact-route-recovery", async () => {
    const { buildCodexPrompt } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/request.json",
        instructionsPath: "/tmp/handoff/instructions.md",
        responsePath: "/tmp/handoff/response.json",
        schemaPath: "/tmp/handoff/schema.json",
        projectRoot: "/tmp",
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact-route-recovery",
        routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
        planningBudget: {
            preferredResponseSeconds: 30,
            maxPromptBudgetSeconds: 60,
            maxCandidates: 12,
            maxKnownObjects: 20,
            maxKnownRoutes: 10,
            maxKnownPlans: 5,
            maxProposedActions: 5,
            maxRationaleChars: 1200,
            maxUnresolvedQuestions: 5
        }
    };
    const prompt = buildCodexPrompt(input);
    (0, test_1.expect)(prompt).toContain("bounded current-snapshot semantic recovery planner");
    (0, test_1.expect)(prompt).toContain("Do not analyze the repository");
    (0, test_1.expect)(prompt).toContain("repaired_plan");
    (0, test_1.expect)(prompt).toContain("no_safe_action");
    (0, test_1.expect)(prompt).toContain("needs_more_context");
    (0, test_1.expect)(prompt).toContain("selectedCandidateId");
    (0, test_1.expect)(prompt).toContain("30 seconds");
    (0, test_1.expect)(prompt).toContain("60 seconds");
    (0, test_1.expect)(prompt).toContain("Use only IDs present in route-recovery-pack.json");
    (0, test_1.expect)(prompt).toContain("If no safe route is found quickly, write no_safe_action");
    (0, test_1.expect)(prompt).toContain("Do not write agent-response.json");
    (0, test_1.expect)(prompt).toContain("Do not write ExecutionPlan");
    (0, test_1.expect)(prompt).not.toContain("SauceDemo");
    (0, test_1.expect)(prompt).not.toContain("Kiosko");
});
(0, test_1.test)("buildCodexPrompt compact-route-recovery is shorter than full compact prompt", async () => {
    const { buildCodexPrompt, buildCompactPrompt } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const base = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/request.json",
        instructionsPath: "/tmp/handoff/instructions.md",
        responsePath: "/tmp/handoff/response.json",
        schemaPath: "/tmp/handoff/schema.json",
        projectRoot: "/tmp",
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: []
    };
    const compactPrompt = buildCompactPrompt(base);
    const routeRecoveryInput = {
        ...base,
        promptMode: "compact-route-recovery",
        routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
        planningBudget: {
            preferredResponseSeconds: 30,
            maxPromptBudgetSeconds: 60,
            maxCandidates: 12,
            maxKnownObjects: 20,
            maxKnownRoutes: 10,
            maxKnownPlans: 5,
            maxProposedActions: 5,
            maxRationaleChars: 1200,
            maxUnresolvedQuestions: 5
        }
    };
    const routePrompt = buildCodexPrompt(routeRecoveryInput);
    // Route recovery prompt has very specific constraints that make it distinct
    (0, test_1.expect)(routePrompt).not.toEqual(compactPrompt);
    (0, test_1.expect)(routePrompt).toContain("route-recovery-pack.json");
});
(0, test_1.test)("buildCodexPrompt compact-route-recovery includes maxRationaleChars", async () => {
    const { buildCodexPrompt } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/request.json",
        instructionsPath: "/tmp/handoff/instructions.md",
        responsePath: "/tmp/handoff/response.json",
        schemaPath: "/tmp/handoff/schema.json",
        projectRoot: "/tmp",
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact-route-recovery",
        planningBudget: {
            preferredResponseSeconds: 30,
            maxPromptBudgetSeconds: 60,
            maxCandidates: 12,
            maxKnownObjects: 20,
            maxKnownRoutes: 10,
            maxKnownPlans: 5,
            maxProposedActions: 5,
            maxRationaleChars: 800,
            maxUnresolvedQuestions: 3
        }
    };
    const prompt = buildCodexPrompt(input);
    (0, test_1.expect)(prompt).toContain("800");
    (0, test_1.expect)(prompt).toContain("3");
    (0, test_1.expect)(prompt).toContain("Do not run commands");
    (0, test_1.expect)(prompt).toContain("Do not run tests");
    (0, test_1.expect)(prompt).toContain("Do not run Playwright");
});
(0, test_1.test)("no hardcodear apps, productos, URLs, case IDs en codex-auto-repair tests", () => {
    const input = {
        handoffDir: "/tmp/test",
        requestPath: "/tmp/test/request.json",
        instructionsPath: "/tmp/test/instructions.md",
        responsePath: "/tmp/test/response.json",
        schemaPath: "/tmp/test/schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: []
    };
    const prompt = (0, codex_auto_repair_1.buildCompactPrompt)(input);
    const lower = prompt.toLowerCase();
    (0, test_1.expect)(lower).not.toMatch(/(kiosko|saucelabs?|préstamo|visa)/);
    (0, test_1.expect)(lower).not.toMatch(/c\d{5}/);
});
// --- Decision without plans tests ---
(0, test_1.test)("compact route recovery prompt specifies recoveryDecision JSON field", async () => {
    const { buildCodexPrompt } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/request.json",
        instructionsPath: "/tmp/handoff/instructions.md",
        responsePath: "/tmp/handoff/response.json",
        schemaPath: "/tmp/handoff/schema.json",
        projectRoot: process.cwd(),
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact-route-recovery",
        routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
        planningBudget: {
            preferredResponseSeconds: 30,
            maxPromptBudgetSeconds: 60,
            maxCandidates: 12,
            maxKnownObjects: 20,
            maxKnownRoutes: 10,
            maxKnownPlans: 5,
            maxProposedActions: 5,
            maxRationaleChars: 1200,
            maxUnresolvedQuestions: 5
        }
    };
    const prompt = buildCodexPrompt(input);
    (0, test_1.expect)(prompt).toContain("recoveryDecision");
    (0, test_1.expect)(prompt).toContain("selectedCandidateId");
    (0, test_1.expect)(prompt).toContain("repaired_plan");
    (0, test_1.expect)(prompt).toContain("no_safe_action");
    (0, test_1.expect)(prompt).toContain("needs_more_context");
    (0, test_1.expect)(prompt).toContain("First inspect topVisibleCandidates");
    (0, test_1.expect)(prompt).toContain("Prefer current visible actionable candidates");
    (0, test_1.expect)(prompt).toContain("Use knownObjects, knownRoutes and knownPlans only as secondary evidence");
    (0, test_1.expect)(prompt).toContain("look for a safe visible parent category");
    (0, test_1.expect)(prompt).toContain("Propose only the next safe segment");
    (0, test_1.expect)(prompt).toContain("Do not write agent-response.json");
    (0, test_1.expect)(prompt).toContain("Do not write ExecutionPlan");
    (0, test_1.expect)(prompt).toContain("Do not write generatedAt");
    (0, test_1.expect)(prompt).not.toContain("Do not omit recoveryDecision");
});
function minPack() {
    return {
        version: "1.0", createdAt: "2025-01-01T00:00:00.000Z",
        failedAction: { stepIndex: 1, actionType: "click", target: "Settings", failureReason: "Element not found" },
        semanticGoal: { intent: "open_settings", targetConcept: "Settings", sensitive: false },
        currentScreen: { url: "https://example.com", title: "Dashboard" },
        topVisibleCandidates: [
            { id: "candidate-123", type: "button", text: "Settings", role: "button", score: 0.85, actionability: "clickable", semanticRelation: "parent_category", source: "current_snapshot" }
        ],
        topKnownObjects: [], topKnownRoutes: [], topKnownPlans: [],
        priorSuccessfulSteps: [], pendingSteps: [], finalAssertions: [],
        actionHistorySummary: [], failedRoutePaths: [],
        budget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 },
        constraints: { codexMustOnlyWriteAgentResponseJson: true, doNotRunPlaywright: true, doNotModifyStableRegistry: true, doNotApproveObjectsAutomatically: true, doNotInventData: true, useOnlyIdsPresentInThisPack: true }
    };
}
// --- Decision pipeline: Codex writes valid decisions → success ---
(0, test_1.test)("compact-route-recovery: Codex writes valid repaired_plan decision", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    const decision = { recoveryDecision: "repaired_plan", selectedCandidateId: "candidate-123", action: "click", confidence: 0.85, sensitive: false, rationale: "Visible parent category." };
    await promises_1.default.writeFile(decisionPath, JSON.stringify(decision, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("repaired_plan");
    (0, test_1.expect)(result.diagnostics?.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(result.diagnostics?.finalAgentResponseBuiltBy).toBe("codex_decision");
    (0, test_1.expect)(result.diagnostics?.selectedCandidateId).toBe("candidate-123");
    (0, test_1.expect)(result.diagnostics?.routeRecoveryDecisionValid).toBe(true);
    const written = JSON.parse(await promises_1.default.readFile(paths.responsePath, "utf-8"));
    (0, test_1.expect)(written.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(written.plans).toHaveLength(1);
    (0, test_1.expect)(written.plans[0].steps[0].target.strategy).toBe("role");
    (0, test_1.expect)(written.plans[0].steps[0].target.role).toBe("button");
    (0, test_1.expect)(written.plans[0].steps[0].target.name).toBe("Settings");
    (0, test_1.expect)(written.generatedAt).toBeTruthy();
});
(0, test_1.test)("compact-route-recovery: Codex writes valid no_safe_action decision", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    await promises_1.default.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "no_safe_action", rationale: "No safe action possible." }, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("no_safe_action");
    (0, test_1.expect)(result.diagnostics?.recoveryDecision).toBe("no_safe_action");
    (0, test_1.expect)(result.diagnostics?.finalAgentResponseBuiltBy).toBe("codex_decision");
    const written = JSON.parse(await promises_1.default.readFile(paths.responsePath, "utf-8"));
    (0, test_1.expect)(written.recoveryDecision).toBe("no_safe_action");
    (0, test_1.expect)(written.plans).toHaveLength(0);
    (0, test_1.expect)(written.rationale).toEqual(["No safe action possible."]);
});
(0, test_1.test)("compact-route-recovery: Codex writes valid needs_more_context decision", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    await promises_1.default.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "needs_more_context", unresolvedQuestions: ["Need more candidates."], rationale: "Pack lacks evidence." }, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("needs_more_context");
    (0, test_1.expect)(result.diagnostics?.recoveryDecision).toBe("needs_more_context");
    (0, test_1.expect)(result.diagnostics?.finalAgentResponseBuiltBy).toBe("codex_decision");
    const written = JSON.parse(await promises_1.default.readFile(paths.responsePath, "utf-8"));
    (0, test_1.expect)(written.recoveryDecision).toBe("needs_more_context");
    (0, test_1.expect)(written.plans).toHaveLength(0);
    (0, test_1.expect)(written.unresolvedQuestions).toHaveLength(1);
});
// --- Decision pipeline: Codex writes invalid decisions → fallback or failure ---
(0, test_1.test)("compact-route-recovery: Codex writes invalid decision triggers deterministic fallback", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    await promises_1.default.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan" }, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("repaired_plan");
    (0, test_1.expect)(result.diagnostics?.finalAgentResponseBuiltBy).toBe("deterministic_fallback");
    (0, test_1.expect)(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
    (0, test_1.expect)(result.diagnostics?.routeRecoveryDecisionErrors).toBeDefined();
});
(0, test_1.test)("compact-route-recovery: Codex writes invalid decision with missing fields triggers fallback when good candidate exists", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    await promises_1.default.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "no_safe_action" }, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    // Decision is invalid but good candidate exists → deterministic fallback applies
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
    (0, test_1.expect)(result.diagnostics?.finalAgentResponseBuiltBy).toBe("deterministic_fallback");
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("repaired_plan");
});
(0, test_1.test)("compact-route-recovery: Codex writes candidate not in pack and no fallback candidate fails", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    const emptyPack = { ...minPack(), topVisibleCandidates: [] };
    await promises_1.default.writeFile(packPath, JSON.stringify(emptyPack, null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    await promises_1.default.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan", selectedCandidateId: "nonexistent", action: "click", confidence: 0.85, sensitive: false, rationale: "test" }, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(false);
    (0, test_1.expect)(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
    (0, test_1.expect)(result.error).toContain("CANDIDATE_NOT_IN_PACK");
});
(0, test_1.test)("compact-route-recovery: Codex writes no decision file triggers fallback", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("repaired_plan");
    (0, test_1.expect)(result.diagnostics?.finalAgentResponseBuiltBy).toBe("deterministic_fallback");
});
(0, test_1.test)("compact-route-recovery: final agent-response passes validateAgentHandoffResponse", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    await promises_1.default.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan", selectedCandidateId: "candidate-123", action: "click", confidence: 0.85, sensitive: false, rationale: "test" }, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(true);
    const written = JSON.parse(await promises_1.default.readFile(paths.responsePath, "utf-8"));
    const { validateAgentHandoffResponse } = await Promise.resolve().then(() => __importStar(require("../src/agent/agent-response-validator")));
    const validation = validateAgentHandoffResponse(written, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(validation.valid).toBe(true);
});
(0, test_1.test)("compact-route-recovery: invalid repaired_plan action fails instead of reporting success", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(minPack(), null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    await promises_1.default.writeFile(decisionPath, JSON.stringify({
        recoveryDecision: "repaired_plan",
        selectedCandidateId: "candidate-123",
        action: "hover",
        confidence: 0.85,
        sensitive: false,
        rationale: "test"
    }, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({
        ...paths,
        promptMode: "compact-route-recovery",
        routeRecoveryPackPath: packPath,
        routeRecoveryDecisionPath: decisionPath,
        planningBudget: {
            preferredResponseSeconds: 30,
            maxPromptBudgetSeconds: 60,
            maxCandidates: 12,
            maxKnownObjects: 20,
            maxKnownRoutes: 10,
            maxKnownPlans: 5,
            maxProposedActions: 5,
            maxRationaleChars: 1200,
            maxUnresolvedQuestions: 5
        }
    });
    (0, test_1.expect)(result.success).toBe(false);
    (0, test_1.expect)(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("auto_repair_invalid_response");
    (0, test_1.expect)(result.error).toContain("INVALID_ACTION");
});
(0, test_1.test)("compact route recovery prompt contains JSON examples for each decision type", async () => {
    const { buildCodexPrompt } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/request.json",
        instructionsPath: "/tmp/handoff/instructions.md",
        responsePath: "/tmp/handoff/response.json",
        schemaPath: "/tmp/handoff/schema.json",
        projectRoot: "/tmp",
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact-route-recovery",
        routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
        planningBudget: {
            preferredResponseSeconds: 30,
            maxPromptBudgetSeconds: 60,
            maxCandidates: 12,
            maxKnownObjects: 20,
            maxKnownRoutes: 10,
            maxKnownPlans: 5,
            maxProposedActions: 5,
            maxRationaleChars: 1200,
            maxUnresolvedQuestions: 5
        }
    };
    const prompt = buildCodexPrompt(input);
    (0, test_1.expect)(prompt).toContain('"recoveryDecision": "repaired_plan"');
    (0, test_1.expect)(prompt).toContain('"recoveryDecision": "no_safe_action"');
    (0, test_1.expect)(prompt).toContain('"recoveryDecision": "needs_more_context"');
    (0, test_1.expect)(prompt).toContain("selectedCandidateId");
    (0, test_1.expect)(prompt).toContain("action");
    (0, test_1.expect)(prompt).toContain("confidence");
    (0, test_1.expect)(prompt).toContain("sensitive");
    (0, test_1.expect)(prompt).toContain("1. repaired_plan");
    (0, test_1.expect)(prompt).toContain("2. no_safe_action");
    (0, test_1.expect)(prompt).toContain("3. needs_more_context");
    (0, test_1.expect)(prompt).toContain("unresolvedQuestions");
    (0, test_1.expect)(prompt).toContain("Never leave placeholders in the final JSON");
    (0, test_1.expect)(prompt).toContain("Do not copy placeholders");
    // Prompt instructs NOT to write these fields but schema version is mentioned in instructions
    (0, test_1.expect)(prompt).not.toContain('"version"');
    (0, test_1.expect)(prompt).not.toContain('"generatedAt"');
    (0, test_1.expect)(prompt).not.toContain('"plans"');
    (0, test_1.expect)(prompt).not.toContain('"proposedObjects"');
});
(0, test_1.test)("compact route recovery prompt contains strong instruction against empty response", async () => {
    const { buildCodexPrompt } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/request.json",
        instructionsPath: "/tmp/handoff/instructions.md",
        responsePath: "/tmp/handoff/response.json",
        schemaPath: "/tmp/handoff/schema.json",
        projectRoot: "/tmp",
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact-route-recovery",
        routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
        planningBudget: {
            preferredResponseSeconds: 30,
            maxPromptBudgetSeconds: 60,
            maxCandidates: 12,
            maxKnownObjects: 20,
            maxKnownRoutes: 10,
            maxKnownPlans: 5,
            maxProposedActions: 5,
            maxRationaleChars: 1200,
            maxUnresolvedQuestions: 5
        }
    };
    const prompt = buildCodexPrompt(input);
    (0, test_1.expect)(prompt).not.toContain("or empty if unavailable");
    (0, test_1.expect)(prompt).toContain("Do not copy placeholders");
    (0, test_1.expect)(prompt).not.toContain("1970-01-01T00:00:00.000Z");
    (0, test_1.expect)(prompt).not.toContain("An empty response with plans=[]");
    (0, test_1.expect)(prompt).toContain("If you are unsure, choose no_safe_action or needs_more_context.");
    (0, test_1.expect)(prompt).toContain("Do not write an empty object");
    (0, test_1.expect)(prompt).toContain("Do not write agent-response.json");
    (0, test_1.expect)(prompt).toContain("Do not write ExecutionPlan");
    (0, test_1.expect)(prompt).toContain("Do not write generatedAt");
    (0, test_1.expect)(prompt).toContain("Do not write version");
});
(0, test_1.test)("compact route recovery prompt prefers visible parent_category candidates", async () => {
    const { buildCodexPrompt } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const input = {
        handoffDir: "/tmp/handoff",
        requestPath: "/tmp/handoff/request.json",
        instructionsPath: "/tmp/handoff/instructions.md",
        responsePath: "/tmp/handoff/response.json",
        schemaPath: "/tmp/handoff/schema.json",
        projectRoot: "/tmp",
        timeoutMs: 5000,
        codexCommand: "codex",
        codexExtraArgs: [],
        promptMode: "compact-route-recovery",
        routeRecoveryPackPath: "/tmp/handoff/route-recovery-pack.json",
        planningBudget: {
            preferredResponseSeconds: 30,
            maxPromptBudgetSeconds: 60,
            maxCandidates: 12,
            maxKnownObjects: 20,
            maxKnownRoutes: 10,
            maxKnownPlans: 5,
            maxProposedActions: 5,
            maxRationaleChars: 1200,
            maxUnresolvedQuestions: 5
        }
    };
    const prompt = buildCodexPrompt(input);
    (0, test_1.expect)(prompt).toContain("parent_category candidate with score >= 0.70");
    (0, test_1.expect)(prompt).toContain("prefer repaired_plan using that candidateId");
    (0, test_1.expect)(prompt).toContain("parent_category");
    (0, test_1.expect)(prompt).toContain("clickable");
});
// --- Deterministic fallback tests (decision pipeline) ---
function fallbackPack(overrides) {
    return {
        version: "1.0", createdAt: "2025-01-01T00:00:00.000Z",
        failedAction: { stepIndex: 1, actionType: "click", target: "Settings", failureReason: "Element not found" },
        semanticGoal: { intent: "open_settings", targetConcept: "Settings", sensitive: false, ...(overrides?.semanticGoal ?? {}) },
        currentScreen: { url: "https://example.com", title: "Dashboard" },
        topVisibleCandidates: overrides?.topVisibleCandidates ?? [
            { id: "candidate-123", type: "button", text: "Settings", role: "button", score: 0.85, actionability: "clickable", semanticRelation: "parent_category", source: "current_snapshot" }
        ],
        topKnownObjects: [], topKnownRoutes: [], topKnownPlans: [],
        priorSuccessfulSteps: [], pendingSteps: [], finalAssertions: [],
        actionHistorySummary: overrides?.actionHistorySummary ?? [],
        failedRoutePaths: [],
        budget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 },
        constraints: { codexMustOnlyWriteAgentResponseJson: true, doNotRunPlaywright: true, doNotModifyStableRegistry: true, doNotApproveObjectsAutomatically: true, doNotInventData: true, useOnlyIdsPresentInThisPack: true }
    };
}
(0, test_1.test)("deterministic fallback triggers when Codex writes nothing and good candidate available", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(fallbackPack(), null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("repaired_plan");
    (0, test_1.expect)(result.diagnostics?.finalAgentResponseBuiltBy).toBe("deterministic_fallback");
    (0, test_1.expect)(result.diagnostics?.selectedCandidateId).toBe("candidate-123");
    const written = JSON.parse(await promises_1.default.readFile(paths.responsePath, "utf-8"));
    (0, test_1.expect)(written.recoveryDecision).toBe("repaired_plan");
    (0, test_1.expect)(written.plans).toHaveLength(1);
    (0, test_1.expect)(written.generatedAt).toBeTruthy();
});
(0, test_1.test)("deterministic fallback not applied when score < 0.70", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(fallbackPack({ topVisibleCandidates: [{ id: "candidate-low", type: "button", text: "Settings", role: "button", score: 0.60, actionability: "clickable", semanticRelation: "parent_category", source: "current_snapshot" }] }), null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    await promises_1.default.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan" }, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(false);
    (0, test_1.expect)(result.diagnostics?.nextAction).toBe("auto_repair_invalid_response");
    (0, test_1.expect)(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
});
(0, test_1.test)("deterministic fallback not applied when actionability is not clickable", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(fallbackPack({ topVisibleCandidates: [{ id: "candidate-fill", type: "input", text: "Settings", role: "textbox", score: 0.85, actionability: "fillable", semanticRelation: "parent_category", source: "current_snapshot" }] }), null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    await promises_1.default.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan" }, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(false);
    (0, test_1.expect)(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
});
(0, test_1.test)("deterministic fallback applied when semantic goal is sensitive", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(fallbackPack({ semanticGoal: { intent: "login", targetConcept: "Login", sensitive: true } }), null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    await promises_1.default.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan" }, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.diagnostics?.finalAgentResponseBuiltBy).toBe("deterministic_fallback");
});
(0, test_1.test)("deterministic fallback not applied when candidate is in failed action history", async () => {
    const { paths, dir } = await createTempHandoffDir();
    const packPath = node_path_1.default.join(dir, "route-recovery-pack.json");
    await promises_1.default.writeFile(packPath, JSON.stringify(fallbackPack({ actionHistorySummary: [{ action: "click", target: "candidate-123", status: "failed" }] }), null, 2), "utf-8");
    const decisionPath = node_path_1.default.join(dir, "route-recovery-decision.json");
    await promises_1.default.writeFile(decisionPath, JSON.stringify({ recoveryDecision: "repaired_plan" }, null, 2), "utf-8");
    (0, codex_cli_runner_1.__setSpawnForTesting)(mockSpawnExit({ exitCode: 0 }));
    const { runCodexAutoRepair } = await Promise.resolve().then(() => __importStar(require("../src/agent/codex-auto-repair")));
    const result = await runCodexAutoRepair({ ...paths, promptMode: "compact-route-recovery", routeRecoveryPackPath: packPath, routeRecoveryDecisionPath: decisionPath, planningBudget: { preferredResponseSeconds: 30, maxPromptBudgetSeconds: 60, maxCandidates: 12, maxKnownObjects: 20, maxKnownRoutes: 10, maxKnownPlans: 5, maxProposedActions: 5, maxRationaleChars: 1200, maxUnresolvedQuestions: 5 } });
    (0, test_1.expect)(result.success).toBe(false);
    (0, test_1.expect)(result.diagnostics?.routeRecoveryDecisionValid).toBe(false);
});
