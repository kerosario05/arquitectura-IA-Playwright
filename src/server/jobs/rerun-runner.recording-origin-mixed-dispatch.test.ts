import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { prepareRerun, type JobRecordLike } from "./rerun-runner";
import { saveScenarios, recordingDir } from "../../recording/recording-store";
import type { RecordedScenario } from "../../recording/trace-to-scenario";

/**
 * FIRST_LOSS (continuation): `prepareRerunFromReuseExistingJob` correctly resolved a fully-
 * reusable recording-origin batch, but failed the WHOLE request closed (`rerun_lineage_broken`)
 * the moment ANY scenario lacked a fresh, reusable promoted spec -- never routing that ONE
 * scenario to the normal CORE path, contradicting the required per-scenario dispatch.
 *
 * INVESTIGATION (before this fix): does a canonical, non-fabricated authority exist to rebuild a
 * `McpScenario` for a recording-origin scenario without a reusable promoted spec? YES:
 * `toSharedMcpScenario` (src/recording/canonical-recording-contract.ts) -- the EXACT SAME
 * converter `recordings.ts`'s own `/execute` route already uses (`evaluateRecordingExecutionAdmission`
 * -> `executableContracts: ReturnType<typeof toSharedMcpScenario>[]`) to feed
 * `startScenarioPreviewRun` for a non-reuse scenario. `RecordedScenarioMcpContract = McpScenario &
 * {...}` -- a strict superset, so its output is directly usable wherever `McpScenario` is
 * expected. No fabrication: it derives everything from the scenario's OWN persisted canonical
 * structure (canonicalInteractions/entityActionBlocks/testRailSteps/etc.), the same production
 * code path already trusted for real Discovery runs.
 *
 * Fix: `prepareRerunFromReuseExistingJob` now classifies each scenario individually --
 * `resolveSpecForScenario` fresh+matching -> `promotedSpecReuse` entry with `reuse:true`;
 * anything else (missing/stale/hash-mismatch) -> `toSharedMcpScenario(canonical, appSlug,
 * currentRuntimeValues)` pushed into `scenarios: McpScenario[]`, `reuse:false`. `allReusable` is
 * true only when EVERY scenario is reusable. This is the EXACT shape `runs.ts`'s existing,
 * UNTOUCHED dispatch logic already understands:
 *   - `allReusable` -> `reuse_existing_promoted_spec` (unchanged)
 *   - `!allReusable && promotedSpecReuse.some(reuse)` -> `mixed_rerun_orchestrator` (unchanged,
 *     already independently tested in mixed-rerun-orchestrator.test.ts)
 *   - neither -> falls through to the existing full scenario-preview path (unchanged)
 * No second orchestrator, no fabricated data -- only `prepareRerun`'s OWN output shape changed.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const APP_SLUG = "test-mixed-dispatch-hermetic-app";
const RECORDING_ID = "hermeticmixeddispatch01";

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
    scenarioId: "REC-A",
    title: "Recorded scenario",
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

function reuseJobRecord(scenarios: Array<{ scenarioId: string; caseId?: number; specPath: string; title?: string; runtimeValues?: Record<string, string> }>): JobRecordLike {
  return {
    type: "scenario-preview",
    params: {
      executionMode: "reuse_existing_promoted_spec",
      appSlug: APP_SLUG,
      recordingId: RECORDING_ID,
      scenarios,
    },
  };
}

function cleanup(): void {
  fs.rmSync(path.join(ROOT, "automations", "apps", APP_SLUG), { recursive: true, force: true });
}

/** Mirrors runs.ts's own dispatch decision exactly (never re-implemented, only read here). */
function dispatchFor(result: Awaited<ReturnType<typeof prepareRerun>>): "reuse_existing" | "mixed" | "fallback" | "broken" {
  if (!result.ok || result.jobType !== "scenario-preview") return "broken";
  if (result.allReusable) return "reuse_existing";
  if (result.promotedSpecReuse.some((e) => e.reuse)) return "mixed";
  return "fallback";
}

test("1/ALL_REUSABLE_PRESERVED: two scenarios, both with a fresh promoted spec, both dispatch reuse_existing (preserves the existing fix)", async () => {
  try {
    const specA = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "a", "case.spec.ts");
    const specB = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "b", "case.spec.ts");
    const { specHash: hashA } = await writeFreshPromotedSpec(specA);
    const { specHash: hashB } = await writeFreshPromotedSpec(specB);
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ scenarioId: "REC-A", promotedSpec: { appSlug: APP_SLUG, specPath: specA, specHash: hashA, automationId: "a", generatedAt: "t" } as any }),
      recordedScenario({ scenarioId: "REC-B", promotedSpec: { appSlug: APP_SLUG, specPath: specB, specHash: hashB, automationId: "b", generatedAt: "t" } as any }),
    ]);
    const record = reuseJobRecord([{ scenarioId: "REC-A", specPath: specA }, { scenarioId: "REC-B", specPath: specB }]);
    const result = await prepareRerun("all-reuse-job", "all", undefined, inMemoryJobRecordLookup({ "all-reuse-job": record }));
    assert.equal(dispatchFor(result), "reuse_existing");
  } finally {
    cleanup();
  }
});

