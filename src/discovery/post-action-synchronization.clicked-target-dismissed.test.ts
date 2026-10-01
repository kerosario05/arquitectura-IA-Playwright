import assert from "node:assert/strict";
import test from "node:test";
import { resolvePostActionSynchronization } from "./post-action-synchronization";

/**
 * Recording e52ee42c (runs e2ff972d, f2a0732d): the last action of every sub-flow, "Cancelar",
 * closed the "Solicita tu Producto" modal. No navigation, no network, no tracked mutation, no next
 * action: no completion signal fired, the step stalled into loading_timeout and the pending outcome
 * assertion was never evaluated -- with the app showing exactly the recorded state. The clicked
 * control vanishing on the same route is the click's own causal evidence.
 */

const SETTLED_SAME_ROUTE = { loadingSettled: true, routeChanged: false } as const;

test("closing a modal with its own button completes the last action", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({ ...SETTLED_SAME_ROUTE, clickedTargetDismissed: true }),
    { completed: true, signal: "clicked_target_dismissed" },
  );
});

test("a click that left its control on screen has no such evidence (the old stall is unchanged)", () => {
  assert.deepEqual(resolvePostActionSynchronization({ ...SETTLED_SAME_ROUTE, clickedTargetDismissed: false }), { completed: false });
});

test("never while loading or after a route change", () => {
  assert.deepEqual(resolvePostActionSynchronization({ clickedTargetDismissed: true, loadingSettled: false, routeChanged: false }), { completed: false });
  assert.notEqual(
    resolvePostActionSynchronization({ clickedTargetDismissed: true, loadingSettled: true, routeChanged: true }).signal,
    "clicked_target_dismissed",
  );
});

test("mid-flow, a known next target must already be visible", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({ ...SETTLED_SAME_ROUTE, clickedTargetDismissed: true, nextTargetKnown: true, nextTargetAvailable: false }),
    { completed: false },
  );
  assert.equal(
    resolvePostActionSynchronization({ ...SETTLED_SAME_ROUTE, clickedTargetDismissed: true, nextTargetKnown: true, nextTargetAvailable: true }).signal,
    "clicked_target_dismissed",
  );
});

test("a next structured owner that is known and not resolvable still blocks it", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({ ...SETTLED_SAME_ROUTE, clickedTargetDismissed: true, nextTargetRequiresRuntimeResolution: true, nextTargetReady: false }),
    { completed: false },
  );
});

test("an unmet recorded post-action surface still wins", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({ ...SETTLED_SAME_ROUTE, clickedTargetDismissed: true, recordedPostActionSurfaceRequired: true, recordedPostActionSurfaceReached: false }),
    { completed: false },
  );
});
