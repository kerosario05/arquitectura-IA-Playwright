"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const mcp_scenario_prompt_builder_1 = require("../src/scenarios/mcp-scenario-prompt-builder");
test_1.test.describe("MCP Scenario Prompt Builder - Multiproject Rules", () => {
    const mockIssue = {
        key: "TEST-1",
        summary: "Test issue",
        description: "Test description",
        issueType: "Story",
        status: "To Do",
        labels: [],
        components: [],
        acceptanceCriteria: "Test criteria"
    };
    const mockRouteProfile = {
        name: "test-profile",
        entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
        aliases: {},
        intermediates: {},
        domainTerms: { "producto": "producto bancario" },
        visibleControls: ["Información de productos", "Beneficios", "Requisitos"],
        representativeFixture: {},
        notes: []
    };
    const mockRouteResolutions = new Map();
    mockRouteResolutions.set("TEST-1", {
        scenarioMode: "listing_validation",
        routeConfidence: "high",
        executableRouteSteps: [
            '1. Clic en "Iniciar".',
            '2. Clic en "Información de productos".'
        ],
        diagnostics: [],
        canGenerate: true,
        missingRouteReason: undefined
    });
    const mockFunctionalBranches = [
        {
            branchId: "branch-alfa",
            sourceLabel: "Opción Alfa",
            sourceRequirementId: "option:1",
            actionIntent: "select_option",
            expectedDestination: "Destino Público Alfa",
            accessIntent: "public",
            evidenceSource: "acceptance_criteria",
        },
        {
            branchId: "branch-beta",
            sourceLabel: "Opción Beta",
            sourceRequirementId: "option:2",
            actionIntent: "select_option",
            expectedDestination: "Destino Privado Beta",
            accessIntent: "authenticated",
            evidenceSource: "acceptance_criteria",
        },
        {
            branchId: "branch-gamma",
            sourceLabel: "Opción Gamma",
            sourceRequirementId: "option:3",
            actionIntent: "select_option",
            expectedDestination: "Destino Público Gamma",
            accessIntent: "public",
            evidenceSource: "acceptance_criteria",
        },
    ];
    (0, test_1.test)("system prompt does NOT say visibleControls are clickable by default", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should NOT contain old permissive rule
        (0, test_1.expect)(systemPrompt).not.toContain("visible controls, entry steps, aliases, or domain terms");
        // Should NOT suggest visibleControls are clickable
        (0, test_1.expect)(systemPrompt.toLowerCase()).not.toContain("generate \"clic en\" steps for targets that are visible controls");
    });
    (0, test_1.test)("system prompt says ONLY allowedExecutableClicks permits clicks", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should contain new strict rule
        (0, test_1.expect)(systemPrompt).toContain("ONLY allowed when X is explicitly listed in ALLOWED_EXECUTABLE_CLICKS");
        (0, test_1.expect)(systemPrompt).toContain("ALLOWED_EXECUTABLE_CLICKS is the primary route-profile source of truth for click actions");
        (0, test_1.expect)(systemPrompt).toContain("BRANCH_REQUIRED_CLICKS");
    });
    (0, test_1.test)("system prompt includes enforceable execution context", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should include ALLOWED_EXECUTABLE_CLICKS section
        (0, test_1.expect)(systemPrompt).toContain("ALLOWED_EXECUTABLE_CLICKS");
        (0, test_1.expect)(systemPrompt).toContain("These are the ONLY targets that can appear in \"Clic en\" steps");
    });
    (0, test_1.test)("system prompt includes assertion-only terms handling", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should include rules about assertion-only terms in general
        (0, test_1.expect)(systemPrompt).toContain("ASSERTION_ONLY_TERMS");
        // Even if no specific terms, should explain concept in multiproject rules
        (0, test_1.expect)(systemPrompt).toContain("ASSERTION_ONLY_TERMS → ONLY \"Validar que se muestre");
    });
    (0, test_1.test)("system prompt includes multiproject execution rules", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should include multiproject rules
        (0, test_1.expect)(systemPrompt).toContain("Multiproject Execution Rules");
        (0, test_1.expect)(systemPrompt).toContain("Apply to ALL projects/apps without exception");
        (0, test_1.expect)(systemPrompt).toContain("NO clicks on visibleControls unless also in ALLOWED_EXECUTABLE_CLICKS");
        (0, test_1.expect)(systemPrompt).toContain("NO clicks on domainTerms unless also in ALLOWED_EXECUTABLE_CLICKS");
        (0, test_1.expect)(systemPrompt).toContain("NO clicks on story content sections");
    });
    (0, test_1.test)("system prompt includes content vs controls rules", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should include content/assertion term rules
        (0, test_1.expect)(systemPrompt).toContain("Content/Assertion Terms");
        (0, test_1.expect)(systemPrompt).toContain("Wrong: Clic en \"Beneficios\"");
        (0, test_1.expect)(systemPrompt).toContain("Right: Validar que se muestre \"Beneficios\"");
        (0, test_1.expect)(systemPrompt).toContain("User story sections → Validations only");
        (0, test_1.expect)(systemPrompt).toContain("Expected results → Context only, never executable");
    });
    (0, test_1.test)("system prompt includes key principles", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should include key principles
        (0, test_1.expect)(systemPrompt).toContain("\"visible\" does NOT mean \"clickable\"");
        (0, test_1.expect)(systemPrompt).toContain("\"mentioned in user story\" does NOT mean \"clickable\"");
        (0, test_1.expect)(systemPrompt).toContain("\"domain term\" does NOT mean \"clickable\"");
    });
    (0, test_1.test)("system prompt includes updated detail scenario pattern", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should NOT assume all listings are selectable
        (0, test_1.expect)(systemPrompt).toContain("Do NOT assume all listings are selectable");
        (0, test_1.expect)(systemPrompt).toContain("ONLY if routeResolution includes selection");
        (0, test_1.expect)(systemPrompt).toContain("When NOT to Use Selection");
        (0, test_1.expect)(systemPrompt).toContain("Listing of informational sections");
    });
    (0, test_1.test)("system prompt preserves entry steps rules", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should preserve entry steps rules
        (0, test_1.expect)(systemPrompt).toContain("Entry Steps Rules");
        (0, test_1.expect)(systemPrompt).toContain("EVERY scenario MUST start with them");
        (0, test_1.expect)(systemPrompt).toContain("Do NOT omit, reorder, or modify entry steps");
    });
    (0, test_1.test)("system prompt preserves sensitive actions rules", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should preserve sensitive actions rules
        (0, test_1.expect)(systemPrompt).toContain("Sensitive Actions");
        (0, test_1.expect)(systemPrompt).toContain("Do NOT generate \"Clic en\" for sensitive actions");
    });
    (0, test_1.test)("system prompt is multiproject (no hardcoded app names)", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should NOT contain hardcoded app-specific names
        (0, test_1.expect)(systemPrompt).not.toContain("KIOSKO");
        (0, test_1.expect)(systemPrompt).not.toContain("kiosko");
        (0, test_1.expect)(systemPrompt).not.toContain("arquitectura-automatizacion");
        // Should use generic placeholders
        (0, test_1.expect)(systemPrompt).toContain("test-app"); // From parameter
    });
    (0, test_1.test)("derived context includes REMEMBER section", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions);
        const systemPrompt = messages[0].content;
        // Should include REMEMBER section in derived context
        (0, test_1.expect)(systemPrompt).toContain("### REMEMBER");
        (0, test_1.expect)(systemPrompt).toContain("visibleControls are for VALIDATIONS unless also in ALLOWED_EXECUTABLE_CLICKS");
        (0, test_1.expect)(systemPrompt).toContain("domainTerms are for VALIDATIONS unless also in ALLOWED_EXECUTABLE_CLICKS");
        (0, test_1.expect)(systemPrompt).toContain("When in doubt: \"Validar que se muestre\" not \"Clic en\"");
    });
    (0, test_1.test)("system prompt includes functional branch contract with all required fields", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions, undefined, undefined, undefined, undefined, undefined, undefined, undefined, mockFunctionalBranches);
        const systemPrompt = messages[0].content;
        (0, test_1.expect)(systemPrompt).toContain("Functional Branch Coverage Contract");
        (0, test_1.expect)(systemPrompt).toContain("branchId: branch-alfa");
        (0, test_1.expect)(systemPrompt).toContain("actionIntent: select_option");
        (0, test_1.expect)(systemPrompt).toContain("expectedDestination: Destino Privado Beta");
        (0, test_1.expect)(systemPrompt).toContain("accessIntent: authenticated");
        (0, test_1.expect)(systemPrompt).toContain("visibleObligation: Destino Público Gamma");
        (0, test_1.expect)(systemPrompt).toContain('requiredAction: { type: "click", target: "Opción Alfa", source: "user_story" }');
        (0, test_1.expect)(systemPrompt).toContain("requiredObservableResult: Destino Privado Beta");
        (0, test_1.expect)(systemPrompt).toContain("generate at least one UI-automatable scenario per branchId");
    });
    (0, test_1.test)("branch required clicks remain available when routeProfile is suppressed", async () => {
        const catalogRouteProfile = {
            ...mockRouteProfile,
            entry: [{ businessLabel: "Información de productos", visibleLabel: "Información de productos" }],
        };
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", catalogRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions, undefined, "authenticated_flow", undefined, undefined, undefined, undefined, undefined, mockFunctionalBranches);
        const systemPrompt = messages[0].content;
        (0, test_1.expect)(systemPrompt).toContain("Branch Required Clicks (HU-derived)");
        (0, test_1.expect)(systemPrompt).toContain("BRANCH_REQUIRED_CLICKS:");
        (0, test_1.expect)(systemPrompt).toContain("- Opción Alfa");
        (0, test_1.expect)(systemPrompt).toContain("- Opción Beta");
        (0, test_1.expect)(systemPrompt).toContain("routeProfile context is suppressed for compatibility, but BRANCH_REQUIRED_CLICKS remain mandatory.");
    });
    (0, test_1.test)("system prompt output schema requires scenarioId and functionalBranch payload", async () => {
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([mockIssue], "test-app", undefined, "test-app", "Test App", mockRouteProfile, [{ action: "click", target: "Iniciar" }], "password", mockRouteResolutions, undefined, undefined, undefined, undefined, undefined, undefined, undefined, mockFunctionalBranches);
        const systemPrompt = messages[0].content;
        (0, test_1.expect)(systemPrompt).toContain('"scenarioId": "AA-123:branch-example:01"');
        (0, test_1.expect)(systemPrompt).toContain('"functionalBranch": {');
        (0, test_1.expect)(systemPrompt).toContain('"branchId": "branch-example"');
        (0, test_1.expect)(systemPrompt).toContain('"accessIntent": "public|authenticated|unknown"');
    });
});
