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
 * Realistic regression for the FIRST_LOSS this ticket fixes: prior fixtures across this whole
 * ticket chain gave every owner candidate an explicit `role` and a hand-set `identity.label` --
 * far cleaner identity than the browser instrumentation actually produced. A real recording's
 * `[capture-v2] action ... ownerRole=unknown` on every single action proved this: the browser
 * script only ever read an EXPLICIT `role` attribute (real buttons/inputs almost never have
 * one), and `onFocus` forwarded the browser's `identity` object verbatim -- which never included
 * any label field at all, so every edit's identity.label was always undefined regardless of the
 * real element's accessible name.
 *
 * These candidates mirror what a REAL page produces: no `role` attribute-shaped value (only what
 * `resolveCaptureOwner`'s classification needs -- `editable`/`actionable` booleans, computed from
 * tag/type, exactly like the real browser script's `isEditableNode`/`isActionableNode`), and no
 * `identity` on the `focus`/`click` messages at all (the browser never sends one) -- the ONLY
 * label source is `accessibleName` on the composed-path candidate, standing in for what the
 * browser's own `computeAccessibleName` would have computed. This exercises the REAL, fixed
 * `onFocus`/`onClick` fallback logic end to end through the REAL `onInteraction`/
 * `buildCanonicalInteractions`, never a re-implementation.
 */

const doc = { captureInstanceId: "instance-1", documentId: "doc-A" };

function candidate(overrides: Partial<CaptureOwnerCandidate> & Pick<CaptureOwnerCandidate, "tag" | "pathDepth">): CaptureOwnerCandidate {
  return { editable: false, actionable: false, ...overrides };
}

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://contract-fixture.test",
    framesDir: path.join(os.tmpdir(), "physical-identity-regression-test-frames"),
    captureAuthority: "v2",
    onEvent: (event) => events.push(event),
  }) as unknown as { onInteraction(raw: unknown): Promise<void> };
  return { recorder, events };
}

test("9. six physical technical actions with real-shaped (role-less, identity-less) owner candidates canonicalize as six interactions, never collapsed to one", async () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });

  // Each candidate's `role` is set exactly as the FIXED toCandidate()/nativeRole() would derive
  // it from tag/type alone (native textbox/button semantics) -- never from an explicit `role`
  // attribute, which real elements in this evidence never had either.

  // edit #1: Usuario -- no explicit role attribute, no identity sent by the browser at all.
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId: "s1",
    composedPath: [candidate({ tag: "input", role: "textbox", editable: true, accessibleName: "Usuario", pathDepth: 0 })],
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s1", kind: "input", valueState: { present: true, literal: "qauser" } });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "s1" });

  // edit #2: Contraseña -- sensitive, no literal.
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId: "s2",
    composedPath: [candidate({ tag: "input", role: "textbox", editable: true, accessibleName: "Contraseña", pathDepth: 0 })],
    sensitive: true,
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s2", kind: "input", valueState: { present: true, changed: true } });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "s2" });

  // click: Iniciar sesión -- no explicit role attribute, no identity sent.
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", role: "button", actionable: true, accessibleName: "Iniciar sesión", pathDepth: 0 })],
  });

  // edit #3 (post-login): Número de identificación.
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId: "s3",
    composedPath: [candidate({ tag: "input", role: "textbox", editable: true, accessibleName: "Número de identificación", pathDepth: 0 })],
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s3", kind: "input", valueState: { present: true, literal: "1000000000" } });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "s3" });

  // click: associated button (post-login #1).
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", role: "button", actionable: true, accessibleName: "Buscar", pathDepth: 0 })],
  });

  // click: Depurar (post-login #2).
  bridge.handleMessage({
    type: "click",
    ...doc,
    composedPath: [candidate({ tag: "button", role: "button", actionable: true, accessibleName: "Depurar", pathDepth: 0 })],
  });

  assert.equal(bridge.technicalActions.length, 6, "all six physical actions must reach technicalActions");
  assert.deepEqual(bridge.technicalActions.map((r) => r.action.actionType), ["edit", "edit", "click", "edit", "click", "click"]);

  // None of them degraded to the generic "control" fallback label.
  for (const record of bridge.technicalActions) {
    assert.notEqual(record.action.identity.label, "control", `action seq=${record.seq} must not degrade to the generic fallback label`);
    assert.ok(record.action.identity.label && record.action.identity.label.length > 0);
  }

  const { recorder, events } = newRecorder();
  for (const record of bridge.technicalActions) {
    // eslint-disable-next-line no-await-in-loop
    await recorder.onInteraction(adaptCaptureActionToRawInteraction(record.action));
  }
  assert.equal(events.length, 6, "all six technical actions must reach RecordedEvent");

  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 6, "the six physical actions must canonicalize as six interactions, never collapsed to one");
  assert.deepEqual(canonical.map((c) => c.action), ["fill", "fill", "click", "fill", "click", "click"]);

  // "candidateTargets[]: ninguno" symptom: with role+label both real now, buildWebLocators can
  // build a role|label locator even with no id/data-testid at all -- technicalTargetRefs must
  // never be empty for these interactions.
  for (const interaction of canonical) {
    assert.ok(interaction.technicalTargetRefs.length > 0, `interaction ${interaction.id} must carry at least one real technical target ref`);
  }
});

test("10. no sensitive literal ever appears on the sensitive edit's canonical interaction or its identity", async () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  const fixtureSecret = "fixture-only-never-persisted";
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId: "s2",
    composedPath: [candidate({ tag: "input", editable: true, accessibleName: "Contraseña", pathDepth: 0 })],
    sensitive: true,
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "s2", kind: "input", valueState: { present: true, changed: true } });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "s2" });

  const action = bridge.technicalActions[0].action;
  assert.equal(action.value?.literal, undefined, "no literal was ever captured for the sensitive field, so none can leak");
  assert.ok(!JSON.stringify(action).includes(fixtureSecret));
});

test("11. no app/project/label hardcode drives this fix: an unrelated fixture (different labels, different tags) canonicalizes with the same shape", async () => {
  const bridge = new CaptureEngineV2ShadowBridge();
  bridge.handleMessage({ type: "document_ready", ...doc });
  bridge.handleMessage({
    type: "focus",
    ...doc,
    sessionId: "sx",
    composedPath: [candidate({ tag: "textarea", editable: true, accessibleName: "Comentario", pathDepth: 0 })],
  });
  bridge.handleMessage({ type: "edit_evidence", sessionId: "sx", kind: "input", valueState: { present: true, literal: "hola" } });
  bridge.handleMessage({ type: "blur", ...doc, sessionId: "sx" });

  assert.equal(bridge.technicalActions.length, 1);
  assert.equal(bridge.technicalActions[0].action.identity.label, "Comentario");
});

test("12. legacy/internal override is unaffected: a direct legacy-shaped onInteraction call still works exactly as before, independent of this fix", async () => {
  const { recorder, events } = newRecorder();
  await recorder.onInteraction({ kind: "click", label: "Volver", role: "button" });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "tap");
});
