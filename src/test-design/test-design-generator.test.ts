import assert from "node:assert/strict";
import test from "node:test";
import type { AiCompletionRequest, AiProvider } from "../ai/ai-provider.types";
import type { TestDesignJiraIssue } from "./test-design.types";
import { JIRA_STEP_DELIVERY_INSTRUCTIONS } from "../jira/jira-step-delivery";
import {
  generateTestDesignScenarios,
  generateTestDesignScenariosWithCoverage,
  mapJiraScenariosToTestDesign,
  mergeRegenerated,
  parseGeneratedScenarios,
  testDesignReviewWarning,
} from "./test-design-generator";
import { buildTestDesignMessages } from "./test-design-prompt";
import { normalizeScenario } from "./test-design.validation";

const issue: TestDesignJiraIssue = {
  key: "PAY-7",
  summary: "Pagar con tarjeta",
  description: "Como cliente quiero pagar mis pedidos con tarjeta.",
  acceptanceCriteria: "1. Solo tarjetas vigentes.\n2. Se muestra el comprobante.",
  labels: ["pagos"],
  components: ["Checkout"],
  status: "To Do",
  issueType: "Story",
};

function fakeProvider(responses: unknown[]): AiProvider & { requests: AiCompletionRequest[] } {
  const requests: AiCompletionRequest[] = [];
  return {
    providerType: "fake",
    providerName: "fake",
    model: "fake",
    requests,
    async completeJson(request) {
      requests.push(JSON.parse(JSON.stringify(request)));
      const next = responses.shift();
      return {
        rawText: JSON.stringify(next ?? null),
        parsedJson: (next ?? undefined) as Record<string, unknown> | undefined,
        model: "fake",
        providerName: "fake",
        durationMs: 1,
      };
    },
  };
}

const good = {
  scenarios: [
    {
      sourceIssueKey: issue.key,
      title: "Pagar con tarjeta vigente",
      preconditions: [],
      steps: [
        "Abrir la aplicación configurada del proyecto",
        'Ingresar una tarjeta válida en "Número de tarjeta"',
        'Validar que se muestre "Comprobante"',
      ],
      expectedResult: 'Se muestra "Comprobante".',
      inputRequirements: [
        { key: "card", label: "Número de tarjeta", stepIndex: 2, operation: "fill", required: true, editable: true, sensitive: false, controlType: "text", source: "jira_step", dataCondition: "valid" },
      ],
      acceptanceCriteriaRefs: ["AC1"],
    },
  ],
};

test("the prompt carries the story, criteria, instructions and kept titles", () => {
  const [system, user] = buildTestDesignMessages(issue, {
    instructions: "Enfócate en errores de la pasarela",
    existingTitles: ["Pagar con tarjeta vencida"],
  });
  assert.equal(system.role, "system");
  assert.match(system.content, /"scenarios"/);
  assert.match(user.content, /PAY-7 — Pagar con tarjeta/);
  assert.match(user.content, /Solo tarjetas vigentes/);
  assert.match(user.content, /Componentes: Checkout/);
  assert.match(user.content, /errores de la pasarela/);
  assert.match(user.content, /- Pagar con tarjeta vencida/);
});

test("the prompt says so when the story has no acceptance criteria field", () => {
  const [, user] = buildTestDesignMessages({ ...issue, acceptanceCriteria: null });
  assert.match(user.content, /dedúcelos de la descripción/);
});

test("the prompt does not repeat criteria that are the description itself", () => {
  const [, user] = buildTestDesignMessages({ ...issue, acceptanceCriteria: issue.description });
  assert.match(user.content, /incluidos en la descripción/);
  assert.strictEqual(user.content.split(issue.description).length - 1, 1);
});

test("parses model drift: Spanish enums, step/expectedResult names, list preconditions", () => {
  const scenarios = parseGeneratedScenarios({
    scenarios: [
      {
        title: "Rechazar tarjeta vencida",
        type: "negativo",
        priority: "alta",
        preconditions: ["Tarjeta vencida", "Pedido pendiente"],
        steps: [{ step: "Pagar con la tarjeta vencida", expectedResult: "Mensaje de rechazo" }],
        expected: "El pedido sigue pendiente",
      },
    ],
  });
  assert.equal(scenarios.length, 1);
  const [s] = scenarios;
  assert.equal(s.type, "negative");
  assert.equal(s.priority, "high");
  assert.equal(s.preconditions, "Tarjeta vencida\nPedido pendiente");
  assert.deepEqual(s.steps, [{ action: "Pagar con la tarjeta vencida", expected: "Mensaje de rechazo" }]);
  assert.equal(s.expectedResult, "El pedido sigue pendiente");
  assert.equal(s.origin, "ai");
  assert.equal(s.selectedForTestRail, true);
});

