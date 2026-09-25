import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveRecordedOptionAfterPreparatoryOwner, recordedOptionLikeCandidate } from "./target-resolver";

/**
 * FIRST_LOSS (jobId 2c08be81-c435-499d-8e38-288bc4b9baea): a recorded `role=option` action is not
 * present at the start of its step, and `resolveActionTarget`'s field-scoped fallback returns the
 * recorded associated-field OWNER locator as if it were the final option target. The owner opens
 * the dropdown but never selects the option, so the step falsely resolves on the owner while the
 * physical option remains unselected.
 *
 * Invariant enforced here: for an option-like action the field-scoped owner is a selection-surface
 * TRIGGER only. It may be clicked to PREPARE (open/reopen) the surface; the final resolved target
 * must be the exact recorded option, runtime-unique, or nothing at all (fail closed). These tests
 * drive the pure identity reader and the post-preparation resolver with fake Page/Locator objects
 * (no browser), and additionally assert the wiring in `resolveActionTarget` statically.
 */

function fakeOptionLocator(state: { count: number; visible: boolean; enabled: boolean; waitForResolves: boolean }) {
  return {
    count: async () => state.count,
    isVisible: async () => state.visible,
    isEnabled: async () => state.enabled,
    waitFor: async () => { if (!state.waitForResolves) throw new Error("visibility never observed"); },
  };
}

function fakeOwner(count: number, onClick?: () => void) {
  return {
    count: async () => count,
    click: async () => { onClick?.(); },
  };
}

test("1/directOptionPresent. the exact recorded option is already present: resolved directly, NO preparatory owner click", async () => {
  const state = { count: 1, visible: true, enabled: true, waitForResolves: true };
  let clicks = 0;
  const page = { getByRole: () => fakeOptionLocator(state) } as any;
  const owner = fakeOwner(1, () => { clicks += 1; });
  const result = await resolveRecordedOptionAfterPreparatoryOwner(page, owner as any, { role: "option", name: "Synthetic Option" });
  assert.equal(result?.status, "resolved");
  assert.equal(clicks, 0, "no preparatory owner click when the exact option is already available");
  assert.notEqual(result?.locator, owner as any);
});

test("2/preparatoryOwnerThenOption. option absent initially: owner click prepares the surface, the exact option becomes unique, and THAT option is returned", async () => {
  const state = { count: 0, visible: false, enabled: true, waitForResolves: true };
  let clicks = 0;
  let optionLocator: any;
  const page = {
    getByRole: () => {
      optionLocator = fakeOptionLocator(state);
      return optionLocator;
    },
  } as any;
  const owner = fakeOwner(1, () => { clicks += 1; state.count = 1; state.visible = true; });
  const result = await resolveRecordedOptionAfterPreparatoryOwner(page, owner as any, { role: "option", name: "Synthetic Option" });
  assert.equal(clicks, 1, "the owner is clicked exactly once as a preparatory action");
  assert.equal(result?.status, "resolved");
  assert.equal(result?.locatorStrategy, "recorded:role");
  assert.equal(result?.locator, optionLocator, "the returned locator is the OPTION, never the owner");
  assert.notEqual(result?.locator, owner as any);
  assert.equal(result?.candidateText, "Synthetic Option");
});

test("3/optionNeverAppearsRejected. owner prepared the surface but the exact option never becomes available: FAIL CLOSED, never the owner", async () => {
  const state = { count: 0, visible: false, enabled: true, waitForResolves: false };
  let clicks = 0;
  const page = { getByRole: () => fakeOptionLocator(state) } as any;
  const owner = fakeOwner(1, () => { clicks += 1; });
  const result = await resolveRecordedOptionAfterPreparatoryOwner(page, owner as any, { role: "option", name: "Synthetic Option" });
  assert.equal(clicks, 1);
  assert.equal(result, undefined, "the owner must never be returned as the final option target");
});

test("4/duplicateOptionRejected. two live exact options: FAIL CLOSED, no click, no nth/first", async () => {
  const state = { count: 2, visible: true, enabled: true, waitForResolves: true };
  let clicks = 0;
  const page = { getByRole: () => fakeOptionLocator(state) } as any;
  const owner = fakeOwner(1, () => { clicks += 1; });
  const result = await resolveRecordedOptionAfterPreparatoryOwner(page, owner as any, { role: "option", name: "Synthetic Option" });
  assert.equal(clicks, 0, "ambiguous duplicates are never resolved by clicking around");
  assert.equal(result, undefined);
});

test("5/ambiguousOwnerRejected. the owner is not unique: FAIL CLOSED before any click", async () => {
  const state = { count: 0, visible: false, enabled: true, waitForResolves: true };
  let clicks = 0;
  const page = { getByRole: () => fakeOptionLocator(state) } as any;
  const owner = fakeOwner(2, () => { clicks += 1; });
  const result = await resolveRecordedOptionAfterPreparatoryOwner(page, owner as any, { role: "option", name: "Synthetic Option" });
  assert.equal(clicks, 0);
  assert.equal(result, undefined);
});

