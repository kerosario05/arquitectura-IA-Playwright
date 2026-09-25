import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(__dirname, "scenario-preview-runner.ts"), "utf8");

test("QA Lab headed debug is opt-in and preserves headless default", () => {
  assert.match(source, /QA_LAB_DISCOVERY_HEADED/);
  assert.match(source, /opts\.headed === true/);
  assert.match(source, /AUTOMATION_HEADLESS: headed \? "false" : "true"/);
  assert.match(source, /HEADLESS: headed \? "false" : "true"/);
});

test("headed debug only adds the existing discovery --headed flag", () => {
  assert.match(source, /if \(headed\) args\.push\("--headed"\)/);
  const launchBlock = source.slice(source.indexOf("const opts = p.options"), source.indexOf("jobStore.appendLog(jobId, `[run:scenario-preview] spawning"));
  assert.doesNotMatch(launchBlock, /waitForTimeout|setTimeout/);
});
