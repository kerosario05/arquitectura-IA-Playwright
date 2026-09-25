"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const testrail_normalizer_1 = require("./testrail-normalizer");
const testrail_runtime_transformer_1 = require("./testrail-runtime-transformer");
const field_capability_1 = require("./field-capability");
const runtime_value_policy_1 = require("./runtime-value-policy");
const baseCase = { id: 92001, title: "Consultar saldo", custom_steps: "Abrir la cuenta", custom_expected: "Se muestra el saldo" };
(0, node_test_1.default)("contractual declaration becomes a contract runtime requirement", () => {
    const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({ ...baseCase, custom_preconds: "Cuenta (account.id, text)" });
    strict_1.default.equal(result.inputRequirements[0]?.key, "account.id");
    strict_1.default.equal(result.inputRequirements[0]?.source, "contract");
    strict_1.default.equal(result.inputRequirements[0]?.scenarioDataPolicy, "manual_required");
});
(0, node_test_1.default)("keeps TestRail human labels, indexed entity metadata, and secret capability at the runtime boundary", () => {
    const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({
        ...baseCase,
        custom_preconds: "<ol><li>- Cédula empleado 1 (employee_1.document, text)</li><li>- Contraseña (auth.password, secret) [SECRETO]</li></ol>",
    });
    strict_1.default.deepEqual(result.inputRequirements[0], {
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
    strict_1.default.equal(result.inputRequirements[1]?.label, "Contraseña");
    strict_1.default.equal(result.inputRequirements[1]?.sensitive, true);
    strict_1.default.deepEqual(result.inputRequirements[1]?.fieldCapability, { kind: "password" });
});
(0, node_test_1.default)("transformer preserves an existing generation profile and does not invent one", () => {
    const profile = { semanticType: "money", generationMode: "synthetic", numeric: { integerOnly: true, decimalScale: 0 } };
    const preserved = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({ ...baseCase, custom_preconds: "Amount (data.amount, number)" }, {
        convert: () => ({ caseId: baseCase.id, requirements: [{ key: "data.amount", controlType: "number", generationProfile: profile }], unresolvedPlaceholders: [], conflicts: [], status: "proposed", requiresApproval: true }),
        propose: () => ({ proposals: [], unresolved: [], requiresApproval: true }),
    });
    strict_1.default.deepEqual(preserved.inputRequirements[0]?.generationProfile, profile);
    const absent = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({ ...baseCase, custom_preconds: "Amount (data.amount, number)" });
    strict_1.default.equal(absent.inputRequirements[0]?.generationProfile, undefined);
});
(0, node_test_1.default)("sufficient placeholder context becomes a runtime inferred requirement", () => {
    const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({ ...baseCase, custom_preconds: "Contraseña [auth.password]" });
    strict_1.default.equal(result.inputRequirements[0]?.key, "auth.password");
    strict_1.default.equal(result.inputRequirements[0]?.source, "runtime_inferred");
    strict_1.default.equal(result.inputRequirements[0]?.scenarioDataPolicy, "trusted_required");
});
(0, node_test_1.default)("contractual requirement wins over an inferred duplicate", () => {
    const rawCase = { ...baseCase, custom_preconds: "Usuario (auth.user, text)" };
    const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)(rawCase, {
        propose: () => ({
            proposals: [{ key: "auth.user", label: "Otro usuario", controlType: "password", confidence: 0.9, evidence: "fixture" }],
            unresolved: [],
            requiresApproval: true,
        }),
    });
    strict_1.default.equal(result.inputRequirements.filter((item) => item.key === "auth.user").length, 1);
    strict_1.default.equal(result.inputRequirements[0]?.source, "contract");
    strict_1.default.equal(result.conflicts[0]?.key, "auth.user");
});
(0, node_test_1.default)("insufficient placeholder evidence remains unresolved", () => {
    const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({ ...baseCase, custom_preconds: "Cliente [customer.id]" });
    strict_1.default.deepEqual(result.inputRequirements, []);
    strict_1.default.deepEqual(result.unresolvedPlaceholders, ["customer.id"]);
});
(0, node_test_1.default)("contract conflicts remain explicit", () => {
    const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({ ...baseCase, custom_preconds: "Usuario (auth.user, text)\nUsuario secreto (auth.user, password)" });
    strict_1.default.equal(result.conflicts.length, 1);
    strict_1.default.equal(result.conflicts[0]?.key, "auth.user");
});
(0, node_test_1.default)("normalizedScenario is produced by the existing normalizer", () => {
    const rawCase = { ...baseCase, custom_preconds: "Cuenta (account.id, text)" };
    const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)(rawCase);
    strict_1.default.deepEqual(result.normalizedScenario, (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase));
});
(0, node_test_1.default)("resolves known field capabilities without inventing constraints", () => {
    strict_1.default.deepEqual((0, field_capability_1.resolveFieldCapability)({ key: "name", controlType: "text" }), { kind: "text" });
    strict_1.default.deepEqual((0, field_capability_1.resolveFieldCapability)({ key: "secret", sensitive: true }), { kind: "password" });
    strict_1.default.deepEqual((0, field_capability_1.resolveFieldCapability)({ key: "secret", controlType: "secret", sensitive: true }), { kind: "password" });
    strict_1.default.deepEqual((0, field_capability_1.resolveFieldCapability)({ key: "status", controlType: "select", allowedValues: ["A", "B"] }), {
        kind: "select",
        allowedValues: ["A", "B"],
        optionSource: "contract",
    });
    strict_1.default.deepEqual((0, field_capability_1.resolveFieldCapability)({ key: "status", controlType: "select" }), {
        kind: "select",
        allowedValues: [],
        optionSource: "unknown",
    });
    for (const controlType of ["number", "date", "email", "tel", "file"]) {
        strict_1.default.equal((0, field_capability_1.resolveFieldCapability)({ key: "field", controlType }).kind, controlType);
    }
    strict_1.default.deepEqual((0, field_capability_1.resolveFieldCapability)({ key: "field", controlType: "widget" }), { kind: "unknown" });
});
(0, node_test_1.default)("transformer carries fieldCapability without changing provenance", () => {
    const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({ ...baseCase, custom_preconds: "Status (account.status, select)" }, {
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
    strict_1.default.equal(result.inputRequirements[0]?.source, "contract");
    strict_1.default.deepEqual(result.inputRequirements[0]?.fieldCapability, {
        kind: "select",
        allowedValues: ["active"],
        optionSource: "contract",
    });
    const inferred = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({ ...baseCase, custom_preconds: "Contraseña [auth.password]" });
    strict_1.default.equal(inferred.inputRequirements[0]?.source, "runtime_inferred");
    strict_1.default.deepEqual(inferred.inputRequirements[0]?.fieldCapability, { kind: "password" });
});
(0, node_test_1.default)("resolves conservative runtime value policies from structured metadata", () => {
    strict_1.default.equal((0, runtime_value_policy_1.resolveRuntimeInputValuePolicy)({ key: "x", sensitive: true, controlType: "text" }), "trusted_required");
    strict_1.default.equal((0, runtime_value_policy_1.resolveRuntimeInputValuePolicy)({ key: "x", fieldCapability: { kind: "password" } }), "trusted_required");
    strict_1.default.equal((0, runtime_value_policy_1.resolveRuntimeInputValuePolicy)({ key: "x", inputRole: "scenario", fieldCapability: { kind: "text" } }), "scenario_controlled");
    for (const kind of ["text", "number", "date", "email", "tel"]) {
        strict_1.default.equal((0, runtime_value_policy_1.resolveRuntimeInputValuePolicy)({ key: "x", inputRole: "supporting", fieldCapability: { kind } }), "safe_synthetic");
    }
    strict_1.default.equal((0, runtime_value_policy_1.resolveRuntimeInputValuePolicy)({ key: "x", inputRole: "supporting", fieldCapability: { kind: "select", allowedValues: ["A"] } }), "safe_synthetic");
    strict_1.default.equal((0, runtime_value_policy_1.resolveRuntimeInputValuePolicy)({ key: "x", inputRole: "supporting", fieldCapability: { kind: "select", allowedValues: [] } }), "unresolved");
    strict_1.default.equal((0, runtime_value_policy_1.resolveRuntimeInputValuePolicy)({ key: "account.email", label: "Email", controlType: "text" }), "unresolved");
});
(0, node_test_1.default)("contract declarations carry scenario authority", () => {
    const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({ ...baseCase, custom_preconds: "Usuario (account.user, text)" });
    strict_1.default.equal(result.inputRequirements[0]?.source, "contract");
    strict_1.default.equal(result.inputRequirements[0]?.inputRole, "scenario");
    strict_1.default.equal(result.inputRequirements[0]?.valuePolicy, "scenario_controlled");
    strict_1.default.equal(result.inputRequirements[0]?.scenarioDataPolicy, "manual_required");
});
(0, node_test_1.default)("contract authority classifies a non-sensitive requirement without step refs", () => {
    const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({ ...baseCase, custom_preconds: "Account (data.account, text)" });
    strict_1.default.equal(result.inputRequirements[0]?.inputRole, "scenario");
    strict_1.default.equal(result.inputRequirements[0]?.valuePolicy, "scenario_controlled");
});
(0, node_test_1.default)("placeholder provenance classifies runtime inferred requirements without text authority", () => {
    const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)(baseCase, {
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
            proposals: [{ key: "data.account", controlType: "email", confidence: 0.9, evidence: "ignored", provenance: "placeholder_reference" }],
            unresolved: [],
            requiresApproval: true,
        }),
    });
    strict_1.default.equal(result.inputRequirements[0]?.source, "runtime_inferred");
    strict_1.default.equal(result.inputRequirements[0]?.inputRole, "scenario");
    strict_1.default.equal(result.inputRequirements[0]?.valuePolicy, "scenario_controlled");
    strict_1.default.equal(result.inputRequirements[0]?.scenarioDataPolicy, "synthetic_allowed");
    strict_1.default.equal(result.inputRequirements[0]?.provenance, "placeholder_reference");
    const unresolved = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)(baseCase, {
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
    strict_1.default.equal(unresolved.inputRequirements[0]?.inputRole, undefined);
    strict_1.default.equal(unresolved.inputRequirements[0]?.valuePolicy, "unresolved");
});
function transformWithStructuredReferences(requirements, referencedKeys) {
    return (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)(baseCase, {
        normalize: () => ({
            source: "testrail",
            externalId: "fixture",
            caseId: baseCase.id,
            title: "fixture",
            steps: [{ index: 1, action: "fixture", dataHints: [], requirementRefs: referencedKeys }],
        }),
        convert: () => ({
            caseId: baseCase.id,
            requirements: requirements,
            unresolvedPlaceholders: [],
            conflicts: [],
            status: "proposed",
            requiresApproval: true,
        }),
        propose: () => ({ proposals: [], unresolved: [], requiresApproval: true }),
    });
}
(0, node_test_1.default)("classifies only structurally referenced requirements as scenario inputs", () => {
    const result = transformWithStructuredReferences([
        { key: "scenario.value", label: "Same", controlType: "text" },
        { key: "other.value", label: "Same", controlType: "text" },
        { key: "secret.value", label: "Same", controlType: "password", sensitive: true },
        { key: "supporting.value", label: "Same", controlType: "text", inputRole: "supporting" },
    ], ["scenario.value", "secret.value", "supporting.value"]);
    strict_1.default.equal(result.inputRequirements[0]?.inputRole, "scenario");
    strict_1.default.equal(result.inputRequirements[0]?.valuePolicy, "scenario_controlled");
    strict_1.default.equal(result.inputRequirements[1]?.inputRole, "scenario");
    strict_1.default.equal(result.inputRequirements[1]?.valuePolicy, "scenario_controlled");
    strict_1.default.equal(result.inputRequirements[2]?.inputRole, "scenario");
    strict_1.default.equal(result.inputRequirements[2]?.valuePolicy, "trusted_required");
    strict_1.default.equal(result.inputRequirements[3]?.inputRole, "supporting");
    strict_1.default.equal(result.inputRequirements[3]?.valuePolicy, "safe_synthetic");
});
(0, node_test_1.default)("preserves structured role evidence and select capability without inventing options", () => {
    const result = transformWithStructuredReferences([
        { key: "first", controlType: "text" },
        { key: "second", controlType: "number" },
        { key: "choice", controlType: "select", allowedValues: [] },
        { key: "explicit", controlType: "text", inputRole: "supporting" },
    ], ["first", "second", "choice"]);
    strict_1.default.equal(result.inputRequirements[0]?.valuePolicy, "scenario_controlled");
    strict_1.default.equal(result.inputRequirements[1]?.valuePolicy, "scenario_controlled");
    strict_1.default.deepEqual(result.inputRequirements[2]?.fieldCapability, {
        kind: "select",
        allowedValues: [],
        optionSource: "unknown",
    });
    strict_1.default.equal(result.inputRequirements[2]?.valuePolicy, "scenario_controlled");
    strict_1.default.equal(result.inputRequirements[3]?.inputRole, "supporting");
    strict_1.default.equal(result.inputRequirements[3]?.valuePolicy, "safe_synthetic");
    strict_1.default.equal(result.inputRequirements[0]?.source, "contract");
});
