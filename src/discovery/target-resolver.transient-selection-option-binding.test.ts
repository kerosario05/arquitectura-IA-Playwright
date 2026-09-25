import assert from "node:assert/strict";
import test from "node:test";
import { isTransientSelectionOptionCausallyBound } from "./target-resolver";

/**
 * FIRST_LOSS (jobId e3132a41-a5d9-4a20-9199-d9c948f16394): a dropdown owner resolves and clicks
 * fine, its `role=option` next target resolves to exactly one live, visible, enabled match -- and
 * is still rejected as `recorded_target_structural_incompatibility`, because
 * `structuralCompatibility` for a non-press action was `Boolean(technicalTarget?.structuralContext
 * || technicalTarget?.stableAttributes)`: purely a check of whether RECORDING happened to attach
 * that metadata. A transient overlay option -- rendered only once its owning listbox opens -- can
 * never carry a meaningful recorded structural context, so this always rejected it.
 *
 * `isTransientSelectionOptionCausallyBound` closes that gap by reusing `inspectSelectionSurfaces`
 * (the SAME scan the dedicated selection-field path already uses) fed with REAL ARIA ownership
 * evidence -- `aria-controls`/`aria-owns` off `document.activeElement`/`[aria-expanded="true"]`,
 * the same relationship `getSelectionTriggerRelationship` already reads off an explicit trigger
 * Locator elsewhere in this file, just sourced with no owner parameter needed. A surface only
 * counts when `inspectSelectionSurfaces` itself marks it `relatedId`-linked to that evidence --
 * "the only visible surface" is explicitly NOT accepted as a substitute for that link (see test 2).
 *
 * These tests stub `page.evaluate` (called twice: once for the owner's aria-controls/owns ids,
 * once inside `inspectSelectionSurfaces`) rather than driving a browser.
 */

type Surface = {
  key: string;
  xpath: string;
  type: string;
  role?: string;
  relatedId?: string;
  visible: boolean;
  portalized: boolean;
  ariaControls?: string;
  ariaOwns?: string;
  optionCandidates: Array<{ xpath: string; text: string; value?: string; role?: string; marker?: string }>;
};

function fakePage(ownerRelatedIds: string[], surfaces: Surface[]) {
  const ownerRelationship = {
    ids: ownerRelatedIds,
    activeTag: ownerRelatedIds.length > 0 ? "button" : undefined,
    activeRole: undefined,
    activeAriaExpanded: ownerRelatedIds.length > 0,
    activeHasControls: ownerRelatedIds.length > 0,
    activeHasOwns: false,
    expandedOwnerCount: ownerRelatedIds.length > 0 ? 1 : 0,
    expandedOwnersWithControls: ownerRelatedIds.length > 0 ? 1 : 0,
    expandedOwnersWithOwns: 0,
  };
  return {
    // getActiveSelectionOwnerRelationship calls evaluate(fn) -- one arg, arg undefined here.
    // inspectSelectionSurfaces calls evaluate(fn, relatedIds) -- two args.
    evaluate: async (_fn: unknown, arg?: unknown) => (arg === undefined ? ownerRelationship : surfaces),
  } as any;
}

function optionCandidate(role: string, name: string) {
  return { strategy: "role", value: `${role}|${name}`, confidence: 1 };
}

function surface(relatedId: string | undefined, visible: boolean, options: Surface["optionCandidates"]): Surface {
  return {
    key: relatedId ? `id:${relatedId}` : "/html/body/div[1]",
    xpath: "/html/body/div[1]",
    type: "listbox",
    role: "listbox",
    relatedId,
    visible,
    portalized: true,
    optionCandidates: options,
  };
}

const MATCH = { xpath: "x", text: "Cuentas de Efectivo", role: "option" };

test("1/ownerLinkedSurfaceExactOption. owner A's own aria-controls/owns links to surface A, which has exactly the recorded option: PASS", async () => {
  const page = fakePage(["panel-a"], [surface("panel-a", true, [MATCH])]);
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"));
  assert.equal(result, true);
});

test("2/soleVisibleButUnlinked. only one surface is visible on the whole page, and it has the exact option -- but it carries NO relatedId to owner A: FAIL (sole-visible is never accepted as causal proof)", async () => {
  const page = fakePage(["panel-a"], [surface(undefined, true, [MATCH])]);
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"));
  assert.equal(result, false, "an unlinked surface must never pass merely for being the only one visible");
});

test("3/ownerLinkedToTwoSurfaces. owner A's aria-controls/owns resolves to two distinct linked surfaces: FAIL CLOSED", async () => {
  const page = fakePage(
    ["panel-a", "panel-b"],
    [surface("panel-a", true, [MATCH]), surface("panel-b", true, [])],
  );
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"));
  assert.equal(result, false, "ambiguous which of two owner-linked surfaces is the real one -- never guessed");
});

