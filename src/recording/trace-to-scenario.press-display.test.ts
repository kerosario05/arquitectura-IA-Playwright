import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

/**
 * FIRST_LOSS: `buildCanonicalInteractions`/`RecordingExecutionContract` have carried a captured
 * `press` action correctly since an earlier ticket (execution authority was never lost), but
 * `trace-to-scenario.ts`'s own event-iteration loop -- the one that turns `RecordedEvent[]` into
 * the human-facing `testRailSteps` QA Lab renders -- only ever branched on
 * `event.kind === "screen_change" | "tap" | "fill" | "navigate"`. A `press` event matched none of
 * those branches and fell through the entire loop body doing nothing: no functional step was
 * ever produced, even though the technical action was captured, canonicalized, and remained
 * fully executable. `classifySemanticEvent` had the same gap one layer down (defaulted press to
 * "TECHNICAL_NOISE" instead of "FUNCTIONAL_ACTION", undercounting it in the recording's own
 * fallback narrative).
 *
 * Fixed with a dedicated, DISPLAY-ONLY `event.kind === "press"` branch: it produces exactly one
 * new `testRailSteps` entry (`Presionar "<key>" en "<label>"`, reusing the same field-identity
 * resolution fill/tap already use) and creates NO web/mobile step -- the technical press keeps
 * being the sole execution authority via the untouched `RecordingExecutionContract` pipeline.
 */

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-1",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://display-fixture.test",
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
    baseUrl: "http://display-fixture.test",
    framesDir: path.join(os.tmpdir(), "press-display-test-frames"),
    onEvent: (event) => events.push(event),
  }) as unknown as RecorderInternals;
  return { recorder, events };
}

function scenarioFor(events: RecordedEvent[]) {
  return buildHappyPathScenario(trace(events), events);
}

test("1/enter. press Enter after a fill produces its own functional step, naming key and field", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", label: "Contraseña", role: "input", domId: "password", inputType: "password", value: "secret" });
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Contraseña", role: "textbox", domId: "password" });
  const scenario = scenarioFor(events);
  const pressStep = scenario.testRailSteps.find((step) => step.content.includes("Presionar"));
  assert.ok(pressStep, "press must produce its own functional step");
  assert.match(pressStep!.content, /Presionar "Enter" en/);
});

test("2/genericKey. press Tab produces a functional step naming Tab, no Enter hardcode", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "Tab", label: "Cualquier Campo", role: "textbox", domId: "cualquier-id" });
  const scenario = scenarioFor(events);
  const pressStep = scenario.testRailSteps.find((step) => step.content.includes("Presionar"));
  assert.ok(pressStep);
  assert.match(pressStep!.content, /Presionar "Tab" en/);
});

test("3/fillPress. fill + press produce TWO functional steps, never merged into one", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", label: "Usuario", role: "input", domId: "user", value: "qauser" });
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Usuario", role: "textbox", domId: "user" });
  const scenario = scenarioFor(events);
  // testRailSteps[0] is always the fixed "Abrir la aplicación..." setup row -- unrelated to press.
  assert.equal(scenario.testRailSteps.length, 3);
  assert.ok(scenario.testRailSteps[1].content.includes("Ingresar"));
  assert.ok(scenario.testRailSteps[2].content.includes("Presionar"));
});

test("4/order. fill, fill, press, fill, click -- exact display order preserved", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", label: "Usuario", role: "input", domId: "user", value: "qauser" });
  await recorder.onInteraction({ kind: "input", label: "Contraseña", role: "input", domId: "password", inputType: "password", value: "secret" });
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Contraseña", role: "textbox", domId: "password" });
  await recorder.onInteraction({ kind: "input", label: "Número de identificación", role: "input", domId: "docNumber", value: "1000000000" });
  await recorder.onInteraction({ kind: "click", label: "Depurar", role: "button", domId: "depurar-btn" });
  const scenario = scenarioFor(events);
  assert.equal(scenario.testRailSteps.length, 6);
  const actionSteps = scenario.testRailSteps.slice(1); // drop the fixed "Abrir la aplicación..." setup row
  const kinds = actionSteps.map((step) =>
    step.content.startsWith("Presionar \"Enter\"") ? "press" : step.content.startsWith("Ingresar") ? "fill" : "click",
  );
  assert.deepEqual(kinds, ["fill", "fill", "press", "fill", "click"]);
});

