import assert from "node:assert/strict";
import test from "node:test";
import { sliceRecordedValueSelection } from "./recorded-runtime-actions";

const base = { sourceKind: "text" as const, startOffset: 0, endOffset: 8, endAtSourceEnd: false };

test("end anchor: a value that grows between runs is cut at the stable text that followed it", () => {
  const selection = { ...base, endContext: " - Editar" };
  assert.equal(sliceRecordedValueSelection("MPN-3319 - Editar", selection), "MPN-3319");
  assert.equal(sliceRecordedValueSelection("MPN-10000 - Editar", selection), "MPN-10000");
  assert.equal(sliceRecordedValueSelection("MPN-99 - Editar", selection), "MPN-99");
});

test("end anchor: when the stable text is gone replay stops instead of returning a clipped value", () => {
  assert.throws(
    () => sliceRecordedValueSelection("MPN-10000", { ...base, endContext: " - Editar" }),
    /RECORDED_VALUE_SELECTION_ANCHOR_NOT_FOUND/,
  );
});

test("end anchor: recordings without it keep the offset-only behaviour", () => {
  assert.equal(sliceRecordedValueSelection("MPN-3319 - Editar", base), "MPN-3319");
  assert.equal(sliceRecordedValueSelection("MPN-10000 - Editar", base), "MPN-1000");
});

test("end anchor: a selection recorded at the end of the source ignores the anchor", () => {
  assert.equal(
    sliceRecordedValueSelection("Solicitud MPN-10000", { sourceKind: "text", startOffset: 10, endOffset: 18, endAtSourceEnd: true, endContext: " x" }),
    "MPN-10000",
  );
});

test("value shape: the same kind of value passes, another kind of text is refused", () => {
  const selection = { sourceKind: "text" as const, startOffset: 0, endOffset: 8, endAtSourceEnd: true, valueShape: "^MPN\\-\\d+$" };
  assert.equal(sliceRecordedValueSelection("MPN-3319", selection), "MPN-3319");
  assert.equal(sliceRecordedValueSelection("MPN-10000", selection), "MPN-10000");
  assert.throws(() => sliceRecordedValueSelection("Pendiente", { ...selection, endOffset: 9 }), /RECORDED_VALUE_SHAPE_MISMATCH/);
  assert.equal(sliceRecordedValueSelection("anything", { ...selection, endOffset: 8, valueShape: undefined }), "anything");
});