test("6/recordedOptionLikeCandidate. only option-like role refs are recognized; ordinary clicks are not", () => {
  assert.deepEqual(recordedOptionLikeCandidate(["role:option|Synthetic Option"]), { role: "option", name: "Synthetic Option" });
  assert.deepEqual(recordedOptionLikeCandidate(["css:#x", "role:menuitem|Another"]), { role: "menuitem", name: "Another" });
  assert.equal(recordedOptionLikeCandidate(["role:button|Continue"]), undefined, "a plain button is not an option-like action");
  assert.equal(recordedOptionLikeCandidate(["css:#field"]), undefined);
  assert.equal(recordedOptionLikeCandidate([]), undefined);
  assert.deepEqual(
    recordedOptionLikeCandidate(undefined, [{ locatorCandidates: [{ strategy: "role", value: "option|Persisted" }] }]),
    { role: "option", name: "Persisted" },
  );
});

/**
 * Static wiring assertions: the public entry point must branch option-like targets away from the
 * owner-as-final-target return, and the ordinary (non-option) path must keep the legacy owner
 * certification unchanged.
 */
test("7/ownerNeverReturnedAsFinalOptionTargetWiring. resolveActionTarget guards option-like targets before the owner certification return", () => {
  const source = fs.readFileSync(path.join(__dirname, "target-resolver.ts"), "utf8");
  const start = source.indexOf("export async function resolveActionTarget(");
  assert.ok(start >= 0, "expected resolveActionTarget to be defined");
  const fn = source.slice(start, source.indexOf("\nasync function trySemanticFallback(", start));
  const guardIndex = fn.indexOf("recordedOptionLikeCandidate(");
  const ownerReturnIndex = fn.indexOf('matchReason: "field_scoped_structural_certification"');
  assert.ok(guardIndex >= 0, "resolveActionTarget must consult recordedOptionLikeCandidate");
  assert.ok(ownerReturnIndex >= 0, "the legacy owner certification return must still exist for non-option targets");
  assert.ok(guardIndex < ownerReturnIndex, "the option-like guard must run BEFORE the owner certification return");
  assert.match(fn, /resolveRecordedOptionAfterPreparatoryOwner\(page, fallback\.locator, option\)/);
  assert.match(fn, /if \(!optionResolution\) \{[\s\S]*?return result;[\s\S]*?\}/, "an unresolved option must fail closed (original not_found), never the owner");
});

test("8/nonOptionFieldScopeRegression. the non-option path still returns the field-scoped owner certification", () => {
  const source = fs.readFileSync(path.join(__dirname, "target-resolver.ts"), "utf8");
  const start = source.indexOf("export async function resolveActionTarget(");
  const fn = source.slice(start, source.indexOf("\nasync function trySemanticFallback(", start));
  assert.match(fn, /locator: fallback\.locator,\s*\n\s*locatorStrategy: fallback\.strategy,/, "ordinary clicks keep returning the field-scoped owner locator");
});

test("9/transientSelectionCausalityPathUnchanged. isTransientSelectionOptionCausallyBound is untouched by this change", async () => {
  const { isTransientSelectionOptionCausallyBound } = await import("./target-resolver");
  const page = {
    evaluate: async (_fn: unknown, arg?: unknown) => (arg === undefined
      ? { ids: ["panel-a"], activeTag: "button", activeAriaExpanded: true, activeHasControls: true, activeHasOwns: false, expandedOwnerCount: 1, expandedOwnersWithControls: 1, expandedOwnersWithOwns: 0 }
      : [{ key: "id:panel-a", xpath: "/x", type: "listbox", relatedId: "panel-a", visible: true, portalized: true, optionCandidates: [{ xpath: "o", text: "Synthetic Option", role: "option" }] }]),
  } as any;
  const result = await isTransientSelectionOptionCausallyBound(page, { strategy: "role", value: "option|Synthetic Option", confidence: 1 });
  assert.equal(result, true, "the ARIA owner-linked surface path must remain GREEN");
});

test("10/wrongSurfaceAndForeignOwnershipFailClosedWiring. resolveActionTarget only attempts the field-scoped option path for a genuinely-absent recorded target on the CURRENT correct surface", () => {
  const source = fs.readFileSync(path.join(__dirname, "target-resolver.ts"), "utf8");
  const start = source.indexOf("export async function resolveActionTarget(");
  const fn = source.slice(start, source.indexOf("\nasync function trySemanticFallback(", start));
  // Wrong expected surface / wrong application origin produce a different matchReason and must
  // early-return the core result -- never the owner, never a re-resolved option.
  assert.match(fn, /result\.matchReason === "recorded_target_not_present_or_unique_on_current_surface"/);
  assert.match(fn, /if \(recordedTargetWasSupplied && \(!recordedTargetGenuinelyAbsentOnCurrentSurface \|\| !opts\.associatedField\?\.trim\(\)\)\) \{\s*\n\s*return result;/);
});
