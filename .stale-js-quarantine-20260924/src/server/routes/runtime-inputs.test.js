"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const runtime_inputs_1 = require("./runtime-inputs");
const scenario_semantic_enricher_1 = require("../../ai/scenario-semantic-enricher");
const requirement = (kind, extra = {}) => ({
    key: "fixture.value",
    inputRole: "scenario",
    valuePolicy: "scenario_controlled",
    scenarioDataPolicy: "synthetic_allowed",
    sensitive: false,
    fieldCapability: { kind },
    ...extra,
});
function fakeProvider(onCall, response = {
    status: "resolved", confidence: "high", semanticEvidence: [{ source: "requirement", summary: "fixture" }],
    generationProfile: { semanticType: "email", generationMode: "synthetic" },
}) {
    return {
        providerType: "fake", providerName: "fixture", model: "fixture", async completeJson() {
            onCall();
            return { rawText: JSON.stringify(response), parsedJson: response, model: "fixture", providerName: "fixture", durationMs: 1 };
        },
    };
}
(0, node_test_1.default)("batch delegates authorization and generation to the scenario resolver", async () => {
    const result = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        seed: "fixture-seed",
        requirements: [
            requirement("email"),
            requirement("tel", { key: "fixture.tel" }),
            requirement("number", { key: "fixture.number", fieldCapability: { kind: "number", constraints: { min: 1, max: 3 } } }),
            requirement("text", { key: "fixture.text" }),
            requirement("password", { key: "fixture.password" }),
            requirement("email", { key: "fixture.supporting", inputRole: "supporting" }),
        ],
    });
    strict_1.default.deepEqual(result.generated.map((item) => item.key), ["fixture.value", "fixture.tel", "fixture.number"]);
    strict_1.default.deepEqual(result.unresolved.map((item) => item.key), ["fixture.text", "fixture.password", "fixture.supporting"]);
    strict_1.default.equal(result.generated[0]?.value, (await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ seed: "fixture-seed", requirements: [requirement("email")] })).generated[0]?.value);
});
(0, node_test_1.default)("smart-prefill response carries display metadata while keeping secrets unresolved", async () => {
    const result = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        seed: "fixture-seed",
        requirements: [
            requirement("text", {
                key: "employee_1.document",
                label: "Cédula empleado 1",
                displayLabel: "Cédula",
                technicalLabel: "employee_1.document",
                entityDisplayName: "Empleado",
                datasetIdentity: "employee",
                datasetOrdinal: 1,
            }),
            requirement("password", { key: "auth.password", label: "Contraseña", sensitive: true }),
        ],
    });
    strict_1.default.equal(result.generated[0]?.key, "employee_1.document");
    strict_1.default.equal(result.generated[0]?.displayLabel, "Cédula");
    strict_1.default.equal(result.generated[0]?.technicalLabel, "employee_1.document");
    strict_1.default.equal(result.generated[0]?.datasetIdentity, "employee");
    strict_1.default.equal(result.generated[0]?.generated, true);
    strict_1.default.equal(result.generated[0]?.verified, false);
    strict_1.default.equal(result.generated[0]?.editable, true);
    strict_1.default.deepEqual(result.unresolved, [{ key: "auth.password", status: "unresolved" }]);
});
(0, node_test_1.default)("enriches only eligible requirements and caches accepted results", async () => {
    (0, scenario_semantic_enricher_1.clearScenarioSemanticEnrichmentCache)();
    let calls = 0;
    const provider = fakeProvider(() => { calls += 1; });
    const input = { seed: "fixture", scenarioContext: { steps: ["structured context"] }, requirements: [requirement("email")] };
    const first = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ ...input, provider });
    const second = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ ...input, provider });
    strict_1.default.equal(first.generated[0]?.generationProfileSource, "ai_semantic_enrichment");
    strict_1.default.equal(second.generated[0]?.generationProfileVersion !== undefined, true);
    strict_1.default.equal(calls, 1);
    await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ ...input, scenarioContext: { steps: ["changed context"] }, provider });
    await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ ...input, projectGenerationConfig: { availablePools: ["fixture"] }, provider });
    strict_1.default.equal(calls, 3);
});
(0, node_test_1.default)("skips existing profiles and protected requirements, and does not cache provider failures", async () => {
    (0, scenario_semantic_enricher_1.clearScenarioSemanticEnrichmentCache)();
    let calls = 0;
    const provider = fakeProvider(() => { calls += 1; });
    const existing = requirement("email", { generationProfile: { semanticType: "email", generationMode: "synthetic" } });
    await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ seed: "fixture", scenarioContext: { title: "context" }, requirements: [existing], provider });
    await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ seed: "fixture", scenarioContext: { title: "context" }, requirements: [
            requirement("email", { key: "protected", sensitive: true }),
            requirement("email", { key: "trusted", valuePolicy: "trusted_required" }),
            requirement("email", { key: "supporting", inputRole: "supporting" }),
        ], provider });
    strict_1.default.equal(calls, 0);
    const failing = fakeProvider(() => { calls += 1; });
    failing.completeJson = async () => { calls += 1; throw new Error("temporary"); };
    const failingInput = { seed: "failure", scenarioContext: { title: "context" }, requirements: [requirement("email")] };
    const first = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ ...failingInput, provider: failing });
    const second = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ ...failingInput, provider: failing });
    strict_1.default.equal(first.unresolved[0]?.enrichmentStatus, "unresolved");
    strict_1.default.equal(second.unresolved[0]?.enrichmentStatus, "unresolved");
    strict_1.default.equal(calls, 2);
});
(0, node_test_1.default)("loads project-scoped SQL config and ignores browser config", async () => {
    (0, scenario_semantic_enricher_1.clearScenarioSemanticEnrichmentCache)();
    const result = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        projectId: "00000000-0000-0000-0000-000000000001",
        seed: "fixture", scenarioContext: { title: "fixture" }, requirements: [requirement("text", { generationProfile: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "set-alpha" } })],
        projectGenerationConfig: { valueSets: { "set-beta": { values: ["BROWSER_VALUE"] } } },
        loadProjectGenerationConfig: async () => ({ version: "alpha", valueSets: { "set-alpha": { values: ["SQL_VALUE"] } } }),
    });
    strict_1.default.equal(result.generated.length, 1);
    strict_1.default.equal(result.generated[0]?.value, "SQL_VALUE");
    strict_1.default.equal(result.projectGenerationConfigLoaded, true);
    strict_1.default.equal(result.generationConfigVersion, "alpha");
});
(0, node_test_1.default)("enriches eligible manual requirements without granting frontend policy authority", async () => {
    (0, scenario_semantic_enricher_1.clearScenarioSemanticEnrichmentCache)();
    let calls = 0;
    const provider = fakeProvider(() => { calls += 1; }, {
        status: "resolved", confidence: "high", semanticEvidence: [{ source: "requirement", summary: "fixture" }],
        generationProfile: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "set-alpha", semanticHint: "informational" },
    });
    const result = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        seed: "manual-fixture",
        scenarioContext: { title: "fixture" },
        requirements: [requirement("text", { scenarioDataPolicy: "manual_required" })],
        projectGenerationConfig: { version: "fixture", valueSets: { "set-alpha": { values: ["CONFIGURED_VALUE"] } } },
        provider,
    });
    strict_1.default.equal(calls, 1);
    strict_1.default.equal(result.generated[0]?.source, "configured_values");
    strict_1.default.equal(result.generated[0]?.value, "CONFIGURED_VALUE");
    strict_1.default.equal(result.generated[0]?.generationProfileSource, "ai_semantic_enrichment");
});
(0, node_test_1.default)("uses the persisted named profile before semantic enrichment", async () => {
    let calls = 0;
    const result = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        projectId: "00000000-0000-0000-0000-000000000001",
        caseId: 101,
        seed: "binding-seed",
        scenarioContext: { title: "fixture" },
        requirements: [requirement("text", { key: "fixture.value" })],
        projectGenerationConfig: {
            version: "1",
            namedProfiles: { configured: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "values" } },
            valueSets: { values: { values: ["configured-value"] } },
        },
        loadProjectGenerationConfig: async () => ({
            version: "1",
            namedProfiles: { configured: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "values" } },
            valueSets: { values: { values: ["configured-value"] } },
        }),
        loadPersistedRequirements: async (projectId, caseId) => {
            strict_1.default.equal(projectId, "00000000-0000-0000-0000-000000000001");
            strict_1.default.equal(caseId, 101);
            return [{ key: "fixture.value", namedProfileRef: "configured" }];
        },
        provider: fakeProvider(() => { calls += 1; }),
    });
    strict_1.default.equal(calls, 0);
    strict_1.default.equal(result.generated[0]?.value, "configured-value");
    strict_1.default.equal(result.generated[0]?.generationProfile?.valueSetRef, "values");
});
(0, node_test_1.default)("treats a dangling persisted binding as terminal and never falls back", async () => {
    let calls = 0;
    const result = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        projectId: "00000000-0000-0000-0000-000000000001",
        caseId: 102,
        seed: "binding-seed",
        scenarioContext: { title: "fixture" },
        requirements: [requirement("text", { generationProfile: { valueKind: "string", sourceMode: "synthetic" } })],
        projectGenerationConfig: { version: "1", namedProfiles: {} },
        loadProjectGenerationConfig: async () => ({ version: "1", namedProfiles: {} }),
        loadPersistedRequirements: async () => [{ key: "fixture.value", namedProfileRef: "missing" }],
        provider: fakeProvider(() => { calls += 1; }),
    });
    strict_1.default.equal(calls, 0);
    strict_1.default.deepEqual(result.unresolved, [{ key: "fixture.value", status: "unresolved", reason: "named_profile_reference_not_configured" }]);
    strict_1.default.equal(result.generated.length, 0);
});
(0, node_test_1.default)("preserves inline and AI fallback when no persisted binding exists", async () => {
    let calls = 0;
    const inline = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        projectId: "00000000-0000-0000-0000-000000000001",
        caseId: 103,
        seed: "inline-seed",
        scenarioContext: { title: "fixture" },
        requirements: [requirement("text", { generationProfile: { valueKind: "string", sourceMode: "synthetic" } })],
        loadPersistedRequirements: async () => [],
        loadProjectGenerationConfig: async () => ({ version: "1", namedProfiles: {} }),
        provider: fakeProvider(() => { calls += 1; }),
    });
    strict_1.default.equal(inline.generated.length, 1);
    strict_1.default.equal(calls, 0);
    const fallback = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        projectId: "00000000-0000-0000-0000-000000000001",
        caseId: 104,
        seed: "ai-seed",
        scenarioContext: { title: "fixture" },
        requirements: [requirement("email")],
        loadPersistedRequirements: async () => [],
        loadProjectGenerationConfig: async () => ({ version: "1", namedProfiles: {} }),
        provider: fakeProvider(() => { calls += 1; }),
    });
    strict_1.default.equal(fallback.generated.length, 1);
    strict_1.default.equal(calls, 1);
});
(0, node_test_1.default)("does not cross project bindings and keeps missing caseId safe", async () => {
    let calls = 0;
    const loader = async (projectId, _caseId) => projectId === "00000000-0000-0000-0000-000000000001"
        ? [{ key: "fixture.value", namedProfileRef: "configured" }]
        : [];
    const config = {
        version: "1",
        namedProfiles: { configured: { valueKind: "string", sourceMode: "synthetic" } },
    };
    await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ projectId: "00000000-0000-0000-0000-000000000001", caseId: 105, seed: "x", requirements: [requirement("text")], projectGenerationConfig: config, loadPersistedRequirements: loader, loadProjectGenerationConfig: async () => config, provider: fakeProvider(() => { calls += 1; }) });
    await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ projectId: "00000000-0000-0000-0000-000000000002", caseId: 105, seed: "x", scenarioContext: { title: "fixture" }, requirements: [requirement("text")], projectGenerationConfig: config, loadPersistedRequirements: loader, loadProjectGenerationConfig: async () => config, provider: fakeProvider(() => { calls += 1; }) });
    let calledWithoutCaseId = false;
    await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({ projectId: "00000000-0000-0000-0000-000000000001", seed: "x", requirements: [requirement("text")], projectGenerationConfig: config, loadPersistedRequirements: async () => { calledWithoutCaseId = true; return []; } });
    strict_1.default.equal(calls, 1);
    strict_1.default.equal(calledWithoutCaseId, false);
});
(0, node_test_1.default)("replays a compatible confirmed runtime value before deterministic generation", async () => {
    let deterministicCalls = 0;
    const result = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        projectId: "00000000-0000-0000-0000-000000000001",
        caseId: 90001,
        seed: "replay-seed",
        requirements: [requirement("text", { semanticType: "document_number", datasetIdentity: "employee" })],
        loadProjectGenerationConfig: async () => undefined,
        loadConfirmedRuntimeValues: async () => [{
                key: "fixture.value",
                value: "confirmed-runtime-value",
                semanticType: "document_number",
                fieldKind: "text",
                datasetIdentity: "employee",
                source: "confirmed_case_runtime",
                verified: true,
            }],
        deterministicResolver: () => {
            deterministicCalls += 1;
            return { value: "wrong-fallback", source: "deterministic_synthetic" };
        },
    });
    strict_1.default.equal(result.generated.length, 0);
    strict_1.default.equal(result.resolved[0]?.source, "confirmed_replay");
    strict_1.default.equal(result.resolved[0]?.value, "confirmed-runtime-value");
    strict_1.default.equal(result.resolved[0]?.generated, false);
    strict_1.default.equal(result.resolved[0]?.verified, true);
    strict_1.default.equal(result.compatibleValuesFound, 1);
    strict_1.default.equal(deterministicCalls, 0);
});
(0, node_test_1.default)("rejects incompatible confirmed runtime metadata and uses the normal resolver", async () => {
    const result = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        projectId: "00000000-0000-0000-0000-000000000001",
        caseId: 90001,
        seed: "replay-seed",
        requirements: [requirement("text", { semanticType: "email", datasetIdentity: "employee" })],
        loadProjectGenerationConfig: async () => undefined,
        loadConfirmedRuntimeValues: async () => [{
                key: "fixture.value",
                value: "incompatible-value",
                semanticType: "document_number",
                fieldKind: "text",
                datasetIdentity: "employee",
                source: "confirmed_case_runtime",
                verified: true,
            }],
    });
    strict_1.default.equal(result.generated.length, 1);
    strict_1.default.equal(result.generated[0]?.source, "deterministic_synthetic");
    strict_1.default.equal(result.compatibleValuesFound, 0);
    strict_1.default.equal(result.incompatibleValuesRejected, 1);
});
(0, node_test_1.default)("keeps confirmed replay metadata in the resolved contract while generated stays backward compatible", async () => {
    const result = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        projectId: "00000000-0000-0000-0000-000000000001",
        caseId: 90001,
        seed: "mixed-seed",
        requirements: [
            requirement("text", { key: "fixture.replayed" }),
            requirement("email", { key: "fixture.generated" }),
        ],
        loadProjectGenerationConfig: async () => undefined,
        loadConfirmedRuntimeValues: async () => [{
                key: "fixture.replayed",
                value: "confirmed",
                source: "confirmed_case_runtime",
                verified: true,
            }],
    });
    strict_1.default.deepEqual(result.resolved.map((field) => [field.key, field.source]), [
        ["fixture.replayed", "confirmed_replay"],
        ["fixture.generated", "deterministic_synthetic"],
    ]);
    strict_1.default.deepEqual(result.generated.map((field) => field.key), ["fixture.generated"]);
});
(0, node_test_1.default)("never replays a secret value", async () => {
    let providerCalls = 0;
    const result = await (0, runtime_inputs_1.resolveScenarioSyntheticBatch)({
        projectId: "00000000-0000-0000-0000-000000000001",
        caseId: 90001,
        seed: "secret-seed",
        requirements: [requirement("password", { key: "auth.password", sensitive: true })],
        loadProjectGenerationConfig: async () => undefined,
        loadConfirmedRuntimeValues: async () => [{
                key: "auth.password",
                value: "secret-must-not-appear",
                source: "confirmed_case_runtime",
                verified: true,
            }],
        provider: fakeProvider(() => { providerCalls += 1; }),
    });
    strict_1.default.equal(result.resolved.length, 0);
    strict_1.default.deepEqual(result.unresolved, [{ key: "auth.password", status: "unresolved" }]);
    strict_1.default.equal(result.compatibleValuesFound, 0);
    strict_1.default.equal(providerCalls, 0);
});
