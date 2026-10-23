import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { persistCandidateSpecIfChanged, writeCandidateSpecAtomically } from "./spec-generation-hybrid";

test("candidate writes atomically replace an existing file and leave no staging files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-atomic-"));
  try {
    const candidate = path.join(root, "case", "spec-generation", "candidate.spec.ts");
    await fs.mkdir(path.dirname(candidate), { recursive: true });
    await fs.writeFile(candidate, "previous candidate", "utf-8");

    const replacement = "complete validated candidate\n".repeat(2048);
    await writeCandidateSpecAtomically(candidate, replacement);

    assert.equal(await fs.readFile(candidate, "utf-8"), replacement);
    assert.deepEqual(await fs.readdir(path.dirname(candidate)), ["candidate.spec.ts"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("final candidate persistence skips a rewrite when validation already stored identical bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-persist-"));
  try {
    const candidate = path.join(root, "case", "spec-generation", "candidate.spec.ts");
    await fs.mkdir(path.dirname(candidate), { recursive: true });
    const validated = "import { test } from '@playwright/test';\ntest('case', async () => {});\n";
    await fs.writeFile(candidate, validated, "utf-8");

    assert.equal(await persistCandidateSpecIfChanged(candidate, validated), false);
    assert.equal(await fs.readFile(candidate, "utf-8"), validated);

    const final = `${validated}// final artifact\n`;
    assert.equal(await persistCandidateSpecIfChanged(candidate, final), true);
    assert.equal(await fs.readFile(candidate, "utf-8"), final);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