test("2/ALL_NON_REUSABLE_FALLBACK: two scenarios, neither with a promoted spec, both fall back to the normal CORE route -- never rerun_lineage_broken", async () => {
  try {
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ scenarioId: "REC-A" }), // no promotedSpec at all
      recordedScenario({ scenarioId: "REC-B" }),
    ]);
    const record = reuseJobRecord([{ scenarioId: "REC-A", specPath: "a/case.spec.ts" }, { scenarioId: "REC-B", specPath: "b/case.spec.ts" }]);
    const result = await prepareRerun("all-fallback-job", "all", undefined, inMemoryJobRecordLookup({ "all-fallback-job": record }));
    assert.equal(result.ok, true, `expected canonical authority to still resolve: ${JSON.stringify(result)}`);
    assert.equal(dispatchFor(result), "fallback");
    if (result.ok && result.jobType === "scenario-preview") {
      assert.equal(result.scenarios.length, 2);
      assert.deepEqual(result.scenarios.map((s) => s.scenarioId).sort(), ["REC-A", "REC-B"]);
    }
  } finally {
    cleanup();
  }
});

test("3/MIXED_DISPATCH: scenario A (promoted valid) reuses, scenario B (no promoted spec) falls back to the normal route -- perScenarioDecision", async () => {
  try {
    const specA = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "a", "case.spec.ts");
    const { specHash: hashA } = await writeFreshPromotedSpec(specA);
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ scenarioId: "REC-A", promotedSpec: { appSlug: APP_SLUG, specPath: specA, specHash: hashA, automationId: "a", generatedAt: "t" } as any }),
      recordedScenario({ scenarioId: "REC-B" }), // no promoted spec
    ]);
    const record = reuseJobRecord([{ scenarioId: "REC-A", specPath: specA }, { scenarioId: "REC-B", specPath: "b/case.spec.ts" }]);
    const result = await prepareRerun("mixed-job", "all", undefined, inMemoryJobRecordLookup({ "mixed-job": record }));
    assert.equal(dispatchFor(result), "mixed");
    if (result.ok && result.jobType === "scenario-preview") {
      const a = result.promotedSpecReuse.find((e) => e.scenarioId === "REC-A");
      const b = result.promotedSpecReuse.find((e) => e.scenarioId === "REC-B");
      assert.equal(a?.reuse, true);
      assert.equal(b?.reuse, false);
      assert.equal(result.scenarios.map((s) => s.scenarioId).includes("REC-B"), true, "B must reach the normal-route scenarios list");
      assert.equal(result.scenarios.map((s) => s.scenarioId).includes("REC-A"), false, "A (reusable) must NOT also be duplicated into the McpScenario fallback list");
    }
  } finally {
    cleanup();
  }
});

test("4/STALE_MIXED: scenario A (promoted valid) reuses, scenario B (promoted stale/hash mismatch) falls back to the normal route -- never silently reused", async () => {
  try {
    const specA = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "a", "case.spec.ts");
    const specB = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "b", "case.spec.ts");
    const { specHash: hashA } = await writeFreshPromotedSpec(specA);
    const { specHash: hashB } = await writeFreshPromotedSpec(specB);
    fs.writeFileSync(specB, "test('mutated', async () => {});", "utf-8"); // makes B stale
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ scenarioId: "REC-A", promotedSpec: { appSlug: APP_SLUG, specPath: specA, specHash: hashA, automationId: "a", generatedAt: "t" } as any }),
      recordedScenario({ scenarioId: "REC-B", promotedSpec: { appSlug: APP_SLUG, specPath: specB, specHash: hashB, automationId: "b", generatedAt: "t" } as any }),
    ]);
    const record = reuseJobRecord([{ scenarioId: "REC-A", specPath: specA }, { scenarioId: "REC-B", specPath: specB }]);
    const result = await prepareRerun("stale-mixed-job", "all", undefined, inMemoryJobRecordLookup({ "stale-mixed-job": record }));
    assert.equal(dispatchFor(result), "mixed");
    if (result.ok && result.jobType === "scenario-preview") {
      const b = result.promotedSpecReuse.find((e) => e.scenarioId === "REC-B");
      assert.equal(b?.reuse, false);
      assert.equal(b?.specState, "stale");
    }
  } finally {
    cleanup();
  }
});

