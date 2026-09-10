import assert from "node:assert/strict";
import test from "node:test";
import type { AiCompletionRequest, AiCompletionResponse, AiProvider } from "./ai-provider.types";
import { clearScenarioSemanticEnrichmentCache, enrichScenarioInputSemantics as runScenarioSemanticEnrichment, summarizeSemanticResponseShape, validateSemanticResponse } from "./scenario-semantic-enricher";
import { SCENARIO_DATA_SEMANTICS_INSTRUCTIONS } from "./prompts/scenario-data-semantics";

const capability = { kind: "number" as const };
const requirement = { key: "fixture.amount", label: "Fixture amount", fieldCapability: capability, inputRole: "scenario" as const, valuePolicy: "scenario_controlled" as const, scenarioDataPolicy: "manual_required" as const } as any;
const profile = { semanticType: "money", generationMode: "synthetic", numeric: { integerOnly: true, decimalScale: 0 } };

function provider(parsedJson: unknown, inspect?: (request: AiCompletionRequest) => void): AiProvider {
  return {
    providerType: "fake",
    providerName: "fixture",
    model: "fixture-model",
    async completeJson(request): Promise<AiCompletionResponse> {
      inspect?.(request);
      return { rawText: JSON.stringify(parsedJson), parsedJson: parsedJson as Record<string, unknown>, model: "fixture-model", providerName: "fixture", durationMs: 1 };
    },
  };
}

const validResponse = { status: "resolved", confidence: "high", semanticEvidence: [{ source: "requirement", summary: "structured fixture evidence" }], generationProfile: profile };

async function enrichScenarioInputSemantics(input: Parameters<typeof runScenarioSemanticEnrichment>[0]) {
  clearScenarioSemanticEnrichmentCache();
  return runScenarioSemanticEnrichment(input);
}

test("validates semantic enrichment before accepting a profile", async () => {
  assert.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider(validResponse) })).status, "accepted");
  assert.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, generationProfile: { ...profile, semanticType: "not-valid" } }) })).status, "rejected");
  assert.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, confidence: "low" }) })).status, "unresolved");
  assert.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, generationProfile: { ...profile, semanticType: "money" } }) })).status, "accepted");
  assert.equal((await enrichScenarioInputSemantics({ requirement: { ...requirement, fieldCapability: { kind: "email" } }, scenarioContext: {}, projectGenerationConfig: {}, provider: provider(validResponse) })).status, "rejected");
  assert.equal((await enrichScenarioInputSemantics({ requirement: { ...requirement, fieldCapability: { kind: "text" } }, scenarioContext: {}, projectGenerationConfig: { availablePools: ["fixture_pool"] }, provider: provider({ ...validResponse, generationProfile: { semanticType: "document_identifier", generationMode: "configured_pool", poolRef: "fixture_pool" } }) })).status, "accepted");
  assert.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, generationProfile: { semanticType: "document_identifier", generationMode: "configured_pool", poolRef: "missing" } }) })).status, "rejected");
  assert.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, generationProfile: { semanticType: "job_title", generationMode: "configured_dictionary", dictionaryRef: "missing" } }) })).status, "rejected");
  assert.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: { ...provider(validResponse), async completeJson() { throw new Error("provider failed"); } } })).status, "unresolved");
  assert.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ nope: true }) })).status, "rejected");
  assert.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, extra: true }) })).status, "rejected");
  assert.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: { ...provider(validResponse), async completeJson() { return { rawText: "not-json", model: "fixture-model", providerName: "fixture", durationMs: 1 }; } } })).status, "unresolved");

  let serialized = "";
  const safe = await enrichScenarioInputSemantics({ requirement: { ...requirement, runtimeValue: "secret-value" }, scenarioContext: {}, projectGenerationConfig: {}, provider: provider(validResponse, (request) => { serialized = JSON.stringify(request); }) });
  assert.equal(safe.status, "accepted");
  assert.equal(serialized.includes("secret-value"), false);
});

