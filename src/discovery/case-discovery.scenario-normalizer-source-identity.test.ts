import assert from "node:assert/strict";
import test from "node:test";
import { parseScenarioStepsForDiscovery } from "./case-discovery";
import { deduplicateActionTargetsBySource } from "./action-target-equivalence";
import type { TestScenario } from "../types/testrail.types";

/**
 * FIRST_LOSS (jobId d136588c-4af9-48bc-a67d-3e42f082c83c): the scenario normalizer removed two
 * independent keypad presses ("2" twice, "5" twice) as `consecutive_equivalent_action`, because the
 * RecordingExecutionContract's structured source-interaction identity (`interactionId`) was never
 * transported onto the parsed action targets -- so dedup could only look at target/operation, which
 * are identical for two independent presses of the same key. The identity is now transported
 * (`ActionTargetItem.sourceInteractionId`) and dedup requires it.
 */

function recordingScenario(actions: Array<{ interactionId: string; stepIndex: number; targetRef: string; technicalTargetRef: string }>): TestScenario {
  return {
    source: "testrail",
    externalId: "SYN-REC",
    caseId: 0,
    title: "synthetic recording",
    steps: [],
    recordingExecutionContract: {
      actions: actions.map((action) => ({
        actionType: "click" as const,
        interactionId: action.interactionId,
        stepIndex: action.stepIndex,
        targetRef: action.targetRef,
        technicalTargetRef: action.technicalTargetRef,
        technicalTargetRefs: [action.technicalTargetRef],
      })),
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;
}

test("contract source interaction identity reaches the parsed action targets", () => {
  const scenario = recordingScenario([
    { interactionId: "interaction-1", stepIndex: 1, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
    { interactionId: "interaction-2", stepIndex: 2, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
  ]);
  const parsed = parseScenarioStepsForDiscovery(scenario);
  assert.deepEqual(parsed.actionTargets.map((action) => action.sourceInteractionId), ["interaction-1", "interaction-2"]);
});

test("two independent presses of the same key (different interactionId) survive normalization", () => {
  const scenario = recordingScenario([
    { interactionId: "interaction-1", stepIndex: 1, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
    { interactionId: "interaction-2", stepIndex: 2, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
  ]);
  const parsed = parseScenarioStepsForDiscovery(scenario);
  const deduped = deduplicateActionTargetsBySource(parsed.actionTargets);
  assert.equal(deduped.length, 2, "an independent repeated press is never lost by similarity");
  assert.deepEqual(deduped.map((action) => action.target), ["2", "2"]);
});

test("a true same-source projection among independent repeats is deduplicated, the rest preserved", () => {
  const scenario = recordingScenario([
    { interactionId: "interaction-1", stepIndex: 1, targetRef: "s|4|role|button|4", technicalTargetRef: "role:button|4" },
    { interactionId: "interaction-2", stepIndex: 2, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
    { interactionId: "interaction-2", stepIndex: 3, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
    { interactionId: "interaction-4", stepIndex: 4, targetRef: "s|5|role|button|5", technicalTargetRef: "role:button|5" },
  ]);
  const parsed = parseScenarioStepsForDiscovery(scenario);
  const deduped = deduplicateActionTargetsBySource(parsed.actionTargets);
  assert.deepEqual(deduped.map((action) => action.target), ["4", "2", "5"]);
  assert.deepEqual(deduped.map((action) => action.sourceInteractionId), ["interaction-1", "interaction-2", "interaction-4"]);
});

test("the full kiosko-shaped recording sequence keeps both 2s and both 5s", () => {
  const digits = ["4", "0", "2", "2", "4", "6", "7", "9", "5", "5", "1"];
  const scenario = recordingScenario(digits.map((digit, index) => ({
    interactionId: `interaction-${index + 1}`,
    stepIndex: index + 1,
    targetRef: `s|${digit}|role|button|${digit}`,
    technicalTargetRef: `role:button|${digit}`,
  })));
  const parsed = parseScenarioStepsForDiscovery(scenario);
  const deduped = deduplicateActionTargetsBySource(parsed.actionTargets);
  assert.deepEqual(deduped.map((action) => action.target), digits);
  assert.equal(deduped.length, 11);
});
