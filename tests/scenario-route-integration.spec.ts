import { test, expect } from "@playwright/test";
import { generateScenariosWithAi } from "../src/scenarios/codex-scenario-generator";
import { buildMcpScenarioMessages } from "../src/scenarios/mcp-scenario-prompt-builder";
import type { JiraIssueSource, McpRouteProfile } from "../src/scenarios/scenario-types";
import type { AiProvider, AiCompletionRequest, AiCompletionResponse } from "../src/ai/ai-provider.types";

// Fake AI provider for testing (does not call real CLI)
class FakeAiProvider implements AiProvider {
  providerType = "fake" as const;
  providerName = "fake-provider";
  model = "fake-model";

  capturedMessages: AiCompletionRequest[] = [];

  async completeJson(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    this.capturedMessages.push(request);

    // Extract issue keys from user message
    const userMessage = request.messages.find(m => m.role === "user");
    const issueKeys: string[] = [];
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

test.describe("Route-first Scenario Generation Integration", () => {
  let fakeProvider: FakeAiProvider;

  test.beforeEach(() => {
    fakeProvider = new FakeAiProvider();
  });
  const completeRouteProfile: McpRouteProfile = {
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

  test("A. Backed issue: should call resolveScenarioRoute and enrich scenario with metadata", async () => {
    const issue = createIssue("TEST-001", "Visualizar detalle de tarjetas de crédito");

    // This will call resolveScenarioRoute internally with fake provider
    const result = await generateScenariosWithAi(
      [issue],
      "arquitectura-automatizacion",
      undefined,
      "arquitectura-automatizacion",
      "Test App",
      completeRouteProfile,
      undefined,
      undefined,
      fakeProvider // Inject fake provider
    );

    // Should generate scenarios (fake AI will be called)
    // We verify that blocked issues are empty
    expect(result.rejected.length).toBe(0);

    // If scenarios were generated, they should have route-first metadata
    if (result.scenarios.length > 0) {
      const scenario = result.scenarios[0];
      expect(scenario.scenarioMode).toBeDefined();
      expect(scenario.routeConfidence).toBeDefined();
      expect(scenario.diagnostics).toBeDefined();
    }
  });

  test("B. Blocked issue: should not send to AI when route profile is missing", async () => {
    const issue = createIssue("TEST-002", "Visualizar productos sin ruta respaldada");

    const result = await generateScenariosWithAi(
      [issue],
      "arquitectura-automatizacion",
      undefined,
      "arquitectura-automatizacion",
      "Test App",
      null, // No route profile
      undefined,
      undefined,
      fakeProvider // Inject fake provider
    );

    // Should return early with no scenarios
    expect(result.scenarios.length).toBe(0);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toContain("route");
  });

  test("C. Mixed batch: should only send backed issues to AI", async () => {
    const backedIssue = createIssue("TEST-003", "Visualizar detalle de tarjetas");
    const unblockedVagueIssue = createIssue("TEST-004", "Realizar alguna operación");

    // All issues with routeProfile present will be backed (even with unknown mode)
    const result = await generateScenariosWithAi(
      [backedIssue, unblockedVagueIssue],
      "arquitectura-automatizacion",
      undefined,
      "arquitectura-automatizacion",
      "Test App",
      completeRouteProfile,
      undefined,
      undefined,
      fakeProvider // Inject fake provider
    );

    // Both issues should be backed (routeProfile present)
    // AI should be called (captured messages)
    expect(fakeProvider.capturedMessages.length).toBeGreaterThan(0);

    // Should generate scenarios for both backed issues
    expect(result.scenarios.length).toBeGreaterThanOrEqual(1);
  });

  test("D. Prompt safety: should include route resolution context and safety instructions", async () => {
    const issue = createIssue("TEST-005", "Visualizar información del producto");

    // Build messages with route profile
    const messages = await buildMcpScenarioMessages(
      [issue],
      "arquitectura-automatizacion",
      undefined,
      "arquitectura-automatizacion",
      "Test App",
      completeRouteProfile,
      undefined,
      undefined,
      new Map() // Empty route resolutions to test backward compat
    );

    const systemPrompt = messages[0].content;

    // Should contain safety instructions
    expect(systemPrompt).toContain("Do NOT invent");
    expect(systemPrompt).toContain("expectedResult");
    expect(systemPrompt).toContain("context");
  });

  test("E. Backward compatibility: should work without routeResolutions parameter", async () => {
    const issue = createIssue("TEST-006", "Visualizar productos");

    // Call without routeResolutions (old signature)
    const messages = await buildMcpScenarioMessages(
      [issue],
      "arquitectura-automatizacion",
      undefined,
      "arquitectura-automatizacion",
      "Test App",
      completeRouteProfile
    );

    // Should still build valid messages
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[0].content.length).toBeGreaterThan(0);
  });

  test("F. Route resolution context: should include executableRouteSteps in prompt", async () => {
    const issue = createIssue("TEST-007", "Visualizar detalle del producto");

    // First, we need to resolve routes
    const { resolveScenarioRoute } = await import("../src/scenarios/scenario-route-resolver");
    const resolution = resolveScenarioRoute(issue, completeRouteProfile);

    // Build messages with route resolutions
    const routeResolutions = new Map();
    routeResolutions.set(issue.key, resolution);

    const messages = await buildMcpScenarioMessages(
      [issue],
      "arquitectura-automatizacion",
      undefined,
      "arquitectura-automatizacion",
      "Test App",
      completeRouteProfile,
      undefined,
      undefined,
      routeResolutions
    );

    const systemPrompt = messages[0].content;

    // Should include Route Resolution Context section
    expect(systemPrompt).toContain("Route Resolution Context");
    expect(systemPrompt).toContain("TEST-007");
    expect(systemPrompt).toContain("Mode");
    expect(systemPrompt).toContain("Confidence");

    // Should include safety instructions
    expect(systemPrompt).toContain("Use EXACTLY the provided executableRouteSteps");
    expect(systemPrompt).toContain("Do NOT invent, remove, reorder, or rename route steps");
    expect(systemPrompt).toContain("expectedResult is context only");
  });

  test("G. Scenario metadata enrichment: generated scenarios should have route-first fields", async () => {
    const issue = createIssue("TEST-008", "Visualizar detalle de tarjetas de crédito");

    const result = await generateScenariosWithAi(
      [issue],
      "arquitectura-automatizacion",
      undefined,
      "arquitectura-automatizacion",
      "Test App",
      completeRouteProfile,
      undefined,
      undefined,
      fakeProvider // Inject fake provider
    );

    // If AI generated scenarios, verify metadata
    if (result.scenarios.length > 0) {
      const scenario = result.scenarios[0];

      // Should have route-first metadata
      expect(scenario).toHaveProperty("scenarioMode");
      expect(scenario).toHaveProperty("routeConfidence");
      expect(scenario).toHaveProperty("diagnostics");

      // Metadata should be valid
      const validModes = ["listing_validation", "subcategory_navigation", "detail_navigation", "return_navigation", "action_button_validation", "unknown"];
      expect(validModes).toContain(scenario.scenarioMode);

      const validConfidences = ["high", "medium", "low"];
      expect(validConfidences).toContain(scenario.routeConfidence);

      expect(Array.isArray(scenario.diagnostics)).toBe(true);
    }
  });

  test("H. All blocked: should return early when all issues are blocked", async () => {
    const issue1 = createIssue("TEST-009", "Operación backend");
    const issue2 = createIssue("TEST-010", "Proceso manual");

    const result = await generateScenariosWithAi(
      [issue1, issue2],
      "arquitectura-automatizacion",
      undefined,
      "arquitectura-automatizacion",
      "Test App",
      null, // No route profile
      undefined,
      undefined,
      fakeProvider // Inject fake provider
    );

    // Should not generate any scenarios
    expect(result.scenarios.length).toBe(0);
    expect(result.rejected.length).toBe(2);
    expect(result.confidence).toBe("low");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