test("reports the first semantic schema error with a safe path", () => {
  const extra = validateSemanticResponse({ status: "resolved", confidence: "high", semanticEvidence: [], extra: "secret" });
  assert.equal(extra.valid, false);
  if (!extra.valid) assert.deepEqual(extra.errors[0], {
    path: "extra",
    code: "unknown_property",
    expected: "confidence|generationProfile|semanticEvidence|status",
    receivedType: "string",
  });

  const invalidStatus = validateSemanticResponse({ status: "bad", confidence: "high", semanticEvidence: [] });
  assert.equal(invalidStatus.valid, false);
  if (!invalidStatus.valid) assert.equal(invalidStatus.errors[0].path, "status");

  const invalidEvidence = validateSemanticResponse({ status: "unresolved", confidence: "high", semanticEvidence: [{ source: "wrong", summary: "do not log" }] });
  assert.equal(invalidEvidence.valid, false);
  if (!invalidEvidence.valid) assert.equal(invalidEvidence.errors[0].path, "semanticEvidence[0].source");

  const invalidProfile = validateSemanticResponse({ status: "resolved", confidence: "high", semanticEvidence: [], generationProfile: { valueKind: "string", sourceMode: "synthetic", unknown: true } });
  assert.equal(invalidProfile.valid, false);
  if (!invalidProfile.valid) assert.equal(invalidProfile.errors[0].path, "generationProfile.unknown");

  const valid = validateSemanticResponse({ status: "resolved", confidence: "high", semanticEvidence: [], generationProfile: { valueKind: "string", sourceMode: "synthetic" } });
  assert.equal(valid.valid, true);
});

test("summarizes only semantic response structure", () => {
  const summary = summarizeSemanticResponseShape({
    status: "resolved", confidence: "high",
    semanticEvidence: [{ source: "requirement", summary: "secret user label" }],
    generationProfile: { valueKind: "string", sourceMode: "synthetic", constraints: { minLength: 2 }, format: { characterSet: "letters" } },
  });
  assert.deepEqual(summary.topLevelKeys, ["confidence", "generationProfile", "semanticEvidence", "status"]);
  assert.deepEqual(summary.generationProfileKeys, ["constraints", "format", "sourceMode", "valueKind"]);
  assert.equal(JSON.stringify(summary).includes("secret user label"), false);
});

test("emits structured schema diagnostics only when enabled", async () => {
  const original = process.env.DEBUG_SEMANTIC_ENRICHMENT_SCHEMA;
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  try {
    delete process.env.DEBUG_SEMANTIC_ENRICHMENT_SCHEMA;
    const publicResult = await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ status: "resolved", confidence: "high", semanticEvidence: [], extra: true }) });
    assert.equal(publicResult.reason, "schema_validation_failed");
    assert.deepEqual(publicResult.validationErrors, ["response_shape_invalid"]);
    assert.equal(logs.some((line) => line.includes("semantic-enrichment:schema-rejected")), false);
    process.env.DEBUG_SEMANTIC_ENRICHMENT_SCHEMA = "true";
    await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ status: "resolved", confidence: "high", semanticEvidence: [], extra: true }) });
    assert.equal(logs.some((line) => line.includes("semantic-enrichment:schema-rejected")), true);
    assert.equal(logs.some((line) => line.includes("secret user label")), false);
  } finally {
    console.log = originalLog;
    if (original === undefined) delete process.env.DEBUG_SEMANTIC_ENRICHMENT_SCHEMA;
    else process.env.DEBUG_SEMANTIC_ENRICHMENT_SCHEMA = original;
  }
});

test("defines the strict semantic response contract without leaking configured values", async () => {
  const prompt = SCENARIO_DATA_SEMANTICS_INSTRUCTIONS;
  for (const key of ["status", "confidence", "semanticEvidence", "generationProfile", "valueKind", "sourceMode", "valueSetRef", "constraints", "format", "semanticHint"]) {
    assert.equal(prompt.includes(key), true, `prompt must define ${key}`);
  }
  for (const forbidden of ["decision", "result", "answer", "item", "type"]) {
    assert.equal(new RegExp(`[\\\"']${forbidden}[\\\"']\\s*:`).test(prompt), false, `prompt must not request legacy key ${forbidden}`);
  }
  for (const forbidden of ["semanticType", "generationMode", "poolRef", "dictionaryRef", "numeric", "phone"]) {
    assert.equal(new RegExp(`\\b${forbidden}\\b`).test(prompt), false, `prompt must not request legacy profile key ${forbidden}`);
  }
  for (const requiredText of ["Return ONLY the JSON object", "Do not return", "code fences", "configured_values", "valueSetRef"]) {
    assert.equal(prompt.includes(requiredText), true, `prompt must contain ${requiredText}`);
  }
  for (const unnecessary of ["SKILL.md", "roadmap", "full architecture"]) {
    assert.equal(prompt.includes(unnecessary), false);
  }

  let serialized = "";
  await enrichScenarioInputSemantics({
    requirement,
    scenarioContext: {},
    projectGenerationConfig: { valueSets: [{ ref: "safe", values: ["do-not-send"] }] } as any,
    provider: provider(validResponse, (request) => { serialized = JSON.stringify(request); }),
  });
  assert.equal(serialized.includes("do-not-send"), false);
});
