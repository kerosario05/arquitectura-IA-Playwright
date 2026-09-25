import assert from "node:assert/strict";
import test from "node:test";
import { landmarkSelectorPrefix } from "./target-resolver";

/**
 * FIRST_LOSS: `resolveRecordedStructuralOwner` built its owner selector from ONLY the owner's
 * own tag/stable-attributes/descendants/semantic-shape -- with zero notion of ANCESTOR/CONTAINER
 * context. A sidebar link and a content-card link sharing the same accessible name and href are
 * structurally identical at the OWNER level, so `structuralIdentityMatchCount` (computed at
 * record time in `web-session-recorder.ts`) counted both as one identity, marking BOTH
 * `identityAmbiguous: true` -- even though each is individually a perfectly stable,
 * uniquely-locatable owner within its own landmark (nav vs main). `resolveRecordedStructuralOwner`
 * then bailed outright (`identityAmbiguous === true`), and the plain locator-match fallback in
 * `resolveRecordedTechnicalTarget` also found 2 matches for the same reason, producing
 * `recorded_target_not_present_or_unique` for a control that genuinely exists and is unique
 * within its own recorded landmark.
 *
 * Fixed by adding `landmarkAncestor` (the nearest nav/main/aside/header/footer or equivalent ARIA
 * landmark role, a fixed generic HTML5/ARIA set, never app-specific) to the structural identity
 * model (`structural-owner-identity.ts`) and to `RecordedTechnicalTarget.structuralContext`
 * (`session-trace.types.ts`), computed at record time in `web-session-recorder.ts`, and consumed
 * here by scoping the owner selector to it via `landmarkSelectorPrefix`. This never substitutes
 * accessibleName-only or href-only matching -- it only SCOPES the existing owner+attributes+
 * descendants+semanticShape selector so two individually-unique owners in different landmarks
 * stop colliding.
 *
 * `resolveRecordedStructuralOwner`'s full live-Page DOM resolution is not independently testable
 * here (no browser allowed, matching this session's established disclosure convention for
 * target-resolver.ts -- see `target-resolver.press-compatibility.test.ts`). What IS verified here
 * is the actual selector-construction logic this ticket fixes, extracted as its own pure
 * function.
 */

test("2/cardVsSidebar + 3/sidebarVsCard. a recorded landmark produces a scoping CSS prefix", () => {
  assert.equal(landmarkSelectorPrefix({ tag: "main" }), "main ");
  assert.equal(landmarkSelectorPrefix({ tag: "nav" }), "nav ");
});

test("1/exactOwner. no landmark ancestor recorded -> empty prefix, resolution behaves exactly as before", () => {
  assert.equal(landmarkSelectorPrefix(undefined), "");
});

test("15/multiproject. a landmark role is included in the scoping selector, for any generic landmark shape", () => {
  assert.equal(landmarkSelectorPrefix({ tag: "div", role: "navigation" }), 'div[role="navigation"] ');
});

test("9/wrongSurface guard: a malformed/unsafe tag never gets interpolated into the selector (fail closed, not injected)", () => {
  assert.equal(landmarkSelectorPrefix({ tag: "1invalid" }), "");
  assert.equal(landmarkSelectorPrefix({ tag: "" }), "");
});

test("14/noPosition: the prefix is a plain CSS descendant-combinator scope, never a positional/index selector", () => {
  const prefix = landmarkSelectorPrefix({ tag: "main" });
  assert.doesNotMatch(prefix, /nth|first|last|:eq\(/);
});
