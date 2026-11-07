import assert from "node:assert/strict";
import test from "node:test";
import { detectSelectionTriggerEvidence, resolveSelectionFieldOwnerLabel } from "./selection-trigger-evidence";

test("native selects and comboboxes retain their existing selector classification", () => {
  assert.equal(detectSelectionTriggerEvidence({ tag: "select" }), "native_select");
  assert.equal(detectSelectionTriggerEvidence({ tag: "span", role: "combobox" }), "native_select");
});

test("a custom trigger is a selector only with an explicit popup/listbox relation", () => {
  assert.equal(detectSelectionTriggerEvidence({ tag: "button", role: "button", ariaHasPopup: "listbox" }), "aria_popup");
  assert.equal(detectSelectionTriggerEvidence({ tag: "button", role: "button", controlledRoles: ["listbox"] }), "aria_popup");
  assert.equal(detectSelectionTriggerEvidence({ tag: "button", role: "button", controlledRoles: ["listbox", "listbox"] }), undefined);
  assert.equal(detectSelectionTriggerEvidence({ tag: "button", role: "button", ariaHasPopup: "dialog" }), undefined);
  assert.equal(detectSelectionTriggerEvidence({ tag: "button", role: "button" }), undefined);
});

test("custom selector field labels require explicit ownership or one control and one visible label", () => {
  assert.equal(resolveSelectionFieldOwnerLabel({
    interactiveControlCount: 1,
    ownerIsOnlyControl: true,
    visibleLabelCandidates: ["Moneda"],
  }), "Moneda");
  assert.equal(resolveSelectionFieldOwnerLabel({
    explicitFieldOwner: "Currency",
    interactiveControlCount: 3,
    ownerIsOnlyControl: false,
    visibleLabelCandidates: ["Other"],
  }), "Currency");
  assert.equal(resolveSelectionFieldOwnerLabel({
    interactiveControlCount: 2,
    ownerIsOnlyControl: false,
    visibleLabelCandidates: ["Moneda"],
  }), undefined);
  assert.equal(resolveSelectionFieldOwnerLabel({
    interactiveControlCount: 1,
    ownerIsOnlyControl: true,
    visibleLabelCandidates: ["Moneda", "Otra etiqueta"],
  }), undefined);
});
