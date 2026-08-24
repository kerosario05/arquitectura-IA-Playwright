import assert from "node:assert";
import { generateScenariosWithAi } from "./codex-scenario-generator";
import { validateScenario } from "./scenario-validator";
import type { AiCompletionRequest, AiCompletionResponse, AiProvider, AiUsageMetrics } from "../ai/ai-provider.types";
import type { JiraIssueSource, McpRouteProfile, McpScenario } from "./scenario-types";

function test(label: string, fn: () => Promise<void> | void): void {
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`  PASS  ${label}`))
    .catch((err) => {
      console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

describe("generateScenariosWithAi route_pending purpose", () => {
  const issues: JiraIssueSource[] = [
    {
      key: "HU-1",
      summary: "Transferir fondos entre cuentas",
      description: "El usuario realiza una transferencia normal.",
      acceptanceCriteria: "Dado que estoy autenticado, cuando confirmo transferencia, entonces veo resultado.",
      labels: [],
      components: [],
      status: "To Do",
      issueType: "Story"
    }
  ];

  const routeProfile: McpRouteProfile = {
    name: "Catalog-like profile",
    entry: [{ businessLabel: "productos", visibleLabel: "Productos" }],
    aliases: {},
    intermediates: {},
    domainTerms: {},
    visibleControls: [],
    representativeFixture: {},
    notes: [],
    targetPaths: {
      sample: {
        target: "Producto A",
        requiredIntermediates: [],
        productMetadata: {
          productLabel: "Producto A",
          normalizedLabel: "producto a",
          subcategory: "Ahorros"
        }
      }
    }
  };

  async function runRoutePendingCase(
    scenario: Record<string, unknown>,
    usage?: AiUsageMetrics,
    options?: { launchId?: string; issueKey?: string; appSlug?: string },
  ): Promise<{ calls: AiCompletionRequest[]; response: Awaited<ReturnType<typeof generateScenariosWithAi>> }> {
    const calls: AiCompletionRequest[] = [];
    const issueKey = options?.issueKey ?? issues[0].key;
    const appSlug = options?.appSlug ?? "default";
    const mockProvider: AiProvider = {
      providerType: "fake",
      providerName: "mock",
      model: "mock-model",
      async completeJson(request: AiCompletionRequest): Promise<AiCompletionResponse> {
        calls.push(request);
        return {
          rawText: JSON.stringify({ scenarios: [scenario] }),
          parsedJson: { scenarios: [scenario] },
          model: "mock-model",
          providerName: "mock",
          durationMs: 1,
          usage
        };
      }
    };

    const response = await generateScenariosWithAi(
      [{ ...issues[0], key: issueKey }],
      appSlug,
      undefined,
      undefined,
      undefined,
      routeProfile,
      undefined,
      undefined,
      mockProvider
      ,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { launchId: options?.launchId },
    );

    return { calls, response };
  }

  test("preserves mcpExecutable=true and sends scenario_generation purpose", async () => {
    const { calls, response } = await runRoutePendingCase({
      title: "Escenario ejecutable",
      steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
      mcpExecutable: true
    });

    assert.strictEqual(calls.length, 1, "route_pending should call provider once");
    assert.strictEqual(calls[0].purpose, "scenario_generation");
    assert.strictEqual(response.generationDiagnostics?.generationMode, "route_pending");
    assert.strictEqual(response.generationDiagnostics?.aiPurpose, "scenario_generation");
    assert.ok(Array.isArray(response.scenarios));
    assert.strictEqual(response.scenarios.length, 1, "valid scenario must not be dropped");
    assert.strictEqual(response.scenarios[0].title, "Escenario ejecutable");
    assert.strictEqual(response.scenarios[0].mcpExecutable, true);
  });

  test("preserves mcpExecutable=false without promoting to true", async () => {
    const { calls, response } = await runRoutePendingCase({
      title: "Escenario no ejecutable",
      steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
      mcpExecutable: false
    });

    assert.strictEqual(calls.length, 1, "route_pending should call provider once");
    assert.strictEqual(calls[0].purpose, "scenario_generation");
    assert.strictEqual(response.generationDiagnostics?.generationMode, "route_pending");
    assert.strictEqual(response.scenarios.length, 1);
    assert.strictEqual(response.scenarios[0].mcpExecutable, false);
  });

  test("does not invent mcpExecutable=true when field is missing", async () => {
    const { calls, response } = await runRoutePendingCase({
      title: "Escenario sin bandera",
      steps: ["Seleccionar una opción visible.", "Validar el resultado visible."]
    });

    assert.strictEqual(calls.length, 1, "route_pending should call provider once");
    assert.strictEqual(calls[0].purpose, "scenario_generation");
    assert.strictEqual(response.generationDiagnostics?.generationMode, "route_pending");
    assert.strictEqual(response.scenarios.length, 1);
    assert.ok(!Object.prototype.hasOwnProperty.call(response.scenarios[0], "mcpExecutable"));
  });

  test("preserves structured usage metrics without double counting", async () => {
    const usage: AiUsageMetrics = {
      inputTokens: 100,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 0,
      nonCachedInputTokens: 40,
      outputTokens: 20,
      reasoningOutputTokens: 5,
      totalPhysicalTokens: 120,
      durationMs: 1500,
      success: true
    };

    const { response } = await runRoutePendingCase({
      title: "Escenario con usage",
      steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
      mcpExecutable: true
    }, usage);

    assert.strictEqual(response.generationDiagnostics?.aiPurpose, "scenario_generation");
    assert.strictEqual(response.generationDiagnostics?.generationMode, "route_pending");
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.inputTokens, 100);
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.cachedInputTokens, 60);
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.nonCachedInputTokens, 40);
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.outputTokens, 20);
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.reasoningOutputTokens, 5);
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.totalPhysicalTokens, 120);
  });

  test("correlates launchId, sourceIssueKey, appSlug, purpose/mode and usage in one diagnostics record", async () => {
    const usage: AiUsageMetrics = {
      inputTokens: 100,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 0,
      nonCachedInputTokens: 40,
      outputTokens: 20,
      reasoningOutputTokens: 5,
      totalPhysicalTokens: 120,
      durationMs: 1500,
      success: true
    };

    const { response } = await runRoutePendingCase({
      title: "Escenario correlacionado",
      steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
      mcpExecutable: true
    }, usage, {
      launchId: "launch-test-001",
      issueKey: "HU-TEST-001",
      appSlug: "proyecto-prueba",
    });

    assert.strictEqual(response.generationDiagnostics?.launchId, "launch-test-001");
    assert.strictEqual(response.generationDiagnostics?.sourceIssueKey, "HU-TEST-001");
    assert.strictEqual(response.generationDiagnostics?.appSlug, "proyecto-prueba");
    assert.strictEqual(response.generationDiagnostics?.aiPurpose, "scenario_generation");
    assert.strictEqual(response.generationDiagnostics?.generationMode, "route_pending");
    assert.strictEqual(response.generationDiagnostics?.aiProvider, "mock");
    assert.strictEqual(response.generationDiagnostics?.aiModel, "mock-model");
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.totalPhysicalTokens, 120);
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.reasoningOutputTokens, 5);
  });

  test("handles missing usage fields without inventing values", async () => {
    const { response } = await runRoutePendingCase({
      title: "Escenario sin usage completo",
      steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
      mcpExecutable: true
    }, {
      inputTokens: 100,
      outputTokens: 20
    });

    assert.strictEqual(response.generationDiagnostics?.aiUsage?.inputTokens, 100);
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.outputTokens, 20);
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.cachedInputTokens, undefined);
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.nonCachedInputTokens, undefined);
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.totalPhysicalTokens, undefined);
  });

  test("keeps partial identifiers without inventing launchId", async () => {
    const { response } = await runRoutePendingCase({
      title: "Escenario con identificadores parciales",
      steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
      mcpExecutable: true
    }, {
      inputTokens: 100,
      outputTokens: 20
    }, {
      issueKey: "HU-PARCIAL-001",
      appSlug: "app-parcial",
    });

    assert.strictEqual(response.generationDiagnostics?.launchId, undefined);
    assert.strictEqual(response.generationDiagnostics?.sourceIssueKey, "HU-PARCIAL-001");
    assert.strictEqual(response.generationDiagnostics?.appSlug, "app-parcial");
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.inputTokens, 100);
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.outputTokens, 20);
  });

  test("supports generation without Jira sourceIssueKey while preserving launchId/appSlug", async () => {
    const { response } = await runRoutePendingCase({
      title: "Escenario sin HU",
      steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
      mcpExecutable: true
    }, {
      inputTokens: 90,
      outputTokens: 10
    }, {
      launchId: "launch-no-jira-001",
      issueKey: "   ",
      appSlug: "app-no-jira",
    });

    assert.strictEqual(response.generationDiagnostics?.sourceIssueKey, undefined);
    assert.strictEqual(response.generationDiagnostics?.launchId, "launch-no-jira-001");
    assert.strictEqual(response.generationDiagnostics?.appSlug, "app-no-jira");
    assert.strictEqual(response.generationDiagnostics?.aiUsage?.inputTokens, 90);
  });

  test("keeps identifiers when provider returns valid scenarios without usage", async () => {
    const { response } = await runRoutePendingCase({
      title: "Escenario sin usage",
      steps: ["Seleccionar una opción visible.", "Validar el resultado visible."],
      mcpExecutable: true
    }, undefined, {
      launchId: "launch-no-usage-001",
      issueKey: "HU-NO-USAGE-001",
      appSlug: "app-no-usage",
    });

    assert.strictEqual(response.generationDiagnostics?.launchId, "launch-no-usage-001");
    assert.strictEqual(response.generationDiagnostics?.sourceIssueKey, "HU-NO-USAGE-001");
    assert.strictEqual(response.generationDiagnostics?.appSlug, "app-no-usage");
    assert.strictEqual(response.generationDiagnostics?.aiUsage, undefined);
  });

  test("validateScenario accepts nonExecutableCriteria metadata when mcpExecutable is true", () => {
    const scenario: McpScenario = {
      sourceIssueKey: "HU-1",
      title: "Escenario ejecutable con metadata route pending",
      steps: [
        "1. Clic en \"Iniciar\".",
        "2. Validar que se muestre \"Resultado visible\"."
      ],
      preconditions: ["AuthGate"],
      expectedResult: "Resultado visible correctamente.",
      type: "Functional",
      database: "",
      isConverted: 0,
      automationType: "ui_discovery",
      setupStrategy: "no_login",
      appSlug: "default",
      routeProfile: "",
      dataRequirements: "",
      nonExecutableCriteria: "requires_route_discovery",
      mcpExecutable: true
    };

    const validation = validateScenario(scenario, null);
    assert.strictEqual(validation.errors.includes("mcpExecutable must be true"), false);
  });
});
