import assert from "node:assert/strict";
import test from "node:test";
import { matchCapturedValueForLabel } from "./captured-value-label";

const SHAPE = String.raw`^MPN\-\d+$`;
const captures = new Map([["event-1", { valueSelection: { valueShape: SHAPE } }]]);

test("a label with the shape of a value captured in this run is replaced by that run's value", () => {
  const values = new Map([["event-1", "MPN-3350"]]);
  assert.deepEqual(matchCapturedValueForLabel("MPN-3302", captures, values), { sourceEventRef: "event-1", value: "MPN-3350" });
  assert.deepEqual(matchCapturedValueForLabel("  MPN-3302 ", captures, values), { sourceEventRef: "event-1", value: "MPN-3350" });
});

test("labels that are not that kind of value are never replaced", () => {
  const values = new Map([["event-1", "MPN-3350"]]);
  for (const label of ["Siguiente", "Presionar MPN-3302", "MPN-3302 - Editar", "Página 2", "", undefined]) {
    assert.equal(matchCapturedValueForLabel(label, captures, values), undefined, String(label));
  }
});

test("nothing is replaced before the value was captured in this run or without a recorded shape", () => {
  assert.equal(matchCapturedValueForLabel("MPN-3302", captures, new Map()), undefined);
  assert.equal(matchCapturedValueForLabel("MPN-3302", new Map([["event-1", { valueSelection: {} }]]), new Map([["event-1", "MPN-3350"]])), undefined);
});

test("a purely numeric shape is ignored so page numbers and amounts are never rewritten", () => {
  const numeric = new Map([["event-1", { valueSelection: { valueShape: String.raw`^\d+$` } }]]);
  assert.equal(matchCapturedValueForLabel("2", numeric, new Map([["event-1", "3350"]])), undefined);
});

test("when two captured values share a shape the latest capture wins", () => {
  const two = new Map([["event-1", { valueSelection: { valueShape: SHAPE } }], ["event-9", { valueSelection: { valueShape: SHAPE } }]]);
  const values = new Map([["event-1", "MPN-1"], ["event-9", "MPN-2"]]);
  assert.equal(matchCapturedValueForLabel("MPN-77", two, values)?.value, "MPN-2");
});

test("the captured value must itself have the shape", () => {
  assert.equal(matchCapturedValueForLabel("MPN-3302", captures, new Map([["event-1", "Pendiente"]])), undefined);
});
