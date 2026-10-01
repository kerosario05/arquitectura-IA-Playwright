import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ORCHESTRATOR_CHECKPOINT_FILES, readRepositoryCheckpoint } from "./repo-checkpoint";

test("repository checkpoint loads complete contents of all authoritative guidance files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-checkpoint-"));
  try {
    for (const relativePath of ORCHESTRATOR_CHECKPOINT_FILES) {
      const file = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${relativePath}\n${"full-content ".repeat(1500)}`, "utf8");
    }
    const loaded = readRepositoryCheckpoint(root);
    for (const relativePath of ORCHESTRATOR_CHECKPOINT_FILES) {
      assert.ok(loaded.includes(`--- ${relativePath} ---`));
      assert.ok(loaded.includes(`${relativePath}\n${"full-content ".repeat(1500)}`));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