test("4/linkedSurfaceTwoExactOptions. exactly one owner-linked surface, but it reports the exact option twice: FAIL CLOSED, never nth/first", async () => {
  const page = fakePage(["panel-a"], [surface("panel-a", true, [MATCH, { ...MATCH, xpath: "x2" }])]);
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"));
  assert.equal(result, false);
});

test("5/exactOptionOnlyInUnrelatedSurface. the recorded option exists only inside a surface with no owner linkage: FAIL", async () => {
  const page = fakePage(
    ["panel-a"],
    [surface("panel-a", true, []), surface(undefined, true, [MATCH])],
  );
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"));
  assert.equal(result, false, "the owner-linked surface has no matching option -- an unrelated surface having it is irrelevant");
});

test("6/hiddenStaleUnrelatedSurfaceDoesNotCompete. a hidden, unrelated surface with the same option never interferes with the real owner-linked resolution", async () => {
  const page = fakePage(
    ["panel-a"],
    [surface("panel-a", true, [MATCH]), surface(undefined, false, [MATCH])],
  );
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"));
  assert.equal(result, true);
});

test("7/noOwnerRelationshipEvidence. the page reports no active/expanded owner with aria-controls or aria-owns at all: FAIL, never falls back to sole-visible-surface", async () => {
  const page = fakePage([], [surface("panel-a", true, [MATCH])]);
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"));
  assert.equal(result, false, "0 owner-associated surfaces means no causal evidence at all -- fails closed, not a sole-visible-surface fallback");
});

test("8/nonOptionRoleNeverEligible. a non-option-shaped recorded role (e.g. button) is never routed through this mechanism at all", async () => {
  const page = fakePage(["panel-a"], [surface("panel-a", true, [{ xpath: "x", text: "Guardar", role: "button" }])]);
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("button", "Guardar"));
  assert.equal(result, false, "this fallback only ever applies to option-like ARIA roles, never a generic button");
});

/**
 * DIAGNOSE-only instrumentation (jobId 39033690-04d0-41db-aa69-fe6c6eda210f): a single compact,
 * secret-free `[transient-selection-causality]` line per attempt, logged right before the SAME
 * `return` every branch already had (no branch condition changed). This test captures
 * `console.log` to prove the line carries the required counts/booleans/reason code and NEVER the
 * option's own accessible name/text, while the returned boolean itself stays exactly what test 1
 * already asserts (`instrumentationAdded=true`, `behaviorChanged=false`).
 */
test("9/instrumentationLineShapeNoBusinessText. the diagnostic line reports counts/booleans/reason only, never the option's own text", async () => {
  const page = fakePage(["panel-a"], [surface("panel-a", true, [MATCH])]);
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  let result: boolean;
  try {
    result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"));
  } finally {
    console.log = originalLog;
  }
  assert.equal(result, true, "behaviorChanged=false -- identical outcome to test 1 with the same fixture");
  const line = lines.find((entry) => entry.startsWith("[transient-selection-causality]"));
  assert.ok(line, "expected exactly one [transient-selection-causality] diagnostic line");
  for (const field of [
    "candidateRole=", "candidateNamePresent=", "activeTag=", "activeRole=", "activeAriaExpanded=",
    "activeAriaControlsPresent=", "activeAriaOwnsPresent=", "expandedOwnerCount=", "expandedOwnersWithControls=",
    "expandedOwnersWithOwns=", "ownerRelatedIdsCount=", "ownerSource=", "surfaceCount=", "visibleSurfaceCount=",
    "relatedSurfaceCount=", "exactOptionGlobalCount=", "exactOptionInsideRelatedSurfaceCount=", "causalBound=", "reason=",
  ]) {
    assert.ok(line!.includes(field), `expected diagnostic line to include ${field}`);
  }
  assert.ok(!line!.includes("Cuentas de Efectivo"), "the option's own accessible name/text must never be logged");
});

/**
 * FIRST_LOSS (jobId 740e6e4d-dd38-4081-9d9c-e79e5e7d14ce): this specific dropdown component sets
 * neither `aria-expanded` nor `aria-controls`/`aria-owns` on anything, so the ARIA path above
 * always returns `owner_related_ids_empty` even though the option resolves to exactly one live,
 * visible, enabled match. `associatedField` -- the SAME recorded field/owner lineage hint
 * `resolveActionTarget` already threads through for the owner's own click resolution -- lets the
 * option re-resolve its owner via the CORE field-scope resolver (`tryFieldScopedStructuralFallback`)
 * and read ITS aria-controls/owns, only when ARIA gave nothing on its own. These tests drive that
 * full path with a minimal fake Page/Locator (no browser).
 */

