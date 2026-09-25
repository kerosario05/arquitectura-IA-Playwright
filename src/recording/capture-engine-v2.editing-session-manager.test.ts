import assert from "node:assert/strict";
import test from "node:test";
import { EditingSessionManager, type OpenEditingSessionInput } from "./capture-engine-v2.editing-session-manager";
import { adaptCaptureActionToRawInteraction } from "./capture-engine-v2.raw-interaction-adapter";

/**
 * `EditingSessionManager` coalesces a whole user editing sequence into exactly ONE
 * `CaptureAction(actionType="edit")`. Pure, no DOM/Playwright/timers -- NOT wired into
 * `web-session-recorder.ts`, CaptureEngine V2 stays fully disconnected.
 */

const docA = { captureInstanceId: "instance-1", documentId: "doc-A" };
const docB = { captureInstanceId: "instance-1", documentId: "doc-B" };

function openInput(overrides: Partial<OpenEditingSessionInput> = {}): OpenEditingSessionInput {
  return {
    sessionId: "session-1",
    owner: { tag: "input", role: "textbox", technicalRefs: ["input#user"] },
    documentContext: docA,
    identity: { label: "Usuario", tagName: "input", domId: "user" },
    initialValue: { present: false },
    ...overrides,
  };
}

test("1. open + edit + commit -> exactly one edit action", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput());
  manager.recordEditingEvidence("session-1", { kind: "input" }, { present: true, literal: "qauser" });
  const result = manager.commitEditingSession("session-1", docA);

  assert.equal(result.status, "committed");
  assert.equal(result.status === "committed" && result.action.actionType, "edit");
  assert.equal(result.status === "committed" && result.action.value?.literal, "qauser");
});

test("2. multiple edit events (beforeinput, input, change) on the same session -> still one action", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput());
  manager.recordEditingEvidence("session-1", { kind: "beforeinput" });
  manager.recordEditingEvidence("session-1", { kind: "input" }, { present: true, literal: "qa" });
  manager.recordEditingEvidence("session-1", { kind: "change" }, { present: true, literal: "qauser" });

  const result = manager.commitEditingSession("session-1", docA);
  assert.equal(result.status, "committed");
  assert.equal(result.status === "committed" && result.action.value?.literal, "qauser", "the LAST observed value state wins");
});

test("3. no change: final value equals initial value -> no action", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput({ initialValue: { present: true, literal: "prefilled@example.test" } }));
  manager.recordEditingEvidence("session-1", { kind: "trusted_editable_interaction" }, { present: true, literal: "prefilled@example.test" });

  const result = manager.commitEditingSession("session-1", docA);
  assert.equal(result.status, "no_change");
});

test("4. no user-edit evidence at all -> no action", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput());
  const result = manager.commitEditingSession("session-1", docA);
  assert.equal(result.status, "no_user_edit_evidence");
});

test("5. sensitive edit without a secret literal -> still a valid edit action", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput({
    sessionId: "session-pw",
    owner: { tag: "input", role: "textbox", technicalRefs: ["input#password"] },
    identity: { label: "Contraseña", tagName: "input", inputType: "password", domId: "password" },
    sensitive: true,
    initialValue: { present: false },
  }));
  manager.recordEditingEvidence("session-pw", { kind: "input" }, { present: true, changed: true }); // no literal

  const result = manager.commitEditingSession("session-pw", docA);
  assert.equal(result.status, "committed");
  assert.equal(result.status === "committed" && result.action.sensitive, true);
  assert.equal(result.status === "committed" && result.action.value?.literal, undefined, "no secret literal is ever required");
  assert.equal(result.status === "committed" && result.action.editingSession?.sensitive, true);
});

test("6. sensitive, unchanged: explicit changed=false even with interaction evidence -> no action", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput({
    sessionId: "session-pw",
    sensitive: true,
    initialValue: { present: true }, // an existing, opaque password value
  }));
  manager.recordEditingEvidence("session-pw", { kind: "trusted_editable_interaction" }, { present: true, changed: false });

  const result = manager.commitEditingSession("session-pw", docA);
  assert.equal(result.status, "no_change");
});

