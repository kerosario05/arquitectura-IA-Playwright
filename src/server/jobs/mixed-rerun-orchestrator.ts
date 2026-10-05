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
import type { EvidenceScenarioRecord } from "../../evidence/evidence-types";

const TERMINAL_JOB_STATUSES = new Set<JobStatus>([
  "done",
  "failed",
  "cancelled",
  "completed_with_failures",
  "completed_with_sync_errors",
]);

/** Wait until a child runner has actually completed, even if its kickoff function only spawned
 * a background process and returned. Subscribe first and recheck after subscribing to close the
 * race where the child reaches a terminal state between the initial read and subscription. */
function waitForChildTerminal(childJobId: string): Promise<void> {
  const current = jobStore.get(childJobId);
  if (!current || TERMINAL_JOB_STATUSES.has(current.status)) return Promise.resolve();

  return new Promise((resolve) => {
    let unsubscribe = () => {};
    const checkTerminal = () => {
      const latest = jobStore.get(childJobId);
      if (!latest || TERMINAL_JOB_STATUSES.has(latest.status)) {
        unsubscribe();
        resolve();
      }
    };
    unsubscribe = jobStore.subscribe(childJobId, { onLog: () => {}, onUpdate: checkTerminal });
    checkTerminal();
  });
}

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

type CaseProgress = {
  completed: number;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  notExecutable: number;
  finishedIds: Set<string>;
  finishedIndexes: Set<number>;
  indexByCaseId: Map<string, number>;
};

function scenarioIdentity(scenario: ReuseExistingPromotedSpecScenario | McpScenario): string | undefined {
  if ("scenarioId" in scenario && scenario.scenarioId) return scenario.scenarioId;
  if ("sourceIssueKey" in scenario && scenario.sourceIssueKey) return scenario.sourceIssueKey;
  return "title" in scenario && typeof scenario.title === "string" ? scenario.title : undefined;
}

function writeParentProgress(parentJobId: string, total: number, progress: CaseProgress, current?: {
  caseId?: string | null;
  title?: string | null;
  index?: number;
} | null) {
  const previous = jobStore.get(parentJobId)?.summary;
  const executedResults = progress.passed + progress.failed;
  jobStore.update(parentJobId, {
    ...(current !== undefined ? {
      currentCase: current?.title ?? current?.caseId ?? null,
      currentCaseId: current?.caseId ?? null,
      currentCaseTitle: current?.title ?? null,
    } : {}),
    summary: {
      ...previous,
      totalStories: total,
      scenarioCount: total,
      requested: total,
      requestedCases: total,
      totalCases: total,
      completed: progress.completed,
      executed: progress.executed,
      executedCases: progress.executed,
      passed: progress.passed,
      failed: progress.failed,
      skipped: progress.skipped,
      notExecutableCases: progress.notExecutable,
      currentCaseIndex: current?.index ?? progress.completed,
      progressPercent: total > 0 ? Math.round((progress.completed / total) * 100) : 100,
      passRate: executedResults > 0 ? Math.round((progress.passed / executedResults) * 100) : null,
    },
  });
}

function makeNotExecutedEvidence(
  scenario: ReuseExistingPromotedSpecScenario | McpScenario,
  appSlug: string,
  sectionSlug: string | undefined,
  sectionName: string | undefined,
  reason: string,
): EvidenceScenarioRecord {
  const scenarioId = scenarioIdentity(scenario);
  const title = "title" in scenario && typeof scenario.title === "string" ? scenario.title : undefined;
  const date = new Date().toLocaleDateString("es-ES", { year: "numeric", month: "long", day: "numeric" });
  return {
    scenarioId: scenarioId || title || "Escenario sin identificador",
    scenarioTitle: title || scenarioId || "Escenario sin título",
    requirement: `Automatización - ${sectionName || sectionSlug || "Ejecución"}`,
    analyst: "Automatización",
    date,
    status: "No ejecutado",
    appSlug,
    sectionSlug: sectionSlug || "default-section",
    sectionName,
    steps: [{
      index: 1,
      stepText: "El escenario no recibió un resultado de ejecución.",
      status: "failed",
      timestamp: new Date().toISOString(),
      errorMessage: reason,
    }],
  };
}

