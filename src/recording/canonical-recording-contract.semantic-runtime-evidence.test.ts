import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { buildCanonicalInteractions, enrichRecordedScenarioContract, evaluateRecordedScenarioExecutionReadiness } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";
import type { SemanticRuntimeEvidence } from "./structural-owner-identity";

/**
 * DEFINITIVE FIX (recordingId=e224287e-...): the SAME `resolutionState="runtime_resolution_required"`
 * state `structuralRuntimeEligible` already feeds (see `canonical-recording-contract.structural-
 * runtime-readiness.test.ts`) now also accepts `semanticRuntimeEligible` -- an ORIGINAL clicked
 * target with NO owner/structural/related-control evidence at all, but a captured
 * `SemanticRuntimeEvidence` (dynamic accessible name/visible text, proven unique within a stable
 * scope at capture). `executionReady` can become true from it alone; `technicalReady`/
 * `promotionReady` stay honestly false, exactly like the structural path.
 */

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-1",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://semantic-runtime-fixture.test",
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
    baseUrl: "http://semantic-runtime-fixture.test",
    framesDir: path.join(os.tmpdir(), "semantic-runtime-readiness-test-frames"),
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

function validSemanticRuntimeEvidence(): SemanticRuntimeEvidence {
  return {
    source: "visible_text",
    normalizedValue: "SMS",
    targetTag: "div",
    scopeAlternatives: [{ scopeIdentity: { strategy: "id", value: "stable-scope" }, captureMatchCount: 1 }],
    captureUniqueTarget: true,
  };
}

/**
 * Physical-shaped regression (recordingId=e224287e-...): a generic div click, 3 structurally
 * indistinguishable divs, structural runtime evidence and related-control both absent/rejected,
 * but the ORIGINAL clicked target's own semantic value is captured unique within a stable scope.
 */
test("12/13/14/15/16/17/integration. a generic unresolved click with a captured SemanticRuntimeEvidence becomes runtime_resolution_required and execution-ready, while technicalReady/promotionReady stay honestly false", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    role: "button",
    associatedField: "control", // generic -- admission-rejected, same shape as test 7/rejected
    semanticRuntimeEvidence: validSemanticRuntimeEvidence(),
  } as any);
  const { canonical, readiness } = buildReadiness(events);
  assert.equal(canonical[0].admissionStatus, "unresolved");
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required", "semanticRuntimeEligible must feed the SAME existing runtime_resolution_required state");
  assert.deepEqual(canonical[0].semanticRuntimeEvidence, validSemanticRuntimeEvidence(), "the captured evidence transports raw -> canonical unchanged");
  assert.equal(readiness.actions[0].runtimeResolutionRequired, true);
  assert.equal(readiness.actions[0].ready, true);
  assert.equal(readiness.executionReady, true);
  assert.equal(readiness.technicalReady, false, "technicalReady must never be raised by semantic runtime evidence alone");
  assert.equal(readiness.promotionReady, false, "promotionReady must never be raised by semantic runtime evidence alone");
});

test("negative control: the EXACT same generic-label click WITHOUT SemanticRuntimeEvidence stays blocked (existing test 7/rejected shape, unaffected)", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "click", role: "button", associatedField: "control" });
  const { canonical, readiness } = buildReadiness(events);
  assert.equal(canonical[0].resolutionState, "unresolved_unrecoverable");
  assert.equal(readiness.actions[0].runtimeResolutionRequired, undefined);
  assert.equal(readiness.executionReady, false);
});

test("an EMPTY scopeAlternatives (capture never actually found a valid scope) never becomes eligible, even if captureUniqueTarget claims true", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    role: "button",
    associatedField: "control",
    semanticRuntimeEvidence: { ...validSemanticRuntimeEvidence(), scopeAlternatives: [] },
  } as any);
  const { canonical } = buildReadiness(events);
  assert.equal(canonical[0].resolutionState, "unresolved_unrecoverable");
});

test("captureUniqueTarget=false is never treated as eligible", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    role: "button",
    associatedField: "control",
    semanticRuntimeEvidence: { ...validSemanticRuntimeEvidence(), captureUniqueTarget: false as any },
  } as any);
  const { canonical } = buildReadiness(events);
  assert.equal(canonical[0].resolutionState, "unresolved_unrecoverable");
});

/**
 * GATE #3 fix: a click whose own technicalTargetCandidates are ambiguous (the owner has no
 * strong/deterministic identity of its own -- exactly why gate #3's clickScopeElement fallback
 * exists) must still become eligible when its semanticRuntimeEvidence.clickScopeElement is true.
 * That evidence already independently proves its own uniqueness (scope + innermost-match), so the
 * owner's unrelated ambiguous locator must never veto it.
 */
