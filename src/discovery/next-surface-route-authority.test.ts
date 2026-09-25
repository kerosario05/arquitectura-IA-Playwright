import assert from "node:assert/strict";
import test from "node:test";
import { nextSurfaceRouteAuthority } from "./case-discovery";
import type { LearnedRouteAuthority } from "../db/recording-route-observation-repository";

/**
 * SAFETY FIRST_LOSS: `currentSurfaceRouteAuthority` was only ever installed, never invalidated --
 * an authority belonging to a PREVIOUS surface could remain in memory after a new route
 * transition that produced no learned authority of its own, letting a target resolver on the NEW
 * (unrelated) surface silently inherit authority that describes a different surface family.
 */

const authorityA: LearnedRouteAuthority = {
  origin: "https://app.test", search: "", hash: "", segmentCount: 4,
  staticSegments: new Map([[1, "requests"], [3, "edit"]]), dynamicIndices: new Set([2]),
};
const authorityC: LearnedRouteAuthority = {
  origin: "https://app.test", search: "", hash: "", segmentCount: 4,
  staticSegments: new Map([[1, "customers"], [3, "view"]]), dynamicIndices: new Set([2]),
};

test("1/newAuthorityInstalledOnCausalTransition. transition A derives authority -- current authority becomes A", () => {
  const result = nextSurfaceRouteAuthority(true, true, authorityA, null);
  assert.equal(result, authorityA);
});

test("2/sameSurfacePreserved. a same-surface action (no route change) leaves the current authority untouched", () => {
  const result = nextSurfaceRouteAuthority(false, false, null, authorityA);
  assert.equal(result, authorityA);
});

test("3/oldAuthorityClearedOnUnauthorizedTransition. a new causal transition B with no derivable authority clears the previous one -- never inherited", () => {
  const result = nextSurfaceRouteAuthority(true, false, null, authorityA);
  assert.equal(result, null);
});

test("3b/oldAuthorityClearedEvenWhenLineageEligibleButUndeductible. eligible lineage that still fails to derive (e.g. < 3 samples) also clears, never keeps the stale one", () => {
  const result = nextSurfaceRouteAuthority(true, true, null, authorityA);
  assert.equal(result, null);
});

test("4/newAuthorityInstalledReplacingOld. transition C derives its own authority -- replaces whatever was current, even if it was already null", () => {
  const clearedFirst = nextSurfaceRouteAuthority(true, false, null, authorityA);
  const installed = nextSurfaceRouteAuthority(true, true, authorityC, clearedFirst);
  assert.equal(installed, authorityC);
});

test("5/targetResolverAfterUnauthorizedTransitionGetsNull. simulated resolver read after transition B never receives authority A", () => {
  let current: LearnedRouteAuthority | null = authorityA;
  current = nextSurfaceRouteAuthority(true, false, null, current); // transition B, no authority
  const authorityPassedToResolver = current ?? undefined;
  assert.equal(authorityPassedToResolver, undefined);
});

test("6/targetResolverAfterOwnTransitionGetsC. simulated resolver read after transition C receives authority C, not A", () => {
  let current: LearnedRouteAuthority | null = authorityA;
  current = nextSurfaceRouteAuthority(true, false, null, current); // transition B, no authority
  current = nextSurfaceRouteAuthority(true, true, authorityC, current); // transition C, own authority
  const authorityPassedToResolver = current ?? undefined;
  assert.equal(authorityPassedToResolver, authorityC);
});
