import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness, type CanonicalInteraction } from "./canonical-recording-contract";
import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * FIRST_LOSS (recordingId=ba0dec1c-7db8-4793-9ef6-676c9fad98c8, interaction-24): a `check` action
 * (a grid row-selection checkbox) had a `technicalTargetCandidate` carrying real, deterministic
 * STRUCTURAL owner identity (`deterministicStructuralIdentity: true`, not ambiguous -- stable
 * attributes/landmark, never text) but zero `locatorCandidates` and a generic, per-row-repeated
 * `aria-label` ("Seleccionar fila"-shaped) that admission correctly refuses as field identity.
 * `sufficientRuntimeEvidence` (the admission-REJECTED runtime-resolution carve-out) never looked
 * at this structural evidence at all -- only technicalTargetRefs/structuralFieldName/
 * fieldOwnerDiagnostic -- so the interaction was `unresolved_unrecoverable` and permanently
 * execution-blocked (`no_structural_reresolution_strategy`, `required_interaction_unresolved`),
 * even though `resolveRecordedStructuralOwner` (target-resolver.ts) already builds a live
 * selector from this SAME evidence and independently re-verifies runtime uniqueness before ever
 * resolving anything -- it never trusts the capture-time flag alone.
 *
 * Fixed in two places: (1) `sufficientRuntimeEvidence` now also accepts
 * `deterministicStructuralOwnerEvidence` (the SAME flag `deterministicStructuralRuntimeEligible`
 * already used for the admission-ACCEPTED path -- single definition, reused, not duplicated);
 * (2) `resolveRecordedTechnicalTarget`'s locator-less structural-owner loop (target-resolver.ts)
 * widened from `topologyTieBreakUnique`-only to any `deterministicStructuralIdentity` candidate,
 * since `normalizeStructuralOwnerIdentity` already guarantees that flag never becomes true
 * without real stable evidence or a topology tie-break backing it -- matching
 * `resolveRecordedStructuralOwner`'s own, already-existing eligibility check exactly, so the
 * readiness promise (`runtime_resolution_required`) is always backed by a real runtime attempt.
 *
 * `identityAmbiguous`/`structuralIdentityMatchCount > 1` still fail closed -- capture-time
 * ambiguity was never eligible and stays that way. A genuinely repeated live DOM (multiple rows
 * sharing the same generic label) is caught by `resolveRecordedStructuralOwner`'s own live
 * re-count, which this ticket does not touch and cannot be exercised without a real browser --
 * verified here only up to the boundary this repo can prove without one: readiness/admission
 * correctly grants an ATTEMPT, never a false certification.
 */

let seq = 0;
function tapEvent(overrides: { screenKey: string; target: Partial<RecordedTarget> & { label: string } }): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "tap", screenKey: overrides.screenKey, target: { locators: [], ...overrides.target } as RecordedTarget };
}
function fillEvent(overrides: { screenKey: string; target: Partial<RecordedTarget> & { label: string }; value: string }): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "fill", screenKey: overrides.screenKey, value: overrides.value, target: { locators: [], ...overrides.target } as RecordedTarget };
}
function baseScenario(interactions: CanonicalInteraction[]) {
  return {
    canonicalInteractions: interactions,
    runtimeInputRequirements: [],
    testRailSteps: [{ content: "step" } as any],
    stateSequenceValid: true,
    mutationDiagnostics: undefined,
    readiness: undefined,
  };
}

// The exact real-evidence shape from interaction-24 -- a generic label the checkbox shares with
// every other row, real structural identity that is NOT a topology tie-break, no locator.
const rowSelectionCheckboxCandidate = {
  targetType: "structural" as const,
  locatorCandidates: [],
  structuralContext: {
    owner: { tag: "button", role: "checkbox" },
    stableDirectAttributes: { "aria-label": "control", role: "checkbox" },
    stableDescendants: [],
    semanticShape: [],
    landmarkAncestor: { tag: "main" },
    deterministicStructuralIdentity: true,
    structuralIdentityMatchCount: 1,
  },
  interactionEvidence: ["v2_click_owner"],
  confidence: 0.85,
  validatedByInteraction: true,
};

test("1/structuralCheck. a check action with deterministic structural evidence and no locator is admitted for runtime resolution, never blocked solely by missing locator", () => {
  seq = 0;
  const events = [tapEvent({
    screenKey: "s",
    target: { label: "control", role: "checkbox", technicalTargetCandidates: [rowSelectionCheckboxCandidate] },
  })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].action, "check");
  assert.equal(interactions[0].resolutionState, "runtime_resolution_required");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, true);
  assert.deepEqual(audit.actions[0].blockReasons, []);
});

test("2/technicalSeparation. execution is allowed while technicalReadiness stays false, promotion never elevated", () => {
  seq = 0;
  const events = [tapEvent({
    screenKey: "s",
    target: { label: "control", role: "checkbox", technicalTargetCandidates: [rowSelectionCheckboxCandidate] },
  })];
  const interactions = buildCanonicalInteractions(events);
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.executionReady, true);
  assert.equal(audit.technicalReady, false);
  assert.equal(audit.promotionReady, false);
});

test("3/genericLabelAlone. a checkbox with a generic label and NO structural candidate at all stays blocked", () => {
  seq = 0;
  const events = [tapEvent({ screenKey: "s", target: { label: "control", role: "checkbox" } })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].resolutionState, "unresolved_unrecoverable");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, false);
});