function fakeOwnerLocator(lineageIds: string[], count = 1) {
  return {
    count: async () => count,
    isVisible: async () => count === 1,
    isEnabled: async () => true,
    evaluate: async () => ({ controls: lineageIds, owns: [] }),
  };
}

function fakeNotFoundLocator() {
  return { count: async () => 0, isVisible: async () => false, isEnabled: async () => true };
}

/**
 * `ownerFieldEvidence: "unique" | "none"` drives `tryFieldScopedStructuralFallback`'s OWN,
 * already-tested field-scope resolution: "unique" gives the owner candidate a real stable
 * attribute (Tier 1, certifies and reconfirms immediately); "none" gives no compatible candidate
 * at all, so the CORE resolver itself fails closed (`field_owner_not_materializable`) -- no
 * duplicate ambiguity logic is written here, only the existing resolver's own outcome is relied on.
 */
function fakeLineagePage(ownerFieldEvidence: "unique" | "none", lineageIds: string[], surfaces: Surface[]) {
  let oneArgCallCount = 0;
  const ownerLocator = fakeOwnerLocator(lineageIds);
  return {
    locator: () => ownerLocator,
    getByRole: () => fakeNotFoundLocator(),
    getByTestId: () => fakeNotFoundLocator(),
    url: () => "https://example.test/requests/1/edit",
    evaluate: async (_fn: unknown, arg?: unknown) => {
      if (arg !== undefined) return surfaces; // inspectSelectionSurfaces(page, ids)
      oneArgCallCount += 1;
      if (oneArgCallCount === 1) {
        // getActiveSelectionOwnerRelationship: no ARIA evidence at all on this component.
        return {
          ids: [], activeHasControls: false, activeHasOwns: false,
          expandedOwnerCount: 0, expandedOwnersWithControls: 0, expandedOwnersWithOwns: 0,
        };
      }
      // tryFieldScopedStructuralFallback's own FieldScopedDomEvidence evaluate call.
      return ownerFieldEvidence === "unique"
        ? {
            candidates: [{ tag: "button", role: "button", actionable: true, visible: true, disabled: false, stableDirectAttributes: { id: "owner-trigger" } }],
            diagnostics: {
              textAnchorMatchCount: 1, semanticLabelMatchCount: 1, ariaRelationMatchCount: 0, leafAnchorMatchCount: 1,
              anchorFound: true, anchorTag: "label", ancestorsInspected: 0, ancestorTrace: [], containerAccepted: true,
            },
          }
        : {
            candidates: [],
            diagnostics: {
              textAnchorMatchCount: 0, semanticLabelMatchCount: 0, ariaRelationMatchCount: 0, leafAnchorMatchCount: 0,
              anchorFound: false, ancestorsInspected: 0, ancestorTrace: [], containerAccepted: false,
            },
          };
    },
  } as any;
}

test("10/recordedFieldLineageResolvesOwner. no ARIA evidence at all, but associatedField re-resolves a UNIQUE owner via the CORE field-scope resolver, whose own aria-controls links to the exact-option surface: PASS", async () => {
  const page = fakeLineagePage("unique", ["panel-a"], [surface("panel-a", true, [MATCH])]);
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"), "CategorÃ­a de producto");
  assert.equal(result, true);
});

test("11/associatedFieldAbsentNoLineageAttempted. no ARIA evidence AND no associatedField: FAIL CLOSED, the field-scope resolver is never even invoked", async () => {
  const page = fakeLineagePage("unique", ["panel-a"], [surface("panel-a", true, [MATCH])]);
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"), undefined);
  assert.equal(result, false, "without associatedField, there is no lineage authority to attempt at all");
});

test("12/ownerFieldScopeNotFound. associatedField present but the CORE field-scope resolver cannot find ANY compatible owner: FAIL CLOSED (owner scope=0)", async () => {
  const page = fakeLineagePage("none", ["panel-a"], [surface("panel-a", true, [MATCH])]);
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"), "CategorÃ­a de producto");
  assert.equal(result, false, "the CORE field-scope resolver itself fails closed when no compatible owner exists -- no locator is fabricated here to compensate");
});

test("13/ariaEvidencePreferredOverLineage. when ARIA evidence IS present, the field-scope re-resolution is never attempted at all (ARIA stays the preferred, cheaper path)", async () => {
  const page = fakePage(["panel-a"], [surface("panel-a", true, [MATCH])]);
  const result = await isTransientSelectionOptionCausallyBound(page, optionCandidate("option", "Cuentas de Efectivo"), "CategorÃ­a de producto");
  assert.equal(result, true, "ARIA path alone is sufficient and must still work exactly as before when associatedField is also present");
});

