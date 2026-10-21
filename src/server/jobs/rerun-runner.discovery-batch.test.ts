import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { prepareRerun, type JobRecordLike } from "./rerun-runner";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const RESULTS_DIR = path.join(ROOT, ".artifacts", "tmp", "discovery-batch-results");
const LAUNCH_DIR = path.join(ROOT, ".artifacts", "scenario-launch-runs");

function writeSourceArtifacts(jobId: string, launchId: string): void {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `${jobId}.json`), JSON.stringify({
    args: { app: "fixture-app", caseIds: [54903, 54904], autoPromote: true, autoPom: true },
    cases: [
      { caseId: 54903, selected: true, status: "exploration_failed" },
      { caseId: 54904, selected: true, status: "promoted" },
    ],
  }), "utf-8");
  const launchPath = path.join(LAUNCH_DIR, launchId, "launch-manifest.json");
  fs.mkdirSync(path.dirname(launchPath), { recursive: true });
  fs.writeFileSync(launchPath, JSON.stringify({
    launchId,
    publishedCases: [
      { caseId: 54903, scenarioId: "fixture-1", sourceType: "testrail_case" },
      { caseId: 54904, scenarioId: "fixture-2", sourceType: "testrail_case" },
    ],
  }), "utf-8");
}

function cleanup(jobId: string, launchId: string): void {
  fs.rmSync(path.join(RESULTS_DIR, `${jobId}.json`), { force: true });
  fs.rmSync(path.join(LAUNCH_DIR, launchId), { recursive: true, force: true });
}

test("discovery-batch rerun rebuilds the exact selected cases and launches fresh Discovery", async () => {
  const jobId = "hermetic-discovery-batch-rerun";
  const launchId = "hermetic-discovery-batch-launch";
  writeSourceArtifacts(jobId, launchId);
  try {
    // Models a job loaded from qa-lab-run-history after the backend restarted: only
    // stable metadata survives in the job record, while the batch result owns case selection.
    const record: JobRecordLike = {
      type: "discovery-batch",
      params: { appSlug: "fixture-app", launchId, testRunId: 4829, sectionSlug: "regression" },
    };
    const result = await prepareRerun(jobId, "failed_only", "discovery-batch", async () => record);
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok && result.jobType === "discovery-batch") {
      assert.equal(result.selectedCount, 1);
      assert.equal(result.totalCount, 2);
      assert.deepEqual(result.discoveryParams.caseIds, [54903]);
      assert.equal(result.discoveryParams.appSlug, "fixture-app");
      assert.equal(result.discoveryParams.forceRediscovery, true);
      assert.equal(result.discoveryParams.overwrite, true);
      assert.equal(result.discoveryParams.autoPromote, true);
      assert.equal(result.discoveryParams.rerunActive, true);
      assert.equal(result.discoveryParams.executePromotedSpecs, false);
      assert.equal(result.discoveryParams.testRunId, 4829);
      assert.equal(result.discoveryParams.launchId, undefined, "reruns must not replace the original launch manifest");
      assert.deepEqual(result.discoveryParams.publishedCases, [
        { caseId: 54903, scenarioId: "fixture-1", sourceType: "testrail_case" },
      ]);
    } else {
      assert.fail("expected fresh discovery-batch rerun preparation");
    }
  } finally {
    cleanup(jobId, launchId);
  }
});

test("discovery-batch rerun mode all preserves the original case selection and mode failed_only fails closed without failed cases", async () => {
  const jobId = "hermetic-discovery-batch-rerun-all";
  const launchId = "hermetic-discovery-batch-launch-all";
  writeSourceArtifacts(jobId, launchId);
  try {
    const record: JobRecordLike = { type: "discovery-batch", params: { appSlug: "fixture-app", launchId } };
    const all = await prepareRerun(jobId, "all", undefined, async () => record);
    assert.equal(all.ok, true, JSON.stringify(all));
    if (all.ok && all.jobType === "discovery-batch") assert.deepEqual(all.discoveryParams.caseIds, [54903, 54904]);
    else assert.fail("expected all selected discovery cases");

    const failedOnly = await prepareRerun(jobId, "failed_only", undefined, async () => ({
      type: "discovery-batch",
      params: { appSlug: "fixture-app", launchId },
    }));
    assert.equal(failedOnly.ok, true, JSON.stringify(failedOnly));
    if (failedOnly.ok && failedOnly.jobType === "discovery-batch") {
      assert.deepEqual(failedOnly.discoveryParams.caseIds, [54903]);
    } else assert.fail("expected only the failed discovery case");
  } finally {
    cleanup(jobId, launchId);
  }
});

test("discovery-batch route dispatches the prepared case set back to the batch runner", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "runs.ts"), "utf8");
  const prepared = source.indexOf("if (prepared.jobType === \"discovery-batch\")");
  const create = source.indexOf('jobStore.create("discovery-batch", prepared.discoveryParams)', prepared);
  const dispatch = source.indexOf("startDiscoveryBatchRun(discoveryJob.id)", create);
  assert.ok(prepared >= 0 && create > prepared && dispatch > create);
  const block = source.slice(prepared, source.indexOf("console.log(`[runs:rerun] sourceResolution=", prepared));
  assert.ok(block.includes('dispatch: "fresh_discovery_batch"'));
});