function relayCaseEvents(
  parentJobId: string,
  subset: "reuse" | "fallback",
  indexOffset: number,
  total: number,
  progress: CaseProgress,
  expected: Array<ReuseExistingPromotedSpecScenario | McpScenario>,
) {
  expected.forEach((scenario, localIndex) => {
    const scenarioId = scenarioIdentity(scenario);
    if (scenarioId) progress.indexByCaseId.set(scenarioId, indexOffset + localIndex + 1);
  });

  return (line: string) => {
    // Relay the case events plus the runner's own lifecycle/output lines. The latter are needed
    // to explain a fallback child that exits before it can emit case_started.
    const typeMarker = line.indexOf('"type"');
    const eventStart = typeMarker >= 0 ? line.lastIndexOf("{", typeMarker) : -1;
    const eventLine = eventStart >= 0 ? line.slice(eventStart).trim() : line;
    if (!/"type"\s*:\s*"case_(?:started|finished)"/.test(eventLine)) {
      if (/^\[(?:reuse-existing|promoted-spec-reuse|promoted-child(?::stderr)?|run:scenario-preview|scenario-preview|discovery:preview)\]/.test(line)) {
        jobStore.appendLog(parentJobId, `[mixed-rerun:${subset}] ${line}`);
      }
      return;
    }
    try {
      // scenario-preview prefixes child stdout with `[scenario-preview] stdout:` before the
      // JSON event. Parse the embedded payload so case_started/case_finished reach the parent
      // with their true case ID and status instead of being synthesized as scenario_without_result.
      const event = JSON.parse(eventLine) as {
        type?: string;
        index?: number;
        total?: number;
        caseId?: string;
        title?: string;
        status?: string;
      };
      if (event.type === "case_started") {
        event.index = indexOffset + (event.index ?? 1);
        event.total = total;
        if (event.caseId && event.index) progress.indexByCaseId.set(event.caseId, event.index);
        writeParentProgress(parentJobId, total, progress, {
          caseId: event.caseId,
          title: event.title,
          index: event.index,
        });
        jobStore.appendLog(parentJobId, JSON.stringify(event));
        return;
      }
      if (event.type === "case_finished") {
        const caseId = event.caseId || `case-${indexOffset + progress.completed + 1}`;
        const index = progress.indexByCaseId.get(caseId);
        event.index = index ?? event.index;
        event.total = total;
        if (!progress.finishedIds.has(caseId) && !(index && progress.finishedIndexes.has(index))) {
          progress.finishedIds.add(caseId);
          if (index) progress.finishedIndexes.add(index);
          progress.completed += 1;
          if (event.status === "skipped") {
            progress.skipped += 1;
          } else {
            progress.executed += 1;
            if (event.status === "passed") progress.passed += 1;
            else progress.failed += 1;
          }
          writeParentProgress(parentJobId, total, progress, null);
        }
        jobStore.appendLog(parentJobId, JSON.stringify(event));
        return;
      }
    } catch {
      // Keep the child event verbatim if a future runner adds non-JSON case events.
    }
    jobStore.appendLog(parentJobId, line);
  };
}

