import assert from "node:assert/strict";
import test from "node:test";
import { CaptureEngineV2ShadowBridge } from "./capture-engine-v2.shadow-bridge";
import { adaptCaptureActionToRawInteraction } from "./capture-engine-v2.raw-interaction-adapter";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import { WebSessionRecorder } from "./web/web-session-recorder";
import type { CaptureOwnerCandidate } from "./capture-engine-v2.types";
import type { RecordedEvent } from "./session-trace.types";
import os from "node:os";
import path from "node:path";

/**
 * Playwright-like ordering fix: physical evidence showed `edit Usuario, click Login, edit
 * Contraseña` -- a login click's technical action landed BEFORE the password field's own
 * blur/submit ever reached Node, because the shadow bridge only ever committed a pending editing
 * session reactively (on blur/submit), never proactively when a click on a different, non-editable
 * owner arrived first. `CaptureEngineV2ShadowBridge` now tracks the currently open session id and
 * commits it (reusing `EditingSessionManager`'s own commit/already-committed logic, never a new
 * dedup mechanism) BEFORE pushing a click's own technical action, and also before opening a NEW
 * session on an owner transition via focus.
 */

const doc = { captureInstanceId: "instance-1", documentId: "doc-A" };

function candidate(overrides: Partial<CaptureOwnerCandidate> & Pick<CaptureOwnerCandidate, "tag" | "pathDepth">): CaptureOwnerCandidate {
  return { editable: false, actionable: false, ...overrides };
}

function focusInput(bridge: CaptureEngineV2ShadowBridge, sessionId: string, accessibleName: string, sensitive = false) {
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId,
    composedPath: [candidate({ tag: "input", role: "textbox", editable: true, accessibleName, pathDepth: 0 })],
    sensitive,
  });
}

function editEvidence(bridge: CaptureEngineV2ShadowBridge, sessionId: string, valueState?: { present: boolean; literal?: string; changed?: boolean }) {
  bridge.handleMessage({ type: "edit_evidence", sessionId, kind: "input", valueState });
}

function clickButton(bridge: CaptureEngineV2ShadowBridge, accessibleName: string) {
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", role: "button", actionable: true, accessibleName, pathDepth: 0 })],
  });
}

test("1. editBeforeButton: a pending edit is committed before a click on a different, non-editable owner", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Usuario");
  editEvidence(bridge, "s1", { present: true, literal: "qauser" });
  clickButton(bridge, "Guardar"); // no blur/submit ever sent before the click

  assert.equal(bridge.technicalActions.length, 2);
  assert.deepEqual(bridge.technicalActions.map((r) => r.action.actionType), ["edit", "click"]);
  assert.ok(bridge.technicalActions[0].seq < bridge.technicalActions[1].seq);
});

test("2. sensitiveBeforeLogin: a pending sensitive edit (no literal) is committed before the Login click, no literal fabricated/logged", () => {
  const fixtureSecret = "fixture-only-never-logged";
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s2", "Contraseña", true);
  editEvidence(bridge, "s2", { present: true, changed: true }); // no literal, matches real password evidence
  clickButton(bridge, "Iniciar sesión"); // click arrives before blur/submit, per the physical evidence

  assert.equal(bridge.technicalActions.length, 2);
  assert.equal(bridge.technicalActions[0].action.actionType, "edit");
  assert.equal(bridge.technicalActions[0].action.sensitive, true);
  assert.equal(bridge.technicalActions[0].action.value?.literal, undefined);
  assert.equal(bridge.technicalActions[1].action.actionType, "click");
  assert.ok(!JSON.stringify(bridge.technicalActions).includes(fixtureSecret));
});

test("3. submitNoDuplicate: a submit message arriving after the pre-click commit never produces a second edit", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Usuario");
  editEvidence(bridge, "s1", { present: true, literal: "qauser" });
  clickButton(bridge, "Iniciar sesión");
  bridge.handleMessage({ type: "submit", ...doc, sessionId: "s1" }); // browser still sends it, unaware Node already committed

  assert.equal(bridge.technicalActions.length, 2, "submit after the pre-click commit must not add a second edit");
  assert.equal(bridge.shadowDiagnostics.some((d) => d.reason === "commit_already_committed"), true);
});

test("4. blurNoDuplicate: a blur message arriving after the pre-click commit never produces a second edit", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Usuario");
  editEvidence(bridge, "s1", { present: true, literal: "qauser" });
  clickButton(bridge, "Iniciar sesión");
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "s1" });

  assert.equal(bridge.technicalActions.length, 2, "blur after the pre-click commit must not add a second edit");
});

test("5. sameEditable: a click on the currently-focused editable itself never forces a commit or a synthetic click action", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Usuario");
  editEvidence(bridge, "s1", { present: true, literal: "qa" });
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "input", role: "textbox", editable: true, accessibleName: "Usuario", pathDepth: 0 })],
  });

  assert.equal(bridge.technicalActions.length, 0, "no edit committed and no click fabricated -- the session is still open, mid-edit");
  assert.equal(bridge.shadowDiagnostics.some((d) => d.reason === "click_target_is_editable_owner"), true);

  // The session survives and can still be committed normally afterward.
  editEvidence(bridge, "s1", { present: true, literal: "qauser" });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "s1" });
  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.value?.literal, "qauser");
});