test("5/THREE_WAY: A reusable, B missing, C stale -> A reuse, B+C fallback", async () => {
  try {
    const specA = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "a", "case.spec.ts");
    const specC = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "c", "case.spec.ts");
    const { specHash: hashA } = await writeFreshPromotedSpec(specA);
    const { specHash: hashC } = await writeFreshPromotedSpec(specC);
    fs.writeFileSync(specC, "test('mutated', async () => {});", "utf-8"); // makes C stale
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({ scenarioId: "REC-A", promotedSpec: { appSlug: APP_SLUG, specPath: specA, specHash: hashA, automationId: "a", generatedAt: "t" } as any }),
      recordedScenario({ scenarioId: "REC-B" }), // no promoted spec at all
      recordedScenario({ scenarioId: "REC-C", promotedSpec: { appSlug: APP_SLUG, specPath: specC, specHash: hashC, automationId: "c", generatedAt: "t" } as any }),
    ]);
    const record = reuseJobRecord([
      { scenarioId: "REC-A", specPath: specA },
      { scenarioId: "REC-B", specPath: "b/case.spec.ts" },
      { scenarioId: "REC-C", specPath: specC },
    ]);
    const result = await prepareRerun("three-way-job", "all", undefined, inMemoryJobRecordLookup({ "three-way-job": record }));
    assert.equal(dispatchFor(result), "mixed");
    if (result.ok && result.jobType === "scenario-preview") {
      const byId = new Map(result.promotedSpecReuse.map((e) => [e.scenarioId, e]));
      assert.equal(byId.get("REC-A")?.reuse, true);
      assert.equal(byId.get("REC-B")?.reuse, false);
      assert.equal(byId.get("REC-B")?.specState, "missing");
      assert.equal(byId.get("REC-C")?.reuse, false);
      assert.equal(byId.get("REC-C")?.specState, "stale");
      assert.deepEqual(result.scenarios.map((s) => s.scenarioId).sort(), ["REC-B", "REC-C"]);
    }
  } finally {
    cleanup();
  }
});

test("8/RUNTIME_AUTHORITY_ISOLATION_IN_MIXED_BATCH: in a mixed batch, each scenario's OWN current runtimeDataset is used -- never leaked/swapped between the reuse and fallback scenario", async () => {
  try {
    const specA = path.join(recordingDir(APP_SLUG, RECORDING_ID), "..", "..", "sections", "s", "cases", "a", "case.spec.ts");
    const { specHash: hashA } = await writeFreshPromotedSpec(specA);
    saveScenarios(APP_SLUG, RECORDING_ID, [
      recordedScenario({
        scenarioId: "REC-A",
        promotedSpec: { appSlug: APP_SLUG, specPath: specA, specHash: hashA, automationId: "a", generatedAt: "t" } as any,
        runtimeDataset: { resolvedValues: { field_a: "value-for-A" } } as any,
      }),
      recordedScenario({
        scenarioId: "REC-B",
        runtimeDataset: { resolvedValues: { field_a: "value-for-B" } } as any,
      }),
    ]);
    const record = reuseJobRecord([{ scenarioId: "REC-A", specPath: specA }, { scenarioId: "REC-B", specPath: "b/case.spec.ts" }]);
    const result = await prepareRerun("isolation-mixed-job", "all", undefined, inMemoryJobRecordLookup({ "isolation-mixed-job": record }));
    assert.equal(result.ok, true);
    if (result.ok && result.jobType === "scenario-preview") {
      const a = result.promotedSpecReuse.find((e) => e.scenarioId === "REC-A");
      const b = result.promotedSpecReuse.find((e) => e.scenarioId === "REC-B");
      assert.equal(a?.runtimeValues?.field_a, "value-for-A");
      assert.equal(b?.runtimeValues?.field_a, "value-for-B");
    }
  } finally {
    cleanup();
  }
});

test("9/NO_FABRICATION_WITHOUT_CANONICAL_AUTHORITY: a scenarioId with no canonical match anywhere fails the request closed -- toSharedMcpScenario is never invoked for a scenario the recording store doesn't actually have", async () => {
  try {
    saveScenarios(APP_SLUG, RECORDING_ID, [recordedScenario({ scenarioId: "REC-A" })]); // REC-B does not exist
    const record = reuseJobRecord([{ scenarioId: "REC-A", specPath: "a/case.spec.ts" }, { scenarioId: "REC-B", specPath: "b/case.spec.ts" }]);
    const result = await prepareRerun("no-authority-job", "all", undefined, inMemoryJobRecordLookup({ "no-authority-job": record }));
    assert.equal(result.ok, false, "must fail closed rather than fabricate a McpScenario for a scenario with no canonical authority");
    if (!result.ok) assert.equal(result.error, "rerun_lineage_broken");
  } finally {
    cleanup();
  }
});
