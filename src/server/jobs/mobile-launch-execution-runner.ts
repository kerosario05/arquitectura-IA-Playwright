import { jobStore } from "./job-store";
import { ensureMobileInfra, runOneScenario, resolveMobileTarget, consolidateMobileRunEvidence } from "./mobile-test-runner";
import { syncDiscoveryResultToTestRail, updateLaunchManifestWithResult, finalizeLaunchManifest } from "./testrail-result-sync";
import type { PublishedCaseEntry } from "./launch-orchestrator";
import { applyDataOverrides, type MobileStep, type MobileDataField } from "../../mobile/mobile-step-types";
import { defectChecklistStore } from "../services/defect-checklist-store";
import { buildStructuredDefectDescription, buildDefectTitle, inferDefectSeverity } from "../services/defect-content-builder";

export type MobileLaunchScenario = {
  scenarioId: string;
  title: string;
  steps: MobileStep[];
  /** Carried from the preview so select overrides can be re-targeted at execution. */
  requiredData?: MobileDataField[];
};

export type MobileLaunchExecutionParams = {
  avdName?: string;
  apkPath?: string;
  appPackage?: string;
  appActivity?: string;
  launchId: string;
  testRunId: number;
  publishedCases: PublishedCaseEntry[];
  scenarios: MobileLaunchScenario[];
  appSlug: string;
  sectionSlug?: string;
  /** User-supplied real values for fill steps, keyed by scenarioId -> { stepIndex: value }. */
  dataOverrides?: Record<string, Record<number, string>>;
};

/** Derives the source Jira story key from a mobile scenarioId (MOBILE-AA-93-001 → AA-93). */
export function deriveSourceIssueKey(scenarioId: string): string | undefined {
  if (!scenarioId.startsWith("MOBILE-")) return undefined;
  const key = scenarioId.split("-").slice(1, -1).join("-");
  return key || undefined;
}

/** Maps a mobile step error message to a defect reasonCode understood by the shared builders. */
function mapMobileErrorToReasonCode(errorMessage: string): string {
  const e = (errorMessage || "").toLowerCase();
  if (e.includes("not found") || e.includes("no such element") || e.includes("could not be located")) return "target_not_found";
  if (e.includes("timeout") || e.includes("timed out")) return "timeout";
  if (e.includes("expected element to be visible")) return "assertion_not_found";
  return "execution_exception";
}

function resolveCaseId(publishedCases: PublishedCaseEntry[], scenarioId: string): number | undefined {
  const match = publishedCases.find(
    (pc) =>
      pc.scenarioId === scenarioId ||
      pc.launchScenarioId === scenarioId ||
      pc.executionScenarioId === scenarioId ||
      pc.testrailCustomScenarioId === scenarioId
  );
  return match?.caseId;
}

