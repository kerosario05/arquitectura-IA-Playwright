import assert from "node:assert/strict";
import test from "node:test";
import { shouldRejectEmptyScenarioOverwrite } from "./recordings";

/**
 * FIRST_LOSS audit for "recording has trace + semantic but scenarios=[]": tracing
 * derive -> saveScenarios -> loadScenarios -> GET/execute showed the write/read identity
 * (appSlug, recordingId) is consistent everywhere (`recordingDir()` is the single shared key
 * builder in recording-store.ts), and `deriveScenarios` calls `saveScenarios` synchronously
 * BEFORE its own `return` (no async ordering gap). CASE A ("never derived", or `stopRecording`'s
 * own observed-primary materialization legitimately produced nothing) is therefore the default,
 * correct explanation for scenarios=[] alongside an existing trace/semantic.
 *
 * One genuine (if previously unreachable from the current QA Lab frontend) CASE B risk was
 * found by code audit: `PUT /:recordingId/scenarios` accepted and persisted ANY client-supplied
 * `scenarios` array verbatim, including an empty one, unconditionally overwriting
 * (`saveScenarios` is a full-file write) whatever `derive()` had already persisted. Hardened so
 * an empty payload is rejected whenever the store currently holds real persisted scenarios --
 * "not derived yet" and "explicitly cleared" must stay distinguishable, and this endpoint's own
 * purpose ("persists reviewer edits") never legitimately needs to reduce the catalog to zero.
 */

test("1/stopOnly (CASE A). an empty payload against an ALREADY-EMPTY store (never derived) is not rejected -- there is nothing to protect", () => {
  assert.equal(shouldRejectEmptyScenarioOverwrite(0, 0), false);
});

test("2/deriveSave persisted, then an empty overwrite attempt is rejected", () => {
  assert.equal(shouldRejectEmptyScenarioOverwrite(0, 4), true);
});

test("a non-empty overwrite (real reviewer edit) is never rejected regardless of current count", () => {
  assert.equal(shouldRejectEmptyScenarioOverwrite(4, 4), false);
  assert.equal(shouldRejectEmptyScenarioOverwrite(1, 4), false);
  assert.equal(shouldRejectEmptyScenarioOverwrite(4, 0), false);
});

test("10/generic. pure boolean logic -- no recordingId/appSlug/project hardcode in the decision", () => {
  for (const incomingCount of [0, 1, 5]) {
    for (const currentlyPersistedCount of [0, 1, 5]) {
      assert.equal(
        shouldRejectEmptyScenarioOverwrite(incomingCount, currentlyPersistedCount),
        incomingCount === 0 && currentlyPersistedCount > 0,
      );
    }
  }
});
