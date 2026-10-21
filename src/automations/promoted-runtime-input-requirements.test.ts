import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { PromotedAutomationIndex } from "../types/automation-promotion.types";
import { buildPromotedRuntimeInputRequirements, findExactPromotedAutomation, isPromotedPlanCompatibleWithCase } from "./promoted-runtime-input-requirements";

test("builds editable runtime fields from promoted plan inputs and labels Jira step keys from TestRail", () => {
  const plan = {
    requiredData: [
      { key: "rnc", required: true, resolved: true, sensitive: true },
      { key: "contrasena", required: true, resolved: true, sensitive: true },
      { key: "jira_step_2", required: true, resolved: true, sensitive: true },
      { key: "expected.receipt", required: true, resolved: true, valueRole: "expected_oracle" },
    ],
    steps: [
      { index: 2, action: "fill", valueKey: "rnc" },
      { index: 3, action: "fill", valueKey: "contrasena" },
      { index: 4, action: "select", valueKey: "jira_step_2" },
    ],
  } as ExecutionPlan;
  const scenario = {
    caseId: 77,
    steps: [
      { index: 1, action: "Abrir la aplicación", dataHints: [] },
      { index: 2, action: "Seleccionar Cuenta corriente en Cuenta de origen", dataHints: [] },
    ],
  } as any;

  const requirements = buildPromotedRuntimeInputRequirements(plan, scenario);

  assert.deepEqual(requirements.map(({ key, label, controlType, required, sensitive }) => ({ key, label, controlType, required, sensitive })), [
    { key: "rnc", label: "Rnc", controlType: "text", required: true, sensitive: true },
    { key: "contrasena", label: "Contrasena", controlType: "password", required: true, sensitive: true },
    { key: "jira_step_2", label: "Seleccionar Cuenta corriente en Cuenta de origen", controlType: "select", required: true, sensitive: true },
  ]);
  assert.equal(requirements.some((item) => item.key === "expected.receipt"), false);
  assert.equal(requirements.every((item) => item.editable === true), true);
});

test("labels Jira runtime fields from the promoted target when TestRail step numbering is misaligned", () => {
  const plan = {
    scenario: { source: "jira" },
    requiredData: [
      { key: "jira_step_16", required: true, resolved: true },
      { key: "jira_step_17", required: true, resolved: true },
      { key: "jira_step_18", required: true, resolved: true },
    ],
    steps: [
      { index: 17, action: "select", valueKey: "jira_step_16", target: { strategy: "xpath", value: "//*[normalize-space(.)='Cuenta Origen']/following::span[1]" } },
      { index: 18, action: "select", valueKey: "jira_step_17", target: { strategy: "xpath", value: "//*[normalize-space(.)='Cuenta Destino']/following::span[1]" } },
      { index: 19, action: "fill", valueKey: "jira_step_18", target: { strategy: "css", value: '[id="transactionDetails_0__AmountPayment"]' } },
    ],
    sourceScenario: { steps: [
      { index: 17, action: "select", valueKey: "jira_step_16" },
      { index: 18, action: "select", valueKey: "jira_step_17" },
      { index: 19, action: "fill", valueKey: "jira_step_18" },
    ] },
  } as unknown as ExecutionPlan;
  const scenario = {
    caseId: 77,
    steps: [
      { index: 16, action: "Seleccionar cuenta de destino", dataHints: [] },
      { index: 17, action: "Ingresar monto", dataHints: [] },
      { index: 18, action: "Validar que se muestre la cuenta que debitará", dataHints: [] },
    ],
  } as any;

  const requirements = buildPromotedRuntimeInputRequirements(plan, scenario);
  assert.deepEqual(requirements.map(({ key, label }) => ({ key, label })), [
    { key: "jira_step_16", label: "Cuenta Origen" },
    { key: "jira_step_17", label: "Cuenta Destino" },
    { key: "jira_step_18", label: "Monto" },
  ]);
});

test("falls back to the case step text when a semantic target only exposes a technical name", () => {
  const plan = {
    requiredData: [{ key: "jira_step_9", required: true, resolved: true }],
    steps: [{ index: 10, action: "fill", valueKey: "jira_step_9", target: {
      strategy: "semantic", value: "segmented_code", name: "segmented code input group",
    } }],
  } as unknown as ExecutionPlan;
  const scenario = { steps: [{ index: 9, action: "Ingresar código de acceso en Código de acceso", dataHints: [] }] } as any;

  const [requirement] = buildPromotedRuntimeInputRequirements(plan, scenario);
  assert.equal(requirement.label, "Ingresar código de acceso en Código de acceso");
});

test("resolves a promoted contract only for an exact app and TestRail case association", () => {
  const entry = {
    id: "case-77",
    caseId: 77,
    appSlug: "portal-a",
    title: "Case 77",
    planPath: "plan.json",
    specPath: "case.spec.ts",
    status: "active",
    source: "discovery",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    specVerificationStatus: "passed",
  } as any;
  const index = { version: "1.0", updatedAt: "2026-01-01T00:00:00.000Z", automations: [entry] } as PromotedAutomationIndex;

  assert.equal(findExactPromotedAutomation(index, "portal-a", 77), entry);
  assert.equal(findExactPromotedAutomation(index, "portal-b", 77), undefined);
  assert.equal(findExactPromotedAutomation(index, "portal-a", 78), undefined);
  assert.equal(findExactPromotedAutomation({ ...index, automations: [entry, { ...entry, id: "duplicate" }] }, "portal-a", 77), undefined);
});

test("accepts Jira plans without an embedded TestRail caseId only after the promotion index supplies the association", () => {
  const plan = { scenario: { source: "jira", externalId: "PROJ-12:jira:1", title: "Scenario" } } as ExecutionPlan;
  const conflictingPlan = { ...plan, scenario: { ...plan.scenario, caseId: 99 } } as ExecutionPlan;
  assert.equal(isPromotedPlanCompatibleWithCase(plan, 77), true);
  assert.equal(isPromotedPlanCompatibleWithCase(conflictingPlan, 77), false);
});
