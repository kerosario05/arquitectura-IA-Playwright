import assert from "node:assert/strict";
import test from "node:test";
import type { AiCompletionRequest, AiProvider } from "../ai/ai-provider.types";
import type { CanonicalScenario } from "./canonical-scenario";
import { CanonicalSemanticNormalizer, buildCanonicalSemanticNormalizationPrompt } from "./canonical-semantic-normalizer";
import { summarizeCanonicalSemanticProposalShape, validateCanonicalSemanticNormalizationProposal } from "./canonical-semantic-proposal";

const scenario: CanonicalScenario = {
  canonicalSchemaVersion: "canonical-scenario-1",
  scenarioId: "scenario-1",
  sourceRef: { kind: "testrail", caseId: 1 },
  title: "Recover account",
  preconditions: ["Account exists"],
  steps: [{ order: 1, action: "Enter account", expected: "Account accepted", origin: { originRef: "step-1" } }],
  expectedResults: ["Recovery completes"],
  requirements: [],
  provenance: {
    sourceRef: { kind: "testrail", caseId: 1 },
    adapterOrGenerator: "test",
    canonicalizationMode: "deterministic_normalized",
    originRefs: ["case-1"],
    canonicalSchemaVersion: "canonical-scenario-1",
  },
};

function provider(output: unknown, calls: AiCompletionRequest[] = []): AiProvider {
  return {
    providerType: "fake",
    providerName: "fake",
    model: "fixture-model",
    async completeJson(request) {
      calls.push(request);
      return { rawText: JSON.stringify(output), model: "fixture-model", providerName: "fake", durationMs: 1 };
    },
  };
}

test("accepts valid, partial, and low-confidence proposals with one provider call", async () => {
  for (const output of [
    { status: "resolved", confidence: "high", requirements: [], branches: [], stepRequirementLinks: [], unresolved: [] },
    { status: "partial", confidence: "medium", requirements: [], branches: [], stepRequirementLinks: [], unresolved: [{ code: "unclear", message: "Needs review" }] },
    { status: "unresolved", confidence: "low", requirements: [], branches: [], stepRequirementLinks: [], unresolved: [{ code: "ambiguous", message: "Insufficient evidence" }] },
  ]) {
    const calls: AiCompletionRequest[] = [];
    const result = await new CanonicalSemanticNormalizer(provider(output, calls)).normalize(scenario);
    assert.equal(result.status, "accepted");
    assert.ok(result.proposal);
    assert.equal(calls.length, 1);
  }
});

test("rejects invalid provider JSON shape and provider failures without a second call", async () => {
  const invalid = await new CanonicalSemanticNormalizer(provider({ title: "mutated", status: "resolved", confidence: "high", requirements: [], branches: [], stepRequirementLinks: [], unresolved: [] })).normalize(scenario);
  assert.deepEqual(invalid, { status: "rejected", reason: "schema_validation_failed" });

  const failing: AiProvider = { ...provider({}), async completeJson() { throw new Error("provider down"); } };
  const result = await new CanonicalSemanticNormalizer(failing).normalize(scenario);
  assert.equal(result.status, "provider_error");
  assert.equal(result.reason, "provider down");
});

test("schema rejection currently exposes only the public reason", async () => {
  const invalid = {
    status: "resolved",
    confidence: "high",
    requirements: [{ proposalId: "p1" }],
    branches: [],
    stepRequirementLinks: [],
    unresolved: [],
  };
  const validation = validateCanonicalSemanticNormalizationProposal(invalid, { stepOrders: [1] });
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0].path, "requirements[0].kind");
  assert.equal(validation.errors[0].expected, "required requirement proposal field");
  assert.equal(validation.errors[0].receivedType, "undefined");
  const result = await new CanonicalSemanticNormalizer(provider(invalid)).normalize(scenario);
  assert.deepEqual(result, { status: "rejected", reason: "schema_validation_failed" });
});

test("summarizes shape safely and logs diagnostics only when debug is enabled", async () => {
  const invalid = { status: "resolved", confidence: "high", requirements: [{ proposalId: "p1", description: "secret action" }], branches: [], stepRequirementLinks: [], unresolved: [] };
  const summary = summarizeCanonicalSemanticProposalShape(invalid);
  assert.deepEqual(summary.requirementItemKeys, ["description", "proposalId"]);
  assert.equal("description" in summary, false);
  assert.equal(JSON.stringify(summary).includes("secret action"), false);
  const logs: string[] = [];
  const originalLog = console.log;
  const previous = process.env.DEBUG_CANONICAL_SEMANTIC_SCHEMA;
  try {
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    delete process.env.DEBUG_CANONICAL_SEMANTIC_SCHEMA;
    await new CanonicalSemanticNormalizer(provider(invalid)).normalize(scenario);
    assert.equal(logs.length, 0);
    process.env.DEBUG_CANONICAL_SEMANTIC_SCHEMA = "true";
    await new CanonicalSemanticNormalizer(provider(invalid)).normalize(scenario);
  } finally {
    console.log = originalLog;
    if (previous === undefined) delete process.env.DEBUG_CANONICAL_SEMANTIC_SCHEMA;
    else process.env.DEBUG_CANONICAL_SEMANTIC_SCHEMA = previous;
  }
  assert.equal(logs.some((line) => line.includes("[canonical-semantic:schema-rejected]")), true);
  assert.equal(logs.some((line) => line.includes("secret action")), false);
});

test("sends only compact functional context and the dedicated purpose", () => {
  const prompt = buildCanonicalSemanticNormalizationPrompt(scenario);
  const parsed = JSON.parse(prompt.userContext);
  assert.deepEqual(Object.keys(parsed).sort(), ["expectedResults", "preconditions", "steps", "title"]);
  assert.equal(prompt.purpose, "canonical_scenario_semantic_normalization");
  assert.equal(prompt.system.includes("Return ONLY JSON"), true);
  assert.equal(prompt.system.includes("inputRequirements"), true);
  assert.equal(prompt.system.includes("repair-decision.schema.json"), false);
  assert.equal(prompt.userContext.includes("sourceRef"), false);
  assert.equal(prompt.userContext.includes("ProjectGenerationConfig"), false);
  assert.equal(prompt.userContext.includes("executionReadiness"), false);
});

test("documents the exact canonical semantic proposal contract", () => {
  const prompt = buildCanonicalSemanticNormalizationPrompt(scenario);
  for (const field of ["proposalId", "kind", "description", "origin", "branchProposalId", "requirementProposalRefs", "stepOrder"]) {
    assert.equal(prompt.system.includes(field), true, `missing ${field}`);
  }
  assert.equal(prompt.system.includes("Do not use alternate field names."), true);
  const example = prompt.system.match(/```json\n([\s\S]*?)\n```/)?.[1];
  assert.equal(typeof example, "string");
  assert.equal(example?.includes("requirementIndexes"), false);
  assert.equal(example?.includes("text"), false);
  assert.equal(example?.includes("sourceSteps"), false);
  assert.equal(example?.includes("condition"), false);
  assert.equal(example?.includes("outcome"), false);
  const validation = validateCanonicalSemanticNormalizationProposal(JSON.parse(example ?? "{}"), { stepOrders: [1, 2] });
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
});
