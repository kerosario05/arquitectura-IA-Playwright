import { test, expect } from "@playwright/test";
import { generateScenariosWithAi } from "../src/scenarios/codex-scenario-generator";
import type { JiraIssueSource, McpRouteProfile } from "../src/scenarios/scenario-types";
import type { AiProvider, AiCompletionRequest, AiCompletionResponse } from "../src/ai/ai-provider.types";

// Fake AI provider for testing
class FakeAiProvider implements AiProvider {
  providerType = "fake" as const;
  providerName = "fake-provider";
  model = "fake-model";

  async completeJson(request: AiCompletionRequest): Promise<AiCompletionResponse> {
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

test.describe("Blocked Scenarios Response Contract", () => {
  const completeRouteProfile: McpRouteProfile = {
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

  const createIssue = (key: string, description: string): JiraIssueSource => ({
    key,
    summary: `Test scenario ${key}`,
    description,
    acceptanceCriteria: null,
    labels: [],
    components: [],
    status: "In Progress",
    issueType: "Story"
  });

  test("should include routeResolutions in response when issues are blocked", async () => {
    const issue = createIssue("AA-82", "Visualizar productos");
    const fakeProvider = new FakeAiProvider();

    const result = await generateScenariosWithAi(
      [issue],
      "arquitectura-automatizacion",
      undefined,
      "arquitectura-automatizacion",
      "Test App",
      null, // No route profile → blocked
      undefined,
      undefined,
      fakeProvider
    );

    // Should have routeResolutions
    expect(result.routeResolutions).toBeDefined();
    expect(result.routeResolutions?.size).toBe(1);

    // Should have resolution for AA-82
    const resolution = result.routeResolutions?.get("AA-82");
    expect(resolution).toBeDefined();
    expect(resolution?.canGenerate).toBe(false);
    expect(resolution?.missingRouteReason).toContain("needs_route_profile");
    expect(resolution?.diagnostics.length).toBeGreaterThan(0);
    expect(resolution?.diagnostics[0].level).toBe("error");
    expect(resolution?.diagnostics[0].code).toBe("needs_route_profile");
  });

  test("should include routeResolutions for both backed and blocked issues", async () => {
    const backedIssue = createIssue("AA-100", "Visualizar detalle de tarjetas");
    const blockedIssue = createIssue("AA-101", "Realizar operación");
    const fakeProvider = new FakeAiProvider();

    const result = await generateScenariosWithAi(
      [backedIssue, blockedIssue],
      "arquitectura-automatizacion",
      undefined,
      "arquitectura-automatizacion",
      "Test App",
      completeRouteProfile,
      undefined,
      undefined,
      fakeProvider
    );

    // Should have routeResolutions for both
    expect(result.routeResolutions).toBeDefined();
    expect(result.routeResolutions?.size).toBe(2);

    // AA-100 should be backed (detail_navigation with high confidence)
    const resolution100 = result.routeResolutions?.get("AA-100");
    expect(resolution100).toBeDefined();
    expect(resolution100?.canGenerate).toBe(true);
    expect(resolution100?.scenarioMode).toBe("detail_navigation");

    // AA-101 should be backed (unknown mode with low confidence)
    const resolution101 = result.routeResolutions?.get("AA-101");
    expect(resolution101).toBeDefined();
    expect(resolution101?.canGenerate).toBe(true); // unknown mode still allows generation
    expect(resolution101?.scenarioMode).toBe("unknown");
  });

  test("should have rejected array with blocked issues when all blocked", async () => {
    const issue1 = createIssue("AA-200", "Backend operation");
    const issue2 = createIssue("AA-201", "Manual process");
    const fakeProvider = new FakeAiProvider();

    const result = await generateScenariosWithAi(
      [issue1, issue2],
      "arquitectura-automatizacion",
      undefined,
      "arquitectura-automatizacion",
      "Test App",
      null, // No route profile → all blocked
      undefined,
      undefined,
      fakeProvider
    );

    // Should have rejected array with both issues
    expect(result.rejected.length).toBe(2);
    expect(result.rejected[0].sourceIssueKey).toBe("AA-200");
    expect(result.rejected[0].reason).toContain("needs_route_profile");
    expect(result.rejected[1].sourceIssueKey).toBe("AA-201");
    expect(result.rejected[1].reason).toContain("needs_route_profile");

    // Should have routeResolutions
    expect(result.routeResolutions?.size).toBe(2);

    // Both should be blocked
    expect(result.routeResolutions?.get("AA-200")?.canGenerate).toBe(false);
    expect(result.routeResolutions?.get("AA-201")?.canGenerate).toBe(false);
  });
});
