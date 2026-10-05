import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveRunEvidenceScenarioDirs } from "./discovery-preview";

test("run evidence consolidation finds same-job scenarios when the section slug differs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "discovery-preview-evidence-"));
  try {
    const expected = path.join(root, "kiosko", "default-section", "runs", "job-1", "scenarios");
    const differentRun = path.join(root, "kiosko", "default-section", "runs", "job-2", "scenarios");
    const differentApp = path.join(root, "another-app", "default-section", "runs", "job-1", "scenarios");
    await fs.mkdir(path.join(expected, "PREVIEW-001"), { recursive: true });
    await fs.mkdir(path.join(differentRun, "PREVIEW-002"), { recursive: true });
    await fs.mkdir(path.join(differentApp, "PREVIEW-003"), { recursive: true });

    const dirs = await resolveRunEvidenceScenarioDirs(root, "kiosko", "4755", "job-1");

    assert.ok(dirs.includes(expected));
    assert.ok(dirs.includes(path.join(root, "kiosko", "4755", "runs", "job-1", "scenarios")));
    assert.equal(dirs.some((dir) => dir.includes("job-2")), false);
    assert.equal(dirs.some((dir) => dir.includes("another-app")), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
