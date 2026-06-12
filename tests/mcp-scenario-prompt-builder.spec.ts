import { test, expect } from "@playwright/test";
import { buildMcpScenarioMessages } from "../src/scenarios/mcp-scenario-prompt-builder";
import type { JiraIssueSource, McpRouteProfile, ScenarioRouteResolution } from "../src/scenarios/scenario-types";

test.describe("MCP Scenario Prompt Builder - Multiproject Rules", () => {
  const mockIssue: JiraIssueSource = {
    key: "TEST-1",
    summary: "Test issue",
    description: "Test description",
    issueType: "Story",
    status: "To Do",
    labels: [],
    components: [],
    acceptanceCriteria: "Test criteria"
  };

  const mockRouteProfile: McpRouteProfile = {
    name: "test-profile",
    entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
    aliases: {},
    intermediates: {},
    domainTerms: { "producto": "producto bancario" },
    visibleControls: ["Información de productos", "Beneficios", "Requisitos"],
    representativeFixture: {},
    notes: []
  };

  const mockRouteResolutions = new Map<string, ScenarioRouteResolution>();
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

  test("system prompt does NOT say visibleControls are clickable by default", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should NOT contain old permissive rule
    expect(systemPrompt).not.toContain("visible controls, entry steps, aliases, or domain terms");

    // Should NOT suggest visibleControls are clickable
    expect(systemPrompt.toLowerCase()).not.toContain("generate \"clic en\" steps for targets that are visible controls");
  });

  test("system prompt says ONLY allowedExecutableClicks permits clicks", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should contain new strict rule
    expect(systemPrompt).toContain("ONLY allowed when X is explicitly listed in ALLOWED_EXECUTABLE_CLICKS");
    expect(systemPrompt).toContain("ALLOWED_EXECUTABLE_CLICKS is the ONLY source of truth for click actions");
  });

  test("system prompt includes enforceable execution context", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should include ALLOWED_EXECUTABLE_CLICKS section
    expect(systemPrompt).toContain("ALLOWED_EXECUTABLE_CLICKS");
    expect(systemPrompt).toContain("These are the ONLY targets that can appear in \"Clic en\" steps");
  });

  test("system prompt includes assertion-only terms handling", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should include rules about assertion-only terms in general
    expect(systemPrompt).toContain("ASSERTION_ONLY_TERMS");
    // Even if no specific terms, should explain concept in multiproject rules
    expect(systemPrompt).toContain("ASSERTION_ONLY_TERMS → ONLY \"Validar que se muestre");
  });

  test("system prompt includes multiproject execution rules", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should include multiproject rules
    expect(systemPrompt).toContain("Multiproject Execution Rules");
    expect(systemPrompt).toContain("Apply to ALL projects/apps without exception");
    expect(systemPrompt).toContain("NO clicks on visibleControls unless also in ALLOWED_EXECUTABLE_CLICKS");
    expect(systemPrompt).toContain("NO clicks on domainTerms unless also in ALLOWED_EXECUTABLE_CLICKS");
    expect(systemPrompt).toContain("NO clicks on story content sections");
  });

  test("system prompt includes content vs controls rules", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should include content/assertion term rules
    expect(systemPrompt).toContain("Content/Assertion Terms");
    expect(systemPrompt).toContain("Wrong: Clic en \"Beneficios\"");
    expect(systemPrompt).toContain("Right: Validar que se muestre \"Beneficios\"");
    expect(systemPrompt).toContain("User story sections → Validations only");
    expect(systemPrompt).toContain("Expected results → Context only, never executable");
  });

  test("system prompt includes key principles", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should include key principles
    expect(systemPrompt).toContain("\"visible\" does NOT mean \"clickable\"");
    expect(systemPrompt).toContain("\"mentioned in user story\" does NOT mean \"clickable\"");
    expect(systemPrompt).toContain("\"domain term\" does NOT mean \"clickable\"");
  });

  test("system prompt includes updated detail scenario pattern", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should NOT assume all listings are selectable
    expect(systemPrompt).toContain("Do NOT assume all listings are selectable");
    expect(systemPrompt).toContain("ONLY if routeResolution includes selection");
    expect(systemPrompt).toContain("When NOT to Use Selection");
    expect(systemPrompt).toContain("Listing of informational sections");
  });

  test("system prompt preserves entry steps rules", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should preserve entry steps rules
    expect(systemPrompt).toContain("Entry Steps Rules");
    expect(systemPrompt).toContain("EVERY scenario MUST start with them");
    expect(systemPrompt).toContain("Do NOT omit, reorder, or modify entry steps");
  });

  test("system prompt preserves sensitive actions rules", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should preserve sensitive actions rules
    expect(systemPrompt).toContain("Sensitive Actions");
    expect(systemPrompt).toContain("Do NOT generate \"Clic en\" for sensitive actions");
  });

  test("system prompt is multiproject (no hardcoded app names)", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should NOT contain hardcoded app-specific names
    expect(systemPrompt).not.toContain("KIOSKO");
    expect(systemPrompt).not.toContain("kiosko");
    expect(systemPrompt).not.toContain("arquitectura-automatizacion");

    // Should use generic placeholders
    expect(systemPrompt).toContain("test-app"); // From parameter
  });

  test("derived context includes REMEMBER section", async () => {
    const messages = await buildMcpScenarioMessages(
      [mockIssue],
      "test-app",
      undefined,
      "test-app",
      "Test App",
      mockRouteProfile,
      [{ action: "click", target: "Iniciar" }],
      "password",
      mockRouteResolutions
    );

    const systemPrompt = messages[0].content;

    // Should include REMEMBER section in derived context
    expect(systemPrompt).toContain("### REMEMBER");
    expect(systemPrompt).toContain("visibleControls are for VALIDATIONS unless also in ALLOWED_EXECUTABLE_CLICKS");
    expect(systemPrompt).toContain("domainTerms are for VALIDATIONS unless also in ALLOWED_EXECUTABLE_CLICKS");
    expect(systemPrompt).toContain("When in doubt: \"Validar que se muestre\" not \"Clic en\"");
  });
});
