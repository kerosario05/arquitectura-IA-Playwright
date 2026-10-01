import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseQaLabReference } from "./qa-lab-reference";
import { enrichRecordingReference } from "./qa-lab-reference-context";

test("recording context resolves its exact project and excludes sensitive recorded entry steps", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-recording-reference-"));
  const recordingId = "recording-123";
  const folder = path.join(root, "automations", "apps", "roke", "recordings", recordingId);
  fs.mkdirSync(folder, { recursive: true });
  try {
    fs.writeFileSync(path.join(folder, "scenarios.json"), JSON.stringify([{ webSteps: [
      { action: "navigate", value: "https://example.test/" },
      { action: "click", target: { value: "button|Products" } },
      { action: "click", target: { value: "button|1234" } },
      { action: "click", target: { value: "button|Continue" } },
    ] }]));
    const reference = parseQaLabReference(`recordingId=${recordingId}. Luego reanuda.`)!;
    const resolved = enrichRecordingReference(root, reference);
    assert.equal(resolved.projectSlug, "roke");
    assert.equal(resolved.runtimeUrl, "https://example.test/");
    assert.deepEqual(resolved.steps, ["navigate https://example.test/", 'click "Products"']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
