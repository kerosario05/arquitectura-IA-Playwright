import assert from "node:assert/strict";
import test from "node:test";
import { detectPostClickUiChange } from "./post-click-ui-change-detector";
import type { PageSnapshot } from "../types/page-snapshot.types";

function snapshot(elements: Array<Record<string, unknown>>): PageSnapshot {
  return {
    version: "1.0",
    capturedAt: new Date().toISOString(),
    url: "https://app.test/requests/123/edit",
    title: "fixture",
    summary: { totalElements: elements.length, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    elements,
  } as PageSnapshot;
}

test("pre-existing form controls are not evidence that a click opened a form", async () => {
  const existingForm = snapshot([
    { id: "name", type: "textbox", role: "textbox", tagName: "input", text: "Nombre", visible: true },
    { id: "amount", type: "textbox", role: "textbox", tagName: "input", text: "Monto", visible: true },
    { id: "continue", type: "button", role: "button", tagName: "button", text: "Continuar", visible: true },
  ]);
  const result = await detectPostClickUiChange({
    page: {} as never,
    target: "Gestión Documental 9",
    actionText: 'Presionar "Gestión Documental 9"',
    beforeSnapshot: existingForm,
    afterSnapshot: existingForm,
    nextTargets: ["Firma manual"],
  });
  assert.equal(result.success, false);
  assert.equal(result.reason, undefined);
});

test("a newly visible next target is evidence only when it was not already visible", async () => {
  const before = snapshot([{ id: "manage", type: "button", role: "button", tagName: "button", text: "Gestión Documental", visible: true }]);
  const after = snapshot([
    { id: "manage", type: "button", role: "button", tagName: "button", text: "Gestión Documental", visible: true },
    { id: "signature", type: "radio", role: "radio", tagName: "input", text: "Firma manual", visible: true },
  ]);
  const result = await detectPostClickUiChange({
    page: {} as never,
    target: "Gestión Documental",
    actionText: 'Presionar "Gestión Documental"',
    beforeSnapshot: before,
    afterSnapshot: after,
    nextTargets: ["Firma manual"],
  });
  assert.equal(result.success, true);
  assert.equal(result.reason, "next_targets_visible");
});

test("a target that was already visible before the click is not a new outcome", async () => {
  const before = snapshot([{ id: "signature", type: "radio", role: "radio", tagName: "input", text: "Firma manual", visible: true }]);
  const after = snapshot([{ id: "signature", type: "radio", role: "radio", tagName: "input", text: "Firma manual", visible: true }]);
  const result = await detectPostClickUiChange({
    page: {} as never,
    target: "Gestión Documental",
    actionText: 'Presionar "Gestión Documental"',
    beforeSnapshot: before,
    afterSnapshot: after,
    nextTargets: ["Firma manual"],
  });
  assert.equal(result.success, false);
});
