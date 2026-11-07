import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "src");

test("recording replay keeps Discovery data separate from promotion/spec data", () => {
  const workflow = fs.readFileSync(path.join(root, "discovery", "case-discovery-workflow.ts"), "utf8");
  const preview = fs.readFileSync(path.join(root, "cli", "discovery-preview.ts"), "utf8");

  assert.match(workflow, /runtimeEntries:\s*options\.promotionRuntimeEntries\s*\?\?\s*options\.runtimeEntries/);
  assert.match(workflow, /verificationRuntimeEntries:\s*options\.promotionRuntimeEntries/);
  assert.match(preview, /promotionRuntimeEntries:\s*promotionRuntimeEntries\.length\s*>\s*0\s*\?\s*promotionRuntimeEntries\s*:\s*undefined/);
  assert.match(preview, /runtimeEntries:\s*recordingRuntimeEntries/);
});
