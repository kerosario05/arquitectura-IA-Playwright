import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { adaptCaptureActionToRawInteraction } from "./capture-engine-v2.raw-interaction-adapter";
import type { CaptureAction } from "./capture-engine-v2.types";

/**
 * CaptureEngine V2 is a purely internal, disconnected skeleton (types + a pure adapter function)
 * -- it is not wired into `WebSessionRecorder.start()`, has no DOM listeners, and cannot change
 * production behavior. These tests exercise `adaptCaptureActionToRawInteraction` directly,
 * plus one structural guard confirming the adapter's `RawInteractionLike` mirror has not drifted
 * from the real (private, unexported) `RawInteraction` in web-session-recorder.ts.
 */

const RECORDER_SOURCE = fs.readFileSync(
  path.join(__dirname, "web", "web-session-recorder.ts"),
  "utf8",
);

test("0. RawInteractionLike mirror has not drifted: every mirrored field name still appears in the real RawInteraction declaration", () => {
  const mirroredFields = [
    "kind", "label", "role", "tagName", "inputType", "value", "testId", "domId", "name",
    "ariaLabel", "text", "placeholder", "containerContext", "headerContext", "rowContext",
    "associatedField", "valueSource", "technicalTargetCandidates", "fieldOwnerDiagnostic",
    "eventTargetRef", "currentTargetRef", "composedPathRefs", "deepestEditableTargetRef",
  ];
  const rawInteractionBlockMatch = RECORDER_SOURCE.match(/type RawInteraction = \{[\s\S]*?\n\};/);
  assert.ok(rawInteractionBlockMatch, "RawInteraction declaration must still exist in web-session-recorder.ts");
  const block = rawInteractionBlockMatch![0];
  for (const field of mirroredFields) {
    assert.match(block, new RegExp(`\\b${field}\\??:`), `mirrored field "${field}" must still exist on the real RawInteraction`);
  }
});

test("1. V2 edit action adapts to RawInteraction kind=input", () => {
  const action: CaptureAction = {
    actionType: "edit",
    identity: { label: "Correo electrónico", tagName: "input", inputType: "email", domId: "email" },
    value: { present: true, changed: true, literal: "persona@correo-fixture.test" },
  };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.kind, "input");
  assert.equal(raw.label, "Correo electrónico");
  assert.equal(raw.value, "persona@correo-fixture.test");
  assert.equal(raw.valueSource, "user");
});

test("2. V2 click adapts to RawInteraction kind=click", () => {
  const action: CaptureAction = {
    actionType: "click",
    identity: { label: "Enviar", role: "button", tagName: "button", testId: "submit-btn" },
  };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.kind, "click");
  assert.equal(raw.testId, "submit-btn");
  assert.equal(raw.value, undefined, "a click never carries a value field");
});

test("3. V2 submit adapts to RawInteraction kind=submit", () => {
  const action: CaptureAction = {
    actionType: "submit",
    identity: { label: "Formulario de acceso", tagName: "form" },
  };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.kind, "submit");
  assert.equal(raw.label, "Formulario de acceso");
});

test("diagnostic/control message never gets silently promoted into a functional action, even with click-shaped identity", () => {
  const action: CaptureAction = {
    actionType: "diagnostic",
    identity: { label: "Enviar", role: "button", testId: "submit-btn" },
  };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.kind, "observation", "diagnostic must map to observation, never click/input/submit");
});

test("observation maps to observation as well, never a functional kind", () => {
  const action: CaptureAction = { actionType: "observation", identity: { label: "post_action check" } };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.kind, "observation");
});

test("4. sensitive edit without a secret literal still produces a valid, semantically-correct input shape", () => {
  const action: CaptureAction = {
    actionType: "edit",
    identity: { label: "Contraseña", tagName: "input", inputType: "password", domId: "password" },
    sensitive: true,
    value: { present: true, changed: true }, // no `literal` -- V2 never requires the secret
  };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.kind, "input");
  assert.equal(raw.inputType, "password", "downstream isSensitiveField() still infers sensitivity from inputType, no literal needed");
  assert.equal(raw.value, undefined, "V2 never fabricates a literal that was never captured");
});

test("FIRST_LOSS fix: owner.technicalRefs (id:/testid:) survive onto RawInteraction.domId/testId when identity doesn't already carry them", () => {
  const action: CaptureAction = {
    actionType: "click",
    identity: { label: "Tipo de documento", role: "combobox" }, // no domId/testId duplicated here
    owner: { tag: "span", role: "combobox", technicalRefs: ["id:doc-type-combo"] },
  };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.domId, "doc-type-combo");

  const testIdAction: CaptureAction = {
    actionType: "click",
    identity: { label: "Enviar" },
    owner: { tag: "button", technicalRefs: ["testid:submit-btn"] },
  };
  assert.equal(adaptCaptureActionToRawInteraction(testIdAction).testId, "submit-btn");
});

