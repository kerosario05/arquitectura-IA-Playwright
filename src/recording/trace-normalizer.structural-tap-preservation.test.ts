import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTrace } from "./session-trace.types";
import { normalizeEvents } from "./trace-normalizer";
import { materializeObservedPrimaryScenario, buildHappyPathScenario } from "./trace-to-scenario";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness } from "./canonical-recording-contract";

/**
 * FIRST_LOSS: `normalizeEvents`'s Pass 4 ("a tap nobody can locate is not reproducible") decided
 * "nobody can locate this" purely from `target.locators.length` -- the CERTIFIED locator list --
 * and demoted the event to `kind: "note"` (permanently excluded from `buildCanonicalInteractions`,
 * which skips `note` events outright) whenever that list was empty. This is strictly stronger
 * than what admission downstream actually requires: a click CaptureEngine V2 resolved to a real
 * owner with a real, non-generic field relation (`associatedField`) and real structural evidence
 * (`technicalTargetCandidates`/`structuralContext`) -- just not a single unambiguous certified
 * locator, because several visually-identical icon-only buttons genuinely exist on the page --
 * is exactly the shape `buildCanonicalInteractions`'s own `runtime_resolution_required` carve-out
 * exists to let through to the live field-scoped resolver. Confirmed against a real recording's
 * persisted trace.json (recordingId 22ab5b69-6dd5-4bc8-9bd0-bbd0423f66cc): the click survived as
 * a `RecordedEvent` but was silently turned into a `note` by `normalizeEvents`, one layer BEFORE
 * `buildCanonicalInteractions` ever ran -- never reaching canonical/observed/execution/display at
 * all. Fixed by adding a second survival path alongside the existing locator/selection checks: a
 * tap with real structural runtime evidence (non-generic associatedField/headerContext/
 * columnIdentity AND at least one technicalTargetCandidate) is never demoted, regardless of
 * whether a locator was certified.
 */

function fixture(overrides: Partial<SessionTrace> = {}): SessionTrace {
  return {
    recordingId: "structural-tap-preservation-fixture",
    projectSlug: "structural-tap-preservation-fixture",
    appSlug: "structural-tap-preservation-fixture",
    platform: "web",
    baseUrl: "https://app.test/requests/create/multiproduct",
    label: "Solicitud multiproducto",
    recordingGoal: { declaredGoal: "Solicitud multiproducto", normalizedGoal: "solicitud multiproducto", provenance: "USER_DECLARED", needsReview: false },
    recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: true, includeQaCredentialsInTestRail: false },
    startedAt: "2026-09-18T10:00:00.000Z",
    status: "stopped",
    events: [],
    screens: [
      { screenKey: "multiproduct", title: "Solicitud multiproducto", fingerprint: "multiproduct", firstSeenAt: 0, controls: [], texts: ["Solicitud multiproducto"] },
    ],
    ...overrides,
  } as SessionTrace;
}

/** The exact shape confirmed against recordingId 22ab5b69-6dd5-4bc8-9bd0-bbd0423f66cc's trace.json. */
function realShapeFixture(): SessionTrace {
  return fixture({
    events: [
      {
        seq: 0, t: 100, kind: "fill", screenKey: "multiproduct",
        target: { label: "control", role: "input", associatedField: "Número de identificación", locators: [] },
        value: "056-0154046-0",
      },
      {
        seq: 1, t: 200, kind: "tap", screenKey: "multiproduct",
        target: {
          label: "control", role: "button", tag: "button", associatedField: "Número de identificación", locators: [],
          technicalTargetCandidates: [
            {
              targetType: "structural",
              locatorCandidates: [],
              structuralContext: {
                owner: { tag: "button" },
                stableDirectAttributes: {},
                stableDescendants: [],
                semanticShape: ["span"],
                landmarkAncestor: { tag: "main" },
                deterministicStructuralIdentity: false,
                identityAmbiguous: true,
                structuralIdentityMatchCount: 4,
              },
              interactionEvidence: ["v2_click_owner"],
              confidence: 0.85,
              validatedByInteraction: true,
            },
          ],
        },
      },
      {
        seq: 2, t: 300, kind: "tap", screenKey: "multiproduct",
        target: { label: "Depurar", role: "button", locators: [{ strategy: "role", value: "button|Depurar", confidence: 0.95 }] },
      },
    ] as SessionTrace["events"],
  });
}

