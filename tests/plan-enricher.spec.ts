import { expect, test } from "@playwright/test";
import { enrichExecutionPlanWithSnapshot } from "../src/plans/plan-enricher";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { PageSnapshot } from "../src/types/page-snapshot.types";
import type { DataContext } from "../src/data/data-context";

function createPlan(description: string): ExecutionPlan {
  return {
    version: "1.0",
    source: "rule_based",
    status: "draft",
    scenario: { source: "manual", title: "demo" },
    requiredData: [],
    steps: [
      { index: 1, action: "navigate", target: "APP_BASE_URL" },
      { index: 2, action: "noop", description, evidence: true }
    ],
    createdAt: new Date().toISOString()
  };
}

function createSnapshot(elements: PageSnapshot["elements"]): PageSnapshot {
  return {
    version: "1.0",
    url: "https://example.com",
    title: "Example",
    capturedAt: new Date().toISOString(),
    elements,
    summary: { totalElements: elements.length, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 }
  };
}

const contextWithCedula: DataContext = {
  entries: [{ key: "cedula", value: "001", source: "test_data", sensitive: true }],
  counts: { total: 1, sensitive: 1, nonSensitive: 0 }
};

test("converts noop fill with resolved data", () => {
  const plan = createPlan("Ingresar cédula");
  const snapshot = createSnapshot([
    {
      id: "i1",
      type: "input",
      label: "Cédula",
      visible: true,
      candidateLocators: [{ strategy: "label", value: "Cédula", confidence: 0.85 }],
      dataHints: ["cedula"]
    }
  ]);

  const result = enrichExecutionPlanWithSnapshot({
    plan,
    snapshot,
    dataContext: contextWithCedula,
    aliases: {},
    missingInputBehavior: "fail"
  });

  expect(result.plan.steps[1].action).toBe("fill");
  expect(result.plan.status).toBe("validated");
});

test("does not convert fill when missing data and marks needs_data", () => {
  const plan = createPlan("Ingresar cédula");
  const snapshot = createSnapshot([
    {
      id: "i1",
      type: "input",
      label: "Cédula",
      visible: true,
      candidateLocators: [{ strategy: "label", value: "Cédula", confidence: 0.85 }],
      dataHints: ["cedula"]
    }
  ]);

  const result = enrichExecutionPlanWithSnapshot({
    plan,
    snapshot,
    dataContext: { entries: [], counts: { total: 0, sensitive: 0, nonSensitive: 0 } },
    aliases: {},
    missingInputBehavior: "fail"
  });

  expect(result.plan.steps[1].action).toBe("noop");
  expect(result.plan.status).toBe("needs_data");
});

test("converts noop click with button", () => {
  const plan = createPlan("Presionar consultar");
  const snapshot = createSnapshot([
    {
      id: "b1",
      type: "button",
      text: "Consultar",
      visible: true,
      candidateLocators: [{ strategy: "text", value: "Consultar", confidence: 0.75 }],
      dataHints: []
    }
  ]);
  const result = enrichExecutionPlanWithSnapshot({
    plan,
    snapshot,
    dataContext: contextWithCedula,
    aliases: {},
    missingInputBehavior: "fail"
  });
  expect(result.plan.steps[1].action).toBe("click");
});

test("converts assert with heading", () => {
  const plan = createPlan("Validar resultado");
  const snapshot = createSnapshot([
    {
      id: "h1",
      type: "heading",
      text: "Validar resultado",
      visible: true,
      candidateLocators: [{ strategy: "text", value: "Resultado", confidence: 0.75 }],
      dataHints: []
    }
  ]);
  const result = enrichExecutionPlanWithSnapshot({
    plan,
    snapshot,
    dataContext: contextWithCedula,
    aliases: {},
    missingInputBehavior: "fail"
  });
  expect(result.plan.steps[1].action).toBe("assertVisible");
});

test("keeps noop on low confidence and marks needs_discovery", () => {
  const plan = createPlan("Presionar consultar");
  const snapshot = createSnapshot([]);
  const result = enrichExecutionPlanWithSnapshot({
    plan,
    snapshot,
    dataContext: contextWithCedula,
    aliases: {},
    missingInputBehavior: "fail"
  });
  expect(result.plan.steps[1].action).toBe("noop");
  expect(result.plan.status).toBe("needs_discovery");
});

test("does not mutate original plan", () => {
  const plan = createPlan("Presionar consultar");
  const snapshot = createSnapshot([]);
  const copy = JSON.parse(JSON.stringify(plan));
  void enrichExecutionPlanWithSnapshot({
    plan,
    snapshot,
    dataContext: contextWithCedula,
    aliases: {},
    missingInputBehavior: "fail"
  });
  expect(plan).toEqual(copy);
});

test("does not convert without candidate locator", () => {
  const plan = createPlan("Presionar consultar");
  const snapshot = createSnapshot([
    {
      id: "b1",
      type: "button",
      text: "Consultar",
      visible: true,
      candidateLocators: [],
      dataHints: []
    }
  ]);
  const result = enrichExecutionPlanWithSnapshot({
    plan,
    snapshot,
    dataContext: contextWithCedula,
    aliases: {},
    missingInputBehavior: "fail"
  });
  expect(result.plan.steps[1].action).toBe("noop");
});
