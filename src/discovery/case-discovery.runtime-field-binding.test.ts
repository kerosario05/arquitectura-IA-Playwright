import assert from "node:assert/strict";
import test from "node:test";
import { bindAuthoredRuntimeField, isFillActionTarget, parseScenarioStepsForDiscovery } from "./case-discovery";
import { resolveDataKey, runtimeInputKeyForField } from "../data/data-key-resolver";
import type { TestScenario } from "../types/testrail.types";

function authored(action: string, metadata: Record<string, unknown> = {}): TestScenario {
  return { source: "testrail", externalId: "fixture", caseId: 1, title: "fixture",
    steps: [{ index: 1, action, dataHints: [], ...metadata }] };
}

test("natural fields bind case data generically through parser, dispatch and serialized plan keys", () => {
  for (const [label, key, value] of [["Monto", "monto", "17"], ["Fecha de entrega", "fecha_de_entrega", "2030-01-02"],
    ["Dirección", "direccion", "synthetic street"], ["Warehouse code", "warehouse_code", "WH-A"]]) {
    const scenario = authored(`Ingresar el dato en "${label}".`);
    const target = parseScenarioStepsForDiscovery(scenario).actionTargets[0];
    const entries = [{ key, value, source: "explicit_runtime_input" }];
    assert.equal(bindAuthoredRuntimeField(scenario, target, entries), true, label);
    assert.equal(isFillActionTarget(target), true);
    const plan = JSON.parse(JSON.stringify({ action: "fill", valueKey: target.valueKey }));
    assert.equal(resolveDataKey(plan.valueKey, { runtimeEntries: entries }).value, value);
    assert.equal(plan.valueKey, key);
  }
});

test("select binds its field rather than an option or unrelated account input", () => {
  const target = { actionType: "action_select" as const, target: "preference", selectionField: "Cuenta de destino",
    valueSource: "unknown" as const, valueKey: undefined as string | undefined };
  assert.equal(bindAuthoredRuntimeField({ source: "jira" }, target, [{ key: "cuenta_de_origen" }, { key: "cuenta_de_destino" }]), true);
  assert.equal(target.valueKey, "cuenta_de_destino");
});

test("explicit authored keys survive projection alongside natural wording", () => {
  const scenario = authored('Ingresar el importe en "Total".', { valueKey: "payment.amount" });
  const parsed = parseScenarioStepsForDiscovery(scenario);
  assert.equal(parsed.actionTargets[0].valueKey, "payment.amount");
  assert.equal(parsed.orderedSteps[0].valueKey, "payment.amount");
});

test("binding preserves literal values, explicit keys, recording authority and ambiguity", () => {
  assert.equal(runtimeInputKeyForField("Monto", [{ key: "monto" }, { key: "Mónto" }]), undefined);
  assert.equal(runtimeInputKeyForField("Monto", [{ key: "monto_invalido" }]), undefined);
  assert.equal(runtimeInputKeyForField("Cuenta", [{ key: "cuenta_de_destino" }]), undefined);
  for (const extra of [{ valueSource: "literal" as const, value: "fixed" }, { valueKey: "explicit.key" }, { value: "fixed" }]) {
    const target = { actionType: "action_fill" as const, target: "Monto", ...extra };
    assert.equal(bindAuthoredRuntimeField({ source: "testrail" }, target, [{ key: "monto" }]), false);
  }
  assert.equal(bindAuthoredRuntimeField({ source: "testrail", recordingId: "immutable-recording" },
    { actionType: "action_fill", target: "Monto" }, [{ key: "monto" }]), false);
  assert.equal(bindAuthoredRuntimeField({ source: "jira" }, { actionType: "action_click", target: "Monto" }, [{ key: "monto" }]), false);
  assert.equal(bindAuthoredRuntimeField({ source: "jira" }, { actionType: "action_fill", target: "Monto", entityScope: "Recipient" }, [{ key: "monto" }]), false);
  assert.equal(bindAuthoredRuntimeField({ source: "jira" }, { actionType: "action_fill", target: "Monto", rowScope: 1 }, [{ key: "monto" }]), false);
});
