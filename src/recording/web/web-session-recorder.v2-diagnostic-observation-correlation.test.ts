import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web-session-recorder";
import { buildCanonicalInteractions } from "../canonical-recording-contract";
import type { CaptureAction } from "../capture-engine-v2.types";
import type { ShadowActionRecord } from "../capture-engine-v2.shadow-bridge";
import type { RecordedEvent } from "../session-trace.types";

/**
 * FIRST_LOSS (recordingId=711ce68f-7ec9-4b2e-befc-bab14d22ff4e): the legacy CAPTURE_SCRIPT's own
 * MutationObserver (always installed via addInitScript, regardless of captureAuthority) DOES
 * produce `post_action`/mutation observations, but the `__qaRecord` binding discarded them
 * wholesale whenever `captureAuthority !== "legacy"` -- and the legacy payload carried no
 * `interactionId` to correlate it to a V2 action even if the gate were relaxed.
 *
 * Fixed by: (1) exposing V2's OWN browser-side `pendingPointerInteractionId` (already the sole
 * identity V2's pointer/click messages carry) via `window.__qaRecorderV2ActiveInteractionId`,
 * read synchronously by the legacy script's `schedulePostAction` at the SAME tick as the
 * triggering click (never a timer/threshold); (2) a narrow diagnostic-only exception in the
 * `__qaRecord` binding gate for `kind:"observation", observationType:"post_action"` payloads
 * carrying an explicit `interactionId`; (3) `onV2DiagnosticObservation`, which resolves that id
 * against `v2InteractionIdToEventTargetRef` (populated in `onV2TechnicalAction` from each V2
 * action's own `sourceRefs.eventTargetRef` -- never a timestamp/order guess) and only then calls
 * `onInteraction` with a `note`/`post_action` shape identical to what V2's own pointer
 * observations already produce -- never a click/fill/press/navigate.
 *
 * These tests exercise the REAL, private `onV2TechnicalAction`/`onV2DiagnosticObservation`
 * methods directly (same pattern as web-session-recorder.authority-switch.test.ts), never a
 * re-implementation. The browser-side getter/synchronous-read cannot be exercised without a real
 * browser -- see web-session-recorder.v2-shadow-integration.test.ts's own precedent for verifying
 * structural wiring via source text where a browser is unavailable.
 */

const SOURCE = fs.readFileSync(path.join(__dirname, "web-session-recorder.ts"), "utf8");

type RecorderInternals = {
  onInteraction(raw: unknown): Promise<void>;
  onV2TechnicalAction(record: ShadowActionRecord): void;
  onV2DiagnosticObservation(payload: Record<string, unknown>): void;
  stop(): Promise<{ events: RecordedEvent[]; screens: unknown[] }>;
  v2IngestionQueue: Promise<void>;
};

function newRecorder(captureAuthority?: "legacy" | "v2") {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://correlation-fixture.test",
    framesDir: path.join(os.tmpdir(), "v2-diagnostic-observation-test-frames"),
    captureAuthority,
    onEvent: (event) => events.push(event),
  });
  return { recorder: recorder as unknown as RecorderInternals, events };
}

let seqCounter = 0;
function technicalRecord(action: CaptureAction): ShadowActionRecord {
  seqCounter += 1;
  return { seq: seqCounter, action };
}

function digitClick(label: string, correlationId: string): CaptureAction {
  return {
    actionType: "click",
    interactionId: correlationId,
    identity: { label, tagName: "button", role: "button" },
    owner: { tag: "button", role: "button" },
    sourceRefs: { eventTargetRef: `role:button|${label}` },
  };
}

function diagnosticObservation(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: "observation",
    observationType: "post_action",
    label: "control",
    role: "button",
    tagName: "button",
    dynamicLifecycle: {},
    ...overrides,
  };
}