test("7. commit twice -> no duplicate action", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput());
  manager.recordEditingEvidence("session-1", { kind: "input" }, { present: true, literal: "qauser" });

  const first = manager.commitEditingSession("session-1", docA);
  const second = manager.commitEditingSession("session-1", docA);
  assert.equal(first.status, "committed");
  assert.equal(second.status, "already_committed");
});

test("8. two sessions committed sequentially preserve order (Usuario, then Contraseña)", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput({ sessionId: "session-user" }));
  manager.recordEditingEvidence("session-user", { kind: "input" }, { present: true, literal: "qauser" });
  const userResult = manager.commitEditingSession("session-user", docA);

  manager.openEditingSession(openInput({
    sessionId: "session-pw",
    identity: { label: "Contraseña", tagName: "input", inputType: "password", domId: "password" },
    sensitive: true,
  }));
  manager.recordEditingEvidence("session-pw", { kind: "input" }, { present: true, changed: true });
  const pwResult = manager.commitEditingSession("session-pw", docA);

  assert.equal(userResult.status, "committed");
  assert.equal(pwResult.status, "committed");
  assert.equal(userResult.status === "committed" && userResult.action.identity.label, "Usuario");
  assert.equal(pwResult.status === "committed" && pwResult.action.identity.label, "Contraseña");
});

test("9. owner identity is preserved onto the committed action, derived structurally (never from the label)", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput({ owner: { tag: "input", role: "textbox", technicalRefs: ["input#user"] } }));
  manager.recordEditingEvidence("session-1", { kind: "input" }, { present: true, literal: "qauser" });

  const result = manager.commitEditingSession("session-1", docA);
  assert.equal(result.status === "committed" && result.action.owner?.technicalRefs?.[0], "input#user");
  assert.equal(result.status === "committed" && result.action.editingSession?.ownerIdentity, "input#user");
});

test("10. documentContext is preserved onto the committed action", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput());
  manager.recordEditingEvidence("session-1", { kind: "input" }, { present: true, literal: "qauser" });

  const result = manager.commitEditingSession("session-1", docA);
  assert.deepEqual(result.status === "committed" && result.action.documentContext, docA);
});

test("11. document changes before commit -> no cross-document merge, explicit document_changed status, no fabricated fill in the new document", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput());
  manager.recordEditingEvidence("session-1", { kind: "input" }, { present: true, literal: "qauser" });

  const result = manager.commitEditingSession("session-1", docB);
  assert.equal(result.status, "document_changed");

  // The session is now cancelled -- a later commit attempt (even back on the original document)
  // must not resurrect it into an action either.
  const retry = manager.commitEditingSession("session-1", docA);
  assert.equal(retry.status, "cancelled");
});

test("12. sourceRefs/evidence are preserved verbatim onto the committed action", () => {
  const manager = new EditingSessionManager();
  const sourceRefs = { eventTargetRef: "ref-target-1", composedPathRefs: ["ref-target-1", "ref-form-1"] };
  manager.openEditingSession(openInput({ sourceRefs }));
  manager.recordEditingEvidence("session-1", { kind: "input" }, { present: true, literal: "qauser" });

  const result = manager.commitEditingSession("session-1", docA);
  assert.deepEqual(result.status === "committed" && result.action.sourceRefs, sourceRefs);
});

test("13. the committed edit action adapts through the existing RawInteraction adapter to kind=input", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput());
  manager.recordEditingEvidence("session-1", { kind: "input" }, { present: true, literal: "qauser" });

  const result = manager.commitEditingSession("session-1", docA);
  assert.equal(result.status, "committed");
  const raw = result.status === "committed" ? adaptCaptureActionToRawInteraction(result.action) : undefined;
  assert.equal(raw?.kind, "input");
  assert.equal(raw?.value, "qauser");
});

test("14. cancelEditingSession stops any later commit from producing an action, using only generic status/evidence-kind vocabulary (no app-specific strings, no positional logic)", () => {
  const manager = new EditingSessionManager();
  manager.openEditingSession(openInput());
  manager.recordEditingEvidence("session-1", { kind: "input" }, { present: true, literal: "qauser" });
  manager.cancelEditingSession("session-1");

  const result = manager.commitEditingSession("session-1", docA);
  assert.equal(result.status, "cancelled");
});
