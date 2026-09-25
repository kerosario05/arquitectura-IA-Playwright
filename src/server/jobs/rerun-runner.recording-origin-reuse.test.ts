import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { prepareRerun, type JobRecordLike } from "./rerun-runner";
import { saveScenarios, recordingDir } from "../../recording/recording-store";
import type { RecordedScenario } from "../../recording/trace-to-scenario";

/**
 * FIRST_LOSS (job 243c3a7e-19e5-4b50-9eb6-120d3cfa1486, now stale/pre-dating this authority): a
 * `reuse-existing` job created directly from `POST /api/recordings/:recordingId/execute` (never
 * through a `scenario-preview` job that wrote `preview-scenarios.json`) had no `preview-
 * scenarios.json` of its own AND no `sourceJobId` parent to walk -- `prepareRerun` only ever knew
 * two authorities (a `preview-scenarios.json` file, or a `sourceJobId` chain to one), neither of
 * which a recording-origin reuse job has.
 *
 * `prepareRerunFromReuseExistingJob` (rerun-runner.ts) is the fix: for a job whose OWN params
 * already carry `executionMode==="reuse_existing_promoted_spec"` + `recordingId` + `appSlug` +
 * `scenarios`, it resolves EACH scenario's canonical identity directly from the recording's own
 * persisted store (`loadScenarios`) and its CORE promoted-spec authority (`resolveSpecForScenario`
 * -- the SAME authority `rerun-runner.promoted-spec-reuse.test.ts` already exercises for the
 * `preview-scenarios.json` path) -- never a parallel authority, never guessing from title/index.
 * `recordingId`/`appSlug` are re-propagated onto every subsequent generation's own job params
 * (runs.ts: `recordingId: prepared.recordingId`), so reuse -> rerun -> reuse -> rerun chains stay
 * self-sufficient without ever needing `preview-scenarios.json` or a `sourceJobId` walk.
 *
 * KNOWN, EXPLICITLY SCOPED-OUT GAP (not fixed here): when a rerun batch mixes a scenario WITH a
 * reusable promoted spec and one WITHOUT, `prepareRerunFromReuseExistingJob` currently fails the
 * WHOLE request closed (`rerun_lineage_broken`) instead of dispatching per-scenario (reuse for
 * the first, the normal Discovery/generation path for the second). Building that fallback
 * correctly requires constructing a full, valid `McpScenario` from a bare `RecordedScenario` for
 * Discovery to consume -- a genuinely separate, higher-risk feature (the inverse of
 * `virtualCaseToScenario`, needing fields no snapshot conversion for this direction exists yet)
 * that risks feeding Discovery fabricated/incomplete data if done hastily. Left OUT of this
 * change's scope rather than guessed at; test 6 below pins the CURRENT (fail-closed, not
 * silently-wrong) behavior so a future fix has a clear regression baseline to replace.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const APP_SLUG = "test-recording-reuse-hermetic-app";
const RECORDING_ID = "hermeticrecordingreuse01";

function inMemoryJobRecordLookup(records: Record<string, JobRecordLike>): (id: string) => Promise<JobRecordLike | undefined> {
  return async (id) => records[id];
}

async function writeFreshPromotedSpec(specPath: string): Promise<{ specHash: string }> {
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  const specText = `test('Hermetic ${specPath}', async () => {});`;
  fs.writeFileSync(specPath, specText, "utf-8");
  fs.writeFileSync(path.join(path.dirname(specPath), "automation.json"), JSON.stringify({ status: "active", specVerificationStatus: "passed" }), "utf-8");
  const crypto = await import("node:crypto");
  return { specHash: crypto.createHash("sha256").update(specText, "utf8").digest("hex") };
}

function recordedScenario(overrides: Partial<RecordedScenario> = {}): RecordedScenario {
  return {
    scenarioId: "REC-HERMETIC01-01",
    title: "Recorded scenario title",
    description: "",
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
    canonicalInteractions: [],
    entityActionBlocks: [],
    ...overrides,
  } as RecordedScenario;
}

function reuseJobRecord(overrides: {
  appSlug: string;
  recordingId: string;
  scenarios: Array<{ scenarioId: string; caseId?: number; specPath: string; title?: string; runtimeValues?: Record<string, string> }>;
}): JobRecordLike {
  return {
    type: "scenario-preview",
    params: {
      executionMode: "reuse_existing_promoted_spec",
      appSlug: overrides.appSlug,
      recordingId: overrides.recordingId,
      scenarios: overrides.scenarios,
    },
  };
}

function cleanup(): void {
  fs.rmSync(path.join(ROOT, "automations", "apps", APP_SLUG), { recursive: true, force: true });
}

test("1/DIRECT_RECORDING_REUSE_NO_PREVIEW_SCENARIOS: a reuse-existing job created directly from recordings execute (no preview-scenarios.json anywhere) still prepares a rerun, never rerun_lineage_broken", async () => {
  try {
    const specPath = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "c1", "case.spec.ts");
    const { specHash } = await writeFreshPromotedSpec(specPath);
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ promotedSpec: { appSlug: APP_SLUG, specPath, specHash, automationId: "x", generatedAt: "t" } as any }),
    ]);
    const record = reuseJobRecord({
      appSlug: APP_SLUG,
      recordingId: RECORDING_ID,
      scenarios: [{ scenarioId: "REC-HERMETIC01-01", caseId: 1, specPath, title: "Recorded scenario title" }],
    });
    const result = await prepareRerun("direct-reuse-job", "all", undefined, inMemoryJobRecordLookup({ "direct-reuse-job": record }));
    assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
    if (result.ok && result.jobType === "scenario-preview") {
      assert.equal(result.allReusable, true);
      assert.equal(result.promotedSpecReuse[0].reuse, true);
      assert.equal(result.promotedSpecReuse[0].specPath, specPath);
    } else {
      assert.fail("expected scenario-preview result");
    }
  } finally {
    cleanup();
  }
});

test("2/MULTI_GENERATION_LINEAGE_VIA_DIRECT_AUTHORITY: reuse -> rerun -> reuse -> rerun -> reuse resolves at every generation using ONLY each job's own recordingId/appSlug/scenarios, never preview-scenarios.json or a sourceJobId walk", async () => {
  try {
    const specPath = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "c1", "case.spec.ts");
    const { specHash } = await writeFreshPromotedSpec(specPath);
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ promotedSpec: { appSlug: APP_SLUG, specPath, specHash, automationId: "x", generatedAt: "t" } as any }),
    ]);

    let currentJobId = "gen-0";
    let currentRecord = reuseJobRecord({
      appSlug: APP_SLUG,
      recordingId: RECORDING_ID,
      scenarios: [{ scenarioId: "REC-HERMETIC01-01", caseId: 1, specPath, title: "Recorded scenario title" }],
    });

    for (let generation = 1; generation <= 3; generation++) {
      const result = await prepareRerun(currentJobId, "all", undefined, inMemoryJobRecordLookup({ [currentJobId]: currentRecord }));
      assert.equal(result.ok, true, `generation ${generation} failed: ${JSON.stringify(result)}`);
      if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected shape");
      assert.equal(result.allReusable, true, `generation ${generation} must remain fully reusable`);
      assert.equal(result.recordingId, RECORDING_ID, `generation ${generation} must carry recordingId forward`);

      // Mirror runs.ts's own next-job construction (recordingId: prepared.recordingId, ...).
      currentJobId = `gen-${generation}`;
      currentRecord = reuseJobRecord({
        appSlug: result.appSlug,
        recordingId: result.recordingId!,
        scenarios: result.promotedSpecReuse.map((e) => ({ scenarioId: e.scenarioId, caseId: e.caseId, specPath: e.specPath!, title: e.title, runtimeValues: e.runtimeValues })),
      });
    }
  } finally {
    cleanup();
  }
});

test("3/PROMOTED_SCENARIO_DISPATCH_SHAPE: a reusable scenario's promotedSpecReuse entry carries exactly the flags runs.ts's dispatch relies on (reuse=true, allReusable=true)", async () => {
  try {
    const specPath = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "c1", "case.spec.ts");
    const { specHash } = await writeFreshPromotedSpec(specPath);
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ promotedSpec: { appSlug: APP_SLUG, specPath, specHash, automationId: "x", generatedAt: "t" } as any }),
    ]);
    const record = reuseJobRecord({ appSlug: APP_SLUG, recordingId: RECORDING_ID, scenarios: [{ scenarioId: "REC-HERMETIC01-01", specPath }] });
    const result = await prepareRerun("dispatch-job", "all", undefined, inMemoryJobRecordLookup({ "dispatch-job": record }));
    assert.equal(result.ok, true);
    if (result.ok && result.jobType === "scenario-preview") {
      assert.equal(result.allReusable, true);
      assert.equal(result.promotedSpecReuse.every((e) => e.reuse), true);
    }
  } finally {
    cleanup();
  }
});

test("6/STALE_PROMOTED_SPEC_NOT_SILENTLY_REUSED: a promoted spec whose file content no longer matches the persisted hash is never treated as reusable -- routes to the normal CORE fallback (never reuse-existing, never silently stale)", async () => {
  try {
    const specPath = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "c1", "case.spec.ts");
    const { specHash } = await writeFreshPromotedSpec(specPath);
    // Mutate the spec file after hashing -- makes resolveSpecForScenario's own authority report "stale".
    fs.writeFileSync(specPath, "test('mutated after promotion', async () => {});", "utf-8");
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ promotedSpec: { appSlug: APP_SLUG, specPath, specHash, automationId: "x", generatedAt: "t" } as any }),
    ]);
    const record = reuseJobRecord({ appSlug: APP_SLUG, recordingId: RECORDING_ID, scenarios: [{ scenarioId: "REC-HERMETIC01-01", specPath }] });
    const result = await prepareRerun("stale-job", "all", undefined, inMemoryJobRecordLookup({ "stale-job": record }));
    assert.equal(result.ok, true, "canonical authority exists -- must fall back to the normal route, never fail the whole request");
    if (result.ok && result.jobType === "scenario-preview") {
      assert.equal(result.allReusable, false, "a stale spec must never be treated as reusable");
      assert.equal(result.promotedSpecReuse[0].reuse, false);
      assert.equal(result.promotedSpecReuse[0].specState, "stale");
      assert.equal(result.scenarios.length, 1, "the stale scenario must reach the normal-route scenarios list");
    }
  } finally {
    cleanup();
  }
});

test("7/EXACT_SCENARIO_IDENTITY_NEVER_POSITIONAL: canonical scenario resolution matches by scenarioId only -- a differently-ordered/differently-titled recording store entry is still matched correctly, never by array position", async () => {
  try {
    const specPath = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "c1", "case.spec.ts");
    const { specHash } = await writeFreshPromotedSpec(specPath);
    // The target scenario is placed SECOND in the store, with an unrelated first entry with a
    // completely different scenarioId/title -- proves matching is by scenarioId, not index 0.
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ scenarioId: "REC-HERMETIC01-DECOY", title: "A decoy scenario, never the target" }),
      recordedScenario({ scenarioId: "REC-HERMETIC01-01", title: "The real target", promotedSpec: { appSlug: APP_SLUG, specPath, specHash, automationId: "x", generatedAt: "t" } as any }),
    ]);
    const record = reuseJobRecord({ appSlug: APP_SLUG, recordingId: RECORDING_ID, scenarios: [{ scenarioId: "REC-HERMETIC01-01", specPath, title: "A DIFFERENT title than what's stored" }] });
    const result = await prepareRerun("identity-job", "all", undefined, inMemoryJobRecordLookup({ "identity-job": record }));
    assert.equal(result.ok, true);
    if (result.ok && result.jobType === "scenario-preview") {
      assert.equal(result.promotedSpecReuse[0].canonicalScenarioId, "REC-HERMETIC01-01");
    }
  } finally {
    cleanup();
  }
});

test("9/CURRENT_RUNTIME_DATA_NOT_STALE_SNAPSHOT: the rerun resolves runtimeValues from the canonical scenario's CURRENT runtimeDataset, never a snapshot frozen at the prior job's creation time", async () => {
  try {
    const specPath = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "c1", "case.spec.ts");
    const { specHash } = await writeFreshPromotedSpec(specPath);
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({
        promotedSpec: { appSlug: APP_SLUG, specPath, specHash, automationId: "x", generatedAt: "t" } as any,
        runtimeDataset: { resolvedValues: { field_a: "current-edited-value" } } as any,
      }),
    ]);
    // The job's OWN stored params carry a STALE value (as if the user edited "Datos de este
    // escenario" after this job was created) -- the fix must prefer the canonical scenario's
    // CURRENT value, never this stale snapshot.
    const record = reuseJobRecord({
      appSlug: APP_SLUG,
      recordingId: RECORDING_ID,
      scenarios: [{ scenarioId: "REC-HERMETIC01-01", specPath, runtimeValues: { field_a: "stale-old-value" } }],
    });
    const result = await prepareRerun("runtime-current-job", "all", undefined, inMemoryJobRecordLookup({ "runtime-current-job": record }));
    assert.equal(result.ok, true);
    if (result.ok && result.jobType === "scenario-preview") {
      assert.equal(result.promotedSpecReuse[0].runtimeValues?.field_a, "current-edited-value");
    }
  } finally {
    cleanup();
  }
});

test("11/REAL_BROKEN_LINEAGE_FAILS_CLOSED: a scenarioId with no canonical match in the recording store at all fails closed, never guesses", async () => {
  try {
    saveScenarios(APP_SLUG, RECORDING_ID, []); // recording store has nothing
    const record = reuseJobRecord({ appSlug: APP_SLUG, recordingId: RECORDING_ID, scenarios: [{ scenarioId: "REC-DOES-NOT-EXIST", specPath: "nowhere.spec.ts" }] });
    const result = await prepareRerun("broken-job", "all", undefined, inMemoryJobRecordLookup({ "broken-job": record }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "rerun_lineage_broken");
  } finally {
    cleanup();
  }
});

test("12/MULTI_SCENARIO_ISOLATION: two scenarios (both reusable) each keep their own scenarioId/specPath/runtimeValues with zero cross-contamination", async () => {
  try {
    const specPathA = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "a", "case.spec.ts");
    const specPathB = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "b", "case.spec.ts");
    const { specHash: hashA } = await writeFreshPromotedSpec(specPathA);
    const { specHash: hashB } = await writeFreshPromotedSpec(specPathB);
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({
        scenarioId: "REC-HERMETIC01-A",
        promotedSpec: { appSlug: APP_SLUG, specPath: specPathA, specHash: hashA, automationId: "a", generatedAt: "t" } as any,
        runtimeDataset: { resolvedValues: { field_a: "value-for-A" } } as any,
      }),
      recordedScenario({
        scenarioId: "REC-HERMETIC01-B",
        promotedSpec: { appSlug: APP_SLUG, specPath: specPathB, specHash: hashB, automationId: "b", generatedAt: "t" } as any,
        runtimeDataset: { resolvedValues: { field_a: "value-for-B" } } as any,
      }),
    ]);
    const record = reuseJobRecord({
      appSlug: APP_SLUG,
      recordingId: RECORDING_ID,
      scenarios: [
        { scenarioId: "REC-HERMETIC01-A", specPath: specPathA },
        { scenarioId: "REC-HERMETIC01-B", specPath: specPathB },
      ],
    });
    const result = await prepareRerun("isolation-job", "all", undefined, inMemoryJobRecordLookup({ "isolation-job": record }));
    assert.equal(result.ok, true);
    if (result.ok && result.jobType === "scenario-preview") {
      const a = result.promotedSpecReuse.find((e) => e.scenarioId === "REC-HERMETIC01-A");
      const b = result.promotedSpecReuse.find((e) => e.scenarioId === "REC-HERMETIC01-B");
      assert.equal(a?.specPath, specPathA);
      assert.equal(b?.specPath, specPathB);
      assert.equal(a?.runtimeValues?.field_a, "value-for-A");
      assert.equal(b?.runtimeValues?.field_a, "value-for-B");
    }
  } finally {
    cleanup();
  }
});
