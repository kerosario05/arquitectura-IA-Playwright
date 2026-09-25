import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { buildCanonicalInteractions, enrichRecordedScenarioContract, evaluateRecordedScenarioExecutionReadiness } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

/**
 * FIRST_LOSS: the field-scoped LIVE structural resolver (target-resolver.ts's
 * `resolveActionTarget`/`resolveFillTarget` field-scoped fallback) can already certify and
 * execute a fill/click/press whose owner has a real, admitted `associatedField` relation but NO
 * recorded technical locator at all (`technicalTargetRefs=[]`). But `resolutionState` only ever
 * carved out a "runtime resolution required" exception for the REJECTED-admission case
 * (`admissionStatus==="unresolved"`); an ACCEPTED identity with zero recorded targets always got
 * `resolutionState="certified"`, and `evaluateRecordedScenarioExecutionReadiness` then
 * unconditionally blocked it via `missing_technical_target`/`no_structural_reresolution_strategy`
 * -- the live resolver was never even attempted.
 *
 * Fixed with a second, independent `structuralRuntimeEligible` condition feeding the SAME
 * existing `resolutionState="runtime_resolution_required"` state (no parallel flag): admission
 * accepted + a real associatedField + a known owner role + a live-resolver-supported action type
 * (fill/click/press only) + no prior locator-ambiguity evidence. The readiness function's two
 * target-coverage block reasons are now skipped for a runtime-resolution-required action (of
 * EITHER kind), and `executionReady` no longer unconditionally ANDs in the aggregate
 * `technicalReady` flag -- which stays honestly false/reduced, exactly matching
 * "technicalCoverageReady=false/deferred, executionReadiness=true". `promotionReady` already
 * excluded every `runtimeResolutionRequired` action and needed no change.
 */

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-1",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://readiness-fixture.test",
    startedAt: new Date().toISOString(),
    status: "completed",
    events,
    screens: [{ screenKey: "inicio", url: "/inicio" } as any],
  } as unknown as SessionTrace;
}

type RecorderInternals = { onInteraction(raw: unknown): Promise<void> };

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://readiness-fixture.test",
    framesDir: path.join(os.tmpdir(), "structural-runtime-readiness-test-frames"),
    onEvent: (event) => events.push(event),
  }) as unknown as RecorderInternals;
  return { recorder, events };
}

function buildReadiness(events: RecordedEvent[]) {
  const scenario = buildHappyPathScenario(trace(events), events);
  const canonical = buildCanonicalInteractions(events);
  const enriched = enrichRecordedScenarioContract(scenario, canonical);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  return { canonical, enriched, readiness };
}

test("1/normalTarget. an action with a real recorded technical target: certified, unchanged behavior", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", label: "Usuario", role: "input", domId: "user", value: "qauser" });
  const { canonical, readiness } = buildReadiness(events);
  assert.equal(canonical[0].resolutionState, "certified");
  assert.equal(readiness.actions[0].runtimeResolutionRequired, undefined);
  assert.equal(readiness.executionReady, true);
  assert.equal(readiness.promotionReady, true);
});

test("2/structuralFill. no technical target + real associatedField + supported fill: execution may proceed", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", role: "textbox", associatedField: "Número de identificación", value: "1000000000" });
  const { canonical, readiness } = buildReadiness(events);
  assert.equal(canonical[0].admissionStatus, "accepted");
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required");
  assert.equal(readiness.actions[0].runtimeResolutionRequired, true);
  assert.equal(readiness.actions[0].ready, true);
  assert.equal(readiness.executionReady, true);
});

test("3/structuralClick. same for click when supported", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "click", role: "button", associatedField: "Depurar" });
  const { readiness } = buildReadiness(events);
  assert.equal(readiness.actions[0].runtimeResolutionRequired, true);
  assert.equal(readiness.executionReady, true);
});

test("4/structuralPress. same for press when supported", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", role: "textbox", domId: "password", label: "Contraseña", value: "secret" });
  await recorder.onInteraction({ kind: "press", key: "Enter", role: "textbox", associatedField: "Contraseña" });
  const { canonical, readiness } = buildReadiness(events);
  const pressInteraction = canonical.find((c) => c.action === "press")!;
  assert.equal(pressInteraction.resolutionState, "runtime_resolution_required");
  const pressAction = readiness.actions.find((a) => a.actionType === "press")!;
  assert.equal(pressAction.runtimeResolutionRequired, true);
  assert.equal(readiness.executionReady, true);
});

test("5/noRelation. no technical target and no structural relation at all: blocked", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "click", role: "button" });
  const { readiness } = buildReadiness(events);
  assert.equal(readiness.actions[0].runtimeResolutionRequired, undefined);
  assert.ok(readiness.actions[0].blockReasons.includes("missing_technical_target"));
  assert.equal(readiness.executionReady, false);
});

test("6/unsupported. a structural relation on an action type the live resolver does not support (select): blocked", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    role: "option",
    associatedField: "Tipo de cuenta",
    compoundRole: "selection",
    afterValue: "Ahorros",
  });
  const { canonical, readiness } = buildReadiness(events);
  const selectInteraction = canonical.find((c) => c.action === "select");
  if (selectInteraction) {
    assert.notEqual(selectInteraction.resolutionState, "runtime_resolution_required");
  }
  assert.equal(readiness.actions.some((a) => a.runtimeResolutionRequired && a.actionType === "select"), false);
});

test("7/rejected. a previously admission-rejected target (generic label, no evidence) stays blocked", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "click", role: "button", associatedField: "control" });
  const { canonical, readiness } = buildReadiness(events);
  assert.equal(canonical[0].admissionStatus, "unresolved");
  assert.equal(canonical[0].resolutionState, "unresolved_unrecoverable");
  assert.equal(readiness.actions[0].runtimeResolutionRequired, undefined);
  assert.equal(readiness.executionReady, false);
});

