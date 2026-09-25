import assert from "node:assert/strict";
import test from "node:test";
import { resolveReplayAdmission } from "./replay-admission";
import type { ReplayAdmissionRejection } from "../../types/scenario-preview.types";

const requested = ["Primary", "Repeat", "Zero", "Alternative"];
const rejection = (scenarioId: string): ReplayAdmissionRejection => ({ scenarioId, reasons: ["MUTATION_NO_EFFECT"] });

test("admission excludes an unrelated generation rejection", () => {
  const result = resolveReplayAdmission({
    requestedScenarioIds: requested,
    evaluatedScenarioIds: requested,
    eligibleScenarioIds: requested,
    admittedScenarioIds: requested,
    evaluatedRejectedScenarios: [],
    nonRequestedRejectedCandidates: [rejection("FIELD_OMISSION")],
  });

  assert.equal(result.requestedCount, 4);
  assert.equal(result.eligibleCount, 4);
  assert.equal(result.acceptedCount, 4);
  assert.equal(result.requestedRejectedCount, 0);
  assert.deepEqual(result.requestedRejectedScenarioIds, []);
  assert.deepEqual(result.nonRequestedRejectedCandidates.map(({ scenarioId }) => scenarioId), ["FIELD_OMISSION"]);
});

test("admission reports only the requested scenario that is not admitted", () => {
  const result = resolveReplayAdmission({
    requestedScenarioIds: requested,
    evaluatedScenarioIds: requested,
    eligibleScenarioIds: requested.slice(0, 3),
    admittedScenarioIds: requested.slice(0, 3),
    evaluatedRejectedScenarios: [rejection("Alternative")],
    nonRequestedRejectedCandidates: [rejection("FIELD_OMISSION")],
  });

  assert.equal(result.acceptedCount, 3);
  assert.deepEqual(result.requestedRejectedScenarioIds, ["Alternative"]);
  assert.deepEqual(result.nonRequestedRejectedCandidates.map(({ scenarioId }) => scenarioId), ["FIELD_OMISSION"]);
});

test("an invalid non-requested generated scenario does not change execution counts", () => {
  const result = resolveReplayAdmission({
    requestedScenarioIds: requested,
    evaluatedScenarioIds: requested,
    eligibleScenarioIds: requested,
    admittedScenarioIds: requested,
    evaluatedRejectedScenarios: [],
    nonRequestedRejectedCandidates: [rejection("GeneratedInvalid")],
  });

  assert.deepEqual(
    {
      requestedCount: result.requestedCount,
      eligibleCount: result.eligibleCount,
      acceptedCount: result.acceptedCount,
      requestedRejectedCount: result.requestedRejectedCount,
      requestedRejectedScenarioIds: result.requestedRejectedScenarioIds,
    },
    {
      requestedCount: 4,
      eligibleCount: 4,
      acceptedCount: 4,
      requestedRejectedCount: 0,
      requestedRejectedScenarioIds: [],
    },
  );
});

test("a requested scenario must be evaluated before it can be a replay rejection", () => {
  const result = resolveReplayAdmission({
    requestedScenarioIds: requested,
    evaluatedScenarioIds: requested.slice(0, 3),
    eligibleScenarioIds: requested.slice(0, 3),
    admittedScenarioIds: requested.slice(0, 3),
    evaluatedRejectedScenarios: [rejection("Alternative")],
  });

  assert.equal(result.acceptedCount, 3);
  assert.equal(result.requestedRejectedCount, 0);
  assert.deepEqual(result.requestedRejectedScenarioIds, []);
  assert.deepEqual(result.nonRequestedRejectedCandidates, []);
});
