import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listTestFiles, resolveTestFile, saveTestFile, validateTestFile } from "./test-file-store";

test("project fixture storage persists bytes and refuses invalid types or cross-project lookup", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-lab-file-fixture-"));
  const previousRoot = process.env.TEST_FILE_STORAGE_DIR;
  process.env.TEST_FILE_STORAGE_DIR = root;
  try {
    const bytes = Buffer.from("synthetic PDF fixture");
    const asset = await saveTestFile({ projectSlug: "profile-a", filename: "formulario.pdf", contentType: "application/pdf", bytes });
    assert.deepEqual(await listTestFiles("profile-a"), [asset]);

    const stored = await resolveTestFile("profile-a", asset.fileRef);
    assert.equal(stored.filename, "formulario.pdf");
    assert.equal(stored.contentType, "application/pdf");
    assert.deepEqual(await fs.readFile(stored.path), bytes);
    await assert.rejects(resolveTestFile("profile-b", asset.fileRef), /El archivo asociado no está disponible/);
    await fs.writeFile(stored.path, Buffer.from("tampered fixture"));
    await assert.rejects(resolveTestFile("profile-a", asset.fileRef), /El archivo asociado no está disponible/);
    assert.throws(() => validateTestFile("script.pdf", "text/html", 20), /Tipo de archivo no permitido/);
  } finally {
    if (previousRoot === undefined) delete process.env.TEST_FILE_STORAGE_DIR;
    else process.env.TEST_FILE_STORAGE_DIR = previousRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
});

