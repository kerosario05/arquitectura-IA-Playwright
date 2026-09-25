import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CaptureEngineV2ShadowBridge } from "./capture-engine-v2.shadow-bridge";
import { adaptCaptureActionToRawInteraction } from "./capture-engine-v2.raw-interaction-adapter";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import { WebSessionRecorder } from "./web/web-session-recorder";
import type { CaptureOwnerCandidate } from "./capture-engine-v2.types";
import type { RecordedEvent } from "./session-trace.types";

/**
 * Physical evidence: the user was focused on the identification input and pressed Enter. Capture
 * V2 only ever saw the derived effect -- a synthetic click on a button -- and recorded THAT as
 * the technical authority (`seq=8 edit`, `seq=9 click`), losing the real keyboard intent
 * entirely. `actionType: "press"` (a new, TECHNICAL, Playwright-like action, never
 * `CaptureFunctionalAction`) now represents the key on its own owner, and the bridge correlates
 * the browser's own `MouseEvent.detail === 0` signal (never a timing heuristic) to recognize the
 * click that immediately follows as that key's synthetic side effect, without ever suppressing a
 * genuine, independent mouse click.
 */

const doc = { captureInstanceId: "instance-1", documentId: "doc-A" };

function candidate(overrides: Partial<CaptureOwnerCandidate> & Pick<CaptureOwnerCandidate, "tag" | "pathDepth">): CaptureOwnerCandidate {
  return { editable: false, actionable: false, ...overrides };
}

function focusInput(bridge: CaptureEngineV2ShadowBridge, sessionId: string, accessibleName: string) {
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId,
    composedPath: [candidate({ tag: "input", role: "textbox", editable: true, accessibleName, pathDepth: 0 })],
  });
}

function pressEnterOnInput(bridge: CaptureEngineV2ShadowBridge, accessibleName: string) {
  bridge.handleMessage({
    type: "keypress",
    ...doc,
    key: "Enter",
    composedPath: [candidate({ tag: "input", role: "textbox", editable: true, accessibleName, pathDepth: 0 })],
  });
}

function derivedClick(bridge: CaptureEngineV2ShadowBridge, accessibleName: string) {
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", role: "button", actionable: true, accessibleName, pathDepth: 0 })],
    syntheticProvenance: true,
  });
}

function realClick(bridge: CaptureEngineV2ShadowBridge, accessibleName: string) {
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", role: "button", actionable: true, accessibleName, pathDepth: 0 })],
    syntheticProvenance: false,
  });
}

test("1. normalTyping: typing normal characters still produces exactly one edit action, no per-character press actions", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Nombre");
  for (const char of ["r", "a", "d", "a", "m", "e", "s"]) {
    bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: char } });
  }
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "s1" });

  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.actionType, "edit");
});

test("2. editEnter: a pending edit is committed before the Enter press, never after", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Número de identificación");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: "0560154046-0" } });
  pressEnterOnInput(bridge, "Número de identificación");

  assert.equal(bridge.technicalActions.length, 2);
  assert.deepEqual(bridge.technicalActions.map((r) => r.action.actionType), ["edit", "press"]);
  assert.ok(bridge.technicalActions[0].seq < bridge.technicalActions[1].seq);
});

test("3. pressOwner: the press action's owner remains the input/textbox, never re-attributed to a derived button", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Número de identificación");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: "1000000000" } });
  pressEnterOnInput(bridge, "Número de identificación");

  const press = bridge.technicalActions[1].action;
  assert.equal(press.owner?.tag, "input");
  assert.equal(press.owner?.role, "textbox");
  assert.equal(press.key, "Enter");
});

test("4. derivedClick: a synthetic click (detail===0) immediately following the press is never added as a second technical action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Número de identificación");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: "1000000000" } });
  pressEnterOnInput(bridge, "Número de identificación");
  derivedClick(bridge, "Depurar");

  assert.equal(bridge.technicalActions.length, 2, "the derived click must not become a third technical action");
  assert.equal(bridge.shadowDiagnostics.some((d) => d.reason === "click_derived_from_keypress:Enter"), true);
});

test("5. realClick: a genuine mouse click (detail!==0) right after a press is still preserved as its own click action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Búsqueda");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: "test" } });
  bridge.handleMessage({
    type: "keypress",
    ...doc,
    key: "Escape",
    composedPath: [candidate({ tag: "input", role: "textbox", editable: true, accessibleName: "Búsqueda", pathDepth: 0 })],
  });
  realClick(bridge, "Cancelar"); // the user genuinely clicked something afterward, unrelated to the Escape

  assert.equal(bridge.technicalActions.length, 3);
  assert.deepEqual(bridge.technicalActions.map((r) => r.action.actionType), ["edit", "press", "click"]);
});

test("6. submit: a subsequent submit for the already pre-press-committed session never adds a duplicate edit", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Número de identificación");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: "1000000000" } });
  pressEnterOnInput(bridge, "Número de identificación");
  bridge.handleMessage({ type: "submit", ...doc, sessionId: "s1" });

  assert.equal(bridge.technicalActions.length, 2, "submit after the pre-press commit must not add a duplicate edit");
  assert.equal(bridge.shadowDiagnostics.some((d) => d.reason === "commit_already_committed"), true);
});

