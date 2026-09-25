import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { writeBackPromotedSpecsToRecordingScenarios, type ScenarioPreviewResultsFile } from "./scenario-preview-runner";
import { loadScenarios, saveScenarios } from "../../recording/recording-store";
import type { RecordedScenario } from "../../recording/trace-to-scenario";

/**
 * Closes exactly the gap this session was asked to close: after discovery:preview promotes
 * a spec for a Recording-originated scenario, RecordedScenario.promotedSpec must end up set
 * so a second "Ejecutar Automatización" resolves reuse_existing instead of regenerating.
 *
 * Uses the real filesystem (via recording-store, unmodified) under a disposable test app
 * slug — no mocks for the persistence layer itself, since that IS the thing being verified.
 */

type AsyncTestFn = () => void | Promise<void>;

async function test(label: string, fn: AsyncTestFn): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

const APP_SLUG = "test-promoted-spec-writeback";
const RECORDING_ID = "rec-writeback-test";

function minimalScenario(overrides: Partial<RecordedScenario>): RecordedScenario {
  return {
    scenarioId: "REC-WRITEBACK-01",
    title: "Kiosko2",
    description: "test",
    preconditions: [],
    kind: "happy_path",
    provenance: "observed",
    mobileSteps: [],
    webSteps: [],
    testRailSteps: [],
    requiredData: [],
    stepTargets: [],
    sourceRecordingId: RECORDING_ID,
    hasUncertainSteps: false,
    ...overrides,
  } as RecordedScenario;
}

function writeFixtureSpec(caseDirName: string, sectionSlug: string, content: string): string {
  const caseDir = path.join("automations", "apps", APP_SLUG, "sections", sectionSlug, "cases", caseDirName);
  fs.mkdirSync(caseDir, { recursive: true });
  const specPath = path.join(caseDir, "case.spec.ts");
  fs.writeFileSync(specPath, content, "utf-8");
  return specPath;
}

function cleanup(): void {
  fs.rmSync(path.join("automations", "apps", APP_SLUG), { recursive: true, force: true });
}

async function main(): Promise<void> {
  console.log("\npromoted spec writeback (RecordedScenario.promotedSpec)");
  cleanup();

  await test("a promoted Recording-originated case writes back promotedSpec with the real spec hash", async () => {
    const specPath = writeFixtureSpec("preview-001-kiosko2", "default-section", "// spec content v1");
    saveScenarios(APP_SLUG, RECORDING_ID, [minimalScenario({ scenarioId: "REC-WRITEBACK-01" })]);

    const results = {
      cases: [{
        recordingId: RECORDING_ID,
        recordedScenarioId: "REC-WRITEBACK-01",
        specWritten: true,
        promotionAllowed: true,
        specPath,
      }],
    } as unknown as ScenarioPreviewResultsFile;

    writeBackPromotedSpecsToRecordingScenarios("job-1", APP_SLUG, results);

    const [scenario] = loadScenarios(APP_SLUG, RECORDING_ID);
    assert.ok(scenario.promotedSpec, "promotedSpec should be set");
    assert.strictEqual(scenario.promotedSpec!.appSlug, APP_SLUG);
    assert.strictEqual(path.resolve(scenario.promotedSpec!.specPath), path.resolve(specPath));
    assert.strictEqual(scenario.promotedSpec!.automationId, "preview-001-kiosko2");
    assert.strictEqual(scenario.promotedSpec!.sectionSlug, "default-section");
    assert.ok(scenario.promotedSpec!.specHash, "specHash should be computed from the real file");
  });

  await test("a case that was not promoted (promotionAllowed=false) leaves promotedSpec untouched", async () => {
    cleanup();
    const specPath = writeFixtureSpec("preview-001-kiosko2", "default-section", "// spec content");
    saveScenarios(APP_SLUG, RECORDING_ID, [minimalScenario({ scenarioId: "REC-WRITEBACK-01" })]);

    const results = {
      cases: [{ recordingId: RECORDING_ID, recordedScenarioId: "REC-WRITEBACK-01", specWritten: true, promotionAllowed: false, specPath }],
    } as unknown as ScenarioPreviewResultsFile;

    writeBackPromotedSpecsToRecordingScenarios("job-1", APP_SLUG, results);

    const [scenario] = loadScenarios(APP_SLUG, RECORDING_ID);
    assert.strictEqual(scenario.promotedSpec, undefined);
  });

  await test("a non-Recording case (no recordingId) is skipped, not an error", async () => {
    cleanup();
    saveScenarios(APP_SLUG, RECORDING_ID, [minimalScenario({ scenarioId: "REC-WRITEBACK-01" })]);
    const results = {
      cases: [{ recordedScenarioId: "REC-WRITEBACK-01", specWritten: true, promotionAllowed: true, specPath: "irrelevant.spec.ts" }],
    } as unknown as ScenarioPreviewResultsFile;

    writeBackPromotedSpecsToRecordingScenarios("job-1", APP_SLUG, results);

    const [scenario] = loadScenarios(APP_SLUG, RECORDING_ID);
    assert.strictEqual(scenario.promotedSpec, undefined);
  });

  await test("second execution: idempotent — running writeback twice with the same result keeps the same identity", async () => {
    cleanup();
    const specPath = writeFixtureSpec("preview-001-kiosko2", "default-section", "// stable content");
    saveScenarios(APP_SLUG, RECORDING_ID, [minimalScenario({ scenarioId: "REC-WRITEBACK-01" })]);
    const results = {
      cases: [{ recordingId: RECORDING_ID, recordedScenarioId: "REC-WRITEBACK-01", specWritten: true, promotionAllowed: true, specPath }],
    } as unknown as ScenarioPreviewResultsFile;

    writeBackPromotedSpecsToRecordingScenarios("job-1", APP_SLUG, results);
    const first = loadScenarios(APP_SLUG, RECORDING_ID)[0].promotedSpec;
    writeBackPromotedSpecsToRecordingScenarios("job-1", APP_SLUG, results);
    const second = loadScenarios(APP_SLUG, RECORDING_ID)[0].promotedSpec;

    assert.strictEqual(first?.specHash, second?.specHash);
    assert.strictEqual(first?.specPath, second?.specPath);
  });

  cleanup();

  if (process.exitCode === 1) {
    console.error("\npromoted spec writeback tests FAILED");
  } else {
    console.log("\npromoted spec writeback tests PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