function frameworkOwnerTap(overrides: Record<string, unknown> = {}): SessionTrace {
  const structuralContext = {
    owner: { tag: "div" },
    stableDirectAttributes: {},
    stableDescendants: [{ relation: "descendant" as const, tag: "img", stableAttributes: { alt: "semantic identity" } }],
    semanticShape: ["div", "h3"],
    landmarkAncestor: { tag: "main" },
    deterministicStructuralIdentity: true,
    structuralIdentityMatchCount: 1,
  };
  return fixture({
    events: [{
      seq: 0, t: 100, kind: "tap", screenKey: "multiproduct",
      target: {
        // Display metadata is deliberately non-generic; normalization admission below is
        // asserted through the structural framework evidence, never this label.
        label: "framework action", tag: "div", locators: [],
        technicalTargetCandidates: [{
          targetType: "structural", locatorCandidates: [],
          structuralContext: { ...structuralContext, ...(overrides.structuralContext as object ?? {}) },
          interactionEvidence: ["v2_click_owner", "v2_framework_actionable_owner"],
          confidence: 0.85, validatedByInteraction: true,
        }],
        ...(overrides.target as object ?? {}),
      },
    }] as SessionTrace["events"],
  });
}

/** Mirrors the physical no-locator native owner after Capture V2's topology tie-break. */
function topologyTiebrokenNativeTap(overrides: Record<string, unknown> = {}): SessionTrace {
  const structuralContext = {
    owner: { tag: "button" },
    stableDirectAttributes: {},
    stableDescendants: [],
    semanticShape: ["div", "h3", "p"],
    landmarkAncestor: { tag: "main" },
    deterministicStructuralIdentity: true,
    topologyTieBreakUnique: true,
    structuralIdentityMatchCount: 1,
  };
  return fixture({
    events: [{
      seq: 0, t: 100, kind: "tap", screenKey: "multiproduct",
      target: {
        label: "native action", tag: "button", role: "button", locators: [],
        technicalTargetCandidates: [{
          targetType: "structural", locatorCandidates: [],
          structuralContext: { ...structuralContext, ...(overrides.structuralContext as object ?? {}) },
          interactionEvidence: ["v2_click_owner"],
          confidence: 0.85, validatedByInteraction: true,
        }],
        ...(overrides.target as object ?? {}),
      },
    }] as SessionTrace["events"],
  });
}

test("framework structural owner with unique deterministic authority survives normalization and reaches canonical projection", () => {
  const trace = frameworkOwnerTap();
  const normalized = normalizeEvents(trace.events);
  assert.equal(normalized[0].kind, "tap");
  const canonical = buildCanonicalInteractions(normalized);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].action, "click");
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required");
  const scenario = buildHappyPathScenario(trace, normalized);
  assert.ok(scenario.testRailSteps.some((step) => step.sourceEventRefs?.includes("event-1")));
});

test("topology-derived deterministic framework authority survives normalization without a locator or text authority", () => {
  const trace = frameworkOwnerTap({ structuralContext: {
    stableDescendants: [],
    topologyTieBreakUnique: true,
  } });
  const normalized = normalizeEvents(trace.events);
  assert.equal(normalized[0].kind, "tap");
  assert.equal(buildCanonicalInteractions(normalized).length, 1);
});

test("topology-tiebroken native owner crosses raw, normalization, canonical, and scenario projection without inventing a locator", () => {
  const trace = topologyTiebrokenNativeTap();
  const normalized = normalizeEvents(trace.events);
  assert.equal(normalized[0].kind, "tap");
  assert.deepEqual(normalized[0].target?.locators, []);
  const canonical = buildCanonicalInteractions(normalized);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required");
  const scenario = buildHappyPathScenario(trace, normalized);
  assert.ok(scenario.testRailSteps.some((step) => step.sourceEventRefs?.includes("event-1")));
});

test("topology marker alone never admits an ambiguous or non-actionable raw target", () => {
  const ambiguous = topologyTiebrokenNativeTap({ structuralContext: { structuralIdentityMatchCount: 2, identityAmbiguous: true } });
  const genericDiv = topologyTiebrokenNativeTap({ target: { tag: "div", role: undefined }, structuralContext: { owner: { tag: "div" } } });
  for (const trace of [ambiguous, genericDiv]) {
    assert.equal(normalizeEvents(trace.events)[0].kind, "note");
  }
});

test("framework structural owner remains a note unless its structural authority is uniquely deterministic", () => {
  const ambiguous = frameworkOwnerTap({ structuralContext: { structuralIdentityMatchCount: 2 } });
  const nonDeterministic = frameworkOwnerTap({ structuralContext: { deterministicStructuralIdentity: false } });
  const missingMatch = frameworkOwnerTap({ structuralContext: { structuralIdentityMatchCount: 0 } });
  for (const trace of [ambiguous, nonDeterministic, missingMatch]) {
    assert.equal(normalizeEvents(trace.events)[0].kind, "note");
  }
});

test("FIRST_LOSS boundary: normalizeEvents must never demote a tap with real structural runtime evidence to a note, even with zero certified locators", () => {
  const trace = realShapeFixture();
  const normalized = normalizeEvents(trace.events);
  const iconEvent = normalized.find((e) => e.seq === 1 || (e.target?.associatedField === "Número de identificación" && e.target?.role === "button"));
  assert.ok(iconEvent, "the icon button event must still be present after normalization");
  assert.equal(iconEvent!.kind, "tap", "the icon button must survive normalization as a tap, never demoted to a note");
});

