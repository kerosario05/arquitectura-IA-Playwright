import assert from "node:assert/strict";
import test from "node:test";
import { bindAuthoredRuntimeField, isFillActionTarget, parseScenarioStepsForDiscovery } from "./case-discovery";
import { resolveDataKey, runtimeCredentialRoleInputCountForField, runtimeInputKeyForField } from "../data/data-key-resolver";
import type { TestScenario } from "../types/testrail.types";

function authored(action: string, metadata: Record<string, unknown> = {}): TestScenario {
  return { source: "testrail", externalId: "fixture", caseId: 1, title: "fixture",
    steps: [{ index: 1, action, dataHints: [], ...metadata }] };
}

test("authored value descriptions bind a shortened field label to its exact case input", () => {
  for (const [description, label, key] of [["el token de autorización", "Token", "token_autorizacion"],
    ["la fecha de entrega", "Fecha", "fecha_entrega"]]) {
    const scenario = authored(`Ingresar ${description} en "${label}".`);
    const target = parseScenarioStepsForDiscovery(scenario).actionTargets[0];
    const entries = [{ key: "codigo_acceso", value: "synthetic-login-code", source: "explicit_runtime_input" },
      { key, value: "synthetic-case-value", source: "explicit_runtime_input" }];
    assert.equal(bindAuthoredRuntimeField(scenario, target, entries), true);
    assert.equal(target.valueKey, key);
    const serialized = JSON.parse(JSON.stringify({ valueKey: target.valueKey }));
    const resolved = resolveDataKey(serialized.valueKey, { runtimeEntries: entries });
    assert.equal(resolved.value, "synthetic-case-value");
    assert.equal(resolved.source, "explicit_runtime_input");
    if (label === "Token") assert.equal(resolved.masked, true);
  }
});

test("authored descriptions cannot guess a token, cross fields or resolve duplicate input identities", () => {
  const scenario = authored('Ingresar el token de autorización en "Token".');
  for (const entries of [[{ key: "codigo_acceso" }], [{ key: "token_autorizacion_invalido" }],
    [{ key: "token_autorizacion" }, { key: "token_de_autorizacion" }]]) {
    const target = parseScenarioStepsForDiscovery(scenario).actionTargets[0];
    assert.equal(bindAuthoredRuntimeField(scenario, target, entries), false);
    assert.equal(target.valueKey, undefined);
  }
  const target = parseScenarioStepsForDiscovery(scenario).actionTargets[0];
  target.target = "Other field";
  assert.equal(bindAuthoredRuntimeField(scenario, target, [{ key: "token_autorizacion" }]), false);
});

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

test("natural selection field binds connector-free explicit keys without merging invalid variants", () => {
  for (const [field, key] of [["Cuenta de origen", "cuenta_origen"], ["Cuenta de destino", "cuenta_destino"], ["Country of residence", "country_residence"]]) {
    const scenario = authored(`Seleccionar la opción en "${field}".`);
    const target = parseScenarioStepsForDiscovery(scenario).actionTargets[0];
    const entries = [{ key, value: "synthetic-option", source: "explicit_runtime_input" }];
    assert.equal(bindAuthoredRuntimeField(scenario, target, entries), true);
    assert.equal(resolveDataKey(target.valueKey!, { runtimeEntries: entries }).value, "synthetic-option");
    assert.equal(runtimeInputKeyForField(field, [{ key: `${key}_invalido` }]), undefined);
  }
  assert.equal(runtimeInputKeyForField("Cuenta de origen", [{ key: "cuenta_origen" }, { key: "cuenta_del_origen" }]), undefined);
});

test("a uniquely qualified invalid credential input overrides project auth data by generic role", () => {
  const scenario = authored('Ingresar el valor en "Usuario".');
  const target = parseScenarioStepsForDiscovery(scenario).actionTargets[0];
  const entries = [{ key: "usuario_invalido", value: "synthetic-invalid-user", source: "explicit_runtime_input" }];

  assert.equal(bindAuthoredRuntimeField(scenario, target, entries), true);
  assert.equal(target.valueKey, "auth.username");
  assert.equal(resolveDataKey(target.valueKey!, {
    testData: { "auth.username": "project-user" },
    runtimeEntries: entries,
  }).value, "synthetic-invalid-user");
});

test("multiple explicit values for one credential role stay ambiguous instead of falling back to project data", () => {
  const scenario = authored('Ingresar el valor en "Usuario".');
  const target = parseScenarioStepsForDiscovery(scenario).actionTargets[0];
  const entries = [{ key: "usuario_valido", value: "synthetic-user" }, { key: "usuario_invalido", value: "synthetic-invalid-user" }];

  assert.equal(runtimeCredentialRoleInputCountForField("Usuario", entries), 2);
  assert.equal(bindAuthoredRuntimeField(scenario, target, entries), false);
  assert.equal(target.valueKey, undefined);
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
