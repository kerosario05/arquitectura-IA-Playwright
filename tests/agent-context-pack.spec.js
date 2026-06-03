"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const agent_context_pack_1 = require("../src/agent/agent-context-pack");
const test_temp_dir_1 = require("./helpers/test-temp-dir");
const tmpDir = (0, test_temp_dir_1.getTestTempDir)("test-agent-context-pack");
function baseConfig(overrides) {
    return {
        app: {
            baseUrl: "https://example.com",
            loginMode: "no_login",
            testData: { non_sensitive_key: "x" },
            testDataAliases: {},
            missingInputBehavior: "fail",
            appProfile: "default",
            password: "SUPER_SECRET_PASSWORD_SHOULD_NOT_APPEAR"
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
                autoRepairTimeoutMs: 5000,
                autoRepairPromptMode: "compact"
            }
        },
        ...overrides
    };
}
test_1.test.beforeAll(async () => {
    await (0, test_temp_dir_1.ensureTestTempDir)("test-agent-context-pack");
});
test_1.test.afterAll(async () => {
    try {
        await (0, test_temp_dir_1.cleanTestTempDir)("test-agent-context-pack");
    }
    catch {
    }
});
(0, test_1.test)("buildAgentContextPack includes appSlug, failure, and currentRun paths", async () => {
    const outDir = node_path_1.default.join(tmpDir, "run1");
    const evidenceDir = node_path_1.default.join(outDir, "evidence");
    await promises_1.default.mkdir(evidenceDir, { recursive: true });
    const pendingObjectsPath = node_path_1.default.join(outDir, "discovered-objects.pending.json");
    await promises_1.default.writeFile(pendingObjectsPath, JSON.stringify([
        { key: "button_continue", name: "Continue", type: "button", locator: { strategy: "role", role: "button", name: "Continue" }, aliases: ["continue"], discoveredAt: "", sourceStep: 1, confidence: 0.9 },
        { key: "button_irrelevant", name: "Settings", type: "button", locator: { strategy: "text", value: "Settings" }, aliases: ["settings"], discoveredAt: "", sourceStep: 1, confidence: 0.9 }
    ], null, 2), "utf-8");
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", caseId: 1, title: "Test Case" },
        requiredData: [],
        steps: [{ index: 1, action: "click", target: { strategy: "role", role: "button", name: "Continue" } }],
        createdAt: new Date().toISOString()
    };
    const { pack } = await (0, agent_context_pack_1.buildAgentContextPack)({
        fullConfig: baseConfig(),
        outputDir: outDir,
        evidenceDir,
        candidatePlanPath: node_path_1.default.join(outDir, "candidate-plan.json"),
        currentPlan: plan,
        pendingObjectsPath,
        failedReason: "target_not_found",
        failedTarget: "Continue",
        failedAtStep: 1,
        supportedActions: ["click", "fill"]
    });
    (0, test_1.expect)(pack.version).toBe("1.0");
    (0, test_1.expect)(pack.app.appSlug).toBe("default");
    (0, test_1.expect)(pack.failure.failedReason).toBe("target_not_found");
    (0, test_1.expect)(pack.failure.failedTarget).toBe("Continue");
    (0, test_1.expect)(pack.currentRun.outputDir).toContain(outDir);
    (0, test_1.expect)(pack.currentRun.pendingObjectsPath).toContain("discovered-objects.pending.json");
    (0, test_1.expect)(pack.knownObjects[0].name).toBe("Continue");
});
(0, test_1.test)("buildAgentContextPack redacts secrets and lists only safe data keys", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", caseId: 1, title: "Test Case" },
        requiredData: [],
        steps: [],
        createdAt: new Date().toISOString()
    };
    const { pack } = await (0, agent_context_pack_1.buildAgentContextPack)({
        fullConfig: baseConfig(),
        outputDir: tmpDir,
        currentPlan: plan,
        failedReason: "ambiguous_target",
        failedTarget: "Login",
        supportedActions: ["click"]
    });
    const serialized = JSON.stringify(pack);
    (0, test_1.expect)(serialized).not.toContain("SUPER_SECRET_PASSWORD_SHOULD_NOT_APPEAR");
    (0, test_1.expect)(pack.safeData.redacted).toBe(true);
    (0, test_1.expect)(Array.isArray(pack.safeData.availableKeys)).toBe(true);
});
(0, test_1.test)("buildAgentContextPack limits maxObjects and records warning", async () => {
    const outDir = node_path_1.default.join(tmpDir, "run2");
    await promises_1.default.mkdir(outDir, { recursive: true });
    const pendingObjectsPath = node_path_1.default.join(outDir, "discovered-objects.pending.json");
    const many = Array.from({ length: 80 }).map((_, i) => ({
        key: `button_${i}`,
        name: `Button ${i}`,
        type: "button",
        locator: { strategy: "text", value: `Button ${i}`, exact: false },
        aliases: [`button ${i}`],
        discoveredAt: "",
        sourceStep: 1,
        confidence: 0.6
    }));
    await promises_1.default.writeFile(pendingObjectsPath, JSON.stringify(many, null, 2), "utf-8");
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", caseId: 1, title: "Test Case" },
        requiredData: [],
        steps: [],
        createdAt: new Date().toISOString()
    };
    const { pack } = await (0, agent_context_pack_1.buildAgentContextPack)({
        fullConfig: baseConfig(),
        outputDir: outDir,
        currentPlan: plan,
        pendingObjectsPath,
        failedTarget: "Button",
        supportedActions: ["click"],
        options: { maxObjects: 50 }
    });
    (0, test_1.expect)(pack.knownObjects.length).toBe(50);
    (0, test_1.expect)(pack.warnings.join(" ")).toContain("knownObjects limited");
});
