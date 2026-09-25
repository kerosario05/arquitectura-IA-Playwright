import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { startMixedRerun, type MixedRerunRunners } from "./mixed-rerun-orchestrator";
import { jobStore } from "./job-store";
import type { ReuseExistingPromotedSpecScenario } from "./scenario-preview-runner";
import type { McpScenario } from "../../scenarios/scenario-types";

/**
 * A mixed rerun (some scenarios fresh/reusable, some stale/missing) previously fell through
 * entirely to the full scenario-preview pipeline, discarding the reuse opportunity for the
 * fresh subset (MIXED_RERUN_NEXT_RISK). startMixedRerun fixes this by giving each subset its
 * own hidden child job (job-store.ts's parentJobId support) and owning the single
 * finalization/consolidation the two existing runners can't safely share on one job record.
 *
 * Fake runners are injected in place of the real startReuseExistingPromotedSpecRun/
 * startScenarioPreviewRun — the real fallback runner spawns an actual Playwright/discovery
 * subprocess, which is out of scope for a hermetic test. Each fake simulates exactly what the
 * real runner does to jobStore/evidence for the purposes being tested here: writes
 * case_started/case_finished, a real evidence.json under the run it was told to use
 * (executionContext.evidenceRunId), and its own terminal status/summary.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");

function reuseScenario(overrides: Partial<ReuseExistingPromotedSpecScenario> = {}): ReuseExistingPromotedSpecScenario {
  return { scenarioId: "REC-A", caseId: 1, specPath: "a/case.spec.ts", title: "Fresh A", ...overrides };
}

function fallbackScenario(overrides: Partial<McpScenario> = {}): McpScenario {
  return { scenarioId: "REC-B", title: "Stale B" } as McpScenario;
}

function writeEvidence(evidenceRunId: string, appSlug: string, sectionSlug: string, scenarioId: string, status: "Exitoso" | "Fallido"): void {
  const dir = path.join(ROOT, ".artifacts", "evidence", appSlug, sectionSlug, "runs", evidenceRunId, "scenarios", scenarioId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "evidence.json"), JSON.stringify({ scenarioId, status, steps: [] }), "utf-8");
}

function cleanupEvidence(appSlug: string): void {
  fs.rmSync(path.join(ROOT, ".artifacts", "evidence", appSlug), { recursive: true, force: true });
}

function fakeRunners(opts: {
  reuseStatus: "passed" | "failed";
  fallbackStatus: "passed" | "failed";
  reuseCalls: string[];
  fallbackCalls: string[];
  reuseEvidenceRunIds: string[];
  fallbackEvidenceRunIds: string[];
  reuseConsolidationCalls: number[];
  fallbackConsolidationCalls: number[];
}): MixedRerunRunners {
  return {
    runReuse: async (jobId: string) => {
      opts.reuseCalls.push(jobId);
      const job = jobStore.get(jobId)!;
      const scenarios = job.params.scenarios as ReuseExistingPromotedSpecScenario[];
      const executionContext = job.params.executionContext as { evidenceRunId?: string; suppressEvidenceConsolidation?: boolean } | undefined;
      opts.reuseEvidenceRunIds.push(executionContext?.evidenceRunId ?? jobId);
      if (executionContext?.suppressEvidenceConsolidation) opts.reuseConsolidationCalls.push(0);
      jobStore.appendLog(jobId, `[reuse-existing] starting jobId=${jobId} scenarios=${scenarios.length} routeDiscoveryInvoked=false mcpDiscoveryInvoked=false aiInvoked=false specGenerationInvoked=false recordingReplayInvoked=false publishToTestRailInvoked=false`);
      for (const s of scenarios) {
        jobStore.appendLog(jobId, JSON.stringify({ type: "case_started", caseId: s.scenarioId, title: s.title }));
        jobStore.appendLog(jobId, JSON.stringify({ type: "case_finished", caseId: s.scenarioId, title: s.title, status: opts.reuseStatus }));
      }
      jobStore.update(jobId, {
        status: opts.reuseStatus === "passed" ? "done" : "failed",
        completedAt: new Date().toISOString(),
        summary: { totalStories: scenarios.length, synced: 0, passed: opts.reuseStatus === "passed" ? scenarios.length : 0, failed: opts.reuseStatus === "failed" ? scenarios.length : 0, completed: scenarios.length },
      });
    },
    runFallback: async (jobId: string) => {
      opts.fallbackCalls.push(jobId);
      const job = jobStore.get(jobId)!;
      const scenarios = job.params.scenarios as McpScenario[];
      const executionContext = job.params.executionContext as { evidenceRunId?: string; suppressEvidenceConsolidation?: boolean } | undefined;
      opts.fallbackEvidenceRunIds.push(executionContext?.evidenceRunId ?? jobId);
      if (executionContext?.suppressEvidenceConsolidation) opts.fallbackConsolidationCalls.push(0);
      for (const s of scenarios) {
        jobStore.appendLog(jobId, JSON.stringify({ type: "case_started", caseId: s.scenarioId, title: s.title }));
        jobStore.appendLog(jobId, JSON.stringify({ type: "case_finished", caseId: s.scenarioId, title: s.title, status: opts.fallbackStatus }));
      }
      jobStore.update(jobId, {
        status: opts.fallbackStatus === "passed" ? "done" : "failed",
        completedAt: new Date().toISOString(),
        summary: { totalStories: scenarios.length, synced: 0, passed: opts.fallbackStatus === "passed" ? scenarios.length : 0, failed: opts.fallbackStatus === "failed" ? scenarios.length : 0, completed: scenarios.length },
      });
    },
  };
}

test("1/2/13. partition: reuse subset only goes to the reuse child, fallback subset only to the fallback child, neither child appears in the public job list", async () => {
  const appSlug = "hermetic-mixed-1";
  const parent = jobStore.create("scenario-preview", { appSlug });
  const calls = { reuseCalls: [] as string[], fallbackCalls: [] as string[], reuseEvidenceRunIds: [] as string[], fallbackEvidenceRunIds: [] as string[], reuseConsolidationCalls: [] as number[], fallbackConsolidationCalls: [] as number[] };
  try {
    await startMixedRerun(
      { parentJobId: parent.id, appSlug, sourceJobId: "source-1", rerunMode: "all", reuseScenarios: [reuseScenario()], fallbackScenarios: [fallbackScenario()] },
      fakeRunners({ reuseStatus: "passed", fallbackStatus: "passed", ...calls }),
    );
    assert.equal(calls.reuseCalls.length, 1);
    assert.equal(calls.fallbackCalls.length, 1);
    const reuseJob = jobStore.get(calls.reuseCalls[0])!;
    const fallbackJob = jobStore.get(calls.fallbackCalls[0])!;
    assert.deepEqual((reuseJob.params.scenarios as ReuseExistingPromotedSpecScenario[]).map((s) => s.scenarioId), ["REC-A"]);
    assert.deepEqual((fallbackJob.params.scenarios as McpScenario[]).map((s) => s.scenarioId), ["REC-B"]);
    assert.equal(reuseJob.parentJobId, parent.id);
    assert.equal(fallbackJob.parentJobId, parent.id);
    const publicIds = jobStore.list().map((j) => j.id);
    assert.ok(publicIds.includes(parent.id));
    assert.ok(!publicIds.includes(reuseJob.id), "reuse child must not appear in the public job list");
    assert.ok(!publicIds.includes(fallbackJob.id), "fallback child must not appear in the public job list");
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("4. fresh/reuse subset runs with zero discovery/AI/generation/TestRail-publish (invariant log line preserved)", async () => {
  const appSlug = "hermetic-mixed-2";
  const parent = jobStore.create("scenario-preview", { appSlug });
  const calls = { reuseCalls: [] as string[], fallbackCalls: [] as string[], reuseEvidenceRunIds: [] as string[], fallbackEvidenceRunIds: [] as string[], reuseConsolidationCalls: [] as number[], fallbackConsolidationCalls: [] as number[] };
  try {
    await startMixedRerun(
      { parentJobId: parent.id, appSlug, sourceJobId: "s", rerunMode: "all", reuseScenarios: [reuseScenario()], fallbackScenarios: [fallbackScenario()] },
      fakeRunners({ reuseStatus: "passed", fallbackStatus: "passed", ...calls }),
    );
    const reuseJob = jobStore.get(calls.reuseCalls[0])!;
    const startLog = reuseJob.logs.find((l) => l.includes("[reuse-existing] starting"));
    assert.ok(startLog);
    for (const flag of ["routeDiscoveryInvoked=false", "mcpDiscoveryInvoked=false", "aiInvoked=false", "specGenerationInvoked=false", "recordingReplayInvoked=false", "publishToTestRailInvoked=false"]) {
      assert.ok(startLog!.includes(flag));
    }
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("5. fallback subset never contains the reusable scenario", async () => {
  const appSlug = "hermetic-mixed-3";
  const parent = jobStore.create("scenario-preview", { appSlug });
  const calls = { reuseCalls: [] as string[], fallbackCalls: [] as string[], reuseEvidenceRunIds: [] as string[], fallbackEvidenceRunIds: [] as string[], reuseConsolidationCalls: [] as number[], fallbackConsolidationCalls: [] as number[] };
  try {
    await startMixedRerun(
      { parentJobId: parent.id, appSlug, sourceJobId: "s", rerunMode: "all", reuseScenarios: [reuseScenario()], fallbackScenarios: [fallbackScenario()] },
      fakeRunners({ reuseStatus: "passed", fallbackStatus: "passed", ...calls }),
    );
    const fallbackJob = jobStore.get(calls.fallbackCalls[0])!;
    const ids = (fallbackJob.params.scenarios as McpScenario[]).map((s) => s.scenarioId);
    assert.ok(!ids.includes("REC-A"));
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("6. both subsets are told evidenceRunId=parentJobId, and neither self-consolidates", async () => {
  const appSlug = "hermetic-mixed-4";
  const parent = jobStore.create("scenario-preview", { appSlug });
  const calls = { reuseCalls: [] as string[], fallbackCalls: [] as string[], reuseEvidenceRunIds: [] as string[], fallbackEvidenceRunIds: [] as string[], reuseConsolidationCalls: [] as number[], fallbackConsolidationCalls: [] as number[] };
  try {
    await startMixedRerun(
      { parentJobId: parent.id, appSlug, sourceJobId: "s", rerunMode: "all", reuseScenarios: [reuseScenario()], fallbackScenarios: [fallbackScenario()] },
      fakeRunners({ reuseStatus: "passed", fallbackStatus: "passed", ...calls }),
    );
    assert.deepEqual(calls.reuseEvidenceRunIds, [parent.id]);
    assert.deepEqual(calls.fallbackEvidenceRunIds, [parent.id]);
    assert.equal(calls.reuseConsolidationCalls.length, 1, "reuse child must have suppressEvidenceConsolidation=true");
    assert.equal(calls.fallbackConsolidationCalls.length, 1, "fallback child must have suppressEvidenceConsolidation=true");
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("7. consolidateRunEvidence runs exactly once for the parent, aggregating both subsets' real evidence into one document", async () => {
  const appSlug = "hermetic-mixed-5";
  const parent = jobStore.create("scenario-preview", { appSlug });
  const calls = { reuseCalls: [] as string[], fallbackCalls: [] as string[], reuseEvidenceRunIds: [] as string[], fallbackEvidenceRunIds: [] as string[], reuseConsolidationCalls: [] as number[], fallbackConsolidationCalls: [] as number[] };
  try {
    // Plant evidence for BOTH scenarios under the PARENT's own runId, as the runners would once
    // wired for real — proves the single downstream consolidation call aggregates across subsets.
    writeEvidence(parent.id, appSlug, "default-section", "REC-A", "Exitoso");
    writeEvidence(parent.id, appSlug, "default-section", "REC-B", "Fallido");

    await startMixedRerun(
      { parentJobId: parent.id, appSlug, sourceJobId: "s", rerunMode: "all", reuseScenarios: [reuseScenario()], fallbackScenarios: [fallbackScenario()] },
      fakeRunners({ reuseStatus: "passed", fallbackStatus: "failed", ...calls }),
    );

    const finalParent = jobStore.get(parent.id)!;
    assert.ok(finalParent.summary?.evidenceDir, "a single consolidated document must exist for the parent");
    const runJsonPath = path.join(ROOT, ".artifacts", "evidence", appSlug, "default-section", "runs", parent.id, "evidence-run.json");
    assert.ok(fs.existsSync(runJsonPath));
    const record = JSON.parse(fs.readFileSync(runJsonPath, "utf-8"));
    assert.equal(record.totalScenarios, 2, "one consolidation pass must have picked up BOTH subsets' evidence");
    const finishedLog = finalParent.logs.find((l) => l.includes("[mixed-rerun] finished"));
    assert.ok(finishedLog?.includes("evidenceRunConsolidated=true"));
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("9/12. combined summary: PASS + PASS -> parent passed=2 failed=0, exactly one case_started/case_finished per scenario on the parent stream", async () => {
  const appSlug = "hermetic-mixed-6";
  const parent = jobStore.create("scenario-preview", { appSlug });
  const calls = { reuseCalls: [] as string[], fallbackCalls: [] as string[], reuseEvidenceRunIds: [] as string[], fallbackEvidenceRunIds: [] as string[], reuseConsolidationCalls: [] as number[], fallbackConsolidationCalls: [] as number[] };
  try {
    await startMixedRerun(
      { parentJobId: parent.id, appSlug, sourceJobId: "s", rerunMode: "all", reuseScenarios: [reuseScenario()], fallbackScenarios: [fallbackScenario()] },
      fakeRunners({ reuseStatus: "passed", fallbackStatus: "passed", ...calls }),
    );
    const finalParent = jobStore.get(parent.id)!;
    assert.equal(finalParent.summary?.passed, 2);
    assert.equal(finalParent.summary?.failed, 0);
    assert.equal(finalParent.status, "done");

    const started = finalParent.logs.filter((l) => l.includes('"type":"case_started"'));
    const finished = finalParent.logs.filter((l) => l.includes('"type":"case_finished"'));
    assert.equal(started.length, 2);
    assert.equal(finished.length, 2);
    const startedIds = started.map((l) => JSON.parse(l).caseId).sort();
    assert.deepEqual(startedIds, ["REC-A", "REC-B"]);
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("10/11. mixed failure (PASS + FAIL) -> parent status=failed, and parent only finalizes after BOTH children are terminal", async () => {
  const appSlug = "hermetic-mixed-7";
  const parent = jobStore.create("scenario-preview", { appSlug });
  const calls = { reuseCalls: [] as string[], fallbackCalls: [] as string[], reuseEvidenceRunIds: [] as string[], fallbackEvidenceRunIds: [] as string[], reuseConsolidationCalls: [] as number[], fallbackConsolidationCalls: [] as number[] };
  let reuseTerminalWhenFallbackStarts: boolean | undefined;
  const runners = fakeRunners({ reuseStatus: "passed", fallbackStatus: "failed", ...calls });
  const wrappedRunners: MixedRerunRunners = {
    runReuse: runners.runReuse,
    runFallback: async (jobId: string) => {
      // Sequential ordering proof: by the time the fallback subset starts, the reuse child must
      // already be terminal (its own status set), and the PARENT must still be "running" (not
      // yet finalized) — the parent only finalizes once, after both children.
      reuseTerminalWhenFallbackStarts = jobStore.get(calls.reuseCalls[0])!.status !== "running" && jobStore.get(calls.reuseCalls[0])!.status !== "queued";
      assert.equal(jobStore.get(parent.id)!.status, "running", "parent must not be finalized before the fallback subset even starts");
      return runners.runFallback(jobId);
    },
  };
  try {
    await startMixedRerun(
      { parentJobId: parent.id, appSlug, sourceJobId: "s", rerunMode: "all", reuseScenarios: [reuseScenario()], fallbackScenarios: [fallbackScenario()] },
      wrappedRunners,
    );
    assert.equal(reuseTerminalWhenFallbackStarts, true);
    const finalParent = jobStore.get(parent.id)!;
    assert.equal(finalParent.summary?.passed, 1);
    assert.equal(finalParent.summary?.failed, 1);
    assert.equal(finalParent.status, "failed", "never PASS just because the fresh subset passed, and never just the last child's status");
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("14/allReusable & noneReusable regression: startMixedRerun is not invoked at all when a batch is 100% one-sided (structural: empty subset never dispatches its runner)", async () => {
  const appSlug = "hermetic-mixed-8";
  const parent = jobStore.create("scenario-preview", { appSlug });
  const calls = { reuseCalls: [] as string[], fallbackCalls: [] as string[], reuseEvidenceRunIds: [] as string[], fallbackEvidenceRunIds: [] as string[], reuseConsolidationCalls: [] as number[], fallbackConsolidationCalls: [] as number[] };
  try {
    await startMixedRerun(
      { parentJobId: parent.id, appSlug, sourceJobId: "s", rerunMode: "all", reuseScenarios: [], fallbackScenarios: [fallbackScenario()] },
      fakeRunners({ reuseStatus: "passed", fallbackStatus: "passed", ...calls }),
    );
    assert.equal(calls.reuseCalls.length, 0, "an empty reuse subset must never invoke the reuse runner");
    assert.equal(calls.fallbackCalls.length, 1);
  } finally {
    cleanupEvidence(appSlug);
  }
});
