import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePostActionSynchronization } from "./post-action-synchronization";

test("owner subtree mutation completes a terminal action with no other signal", () => {
  const result = resolvePostActionSynchronization({
    loadingSettled: true,
    routeChanged: false,
    nextTargetKnown: false,
    domMutation: false,
    structuredStateMutation: false,
    ownerSubtreeMutation: true,
  });
  assert.equal(result.completed, true);
  assert.equal(result.signal, "owner_subtree_mutation");
});

test("owner subtree mutation never fires while a known next target is unresolved", () => {
  const result = resolvePostActionSynchronization({
    loadingSettled: true,
    routeChanged: false,
    nextTargetKnown: true,
    nextTargetAvailable: false,
    domMutation: false,
    structuredStateMutation: false,
    ownerSubtreeMutation: true,
  });
  assert.equal(result.completed, false);
});

test("owner subtree mutation does not fire mid-navigation", () => {
  const result = resolvePostActionSynchronization({
    loadingSettled: true,
    routeChanged: true,
    nextTargetKnown: false,
    ownerSubtreeMutation: true,
  });
  assert.equal(result.completed, false);
});

test("owner subtree mutation is blocked by a required-but-unreached recorded surface", () => {
  const result = resolvePostActionSynchronization({
    loadingSettled: true,
    routeChanged: false,
    nextTargetKnown: false,
    ownerSubtreeMutation: true,
    recordedPostActionSurfaceRequired: true,
    recordedPostActionSurfaceReached: false,
  });
  assert.equal(result.completed, false);
});

test("existing dom_validation_mutation behavior is unaffected", () => {
  const result = resolvePostActionSynchronization({
    loadingSettled: true,
    routeChanged: false,
    nextTargetKnown: false,
    domMutation: true,
    ownerSubtreeMutation: false,
  });
  assert.equal(result.completed, true);
  assert.equal(result.signal, "dom_validation_mutation");
});