test("7. sensitive: a sensitive pending edit committed before Enter never fabricates or logs a literal", () => {
  const fixtureSecret = "fixture-only-never-logged";
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  let bridge!: CaptureEngineV2ShadowBridge;
  try {
    bridge = new CaptureEngineV2ShadowBridge();
    bridge.handleMessage({ type: "document_ready", ...doc });
    bridge.handleMessage({
      type: "focus",
      ...doc,
      sessionId: "s1",
      composedPath: [candidate({ tag: "input", role: "textbox", editable: true, accessibleName: "Contraseña", pathDepth: 0 })],
      sensitive: true,
    });
    bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, changed: true } });
    pressEnterOnInput(bridge, "Contraseña");
  } finally {
    console.log = original;
  }

  assert.equal(bridge.technicalActions[0].action.value?.literal, undefined);
  assert.ok(!lines.some((l) => l.includes(fixtureSecret)));
});

test("8. physicalFixture: focus Usuario/Contraseña not involved -- exact ticket fixture (edit identification, Enter) -> technicalActions = edit, press", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Número de identificación");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: "056-0154046-0" } });
  pressEnterOnInput(bridge, "Número de identificación");
  derivedClick(bridge, "Depurar");
  bridge.handleMessage({ type: "submit", ...doc, sessionId: "s1" });

  assert.deepEqual(bridge.technicalActions.map((r) => r.action.actionType), ["edit", "press"]);
});

test("9. adapter: adaptCaptureActionToRawInteraction preserves press semantics (kind=press, key preserved, never converted to click)", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Número de identificación");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: "1000000000" } });
  pressEnterOnInput(bridge, "Número de identificación");

  const raw = adaptCaptureActionToRawInteraction(bridge.technicalActions[1].action);
  assert.equal(raw.kind, "press");
  assert.equal(raw.key, "Enter");
});

test("10. recordedEvent: the real onInteraction preserves the press as its own RecordedEvent kind, with the key carried through", async () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Número de identificación");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: "1000000000" } });
  pressEnterOnInput(bridge, "Número de identificación");

  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://contract-fixture.test",
    framesDir: path.join(os.tmpdir(), "keyboard-press-test-frames"),
    captureAuthority: "v2",
    onEvent: (event) => events.push(event),
  }) as unknown as { onInteraction(raw: unknown): Promise<void> };

  for (const record of bridge.technicalActions) {
    // eslint-disable-next-line no-await-in-loop
    await recorder.onInteraction(adaptCaptureActionToRawInteraction(record.action));
  }

  assert.equal(events.length, 2);
  assert.equal(events[0].kind, "fill");
  assert.equal(events[1].kind, "press");
  assert.equal(events[1].note, "Enter");
});

test("11. canonicalOrder: buildCanonicalInteractions is unaffected in ordering by an interspersed press event (edit still lands, in order)", async () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Número de identificación");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: "1000000000" } });
  pressEnterOnInput(bridge, "Número de identificación");
  derivedClick(bridge, "Depurar"); // suppressed, never a technical action
  realClick(bridge, "Ver detalle"); // genuine click after everything settles

  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://contract-fixture.test",
    framesDir: path.join(os.tmpdir(), "keyboard-press-test-frames-2"),
    captureAuthority: "v2",
    onEvent: (event) => events.push(event),
  }) as unknown as { onInteraction(raw: unknown): Promise<void> };

  for (const record of bridge.technicalActions) {
    // eslint-disable-next-line no-await-in-loop
    await recorder.onInteraction(adaptCaptureActionToRawInteraction(record.action));
  }

  const canonical = buildCanonicalInteractions(events);
  // SUPERSEDED by the "press first-class execution" ticket: "press" is now a real canonical
  // action (never skipped like "note"), so it takes its own place in the sequence between the
  // fill and the click it was captured between -- exactly the order physically recorded.
  assert.deepEqual(canonical.map((c) => c.action), ["fill", "press", "click"]);
});

test("12. generic: no app/project/text hardcode drives this fix -- an unrelated fixture with different labels/keys behaves identically", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "sx", "Comentario");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "sx", kind: "input", valueState: { present: true, literal: "hola" } });
  bridge.handleMessage({
    type: "keypress",
    ...doc,
    key: "Escape",
    composedPath: [candidate({ tag: "input", role: "textbox", editable: true, accessibleName: "Comentario", pathDepth: 0 })],
  });

  assert.deepEqual(bridge.technicalActions.map((r) => r.action.actionType), ["edit", "press"]);
});

test("13. clickRegression: an ordinary click with no keypress token pending behaves exactly as before", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  realClick(bridge, "Depurar");

  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.actionType, "click");
});

test("14. editClickRegression: the pre-click edit-commit behavior (from the previous ordering ticket) is unaffected by keypress handling", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Usuario");
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: "qauser" } });
  realClick(bridge, "Iniciar sesión"); // no keypress at all -- plain click, still commits the pending edit first

  assert.deepEqual(bridge.technicalActions.map((r) => r.action.actionType), ["edit", "click"]);
});