test("identity.domId/testId, when present, always win over owner.technicalRefs (identity stays authoritative)", () => {
  const action: CaptureAction = {
    actionType: "click",
    identity: { label: "Tipo de documento", domId: "from-identity" },
    owner: { tag: "span", technicalRefs: ["id:from-owner-refs"] },
  };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.domId, "from-identity");
});

test("5. technical evidence absent on the CaptureAction stays undefined on the adapted RawInteraction (never coerced to [])", () => {
  const action: CaptureAction = { actionType: "click", identity: { label: "Volver", role: "button" } };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.technicalTargetCandidates, undefined);
  assert.equal(raw.fieldOwnerDiagnostic, undefined);
});

test("6. technical evidence present is preserved verbatim (same array reference, not cloned/rebuilt)", () => {
  const candidates = [
    {
      targetType: "editable" as const,
      locatorCandidates: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text", confidence: 0.72 }],
      interactionEvidence: ["dom_mutation"],
      confidence: 0.72,
      validatedByInteraction: true,
    },
  ];
  const action: CaptureAction = {
    actionType: "click",
    identity: { label: "", tagName: "div", role: "gridcell" },
    technicalEvidence: { candidates },
    semanticEvidence: { fieldOwnerDiagnostic: { result: "unresolved", trace: [] } },
  };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.technicalTargetCandidates, candidates);
  assert.deepEqual(raw.fieldOwnerDiagnostic, { result: "unresolved", trace: [] });
});

test("7. owner/field evidence (associatedField) is preserved onto RawInteraction.associatedField", () => {
  const action: CaptureAction = {
    actionType: "click",
    identity: { label: "Cédula de ciudadanía", role: "combobox", tagName: "select" },
    owner: { tag: "select", role: "combobox", classification: "editable", associatedField: "Tipo de documento" },
  };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.associatedField, "Tipo de documento");
});

test("8. source order/ref metadata is preserved when the current contract supports it", () => {
  const action: CaptureAction = {
    actionType: "edit",
    identity: { label: "Número de identificación", tagName: "input", domId: "docNumber" },
    value: { present: true, changed: true, literal: "1000000000" },
    sourceRefs: {
      eventTargetRef: "ref-target-1",
      currentTargetRef: "ref-current-1",
      composedPathRefs: ["ref-target-1", "ref-form-1", "ref-body"],
      deepestEditableTargetRef: "ref-target-1",
    },
  };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.equal(raw.eventTargetRef, "ref-target-1");
  assert.equal(raw.currentTargetRef, "ref-current-1");
  assert.deepEqual(raw.composedPathRefs, ["ref-target-1", "ref-form-1", "ref-body"]);
  assert.equal(raw.deepestEditableTargetRef, "ref-target-1");
});

test("9. the controlled authority switch ticket supersedes this test's original premise: the adapter IS now called from the production recorder, but ONLY when captureAuthority===\"v2\"", () => {
  // Superseded again, deliberately, by the controlled-authority-switch ticket: this adapter is
  // now the exact function `onV2TechnicalAction` uses to feed onInteraction/SessionTrace when
  // `captureAuthority === "v2"` (see web-session-recorder.authority-switch.test.ts for the full
  // set of single-authority guards). It is imported and called from the production recorder --
  // that reference alone is no longer a violation of anything. What must remain true instead:
  // the call is gated behind captureAuthority, never unconditional.
  assert.match(RECORDER_SOURCE, /adaptCaptureActionToRawInteraction/, "the adapter is now legitimately used by onV2TechnicalAction");
  const onV2TechnicalActionMatch = RECORDER_SOURCE.match(/private onV2TechnicalAction\([\s\S]*?\n {2}\}/);
  assert.ok(onV2TechnicalActionMatch, "onV2TechnicalAction must exist");
  assert.match(onV2TechnicalActionMatch![0], /if \(this\.captureAuthority !== "v2"\) return;/, "the adapter call must be gated behind captureAuthority===\"v2\", never unconditional");
});

test("editingSession is a documented GAP: the adapter has nowhere on RawInteraction to put a sessionId, and omits it rather than inventing a parallel channel", () => {
  const action: CaptureAction = {
    actionType: "edit",
    identity: { label: "Usuario", tagName: "input", domId: "user" },
    value: { present: true, changed: true, literal: "qauser" },
    editingSession: {
      sessionId: "session-fixture-1",
      ownerIdentity: "input#user",
      changed: true,
      sensitive: false,
      finalSemanticState: "present",
    },
  };
  const raw = adaptCaptureActionToRawInteraction(action);
  assert.ok(!("editingSessionRef" in raw), "RawInteractionLike has no editingSessionRef field -- the current contract has nowhere to carry it");
});
