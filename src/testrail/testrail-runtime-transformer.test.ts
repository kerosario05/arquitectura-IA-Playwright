import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTestRailCase } from "./testrail-normalizer";
import { convertTestRailRequirements } from "./testrail-requirement-converter";
import { transformTestRailCaseForRuntime } from "./testrail-runtime-transformer";
import { resolveFieldCapability } from "./field-capability";
import { resolveRuntimeInputValuePolicy } from "./runtime-value-policy";

const baseCase = { id: 92001, title: "Consultar saldo", custom_steps: "Abrir la cuenta", custom_expected: "Se muestra el saldo" } as any;

test("contractual declaration becomes a contract runtime requirement", () => {
  const result = transformTestRailCaseForRuntime({ ...baseCase, custom_preconds: "Cuenta (account.id, text)" });

  assert.equal(result.inputRequirements[0]?.key, "account.id");
  assert.equal(result.inputRequirements[0]?.source, "contract");
  assert.equal(result.inputRequirements[0]?.scenarioDataPolicy, "manual_required");
});

test("keeps TestRail human labels, indexed entity metadata, and secret capability at the runtime boundary", () => {
  const result = transformTestRailCaseForRuntime({
    ...baseCase,
    custom_preconds: "<ol><li>- Cédula empleado 1 (employee_1.document, text)</li><li>- Contraseña (auth.password, secret) [SECRETO]</li></ol>",
  });

  assert.deepEqual(result.inputRequirements[0], {
    key: "employee_1.document",
    label: "Cédula empleado 1",
    controlType: "text",
    required: true,
    sensitive: false,
    allowedValues: [],
    displayLabel: "Cédula",
    semanticField: "Cédula",
    technicalLabel: "employee_1.document",
    entityDisplayName: "Empleado",
    datasetIdentity: "employee",
    datasetOrdinal: 1,
    inputRole: "scenario",
    source: "contract",
    provenance: "contract_declaration",
    fieldCapability: { kind: "text" },
    valuePolicy: "scenario_controlled",
    scenarioDataPolicy: "manual_required",
  });
  assert.equal(result.inputRequirements[1]?.label, "Contraseña");
  assert.equal(result.inputRequirements[1]?.sensitive, true);
  assert.deepEqual(result.inputRequirements[1]?.fieldCapability, { kind: "password" });
});

test("transformer preserves an existing generation profile and does not invent one", () => {
  const profile = { semanticType: "money", generationMode: "synthetic", numeric: { integerOnly: true, decimalScale: 0 } };
  const preserved = transformTestRailCaseForRuntime({ ...baseCase, custom_preconds: "Amount (data.amount, number)" }, {
    convert: () => ({ caseId: baseCase.id, requirements: [{ key: "data.amount", controlType: "number", generationProfile: profile }] as any, unresolvedPlaceholders: [], conflicts: [], status: "proposed", requiresApproval: true }),
    propose: () => ({ proposals: [], unresolved: [], requiresApproval: true }),
  });
  assert.deepEqual(preserved.inputRequirements[0]?.generationProfile, profile);

  const absent = transformTestRailCaseForRuntime({ ...baseCase, custom_preconds: "Amount (data.amount, number)" });
  assert.equal(absent.inputRequirements[0]?.generationProfile, undefined);
});

test("sufficient placeholder context becomes a runtime inferred requirement", () => {
  const result = transformTestRailCaseForRuntime({ ...baseCase, custom_preconds: "Contraseña [auth.password]" });

  assert.equal(result.inputRequirements[0]?.key, "auth.password");
  assert.equal(result.inputRequirements[0]?.source, "runtime_inferred");
  assert.equal(result.inputRequirements[0]?.scenarioDataPolicy, "trusted_required");
});

test("contractual requirement wins over an inferred duplicate", () => {
  const rawCase = { ...baseCase, custom_preconds: "Usuario (auth.user, text)" };
  const result = transformTestRailCaseForRuntime(rawCase, {
    propose: () => ({
      proposals: [{ key: "auth.user", label: "Otro usuario", controlType: "password", confidence: 0.9, evidence: "fixture" }],
      unresolved: [],
      requiresApproval: true,
    }),
  });

  assert.equal(result.inputRequirements.filter((item) => item.key === "auth.user").length, 1);
  assert.equal(result.inputRequirements[0]?.source, "contract");
  assert.equal(result.conflicts[0]?.key, "auth.user");
});

test("insufficient placeholder evidence remains unresolved", () => {
  const result = transformTestRailCaseForRuntime({ ...baseCase, custom_preconds: "Cliente [customer.id]" });

  assert.deepEqual(result.inputRequirements, []);
  assert.deepEqual(result.unresolvedPlaceholders, ["customer.id"]);
});

test("contract conflicts remain explicit", () => {
  const result = transformTestRailCaseForRuntime({ ...baseCase, custom_preconds: "Usuario (auth.user, text)\nUsuario secreto (auth.user, password)" });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]?.key, "auth.user");
});

