import assert from "node:assert/strict";
import test from "node:test";
import { confirmedCompoundSelectionBefore, logicalCompoundChildValue } from "./compound-value";

test("compound logical child is separated only from a confirmed selection", () => {
  assert.equal(logicalCompoundChildValue("DOP 15000", "DOP"), "15000");
  assert.equal(logicalCompoundChildValue("USD 75", "USD"), "75");
  assert.equal(logicalCompoundChildValue("15000", "DOP"), undefined);
  assert.equal(logicalCompoundChildValue("DOP 15000", undefined), undefined);
});

test("compound selection lineage uses structural context instead of event position", () => {
  const events = [
    {
      seq: 10,
      t: 1,
      kind: "tap",
      screenKey: "screen",
      target: { compoundRole: "selection", associatedField: "Ingresos", cellRef: "cell:income", rowIdentity: "row:1", afterValue: "DOP" },
    },
    {
      seq: 11,
      t: 2,
      kind: "fill",
      screenKey: "screen",
      target: { compoundRole: "amount_or_text", associatedField: "Ingresos", cellRef: "cell:income", rowIdentity: "row:1" },
    },
  ] as never;
  assert.equal(confirmedCompoundSelectionBefore(events, 1, events[1].target), "DOP");
});
