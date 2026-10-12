import assert from "node:assert/strict";
import test from "node:test";
import type { AiCompletionRequest, AiProvider } from "../ai/ai-provider.types";
import type { JiraIssueSource } from "../scenarios/scenario-types";
import {
  generateTestDesignScenarios,
  mergeRegenerated,
  parseGeneratedScenarios,
  TestDesignGenerationError,
} from "./test-design-generator";
import { buildTestDesignMessages } from "./test-design-prompt";
import { normalizeScenario } from "./test-design.validation";

const issue: JiraIssueSource = {
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
      title: "Pagar con tarjeta vigente",
      type: "functional",
      priority: "high",
      preconditions: "Pedido pendiente",
      steps: [{ action: "Pagar", expected: "Pago aprobado" }],
      expectedResult: "Comprobante visible",
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

test("returns the first usable answer", async () => {
  const provider = fakeProvider([good]);
  const scenarios = await generateTestDesignScenarios(issue, { provider });
  assert.equal(scenarios.length, 1);
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].purpose, "test_design");
});

test("retries once, telling the model what was wrong", async () => {
  const provider = fakeProvider([{ resultado: "nada" }, good]);
  const scenarios = await generateTestDesignScenarios(issue, { provider });
  assert.equal(scenarios.length, 1);
  assert.equal(provider.requests.length, 2);
  const retry = provider.requests[1].messages;
  assert.match(retry[retry.length - 1].content, /no tiene escenarios válidos/);
});

test("fails after two unusable answers instead of inventing scenarios", async () => {
  const provider = fakeProvider([{}, { scenarios: [] }]);
  await assert.rejects(generateTestDesignScenarios(issue, { provider }), TestDesignGenerationError);
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