test("4/ambiguousStructuralMatch. a structural candidate marked identityAmbiguous never qualifies -- fail closed", () => {
  seq = 0;
  const ambiguousCandidate = {
    ...rowSelectionCheckboxCandidate,
    structuralContext: { ...rowSelectionCheckboxCandidate.structuralContext, deterministicStructuralIdentity: false, identityAmbiguous: true, structuralIdentityMatchCount: 2 },
  };
  const events = [tapEvent({ screenKey: "s", target: { label: "control", role: "checkbox", technicalTargetCandidates: [ambiguousCandidate] } })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].resolutionState, "unresolved_unrecoverable");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, false);
});

test("5/noRowAuthority. capture-time uniqueness alone never becomes execution CERTIFICATION -- resolutionState stays runtime_resolution_required (never certified), preserving the live re-verification boundary", () => {
  seq = 0;
  const events = [tapEvent({
    screenKey: "s",
    target: { label: "control", role: "checkbox", technicalTargetCandidates: [rowSelectionCheckboxCandidate] },
  })];
  const interactions = buildCanonicalInteractions(events);
  assert.notEqual(interactions[0].resolutionState, "certified", "structural evidence alone never becomes a false certification -- only a permitted runtime attempt");
});

test("6/uniqueStructuralOwner. no synthetic locator is ever fabricated to make this resolvable", () => {
  seq = 0;
  const events = [tapEvent({
    screenKey: "s",
    target: { label: "control", role: "checkbox", technicalTargetCandidates: [rowSelectionCheckboxCandidate] },
  })];
  const interactions = buildCanonicalInteractions(events);
  assert.deepEqual(interactions[0].technicalTargetRefs, []);
  assert.deepEqual(interactions[0].technicalTargetCandidates?.[0]?.locatorCandidates, []);
});

test("7/certifiedLocator. a checkbox WITH a real technical locator is unaffected -- still certified as before", () => {
  seq = 0;
  const events = [tapEvent({ screenKey: "s", target: { label: "Activo", role: "checkbox", locators: [{ strategy: "data-testid", value: "active-toggle" }] } })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].resolutionState, "certified");
});

test("8/nonCheckRegression. this fix never grants new eligibility to an action with no structural candidate evidence at all -- generic label alone still fails closed regardless of action type", () => {
  seq = 0;
  const events = [fillEvent({ screenKey: "s", target: { label: "control" }, value: "algún valor" })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].resolutionState, "unresolved_unrecoverable");
});

test("9/realBlockerShape. the exact interaction-24 fixture shape no longer produces no_structural_reresolution_strategy/required_interaction_unresolved", () => {
  seq = 0;
  const events = [tapEvent({
    screenKey: "s",
    target: { label: "control", role: "checkbox", technicalTargetCandidates: [rowSelectionCheckboxCandidate] },
  })];
  const interactions = buildCanonicalInteractions(events);
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.ok(!audit.actions[0].blockReasons.includes("no_structural_reresolution_strategy"));
  assert.ok(!audit.actions[0].blockReasons.includes("required_interaction_unresolved"));
});

test("10/remainingBlockersIndependent. a sibling interaction with genuinely no structural evidence stays independently blocked -- fixing one action never marks the whole scenario executable", () => {
  seq = 0;
  const events = [
    tapEvent({ screenKey: "s", target: { label: "control", role: "checkbox", technicalTargetCandidates: [rowSelectionCheckboxCandidate] } }),
    tapEvent({ screenKey: "s", target: { label: "control" } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, true);
  assert.equal(audit.actions[1].ready, false);
  assert.equal(audit.executionReady, false, "the scenario as a whole stays blocked by the still-genuinely-unresolved sibling");
});

test("11/noSyntheticLocator. locatorCandidates/technicalTargetRefs remain exactly as recorded -- empty, never invented", () => {
  seq = 0;
  const events = [tapEvent({
    screenKey: "s",
    target: { label: "control", role: "checkbox", technicalTargetCandidates: [rowSelectionCheckboxCandidate] },
  })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].technicalTargetRefs.length, 0);
});

test("13/crossBoundary. the readiness capability (runtime_resolution_required) matches the exact structural criteria the runtime resolver itself checks -- deterministic identity, not ambiguous, independent of WHICH generic label the admission gate rejected", () => {
  seq = 0;
  // Multiple, different generic labels -- none is the specific real-recording label -- all reach
  // the same outcome, proving eligibility is decided by structural identity, never by matching a
  // particular label string.
  const genericLabelVariants = ["control", "campo", "field"];
  for (const label of genericLabelVariants) {
    const events = [tapEvent({
      screenKey: "s",
      target: { label, role: "checkbox", technicalTargetCandidates: [{ ...rowSelectionCheckboxCandidate, structuralContext: { ...rowSelectionCheckboxCandidate.structuralContext, stableDirectAttributes: { "aria-label": label, role: "checkbox" } } }] },
    })];
    const interactions = buildCanonicalInteractions(events);
    assert.equal(interactions[0].resolutionState, "runtime_resolution_required", `eligibility must be label-independent (failed for: ${label})`);
    // No app/business-specific label text drives this -- structural identity alone.
  }
});