test("drops unusable scenarios and keeps the rest", () => {
  const scenarios = parseGeneratedScenarios({
    scenarios: [{ title: "", steps: [{ action: "x" }] }, { title: "Sin pasos", steps: [] }, "texto", good.scenarios[0]],
  });
  assert.deepEqual(scenarios.map((s) => s.title), ["Pagar con tarjeta vigente"]);
  assert.deepEqual(parseGeneratedScenarios(undefined), []);
  assert.equal(parseGeneratedScenarios([good.scenarios[0]]).length, 1);
});

test("Test Design calls the Jira scenario engine and projects its journey into the editable case format", async () => {
  const provider = fakeProvider([good]);
  const generated = await generateTestDesignScenariosWithCoverage(issue, {
    provider,
    appSlug: "design-fixture-app",
    instructions: "Prioriza el acceso empresarial",
    existingTitles: ["Caso que se conserva"],
  });
  const scenarios = generated.scenarios;
  assert.equal(scenarios.length, 1);
  assert.equal(provider.requests.length, 2,'uncovered numbered acceptance criteria receive a complementary generation attempt');
  const coverageRequest=JSON.parse(provider.requests[1].messages[1].content);
  assert.deepEqual(coverageRequest.issues[0].missingClauses.map((clause:{id:string})=>clause.id),['AC2.1']);
  assert.ok(provider.requests[1].messages[0].content.includes(JIRA_STEP_DELIVERY_INSTRUCTIONS),
    "coverage repair uses the same exact action/assertion syntax contract as initial generation and launch");
  assert.equal(scenarios[0].generationWarnings, undefined, "story coverage is not repeated as a case-level warning");
  assert.match(testDesignReviewWarning(scenarios, generated.coverage) ?? '', /AC2\.1/, "the story summary still reports genuinely missing criteria once");
  assert.equal(scenarios[0].selectedForTestRail, true, "a story coverage gap does not disable a valid individual case");
  assert.equal(provider.requests[0].purpose, "scenario_generation");
  assert.match(provider.requests[0].messages[0].content, /You generate web QA scenarios from user stories/);
  const context = JSON.parse(provider.requests[0].messages[1].content);
  assert.equal(context.appSlug, "design-fixture-app");
  assert.ok(Array.isArray(context.learnedNavigation));
  assert.equal(context.testDesign.additionalInstructions, "Prioriza el acceso empresarial");
  assert.deepEqual(context.testDesign.excludedScenarioTitlesByIssueKey, {},
    "retained draft titles must not change the shared Jira generation prompt");
  assert.deepEqual(scenarios[0].steps.map((step) => step.action), good.scenarios[0].steps);
  assert.deepEqual(scenarios[0].steps[2], {
    action: 'Validar que se muestre "Comprobante"',
    expected: 'Se muestra "Comprobante".',
  });
  assert.equal(scenarios[0].preconditions, "Datos de prueba requeridos:\n• Número de tarjeta · válido · paso 2",
    "Design shows the same required-data summary the launcher builds");
  assert.deepEqual(scenarios[0].jiraSourceScenario?.preconditions, [], "document defaults must not alter the Jira runtime scenario");
  assert.deepEqual(scenarios[0].acceptanceCriteriaRefs, ["AC1"]);
  assert.equal(scenarios[0].type, "functional");
  assert.equal(scenarios[0].origin, "ai");
});

test("Test Design refuses to silently generate without a project knowledge profile", async () => {
  const provider = fakeProvider([good]);
  await assert.rejects(
    generateTestDesignScenarios(issue, { provider, appSlug: "", instructions: null, existingTitles: [] }),
    /Vincula un proyecto de automatización/,
  );
  assert.equal(provider.requests.length, 0);
});

test("regeneration keeps manual, edited and published scenarios and replaces untouched AI ones", () => {
  const make = (title: string, over: Record<string, unknown>) =>
    ({ ...normalizeScenario({ title, steps: ["a"] }, 0, { origin: "ai" }), ...over });
  const existing = [
    make("IA sin tocar", {}),
    make("IA editada", { edited: true }),
    make("Manual", { origin: "manual" }),
    make("Publicada", { testRailCaseId: 77 }),
  ];
  const generated = [make("Nueva", {}), make("ia editada", {})];
  assert.deepEqual(
    mergeRegenerated(existing, generated).map((s) => s.title),
    ["IA editada", "Manual", "Publicada", "Nueva"],
  );
});