function reconcileMissingSubsetResults(input: {
  parentJobId: string;
  subset: "reuse" | "fallback";
  indexOffset: number;
  total: number;
  expected: Array<ReuseExistingPromotedSpecScenario | McpScenario>;
  childJobId: string;
  progress: CaseProgress;
  appSlug: string;
  sectionSlug?: string;
  sectionName?: string;
  missingEvidence: EvidenceScenarioRecord[];
}): void {
  const child = jobStore.get(input.childJobId);
  const rawReason = child?.errorMessage
    ?? (typeof child?.summary?.errorMessage === "string" ? child.summary.errorMessage : undefined)
    ?? (child?.status === "failed" ? "El proceso hijo terminó con error antes de informar el resultado del escenario." : "El proceso hijo terminó sin informar el resultado del escenario.");
  const reason = rawReason.replace(/[\r\n\t]+/g, " ").slice(0, 500);

  input.expected.forEach((scenario, localIndex) => {
    const index = input.indexOffset + localIndex + 1;
    const scenarioId = scenarioIdentity(scenario);
    const alreadyFinished = (scenarioId && input.progress.finishedIds.has(scenarioId))
      || input.progress.finishedIndexes.has(index);
    if (alreadyFinished) return;

    const title = "title" in scenario && typeof scenario.title === "string" ? scenario.title : scenarioId;
    input.progress.failed += 1;
    input.progress.completed += 1;
    input.progress.notExecutable += 1;
    input.progress.finishedIndexes.add(index);
    if (scenarioId) input.progress.finishedIds.add(scenarioId);
    jobStore.appendLog(input.parentJobId, `[mixed-rerun:${input.subset}] scenario_without_result index=${index}/${input.total} scenarioId=${scenarioId ?? "unknown"} title=${JSON.stringify(title ?? "Escenario sin título")} childStatus=${child?.status ?? "missing"} reason=${reason}`);
    writeParentProgress(input.parentJobId, input.total, input.progress, null);
    input.missingEvidence.push(makeNotExecutedEvidence(
      scenario,
      input.appSlug,
      input.sectionSlug,
      input.sectionName,
      reason,
    ));
  });
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
  const progress: CaseProgress = {
    completed: 0,
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    notExecutable: 0,
    finishedIds: new Set(),
    finishedIndexes: new Set(),
    indexByCaseId: new Map(),
  };
  const missingEvidence: EvidenceScenarioRecord[] = [];

  jobStore.update(parentJobId, {
    status: "running",
    startedAt: new Date().toISOString(),
    currentCase: null,
    currentCaseId: null,
    currentCaseTitle: null,
    summary: {
      totalStories: total,
      synced: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      completed: 0,
      executed: 0,
      requested: total,
      requestedCases: total,
      totalCases: total,
      scenarioCount: total,
      progressPercent: total === 0 ? 100 : 0,
      passRate: null,
    },
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
    const unsubscribe = jobStore.subscribe(reuseChild.id, {
      onLog: relayCaseEvents(parentJobId, "reuse", 0, total, progress, reuseScenarios),
      onUpdate: () => {},
    });
    try {
      await runners.runReuse(reuseChild.id);
    } catch (error) {
      jobStore.appendLog(parentJobId, `[mixed-rerun:reuse] child_runner_error=${error instanceof Error ? error.message : String(error)}`);
      const childProcess = jobStore.getInternal(reuseChild.id)?.process;
      if (!childProcess || childProcess.exitCode !== null || childProcess.signalCode !== null) {
        jobStore.update(reuseChild.id, { status: "failed", completedAt: new Date().toISOString(), errorMessage: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      await waitForChildTerminal(reuseChild.id);
      unsubscribe();
    }
    reconcileMissingSubsetResults({
      parentJobId, subset: "reuse", indexOffset: 0, total, expected: reuseScenarios,
      childJobId: reuseChild.id, progress, appSlug, sectionSlug, sectionName, missingEvidence,
    });
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
    const unsubscribe = jobStore.subscribe(fallbackChild.id, {
      onLog: relayCaseEvents(parentJobId, "fallback", reuseScenarios.length, total, progress, fallbackScenarios),
      onUpdate: () => {},
    });
    try {
      await runners.runFallback(fallbackChild.id);
    } catch (error) {
      jobStore.appendLog(parentJobId, `[mixed-rerun:fallback] child_runner_error=${error instanceof Error ? error.message : String(error)}`);
      const childProcess = jobStore.getInternal(fallbackChild.id)?.process;
      if (!childProcess || childProcess.exitCode !== null || childProcess.signalCode !== null) {
        jobStore.update(fallbackChild.id, { status: "failed", completedAt: new Date().toISOString(), errorMessage: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      await waitForChildTerminal(fallbackChild.id);
      unsubscribe();
    }
    reconcileMissingSubsetResults({
      parentJobId, subset: "fallback", indexOffset: reuseScenarios.length, total, expected: fallbackScenarios,
      childJobId: fallbackChild.id, progress, appSlug, sectionSlug, sectionName, missingEvidence,
    });
  } else {
    jobStore.update(fallbackChild.id, { status: "done", completedAt: new Date().toISOString(), summary: { totalStories: 0, synced: 0, passed: 0, failed: 0, completed: 0 } });
  }

  const passed = progress.passed;
  const failed = progress.failed;
  // Any failure in either subset fails the whole mixed rerun — never "PASS because the fresh
  // subset passed", and never just whichever child happened to finish last.
  const finalStatus: JobStatus = failed === 0 ? "done" : "failed";

  // Single consolidation pass for BOTH subsets — both wrote their evidence under
  // runs/<parentJobId>/scenarios/... (see executionContext.evidenceRunId above), so this one
  // call aggregates everything into one evidence-run.json/evidencia.docx. No caseOutcomeMap is
  // passed: with reuse/fallback scenarios mutually exclusive by construction (prepareRerun never
  // puts the same scenario in both subsets), each scenario's own freshly-captured runtime
  // evidence status is already authoritative — there is nothing to reconcile across subsets.
  const consolidation = await consolidateRunEvidence(parentJobId, appSlug, sectionSlug, sectionName, undefined, missingEvidence);
  const evidenceDir = consolidation?.docxPath && fs.existsSync(consolidation.docxPath)
    ? path.dirname(consolidation.docxPath)
    : undefined;

  const priorSummary = jobStore.get(parentJobId)?.summary;
  jobStore.update(parentJobId, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    currentCase: null,
    currentCaseId: null,
    currentCaseTitle: null,
    summary: {
      totalStories: total,
      synced: priorSummary?.synced ?? 0,
      passed,
      failed,
      skipped: progress.skipped,
      completed: progress.completed,
      executed: progress.executed,
      requested: total,
      requestedCases: total,
      executedCases: progress.executed,
      notExecutableCases: progress.notExecutable,
      scenarioCount: total,
      totalCases: total,
      progressPercent: total > 0 ? Math.round((progress.completed / total) * 100) : 100,
      passRate: passed + failed > 0 ? Math.round((passed / (passed + failed)) * 100) : null,
      evidenceDir,
    },
  });
  jobStore.appendLog(
    parentJobId,
    `[mixed-rerun] finished parentJobId=${parentJobId} reuseChild=${reuseChild.id} fallbackChild=${fallbackChild.id} `
    + `completed=${progress.completed}/${total} executed=${progress.executed} passed=${passed} failed=${failed} skipped=${progress.skipped} notExecutable=${progress.notExecutable} status=${finalStatus} evidenceRunConsolidated=${Boolean(consolidation)} `
    + `evidenceDir=${evidenceDir ?? "none"} publishToTestRailInvoked=false`,
  );
}
