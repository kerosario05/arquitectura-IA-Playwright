import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  hasRecordedSuccessorSurfaceProof,
  resolvePostActionSynchronization,
} from "./post-action-synchronization";

const proof = {
  recordedPostActionSurfaceRequired: true,
  recordedPostActionSurfaceReached: false,
  successorRouteMatchesNextAction: true,
  currentUrlStillOnRecordedPreActionSurface: true,
  sameRecordedPage: true,
  successorOwnerWasTextVisibleBefore: false,
  successorOwnerReadyNow: true,
  actionEffectObserved: true,
  actionSettled: true,
  applicationError: false,
  stableSuccessorProbes: 8,
  requiredStableProbes: 8,
};

test("recorded successor owner can prove a same-page SPA transition without a URL change", () => {
  assert.equal(hasRecordedSuccessorSurfaceProof(proof), true);
  assert.deepEqual(resolvePostActionSynchronization({
    recordedPostActionSurfaceRequired: true,
    recordedPostActionSurfaceReached: false,
    recordedPostActionSuccessorConfirmed: true,
    actionNetworkObserved: true,
    actionNetworkResponse: true,
    loadingSettled: true,
  }), { completed: true, signal: "recorded_successor_owner" });
});

test("an unmet recorded route remains blocking without the complete successor-owner proof", () => {
  for (const incomplete of [
    { ...proof, successorRouteMatchesNextAction: false },
    { ...proof, currentUrlStillOnRecordedPreActionSurface: false },
    { ...proof, sameRecordedPage: false },
    { ...proof, successorOwnerWasTextVisibleBefore: true },
    { ...proof, successorOwnerReadyNow: false },
    { ...proof, actionEffectObserved: false },
    { ...proof, actionSettled: false },
    { ...proof, applicationError: true },
    { ...proof, stableSuccessorProbes: 7 },
  ]) {
    assert.equal(hasRecordedSuccessorSurfaceProof(incomplete), false);
  }
  assert.deepEqual(resolvePostActionSynchronization({
    recordedPostActionSurfaceRequired: true,
    recordedPostActionSurfaceReached: false,
    recordedPostActionSuccessorConfirmed: false,
    actionNetworkObserved: true,
    actionNetworkResponse: true,
    domMutation: true,
    loadingSettled: true,
  }), { completed: false });
});

test("successor proof is app-agnostic and requires a stable owner, not a route spelling", () => {
  for (const routePair of [
    { recorded: "https://app-a.test/work/583/edit", next: "https://app-a.test/work/999/edit" },
    { recorded: "https://app-b.test/forms/submit", next: "https://app-b.test/forms/submit" },
  ]) {
    // Route compatibility is established by the shared route matcher upstream; the proof helper
    // receives only that result and is intentionally independent of project names and URL paths.
    assert.equal(hasRecordedSuccessorSurfaceProof({
      ...proof,
      successorRouteMatchesNextAction: routePair.recorded.length > 0 && routePair.next.length > 0,
    }), true);
  }
  assert.equal(hasRecordedSuccessorSurfaceProof({ ...proof, requiredStableProbes: 0 }), false);
});

test("case discovery wires recorded successor proof only after same-page action evidence", () => {
  const source = readFileSync("src/discovery/case-discovery.ts", "utf8");
  assert.match(source, /import[^\n]*hasRecordedSuccessorSurfaceProof/);
  assert.match(source, /const recordedSuccessorProbeEligible = actionTarget\.recordingActionType === "click"/);
  assert.match(source, /&& sameRecordedPage\s*&& successorRouteMatchesNextAction/);
  assert.match(source, /&& actionEffectObserved\s*&& actionSettled\s*&& !applicationErrorVisible/);
  assert.match(source, /recordedPostActionSuccessorConfirmed,/);
});

test("case discovery passes the still-missing successor state into synchronization for same-surface clicks", () => {
  const source = readFileSync("src/discovery/case-discovery.ts", "utf8");
  const start = source.indexOf("const synchronization = resolvePostActionSynchronization({");
  assert.ok(start >= 0, "expected the shared post-action synchronization call");
  const end = source.indexOf("});", start);
  assert.ok(end > start, "expected the shared synchronization input to close");
  const input = source.slice(start, end);
  assert.match(input, /nextTargetKnown,/);
  assert.match(input, /nextTargetAvailable:\s*nextTargetVisible/);
  assert.match(input, /recordedSameSurfaceAction,/);
});
