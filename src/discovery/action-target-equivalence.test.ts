import assert from "node:assert/strict";
import test from "node:test";
import { areEquivalentActionTargets } from "./action-target-equivalence";

test("does not deduplicate compound actions that share a target label", () => {
  assert.equal(areEquivalentActionTargets(
    { actionType: "action_select", target: "Ingresos", valueKey: "ingresos_seleccion" },
    { actionType: "action_fill", target: "Ingresos", valueKey: "ingresos_valor" },
  ), false);
});

test("does not deduplicate check and click actions with the same label", () => {
  assert.equal(areEquivalentActionTargets(
    { actionType: "action_click", recordingActionType: "check", target: "Seleccionar fila", valueKey: "row.selection" },
    { actionType: "action_click", recordingActionType: "click", target: "Seleccionar fila", valueKey: "row.selection" },
  ), false);
});

test("deduplicates only identical structured consecutive actions", () => {
  assert.equal(areEquivalentActionTargets(
    { actionType: "action_click", target: "Ingresos", technicalTargetRefs: ["role:button:Ingresos"] },
    { actionType: "action_click", target: " ingresos ", technicalTargetRefs: ["role:button:Ingresos"] },
  ), true);
});

import { deduplicateActionTargetsBySource, isTrueSourceDuplicate, shareSourceInteraction, type ActionTargetIdentityLike } from "./action-target-equivalence";

function click(target: string, sourceInteractionId?: string, extra: Partial<ActionTargetIdentityLike> = {}): ActionTargetIdentityLike {
  return { actionType: "action_click", recordingActionType: "click", target, technicalTargetRefs: [`role:button|${target}`], ...(sourceInteractionId ? { sourceInteractionId } : {}), ...extra };
}

test("two independent interactions on the same target are both preserved", () => {
  const out = deduplicateActionTargetsBySource([click("X", "A"), click("X", "B")]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((a) => a.sourceInteractionId), ["A", "B"]);
});

test("three independent interactions on the same target are all preserved", () => {
  const out = deduplicateActionTargetsBySource([click("X", "A"), click("X", "B"), click("X", "C")]);
  assert.equal(out.length, 3);
});

test("two projections of the SAME source interaction are deduplicated to one", () => {
  const out = deduplicateActionTargetsBySource([click("X", "A"), click("X", "A")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].sourceInteractionId, "A");
});

test("same target / different source is never deduplicated", () => {
  assert.equal(shareSourceInteraction(click("X", "A"), click("X", "B")), false);
  assert.equal(isTrueSourceDuplicate(click("X", "A"), click("X", "B")), false);
  assert.equal(deduplicateActionTargetsBySource([click("X", "A"), click("X", "B")]).length, 2);
});

test("same source but non-equivalent representation is preserved (equivalence is auxiliary)", () => {
  assert.equal(isTrueSourceDuplicate(click("X", "A"), click("Y", "A")), false);
  assert.equal(deduplicateActionTargetsBySource([click("X", "A"), click("Y", "A")]).length, 2);
});

test("missing source identity never deduplicates", () => {
  assert.equal(shareSourceInteraction(click("X"), click("X")), false);
  assert.equal(deduplicateActionTargetsBySource([click("X"), click("X")]).length, 2);
});

test("an empty/whitespace source identity never counts as a match", () => {
  assert.equal(shareSourceInteraction(click("X", "  "), click("X", "  ")), false);
  assert.equal(deduplicateActionTargetsBySource([click("X", ""), click("X", "")]).length, 2);
});

test("time-like proximity is never an authority: different sources 10ms apart are preserved; same source 2s apart is deduplicated", () => {
  const fastDistinct = deduplicateActionTargetsBySource([click("2", "A", { t: 100 } as any), click("2", "B", { t: 110 } as any)]);
  assert.equal(fastDistinct.length, 2, "proximity must never merge two distinct sources");
  const slowSame = deduplicateActionTargetsBySource([click("2", "A", { t: 100 } as any), click("2", "A", { t: 2100 } as any)]);
  assert.equal(slowSame.length, 1, "same source deduplicates regardless of the time gap");
});

test("order is preserved for a mixed sequence", () => {
  const out = deduplicateActionTargetsBySource([
    click("X", "A"), click("X", "B"), click("Y", "C"), click("Z", "D"), click("Z", "E"), click("W", "F"),
  ]);
  assert.deepEqual(out.map((a) => a.target), ["X", "X", "Y", "Z", "Z", "W"]);
});

test("kiosko-shaped generic fixture: independent repeated digits keep multiplicity and order", () => {
  const digits = ["4", "0", "2", "2", "4", "6", "7", "9", "5", "5", "1"];
  const input = digits.map((target, index) => click(target, `interaction-${index + 1}`));
  const out = deduplicateActionTargetsBySource(input);
  assert.deepEqual(out.map((a) => a.target), digits, "both 2s and both 5s are preserved, order intact");
  assert.equal(out.length, 11);
});

test("a true duplicate among independent repeats is deduplicated without disturbing the rest", () => {
  const out = deduplicateActionTargetsBySource([
    click("2", "A"), click("2", "B"), click("X", "C"), click("X", "C"), click("Y", "D"),
  ]);
  assert.deepEqual(out.map((a) => a.target), ["2", "2", "X", "Y"]);
  assert.deepEqual(out.map((a) => a.sourceInteractionId), ["A", "B", "C", "D"]);
});
