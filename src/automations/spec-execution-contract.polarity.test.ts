import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";

function buildContract(oracles: Array<{ stepIndex: number; polarity?: "positive" | "negative" }>) {
  return buildSpecExecutionContract(
    { scenario: { title: "fixture" }, steps: [] } as any,
    {
      steps: oracles.map((oracle) => ({
        index: oracle.stepIndex,
        action: "assert state",
        expected: "fixture expectation",
      })),
      observableOracles: oracles.map((oracle) => ({
        id: `oracle-${oracle.stepIndex}`,
        requirement: "fixture expectation",
        type: "navigation_transition",
        backed: true,
        source: "discovery" as const,
        stepIndex: oracle.stepIndex,
        polarity: oracle.polarity,
        evidence: [],
      })),
    },
  );
}

test("negative and positive oracle polarity reach their matching contract steps", () => {
  const contract = buildContract([
    { stepIndex: 1, polarity: "negative" },
    { stepIndex: 2, polarity: "positive" },
  ]);
  assert.equal(contract.steps[0]?.oracle?.polarity, "negative");
  assert.equal(contract.steps[1]?.oracle?.polarity, "positive");
});

test("undefined oracle polarity remains undefined", () => {
  const contract = buildContract([{ stepIndex: 1 }]);
  assert.equal(contract.steps[0]?.oracle?.polarity, undefined);
});
