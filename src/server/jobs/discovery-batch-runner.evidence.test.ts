import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildEvidencePaths } from "../../evidence/evidence-paths";
import { collectFreshLegacyScenarioEvidenceFiles } from "./discovery-batch-runner";

const appSlug = `evidence-fixture-${process.pid}-${Date.now()}`;
const sectionSlug = "generic-section";
const scenarioId = "C74123";
const evidencePath = buildEvidencePaths({ appSlug, sectionSlug, scenarioId, scenarioTitle: "Evidence fixture" }).evidenceJsonPath;

test("collects only fresh, identity-matched legacy evidence for a scenario", () => {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify({
    appSlug,
    sectionSlug,
    scenarioId,
    steps: [{ index: 1, stepText: "Open app", status: "passed", timestamp: new Date().toISOString() }],
  }));
  try {
    const candidates = [{ appSlug, sectionSlug, scenarioIds: [scenarioId] }];
    assert.deepEqual(collectFreshLegacyScenarioEvidenceFiles(candidates, Date.now() - 2_000), [evidencePath]);
    assert.deepEqual(collectFreshLegacyScenarioEvidenceFiles(candidates, Date.now() + 60_000), []);
    assert.deepEqual(
      collectFreshLegacyScenarioEvidenceFiles([{ ...candidates[0], appSlug: `${appSlug}-other` }], Date.now() - 2_000),
      [],
    );
  } finally {
    fs.rmSync(path.dirname(path.dirname(path.dirname(evidencePath))), { recursive: true, force: true });
  }
});
