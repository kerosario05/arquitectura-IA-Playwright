import assert from "node:assert/strict";
import test from "node:test";
import { hydratePersistedScenarios } from "./persisted-scenario-hydration";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness, validateInteractionStateSequence, type CanonicalInteraction } from "./canonical-recording-contract";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";
import type { RecordedScenario } from "./trace-to-scenario";
import type { SemanticRecordingModel } from "./semantic-recording";

/**
 * FIRST_LOSS (recordingId=ba0dec1c-7db8-4793-9ef6-676c9fad98c8): `GET
 * /api/recordings/:recordingId/scenarios` -> `readRecordingScenarios` -> `hydratePersistedScenarios`
 * returned `stateSequenceValid`/`stateSequenceIssues`/`readiness.executionReadiness`/
 * `readiness.technicalReadiness` exactly as PERSISTED, computed once at derive time. An upstream
 * fix to canonical derivation (navigation ownership) makes a FRESH rebuild from the same trace
 * produce a different, correct verdict -- but `hydratePersistedScenarios` only ever repaired
 * specific fields (fill values, missing selections) via `hydrateCanonicalInteractionsFromSemanticModel`,
 * never re-ran `buildCanonicalInteractions` on the raw trace, so the stale verdict kept reaching
 * the API response even after the underlying bug was fixed.
 *
 * Fixed by accepting the recording's own persisted `trace` (already available via
 * `recording-store.ts`'s `loadTrace`, the closest AUTHORITY) and, when present, rebuilding
 * `canonicalInteractions` fresh via `buildCanonicalInteractions(trace.events)` -- the exact same
 * function every other derivation boundary already calls -- before re-running
 * `validateInteractionStateSequence`/`evaluateRecordedScenarioExecutionReadiness` (the same
 * execution audit `toSharedMcpScenario`/POST `/execute` already use). In-memory projection only;
 * scenarios.json is never rewritten.
 */

function ev(overrides: Record<string, unknown>) {
  return { seq: 0, t: 1, kind: "note", screenKey: "s", url: "/a", ...overrides } as never;
}

// Real-shape fixture: pointer -> fill -> navigation -> tap, same interactionId -- the exact
// shape whose navigation-ownership fix this ticket's freshness must now surface through GET.
const pointerFillTapEvents: RecordedEvent[] = [
  ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "pointer-4", screenKey: "login", url: "/login" }),
  ev({ seq: 1, t: 2, kind: "fill", screenKey: "login", url: "/login", target: { label: "Contraseña", associatedField: "Contraseña", role: "textbox", locators: [{ strategy: "css", value: "#pwd" }] }, value: "x" }),
  ev({ seq: 2, t: 3, kind: "tap", interactionId: "pointer-4", screenKey: "login", url: "/login", target: { role: "button", associatedField: "Continuar", locators: [{ strategy: "role", value: "button[name=Continuar]" }] } }),
  ev({ seq: 3, t: 4, kind: "navigate", screenKey: "login", url: "/dashboard" }),
];

function traceOf(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "fixture-recording-id",
    projectSlug: "p", appSlug: "app", platform: "web",
    baseUrl: "http://fixture.test", startedAt: new Date().toISOString(), status: "completed",
    events, screens: [{ screenKey: "login", url: "/login" } as any],
  } as unknown as SessionTrace;
}

const emptySemanticModel = { editingSessions: [], canonicalInteractions: [] } as unknown as SemanticRecordingModel;

/** A minimal, self-contained scenario carrying STALE canonicalInteractions (simulating a
 * pre-fix-derived persisted artifact) alongside the STALE stateSequenceValid/readiness that
 * would have been computed from them at derive time. */
function stalePersistedScenario(canonicalInteractions: CanonicalInteraction[]): RecordedScenario {
  const stale = validateInteractionStateSequence(canonicalInteractions);
  return {
    scenarioId: "REC-FIXTURE-01",
    title: "fixture",
    description: "fixture",
    preconditions: [],
    kind: "happy_path",
    provenance: "observed",
    mobileSteps: [],
    webSteps: [],
    testRailSteps: [{ content: "step" } as any],
    requiredData: [],
    stepTargets: [],
    sourceRecordingId: "fixture-recording-id",
    hasUncertainSteps: false,
    canonicalInteractions,
    stateSequenceValid: stale.stateSequenceValid,
    stateSequenceIssues: stale.stateSequenceIssues,
    readiness: {
      functionalReadiness: true,
      dataReadiness: true,
      technicalReadiness: false,
      oracleReadiness: true,
      reviewReadiness: true,
      publicationContentReadiness: true,
      executionReadiness: false,
      publicationReadiness: true,
      missingInputs: [],
      datasetAuthorityMismatches: [],
      dataReadinessReasons: [],
    },
  } as unknown as RecordedScenario;
}

