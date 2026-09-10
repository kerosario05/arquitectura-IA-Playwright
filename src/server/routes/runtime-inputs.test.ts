import assert from "node:assert/strict";
import test from "node:test";
import { resolveScenarioSyntheticBatch } from "./runtime-inputs";
import type { AiCompletionResponse, AiProvider } from "../../ai/ai-provider.types";
import { clearScenarioSemanticEnrichmentCache } from "../../ai/scenario-semantic-enricher";

const requirement = (kind: string, extra: Record<string, unknown> = {}) => ({
  key: "fixture.value",
  inputRole: "scenario",
  valuePolicy: "scenario_controlled",
  scenarioDataPolicy: "synthetic_allowed",
  sensitive: false,
  fieldCapability: { kind },
  ...extra,
}) as any;

function fakeProvider(onCall: () => void, response: unknown = {
  status: "resolved", confidence: "high", semanticEvidence: [{ source: "requirement", summary: "fixture" }],
  generationProfile: { semanticType: "email", generationMode: "synthetic" },
}): AiProvider {
  return {
    providerType: "fake", providerName: "fixture", model: "fixture", async completeJson(): Promise<AiCompletionResponse> {
      onCall();
      return { rawText: JSON.stringify(response), parsedJson: response as Record<string, unknown>, model: "fixture", providerName: "fixture", durationMs: 1 };
    },
  };
}