test("5/sensitive. press on a secure field never leaks the real value -- only the key and the field's functional name", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "input", label: "Contraseña", role: "input", domId: "password", inputType: "password", value: "s3cr3t-value" });
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Contraseña", role: "textbox", domId: "password" });
  const scenario = scenarioFor(events);
  const pressStep = scenario.testRailSteps.find((step) => step.content.includes("Presionar"));
  assert.ok(pressStep);
  assert.ok(!pressStep!.content.includes("s3cr3t-value"));
  assert.ok(!(pressStep!.renderedStep ?? "").includes("s3cr3t-value"));
  assert.equal(pressStep!.sensitive, true, "the field's own sensitivity is still recorded as metadata");
  assert.match(pressStep!.content, /Presionar "Enter" en/, "the functional field name is still shown");
});

test("6/key. an arbitrary captured key is preserved verbatim, never normalized to a hardcoded one", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "F2", label: "Cualquier Campo", role: "textbox", domId: "cualquier-id" });
  const scenario = scenarioFor(events);
  const pressStep = scenario.testRailSteps.find((step) => step.content.includes("Presionar"));
  assert.match(pressStep!.content, /Presionar "F2" en/);
});

test("7/executionAuthority. display projection never affects the technical canonical interaction -- still the sole execution authority", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Contraseña", role: "textbox", domId: "password" });
  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].action, "press");
  assert.equal(canonical[0].key, "Enter");
  assert.equal(canonical[0].technicalOnly, undefined, "a genuine technical press is not display-suppressed");
});

test("8/noSyntheticClick. a display press step never creates a web/mobile executable step -- it stays display-only", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Contraseña", role: "textbox", domId: "password" });
  const scenario = scenarioFor(events);
  // The one web step present is the fixed "navigate to baseUrl" setup step every scenario gets --
  // never a step created for the press itself.
  assert.equal(scenario.webSteps.length, 1);
  assert.equal(scenario.webSteps[0].action, "navigate");
  assert.equal(scenario.testRailSteps.length, 2);
});

test("9/noClickConversion. the functional step for a press is never phrased or classified as a click", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "Enter", label: "Depurar", role: "button", domId: "depurar-btn" });
  const scenario = scenarioFor(events);
  const step = scenario.testRailSteps.find((s) => s.content.includes("Presionar"));
  assert.ok(step);
  assert.match(step!.content, /^Presionar "Enter"/);
  assert.ok(!/^Marcar|^Desmarcar/.test(step!.content));
});

test("10/unnamed. a press with no resolvable field name uses the SAME existing human fallback fill/tap already get, never a raw id", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "Enter" });
  const scenario = scenarioFor(events);
  const pressStep = scenario.testRailSteps.find((step) => step.content.includes("Presionar"));
  assert.ok(pressStep);
  assert.match(pressStep!.content, /Presionar "Enter" en "Campo pendiente de identificar"/);
});

test("12/generic. no app/project/value hardcode: mechanism generalizes to an arbitrary field/key pair", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "press", key: "Escape", label: "Campo Totalmente Arbitrario", role: "textbox", domId: "arbitrary-id-123" });
  const scenario = scenarioFor(events);
  const pressStep = scenario.testRailSteps.find((step) => step.content.includes("Presionar"));
  assert.match(pressStep!.content, /Presionar "Escape" en "Campo Totalmente Arbitrario"/);
});
