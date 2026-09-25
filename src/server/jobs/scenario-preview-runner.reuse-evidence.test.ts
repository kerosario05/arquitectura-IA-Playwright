import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { startReuseExistingPromotedSpecRun, type ReuseExistingPromotedSpecScenario } from "./scenario-preview-runner";
import { jobStore } from "./job-store";
import type { VerifyPromotedSpecOptions } from "../../automations/promote-plan";

/**
 * Promoted-spec reuse ran GREEN but never produced new evidence: verifyPromotedSpec never
 * scoped the spawned process's evidence recorder to the reuse job (see
 * promote-plan.evidence-context.test.ts), and startReuseExistingPromotedSpecRun never called
 * consolidateRunEvidence at all. This proves the wiring in the reuse RUNNER itself: each
 * scenario's evidenceContext carries THIS run's real jobId/scenarioId/title/appSlug (never
 * title/index-derived), consolidation is reused (not reimplemented) keyed on the CURRENT reuse
 * jobId, evidenceDir is only ever persisted when a document genuinely exists on disk, and a
 * functional failure is never masked by evidence bookkeeping.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");

function scenario(overrides: Partial<ReuseExistingPromotedSpecScenario> = {}): ReuseExistingPromotedSpecScenario {
  return { scenarioId: "REC-EVID-01", caseId: 1, specPath: "some/case.spec.ts", title: "Tarjeta", ...overrides };
}

function fakeVerify(outcomeByScenarioId: Record<string, "passed" | "failed">, calls: Array<{ specPath: string; options?: VerifyPromotedSpecOptions }>) {
  return async (specPath: string, _timeoutMs?: number, options?: VerifyPromotedSpecOptions) => {
    calls.push({ specPath, options });
    const status = outcomeByScenarioId[options?.scenarioId ?? ""] ?? "passed";
    return status === "passed" ? { status: "passed" as const } : { status: "failed" as const, error: "boom" };
  };
}

function cleanupEvidence(appSlug: string): void {
  fs.rmSync(path.join(ROOT, ".artifacts", "evidence", appSlug), { recursive: true, force: true });
}

test("1. each scenario's evidenceContext carries THIS reuse job's real jobId/scenarioId/title/appSlug", async () => {
  const appSlug = "hermetic-evidence-app-1";
  const calls: Array<{ specPath: string; options?: VerifyPromotedSpecOptions }> = [];
  const job = jobStore.create("scenario-preview", { appSlug, scenarios: [scenario()], executionMode: "reuse_existing_promoted_spec" });
  try {
    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({}, calls));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].options?.evidenceContext, {
      runId: job.id,
      scenarioId: "REC-EVID-01",
      scenarioTitle: "Tarjeta",
      appSlug,
      sectionSlug: "default-section",
    });
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("2. two scenarios with similar titles never contaminate each other's evidenceContext (keyed by canonical scenarioId, not title/index)", async () => {
  const appSlug = "hermetic-evidence-app-2";
  const calls: Array<{ specPath: string; options?: VerifyPromotedSpecOptions }> = [];
  const scenarios = [
    scenario({ scenarioId: "REC-A", title: "Tarjeta Credito", specPath: "a/case.spec.ts" }),
    scenario({ scenarioId: "REC-B", title: "Tarjeta Credito", specPath: "b/case.spec.ts" }), // same title, different canonical id
  ];
  const job = jobStore.create("scenario-preview", { appSlug, scenarios, executionMode: "reuse_existing_promoted_spec" });
  try {
    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({}, calls));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options?.evidenceContext?.scenarioId, "REC-A");
    assert.equal(calls[1].options?.evidenceContext?.scenarioId, "REC-B");
    assert.notEqual(calls[0].options?.evidenceContext, calls[1].options?.evidenceContext, "each scenario must get its own evidenceContext object");
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("3. consolidation runs for real, keyed on the CURRENT reuse jobId, and a genuinely-produced document's evidenceDir is persisted onto the job", async () => {
  const appSlug = "hermetic-evidence-app-3";
  const job = jobStore.create("scenario-preview", { appSlug, scenarios: [scenario()], executionMode: "reuse_existing_promoted_spec" });
  try {
    // Plant a scenario evidence.json exactly where promoted-spec-runtime.ts would have written
    // it had it received EVIDENCE_RUN_ID=job.id — simulating runtime evidence capture without
    // spawning a real browser, so consolidation has something real to aggregate.
    const scenarioEvidenceDir = path.join(ROOT, ".artifacts", "evidence", appSlug, "default-section", "runs", job.id, "scenarios", "REC-EVID-01");
    fs.mkdirSync(scenarioEvidenceDir, { recursive: true });
    fs.writeFileSync(
      path.join(scenarioEvidenceDir, "evidence.json"),
      JSON.stringify({ scenarioId: "REC-EVID-01", status: "Exitoso", steps: [] }),
      "utf-8",
    );

    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({ "REC-EVID-01": "passed" }, []));

    const finalJob = jobStore.get(job.id)!;
    assert.ok(finalJob.summary?.evidenceDir, "evidenceDir must be persisted once a real document was generated");
    const docxPath = path.join(finalJob.summary!.evidenceDir!, "evidencia.docx");
    assert.ok(fs.existsSync(docxPath), `evidencia.docx must actually exist on disk at ${docxPath}`);
    const runJsonPath = path.join(ROOT, ".artifacts", "evidence", appSlug, "default-section", "runs", job.id, "evidence-run.json");
    assert.ok(fs.existsSync(runJsonPath), "evidence-run.json must exist for this reuse job's own runId");

    const finishedLog = finalJob.logs.find((l) => l.includes("[reuse-existing] finished"));
    assert.ok(finishedLog?.includes("evidenceRunConsolidated=true"));
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("4. no runtime evidence captured (nothing planted) -> consolidation runs but never fabricates a document", async () => {
  const appSlug = "hermetic-evidence-app-4";
  const job = jobStore.create("scenario-preview", { appSlug, scenarios: [scenario()], executionMode: "reuse_existing_promoted_spec" });
  try {
    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({}, []));
    const finalJob = jobStore.get(job.id)!;
    assert.equal(finalJob.summary?.evidenceDir, undefined, "no evidence.json existed, so no document was actually generated — evidenceDir must stay unset");
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("5. scenario failure is never masked by evidence consolidation — status stays failed regardless", async () => {
  const appSlug = "hermetic-evidence-app-5";
  const job = jobStore.create("scenario-preview", { appSlug, scenarios: [scenario()], executionMode: "reuse_existing_promoted_spec" });
  try {
    const scenarioEvidenceDir = path.join(ROOT, ".artifacts", "evidence", appSlug, "default-section", "runs", job.id, "scenarios", "REC-EVID-01");
    fs.mkdirSync(scenarioEvidenceDir, { recursive: true });
    fs.writeFileSync(
      path.join(scenarioEvidenceDir, "evidence.json"),
      JSON.stringify({ scenarioId: "REC-EVID-01", status: "Exitoso", steps: [] }), // recorded evidence says success...
      "utf-8",
    );

    // ...but the actual functional verification failed. The job's real outcome must win.
    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({ "REC-EVID-01": "failed" }, []));

    const finalJob = jobStore.get(job.id)!;
    assert.equal(finalJob.status, "failed");
    assert.equal(finalJob.summary?.failed, 1);
    assert.equal(finalJob.summary?.passed, 0);
  } finally {
    cleanupEvidence(appSlug);
  }
});

test("6. reuse invariants (discovery/AI/generation/TestRail) remain false even with evidence now wired in", async () => {
  const appSlug = "hermetic-evidence-app-6";
  const job = jobStore.create("scenario-preview", { appSlug, scenarios: [scenario()], executionMode: "reuse_existing_promoted_spec" });
  try {
    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({}, []));
    const finalJob = jobStore.get(job.id)!;
    const startLog = finalJob.logs.find((l) => l.includes("[reuse-existing] starting"));
    assert.ok(startLog);
    for (const flag of ["routeDiscoveryInvoked=false", "mcpDiscoveryInvoked=false", "aiInvoked=false", "specGenerationInvoked=false", "recordingReplayInvoked=false", "autoPromoteInvoked=false", "publishToTestRailInvoked=false"]) {
      assert.ok(startLog!.includes(flag), `expected ${flag} in: ${startLog}`);
    }
  } finally {
    cleanupEvidence(appSlug);
  }
});
