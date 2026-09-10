import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";

function buildPlan(target: string) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 44757, externalId: "C44757", title: "Scenario" },
    requiredData: [],
    steps: [{ index: 6, action: "click", target: { strategy: "text", value: target }, description: `Clic en ${target}` }],
    createdAt: new Date().toISOString(),
  } as any;
}

function buildRegistry(targetBinding: string) {
  return {
    version: "1.0",
    appSlug: "app",
    updatedAt: new Date().toISOString(),
    componentCandidates: [],
    pageObjects: [{
      id: "po",
      className: "ProductListPage",
      filePath: "pages/product-list.page.ts",
      screenSignature: "list",
      confidence: 1,
      status: "active",
      sourcePlanIds: [],
      caseIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      methods: [{
        name: "clickPrimaryAction",
        intent: "click_primary_action",
        parameters: ["target"],
        available: true,
        source: "test",
        sensitive: false,
        confidence: 1,
        status: "active",
        targetBinding,
      }],
    }],
  } as any;
}

function contractFor(target: string, targetBinding: string) {
  return buildSpecExecutionContract(
    buildPlan(target),
    { steps: [{ index: 6, action: `Clic en "${target}"` }] },
    { pageObjectRegistry: buildRegistry(targetBinding) },
  );
}

test("implementation metadata requires exact target binding for click steps", () => {
  const foreign = contractFor("Salir", "Continuar").steps[0];
  assert.equal(foreign.operation, "click");
  assert.equal(foreign.target?.value, "Salir");
  assert.equal(foreign.implementation, undefined);

  const matching = contractFor("Salir", "Salir").steps[0];
  assert.equal(matching.implementation?.owner, "ProductListPage");
  assert.equal(matching.implementation?.method, "clickPrimaryAction");

  const ambiguous = buildSpecExecutionContract(
    {
      ...buildPlan("Salir"),
      steps: [
        { index: 1, action: "click", target: { strategy: "text", value: "Salir" } },
        { index: 2, action: "click", target: { strategy: "text", value: "Salir" } },
      ],
    } as any,
    { steps: [{ index: 9, action: 'Clic en "Salir"' }] },
    { pageObjectRegistry: buildRegistry("Salir") },
  ).steps[0];
  assert.equal(ambiguous.implementation, undefined);
});