// A deliberately STALE canonical shape: the fill wrongly claims the navigation (the exact
// pre-fix actionablePointerAnchor bug), producing a genuine stateSequenceIssue -- captures what a
// persisted artifact derived BEFORE that fix landed would actually contain.
function staleCanonicalInteractionsShape(): CanonicalInteraction[] {
  return [
    { id: "interaction-2", controlIdentity: "c1", action: "fill", sourceEventRefs: ["event-2"], technicalTargetRefs: [], screenBeforeRef: "login", screenAfterRef: "login", routeBefore: "/login", routeAfter: "/dashboard", causedTransition: true, confidence: 1 } as unknown as CanonicalInteraction,
    { id: "interaction-3", controlIdentity: "c2", action: "click", sourceEventRefs: ["event-3"], technicalTargetRefs: ["role:button[name=Continuar]"], screenBeforeRef: "login", screenAfterRef: "login", routeBefore: "/login", confidence: 1 } as unknown as CanonicalInteraction,
  ];
}

test("1/staleStateSequenceProjection. a persisted stateSequenceValid=false with old issues is refreshed to true once the current canonical authority resolves them", () => {
  const stale = stalePersistedScenario(staleCanonicalInteractionsShape());
  assert.equal(stale.stateSequenceValid, false, "sanity: the fixture genuinely reproduces a stale/invalid persisted verdict");

  const trace = traceOf(pointerFillTapEvents);
  const projected = hydratePersistedScenarios([stale], emptySemanticModel, trace);

  assert.equal(projected[0].stateSequenceValid, true);
  assert.deepEqual(projected[0].stateSequenceIssues, []);
});

test("2/sourceArtifactUnchanged. the projection never mutates the persisted scenario object passed in", () => {
  const stale = stalePersistedScenario(staleCanonicalInteractionsShape());
  const snapshotBefore = JSON.stringify(stale);
  hydratePersistedScenarios([stale], emptySemanticModel, traceOf(pointerFillTapEvents));
  assert.equal(JSON.stringify(stale), snapshotBefore, "the input scenario object must be left exactly as it was");
});

test("3/executionReadinessRefresh. persisted executionReadiness=false is refreshed to true once the current execution audit allows it", () => {
  const stale = stalePersistedScenario(staleCanonicalInteractionsShape());
  assert.equal(stale.readiness?.executionReadiness, false, "sanity: persisted fixture starts blocked");

  const projected = hydratePersistedScenarios([stale], emptySemanticModel, traceOf(pointerFillTapEvents));
  assert.equal(projected[0].readiness?.executionReadiness, true);
});

test("4/technicalSeparation. runtime_resolution_required actions: executionReadiness=true while technicalReadiness stays false", () => {
  const rtrEvents: RecordedEvent[] = [
    ev({ seq: 0, t: 1, kind: "fill", screenKey: "s", url: "/a", target: { label: "Colaborador asignado", associatedField: "Colaborador asignado", role: "textbox", locators: [], technicalTargetCandidates: [{ targetType: "editable", semanticRole: "editable", locatorCandidates: [{ strategy: "css", value: "#f" }], interactionEvidence: ["input"], confidence: 0.7, validatedByInteraction: true }] }, value: "v" }),
  ];
  const canonical = buildCanonicalInteractions(rtrEvents);
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required");
  const stale = stalePersistedScenario(canonical);
  const projected = hydratePersistedScenarios([stale], emptySemanticModel, traceOf(rtrEvents));

  assert.equal(projected[0].readiness?.executionReadiness, true, "runtime_resolution_required must not be conflated with technical certification");
  assert.equal(projected[0].readiness?.technicalReadiness, false);
});

test("5/realRecordingShape. pointer -> fill -> navigation -> tap (same interactionId) rebuilds to a valid fresh sequence", () => {
  const stale = stalePersistedScenario(staleCanonicalInteractionsShape());
  const projected = hydratePersistedScenarios([stale], emptySemanticModel, traceOf(pointerFillTapEvents));
  const audit = evaluateRecordedScenarioExecutionReadiness(projected[0]);
  assert.equal(audit.executionReady, true);
});

