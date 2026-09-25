import fs from "fs";
import path from "path";
import { jobStore } from "./job-store";
import {
  startReuseExistingPromotedSpecRun,
  startScenarioPreviewRun,
  consolidateRunEvidence,
  type ReuseExistingPromotedSpecScenario,
} from "./scenario-preview-runner";
import type { McpScenario } from "../../scenarios/scenario-types";
import type { JobStatus } from "./job-store";

/**
 * A mixed rerun batch (some scenarios have a fresh promoted spec, some don't) previously fell
 * through entirely to the full scenario-preview/discovery/AI pipeline for EVERY scenario,
 * wasting the reuse opportunity for the fresh subset (logged as MIXED_RERUN_NEXT_RISK). This
 * orchestrator lets each existing runner do exactly what it already does — unmodified — for its
 * own subset, on its own hidden child job (see job-store.ts's parentJobId support), while owning
 * the ONE thing neither runner can safely share: the single visible parent job's final
 * status/summary and the single evidence consolidation pass.
 */

export type MixedRerunInput = {
  parentJobId: string;
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  sectionName?: string;
  sectionSlug?: string;
  options?: Record<string, unknown>;
  sourceJobId: string;
  rerunMode: string;
  reuseScenarios: ReuseExistingPromotedSpecScenario[];
  fallbackScenarios: McpScenario[];
};

function relayCaseEvents(parentJobId: string) {
  return (line: string) => {
    // Only case_started/case_finished are forwarded — every other log line is internal to the
    // child's own run and would just be noise (or, worse, a misleading duplicate) on the parent.
    if (line.includes('"type":"case_started"') || line.includes('"type":"case_finished"')) {
      jobStore.appendLog(parentJobId, line);
    }
  };
}

export type MixedRerunRunners = {
  runReuse: typeof startReuseExistingPromotedSpecRun;
  runFallback: typeof startScenarioPreviewRun;
};

const DEFAULT_RUNNERS: MixedRerunRunners = {
  runReuse: startReuseExistingPromotedSpecRun,
  runFallback: startScenarioPreviewRun,
};

export async function startMixedRerun(
  input: MixedRerunInput,
  // Injectable so tests can prove partitioning/aggregation/evidence-authority behavior without
  // spawning a real Playwright process for the fallback subset — production callers always get
  // the real runners.
  runners: MixedRerunRunners = DEFAULT_RUNNERS,
): Promise<void> {
  const { parentJobId, appSlug, sectionName, sectionSlug, reuseScenarios, fallbackScenarios } = input;
  const total = reuseScenarios.length + fallbackScenarios.length;

  jobStore.update(parentJobId, {
    status: "running",
    startedAt: new Date().toISOString(),
    summary: { totalStories: total, synced: 0, passed: 0, failed: 0, completed: 0, scenarioCount: total },
  });
  jobStore.appendLog(
    parentJobId,
    `[mixed-rerun] starting parentJobId=${parentJobId} reuseCount=${reuseScenarios.length} fallbackCount=${fallbackScenarios.length} `
    + `publishToTestRailInvoked=false discoveryInvokedForReuseSubset=false aiInvokedForReuseSubset=false`,
  );

  // Sequential by design (reuse subset first): correctness over concurrency — this ticket does
  // not need the two subsets to overlap, and running them one at a time keeps the parent's
  // intermediate state trivially consistent (each child owns its own job record throughout;
  // the parent is only ever written by this orchestrator, never by a subset runner directly).
  const reuseChild = jobStore.create(
    "scenario-preview",
    {
      appSlug,
      sectionName,
      sectionSlug,
      scenarios: reuseScenarios,
      executionMode: "reuse_existing_promoted_spec",
      executionContext: { evidenceRunId: parentJobId, suppressEvidenceConsolidation: true },
    },
    { parentJobId },
  );
  if (reuseScenarios.length > 0) {
    const unsubscribe = jobStore.subscribe(reuseChild.id, { onLog: relayCaseEvents(parentJobId), onUpdate: () => {} });
    await runners.runReuse(reuseChild.id);
    unsubscribe();
  } else {
    jobStore.update(reuseChild.id, { status: "done", completedAt: new Date().toISOString(), summary: { totalStories: 0, synced: 0, passed: 0, failed: 0, completed: 0 } });
  }

  const fallbackChild = jobStore.create(
    "scenario-preview",
    {
      scenarios: fallbackScenarios,
      appSlug,
      targetAppSlug: input.targetAppSlug,
      targetAppName: input.targetAppName,
      sourceJobId: input.sourceJobId,
      rerunMode: input.rerunMode,
      rerun: true,
      sectionName,
      sectionSlug,
      publishToTestRail: false,
      createTestRun: false,
      reportResults: false,
      options: input.options ?? { overwrite: true, autoPromote: true, autoPom: true, rerunActive: true, headed: false },
      executionContext: { evidenceRunId: parentJobId, suppressEvidenceConsolidation: true },
    },
    { parentJobId },
  );
  if (fallbackScenarios.length > 0) {
    const unsubscribe = jobStore.subscribe(fallbackChild.id, { onLog: relayCaseEvents(parentJobId), onUpdate: () => {} });
    await runners.runFallback(fallbackChild.id);
    unsubscribe();
  } else {
    jobStore.update(fallbackChild.id, { status: "done", completedAt: new Date().toISOString(), summary: { totalStories: 0, synced: 0, passed: 0, failed: 0, completed: 0 } });
  }

  const reuseFinal = jobStore.get(reuseChild.id);
  const fallbackFinal = jobStore.get(fallbackChild.id);
  const passed = (reuseFinal?.summary?.passed ?? 0) + (fallbackFinal?.summary?.passed ?? 0);
  const failed = (reuseFinal?.summary?.failed ?? 0) + (fallbackFinal?.summary?.failed ?? 0);
  // Any failure in either subset fails the whole mixed rerun — never "PASS because the fresh
  // subset passed", and never just whichever child happened to finish last.
  const finalStatus: JobStatus = failed === 0 ? "done" : "failed";

  // Single consolidation pass for BOTH subsets — both wrote their evidence under
  // runs/<parentJobId>/scenarios/... (see executionContext.evidenceRunId above), so this one
  // call aggregates everything into one evidence-run.json/evidencia.docx. No caseOutcomeMap is
  // passed: with reuse/fallback scenarios mutually exclusive by construction (prepareRerun never
  // puts the same scenario in both subsets), each scenario's own freshly-captured runtime
  // evidence status is already authoritative — there is nothing to reconcile across subsets.
  const consolidation = await consolidateRunEvidence(parentJobId, appSlug, sectionSlug, sectionName, undefined);
  const evidenceDir = consolidation?.docxPath && fs.existsSync(consolidation.docxPath)
    ? path.dirname(consolidation.docxPath)
    : undefined;

  const priorSummary = jobStore.get(parentJobId)?.summary;
  jobStore.update(parentJobId, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    summary: {
      totalStories: total,
      synced: priorSummary?.synced ?? 0,
      passed,
      failed,
      completed: total,
      scenarioCount: total,
      evidenceDir,
    },
  });
  jobStore.appendLog(
    parentJobId,
    `[mixed-rerun] finished parentJobId=${parentJobId} reuseChild=${reuseChild.id} fallbackChild=${fallbackChild.id} `
    + `passed=${passed} failed=${failed} status=${finalStatus} evidenceRunConsolidated=${Boolean(consolidation)} `
    + `evidenceDir=${evidenceDir ?? "none"} publishToTestRailInvoked=false`,
  );
}
