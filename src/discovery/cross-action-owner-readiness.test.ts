import assert from "node:assert/strict";
import test from "node:test";
import { crossActionOwnerReadinessRequired } from "./case-discovery";

const action = (associatedField: string | undefined, recordingActionType: "fill" | "click" | "select") => ({
  target: "text:target",
  associatedField,
  technicalTargetRefs: [],
  recordingActionType,
});

/**
 * FIRST_LOSS (job 0e6a5c54-99b3-4985-93d8-a1196bd0a6fb, actionIndex=4, target="Solicitud
 * multiproducto"): the previous action's completion peeked the next action ("Número de
 * identificación", a structured `fill`) via the generic `resolveActionTarget` cross-action peek,
 * even though that fill already has its own authoritative readiness wait
 * (`waitForFillTargetReadiness`, run when its own turn comes and known to physically progress
 * from `field_owner_not_materializable` to `resolved`). The generic peek never saw that wait and
 * the previous action stalled to `loading_timeout` waiting on a readiness the fill would have
 * handled itself.
 */

test("1/nextFillDoesNotBlockPrevious. a next fill action with a real associatedField has its own readiness -- the previous action's cross-action peek is not required", () => {
  const result = crossActionOwnerReadinessRequired(action("Número de identificación", "fill"));
  assert.equal(result, false);
});

test("2/categoryOwnerStillBlockedWhenNotReady. a next click/select field-scoped owner with no self-readiness equivalent still requires the cross-action peek (Categoría de producto's guard is unaffected)", () => {
  const result = crossActionOwnerReadinessRequired(action("Categoría de producto", "click"));
  assert.equal(result, true);
});

test("3/selectActionAlsoStillBlocked. a next \"select\" action (not \"fill\") also has no exemption -- only fill has its own self-readiness mechanism", () => {
  const result = crossActionOwnerReadinessRequired(action("Producto", "select"));
  assert.equal(result, true);
});

test("4/genericUnresolvedFillLabelStillBlocked. a fill action whose associatedField is a generic/unresolved label (not a real field relation) does NOT get the exemption -- isGenericUnresolvedLabel is reused, never bypassed", () => {
  const result = crossActionOwnerReadinessRequired(action("...", "fill"));
  assert.equal(result, true);
});

test("5/noAssociatedFieldNeverBlocks. a next action with no associatedField at all never requires cross-action readiness, regardless of kind", () => {
  assert.equal(crossActionOwnerReadinessRequired(action(undefined, "click")), false);
  assert.equal(crossActionOwnerReadinessRequired(undefined), false);
});

test("6/multiproject. no target text/app hardcode governs the decision -- driven purely by recordingActionType and associatedField presence", () => {
  const anyFillField = crossActionOwnerReadinessRequired(action("Whatever Field Name", "fill"));
  const anyClickField = crossActionOwnerReadinessRequired(action("Whatever Field Name", "click"));
  assert.equal(anyFillField, false);
  assert.equal(anyClickField, true);
});