test("1/v2ActionAuthority. the binding gate's diagnostic exception is scoped EXACTLY to kind=observation/observationType=post_action with an explicit interactionId -- every other legacy shape still falls through to the unchanged discard branch", () => {
  const gate = SOURCE.match(/if \(this\.captureAuthority !== "legacy"\) \{([\s\S]{0,1400}?)this\.log\(`\[recording\] legacy event ignored/);
  assert.ok(gate, "the single-authority gate must still exist, unmodified in shape");
  const body = gate![1];
  assert.match(body, /payload\.kind === "observation"/);
  assert.match(body, /payload\.observationType === "post_action"/);
  assert.match(body, /typeof payload\.interactionId === "string"/);
  assert.match(body, /this\.onV2DiagnosticObservation\(payload\)/);
  assert.doesNotMatch(body, /this\.onInteraction\(payload\)/, "the diagnostic branch must never call onInteraction directly with the raw legacy payload");
});

test("2/v2DiagnosticObservation. a post_action observation with a valid, already-known V2 correlation id is accepted onto the trace as a note/post_action event", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(digitClick("4", "pointer-1")));
  await recorder.v2IngestionQueue;
  assert.equal(events.length, 1);

  recorder.onV2DiagnosticObservation(diagnosticObservation({
    interactionId: "pointer-1",
    dynamicLifecycle: { relatedStateOwnerIdentity: "span|id=balance", relatedStateContainerIdentity: "div|role=region", relatedStateMutations: [{ nodeIdentity: "span|id=balance", kind: "characterData" }] },
  }));
  await recorder.v2IngestionQueue;

  assert.equal(events.length, 2, "the diagnostic observation must reach the trace");
  const note = events[1];
  assert.equal(note.kind, "note");
  assert.equal(note.observationType, "post_action");
  assert.equal(note.interactionId, "pointer-1");
});

test("3/noCorrelation. a post_action observation with no known matching V2 action is dropped -- fail closed, never guessed", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(digitClick("4", "pointer-1")));
  await recorder.v2IngestionQueue;
  assert.equal(events.length, 1);

  recorder.onV2DiagnosticObservation(diagnosticObservation({ interactionId: "pointer-999-never-seen" }));
  await recorder.v2IngestionQueue;

  assert.equal(events.length, 1, "an unresolvable correlation id must never be attached to any action");
});

test("4/sameInteraction. pointer/tap V2 action and its post_action observation sharing the same correlation id join to the SAME canonical interaction's relatedStateSurfaceEvidence", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(digitClick("4", "pointer-1")));
  await recorder.v2IngestionQueue;

  recorder.onV2DiagnosticObservation(diagnosticObservation({
    interactionId: "pointer-1",
    dynamicLifecycle: { relatedStateOwnerIdentity: "button|id=digit-4", relatedStateContainerIdentity: "div|role=region", relatedStateMutations: [{ nodeIdentity: "span|id=display", kind: "characterData" }] },
  }));
  await recorder.v2IngestionQueue;

  const canonical = buildCanonicalInteractions(events);
  const click = canonical.find((c) => c.action === "click");
  assert.ok(click, "the click must still produce its own canonical interaction");
  assert.ok(click!.relatedStateSurfaceEvidence, "relatedStateSurfaceEvidence must be derivable end to end once structural evidence is valid");
  assert.equal(click!.relatedStateSurfaceEvidence?.sourceInteractionId, click!.id);
});

test("5/differentInteraction. an observation correlated to X never attaches to a DIFFERENT action Y", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(digitClick("4", "pointer-1")));
  recorder.onV2TechnicalAction(technicalRecord(digitClick("0", "pointer-2")));
  await recorder.v2IngestionQueue;

  recorder.onV2DiagnosticObservation(diagnosticObservation({
    interactionId: "pointer-1",
    dynamicLifecycle: { relatedStateOwnerIdentity: "button|id=digit-4", relatedStateMutations: [{ nodeIdentity: "span|id=display", kind: "characterData" }] },
  }));
  await recorder.v2IngestionQueue;

  const canonical = buildCanonicalInteractions(events);
  const clicks = canonical.filter((c) => c.action === "click");
  assert.equal(clicks.length, 2);
  const [clickFour, clickZero] = clicks;
  assert.ok(clickFour.relatedStateSurfaceEvidence, "the interaction the observation actually correlates to gets the evidence");
  assert.equal(clickZero.relatedStateSurfaceEvidence, undefined, "an unrelated action must never receive another action's evidence");
});

test("6/lateObservation. a correlation id, once assigned to interaction A, is never reused for a later interaction B -- the map is keyed by V2's own unique id, never overwritten across distinct interactions", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(digitClick("4", "pointer-1")));
  recorder.onV2TechnicalAction(technicalRecord(digitClick("0", "pointer-2")));
  await recorder.v2IngestionQueue;

  // A "late" observation still carries interaction A's own id -- it must resolve to A, never B,
  // regardless of how much later it arrives (no timestamp/order involved in the lookup itself).
  recorder.onV2DiagnosticObservation(diagnosticObservation({
    interactionId: "pointer-1",
    dynamicLifecycle: { relatedStateOwnerIdentity: "button|id=digit-4", relatedStateMutations: [{ nodeIdentity: "span|id=display", kind: "characterData" }] },
  }));
  await recorder.v2IngestionQueue;

  const canonical = buildCanonicalInteractions(events);
  const [clickFour, clickZero] = canonical.filter((c) => c.action === "click");
  assert.ok(clickFour.relatedStateSurfaceEvidence);
  assert.equal(clickZero.relatedStateSurfaceEvidence, undefined);
});

test("7/redaction. no raw text/value ever reaches the persisted note event -- only redacted identity/kind metadata", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(digitClick("4", "pointer-1")));
  await recorder.v2IngestionQueue;

  recorder.onV2DiagnosticObservation(diagnosticObservation({
    interactionId: "pointer-1",
    // A hostile/careless caller including raw text/value fields on the legacy payload must never
    // have them forwarded -- onV2DiagnosticObservation only ever reads dynamicLifecycle.relatedState*.
    beforeState: { value: "4123 5678 9012 3456" },
    afterState: { value: "4123 5678 9012 3456 4" },
    value: "4123 5678 9012 3456 4",
    dynamicLifecycle: { relatedStateOwnerIdentity: "button|id=digit-4", relatedStateContainerIdentity: "div|role=region", relatedStateMutations: [{ nodeIdentity: "span|id=display", kind: "characterData" }] },
  }));
  await recorder.v2IngestionQueue;

  const note = events[1];
  assert.equal(note.value, undefined, "no raw value ever reaches the note event");
  assert.equal((note.target as { beforeState?: unknown })?.beforeState, undefined);
  assert.equal((note.target as { afterState?: unknown })?.afterState, undefined);
});

test("8/characterData. characterData mutation kind survives with only redacted identity, never text content", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(digitClick("4", "pointer-1")));
  await recorder.v2IngestionQueue;

  recorder.onV2DiagnosticObservation(diagnosticObservation({
    interactionId: "pointer-1",
    dynamicLifecycle: { relatedStateOwnerIdentity: "button|id=digit-4", relatedStateMutations: [{ nodeIdentity: "span|id=display", kind: "characterData" }] },
  }));
  await recorder.v2IngestionQueue;

  const lifecycle = events[1].target?.dynamicLifecycle as { relatedStateMutations?: Array<{ nodeIdentity?: string; kind?: string }> } | undefined;
  assert.equal(lifecycle?.relatedStateMutations?.[0]?.kind, "characterData");
  assert.equal(lifecycle?.relatedStateMutations?.[0]?.nodeIdentity, "span|id=display");
  assert.ok(!("textContent" in (lifecycle?.relatedStateMutations?.[0] ?? {})), "no raw text content field is ever carried");
});

test("9/traceRoundTrip. the persisted event stream contains both the V2 action and its correlated diagnostic observation", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(digitClick("4", "pointer-1")));
  await recorder.v2IngestionQueue;
  recorder.onV2DiagnosticObservation(diagnosticObservation({
    interactionId: "pointer-1",
    dynamicLifecycle: { relatedStateOwnerIdentity: "button|id=digit-4", relatedStateMutations: [{ nodeIdentity: "span|id=display", kind: "characterData" }] },
  }));
  const result = await recorder.stop();

  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map((e) => e.kind), ["tap", "note"]);
  assert.equal(result.events[1].interactionId, "pointer-1");
});

test("10/canonicalRoundTrip. trace -> canonical projection derives relatedStateSurfaceEvidence when structural evidence is valid", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(digitClick("4", "pointer-1")));
  await recorder.v2IngestionQueue;
  recorder.onV2DiagnosticObservation(diagnosticObservation({
    interactionId: "pointer-1",
    dynamicLifecycle: { relatedStateOwnerIdentity: "button|id=digit-4", relatedStateContainerIdentity: "div|role=region", relatedStateMutations: [{ nodeIdentity: "span|id=display", kind: "characterData" }] },
  }));
  await recorder.v2IngestionQueue;

  const canonical = buildCanonicalInteractions(events);
  const click = canonical.find((c) => c.action === "click");
  assert.ok(click?.relatedStateSurfaceEvidence);
  assert.equal(click!.relatedStateSurfaceEvidence?.relationKind, "local_container");
});

test("11/legacyMode. captureAuthority=legacy: onV2DiagnosticObservation is a no-op (V2 diagnostic channel is v2-only)", async () => {
  const { recorder, events } = newRecorder("legacy");
  recorder.onV2DiagnosticObservation(diagnosticObservation({ interactionId: "pointer-1" }));
  await recorder.v2IngestionQueue;
  assert.equal(events.length, 0);
});

test("12/v2NoMutation. a normal V2 recording with no diagnostic observation is completely unaffected", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(digitClick("4", "pointer-1")));
  await recorder.v2IngestionQueue;

  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].relatedStateSurfaceEvidence, undefined);
});

test("13/actionCountUnchanged. adding a diagnostic observation never creates an extra functional/executable canonical action", async () => {
  const { recorder, events } = newRecorder("v2");
  recorder.onV2TechnicalAction(technicalRecord(digitClick("4", "pointer-1")));
  await recorder.v2IngestionQueue;
  const canonicalBefore = buildCanonicalInteractions(events);

  recorder.onV2DiagnosticObservation(diagnosticObservation({
    interactionId: "pointer-1",
    dynamicLifecycle: { relatedStateOwnerIdentity: "button|id=digit-4", relatedStateMutations: [{ nodeIdentity: "span|id=display", kind: "characterData" }] },
  }));
  await recorder.v2IngestionQueue;
  const canonicalAfter = buildCanonicalInteractions(events);

  assert.equal(canonicalBefore.length, 1);
  assert.equal(canonicalAfter.length, 1, "the note/post_action event must never itself become a second canonical action");
});

test("14/noTemporalCorrelation. the correlation lookup is a pure identity-map read -- no ms threshold/timeout constant was introduced into it", () => {
  const method = SOURCE.match(/private onV2DiagnosticObservation\(payload: RawInteraction\): void \{([\s\S]*?)\n  \}/);
  assert.ok(method);
  assert.doesNotMatch(method![1], /setTimeout|Date\.now\(\)|performance\.now\(\)|\bt\s*[-+]/, "correlation resolution must never depend on timing");
});

test("15/postActionDiagnosticStages. browser wiring exposes only redacted post_action lifecycle stages", () => {
  assert.match(SOURCE, /postActionDiagnostic\('post_action_getter_read'/);
  assert.match(SOURCE, /postActionDiagnostic\('post_action_scheduled'/);
  assert.match(SOURCE, /postActionDiagnostic\('post_action_fired'/);
  assert.match(SOURCE, /postActionDiagnostic\('post_action_send'/);
  assert.match(SOURCE, /getterReturnedIdPresent/);
  assert.match(SOURCE, /capturedInteractionIdPresent/);
  assert.match(SOURCE, /mutationCount/);
  const browserSource = fs.readFileSync(path.join(__dirname, "capture-engine-v2.browser-instrumentation.ts"), "utf8");
  assert.match(browserSource, /interactionIdCreated: Boolean\(interactionId\)/);
  assert.match(browserSource, /interactionIdPresent: Boolean\(interactionId\)/);
  assert.doesNotMatch(SOURCE.match(/postActionDiagnostic\('post_action_fired',[\s\S]*?\);/)?.[0] ?? "", /value|label|text|password|username|rawValue|inputValue/);
});

test("16/postActionDiagnosticBridge. binding and trace append phases are observable without changing the fail-closed gate", () => {
  assert.match(SOURCE, /phase=binding_received/);
  assert.match(SOURCE, /postActionShapeAccepted=true/);
  assert.match(SOURCE, /postActionShapeAccepted=false/);
  assert.match(SOURCE, /phase=trace_append/);
  assert.match(SOURCE, /rejectReason=unknown_interaction_id/);
});