/**
 * FIRST_LOSS (jobId 8ecce5ca-1109-4bf8-9084-76880c48f448): the recorded-field-lineage owner can
 * resolve uniquely, yet its own `aria-controls`/`aria-owns` id points at a stale/absent node, so
 * `inspectSelectionSurfaces` reports ZERO owner-linked surfaces (`reason=no_related_surface`) and
 * the option is rejected even though it is exactly one live, visible, enabled match. When the
 * recorded deterministic owner + recorded lineage + exact option identity + runtime uniqueness +
 * same route/surface/application ownership + post-owner availability all hold, the transition is
 * causally bound WITHOUT a related ARIA surface. Any missing guarantee still fails closed.
 */
const LINEAGE_AUTHORITY = {
  runtimeExactOptionUnique: true,
  recordedSurfaceCompatible: true,
  applicationOwnershipMatched: true,
  appearedAfterOwnerAction: true,
};

function lineageWithoutRelatedSurface() {
  // Owner lineage id resolves to a node that is NOT an owner-linked surface (stale/absent id).
  return fakeLineagePage("unique", ["ghost-panel"], [surface(undefined, true, [MATCH])]);
}

test("14/recordedLineageNoRelatedSurface. owner lineage exact, exact option runtime-unique, same surface/app, post-owner: causalBound=true without any ARIA surface", async () => {
  const page = lineageWithoutRelatedSurface();
  const result = await isTransientSelectionOptionCausallyBound(
    page, optionCandidate("option", "Cuentas de Efectivo"), "Categoría de producto", LINEAGE_AUTHORITY,
  );
  assert.equal(result, true);
});

test("15/duplicateRuntimeOptionFailsClosed. same lineage, but the exact option is NOT runtime-unique: FAIL CLOSED", async () => {
  const page = lineageWithoutRelatedSurface();
  const result = await isTransientSelectionOptionCausallyBound(
    page, optionCandidate("option", "Cuentas de Efectivo"), "Categoría de producto",
    { ...LINEAGE_AUTHORITY, runtimeExactOptionUnique: false },
  );
  assert.equal(result, false);
});

test("16/wrongSurfaceFailsClosed. same lineage, but the runtime route/surface does not match the recording: FAIL CLOSED", async () => {
  const page = lineageWithoutRelatedSurface();
  const result = await isTransientSelectionOptionCausallyBound(
    page, optionCandidate("option", "Cuentas de Efectivo"), "Categoría de producto",
    { ...LINEAGE_AUTHORITY, recordedSurfaceCompatible: false },
  );
  assert.equal(result, false);
});

test("17/foreignOwnershipFailsClosed. same lineage, but application ownership does not match: FAIL CLOSED", async () => {
  const page = lineageWithoutRelatedSurface();
  const result = await isTransientSelectionOptionCausallyBound(
    page, optionCandidate("option", "Cuentas de Efectivo"), "Categoría de producto",
    { ...LINEAGE_AUTHORITY, applicationOwnershipMatched: false },
  );
  assert.equal(result, false);
});

test("18/preexistingOptionFailsClosed. exact option present globally, but no recordedFieldLineage (no associatedField): FAIL CLOSED -- presence alone is never causal proof", async () => {
  const page = lineageWithoutRelatedSurface();
  const result = await isTransientSelectionOptionCausallyBound(
    page, optionCandidate("option", "Cuentas de Efectivo"), undefined, LINEAGE_AUTHORITY,
  );
  assert.equal(result, false);
});

test("19/ambiguousOwnerFailsClosed. associatedField present but the CORE field-scope resolver cannot certify ONE owner: FAIL CLOSED", async () => {
  const page = fakeLineagePage("none", ["ghost-panel"], [surface(undefined, true, [MATCH])]);
  const result = await isTransientSelectionOptionCausallyBound(
    page, optionCandidate("option", "Cuentas de Efectivo"), "Categoría de producto", LINEAGE_AUTHORITY,
  );
  assert.equal(result, false);
});

test("20/notYetAvailableFailsClosed. same lineage, but the option is not available as a consequence of the owner action: FAIL CLOSED", async () => {
  const page = lineageWithoutRelatedSurface();
  const result = await isTransientSelectionOptionCausallyBound(
    page, optionCandidate("option", "Cuentas de Efectivo"), "Categoría de producto",
    { ...LINEAGE_AUTHORITY, appearedAfterOwnerAction: false },
  );
  assert.equal(result, false);
});

test("21/ariaRelatedSurfaceStillPreferred. when a real ARIA owner-linked surface exists, ARIA resolves it regardless of the structured fallback flags", async () => {
  const page = fakeLineagePage("unique", ["panel-a"], [surface("panel-a", true, [MATCH])]);
  const result = await isTransientSelectionOptionCausallyBound(
    page, optionCandidate("option", "Cuentas de Efectivo"), "Categoría de producto",
    { ...LINEAGE_AUTHORITY, runtimeExactOptionUnique: false },
  );
  assert.equal(result, true, "the ARIA owner-linked surface path is unchanged and still authoritative");
});
