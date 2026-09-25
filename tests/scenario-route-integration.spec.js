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
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const codex_scenario_generator_1 = require("../src/scenarios/codex-scenario-generator");
const mcp_scenario_prompt_builder_1 = require("../src/scenarios/mcp-scenario-prompt-builder");
// Fake AI provider for testing (does not call real CLI)
class FakeAiProvider {
    providerType = "fake";
    providerName = "fake-provider";
    model = "fake-model";
    capturedMessages = [];
    async completeJson(request) {
        this.capturedMessages.push(request);
        // Extract issue keys from user message
        const userMessage = request.messages.find(m => m.role === "user");
        const issueKeys = [];
        if (userMessage) {
            // Match TEST-NNN pattern
            const matches = userMessage.content.matchAll(/TEST-\d+/g);
            for (const match of matches) {
                issueKeys.push(match[0]);
            }
        }
        // Generate scenarios for each issue key found
        const scenarios = issueKeys.map(key => ({
            sourceIssueKey: key,
            title: `Fake scenario for ${key}`,
            steps: ["1. Clic en \"Iniciar\".", "2. Validar que se muestre \"Test\"."],
            preconditions: ["1. BASE_URL configured."],
            expectedResult: "Fake result",
            type: "Functional",
            database: "QA",
            isConverted: 0,
            automationType: "ui_with_auth_gate",
            setupStrategy: "auth_gate",
            appSlug: "arquitectura-automatizacion",
            targetAppSlug: "arquitectura-automatizacion",
            targetAppName: "Test App",
            routeProfile: "test_profile",
            dataRequirements: "",
            nonExecutableCriteria: "",
            mcpExecutable: true
        }));
        // Return minimal valid McpGenerationResponse compatible with parseAiResponse
        const fakeResponse = {
            appSlug: "arquitectura-automatizacion",
            targetAppSlug: "arquitectura-automatizacion",
            targetAppName: "Test App",
            confidence: "high",
            reason: "Fake AI generation for testing",
            functionalRoute: "test route",
            routeProfile: {
                name: "test_profile",
                entry: [],
                aliases: {},
                intermediates: {},
                domainTerms: {},
                visibleControls: [],
                representativeFixture: {},
                notes: []
            },
            scenarios,
            warnings: [],
            rejected: []
        };
        return {
            rawText: JSON.stringify(fakeResponse),
            parsedJson: fakeResponse,
            model: this.model,
            providerName: this.providerName,
            durationMs: 10
        };
    }
}
test_1.test.describe("Route-first Scenario Generation Integration", () => {
    let fakeProvider;
    test_1.test.beforeEach(() => {
        fakeProvider = new FakeAiProvider();
    });
    const completeRouteProfile = {
        name: "informacion_productos",
        entry: [
            { businessLabel: "iniciar", visibleLabel: "Iniciar" },
            { businessLabel: "informacion_productos", visibleLabel: "Información de productos" }
        ],
        aliases: {
            tarjetas: ["Tarjetas de crédito", "Tarjetas"],
            depositos: ["Depósitos a Plazo"]
        },
        intermediates: {
            tarjetas: ["Tarjeta de Crédito"]
        },
        domainTerms: {
            producto: ["producto", "tarjeta", "depósito"]
        },
        visibleControls: [
            "Iniciar",
            "Información de productos",
            "Tarjetas",
            "Depósitos a Plazo",
            "Préstamos"
        ],
        representativeFixture: {},
        notes: []
    };
    const createIssue = (key, description) => ({
        key,
        summary: `Test scenario ${key}`,
        description,
        acceptanceCriteria: null,
        labels: [],
        components: [],
        status: "In Progress",
        issueType: "Story"
    });
    (0, test_1.test)("A. Backed issue: should call resolveScenarioRoute and enrich scenario with metadata", async () => {
        const issue = createIssue("TEST-001", "Visualizar detalle de tarjetas de crédito");
        // This will call resolveScenarioRoute internally with fake provider
        const result = await (0, codex_scenario_generator_1.generateScenariosWithAi)([issue], "arquitectura-automatizacion", undefined, "arquitectura-automatizacion", "Test App", completeRouteProfile, undefined, undefined, fakeProvider // Inject fake provider
        );
        // Should generate scenarios (fake AI will be called)
        // We verify that blocked issues are empty
        (0, test_1.expect)(result.rejected.length).toBe(0);
        // If scenarios were generated, they should have route-first metadata
        if (result.scenarios.length > 0) {
            const scenario = result.scenarios[0];
            (0, test_1.expect)(scenario.scenarioMode).toBeDefined();
            (0, test_1.expect)(scenario.routeConfidence).toBeDefined();
            (0, test_1.expect)(scenario.diagnostics).toBeDefined();
        }
    });
    (0, test_1.test)("B. Blocked issue: should not send to AI when route profile is missing", async () => {
        const issue = createIssue("TEST-002", "Visualizar productos sin ruta respaldada");
        const result = await (0, codex_scenario_generator_1.generateScenariosWithAi)([issue], "arquitectura-automatizacion", undefined, "arquitectura-automatizacion", "Test App", null, // No route profile
        undefined, undefined, fakeProvider // Inject fake provider
        );
        // Should return early with no scenarios
        (0, test_1.expect)(result.scenarios.length).toBe(0);
        (0, test_1.expect)(result.rejected.length).toBe(1);
        (0, test_1.expect)(result.rejected[0].reason).toContain("route");
    });
    (0, test_1.test)("C. Mixed batch: should only send backed issues to AI", async () => {
        const backedIssue = createIssue("TEST-003", "Visualizar detalle de tarjetas");
        const unblockedVagueIssue = createIssue("TEST-004", "Realizar alguna operación");
        // All issues with routeProfile present will be backed (even with unknown mode)
        const result = await (0, codex_scenario_generator_1.generateScenariosWithAi)([backedIssue, unblockedVagueIssue], "arquitectura-automatizacion", undefined, "arquitectura-automatizacion", "Test App", completeRouteProfile, undefined, undefined, fakeProvider // Inject fake provider
        );
        // Both issues should be backed (routeProfile present)
        // AI should be called (captured messages)
        (0, test_1.expect)(fakeProvider.capturedMessages.length).toBeGreaterThan(0);
        // Should generate scenarios for both backed issues
        (0, test_1.expect)(result.scenarios.length).toBeGreaterThanOrEqual(1);
    });
    (0, test_1.test)("D. Prompt safety: should include route resolution context and safety instructions", async () => {
        const issue = createIssue("TEST-005", "Visualizar información del producto");
        // Build messages with route profile
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([issue], "arquitectura-automatizacion", undefined, "arquitectura-automatizacion", "Test App", completeRouteProfile, undefined, undefined, new Map() // Empty route resolutions to test backward compat
        );
        const systemPrompt = messages[0].content;
        // Should contain safety instructions
        (0, test_1.expect)(systemPrompt).toContain("Do NOT invent");
        (0, test_1.expect)(systemPrompt).toContain("expectedResult");
        (0, test_1.expect)(systemPrompt).toContain("context");
    });
    (0, test_1.test)("E. Backward compatibility: should work without routeResolutions parameter", async () => {
        const issue = createIssue("TEST-006", "Visualizar productos");
        // Call without routeResolutions (old signature)
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([issue], "arquitectura-automatizacion", undefined, "arquitectura-automatizacion", "Test App", completeRouteProfile);
        // Should still build valid messages
        (0, test_1.expect)(messages.length).toBe(2);
        (0, test_1.expect)(messages[0].role).toBe("system");
        (0, test_1.expect)(messages[1].role).toBe("user");
        (0, test_1.expect)(messages[0].content.length).toBeGreaterThan(0);
    });
    (0, test_1.test)("F. Route resolution context: should include executableRouteSteps in prompt", async () => {
        const issue = createIssue("TEST-007", "Visualizar detalle del producto");
        // First, we need to resolve routes
        const { resolveScenarioRoute } = await Promise.resolve().then(() => __importStar(require("../src/scenarios/scenario-route-resolver")));
        const resolution = resolveScenarioRoute(issue, completeRouteProfile);
        // Build messages with route resolutions
        const routeResolutions = new Map();
        routeResolutions.set(issue.key, resolution);
        const messages = await (0, mcp_scenario_prompt_builder_1.buildMcpScenarioMessages)([issue], "arquitectura-automatizacion", undefined, "arquitectura-automatizacion", "Test App", completeRouteProfile, undefined, undefined, routeResolutions);
        const systemPrompt = messages[0].content;
        // Should include Route Resolution Context section
        (0, test_1.expect)(systemPrompt).toContain("Route Resolution Context");
        (0, test_1.expect)(systemPrompt).toContain("TEST-007");
        (0, test_1.expect)(systemPrompt).toContain("Mode");
        (0, test_1.expect)(systemPrompt).toContain("Confidence");
        // Should include safety instructions
        (0, test_1.expect)(systemPrompt).toContain("Use EXACTLY the provided executableRouteSteps");
        (0, test_1.expect)(systemPrompt).toContain("Do NOT invent, remove, reorder, or rename route steps");
        (0, test_1.expect)(systemPrompt).toContain("expectedResult is context only");
    });
    (0, test_1.test)("G. Scenario metadata enrichment: generated scenarios should have route-first fields", async () => {
        const issue = createIssue("TEST-008", "Visualizar detalle de tarjetas de crédito");
        const result = await (0, codex_scenario_generator_1.generateScenariosWithAi)([issue], "arquitectura-automatizacion", undefined, "arquitectura-automatizacion", "Test App", completeRouteProfile, undefined, undefined, fakeProvider // Inject fake provider
        );
        // If AI generated scenarios, verify metadata
        if (result.scenarios.length > 0) {
            const scenario = result.scenarios[0];
            // Should have route-first metadata
            (0, test_1.expect)(scenario).toHaveProperty("scenarioMode");
            (0, test_1.expect)(scenario).toHaveProperty("routeConfidence");
            (0, test_1.expect)(scenario).toHaveProperty("diagnostics");
            // Metadata should be valid
            const validModes = ["listing_validation", "subcategory_navigation", "detail_navigation", "return_navigation", "action_button_validation", "unknown"];
            (0, test_1.expect)(validModes).toContain(scenario.scenarioMode);
            const validConfidences = ["high", "medium", "low"];
            (0, test_1.expect)(validConfidences).toContain(scenario.routeConfidence);
            (0, test_1.expect)(Array.isArray(scenario.diagnostics)).toBe(true);
        }
    });
    (0, test_1.test)("H. All blocked: should return early when all issues are blocked", async () => {
        const issue1 = createIssue("TEST-009", "Operación backend");
        const issue2 = createIssue("TEST-010", "Proceso manual");
        const result = await (0, codex_scenario_generator_1.generateScenariosWithAi)([issue1, issue2], "arquitectura-automatizacion", undefined, "arquitectura-automatizacion", "Test App", null, // No route profile
        undefined, undefined, fakeProvider // Inject fake provider
        );
        // Should not generate any scenarios
        (0, test_1.expect)(result.scenarios.length).toBe(0);
        (0, test_1.expect)(result.rejected.length).toBe(2);
        (0, test_1.expect)(result.confidence).toBe("low");
        (0, test_1.expect)(result.warnings.length).toBeGreaterThan(0);
    });
});
