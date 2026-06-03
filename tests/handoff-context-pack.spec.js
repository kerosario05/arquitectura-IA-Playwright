"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const handoff_builder_1 = require("../src/agent/handoff-builder");
const handoff_writer_1 = require("../src/agent/handoff-writer");
const handoff_instructions_1 = require("../src/agent/handoff-instructions");
const agent_response_validator_1 = require("../src/agent/agent-response-validator");
const data_context_1 = require("../src/data/data-context");
const test_temp_dir_1 = require("./helpers/test-temp-dir");
const tmpDir = (0, test_temp_dir_1.getTestTempDir)("test-handoff-context-pack");
function minimalConfig() {
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
        integrations: {}
    };
}
test_1.test.beforeAll(async () => {
    await (0, test_temp_dir_1.ensureTestTempDir)("test-handoff-context-pack");
});
test_1.test.afterAll(async () => {
    try {
        await (0, test_temp_dir_1.cleanTestTempDir)("test-handoff-context-pack");
    }
    catch {
    }
});
(0, test_1.test)("handoff-request references contextPackPath and instructions mention it", async () => {
    const config = minimalConfig();
    const dataContext = (0, data_context_1.buildDataContext)(config);
    const out = node_path_1.default.join(tmpDir, "handoff1");
    const contextPackPath = node_path_1.default.join(out, "context-pack.json");
    await promises_1.default.mkdir(out, { recursive: true });
    await promises_1.default.writeFile(contextPackPath, JSON.stringify({ version: "1.0" }, null, 2), "utf-8");
    const request = (0, handoff_builder_1.buildAgentHandoffRequest)({
        kind: "plan_repair",
        goal: "Test",
        contextPackPath,
        dataContext
    });
    const pkg = await (0, handoff_writer_1.writeAgentHandoffPackage)({ request, outputDir: out });
    const reqContent = await promises_1.default.readFile(pkg.requestPath, "utf-8");
    (0, test_1.expect)(reqContent).toContain("contextPackPath");
    (0, test_1.expect)(reqContent).toContain("context-pack.json");
    const instructions = (0, handoff_instructions_1.buildAgentHandoffInstructions)(request);
    (0, test_1.expect)(instructions.toLowerCase()).toContain("context pack");
    (0, test_1.expect)(instructions).toContain("context-pack.json");
});
(0, test_1.test)("handoff writer seeds agent-response.json with a valid needs_more_context response", async () => {
    const config = minimalConfig();
    const dataContext = (0, data_context_1.buildDataContext)(config);
    const out = node_path_1.default.join(tmpDir, "handoff-seeded-response");
    await promises_1.default.mkdir(out, { recursive: true });
    const request = (0, handoff_builder_1.buildAgentHandoffRequest)({
        kind: "plan_repair",
        goal: "Seed a valid response template",
        dataContext
    });
    const pkg = await (0, handoff_writer_1.writeAgentHandoffPackage)({ request, outputDir: out });
    const response = JSON.parse(await promises_1.default.readFile(pkg.responsePath, "utf-8"));
    const validation = (0, agent_response_validator_1.validateAgentHandoffResponse)(response, { promptMode: "compact-route-recovery" });
    (0, test_1.expect)(validation.valid).toBe(true);
    (0, test_1.expect)(response.recoveryDecision).toBe("needs_more_context");
});