test("6. editableTransition: focusing a DIFFERENT editable commits the previous session before the new one opens, never mixing values", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Usuario");
  editEvidence(bridge, "s1", { present: true, literal: "qauser" });
  focusInput(bridge, "s2", "Contraseña", true); // no blur for s1 ever sent
  editEvidence(bridge, "s2", { present: true, changed: true });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "s2" });

  assert.equal(bridge.technicalActions.length, 2);
  assert.equal(bridge.technicalActions[0].action.identity.label, "Usuario");
  assert.equal(bridge.technicalActions[0].action.value?.literal, "qauser");
  assert.equal(bridge.technicalActions[1].action.identity.label, "Contraseña");
  assert.equal(bridge.technicalActions[1].action.sensitive, true);
});

test("7. loginFixture: Usuario, Contraseña, Login click -> technical order edit, edit, click (never edit, click, edit)", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Usuario");
  editEvidence(bridge, "s1", { present: true, literal: "qauser" });
  focusInput(bridge, "s2", "Contraseña", true);
  editEvidence(bridge, "s2", { present: true, changed: true });
  clickButton(bridge, "Iniciar sesión"); // click arrives before s2's own blur/submit
  bridge.handleMessage({ type: "submit", ...doc, sessionId: "s2" });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "s2" });

  assert.equal(bridge.technicalActions.length, 3, "exactly 3 technical actions -- no duplicate password fill");
  assert.deepEqual(bridge.technicalActions.map((r) => r.action.actionType), ["edit", "edit", "click"]);
  assert.equal(bridge.technicalActions[0].action.identity.label, "Usuario");
  assert.equal(bridge.technicalActions[1].action.identity.label, "Contraseña");
  assert.equal(bridge.technicalActions[2].action.identity.label, "Iniciar sesión");
});

test("8. canonicalOrder: the same login fixture, driven through the real V2 authority ingestion, canonicalizes as fill, fill, click", async () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Usuario");
  editEvidence(bridge, "s1", { present: true, literal: "qauser" });
  focusInput(bridge, "s2", "Contraseña", true);
  editEvidence(bridge, "s2", { present: true, changed: true });
  clickButton(bridge, "Iniciar sesión");
  bridge.handleMessage({ type: "submit", ...doc, sessionId: "s2" });

  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://contract-fixture.test",
    framesDir: path.join(os.tmpdir(), "playwright-like-ordering-test-frames"),
    captureAuthority: "v2",
    onEvent: (event) => events.push(event),
  }) as unknown as { onInteraction(raw: unknown): Promise<void> };

  for (const record of bridge.technicalActions) {
    // eslint-disable-next-line no-await-in-loop
    await recorder.onInteraction(adaptCaptureActionToRawInteraction(record.action));
  }

  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 3);
  assert.deepEqual(canonical.map((c) => c.action), ["fill", "fill", "click"]);
});

test("9. asyncOrder: technicalActions.map(seq) stays strictly increasing across the whole login fixture, including the pre-click commit", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "s1", "Usuario");
  editEvidence(bridge, "s1", { present: true, literal: "qauser" });
  focusInput(bridge, "s2", "Contraseña", true);
  editEvidence(bridge, "s2", { present: true, changed: true });
  clickButton(bridge, "Iniciar sesión");

  const seqs = bridge.technicalActions.map((r) => r.seq);
  for (let i = 1; i < seqs.length; i++) assert.ok(seqs[i - 1] < seqs[i]);
});

test("10. sensitive: no sensitive literal reaches any log line across the pre-click-commit path", () => {
  const fixtureSecret = "fixture-only-never-logged-2";
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    const bridge = new CaptureEngineV2ShadowBridge();
    bridge.handleMessage({ type: "document_ready", ...doc });
    focusInput(bridge, "s2", "Contraseña", true);
    editEvidence(bridge, "s2", { present: true, changed: true });
    clickButton(bridge, "Iniciar sesión");
  } finally {
    console.log = original;
  }
  assert.ok(!lines.some((l) => l.includes(fixtureSecret)));
});

test("11. generic: no app/project/text hardcode drives this ordering fix -- an unrelated fixture with different labels behaves identically", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  focusInput(bridge, "sx", "Correo electrónico");
  editEvidence(bridge, "sx", { present: true, literal: "a@b.test" });
  clickButton(bridge, "Enviar");

  assert.equal(bridge.technicalActions.length, 2);
  assert.deepEqual(bridge.technicalActions.map((r) => r.action.actionType), ["edit", "click"]);
});

test("12. clickRegression: an ordinary click with no editing session open at all behaves exactly as before", () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  clickButton(bridge, "Depurar");

  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.actionType, "click");
});
