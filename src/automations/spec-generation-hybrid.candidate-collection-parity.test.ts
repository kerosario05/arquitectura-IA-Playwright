import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareCandidateValidationCopy } from "./spec-generation-hybrid";

/**
 * FIRST_LOSS (jobId 851ec7ba-bebf-4e6f-a1bb-7f80a65758ff): `defaultRunFunctionalExecution` ran
 * the raw candidate.spec.ts directly from its real `cases/<case>/spec-generation/` location,
 * while `defaultRunPlaywrightDiscovery` validated a REBASED copy in the physical case directory
 * (candidate imports are written assuming that eventual promoted location, not the current
 * spec-generation subdirectory). Running the raw file made Playwright's own import resolution
 * fail while collecting it, surfacing as `runner_no_tests_found` even though the exact same file
 * was already proven collectible by playwrightDiscovery through the rebased copy. Fixed by
 * extracting that rebase-and-copy step into `prepareCandidateValidationCopy` and having BOTH
 * stages validate the identical copy.
 */

async function withTempCase(fn: (paths: { caseDir: string; specGenDir: string; pageObjectPath: string }) => Promise<void>) {
  const caseDir = await fsp.mkdtemp(path.join(os.tmpdir(), "candidate-parity-"));
  const specGenDir = path.join(caseDir, "spec-generation");
  await fsp.mkdir(specGenDir, { recursive: true });
  const pageObjectPath = path.join(caseDir, "form.page.ts");
  await fsp.writeFile(pageObjectPath, "export class FormPage {}", "utf8");
  try {
    await fn({ caseDir, specGenDir, pageObjectPath });
  } finally {
    await fsp.rm(caseDir, { recursive: true, force: true });
  }
}

test("1/rebasesCandidateRelativeImport. an import written relative to spec-generation/ is rebased to resolve from the physical case directory", async () => {
  await withTempCase(async ({ specGenDir }) => {
    const candidatePath = path.join(specGenDir, "candidate.spec.ts");
    await fsp.writeFile(candidatePath, `import { FormPage } from "../form.page";\n`, "utf8");
    const { validationPath, cleanup } = await prepareCandidateValidationCopy(candidatePath);
    try {
      assert.notEqual(validationPath, candidatePath, "a candidate must be validated through a rebased copy, not the raw file");
      const content = await fsp.readFile(validationPath, "utf8");
      assert.match(content, /from ["']\.\/form\.page["']/);
    } finally {
      await cleanup();
    }
  });
});

test("2/rebasesPhysicalRelativeImport. an import already written relative to the physical case dir is preserved unchanged", async () => {
  await withTempCase(async ({ specGenDir }) => {
    const candidatePath = path.join(specGenDir, "candidate.spec.ts");
    await fsp.writeFile(candidatePath, `import { FormPage } from "./form.page";\n`, "utf8");
    const { validationPath, cleanup } = await prepareCandidateValidationCopy(candidatePath);
    try {
      const content = await fsp.readFile(validationPath, "utf8");
      assert.match(content, /from ["']\.\/form\.page["']/);
    } finally {
      await cleanup();
    }
  });
});

test("3/validationCopyNamingConvention. the copy is written into the physical case directory using the dot-prefixed candidate-validation naming convention", async () => {
  await withTempCase(async ({ caseDir, specGenDir }) => {
    const candidatePath = path.join(specGenDir, "candidate.spec.ts");
    await fsp.writeFile(candidatePath, `import { FormPage } from "./form.page";\n`, "utf8");
    const { validationPath, cleanup } = await prepareCandidateValidationCopy(candidatePath);
    try {
      assert.equal(path.dirname(validationPath), caseDir);
      assert.match(path.basename(validationPath), /^\.candidate-validation-\d+-\d+\.spec\.ts$/);
    } finally {
      await cleanup();
    }
  });
});

test("4/nonCandidatePassthrough. a non-candidate spec (case.spec.ts, not under spec-generation/) is used as-is, no copy created", async () => {
  await withTempCase(async ({ caseDir }) => {
    const specPath = path.join(caseDir, "case.spec.ts");
    await fsp.writeFile(specPath, `import { FormPage } from "./form.page";\n`, "utf8");
    const { validationPath, cleanup } = await prepareCandidateValidationCopy(specPath);
    try {
      assert.equal(path.resolve(validationPath), path.resolve(specPath));
    } finally {
      await cleanup();
    }
  });
});

test("5/cleanupRemovesCopy. cleanup() removes the temporary validation copy but never the original candidate", async () => {
  await withTempCase(async ({ specGenDir }) => {
    const candidatePath = path.join(specGenDir, "candidate.spec.ts");
    await fsp.writeFile(candidatePath, `import { FormPage } from "./form.page";\n`, "utf8");
    const { validationPath, cleanup } = await prepareCandidateValidationCopy(candidatePath);
    await cleanup();
    assert.equal(fs.existsSync(validationPath), false);
    assert.equal(fs.existsSync(candidatePath), true);
  });
});

test("6/sharedBySameHelper. both defaultRunPlaywrightDiscovery and defaultRunFunctionalExecution use the identical shared helper -- no divergent parallel logic", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "spec-generation-hybrid.ts"), "utf8");
  const discoveryStart = source.indexOf("export async function defaultRunPlaywrightDiscovery(");
  const discoveryEnd = source.indexOf("\nfunction countDiscoveredTests", discoveryStart);
  const discoveryFn = source.slice(discoveryStart, discoveryEnd);
  assert.match(discoveryFn, /await prepareCandidateValidationCopy\(specPath\)/);

  const functionalStart = source.indexOf("async function defaultRunFunctionalExecution(");
  const functionalEnd = source.indexOf("\nfunction countDiscoveredTests", functionalStart);
  const functionalFn = source.slice(functionalStart, functionalEnd);
  assert.match(functionalFn, /await prepareCandidateValidationCopy\(specPath\)/);

  const helperDefinitions = source.match(/prepareCandidateValidationCopy\(specPath: string\)/g) ?? [];
  assert.equal(helperDefinitions.length, 1, "expected exactly one shared implementation, no duplicate/parallel rebase logic");
});

test("7/candidateConfigMatchesSharedNamingConvention. playwright.config.apps.candidate.ts's testMatch accepts the exact validation-copy naming convention prepareCandidateValidationCopy uses", () => {
  const configSource = fs.readFileSync(path.resolve(__dirname, "../../playwright.config.apps.candidate.ts"), "utf8");
  assert.match(configSource, /\*\*\/cases\/\*\/\.candidate-validation-\*\.spec\.ts/);
});

test("8/multiproject. no app/case-name hardcode was introduced by this fix", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "spec-generation-hybrid.ts"), "utf8");
  const start = source.indexOf("export async function prepareCandidateValidationCopy(");
  const end = source.indexOf("\nexport async function defaultRunPlaywrightDiscovery", start);
  const fn = source.slice(start, end);
  assert.doesNotMatch(fn, /portal-comercial/i);
  assert.doesNotMatch(fn, /FormPage/);
});
