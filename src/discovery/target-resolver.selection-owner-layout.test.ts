import assert from "node:assert/strict";
import test from "node:test";
import { chooseUniqueNearestSelectionOwner, resolveValueBackedSelectionField, type SelectionOwnerRect } from "./target-resolver";

const owner = (id: string, x: number, y: number): { id: string; rect: SelectionOwnerRect } => ({
  id,
  rect: { x, y, width: 240, height: 48 },
});

test("custom selector columns bind to the uniquely nearest visible field caption", () => {
  const labelRect = { x: 80, y: 200, width: 120, height: 20 };
  const left = owner("origin", 40, 232);
  const right = owner("destination", 430, 232);
  assert.equal(chooseUniqueNearestSelectionOwner(labelRect, [left, right])?.id, "origin");
  assert.equal(chooseUniqueNearestSelectionOwner({ ...labelRect, x: 470 }, [left, right])?.id, "destination");
});

test("layout association fails closed when owners are tied or far from the label", () => {
  const labelRect = { x: 200, y: 200, width: 120, height: 20 };
  assert.equal(chooseUniqueNearestSelectionOwner(labelRect, [owner("left", 60, 232), owner("right", 220, 232)]), undefined);
  assert.equal(chooseUniqueNearestSelectionOwner(labelRect, [owner("far", 900, 700)]), undefined);
  assert.equal(chooseUniqueNearestSelectionOwner(labelRect, []), undefined);
});

test("value-backed select action uses its authored target as field label when no separate field is supplied", () => {
  assert.equal(resolveValueBackedSelectionField({
    target: "Cuenta de origen",
    actionType: "action_select",
    selectionValue: "synthetic account",
  }), "Cuenta de origen");
  assert.equal(resolveValueBackedSelectionField({
    target: "Option text",
    actionType: "action_click",
    selectionValue: "synthetic account",
  }), undefined);
  assert.equal(resolveValueBackedSelectionField({
    target: "Target",
    associatedField: "Observed field",
    actionType: "action_select",
    selectionValue: "value",
  }), "Observed field");
});