test("realShape/fullPipeline. capture=3, recorded=3, canonical=3, observed=3, execution=3, in order: fill, click icon (runtime_resolution_required), click Depurar", () => {
  const trace = realShapeFixture();
  const CAPTURE_ACTIONS = trace.events.length;
  assert.equal(CAPTURE_ACTIONS, 3);

  const normalized = normalizeEvents(trace.events);
  assert.equal(normalized.filter((e) => e.kind !== "note").length, 3, "recordedActions=3 -- none silently demoted to a note");

  const primary = materializeObservedPrimaryScenario(trace, normalized);
  assert.ok(primary, "the observed primary must materialize");

  const functionalInteractions = (primary.canonicalInteractions ?? []).filter((i) => i.action !== "navigation");
  assert.equal(functionalInteractions.length, 3, "canonicalActions=3");
  assert.deepEqual(functionalInteractions.map((i) => i.action), ["fill", "click", "click"]);

  const iconInteraction = functionalInteractions[1];
  assert.equal(iconInteraction.admissionStatus, "accepted");
  assert.equal(iconInteraction.resolutionState, "runtime_resolution_required");

  // observedActions=3 -- same list, this IS the observed primary's own canonicalInteractions.
  assert.equal((primary.canonicalInteractions ?? []).filter((i) => i.action !== "navigation").length, 3);

  const audit = evaluateRecordedScenarioExecutionReadiness(primary);
  const executionFunctional = audit.actions.filter((a) => a.actionType !== "navigation");
  assert.equal(executionFunctional.length, 3, "executionActions=3");
  assert.ok(executionFunctional.every((a) => a.ready), "all three actions must be execution-ready");

  // Display: the icon button never renders the raw "control" sentinel as a fake accessible name.
  const scenario = buildHappyPathScenario(trace, normalized);
  const iconStep = scenario.testRailSteps.find((step) => step.sourceEventRefs?.includes("event-2"));
  assert.ok(iconStep, "the icon button must produce its own visible display step");
  assert.equal(iconStep!.content, 'Presionar botón asociado a "Número de identificación"');
  assert.notEqual(iconStep!.content, 'Presionar "control"');
});

test("regression: a tap with zero locators, no structural evidence, and no real field relation is still demoted to a note (the carve-out is not a blanket relaxation)", () => {
  const trace = fixture({
    events: [
      { seq: 0, t: 100, kind: "tap", screenKey: "multiproduct", target: { label: "", role: "button", locators: [] } },
    ] as SessionTrace["events"],
  });
  const normalized = normalizeEvents(trace.events);
  assert.equal(normalized[0].kind, "note", "a genuinely unidentifiable tap must still become a note");
});

test("regression: real structural evidence but a generic associatedField ('control') still gets demoted -- generic labels never count as real field relation", () => {
  const trace = fixture({
    events: [
      {
        seq: 0, t: 100, kind: "tap", screenKey: "multiproduct",
        target: {
          label: "", role: "button", locators: [], associatedField: "control",
          technicalTargetCandidates: [{ targetType: "structural", locatorCandidates: [], interactionEvidence: [], confidence: 0.5, validatedByInteraction: true }],
        },
      },
    ] as SessionTrace["events"],
  });
  const normalized = normalizeEvents(trace.events);
  assert.equal(normalized[0].kind, "note");
});

test("regression: a certified-locator tap is unaffected -- still survives via the pre-existing locator check, not the new carve-out", () => {
  const trace = fixture({
    events: [
      { seq: 0, t: 100, kind: "tap", screenKey: "multiproduct", target: { label: "Continuar", role: "button", locators: [{ strategy: "role", value: "button|Continuar", confidence: 0.95 }] } },
    ] as SessionTrace["events"],
  });
  const normalized = normalizeEvents(trace.events);
  assert.equal(normalized[0].kind, "tap");
});

test("multiproject: no app/field hardcode governs the carve-out -- an arbitrary associatedField qualifies identically", () => {
  for (const field of ["Cualquier campo distinto", "Otro campo genérico"]) {
    const trace = fixture({
      events: [
        {
          seq: 0, t: 100, kind: "tap", screenKey: "multiproduct",
          target: {
            label: "control", role: "button", locators: [], associatedField: field,
            technicalTargetCandidates: [{ targetType: "structural", locatorCandidates: [], interactionEvidence: [], confidence: 0.85, validatedByInteraction: true }],
          },
        },
      ] as SessionTrace["events"],
    });
    const normalized = normalizeEvents(trace.events);
    assert.equal(normalized[0].kind, "tap", `expected the tap to survive for associatedField=${field}`);
  }
});