test("normalizedScenario is produced by the existing normalizer", () => {
  const rawCase = { ...baseCase, custom_preconds: "Cuenta (account.id, text)" };
  const result = transformTestRailCaseForRuntime(rawCase);

  assert.deepEqual(result.normalizedScenario, normalizeTestRailCase(rawCase));
});

test("resolves known field capabilities without inventing constraints", () => {
  assert.deepEqual(resolveFieldCapability({ key: "name", controlType: "text" }), { kind: "text" });
  assert.deepEqual(resolveFieldCapability({ key: "secret", sensitive: true }), { kind: "password" });
  assert.deepEqual(resolveFieldCapability({ key: "secret", controlType: "secret", sensitive: true }), { kind: "password" });
  assert.deepEqual(resolveFieldCapability({ key: "status", controlType: "select", allowedValues: ["A", "B"] }), {
    kind: "select",
    allowedValues: ["A", "B"],
    optionSource: "contract",
  });
  assert.deepEqual(resolveFieldCapability({ key: "status", controlType: "select" }), {
    kind: "select",
    allowedValues: [],
    optionSource: "unknown",
  });
  for (const controlType of ["number", "date", "email", "tel", "file"]) {
    assert.equal(resolveFieldCapability({ key: "field", controlType }).kind, controlType);
  }
  assert.deepEqual(resolveFieldCapability({ key: "field", controlType: "widget" }), { kind: "unknown" });
});

test("transformer carries fieldCapability without changing provenance", () => {
  const result = transformTestRailCaseForRuntime({ ...baseCase, custom_preconds: "Status (account.status, select)" }, {
    convert: () => ({
      caseId: baseCase.id,
      requirements: [{ key: "account.status", controlType: "select", allowedValues: ["active"] }],
      unresolvedPlaceholders: [],
      conflicts: [],
      status: "proposed",
      requiresApproval: true,
    }),
    propose: () => ({ proposals: [], unresolved: [], requiresApproval: true }),
  });

  assert.equal(result.inputRequirements[0]?.source, "contract");
  assert.deepEqual(result.inputRequirements[0]?.fieldCapability, {
    kind: "select",
    allowedValues: ["active"],
    optionSource: "contract",
  });

  const inferred = transformTestRailCaseForRuntime({ ...baseCase, custom_preconds: "Contraseña [auth.password]" });
  assert.equal(inferred.inputRequirements[0]?.source, "runtime_inferred");
  assert.deepEqual(inferred.inputRequirements[0]?.fieldCapability, { kind: "password" });
});

test("resolves conservative runtime value policies from structured metadata", () => {
  assert.equal(resolveRuntimeInputValuePolicy({ key: "x", sensitive: true, controlType: "text" }), "trusted_required");
  assert.equal(resolveRuntimeInputValuePolicy({ key: "x", fieldCapability: { kind: "password" } } as any), "trusted_required");
  assert.equal(resolveRuntimeInputValuePolicy({ key: "x", inputRole: "scenario", fieldCapability: { kind: "text" } } as any), "scenario_controlled");
  for (const kind of ["text", "number", "date", "email", "tel"]) {
    assert.equal(resolveRuntimeInputValuePolicy({ key: "x", inputRole: "supporting", fieldCapability: { kind } } as any), "safe_synthetic");
  }
  assert.equal(resolveRuntimeInputValuePolicy({ key: "x", inputRole: "supporting", fieldCapability: { kind: "select", allowedValues: ["A"] } } as any), "safe_synthetic");
  assert.equal(resolveRuntimeInputValuePolicy({ key: "x", inputRole: "supporting", fieldCapability: { kind: "select", allowedValues: [] } } as any), "unresolved");
  assert.equal(resolveRuntimeInputValuePolicy({ key: "account.email", label: "Email", controlType: "text" }), "unresolved");
});

test("contract declarations carry scenario authority", () => {
  const result = transformTestRailCaseForRuntime({ ...baseCase, custom_preconds: "Usuario (account.user, text)" });

  assert.equal(result.inputRequirements[0]?.source, "contract");
  assert.equal(result.inputRequirements[0]?.inputRole, "scenario");
  assert.equal(result.inputRequirements[0]?.valuePolicy, "scenario_controlled");
  assert.equal(result.inputRequirements[0]?.scenarioDataPolicy, "manual_required");
});

test("contract authority classifies a non-sensitive requirement without step refs", () => {
  const result = transformTestRailCaseForRuntime({ ...baseCase, custom_preconds: "Account (data.account, text)" });

  assert.equal(result.inputRequirements[0]?.inputRole, "scenario");
  assert.equal(result.inputRequirements[0]?.valuePolicy, "scenario_controlled");
});

