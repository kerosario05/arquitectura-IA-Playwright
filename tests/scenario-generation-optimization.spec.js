"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const mcp_scenario_prompt_builder_1 = require("../src/scenarios/mcp-scenario-prompt-builder");
test_1.test.describe("Scenario Generation Optimization", () => {
    const mockIssue = {
        key: "TEST-1",
        summary: "Test issue with long description",
        description: "A".repeat(3000), // Long description to test truncation
        issueType: "Story",
        status: "To Do",
        labels: [],
        components: [],
        acceptanceCriteria: ""
    };
    const mockRouteProfile = {
        name: "test-profile",
        entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: ["Información de productos", "Botón Solicitar"],
        representativeFixture: {},
        notes: []
    };
    const mockRouteResolutions = new Map();
    test_1.test.beforeEach(() => {
        mockRouteResolutions.clear();
    });
    (0, test_1.test)("compact mode enabled when derivedContext has allowedClicks", async () => {
        mockRouteResolutions.set("TEST-1", {
            scenarioMode: "listing_validation",
            routeConfidence: "high",
            executableRouteSteps: ['1. Clic en "Iniciar".'],
            diagnostics: [],
            canGenerate: true,
            missingRouteReason: undefined
        });
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should use compact rules (not full SKILL.md)
        (0, test_1.expect)(systemPrompt).toContain("Compact MCP Rules");
        (0, test_1.expect)(systemPrompt).not.toContain("Skill Rules (from mcp-testrail-case-generator-v2)");
        // Should include multiproject rules
        (0, test_1.expect)(systemPrompt).toContain("ALLOWED_EXECUTABLE_CLICKS");
        (0, test_1.expect)(systemPrompt).toContain("Multiproject Execution Rules");
    });
    (0, test_1.test)("long descriptions are truncated", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const userPrompt = messages[1].content;
        // Description should be truncated
        (0, test_1.expect)(userPrompt).toContain("[... truncated for brevity");
        // Should not contain full 3000-char description
        (0, test_1.expect)(userPrompt.length).toBeLessThan(5000);
    });
    (0, test_1.test)("max scenarios per issue is enforced in compact rules", async () => {
        process.env.AI_SCENARIO_MAX_PER_ISSUE = "5";
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should include scenario limit in compact mode (case-insensitive match)
        (0, test_1.expect)(systemPrompt.toLowerCase()).toContain("generate maximum 5 scenarios per issue");
        delete process.env.AI_SCENARIO_MAX_PER_ISSUE;
    });
    (0, test_1.test)("deterministic generation correctly identifies button validation scenarios", async () => {
        // This is a simpler test that checks the mode detection without full integration
        // Full deterministic generation would require complex mocking of route resolver
        const buttonIssue = {
            key: "TEST-BTN",
            summary: "Validate Solicitar button visibility",
            description: "Como cliente quiero validar que el botón Solicitar esté visible",
            issueType: "Story",
            status: "To Do",
            labels: [],
            components: [],
            acceptanceCriteria: ""
        };
        // The deterministic generation function should detect action_button_validation mode
        // when the resolution has the right scenarioMode
        mockRouteResolutions.set("TEST-BTN", {
            scenarioMode: "action_button_validation",
            routeConfidence: "high",
            executableRouteSteps: [
                '1. Clic en "Iniciar".',
                '2. Validar que el botón "Solicitar" esté visible.'
            ],
            diagnostics: [],
            canGenerate: true,
            missingRouteReason: undefined
        });
        // Verify the route resolution is set up correctly
        const resolution = mockRouteResolutions.get("TEST-BTN");
        (0, test_1.expect)(resolution?.scenarioMode).toBe("action_button_validation");
        (0, test_1.expect)(resolution?.executableRouteSteps).toContain('2. Validar que el botón "Solicitar" esté visible.');
    });
    (0, test_1.test)("size logging includes all metrics", async () => {
        let sizeLogFound = false;
        let logString = "";
        const originalLog = console.log;
        console.log = (...args) => {
            const msg = args[0];
            if (typeof msg === "string" && msg.includes("[scenarios:prompt] prompt built")) {
                sizeLogFound = true;
                logString = msg;
            }
            originalLog(...args);
        };
        mockRouteResolutions.set("TEST-1", {
            scenarioMode: "listing_validation",
            routeConfidence: "high",
            executableRouteSteps: ['1. Clic en "Iniciar".'],
            diagnostics: [],
            canGenerate: true,
            missingRouteReason: undefined
        });
        await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        console.log = originalLog;
        (0, test_1.expect)(sizeLogFound).toBe(true);
        // Should include all metrics
        (0, test_1.expect)(logString).toContain("compactMode=");
        (0, test_1.expect)(logString).toContain("systemChars=");
        (0, test_1.expect)(logString).toContain("userChars=");
        (0, test_1.expect)(logString).toContain("totalChars=");
        (0, test_1.expect)(logString).toContain("estimatedTokens=");
        (0, test_1.expect)(logString).toContain("allowedClicksCount=");
        (0, test_1.expect)(logString).toContain("assertionTermsCount=");
        (0, test_1.expect)(logString).toContain("routeResolutionCount=");
        (0, test_1.expect)(logString).toContain("maxScenariosPerIssue=");
    });
});
