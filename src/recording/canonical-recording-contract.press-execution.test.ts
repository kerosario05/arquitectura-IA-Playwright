import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { buildCanonicalInteractions, enrichRecordedScenarioContract, evaluateRecordedScenarioExecutionReadiness, toSharedMcpScenario } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

/**
 * FIRST_LOSS: `buildCanonicalInteractions`'s main loop only ever admitted `event.kind ===
 * "tap" | "fill"` -- every `RecordedEvent{kind:"press"}` (already correctly captured, key and
 * all, by CaptureEngine V2 -- confirmed by the untouched keyboard-press ticket's own tests) hit
 * the generic `continue` and vanished before ever becoming a `CanonicalInteraction`. Everything
 * downstream (`enrichRecordedScenarioContract`, `toSharedMcpScenario`,
 * `RecordingExecutionContract.actions`) only ever sees canonical interactions, so a press's
 * intent was lost long before any execution/runtime code ever ran -- never converted to a click,
 * simply invisible.
 *
 * Fixed by admitting `event.kind === "press"` into the same loop, giving it its own
 * `action: "press"` (a new `CanonicalInteractionAction`), carrying the captured key as a new,
 * dedicated `key` field (never conflated with `recordedValue`, which stays a dataset-bound fill
 * value) all the way through to `RecordingExecutionAction.key`. A press with no captured key
 * fails admission (`admissionReason: "missing_press_key"`) exactly like every other
 * identity/precondition gap this pipeline already fails closed on.
 */

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-1",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://contract-fixture.test",
    startedAt: new Date().toISOString(),
    status: "completed",
    events,
    screens: [{ screenKey: "inicio", url: "/inicio" } as any],
  } as unknown as SessionTrace;
}

function buildContract(events: RecordedEvent[]) {
  const scenario = buildHappyPathScenario(trace(events), events);
  const canonical = buildCanonicalInteractions(events);
  const enriched = enrichRecordedScenarioContract(scenario, canonical);
  const contract = toSharedMcpScenario(enriched, "app");
  return { enriched, contract, canonical };
}

type RecorderInternals = { onInteraction(raw: unknown): Promise<void> };

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://contract-fixture.test",
    framesDir: path.join(os.tmpdir(), "press-execution-test-frames"),
    onEvent: (event) => events.push(event),
  }) as unknown as RecorderInternals;
  return { recorder, events };
}

test("1/2/3. RecordedEvent(kind=\"press\") becomes its own canonical press interaction, key and target refs preserved", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Contraseña", role: "textbox", domId: "password" });
  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].action, "press");
  assert.equal(canonical[0].key, "Enter");
  assert.ok(canonical[0].technicalTargetRefs.some((ref) => ref.includes("password")));
});

test("4. fill Usuario, fill Contraseña, press Enter -- exact order preserved end to end", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", label: "Usuario", role: "input", domId: "user", value: "qauser" });
  await recorder.onInteraction({ kind: "input", label: "Contraseña", role: "input", domId: "password", inputType: "password", value: "secret" });
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Contraseña", role: "textbox", domId: "password" });

  const canonical = buildCanonicalInteractions(events);
  assert.deepEqual(canonical.map((c) => c.action), ["fill", "fill", "press"]);
  assert.equal(canonical[2].key, "Enter");

  const { contract } = buildContract(events);
  const actions = contract.recordingExecutionContract?.actions ?? [];
  assert.deepEqual(actions.map((a) => a.actionType), ["fill", "fill", "press"]);
});

test("5. fill NúmeroIdentificación, press Enter, click Depurar -- exact order preserved", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", label: "Número de identificación", role: "input", domId: "docNumber", value: "1000000000" });
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Número de identificación", role: "textbox", domId: "docNumber" });
  await recorder.onInteraction({ kind: "click", label: "Depurar", role: "button", domId: "depurar-btn" });

  const canonical = buildCanonicalInteractions(events);
  assert.deepEqual(canonical.map((c) => c.action), ["fill", "press", "click"]);
});

test("6/7. canonical press reaches RecordingExecutionContract.actions with its key preserved", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Contraseña", role: "textbox", domId: "password" });
  const { contract } = buildContract(events);
  const actions = contract.recordingExecutionContract?.actions ?? [];
  assert.equal(actions.length, 1);
  assert.equal(actions[0].actionType, "press");
  assert.equal(actions[0].key, "Enter");
  // A real accessible name ("Contraseña") ranks its role locator first (established precedent:
  // a genuine role+name locator outranks an id-derived one) -- the id-based ref still survives
  // in the full technicalTargetRefs list, never lost.
  assert.ok(actions[0].technicalTargetRefs?.some((ref) => ref.includes("password")));
});

test("10. press is never converted to a click anywhere in the pipeline", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Contraseña", role: "textbox", domId: "password" });
  const canonical = buildCanonicalInteractions(events);
  const { contract } = buildContract(events);
  assert.ok(canonical.every((c) => c.action !== "click"));
  assert.ok((contract.recordingExecutionContract?.actions ?? []).every((a) => a.actionType !== "click"));
});

test("13. press is never silently skipped -- always produces a canonical interaction, never dropped", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", label: "Usuario", role: "input", domId: "user", value: "qauser" });
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Usuario", role: "textbox", domId: "user" });
  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 2, "the press must produce its own interaction, never vanish");
});

test("10/11. a required press with no valid key fails closed -- never reaches RecordingExecutionContract, and blocks executionReady", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "", label: "Contraseña", role: "textbox", domId: "password" });
  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical[0].admissionStatus, "unresolved");
  assert.equal(canonical[0].admissionReason, "missing_press_key");
  assert.equal(canonical[0].key, undefined);

  const { enriched, contract } = buildContract(events);
  // Same architecture as every other admission-rejected interaction in this pipeline (an
  // unresolved combobox/option, a generic-label click, ...): it stays IN the contract/readiness
  // audit -- fail-closed means "flagged and blocking", never "silently removed".
  const actions = contract.recordingExecutionContract?.actions ?? [];
  assert.equal(actions.length, 1);
  assert.equal(actions[0].key, undefined, "no key ever materializes for an admission-rejected press");
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  assert.equal(readiness.executionReady, false);
});

test("11. an unresolved press target (no technical id/name at all) fails closed -- executionReady=false", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "Enter" });
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  assert.equal(readiness.executionReady, false);
});

test("14. existing fill/click interactions are completely unaffected by press support", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", label: "Usuario", role: "input", domId: "user", value: "qauser" });
  await recorder.onInteraction({ kind: "click", label: "Aceptar", role: "button", domId: "aceptar-btn" });
  const canonical = buildCanonicalInteractions(events);
  assert.deepEqual(canonical.map((c) => c.action), ["fill", "click"]);
  assert.equal(canonical[0].key, undefined);
  assert.equal(canonical[1].key, undefined);
});

test("16. no app/project/value hardcode: the mechanism generalizes to an arbitrary key/target pair", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "Escape", label: "Cualquier Campo", role: "textbox", domId: "cualquier-id" });
  const { contract } = buildContract(events);
  const actions = contract.recordingExecutionContract?.actions ?? [];
  assert.equal(actions[0].key, "Escape");
  assert.ok(actions[0].technicalTargetRefs?.some((ref) => ref.includes("cualquier-id")));
});
