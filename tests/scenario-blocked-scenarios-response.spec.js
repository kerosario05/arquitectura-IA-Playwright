"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const codex_scenario_generator_1 = require("../src/scenarios/codex-scenario-generator");
// Fake AI provider for testing
class FakeAiProvider {
    providerType = "fake";
    providerName = "fake-provider";
    model = "fake-model";
    async completeJson(request) {
        const fakeResponse = {
            appSlug: "arquitectura-automatizacion",
            targetAppSlug: "arquitectura-automatizacion",
            targetAppName: "Test App",
            confidence: "high",
            reason: "Fake generation",
            functionalRoute: "test",
            routeProfile: {
                name: "test",
                entry: [],
                aliases: {},
                intermediates: {},
                domainTerms: {},
                visibleControls: [],
                representativeFixture: {},
                notes: []
            },
            scenarios: [],
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
test_1.test.describe("Blocked Scenarios Response Contract", () => {
    const completeRouteProfile = {
        name: "informacion_productos",
        entry: [
            { businessLabel: "iniciar", visibleLabel: "Iniciar" },
            { businessLabel: "informacion_productos", visibleLabel: "Información de productos" }
        ],
        aliases: {
            tarjetas: ["Tarjetas de crédito", "Tarjetas"]
        },
        intermediates: {},
        domainTerms: {
            producto: ["producto", "tarjeta"]
        },
        visibleControls: ["Iniciar", "Información de productos", "Tarjetas"],
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
    (0, test_1.test)("should include routeResolutions in response when issues are blocked", async () => {
        const issue = createIssue("AA-82", "Visualizar productos");
        const fakeProvider = new FakeAiProvider();
        const result = await (0, codex_scenario_generator_1.generateScenariosWithAi)([issue], "arquitectura-automatizacion", undefined, "arquitectura-automatizacion", "Test App", null, // No route profile → blocked
        undefined, undefined, fakeProvider);
        // Should have routeResolutions
        (0, test_1.expect)(result.routeResolutions).toBeDefined();
        (0, test_1.expect)(result.routeResolutions?.size).toBe(1);
        // Should have resolution for AA-82
        const resolution = result.routeResolutions?.get("AA-82");
        (0, test_1.expect)(resolution).toBeDefined();
        (0, test_1.expect)(resolution?.canGenerate).toBe(false);
        (0, test_1.expect)(resolution?.missingRouteReason).toContain("needs_route_profile");
        (0, test_1.expect)(resolution?.diagnostics.length).toBeGreaterThan(0);
        (0, test_1.expect)(resolution?.diagnostics[0].level).toBe("error");
        (0, test_1.expect)(resolution?.diagnostics[0].code).toBe("needs_route_profile");
    });
    (0, test_1.test)("should include routeResolutions for both backed and blocked issues", async () => {
        const backedIssue = createIssue("AA-100", "Visualizar detalle de tarjetas");
        const blockedIssue = createIssue("AA-101", "Realizar operación");
        const fakeProvider = new FakeAiProvider();
        const result = await (0, codex_scenario_generator_1.generateScenariosWithAi)([backedIssue, blockedIssue], "arquitectura-automatizacion", undefined, "arquitectura-automatizacion", "Test App", completeRouteProfile, undefined, undefined, fakeProvider);
        // Should have routeResolutions for both
        (0, test_1.expect)(result.routeResolutions).toBeDefined();
        (0, test_1.expect)(result.routeResolutions?.size).toBe(2);
        // AA-100 should be backed (detail_navigation with high confidence)
        const resolution100 = result.routeResolutions?.get("AA-100");
        (0, test_1.expect)(resolution100).toBeDefined();
        (0, test_1.expect)(resolution100?.canGenerate).toBe(true);
        (0, test_1.expect)(resolution100?.scenarioMode).toBe("detail_navigation");
        // AA-101 should be backed (unknown mode with low confidence)
        const resolution101 = result.routeResolutions?.get("AA-101");
        (0, test_1.expect)(resolution101).toBeDefined();
        (0, test_1.expect)(resolution101?.canGenerate).toBe(true); // unknown mode still allows generation
        (0, test_1.expect)(resolution101?.scenarioMode).toBe("unknown");
    });
    (0, test_1.test)("should have rejected array with blocked issues when all blocked", async () => {
        const issue1 = createIssue("AA-200", "Backend operation");
        const issue2 = createIssue("AA-201", "Manual process");
        const fakeProvider = new FakeAiProvider();
        const result = await (0, codex_scenario_generator_1.generateScenariosWithAi)([issue1, issue2], "arquitectura-automatizacion", undefined, "arquitectura-automatizacion", "Test App", null, // No route profile → all blocked
        undefined, undefined, fakeProvider);
        // Should have rejected array with both issues
        (0, test_1.expect)(result.rejected.length).toBe(2);
        (0, test_1.expect)(result.rejected[0].sourceIssueKey).toBe("AA-200");
        (0, test_1.expect)(result.rejected[0].reason).toContain("needs_route_profile");
        (0, test_1.expect)(result.rejected[1].sourceIssueKey).toBe("AA-201");
        (0, test_1.expect)(result.rejected[1].reason).toContain("needs_route_profile");
        // Should have routeResolutions
        (0, test_1.expect)(result.routeResolutions?.size).toBe(2);
        // Both should be blocked
        (0, test_1.expect)(result.routeResolutions?.get("AA-200")?.canGenerate).toBe(false);
        (0, test_1.expect)(result.routeResolutions?.get("AA-201")?.canGenerate).toBe(false);
    });
});
