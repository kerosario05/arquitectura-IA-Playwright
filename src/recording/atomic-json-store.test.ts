import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { writeRecordingJson } from "./atomic-json-store";

function temporaryStore(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recording-json-test-"));
  try { run(dir); } finally {
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("recording-json-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

test("replaces an existing complete JSON and leaves no temporary files", () => temporaryStore(dir => {
  const file = path.join(dir, "scenarios.json");
  writeRecordingJson(file, [{ scenarioId: "one" }]);
  writeRecordingJson(file, [{ scenarioId: "one", testRailCaseId: 42 }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), [{ scenarioId: "one", testRailCaseId: 42 }]);
  assert.deepEqual(fs.readdirSync(dir), ["scenarios.json"]);
}));

test("serialization failure preserves the original file", () => temporaryStore(dir => {
  const file = path.join(dir, "scenarios.json");
  fs.writeFileSync(file, '[{"scenarioId":"original"}]');
  const cyclic: any = {}; cyclic.self = cyclic;
  assert.throws(() => writeRecordingJson(file, cyclic));
  assert.equal(fs.readFileSync(file, "utf8"), '[{"scenarioId":"original"}]');
  assert.deepEqual(fs.readdirSync(dir), ["scenarios.json"]);
}));

test("replacement failure propagates and cleans its temporary file", () => temporaryStore(dir => {
  const file = path.join(dir, "scenarios.json");
  fs.mkdirSync(file);
  fs.writeFileSync(path.join(file, "preserved"), "original");
  assert.throws(() => writeRecordingJson(file, []));
  assert.equal(fs.readFileSync(path.join(file, "preserved"), "utf8"), "original");
  assert.deepEqual(fs.readdirSync(dir), ["scenarios.json"]);
}));
