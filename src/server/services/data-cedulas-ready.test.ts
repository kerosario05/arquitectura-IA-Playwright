import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dataCedulasReadyEnabled, holdReadyCedulas, listReadyCedulas } from "./data-cedulas-ready";

function setup(state: object) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ready-"));
  const stateFile = path.join(dir, "state.json");
  const takenFile = path.join(dir, "taken.json");
  fs.writeFileSync(stateFile, JSON.stringify(state));
  return { stateFile, takenFile, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const now = new Date("2026-11-03T12:00:00Z");

test("excluded, expired and held cédulas are not offered; the rest are", () => {
  const { stateFile, takenFile, done } = setup({
    approved: ["001", "002", "003", "004"],
    approvedAt: { "001": "2026-11-02T00:00:00Z", "002": "2026-11-02T00:00:00Z", "003": "2026-11-02T00:00:00Z", "004": "2026-09-01T00:00:00Z" },
  });
  try {
    holdReadyCedulas(["002"], { now: new Date("2026-11-03T11:00:00Z"), takenFile });
    const ids = listReadyCedulas({ excluded: ["001"], now, stateFile, takenFile, random: () => 0 });
    assert.deepEqual(ids, ["003"]);
  } finally { done(); }
});

test("a hold expires after the hold time and the cédula returns to the pool", () => {
  const { stateFile, takenFile, done } = setup({ approved: ["005"], approvedAt: { "005": "2026-11-02T00:00:00Z" } });
  try {
    holdReadyCedulas(["005"], { now: new Date("2026-11-03T08:00:00Z"), takenFile });
    assert.deepEqual(listReadyCedulas({ now, stateFile, takenFile }), ["005"]);
    holdReadyCedulas(["005"], { now: new Date("2026-11-03T11:30:00Z"), takenFile });
    assert.deepEqual(listReadyCedulas({ now, stateFile, takenFile }), []);
  } finally { done(); }
});

test("a missing state file offers nothing and using the stock is on by default", () => {
  assert.deepEqual(listReadyCedulas({ stateFile: path.join(os.tmpdir(), "no-such-state.json"), takenFile: path.join(os.tmpdir(), "no-such-taken.json") }), []);
  assert.equal(dataCedulasReadyEnabled({} as any), true);
  assert.equal(dataCedulasReadyEnabled({ DATA_CEDULAS_USE_READY: "false" } as any), false);
});
