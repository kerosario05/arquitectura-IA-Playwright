import assert from "node:assert/strict";
import test from "node:test";
import { buildPromotedOracleImplementations, materializePromotedOracleDescriptors } from "./spec-generation-hybrid";

const oracle = (polarity: "positive" | "negative" | undefined, stepIndex: number, id: string) => ({
  id,
  requirement: "sanitized requirement",
  type: "navigation_transition" as const,
  backed: true,
  source: "scenario" as const,
  stepIndex,
  polarity,
  target: "dashboard",
  evidence: [],
  details: { expectedUrl: "/dashboard" },
});

test("preserves negative polarity on the promoted implementation", () => {
  const [implementation] = buildPromotedOracleImplementations([oracle("negative", 7, "negative")], null);
  assert.equal(implementation.polarity, "negative");
  assert.equal(implementation.expectedUrlPattern, "/dashboard");
  assert.equal(implementation.scenarioStepIndex, 7);
});

test("preserves positive polarity independently on another step", () => {
  const implementations = buildPromotedOracleImplementations([
    oracle("negative", 7, "negative"),
    oracle("positive", 8, "positive"),
  ], null);
  assert.equal(implementations[1].polarity, "positive");
  assert.equal(implementations[1].scenarioStepIndex, 8);
  assert.equal(implementations[0].polarity, "negative");
});

test("fails closed when a URL oracle has unresolved polarity", () => {
  assert.throws(
    () => buildPromotedOracleImplementations([oracle(undefined, 7, "unresolved")], null),
    /PROMOTED_ORACLE_POLARITY_UNRESOLVED/
  );
});

test("does not require polarity for an unrelated runtime oracle", () => {
  const [implementation] = buildPromotedOracleImplementations([{
    id: "runtime",
    requirement: "sanitized requirement",
    type: "runtime_state",
    backed: true,
    source: "scenario",
    stepIndex: 8,
    evidence: [],
  }], null);
  assert.equal(implementation.polarity, undefined);
});

test("materializes isolated polarity and expected URL into generated assertion calls", () => {
  const implementations = buildPromotedOracleImplementations([
    oracle("negative", 7, "negative"),
    oracle("positive", 8, "positive"),
  ], null);
  const source = [
    "await promotedRuntime.expectPromotedVisible({ stepIndex: 7, target: 'A', assertion: async () => {} });",
    "await promotedRuntime.expectPromotedVisible({ stepIndex: 8, target: 'B', assertion: async () => {} });",
  ].join("\n");
  const result = materializePromotedOracleDescriptors(source, implementations);
  assert.match(result, /stepIndex: 7[\s\S]*polarity: "negative"[\s\S]*expectedUrl: "\/dashboard"/);
  assert.match(result, /stepIndex: 8[\s\S]*polarity: "positive"[\s\S]*expectedUrl: "\/dashboard"/);
});

test("does not materialize an unresolved URL oracle", () => {
  const implementation = {
    ...buildPromotedOracleImplementations([oracle("negative", 7, "negative")], null)[0],
    polarity: undefined,
  };
  assert.throws(
    () => materializePromotedOracleDescriptors("await promotedRuntime.expectPromotedVisible({ stepIndex: 7, assertion: async () => {} });", [implementation]),
    /PROMOTED_ORACLE_POLARITY_UNRESOLVED/
  );
});
