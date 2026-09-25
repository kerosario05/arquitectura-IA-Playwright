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