test("batch delegates authorization and generation to the scenario resolver", async () => {
  const result = await resolveScenarioSyntheticBatch({
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

  assert.deepEqual(result.generated.map((item) => item.key), ["fixture.value", "fixture.tel", "fixture.number"]);
  assert.deepEqual(result.unresolved.map((item) => item.key), ["fixture.text", "fixture.password", "fixture.supporting"]);
  assert.equal(result.generated[0]?.value, (await resolveScenarioSyntheticBatch({ seed: "fixture-seed", requirements: [requirement("email")] })).generated[0]?.value);
});

test("smart-prefill response carries display metadata while keeping secrets unresolved", async () => {
  const result = await resolveScenarioSyntheticBatch({
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

  assert.equal(result.generated[0]?.key, "employee_1.document");
  assert.equal(result.generated[0]?.displayLabel, "Cédula");
  assert.equal(result.generated[0]?.technicalLabel, "employee_1.document");
  assert.equal(result.generated[0]?.datasetIdentity, "employee");
  assert.equal(result.generated[0]?.generated, true);
  assert.equal(result.generated[0]?.verified, false);
  assert.equal(result.generated[0]?.editable, true);
  assert.deepEqual(result.unresolved, [{ key: "auth.password", status: "unresolved" }]);
});

test("enriches only eligible requirements and caches accepted results", async () => {
  clearScenarioSemanticEnrichmentCache();
  let calls = 0;
  const provider = fakeProvider(() => { calls += 1; });
  const input = { seed: "fixture", scenarioContext: { steps: ["structured context"] }, requirements: [requirement("email")] };
  const first = await resolveScenarioSyntheticBatch({ ...input, provider });
  const second = await resolveScenarioSyntheticBatch({ ...input, provider });
  assert.equal(first.generated[0]?.generationProfileSource, "ai_semantic_enrichment");
  assert.equal(second.generated[0]?.generationProfileVersion !== undefined, true);
  assert.equal(calls, 1);

  await resolveScenarioSyntheticBatch({ ...input, scenarioContext: { steps: ["changed context"] }, provider });
  await resolveScenarioSyntheticBatch({ ...input, projectGenerationConfig: { availablePools: ["fixture"] }, provider });
  assert.equal(calls, 3);
});

test("skips existing profiles and protected requirements, and does not cache provider failures", async () => {
  clearScenarioSemanticEnrichmentCache();
  let calls = 0;
  const provider = fakeProvider(() => { calls += 1; });
  const existing = requirement("email", { generationProfile: { semanticType: "email", generationMode: "synthetic" } });
  await resolveScenarioSyntheticBatch({ seed: "fixture", scenarioContext: { title: "context" }, requirements: [existing], provider });
  await resolveScenarioSyntheticBatch({ seed: "fixture", scenarioContext: { title: "context" }, requirements: [
    requirement("email", { key: "protected", sensitive: true }),
    requirement("email", { key: "trusted", valuePolicy: "trusted_required" }),
    requirement("email", { key: "supporting", inputRole: "supporting" }),
  ], provider });
  assert.equal(calls, 0);

  const failing = fakeProvider(() => { calls += 1; });
  failing.completeJson = async () => { calls += 1; throw new Error("temporary"); };
  const failingInput = { seed: "failure", scenarioContext: { title: "context" }, requirements: [requirement("email")] };
  const first = await resolveScenarioSyntheticBatch({ ...failingInput, provider: failing });
  const second = await resolveScenarioSyntheticBatch({ ...failingInput, provider: failing });
  assert.equal(first.unresolved[0]?.enrichmentStatus, "unresolved");
  assert.equal(second.unresolved[0]?.enrichmentStatus, "unresolved");
  assert.equal(calls, 2);
});

test("loads project-scoped SQL config and ignores browser config", async () => {
  clearScenarioSemanticEnrichmentCache();
  const result = await resolveScenarioSyntheticBatch({
    projectId: "00000000-0000-0000-0000-000000000001",
    seed: "fixture", scenarioContext: { title: "fixture" }, requirements: [requirement("text", { generationProfile: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "set-alpha" } })],
    projectGenerationConfig: { valueSets: { "set-beta": { values: ["BROWSER_VALUE"] } } } as any,
    loadProjectGenerationConfig: async () => ({ version: "alpha", valueSets: { "set-alpha": { values: ["SQL_VALUE"] } } }),
  });
  assert.equal(result.generated.length, 1);
  assert.equal(result.generated[0]?.value, "SQL_VALUE");
  assert.equal(result.projectGenerationConfigLoaded, true);
  assert.equal(result.generationConfigVersion, "alpha");
});

test("enriches eligible manual requirements without granting frontend policy authority", async () => {
  clearScenarioSemanticEnrichmentCache();
  let calls = 0;
  const provider = fakeProvider(() => { calls += 1; }, {
    status: "resolved", confidence: "high", semanticEvidence: [{ source: "requirement", summary: "fixture" }],
    generationProfile: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "set-alpha", semanticHint: "informational" },
  });
  const result = await resolveScenarioSyntheticBatch({
    seed: "manual-fixture",
    scenarioContext: { title: "fixture" },
    requirements: [requirement("text", { scenarioDataPolicy: "manual_required" })],
    projectGenerationConfig: { version: "fixture", valueSets: { "set-alpha": { values: ["CONFIGURED_VALUE"] } } } as any,
    provider,
  });
  assert.equal(calls, 1);
  assert.equal(result.generated[0]?.source, "configured_values");
  assert.equal(result.generated[0]?.value, "CONFIGURED_VALUE");
  assert.equal(result.generated[0]?.generationProfileSource, "ai_semantic_enrichment");
});

test("uses the persisted named profile before semantic enrichment", async () => {
  let calls = 0;
  const result = await resolveScenarioSyntheticBatch({
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
      assert.equal(projectId, "00000000-0000-0000-0000-000000000001");
      assert.equal(caseId, 101);
      return [{ key: "fixture.value", namedProfileRef: "configured" }];
    },
    provider: fakeProvider(() => { calls += 1; }),
  });
  assert.equal(calls, 0);
  assert.equal(result.generated[0]?.value, "configured-value");
  assert.equal((result.generated[0]?.generationProfile as any)?.valueSetRef, "values");
});

test("treats a dangling persisted binding as terminal and never falls back", async () => {
  let calls = 0;
  const result = await resolveScenarioSyntheticBatch({
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
  assert.equal(calls, 0);
  assert.deepEqual(result.unresolved, [{ key: "fixture.value", status: "unresolved", reason: "named_profile_reference_not_configured" }]);
  assert.equal(result.generated.length, 0);
});

test("preserves inline and AI fallback when no persisted binding exists", async () => {
  let calls = 0;
  const inline = await resolveScenarioSyntheticBatch({
    projectId: "00000000-0000-0000-0000-000000000001",
    caseId: 103,
    seed: "inline-seed",
    scenarioContext: { title: "fixture" },
    requirements: [requirement("text", { generationProfile: { valueKind: "string", sourceMode: "synthetic" } })],
    loadPersistedRequirements: async () => [],
    loadProjectGenerationConfig: async () => ({ version: "1", namedProfiles: {} }),
    provider: fakeProvider(() => { calls += 1; }),
  });
  assert.equal(inline.generated.length, 1);
  assert.equal(calls, 0);

  const fallback = await resolveScenarioSyntheticBatch({
    projectId: "00000000-0000-0000-0000-000000000001",
    caseId: 104,
    seed: "ai-seed",
    scenarioContext: { title: "fixture" },
    requirements: [requirement("email")],
    loadPersistedRequirements: async () => [],
    loadProjectGenerationConfig: async () => ({ version: "1", namedProfiles: {} }),
    provider: fakeProvider(() => { calls += 1; }),
  });
  assert.equal(fallback.generated.length, 1);
  assert.equal(calls, 1);
});

test("does not cross project bindings and keeps missing caseId safe", async () => {
  let calls = 0;
  const loader = async (projectId: string, _caseId: number) => projectId === "00000000-0000-0000-0000-000000000001"
    ? [{ key: "fixture.value", namedProfileRef: "configured" }]
    : [];
  const config = {
    version: "1",
    namedProfiles: { configured: { valueKind: "string", sourceMode: "synthetic" } },
  } as any;
  await resolveScenarioSyntheticBatch({ projectId: "00000000-0000-0000-0000-000000000001", caseId: 105, seed: "x", requirements: [requirement("text")], projectGenerationConfig: config, loadPersistedRequirements: loader, loadProjectGenerationConfig: async () => config, provider: fakeProvider(() => { calls += 1; }) });
  await resolveScenarioSyntheticBatch({ projectId: "00000000-0000-0000-0000-000000000002", caseId: 105, seed: "x", scenarioContext: { title: "fixture" }, requirements: [requirement("text")], projectGenerationConfig: config, loadPersistedRequirements: loader, loadProjectGenerationConfig: async () => config, provider: fakeProvider(() => { calls += 1; }) });
  let calledWithoutCaseId = false;
  await resolveScenarioSyntheticBatch({ projectId: "00000000-0000-0000-0000-000000000001", seed: "x", requirements: [requirement("text")], projectGenerationConfig: config, loadPersistedRequirements: async () => { calledWithoutCaseId = true; return []; } });
  assert.equal(calls, 1);
  assert.equal(calledWithoutCaseId, false);
});

test("replays a compatible confirmed runtime value before deterministic generation", async () => {
  let deterministicCalls = 0;
  const result = await resolveScenarioSyntheticBatch({
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
  assert.equal(result.generated.length, 0);
  assert.equal(result.resolved[0]?.source, "confirmed_replay");
  assert.equal(result.resolved[0]?.value, "confirmed-runtime-value");
  assert.equal(result.resolved[0]?.generated, false);
  assert.equal(result.resolved[0]?.verified, true);
  assert.equal(result.compatibleValuesFound, 1);
  assert.equal(deterministicCalls, 0);
});

test("rejects incompatible confirmed runtime metadata and uses the normal resolver", async () => {
  const result = await resolveScenarioSyntheticBatch({
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
  assert.equal(result.generated.length, 1);
  assert.equal(result.generated[0]?.source, "deterministic_synthetic");
  assert.equal(result.compatibleValuesFound, 0);
  assert.equal(result.incompatibleValuesRejected, 1);
});

test("keeps confirmed replay metadata in the resolved contract while generated stays backward compatible", async () => {
  const result = await resolveScenarioSyntheticBatch({
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
  assert.deepEqual(result.resolved.map((field) => [field.key, field.source]), [
    ["fixture.replayed", "confirmed_replay"],
    ["fixture.generated", "deterministic_synthetic"],
  ]);
  assert.deepEqual(result.generated.map((field) => field.key), ["fixture.generated"]);
});

test("never replays a secret value", async () => {
  let providerCalls = 0;
  const result = await resolveScenarioSyntheticBatch({
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
  assert.equal(result.resolved.length, 0);
  assert.deepEqual(result.unresolved, [{ key: "auth.password", status: "unresolved" }]);
  assert.equal(result.compatibleValuesFound, 0);
  assert.equal(providerCalls, 0);
});