test("8/promotionBlocked. a runtime-eligible structural action keeps promotionReady false", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "click", role: "button", associatedField: "Depurar" });
  const { readiness } = buildReadiness(events);
  assert.equal(readiness.executionReady, true);
  assert.equal(readiness.promotionReady, false);
});

test("9/technicalCoverageHonest. technicalReady/technicalTargetCount are never falsely marked certified for a structurally-eligible action", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "click", role: "button", associatedField: "Depurar" });
  const { readiness } = buildReadiness(events);
  assert.equal(readiness.technicalReady, false, "technical coverage stays honestly incomplete");
  assert.equal(readiness.actions[0].technicalTargetCount, 0);
  assert.equal(readiness.actions[0].reResolutionPossible, false);
});

test("10/runtimeFailure (contract-level). a runtime-resolution-eligible action is never itself a certified target -- still not admitted", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "click", role: "button", associatedField: "Depurar" });
  const { canonical } = buildReadiness(events);
  // Certification of the live attempt's outcome belongs to the runtime (target-resolver.ts),
  // already covered by its own fail-closed tests -- this asserts the CONTRACT never pretends
  // otherwise: a runtime_resolution_required interaction never claims certified technical target
  // evidence of its own.
  assert.equal(canonical[0].technicalTargetRefs.length, 0);
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required");
});

test("11/priorityRegression. an interaction with prior locator-ambiguity evidence is never marked runtime-resolution-eligible", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    role: "button",
    associatedField: "Depurar",
    technicalTargetCandidates: [{
      locatorCandidates: [{ strategy: "css", value: "button", confidence: 0.3, ambiguous: true }],
    }],
  });
  const { canonical } = buildReadiness(events);
  assert.notEqual(canonical[0].resolutionState, "runtime_resolution_required");
});

test("12/generic. no app/project/value hardcode: mechanism generalizes to an arbitrary field/role pair", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", role: "textbox", associatedField: "Campo Totalmente Arbitrario", value: "cualquier valor" });
  const { canonical, readiness } = buildReadiness(events);
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required");
  assert.equal(readiness.executionReady, true);
});

// FIRST_LOSS (round 3): a grid cell can carry a real, stable `columnIdentity` (data-column/
// data-field/aria-colindex, see runtime-knowledge-extractor.ts) while `headerContext` never
// resolved (e.g. a virtualized header row scrolled out at capture time) and no `associatedField`
// was ever set either. The structural-runtime-eligibility field-name derivation only ever
// consulted associatedField/headerContext, so this real, non-generic evidence was silently
// discarded and the action fell through to `missing_technical_target`/blocked instead of
// `runtime_resolution_required`, even though the live field-scoped resolver has everything it
// needs (a real field identity + a known owner role + a supported action type).
test("13/gridColumnIdentityOnly. no associatedField/headerContext but a real columnIdentity: runtime-resolution-eligible, not blocked", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", role: "textbox", columnIdentity: "numero_de_identificacion", value: "1000000000" });
  const { canonical, readiness } = buildReadiness(events);
  // The admission gate itself (trace-normalizer.ts) still only ever admits on associatedField/
  // headerContext/label -- columnIdentity alone does not flip admissionStatus to "accepted". This
  // fix instead makes it count as `sufficientRuntimeEvidence` on the REJECTED-admission branch
  // (same existing carve-out `structuralFieldName` already feeds for that case), landing on the
  // SAME `resolutionState="runtime_resolution_required"` outcome either way.
  assert.equal(canonical[0].admissionStatus, "unresolved");
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required");
  assert.equal(readiness.actions[0].runtimeResolutionRequired, true);
  assert.equal(readiness.actions[0].ready, true);
  assert.equal(readiness.executionReady, true);
});

// A generic/placeholder-shaped columnIdentity must never be treated as real evidence either --
// same guard already applied to associatedField/headerContext.
test("14/gridGenericColumnIdentity. a generic columnIdentity value never counts as real evidence: stays blocked", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", role: "textbox", columnIdentity: "control", value: "x" });
  const { readiness } = buildReadiness(events);
  assert.equal(readiness.actions[0].runtimeResolutionRequired, undefined);
  assert.ok(readiness.actions[0].blockReasons.includes("missing_technical_target"));
});

test("15/scopedStructuralEvidence. unique scoped fingerprint permits runtime resolution without certification", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    role: "div",
    technicalTargetCandidates: [{
      targetType: "structural",
      locatorCandidates: [],
      structuralContext: {
        owner: { tag: "div" },
        stableDirectAttributes: { "data-role": "custom-control" },
        stableDescendants: [],
        semanticShape: [],
        deterministicStructuralIdentity: true,
        structuralIdentityMatchCount: 1,
        scopeIdentity: { strategy: "css", value: "#scope" },
        targetFingerprint: "opaque-structural-fingerprint",
        captureScopeUnique: true,
        captureTargetMatchCount: 1,
      },
      interactionEvidence: ["v2_click_owner"],
      confidence: 0.8,
      validatedByInteraction: true,
    }],
  });
  const { canonical, readiness } = buildReadiness(events);
  assert.equal(canonical[0].technicalTargetRefs.length, 0);
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required");
  assert.equal(readiness.actions[0].runtimeResolutionRequired, true);
  assert.equal(readiness.actions[0].ready, true);
  assert.equal(readiness.technicalReady, false);
  assert.equal(readiness.promotionReady, false);
});