test("6/stillInvalid. a genuinely still-incompatible sequence stays false -- no defect is ever hidden", () => {
  // A owns a real transition to an unrelated route; B is a wholly separate, later interaction on
  // a different screen that never received A's navigation -- a genuine cross-screen jump the
  // fresh rebuild must still catch, not a stale artifact this fix is meant to unstick.
  const genuinelyBrokenEvents: RecordedEvent[] = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "p-a", screenKey: "screen-a", url: "/a" }),
    ev({ seq: 1, t: 2, kind: "tap", interactionId: "p-a", screenKey: "screen-a", url: "/a", target: { role: "button", associatedField: "X", locators: [{ strategy: "role", value: "button[name=X]" }] } }),
    ev({ seq: 2, t: 3, kind: "navigate", screenKey: "screen-a", url: "/mismatch" }),
    ev({ seq: 3, t: 4, kind: "note", observationType: "pointer", interactionId: "p-b", screenKey: "screen-b", url: "/b" }),
    ev({ seq: 4, t: 5, kind: "tap", interactionId: "p-b", screenKey: "screen-b", url: "/b", target: { role: "button", associatedField: "Y", locators: [{ strategy: "role", value: "button[name=Y]" }] } }),
  ];
  const canonical = buildCanonicalInteractions(genuinelyBrokenEvents);
  const stale = stalePersistedScenario(canonical);
  const projected = hydratePersistedScenarios([stale], emptySemanticModel, traceOf(genuinelyBrokenEvents));
  assert.equal(projected[0].stateSequenceValid, false, "a real cross-screen incompatibility must never be hidden by this refresh");
});

test("7/noAuthority. without a trace (legacy/no persisted trace), the existing safe behavior is preserved -- never fabricated fresh", () => {
  const stale = stalePersistedScenario(staleCanonicalInteractionsShape());
  const projected = hydratePersistedScenarios([stale], emptySemanticModel, null);
  // No trace authority: canonicalInteractions are only field-repaired (unchanged shape here),
  // so the stale verdict from those SAME interactions is still what gets recomputed -- honest,
  // not fabricated true.
  assert.equal(projected[0].stateSequenceValid, false);
});

test("8/postExecutionParity. the GET projection's refreshed readiness matches evaluateRecordedScenarioExecutionReadiness directly on the same fresh canonicalInteractions -- same shared predicate, no contradiction", () => {
  const stale = stalePersistedScenario(staleCanonicalInteractionsShape());
  const trace = traceOf(pointerFillTapEvents);
  const projected = hydratePersistedScenarios([stale], emptySemanticModel, trace);
  const freshCanonical = buildCanonicalInteractions(trace.events);
  const directAudit = evaluateRecordedScenarioExecutionReadiness({ ...stale, canonicalInteractions: freshCanonical, stateSequenceValid: validateInteractionStateSequence(freshCanonical).stateSequenceValid });

  assert.equal(projected[0].readiness?.executionReadiness, directAudit.executionReady);
  assert.equal(projected[0].readiness?.technicalReadiness, directAudit.technicalReady);
});

test("9/promotionUnchanged. publicationReadiness/promotion is never elevated by this refresh", () => {
  const stale = stalePersistedScenario(staleCanonicalInteractionsShape());
  const projected = hydratePersistedScenarios([stale], emptySemanticModel, traceOf(pointerFillTapEvents));
  assert.equal(projected[0].readiness?.publicationReadiness, stale.readiness?.publicationReadiness, "publicationReadiness must be left exactly as persisted by this fix");
});

test("10/legacy. a scenario with no semanticModel at all is returned completely untouched (pre-existing early-return preserved)", () => {
  const stale = stalePersistedScenario(staleCanonicalInteractionsShape());
  const projected = hydratePersistedScenarios([stale], null, traceOf(pointerFillTapEvents));
  assert.equal(projected[0], stale, "identity-preserved passthrough, exactly as before this ticket");
});

test("11/frontendContract. every key already present on the persisted scenario is still present on the projection -- this fix only refreshes field VALUES, never removes a field the DTO relies on", () => {
  const stale = stalePersistedScenario(staleCanonicalInteractionsShape());
  const projected = hydratePersistedScenarios([stale], emptySemanticModel, traceOf(pointerFillTapEvents));
  for (const key of Object.keys(stale)) {
    assert.ok(key in projected[0], `key "${key}" must still be present on the projection`);
  }
  assert.deepEqual(Object.keys(projected[0].readiness ?? {}).sort(), Object.keys(stale.readiness ?? {}).sort(), "readiness sub-object shape is unchanged -- only executionReadiness/technicalReadiness values differ");
});