export async function startMobileLaunchExecutionJob(jobId: string): Promise<void> {
  const job = jobStore.getInternal(jobId);
  if (!job) return;

  const params = job.params as MobileLaunchExecutionParams;
  const onLog = (line: string) => jobStore.appendLog(jobId, line);

  jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });

  if (!params.scenarios || params.scenarios.length === 0) {
    onLog("[mobile:launch] Error: no scenarios provided");
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: "No scenarios provided"
    });
    return;
  }

  const target = resolveMobileTarget(params);

  if (!target.apkPath && !target.appPackage) {
    onLog("[mobile:launch] Error: either apkPath or appPackage is required");
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: "Either apkPath or appPackage is required"
    });
    return;
  }

  const sectionSlug = params.sectionSlug || target.appPackage?.replace(/[^a-zA-Z0-9_-]/g, "_") || "android";

  try {
    await ensureMobileInfra(target, onLog);

    let totalPassed = 0;
    let totalFailed = 0;
    let syncedCount = 0;

    // Use the execution jobId as the shared evidence runId so every scenario's
    // evidence.json lands under runs/<jobId>/scenarios/ and the consolidated docx under
    // runs/<jobId>/ — matching what GET /api/runs/:jobId/evidence-docx searches for
    // (same convention the web pipeline uses: evidence runId == jobId).
    const runId = jobId;

    for (const scenario of params.scenarios) {
      onLog(`[mobile:launch] scenario ${scenario.scenarioId} "${scenario.title}" — starting`);

      const caseId = resolveCaseId(params.publishedCases, scenario.scenarioId);
      if (!caseId) {
        onLog(`[mobile:launch] scenario ${scenario.scenarioId} — no matching TestRail caseId found in publishedCases, skipping execution`);
        totalFailed++;
        continue;
      }

      const stepsToRun = applyDataOverrides(scenario.steps, params.dataOverrides?.[scenario.scenarioId], scenario.requiredData);
      if (params.dataOverrides?.[scenario.scenarioId]) {
        onLog(`[mobile:launch] scenario ${scenario.scenarioId} — applied ${Object.keys(params.dataOverrides[scenario.scenarioId]).length} data override(s)`);
      }

      let execResult;
      try {
        execResult = await runOneScenario(
          {
            appiumPort: target.appiumPort,
            apkPath: target.apkPath,
            appPackage: target.appPackage,
            appActivity: target.appActivity,
            steps: stepsToRun,
            evidenceScenarioId: scenario.scenarioId,
            evidenceScenarioTitle: scenario.title,
            runId,
            sectionSlug,
            appSlug: params.appSlug,
            sourceIssueKey: scenario.scenarioId.startsWith("MOBILE-") ? scenario.scenarioId.split("-").slice(1, -1).join("-") : undefined
          },
          onLog
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog(`[mobile:launch] scenario ${scenario.scenarioId} execution error: ${message}`);
        execResult = { passed: 0, failed: 1, artifactsDir: "", results: [] };
      }

      const discoveryStatus: "passed" | "failed" = execResult.failed > 0 ? "failed" : "passed";
      totalPassed += execResult.passed;
      totalFailed += execResult.failed;

      onLog(`[mobile:launch] scenario ${scenario.scenarioId} finished status=${discoveryStatus} passed=${execResult.passed} failed=${execResult.failed}`);

      // Mirror the web pipeline: when a mobile scenario fails, create/update a defect in the HU
      // checklist. Mobile used to only sync TestRail and never generated defects, so failed mobile
      // stories showed an empty checklist. Reuses the shared defect content builders so the title/
      // description are as specific as the web ones.
      const sourceIssueKey = deriveSourceIssueKey(scenario.scenarioId);
      if (discoveryStatus === "failed" && sourceIssueKey) {
        try {
          const results = (execResult.results ?? []) as Array<{ index: number; status: string; description?: string; errorMessage?: string }>;
          const failedStep = results.find((r) => r.status === "failed");
          const errorMessage = failedStep?.errorMessage ?? "";
          const reasonCode = mapMobileErrorToReasonCode(errorMessage);
          const technicalContext: Record<string, unknown> = {
            reasonCode,
            failedAtStep: failedStep?.index,
            failedTarget: failedStep?.description,
            rawError: errorMessage || undefined,
            evidenceDir: execResult.artifactsDir || undefined,
            testRailCaseId: caseId,
            testRailRunId: params.testRunId,
          };
          Object.keys(technicalContext).forEach((k) => { if (technicalContext[k] === undefined) delete technicalContext[k]; });
          const failureReason = errorMessage || failedStep?.description || "El escenario mobile falló durante la ejecución.";
          const sv = inferDefectSeverity(`${reasonCode} ${failureReason}`, scenario.scenarioId, scenario.title);
          const title = buildDefectTitle({ scenarioId: scenario.scenarioId, scenarioTitle: scenario.title, severity: sv.severity, technicalContext, failureReason });
          const description = buildStructuredDefectDescription({ scenarioId: scenario.scenarioId, scenarioTitle: scenario.title, failureReason, technicalContext, jobId });

          const list = defectChecklistStore.getOrCreate(sourceIssueKey);
          const existing = list.defects.find((d) => d.jobId === jobId && d.scenarioId === scenario.scenarioId);
          if (existing) {
            existing.title = title;
            existing.description = description;
            existing.severity = sv.severity;
            existing.severityReason = sv.severityReason;
            existing.technicalContext = technicalContext as never;
            existing.updatedAt = new Date().toISOString();
            defectChecklistStore.persist();
            onLog(`[mobile:launch] defect updated issueKey=${sourceIssueKey} scenarioId=${scenario.scenarioId} title="${title}"`);
          } else {
            defectChecklistStore.addDefect(sourceIssueKey, {
              description,
              severity: sv.severity,
              severityReason: sv.severityReason,
              jobId,
              scenarioId: scenario.scenarioId,
              scenarioTitle: scenario.title,
              title,
              technicalContext: technicalContext as never,
            });
            onLog(`[mobile:launch] defect created issueKey=${sourceIssueKey} scenarioId=${scenario.scenarioId} title="${title}"`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          onLog(`[mobile:launch] defect creation failed for ${scenario.scenarioId}: ${message}`);
        }
      }

      const syncResult = await syncDiscoveryResultToTestRail({
        runId: params.testRunId,
        caseId,
        scenarioId: scenario.scenarioId,
        discoveryStatus,
        title: scenario.title,
        artifactsDir: execResult.artifactsDir,
        launchId: params.launchId,
        appSlug: params.appSlug,
        sectionSlug
      });

      onLog(`[mobile:launch] scenario ${scenario.scenarioId} testrail sync=${syncResult.syncStatus} statusId=${syncResult.statusId}${syncResult.error ? ` error=${syncResult.error}` : ""}`);
      if (syncResult.syncStatus === "synced") syncedCount++;

      updateLaunchManifestWithResult(
        params.launchId,
        {
          scenarioId: scenario.scenarioId,
          caseId,
          discoveryStatus,
          testRailStatusId: syncResult.statusId,
          syncStatus: syncResult.syncStatus,
          syncedAt: syncResult.syncedAt,
          error: syncResult.error
        },
        params.scenarios.length
      );
    }

    // Consolidate all scenarios' evidence.json into evidence-run.json + a single run docx.
    await consolidateMobileRunEvidence(runId, sectionSlug, onLog);

    const finalStatus = totalFailed === 0 ? "completed" : "completed_with_failures";
    finalizeLaunchManifest(params.launchId, finalStatus, params.scenarios.length - syncedCount, params.scenarios.length);

    jobStore.update(jobId, {
      status: totalFailed === 0 ? "done" : "completed_with_failures",
      completedAt: new Date().toISOString(),
      summary: {
        totalStories: params.scenarios.length,
        synced: syncedCount,
        passed: totalPassed,
        failed: totalFailed,
        testRailRunId: params.testRunId
      }
    });
    onLog(`[mobile:launch] finished testRunId=${params.testRunId} scenarios=${params.scenarios.length} synced=${syncedCount} passed=${totalPassed} failed=${totalFailed}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onLog(`[mobile:launch] failed: ${message}`);
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: message
    });
  }
}
