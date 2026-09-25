import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { prepareRerun, resolveRerunLineageRoot, type JobRecordLike } from "./rerun-runner";
import type { VirtualCase } from "../../types/scenario-preview.types";

/**
 * FIRST_LOSS fix: `POST /api/runs/:jobId/rerun` on a `reuse-existing` job 404'd with
 * `rerun_source_not_found` -- `prepareRerun` only ever looked for
 * `.artifacts/scenario-preview-runs/<jobId>/preview-scenarios.json`, which a reuse-existing job
 * never writes by design (it runs an already-promoted spec directly, no discovery/generation).
 * Every reuse-existing job DOES already carry `params.sourceJobId` (its single-hop parent --
 * see runs.ts's `jobStore.create("scenario-preview", { sourceJobId: jobId,
 * executionMode: "reuse_existing_promoted_spec", ... })`), so `resolveRerunLineageRoot` walks
 * that chain back to the nearest ancestor that DOES have a real preview-scenarios.json, and
 * `prepareRerun` then reuses it -- scoped down to the CURRENT job's own scenario selection --
 * with no new discovery/generation/AI path.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const JOBS_ROOT = path.join(ROOT, ".artifacts", "scenario-preview-runs");
const APP_SLUG = "test-reuse-lineage-hermetic-app";

function baseVirtualCase(overrides: Partial<VirtualCase> = {}): VirtualCase {
  return {
    id: "preview-001",
    displayId: "PREVIEW-001",
    title: "Segunta Prueba",
    sourceIssueKey: "REC-LINEAGE01",
    steps: ["Presionar algo"],
    expectedResult: "Resultado esperado",
    preconditions: [],
    appSlug: APP_SLUG,
    routeProfile: "",
    dataRequirements: "",
    mcpExecutable: true,
    type: "Functional",
    automationType: "recorded_session",
    setupStrategy: "recorded_walkthrough",
    executionReadiness: "ready",
    publicationClassification: "executable",
    nonAutomatable: false,
    recordingId: "hermeticlineagerecording",
    recordedScenarioId: "REC-LINEAGE01-01",
    ...overrides,
  } as VirtualCase;
}

function writePreviewJob(jobId: string, cases: VirtualCase[]): void {
  const dir = path.join(JOBS_ROOT, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "preview-scenarios.json"), JSON.stringify(cases, null, 2), "utf-8");
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify({ appSlug: APP_SLUG }, null, 2), "utf-8");
}

async function cleanup(jobIds: string[]): Promise<void> {
  for (const jobId of jobIds) {
    fs.rmSync(path.join(JOBS_ROOT, jobId), { recursive: true, force: true });
  }
}

function inMemoryJobRecordLookup(records: Record<string, JobRecordLike>): (id: string) => Promise<JobRecordLike | undefined> {
  return async (id) => records[id];
}

test("1/DIRECT_SCENARIO_PREVIEW_RERUN_UNCHANGED: rerunning a scenario-preview job with its own preview-scenarios.json still resolves directly, no lineage walk needed", async () => {
  const jobId = "hermetic-lineage-direct";
  try {
    writePreviewJob(jobId, [baseVirtualCase()]);
    const result = await prepareRerun(jobId, "all", "scenario-preview", inMemoryJobRecordLookup({}));
    assert.equal(result.ok, true);
    if (result.ok && result.jobType === "scenario-preview") {
      assert.equal(result.sourceJobId, jobId);
      assert.equal(result.selectedCount, 1);
    } else {
      assert.fail("expected a scenario-preview result");
    }
  } finally {
    await cleanup([jobId]);
  }
});

test("2/REUSE_RESOLVES_ORIGINAL_SOURCE: rerunning a reuse-existing job (no preview-scenarios.json of its own) resolves its single-hop sourceJobId back to the root", async () => {
  const rootJobId = "hermetic-lineage-root";
  const reuseJobId = "hermetic-lineage-reuse-1";
  try {
    writePreviewJob(rootJobId, [baseVirtualCase()]);
    const records: Record<string, JobRecordLike> = {
      [reuseJobId]: {
        type: "scenario-preview",
        params: {
          sourceJobId: rootJobId,
          executionMode: "reuse_existing_promoted_spec",
          scenarios: [{ scenarioId: "REC-LINEAGE01-01", caseId: 1, specPath: "x", title: "Segunta Prueba" }],
        },
      },
    };
    const result = await prepareRerun(reuseJobId, "all", "scenario-preview", inMemoryJobRecordLookup(records));
    assert.equal(result.ok, true);
    if (result.ok && result.jobType === "scenario-preview") {
      // The returned sourceJobId stays the IMMEDIATE job asked to rerun -- never silently
      // rewritten to the resolved root -- so the next job's own lineage pointer stays
      // single-hop-correct.
      assert.equal(result.sourceJobId, reuseJobId);
      assert.equal(result.selectedCount, 1);
      assert.equal(result.scenarios[0].scenarioId, "REC-LINEAGE01-01");
    } else {
      assert.fail(`expected a scenario-preview result, got ${JSON.stringify(result)}`);
    }
  } finally {
    await cleanup([rootJobId]);
  }
});

test("3/REUSE_CHAIN_CONSECUTIVE: reuse -> reuse -> reuse resolves through multiple hops back to the same root", async () => {
  const rootJobId = "hermetic-lineage-root-chain";
  const reuse1 = "hermetic-lineage-chain-1";
  const reuse2 = "hermetic-lineage-chain-2";
  const reuse3 = "hermetic-lineage-chain-3";
  try {
    writePreviewJob(rootJobId, [baseVirtualCase()]);
    const records: Record<string, JobRecordLike> = {
      [reuse1]: { params: { sourceJobId: rootJobId, executionMode: "reuse_existing_promoted_spec", scenarios: [{ scenarioId: "REC-LINEAGE01-01" }] } },
      [reuse2]: { params: { sourceJobId: reuse1, executionMode: "reuse_existing_promoted_spec", scenarios: [{ scenarioId: "REC-LINEAGE01-01" }] } },
      [reuse3]: { params: { sourceJobId: reuse2, executionMode: "reuse_existing_promoted_spec", scenarios: [{ scenarioId: "REC-LINEAGE01-01" }] } },
    };
    const lineage = await resolveRerunLineageRoot(reuse3, inMemoryJobRecordLookup(records));
    assert.deepEqual(lineage, { ok: true, rootJobId });

    const result = await prepareRerun(reuse3, "all", "scenario-preview", inMemoryJobRecordLookup(records));
    assert.equal(result.ok, true);
    if (result.ok && result.jobType === "scenario-preview") {
      assert.equal(result.sourceJobId, reuse3);
      assert.equal(result.selectedCount, 1);
    } else {
      assert.fail(`expected a scenario-preview result, got ${JSON.stringify(result)}`);
    }
  } finally {
    await cleanup([rootJobId]);
  }
});

test("4/BROKEN_LINEAGE_FAILS_CLOSED: a chain with no parent sourceJobId anywhere, and a cyclic chain, both return an explicit error -- never silently fall back to another project", async () => {
  const orphanJobId = "hermetic-lineage-orphan";
  const brokenResult = await prepareRerun(
    orphanJobId,
    "all",
    "scenario-preview",
    inMemoryJobRecordLookup({ [orphanJobId]: { params: { executionMode: "reuse_existing_promoted_spec" } } }),
  );
  assert.equal(brokenResult.ok, false);
  if (!brokenResult.ok) {
    assert.equal(brokenResult.error, "rerun_lineage_broken");
  }

  const cycleA = "hermetic-lineage-cycle-a";
  const cycleB = "hermetic-lineage-cycle-b";
  const cyclicRecords: Record<string, JobRecordLike> = {
    [cycleA]: { params: { sourceJobId: cycleB } },
    [cycleB]: { params: { sourceJobId: cycleA } },
  };
  const cyclicResult = await resolveRerunLineageRoot(cycleA, inMemoryJobRecordLookup(cyclicRecords));
  assert.equal(cyclicResult.ok, false);
  if (!cyclicResult.ok) {
    assert.equal(cyclicResult.error, "rerun_lineage_cycle");
  }
});

test("5/NO_GENERATION_DISCOVERY_AI_INVOKED: prepareRerun's lineage-resolved path never references discovery/spec-generation/AI symbols", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "rerun-runner.ts"), "utf8");
  assert.doesNotMatch(source, /runDiscoverAndPromote|generateSpecFromPlan|createAIExplorer|runAgentAutoRepair|codex_cli/, "rerun-runner.ts must never invoke discovery/spec-generation/AI -- reuse-existing rerun stays a pure lineage/spec-reuse resolution");
});
