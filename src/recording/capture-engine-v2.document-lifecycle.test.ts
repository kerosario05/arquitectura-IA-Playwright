import assert from "node:assert/strict";
import test from "node:test";
import { DocumentLifecycle } from "./capture-engine-v2.document-lifecycle";

/**
 * `DocumentLifecycle` models one capture instance's documents (install -> ready handshake ->
 * active -> retired-on-navigation). Pure, in-memory, no DOM/Playwright/timers -- NOT wired into
 * `web-session-recorder.ts`, CaptureEngine V2 stays fully disconnected.
 */

const instance = "instance-1";
const otherInstance = "instance-2";

test("1. register document -> installing", () => {
  const lifecycle = new DocumentLifecycle();
  const record = lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  assert.equal(record.state, "installing");
});

test("2. ready handshake -> ready", () => {
  const lifecycle = new DocumentLifecycle();
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  const record = lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-A" });
  assert.equal(record?.state, "ready");
});

test("3. event before the ready handshake is rejected", () => {
  const lifecycle = new DocumentLifecycle();
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  const validation = lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "doc-A" });
  assert.equal(validation, "installing");
});

test("4. event after ready is accepted", () => {
  const lifecycle = new DocumentLifecycle();
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-A" });
  const validation = lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "doc-A" });
  assert.equal(validation, "active_ready");
});

test("5. full navigation: A ready -> B registers -> A retired, B installing -> B ready", () => {
  const lifecycle = new DocumentLifecycle();
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-A" });

  const b = lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-B" });
  assert.equal(lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "doc-A" }), "retired");
  assert.equal(b.state, "installing");

  lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-B" });
  assert.equal(lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "doc-B" }), "active_ready");
});

test("6. an event from the retired previous document is rejected", () => {
  const lifecycle = new DocumentLifecycle();
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-A" });
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-B" });

  const validation = lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "doc-A" });
  assert.equal(validation, "retired");
});

test("7. an event carrying the wrong captureInstanceId is rejected, even for a known, ready document", () => {
  const lifecycle = new DocumentLifecycle();
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-A" });

  const validation = lifecycle.validateEventDocument({ captureInstanceId: otherInstance, documentId: "doc-A" });
  assert.equal(validation, "wrong_capture_instance");
});

test("8. duplicate ready is idempotent: no duplicate transition, state and generation unchanged", () => {
  const lifecycle = new DocumentLifecycle();
  const registered = lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-A" });
  const secondReady = lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-A" });

  assert.equal(secondReady?.state, "ready");
  assert.equal(secondReady?.generation, registered.generation);
});

test("9. duplicate register of the same documentId is idempotent: no second document, same generation", () => {
  const lifecycle = new DocumentLifecycle();
  const first = lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  const second = lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });

  assert.equal(second.generation, first.generation);
  assert.equal(second, first, "duplicate register must return the exact same record, not a new one");
});

test("10. a retired document can never become ready again", () => {
  const lifecycle = new DocumentLifecycle();
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-A" });
  lifecycle.retireDocument({ captureInstanceId: instance, documentId: "doc-A" });

  const resurrectionAttempt = lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-A" });
  assert.equal(resurrectionAttempt?.state, "retired", "markDocumentReady on a retired document must be a no-op, never a resurrection");
});

test("11. same-document (SPA) navigation: reporting the same documentId with a new navigationVersion never creates a new document and leaves it ready", () => {
  const lifecycle = new DocumentLifecycle();
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  const readyRecord = lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-A" });

  const spaReport = lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A", navigationVersion: 1 });
  assert.equal(spaReport.generation, readyRecord?.generation, "still the same document, not a new one");
  assert.equal(spaReport.state, "ready", "an SPA route change never retires/reinstalls the document");
  assert.equal(spaReport.navigationVersion, 1);
});

test("12. a failed document rejects events", () => {
  const lifecycle = new DocumentLifecycle();
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  lifecycle.markDocumentFailed({ captureInstanceId: instance, documentId: "doc-A" }, "capture_script_injection_failed");

  const validation = lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "doc-A" });
  assert.equal(validation, "failed");
});

test("13. active document lookup is deterministic across repeated calls", () => {
  const lifecycle = new DocumentLifecycle();
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "doc-A" });

  const first = lifecycle.getActiveDocument();
  const second = lifecycle.getActiveDocument();
  assert.equal(first?.documentId, "doc-A");
  assert.equal(second?.documentId, "doc-A");
  assert.equal(first, second, "must return the exact same record on repeated lookups with no state change in between");
});

test("14. an unknown document is rejected distinctly, and document identity is generation-counter based -- never a positional index or an app-specific string", () => {
  const lifecycle = new DocumentLifecycle();
  const validation = lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "doc-never-registered" });
  assert.equal(validation, "unknown_document");

  const a = lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-A" });
  const b = lifecycle.registerDocument({ captureInstanceId: instance, documentId: "doc-B" });
  assert.equal(a.generation, 1);
  assert.equal(b.generation, 2, "generation is a monotonic counter, independent of any app/business identifier");
});

test("15. sibling frames remain ready concurrently while a navigation retires only its own frame", () => {
  const lifecycle = new DocumentLifecycle();
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "main-A", frameId: "main" });
  lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "main-A", frameId: "main" });
  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "iframe-B", frameId: "iframe" });
  lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "iframe-B", frameId: "iframe" });

  assert.equal(lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "main-A", frameId: "main" }), "active_ready");
  assert.equal(lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "iframe-B", frameId: "iframe" }), "active_ready");

  lifecycle.registerDocument({ captureInstanceId: instance, documentId: "iframe-D", frameId: "iframe" });
  assert.equal(lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "iframe-B", frameId: "iframe" }), "retired");
  assert.equal(lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "iframe-D", frameId: "iframe" }), "installing");
  lifecycle.markDocumentReady({ captureInstanceId: instance, documentId: "iframe-D", frameId: "iframe" });
  assert.equal(lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "iframe-D", frameId: "iframe" }), "active_ready");
  assert.equal(lifecycle.validateEventDocument({ captureInstanceId: instance, documentId: "main-A", frameId: "main" }), "active_ready");
});