test("placeholder provenance classifies runtime inferred requirements without text authority", () => {
  const result = transformTestRailCaseForRuntime(baseCase, {
    normalize: () => ({
      source: "testrail",
      externalId: "fixture",
      caseId: baseCase.id,
      title: "fixture",
      steps: [{ index: 1, action: "fixture", dataHints: [] }],
    }),
    convert: () => ({
      caseId: baseCase.id,
      requirements: [],
      unresolvedPlaceholders: [],
      conflicts: [],
      status: "empty",
      requiresApproval: true,
    }),
    propose: () => ({
      proposals: [{ key: "data.account", controlType: "email", confidence: 0.9, evidence: "ignored", provenance: "placeholder_reference" } as any],
      unresolved: [],
      requiresApproval: true,
    }),
  });

  assert.equal(result.inputRequirements[0]?.source, "runtime_inferred");
  assert.equal(result.inputRequirements[0]?.inputRole, "scenario");
  assert.equal(result.inputRequirements[0]?.valuePolicy, "scenario_controlled");
  assert.equal(result.inputRequirements[0]?.scenarioDataPolicy, "synthetic_allowed");
  assert.equal(result.inputRequirements[0]?.provenance, "placeholder_reference");

  const unresolved = transformTestRailCaseForRuntime(baseCase, {
    normalize: () => ({
      source: "testrail",
      externalId: "fixture",
      caseId: baseCase.id,
      title: "fixture",
      steps: [{ index: 1, action: "fixture", dataHints: [] }],
    }),
    convert: () => ({ caseId: baseCase.id, requirements: [], unresolvedPlaceholders: [], conflicts: [], status: "empty", requiresApproval: true }),
    propose: () => ({
      proposals: [{ key: "unproven.value", label: "Same", controlType: "text", confidence: 0.5, evidence: "ignored" }],
      unresolved: [],
      requiresApproval: true,
    }),
  });
  assert.equal(unresolved.inputRequirements[0]?.inputRole, undefined);
  assert.equal(unresolved.inputRequirements[0]?.valuePolicy, "unresolved");
});

function transformWithStructuredReferences(
  requirements: Array<Record<string, unknown>>,
  referencedKeys: string[],
) {
  return transformTestRailCaseForRuntime(baseCase, {
    normalize: () => ({
      source: "testrail",
      externalId: "fixture",
      caseId: baseCase.id,
      title: "fixture",
      steps: [{ index: 1, action: "fixture", dataHints: [], requirementRefs: referencedKeys }],
    }),
    convert: () => ({
      caseId: baseCase.id,
      requirements: requirements as any,
      unresolvedPlaceholders: [],
      conflicts: [],
      status: "proposed",
      requiresApproval: true,
    }),
    propose: () => ({ proposals: [], unresolved: [], requiresApproval: true }),
  });
}

test("classifies only structurally referenced requirements as scenario inputs", () => {
  const result = transformWithStructuredReferences([
    { key: "scenario.value", label: "Same", controlType: "text" },
    { key: "other.value", label: "Same", controlType: "text" },
    { key: "secret.value", label: "Same", controlType: "password", sensitive: true },
    { key: "supporting.value", label: "Same", controlType: "text", inputRole: "supporting" },
  ], ["scenario.value", "secret.value", "supporting.value"]);

  assert.equal(result.inputRequirements[0]?.inputRole, "scenario");
  assert.equal(result.inputRequirements[0]?.valuePolicy, "scenario_controlled");
  assert.equal(result.inputRequirements[1]?.inputRole, "scenario");
  assert.equal(result.inputRequirements[1]?.valuePolicy, "scenario_controlled");
  assert.equal(result.inputRequirements[2]?.inputRole, "scenario");
  assert.equal(result.inputRequirements[2]?.valuePolicy, "trusted_required");
  assert.equal(result.inputRequirements[3]?.inputRole, "supporting");
  assert.equal(result.inputRequirements[3]?.valuePolicy, "safe_synthetic");
});

test("preserves structured role evidence and select capability without inventing options", () => {
  const result = transformWithStructuredReferences([
    { key: "first", controlType: "text" },
    { key: "second", controlType: "number" },
    { key: "choice", controlType: "select", allowedValues: [] },
    { key: "explicit", controlType: "text", inputRole: "supporting" },
  ], ["first", "second", "choice"]);

  assert.equal(result.inputRequirements[0]?.valuePolicy, "scenario_controlled");
  assert.equal(result.inputRequirements[1]?.valuePolicy, "scenario_controlled");
  assert.deepEqual(result.inputRequirements[2]?.fieldCapability, {
    kind: "select",
    allowedValues: [],
    optionSource: "unknown",
  });
  assert.equal(result.inputRequirements[2]?.valuePolicy, "scenario_controlled");
  assert.equal(result.inputRequirements[3]?.inputRole, "supporting");
  assert.equal(result.inputRequirements[3]?.valuePolicy, "safe_synthetic");
  assert.equal(result.inputRequirements[0]?.source, "contract");
});