test("Design preserves Jira wording and publishes the same steps while keeping data values local", async () => {
  const [scenario] = mapJiraScenariosToTestDesign([{
    title: "Login", preconditions: [], steps: ["Ingresar usuario en \"Usuario\"", "Ingresar contraseña en \"Contraseña\"", "Presionar \"Entrar\""],
    expectedResult: "ok",
    inputRequirements: [
      { key: "user", label: "Usuario", stepIndex: 1, operation: "fill", required: true, editable: true, sensitive: false, controlType: "text", source: "jira_step", dataCondition: "valid" },
      { key: "pass", label: "Contraseña", stepIndex: 2, operation: "fill", required: true, editable: true, sensitive: true, controlType: "password", source: "jira_step" },
    ],
  } as never]);
  assert.equal(scenario.steps[0].action, "Ingresar usuario en \"Usuario\"");
  assert.equal(scenario.steps[2].action, "Presionar \"Entrar\"");
  assert.deepEqual(scenario.data.map((d) => [d.key, d.label, d.sensitive, d.condition]), [["user", "Usuario", false, "valid"], ["pass", "Contraseña", true, undefined]]);
  const { toCaseInput } = await import("./test-design-publisher");
  const data = scenario.data.map((d) => ({ ...d, value: d.key === "user" ? "juan" : "secreto" }));
  const published = toCaseInput({ ...scenario, data }, "PAY-7", { requiredCustomFields: {}, caseOracle: "QA" });
  assert.deepEqual(published.stepsSeparated?.map(step => step.content), scenario.steps.map(step => step.action));
  assert.equal(JSON.stringify(published).includes("secreto"), false);
  assert.equal(JSON.stringify(published).includes("juan"), false);
});

test("Design retains incomplete coverage as an explicitly flagged draft", () => {
  const [draft] = mapJiraScenariosToTestDesign([{
    ...good.scenarios[0],
    validation: { valid: false, errors: ["JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE:AC2.1,AC3.1"], warnings: [] },
  } as never]);
  assert.equal(draft.generationWarnings, undefined);
  assert.match(testDesignReviewWarning([draft]) ?? '', /AC2\.1, AC3\.1/);
  assert.equal(draft.selectedForTestRail, true, "a historical story-level coverage marker does not disable this case");
  assert.equal(draft.selectedForJira, true);
});

test("coverage warning extracts AC identifiers without treating ACTIONS as a criterion", () => {
  const message = testDesignReviewWarning([{
    ...good.scenarios[0],
    generationWarnings: ["La generación quedó incompleta: faltan criterios AC1.1, ACTIONS."],
  } as never]) ?? "";
  assert.match(message, /AC1\.1/);
  assert.doesNotMatch(message, /ACTIONS/);
  assert.equal(testDesignReviewWarning([{
    ...good.scenarios[0],
    generationWarnings: ["La generación quedó incompleta: faltan criterios ACTIONS."],
  } as never]), null, "a legacy pseudo-criterion alone does not produce an incomplete-coverage warning");
});

test("Design retains the Jira source scenario and stable scenario id", () => {
  const original = { ...good.scenarios[0], scenarioId: "PAY-7:jira:4", validation: { valid: true, errors: [], warnings: [] } } as never;
  const [design] = mapJiraScenariosToTestDesign([original]);
  assert.equal(design.jiraSourceScenarioId, "PAY-7:jira:4");
  assert.equal(design.jiraSourceScenario?.sourceIssueKey, issue.key);
  assert.deepEqual(design.jiraSourceScenario?.acceptanceCriteriaRefs, ["AC1"]);
});

test("different profiles preserve code/select wording, negative setup and separate runtime fields", () => {
  for (const [label, action] of [
    ["Código", 'Ingresar el código de acceso inválido en "Código".'],
    ["Warehouse", 'Seleccionar el almacén en "Warehouse".'],
  ]) {
    const [mapped] = mapJiraScenariosToTestDesign([{
      ...good.scenarios[0], steps: [action],
      inputRequirements: [{ ...good.scenarios[0].inputRequirements[0], label, stepIndex: 1 }],
    } as never]);
    assert.equal(mapped.steps[0].action, action);
    assert.equal(mapped.data[0].label, label);
    assert.equal(mapped.data[0].key, mapped.inputRequirements?.[0].key);
  }
});

test("natural Jira selection steps and legacy placeholders retain select requirements at publication", async () => {
  const { designCaseInputRequirements } = await import("./test-design-publisher");
  for (const action of [
    'Seleccionar la cuenta de origen en "Cuenta de origen".',
    'Seleccionar {{Cuenta de origen}} en "Cuenta de origen".',
    'Seleccionar el almacén en "Warehouse".',
  ]) {
    const label = action.includes("Warehouse") ? "Warehouse" : "Cuenta de origen";
    const scenario = normalizeScenario({ title: "Selección", steps: [action], data: [
      { key: label, value: "", sensitive: false },
      { key: "Referencia", value: "", sensitive: false },
    ] }, 0);
    const requirements = designCaseInputRequirements(scenario);
    assert.equal(requirements[0].controlType, "select");
    assert.equal(requirements.length, 1, "unused UI data must not manufacture a runtime input");
  }
});
