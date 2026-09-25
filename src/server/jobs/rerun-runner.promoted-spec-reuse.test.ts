import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { prepareRerun } from "./rerun-runner";
import { saveScenarios, recordingDir } from "../../recording/recording-store";
import type { RecordedScenario } from "../../recording/trace-to-scenario";
import type { VirtualCase } from "../../types/scenario-preview.types";

/**
 * Recording d8dbd8f9-b353-4175-b365-e5f8957bae36, scenario REC-D8DBD8F9-01: a rerun of an
 * already-promoted scenario lost the promotedSpec authority entirely, because prepareRerun
 * reconstructed scenarios from preview-scenarios.json's VirtualCase — a type with no
 * promotedSpec field — instead of consulting the recording's own persisted scenario store.
 * prepareRerun now resolves promoted-spec reuse per scenario via the STABLE canonical lineage
 * the snapshot already carries (VirtualCase.recordingId + VirtualCase.recordedScenarioId),
 * never by title or array position.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const JOBS_ROOT = path.join(ROOT, ".artifacts", "scenario-preview-runs");
const APP_SLUG = "test-rerun-hermetic-app";
const RECORDING_ID = "hermetictestrecording01";

function baseVirtualCase(overrides: Partial<VirtualCase> = {}): VirtualCase {
  return {
    id: "preview-001",
    displayId: "PREVIEW-001",
    title: "A DIFFERENT display title than the recorded scenario", // proves title is never used to match
    sourceIssueKey: "REC-HERMETIC01",
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
    recordingId: RECORDING_ID,
    recordedScenarioId: "REC-HERMETIC01-01",
    ...overrides,
  } as VirtualCase;
}

function writePreviewJob(jobId: string, cases: VirtualCase[]): void {
  const dir = path.join(JOBS_ROOT, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "preview-scenarios.json"), JSON.stringify(cases, null, 2), "utf-8");
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify({ appSlug: APP_SLUG }, null, 2), "utf-8");
}

async function writeFreshPromotedSpec(specPath: string): Promise<{ specHash: string }> {
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  const specText = "test('Hermetic', async () => {});";
  fs.writeFileSync(specPath, specText, "utf-8");
  fs.writeFileSync(path.join(path.dirname(specPath), "automation.json"), JSON.stringify({ status: "active", specVerificationStatus: "passed" }), "utf-8");
  const crypto = await import("node:crypto");
  return { specHash: crypto.createHash("sha256").update(specText, "utf8").digest("hex") };
}

function recordedScenario(overrides: Partial<RecordedScenario> = {}): RecordedScenario {
  return {
    scenarioId: "REC-HERMETIC01-01",
    title: "The REAL recorded scenario title", // deliberately different from VirtualCase.title
    ...overrides,
  } as RecordedScenario;
}

async function cleanup(jobIds: string[]): Promise<void> {
  for (const jobId of jobIds) {
    fs.rmSync(path.join(JOBS_ROOT, jobId), { recursive: true, force: true });
  }
  fs.rmSync(path.join(ROOT, "automations", "apps", APP_SLUG), { recursive: true, force: true });
}

test("1/2/3. rerun + persisted promotedSpec fresh -> promotedSpecReuse marks reuse=true, allReusable=true", async () => {
  const jobId = "hermetic-rerun-fresh";
  try {
    const specPath = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "c1", "case.spec.ts");
    const { specHash } = await writeFreshPromotedSpec(specPath);
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ promotedSpec: { appSlug: APP_SLUG, specPath, specHash, automationId: "x", generatedAt: "t" } as any }),
    ]);
    writePreviewJob(jobId, [baseVirtualCase()]);

    const result = await prepareRerun(jobId, "all", undefined);
    assert.equal(result.ok, true);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    assert.equal(result.allReusable, true);
    assert.equal(result.promotedSpecReuse.length, 1);
    assert.equal(result.promotedSpecReuse[0].specState, "fresh");
    assert.equal(result.promotedSpecReuse[0].reuse, true);
    assert.equal(result.promotedSpecReuse[0].specPath, specPath);
    // scenarioId on the returned McpScenario must be the canonical identity, not the display id.
    assert.equal(result.scenarios[0].scenarioId, "REC-HERMETIC01-01");
  } finally {
    await cleanup([jobId]);
  }
});

test("4. promotedSpec missing (recorded scenario has none) -> existing scenario-preview fallback preserved", async () => {
  const jobId = "hermetic-rerun-missing";
  try {
    saveScenarios(APP_SLUG, RECORDING_ID, [recordedScenario()]); // no promotedSpec at all
    writePreviewJob(jobId, [baseVirtualCase()]);

    const result = await prepareRerun(jobId, "all", undefined);
    assert.equal(result.ok, true);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    assert.equal(result.allReusable, false);
    assert.equal(result.promotedSpecReuse[0].specState, "missing");
    assert.equal(result.promotedSpecReuse[0].reuse, false);
  } finally {
    await cleanup([jobId]);
  }
});

test("5. promotedSpec stale (hash changed on disk) -> existing scenario-preview fallback preserved", async () => {
  const jobId = "hermetic-rerun-stale";
  try {
    const specPath = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "c2", "case.spec.ts");
    await writeFreshPromotedSpec(specPath);
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ promotedSpec: { appSlug: APP_SLUG, specPath, specHash: "not-the-real-hash", automationId: "x", generatedAt: "t" } as any }),
    ]);
    writePreviewJob(jobId, [baseVirtualCase()]);

    const result = await prepareRerun(jobId, "all", undefined);
    assert.equal(result.ok, true);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    assert.equal(result.allReusable, false);
    assert.equal(result.promotedSpecReuse[0].specState, "stale");
    assert.equal(result.promotedSpecReuse[0].reuse, false);
  } finally {
    await cleanup([jobId]);
  }
});

test("6. canonical scenario identity (recordingId + recordedScenarioId) is used to recover promotedSpec; title/index matching is forbidden", async () => {
  const jobId = "hermetic-rerun-identity";
  try {
    const specPath = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "c3", "case.spec.ts");
    const { specHash } = await writeFreshPromotedSpec(specPath);
    // The persisted recorded scenario's title deliberately does NOT match the VirtualCase title
    // (see baseVirtualCase/recordedScenario above) — only recordedScenarioId must be used to
    // link them. A second, unrelated recorded scenario with a title that WOULD fuzzy-match the
    // VirtualCase's title is also present, and must NOT be selected.
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({
        scenarioId: "REC-HERMETIC01-02", // decoy: different canonical id, similar-looking title
        title: baseVirtualCase().title,
        promotedSpec: { appSlug: APP_SLUG, specPath: "/should/never/be/selected.spec.ts", specHash: "irrelevant", automationId: "y", generatedAt: "t" } as any,
      }),
      recordedScenario({ promotedSpec: { appSlug: APP_SLUG, specPath, specHash, automationId: "x", generatedAt: "t" } as any }),
    ]);
    writePreviewJob(jobId, [baseVirtualCase()]);

    const result = await prepareRerun(jobId, "all", undefined);
    assert.equal(result.ok, true);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    assert.equal(result.promotedSpecReuse[0].specPath, specPath, "must match by canonical recordedScenarioId, never by the decoy's similar title");
    assert.equal(result.allReusable, true);
  } finally {
    await cleanup([jobId]);
  }
});

test("no recordingId/recordedScenarioId on the VirtualCase -> conservatively missing, never guessed", async () => {
  const jobId = "hermetic-rerun-no-lineage";
  try {
    writePreviewJob(jobId, [baseVirtualCase({ recordingId: undefined, recordedScenarioId: undefined })]);
    const result = await prepareRerun(jobId, "all", undefined);
    assert.equal(result.ok, true);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    assert.equal(result.promotedSpecReuse[0].specState, "missing");
    assert.equal(result.allReusable, false);
  } finally {
    await cleanup([jobId]);
  }
});