test("GATE #3: clickScopeElement=true stays eligible even when the owner's own technicalTargetCandidates are ambiguous", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    role: "button",
    associatedField: "control",
    semanticRuntimeEvidence: { ...validSemanticRuntimeEvidence(), clickScopeElement: true },
    technicalTargetCandidates: [{
      targetType: "structural",
      interactionEvidence: [],
      locatorCandidates: [{ strategy: "css", value: ".owner", confidence: 0.3, ambiguous: true }],
    }],
  } as any);
  const { canonical, readiness } = buildReadiness(events);
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required", "clickScopeElement evidence must survive an ambiguous owner locator");
  assert.equal(readiness.executionReady, true);
});

test("negative control: the SAME ambiguous owner locator, WITHOUT clickScopeElement, is still rejected (existing behavior unaffected)", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    role: "button",
    associatedField: "control",
    semanticRuntimeEvidence: validSemanticRuntimeEvidence(),
    technicalTargetCandidates: [{
      targetType: "structural",
      interactionEvidence: [],
      locatorCandidates: [{ strategy: "css", value: ".owner", confidence: 0.3, ambiguous: true }],
    }],
  } as any);
  const { canonical } = buildReadiness(events);
  assert.equal(canonical[0].resolutionState, "unresolved_unrecoverable", "a non-clickScopeElement evidence must still be vetoed by an ambiguous owner locator, unchanged");
});

/**
 * GATE #3, ACCEPTED-ADMISSION branch (distinct from the two tests above, which both use a
 * generic associatedField and so exercise the `admissionRejected` path): a REAL, non-generic
 * associatedField (e.g. a product card title resolved by the field-scoped structural walk) makes
 * admission ACCEPTED, routing eligibility through `structuralRuntimeEligible` instead of
 * `sufficientRuntimeEvidence`. `structuralRuntimeEligible`'s own `priorAmbiguityEvidence` gate
 * lacked the same clickScopeElement exception already applied to `semanticRuntimeEligible`, so an
 * accepted-admission clickScopeElement action with an ambiguous owner locator fell through to
 * "certified" with no technicalTargetRefs and no semanticRuntimeEvidence transported at all --
 * exactly the fresh-run shape (interaction-15, Visa Clásica card) this fixes.
 */
test("GATE #3, accepted admission: clickScopeElement=true stays eligible even when the owner's own technicalTargetCandidates are ambiguous and associatedField is real (non-generic)", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    role: "button",
    associatedField: "Tarjeta Crédito Visa Clásica",
    semanticRuntimeEvidence: { ...validSemanticRuntimeEvidence(), clickScopeElement: true },
    technicalTargetCandidates: [{
      targetType: "structural",
      interactionEvidence: [],
      locatorCandidates: [{ strategy: "css", value: ".owner", confidence: 0.3, ambiguous: true }],
    }],
  } as any);
  const { canonical, readiness } = buildReadiness(events);
  assert.equal(canonical[0].admissionStatus, "accepted", "a real associatedField must be accepted, not rejected");
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required", "clickScopeElement evidence must survive an ambiguous owner locator on the accepted-admission path too");
  assert.deepEqual(canonical[0].semanticRuntimeEvidence, { ...validSemanticRuntimeEvidence(), clickScopeElement: true }, "semanticRuntimeEvidence must be transported, not silently dropped");
  assert.equal(readiness.executionReady, true);
});

test("negative control: the SAME accepted-admission ambiguous owner locator, WITHOUT clickScopeElement, is still rejected (existing behavior unaffected)", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({
    kind: "click",
    role: "button",
    associatedField: "Tarjeta Crédito Visa Clásica",
    semanticRuntimeEvidence: validSemanticRuntimeEvidence(),
    technicalTargetCandidates: [{
      targetType: "structural",
      interactionEvidence: [],
      locatorCandidates: [{ strategy: "css", value: ".owner", confidence: 0.3, ambiguous: true }],
    }],
  } as any);
  const { canonical } = buildReadiness(events);
  assert.equal(canonical[0].admissionStatus, "accepted");
  assert.equal(canonical[0].resolutionState, "certified", "without clickScopeElement, an accepted-admission action with an ambiguous owner locator stays certified with no semanticRuntimeEvidence transported (existing behavior unaffected)");
  assert.equal(canonical[0].semanticRuntimeEvidence, undefined);
});
