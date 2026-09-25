import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { defaultRunPlaywrightDiscovery } from "./spec-generation-hybrid";
import { compileDeterministicSpec } from "./spec-compiler/deterministic-spec-compiler";
import { buildSpecExecutionContract } from "./spec-execution-contract";

// Second, deeper nesting depth (an extra section-subdirectory level) -- proves
// the portable import mechanism adapts to physical depth rather than being
// tuned to one specific directory layout. Path pattern only (matches
// testMatch's "automations/apps/**/cases/**/*.spec.ts" glob); no real app
// registry entry required.
const TEMP_APP_2_ROOT = path.resolve(__dirname, "../../automations/apps/zzz-temp-discovery-app-2");
const REAL_CASE_ROOT_2 = path.join(TEMP_APP_2_ROOT, "sections/nested/deeper/cases");

/**
 * Static discovery only (`playwright test --list`) -- no browser, no
 * navigation, no live app. Proves whether the deterministic compiler's
 * candidate source is collectible by the REAL, unmodified
 * defaultRunPlaywrightDiscovery, using the REAL repo's playwright.config.ts
 * (testMatch is anchored to the project root -- a temp-dir-outside-the-repo
 * fixture can never match it, independent of the candidate's own content).
 *
 * Uses a genuinely temporary, clearly-marked NEW case directory inside the
 * real `automations/apps/arquitectura-automatizacion/sections/default-section/cases/`
 * tree (never an existing case), removed in `finally`. No real plan.json,
 * candidate.spec.ts, or promoted spec is read or modified.
 */

const REAL_CASE_ROOT = path.resolve(
  __dirname,
  "../../automations/apps/arquitectura-automatizacion/sections/default-section/cases",
);
const TEMP_CASE_ID = `zzz-temp-discovery-diagnostic-${process.pid}-${Date.now()}`;
const TEMP_CASE_DIR = path.join(REAL_CASE_ROOT, TEMP_CASE_ID);

async function withTempCaseDir<T>(fn: (caseDir: string) => Promise<T>): Promise<T> {
  await fs.mkdir(TEMP_CASE_DIR, { recursive: true });
  try {
    return await fn(TEMP_CASE_DIR);
  } finally {
    await fs.rm(TEMP_CASE_DIR, { recursive: true, force: true }).catch(() => undefined);
  }
}

function freshPreview001ShapeContract() {
  const plan = {
    version: "1.0", source: "discovery_generated", status: "validated", createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C-DISC-1", title: "Discovery diagnostic" },
    requiredData: [],
    steps: [
      { index: 1, action: "navigate" },
      { index: 2, action: "fill", target: { strategy: "text", value: "Usuario" } },
      { index: 3, action: "click", target: { strategy: "text", value: "Ingresar" } },
    ],
  } as any;
  const sourceScenario = {
    title: "Discovery diagnostic",
    steps: [
      { index: 1, action: "Ingresar usuario", technicalTargetRef: "role:textbox|Usuario" },
      { index: 2, action: "Clic en Ingresar", technicalTargetRef: "role:button|Ingresar" },
    ],
  } as any;
  return buildSpecExecutionContract(plan, sourceScenario, { appSlug: "arquitectura-automatizacion", sectionSlug: "default-section" });
}

test("G/real (non-browser) playwrightDiscovery on the deterministic candidate: the prior module-resolution first-loss is FIXED once portable import paths are used", async () => {
  await withTempCaseDir(async (caseDir) => {
    const specPath = path.join(caseDir, "case.spec.ts");
    const contract = freshPreview001ShapeContract();
    const compiled = compileDeterministicSpec(contract, { targetSpecPath: specPath });
    assert.equal(compiled.unsupportedCapabilities.length, 0, "fixture must compile cleanly first");
    assert.doesNotMatch(compiled.source, /from '\.\.\/runtime\/promoted-spec-runtime'/, "must not be the old, location-relative hardcoded path");

    // Placed at the REAL target depth (automations/apps/<slug>/sections/<section>/cases/<id>/case.spec.ts),
    // matching playwright.config.ts's testMatch: "automations/apps/**/cases/**/*.spec.ts".
    await fs.writeFile(specPath, compiled.source, "utf8");

    const result = await defaultRunPlaywrightDiscovery(specPath);
    console.log(`[discovery-diagnostic] exitCode=${result.exitCode}`);
    console.log(`[discovery-diagnostic] stdout=\n${result.stdout}`);
    console.log(`[discovery-diagnostic] stderr=\n${result.stderr}`);

    // This ticket's fix: the module-resolution error must be gone.
    assert.doesNotMatch(result.stderr, /Cannot find module/);
    // Report the actual outcome -- do not force specWritten-style success and
    // do not fix any NEW error that might surface here (next boundary, per scope).
    if (result.exitCode === 0) {
      assert.match(result.stdout, /Total: 1 test in 1 file/);
    } else {
      console.log(`[discovery-diagnostic] NEW boundary (not fixed in this ticket): exitCode=${result.exitCode}`);
    }
  });
});

test("D/portable imports adapt to a different physical nesting depth, not tuned to one directory layout", async () => {
  const tempDir2 = path.join(REAL_CASE_ROOT_2, `case-${process.pid}-${Date.now()}`);
  await fs.mkdir(tempDir2, { recursive: true });
  try {
    const specPath = path.join(tempDir2, "case.spec.ts");
    const contract = freshPreview001ShapeContract();
    const compiled = compileDeterministicSpec(contract, { targetSpecPath: specPath });
    assert.equal(compiled.unsupportedCapabilities.length, 0);
    await fs.writeFile(specPath, compiled.source, "utf8");

    const result = await defaultRunPlaywrightDiscovery(specPath);
    console.log(`[discovery-diagnostic-depth2] exitCode=${result.exitCode} stderrTail=${result.stderr.slice(-300)}`);
    assert.doesNotMatch(result.stderr, /Cannot find module/, "portable import path must resolve at this different depth too");
  } finally {
    await fs.rm(TEMP_APP_2_ROOT, { recursive: true, force: true }).catch(() => undefined);
  }
});
