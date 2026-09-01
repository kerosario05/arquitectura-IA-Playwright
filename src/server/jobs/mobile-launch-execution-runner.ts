import { jobStore } from "./job-store";
import {
  ensureMobileInfra,
  evaluateScenarioPrecheck,
  type MobileInfraReadyState,
  runOneScenario,
  resolveMobileTarget,
  consolidateMobileRunEvidence,
  validateResolvedMobileTarget,
  MobileTargetValidationError,
} from "./mobile-test-runner";
import {
  hasInfrastructureBlockedStatusMapping,
  syncDiscoveryResultToTestRail,
  updateLaunchManifestWithResult,
  finalizeLaunchManifest,
  updateLaunchManifestJobId,
} from "./testrail-result-sync";
import type { PublishedCaseEntry } from "./launch-orchestrator";
import { applyDataOverrides, type MobileStep, type MobileDataField } from "../../mobile/mobile-step-types";
import { defectChecklistStore } from "../services/defect-checklist-store";
import { buildStructuredDefectDescription, buildDefectTitle, inferDefectSeverity } from "../services/defect-content-builder";
import { createMobileJobLogger } from "./mobile-job-logger";
import {
  persistMobileExecutionManifest,
  persistMobileExecutionResults,
  type MobileExecutionRerunResult,
} from "./mobile-rerun-artifacts";

export type MobileLaunchScenario = {
  scenarioId: string;
  title: string;
  steps: MobileStep[];
  /** Carried from the preview so select overrides can be re-targeted at execution. */
  requiredData?: MobileDataField[];
  /** Name of a functional data profile this scenario depends on (business/backend state). */
  requiredDataProfile?: string;
  /** True when the scenario's technical locators lack validated runtime evidence — it must
   *  NEVER reach Appium execution. Gate lives here (execution boundary) so a caller cannot
   *  bypass POST /api/mobile/runs/launch-execution by calling runs/execute directly. */
  requiresRouteLearning?: boolean;
  /** Step-level requirement references to propagate into runtime transitions. */
  stepRequirementRefs?: Array<{ stepIndex: number; requirementIds: string[] }>;
};

export type MobileLaunchExecutionParams = {
  avdName?: string;
  apkPath?: string;
  appPackage?: string;
  appActivity?: string;
  systemPort?: number;
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
  if (e.includes("expected element to be enabled")) return "assert_enabled_failed";
  if (e.includes("expected element to be disabled")) return "assert_disabled_failed";
  if (e.includes("target_disabled") || e.includes("deshabilitado")) return "target_disabled";
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

export type MobileFailureCategory =
  | "functional_failure"
  | "automation_failure"
  | "data_precondition_failure"
  | "infrastructure_failure"
  | "non_executable_precondition";

function hasMojibake(value: string | undefined): boolean {
  if (!value) return false;
  return /(?:Ã.|Â.|â.|Ð.|Ñ.)/.test(value);
}

export function classifyScenarioFailure(
  failedSteps: Array<{
    index: number;
    status: string;
    action?: string;
    description?: string;
    errorMessage?: string;
    reasonCode?: string;
    defectEligible?: boolean;
  }>,
): MobileFailureCategory {
  const firstFailed = failedSteps[0];
  if (!firstFailed) return "automation_failure";
  const reasonCode = firstFailed.reasonCode ?? "";
  const message = firstFailed.errorMessage ?? "";
  const normalized = message.toLowerCase();
  if (reasonCode === "non_executable_precondition" || normalized.includes("non_executable_precondition")) {
    return "non_executable_precondition";
  }
  if (
    normalized.includes("mobile_automation_channel_lost")
    || normalized.includes("mobile_text_encoding_invalid")
    || normalized.includes("socket hang up")
    || normalized.includes("uiautomator2")
    || normalized.includes("device offline")
  ) {
    return "infrastructure_failure";
  }
  if (hasMojibake(message) || hasMojibake(firstFailed.description)) {
    return "automation_failure";
  }
  if (
    reasonCode === "data_precondition_failure"
    || normalized.includes("data_precondition_failure")
    || normalized.includes("target_disabled")
  ) {
    return "data_precondition_failure";
  }
  if (
    reasonCode === "navigation_dependency_primary_failure"
    || reasonCode === "transition_not_reached"
    || reasonCode === "target_not_found"
    || normalized.includes("target not found")
    || normalized.includes("no such element")
    || firstFailed.defectEligible === false
  ) {
    return "automation_failure";
  }
  return "functional_failure";
}

function classifyScenarioFailureSafe(
  failedSteps: Array<{
    index: number;
    status: string;
    action?: string;
    description?: string;
    errorMessage?: string;
    reasonCode?: string;
    defectEligible?: boolean;
  }>,
  onLog: (line: string) => void,
): MobileFailureCategory {
  try {
    return classifyScenarioFailure(failedSteps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onLog(`[mobile:classify] status=error detail=${message}`);
    return "automation_failure";
  }
}

function markRemainingScenariosSkippedInfrastructure(
  launchId: string,
  scenarios: MobileLaunchScenario[],
  publishedCases: PublishedCaseEntry[],
  totalScenarioCount: number,
  reasonCode: string,
  onLog: (line: string) => void,
): number {
  let skipped = 0;
  for (const pending of scenarios) {
    const caseId = resolveCaseId(publishedCases, pending.scenarioId);
    if (!caseId) continue;
    updateLaunchManifestWithResult(
      launchId,
      {
        scenarioId: pending.scenarioId,
        caseId,
        discoveryStatus: "blocked_infrastructure",
        testRailStatusId: 0,
        syncStatus: "skipped_infrastructure_blocked",
        error: `${reasonCode}: skipped due to shared infrastructure block`,
      },
      totalScenarioCount,
    );
    onLog(`[mobile:launch] scenario ${pending.scenarioId} marked skipped_infrastructure_blocked reason=${reasonCode}`);
    onLog(`[mobile:summary] scenarioId=${pending.scenarioId} status=blocked passed=0 failed=0 skipped=0 blocked=1 firstFailureStep=-1 reasonCode=${reasonCode} jiraAction=skipped testRailAction=skipped_infrastructure_blocked`);
    skipped++;
  }
  return skipped;
}

function classifyInfrastructureExecutionFailure(message: string): { blocked: boolean; reasonCode?: string; sharedInfraUnreliable?: boolean } {
  const normalized = message.trim();
  const knownReasons: Array<{ reason: string; sharedInfraUnreliable: boolean }> = [
    { reason: "mobile_session_transient_unavailable", sharedInfraUnreliable: true },
    { reason: "mobile_session_not_created", sharedInfraUnreliable: true },
    { reason: "mobile_session_create_failed", sharedInfraUnreliable: true },
    { reason: "mobile_session_state_unknown", sharedInfraUnreliable: true },
    { reason: "mobile_adb_unhealthy", sharedInfraUnreliable: true },
    { reason: "mobile_automation_channel_lost", sharedInfraUnreliable: true },
    { reason: "mobile_text_encoding_invalid", sharedInfraUnreliable: true },
    { reason: "mobile_device_temporarily_busy", sharedInfraUnreliable: true },
    { reason: "mobile_infra_unhealthy_after_session_timeout", sharedInfraUnreliable: true },
    { reason: "mobile_app_activation_not_completed", sharedInfraUnreliable: true },
    { reason: "mobile_app_installation_not_completed", sharedInfraUnreliable: true },
    { reason: "mobile_apk_not_found", sharedInfraUnreliable: true },
    { reason: "mobile_apk_not_accessible", sharedInfraUnreliable: true },
    { reason: "mobile_app_configuration_missing", sharedInfraUnreliable: true },
  ];
  for (const entry of knownReasons) {
    if (normalized.startsWith(`${entry.reason}:`) || normalized.includes(entry.reason)) {
      return { blocked: true, reasonCode: entry.reason, sharedInfraUnreliable: entry.sharedInfraUnreliable };
    }
  }
  return { blocked: false, sharedInfraUnreliable: false };
}

export async function startMobileLaunchExecutionJob(jobId: string): Promise<void> {
  const deps = {
    ensureMobileInfraFn: ensureMobileInfra,
    runOneScenarioFn: runOneScenario,
    syncResultFn: syncDiscoveryResultToTestRail,
    consolidateEvidenceFn: consolidateMobileRunEvidence,
  };
  return startMobileLaunchExecutionJobWithDeps(jobId, deps);
}

export async function startMobileLaunchExecutionJobWithDeps(
  jobId: string,
  deps: {
    ensureMobileInfraFn: typeof ensureMobileInfra;
    runOneScenarioFn: typeof runOneScenario;
    syncResultFn: typeof syncDiscoveryResultToTestRail;
    consolidateEvidenceFn: typeof consolidateMobileRunEvidence;
  },
): Promise<void> {
  const job = jobStore.getInternal(jobId);
  if (!job) return;

  const params = job.params as MobileLaunchExecutionParams;
  const logger = createMobileJobLogger({
    runId: jobId,
    appendLog: (line) => jobStore.appendLog(jobId, line),
  });
  const onLog = (line: string) => logger.log(line);

  jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });
  onLog(`[mobile:run] started runId=${jobId} scenarios=${params.scenarios?.length ?? 0} appSlug=${params.appSlug}`);
  try {
    persistMobileExecutionManifest(jobId, params, {
      sourceJobId: typeof (params as { sourceJobId?: unknown }).sourceJobId === "string"
        ? (params as { sourceJobId?: string }).sourceJobId
        : undefined,
    });
  } catch (err) {
    onLog(`[mobile:rerun] manifest persistence failed jobId=${jobId} message=${err instanceof Error ? err.message : String(err)}`);
  }

  if (!params.scenarios || params.scenarios.length === 0) {
    onLog("[mobile:launch] Error: no scenarios provided");
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: "No scenarios provided"
    });
    logger.flush();
    return;
  }

  let target: ReturnType<typeof resolveMobileTarget>;
  try {
    target = validateResolvedMobileTarget(resolveMobileTarget(params));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reasonCode = err instanceof MobileTargetValidationError ? err.reasonCode : "mobile_apk_not_accessible";
    const apkPath = err instanceof MobileTargetValidationError ? err.apkPath : undefined;
    onLog(`[mobile:launch] blocked reasonCode=${reasonCode} apkPath=${apkPath ?? "n/a"} message=${message}`);
    onLog("[mobile:launch] infra block: skipping scenario execution, defect creation, and TestRail result sync.");
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: message,
      summary: {
        totalStories: params.scenarios.length,
        synced: 0,
        passed: 0,
        failed: 0,
        reasonCode,
        testRailRunId: params.testRunId,
        errorMessage: message,
      },
    });
    logger.flush();
    return;
  }
  onLog(
    `[mobile:launch] target resolved apkPathSource=${target.apkPathSource ?? "none"} apkPath=${target.apkPath ?? "none"} appPackage=${target.appPackage ?? "none"}`,
  );

  const sectionSlug = params.sectionSlug || target.appPackage?.replace(/[^a-zA-Z0-9_-]/g, "_") || "android";

  try {
    let infraState: MobileInfraReadyState | undefined;
    const attemptedScenarioIds = new Set<string>();
    const scenarioOutcomes: MobileExecutionRerunResult[] = [];

    let totalPassed = 0;
    let totalFailed = 0;
    let totalBlocked = 0;
    let syncedCount = 0;

    // Use the execution jobId as the shared evidence runId so every scenario's
    // evidence.json lands under runs/<jobId>/scenarios/ and the consolidated docx under
    // runs/<jobId>/ — matching what GET /api/runs/:jobId/evidence-docx searches for
    // (same convention the web pipeline uses: evidence runId == jobId).
    const runId = jobId;

    // Persist this job's id onto the launch manifest so the Executions summary can tie the run to
    // its defects (keyed by jobId) and evidence docx.
    updateLaunchManifestJobId(params.launchId, jobId);

    for (const scenario of params.scenarios) {
      attemptedScenarioIds.add(scenario.scenarioId);
      onLog(`[mobile:launch] scenario ${scenario.scenarioId} "${scenario.title}" — starting`);

      // Route-learning scenarios must never reach Appium execution, regardless of whether they
      // were filtered at launch-execution or sent directly via runs/execute (defense in depth).
      if (scenario.requiresRouteLearning === true) {
        onLog(`[mobile:launch] scenario ${scenario.scenarioId} — requires_route_learning, skipped (no Appium execution)`);
        totalBlocked++;
        const syncResult = {
          statusId: 0,
          syncStatus: "skipped_non_functional_failure" as const,
          error: "non_functional_failure:requires_route_learning",
        };
        const resolvedCaseId = resolveCaseId(params.publishedCases, scenario.scenarioId);
        if (resolvedCaseId) {
          updateLaunchManifestWithResult(
            params.launchId,
            {
              scenarioId: scenario.scenarioId,
              caseId: resolvedCaseId,
              discoveryStatus: "skipped",
              testRailStatusId: syncResult.statusId,
              syncStatus: syncResult.syncStatus,
              error: syncResult.error,
            },
            params.scenarios.length,
          );
        }
        onLog(
          `[mobile:summary] scenarioId=${scenario.scenarioId} status=blocked passed=0 failed=0 skipped=0 blocked=1 firstFailureStep=-1 causalStep=-1 causalStepIndex=-1 reasonCode=requires_route_learning failureCategory=non_executable_precondition jiraAction=skipped testRailAction=${syncResult.syncStatus}`,
        );
        scenarioOutcomes.push({
          scenarioId: scenario.scenarioId,
          status: "blocked",
          failureCategory: "non_executable_precondition",
          firstFailureStep: -1,
          firstFailureStepIndex: -1,
          firstFailureReasonCode: "requires_route_learning",
        });
        continue;
      }

      const caseId = resolveCaseId(params.publishedCases, scenario.scenarioId);
      if (!caseId) {
        onLog(`[mobile:launch] scenario ${scenario.scenarioId} — no matching TestRail caseId found in publishedCases, skipping execution`);
        totalFailed++;
        scenarioOutcomes.push({
          scenarioId: scenario.scenarioId,
          status: "failed",
          failureCategory: "automation_failure",
          firstFailureReasonCode: "missing_case_mapping",
          firstFailureStep: -1,
          firstFailureStepIndex: -1,
        });
        continue;
      }

      const stepsToRun = applyDataOverrides(scenario.steps, params.dataOverrides?.[scenario.scenarioId], scenario.requiredData);
      if (params.dataOverrides?.[scenario.scenarioId]) {
        onLog(`[mobile:launch] scenario ${scenario.scenarioId} — applied ${Object.keys(params.dataOverrides[scenario.scenarioId]).length} data override(s)`);
      }

      const precheck = evaluateScenarioPrecheck(stepsToRun, params.appSlug, undefined, scenario.requiredDataProfile);
      if (precheck.blocked) {
        totalBlocked++;
        const blockedReason = precheck.reasonCode;
        const blockedDetail = precheck.detail;
        onLog(`[mobile:launch] scenario ${scenario.scenarioId} blocked reasonCode=${blockedReason} detail=${blockedDetail} stage=pre_infra`);
        const syncResult = {
          statusId: 0,
          syncStatus: "skipped_non_functional_failure" as const,
          error: `non_functional_failure:${blockedReason}`,
        };
        updateLaunchManifestWithResult(
          params.launchId,
          {
            scenarioId: scenario.scenarioId,
            caseId,
            discoveryStatus: "skipped",
            testRailStatusId: syncResult.statusId,
            syncStatus: syncResult.syncStatus,
            error: syncResult.error,
          },
          params.scenarios.length,
        );
        onLog(
          `[mobile:summary] scenarioId=${scenario.scenarioId} status=blocked passed=0 failed=0 skipped=${Math.max(0, stepsToRun.length - 1)} blocked=1 firstFailureStep=-1 causalStep=-1 causalStepIndex=-1 reasonCode=${blockedReason} failureCategory=non_executable_precondition jiraAction=skipped testRailAction=${syncResult.syncStatus}`,
        );
        scenarioOutcomes.push({
          scenarioId: scenario.scenarioId,
          status: "blocked",
          failureCategory: "non_executable_precondition",
          firstFailureStep: -1,
          firstFailureStepIndex: -1,
          firstFailureReasonCode: blockedReason,
        });
        continue;
      }

      if (!infraState) {
        infraState = await deps.ensureMobileInfraFn(target, onLog, {
          runId: jobId,
          traceAppiumChunk: logger.traceAppiumChunk,
        });
      }

      let execResult;
      try {
        execResult = await deps.runOneScenarioFn(
          {
            appiumPort: target.appiumPort,
            systemPort: target.systemPort,
            deviceId: infraState.deviceId,
            emulatorStartedByRunner: infraState.emulatorStartedByRunner,
            apkPath: target.apkPath,
            appPackage: target.appPackage,
            appActivity: target.appActivity,
            steps: stepsToRun,
            evidenceScenarioId: scenario.scenarioId,
            evidenceScenarioTitle: scenario.title,
            runId,
            sectionSlug,
            appSlug: params.appSlug,
            sourceIssueKey: scenario.scenarioId.startsWith("MOBILE-") ? scenario.scenarioId.split("-").slice(1, -1).join("-") : undefined,
            stepRequirementRefs: scenario.stepRequirementRefs,
          },
          onLog
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const block = classifyInfrastructureExecutionFailure(message);
        if (block.blocked) {
          const reasonCode = block.reasonCode ?? "mobile_apk_not_accessible";
          const remaining = params.scenarios.filter((s) => !attemptedScenarioIds.has(s.scenarioId));
          const scenariosSkipped = markRemainingScenariosSkippedInfrastructure(
            params.launchId,
            remaining,
            params.publishedCases,
            params.scenarios.length,
            reasonCode,
            onLog,
          );
          const stage = reasonCode.startsWith("mobile_session_")
            ? "session_creation"
            : (
              reasonCode === "mobile_automation_channel_lost" || reasonCode === "mobile_text_encoding_invalid"
                ? "in_step"
                : "preflight"
            );
          onLog(`[mobile:launch] blocked reasonCode=${reasonCode} message=${message}`);
          onLog(`[mobile:launch] functionalDefectSyncSkipped=true testRailFunctionalStatusSkipped=true reason=infrastructure_block stage=${stage} scenariosSkipped=${scenariosSkipped}`);
          onLog("[mobile:launch] infra block detected before first functional step; stopping remaining scenarios with no functional defects.");

          if (hasInfrastructureBlockedStatusMapping()) {
            const infraSync = await deps.syncResultFn({
              runId: params.testRunId,
              caseId,
              scenarioId: scenario.scenarioId,
              discoveryStatus: "blocked_infrastructure",
              title: scenario.title,
              artifactsDir: "",
              errorMessage: `${reasonCode}: ${message}`,
              launchId: params.launchId,
              appSlug: params.appSlug,
              sectionSlug,
            });
            onLog(
              `[mobile:launch] scenario ${scenario.scenarioId} infra-sync=${infraSync.syncStatus} statusId=${infraSync.statusId}${infraSync.error ? ` error=${infraSync.error}` : ""}`,
            );
            if (infraSync.syncStatus === "synced") syncedCount++;
            updateLaunchManifestWithResult(
              params.launchId,
              {
                scenarioId: scenario.scenarioId,
                caseId,
                discoveryStatus: "blocked_infrastructure",
                testRailStatusId: infraSync.statusId,
                syncStatus: infraSync.syncStatus,
                syncedAt: infraSync.syncedAt,
                error: infraSync.error,
              },
              params.scenarios.length,
            );
          } else {
            onLog(`[mobile:launch] infra-sync skipped reason=no_blocked_status_mapping scenario=${scenario.scenarioId}`);
          }

          jobStore.update(jobId, {
            status: "failed",
            completedAt: new Date().toISOString(),
            errorMessage: message,
            summary: {
              totalStories: params.scenarios.length,
              synced: syncedCount,
              passed: totalPassed,
              failed: totalFailed,
              scenariosSkipped,
              reasonCode,
              testRailRunId: params.testRunId,
              errorMessage: message,
            }
          });
          scenarioOutcomes.push({
            scenarioId: scenario.scenarioId,
            status: "failed",
            failureCategory: "infrastructure_failure",
            firstFailureReasonCode: reasonCode,
            firstFailureStep: -1,
            firstFailureStepIndex: -1,
          });
          for (const pending of remaining) {
            scenarioOutcomes.push({
              scenarioId: pending.scenarioId,
              status: "failed",
              failureCategory: "infrastructure_failure",
              firstFailureReasonCode: reasonCode,
              firstFailureStep: -1,
              firstFailureStepIndex: -1,
            });
          }
          persistMobileExecutionResults(jobId, scenarioOutcomes);
          onLog(`[mobile:run] finished status=failed passed=${totalPassed} failed=${totalFailed} blocked=${scenariosSkipped + 1}`);
          return;
        }
        onLog(`[mobile:launch] scenario ${scenario.scenarioId} execution error: ${message}`);
        execResult = { passed: 0, failed: 1, blocked: 0, artifactsDir: "", results: [] };
      }

      // Classify the run's steps. A scenario is only a real failure when an INTERACTION step
      // (click/fill) failed. If every interaction passed and the only failures are ASSERTIONS
      const stepResults = (execResult.results ?? []) as Array<{
        index: number;
        status: string;
        action?: string;
        description?: string;
        errorMessage?: string;
        reasonCode?: string;
        diagnosticsPath?: string;
        defectEligible?: boolean;
      }>;
      const failedSteps = stepResults.filter((r) => r.status === "failed");
      const ASSERTION_ACTIONS = new Set(["assertVisible", "waitFor"]);

      const scenarioBlocked = (execResult.blocked ?? 0) > 0;
      let discoveryStatus: "passed" | "failed" | "blocked" = scenarioBlocked
        ? "blocked"
        : (execResult.failed > 0 ? "failed" : "passed");
      let jiraAction: "created" | "updated" | "skipped" | "failed" = "skipped";
      totalPassed += execResult.passed;
      if (discoveryStatus === "failed") totalFailed += execResult.failed;
      if (discoveryStatus === "blocked") totalBlocked += execResult.blocked ?? 0;

      const blockingFailed = failedSteps.filter((r) => !(r.action && ASSERTION_ACTIONS.has(r.action))).length;
      const nonBlockingFailed = failedSteps.length - blockingFailed;
      const failureCategory = discoveryStatus === "blocked"
        ? "non_executable_precondition"
        : discoveryStatus === "failed"
        ? classifyScenarioFailureSafe(failedSteps, onLog)
        : undefined;
      if (discoveryStatus === "passed") {
        onLog(`[mobile:launch] scenario ${scenario.scenarioId} finished status=passed passed=${execResult.passed} blockingFailed=0 nonBlockingFailed=${nonBlockingFailed}`);
      } else if (discoveryStatus === "blocked") {
        onLog(`[mobile:launch] scenario ${scenario.scenarioId} finished status=blocked passed=${execResult.passed} failed=0 blocked=${execResult.blocked ?? 1} failureCategory=${failureCategory}`);
      } else {
        onLog(`[mobile:launch] scenario ${scenario.scenarioId} finished status=failed passed=${execResult.passed} failed=${execResult.failed} failureCategory=${failureCategory}`);
      }

      // When a scenario really fails (an interaction step didn't find/act on its element), create/
      // update a defect in the HU checklist, reusing the shared defect content builders.
      const sourceIssueKey = deriveSourceIssueKey(scenario.scenarioId);
      const shouldSyncAsFunctionalFailure = discoveryStatus === "failed" && failureCategory === "functional_failure";
      if (shouldSyncAsFunctionalFailure && sourceIssueKey) {
        const failedStep = failedSteps[0];
        const primaryNavigationFailure = failedStep?.reasonCode === "navigation_dependency_primary_failure";
        const defectEligible = primaryNavigationFailure ? failedStep?.defectEligible === true : true;
        if (primaryNavigationFailure && !defectEligible) {
          jiraAction = "skipped";
          onLog(
            `[mobile:launch] defect skipped scenario=${scenario.scenarioId} reason=navigation_primary_without_screen_evidence diagnostics=${failedStep?.diagnosticsPath ?? "n/a"}`,
          );
        }
        if (defectEligible) {
          try {
            const errorMessage = failedStep?.errorMessage ?? "";
            const reasonCode = mapMobileErrorToReasonCode(errorMessage);
            const failedTarget = (errorMessage.match(/"value"\s*:\s*"([^"]+)"/)?.[1]) || failedStep?.description;
            const technicalContext: Record<string, unknown> = {
              reasonCode,
              failedAtStep: failedStep?.index,
              failedTarget,
              rawError: errorMessage || undefined,
              evidenceDir: execResult.artifactsDir || undefined,
              diagnosticsPath: failedStep?.diagnosticsPath,
              testRailCaseId: caseId,
              testRailRunId: params.testRunId,
            };
            Object.keys(technicalContext).forEach((k) => { if (technicalContext[k] === undefined) delete technicalContext[k]; });
            const failureReason = errorMessage || failedStep?.description || "El escenario mobile falló durante la ejecución.";
            const sv = inferDefectSeverity(`${reasonCode} ${failureReason}`, scenario.scenarioId, scenario.title);
            const title = buildDefectTitle({ scenarioId: scenario.scenarioId, scenarioTitle: scenario.title, severity: sv.severity, technicalContext, failureReason });
            const description = buildStructuredDefectDescription({ scenarioId: scenario.scenarioId, scenarioTitle: scenario.title, failureReason, technicalContext, jobId });

            const list = defectChecklistStore.getOrCreate(sourceIssueKey);
            // One defect per SCENARIO (not per run): re-running a scenario UPDATES its existing defect
            // instead of piling up a new one each time. Keyed by scenarioId only — the jobId changes
            // every run, so matching on it produced N defects for the same scenario across re-runs.
            const existing = list.defects.find((d) => d.scenarioId === scenario.scenarioId);
            if (existing) {
              existing.title = title;
              existing.description = description;
              existing.severity = sv.severity;
              existing.severityReason = sv.severityReason;
              existing.technicalContext = technicalContext as never;
              existing.jobId = jobId;
              existing.runId = runId;
              existing.updatedAt = new Date().toISOString();
              defectChecklistStore.persist();
              jiraAction = "updated";
              onLog(`[mobile:launch] defect updated issueKey=${sourceIssueKey} scenarioId=${scenario.scenarioId} runId=${runId} title="${title}"`);
            } else {
              defectChecklistStore.addDefect(sourceIssueKey, {
                description,
                severity: sv.severity,
                severityReason: sv.severityReason,
                jobId,
                runId,
                scenarioId: scenario.scenarioId,
                scenarioTitle: scenario.title,
                title,
                technicalContext: technicalContext as never,
              });
              jiraAction = "created";
              onLog(`[mobile:launch] defect created issueKey=${sourceIssueKey} scenarioId=${scenario.scenarioId} runId=${runId} title="${title}"`);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            jiraAction = "failed";
            onLog(`[mobile:launch] defect creation failed for ${scenario.scenarioId}: ${message}`);
          }
        }
      }
      const jiraReason = discoveryStatus === "passed" ? "not_required" : (failureCategory ?? "functional_failure");
      onLog(`[mobile:sync] jira action=${jiraAction} issueKey=${sourceIssueKey ?? "n/a"} reason=${jiraReason}`);

      const syncResult = shouldSyncAsFunctionalFailure || discoveryStatus === "passed"
        ? await deps.syncResultFn({
          runId: params.testRunId,
          caseId,
          scenarioId: scenario.scenarioId,
          discoveryStatus,
          title: scenario.title,
          artifactsDir: execResult.artifactsDir,
          launchId: params.launchId,
          appSlug: params.appSlug,
          sectionSlug
        })
        : {
          statusId: 0,
          syncStatus: "skipped_non_functional_failure" as const,
          error: `non_functional_failure:${failureCategory ?? "unknown"}`,
        };

      onLog(`[mobile:launch] scenario ${scenario.scenarioId} testrail sync=${syncResult.syncStatus} statusId=${syncResult.statusId}${syncResult.error ? ` error=${syncResult.error}` : ""}`);
      onLog(`[mobile:sync] testrail action=${syncResult.syncStatus} statusId=${syncResult.statusId} reason=${syncResult.error ?? "ok"}`);
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
      const firstFailedStep = failedSteps[0];
      const skippedCount = stepResults.filter((r) => r.status === "skipped_dependency_failed").length;
      const summaryFirstFailureStepIndex = discoveryStatus === "failed" ? (firstFailedStep?.index ?? -1) : -1;
      const summaryFirstFailureStep = summaryFirstFailureStepIndex >= 0 ? summaryFirstFailureStepIndex + 1 : -1;
      const summaryReasonCode = discoveryStatus !== "passed" ? (firstFailedStep?.reasonCode ?? (execResult.blockedReasonCode ?? "none")) : "none";
      const summaryFailedCount = discoveryStatus === "failed" ? Math.max(1, blockingFailed) : 0;
      const summaryBlockedCount = discoveryStatus === "blocked" ? Math.max(1, execResult.blocked ?? 1) : 0;
      onLog(
        `[mobile:summary] scenarioId=${scenario.scenarioId} status=${discoveryStatus} passed=${execResult.passed} failed=${summaryFailedCount} skipped=${skippedCount} blocked=${summaryBlockedCount} firstFailureStep=${summaryFirstFailureStep} causalStep=${summaryFirstFailureStep} causalStepIndex=${summaryFirstFailureStepIndex} reasonCode=${summaryReasonCode} failureCategory=${failureCategory ?? "none"} jiraAction=${jiraAction} testRailAction=${syncResult.syncStatus}`,
      );
      scenarioOutcomes.push({
        scenarioId: scenario.scenarioId,
        status: discoveryStatus,
        failureCategory,
        firstFailureStep: summaryFirstFailureStep,
        firstFailureStepIndex: summaryFirstFailureStepIndex,
        firstFailureReasonCode: summaryReasonCode,
      });
    }

    persistMobileExecutionResults(jobId, scenarioOutcomes);

    // Consolidate all scenarios' evidence.json into evidence-run.json + a single run docx.
    await deps.consolidateEvidenceFn(runId, sectionSlug, onLog);

    const finalStatus = totalFailed === 0 && totalBlocked === 0 ? "completed" : "completed_with_failures";
    finalizeLaunchManifest(params.launchId, finalStatus, params.scenarios.length - syncedCount, params.scenarios.length);

    jobStore.update(jobId, {
      status: totalFailed === 0 ? "done" : "completed_with_failures",
      completedAt: new Date().toISOString(),
      summary: {
        totalStories: params.scenarios.length,
        synced: syncedCount,
        passed: totalPassed,
        failed: totalFailed,
        blocked: totalBlocked,
        testRailRunId: params.testRunId
      }
    });
    onLog(`[mobile:run] finished status=${totalFailed === 0 && totalBlocked === 0 ? "done" : "completed_with_failures"} passed=${totalPassed} failed=${totalFailed} blocked=${totalBlocked} durationMs=${jobStore.get(jobId)?.durationMs ?? "n/a"}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const block = classifyInfrastructureExecutionFailure(message);
    if (block.blocked) {
      const reasonCode = block.reasonCode ?? "mobile_infra_unhealthy";
      const scenariosSkipped = markRemainingScenariosSkippedInfrastructure(
        params.launchId,
        params.scenarios,
        params.publishedCases,
        params.scenarios.length,
        reasonCode,
        onLog,
      );
      onLog(`[mobile:launch] blocked reasonCode=${reasonCode} message=${message}`);
      onLog(`[mobile:launch] functionalDefectSyncSkipped=true testRailFunctionalStatusSkipped=true reason=infrastructure_block stage=preflight scenariosSkipped=${scenariosSkipped}`);
      onLog("[mobile:launch] infra block: skipping scenario execution, defect creation, and TestRail result sync.");
      jobStore.update(jobId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: message,
        summary: {
          totalStories: params.scenarios.length,
          synced: 0,
          passed: 0,
          failed: 0,
          scenariosSkipped,
          reasonCode,
          testRailRunId: params.testRunId,
          errorMessage: message,
        },
      });
      onLog(`[mobile:run] finished status=failed passed=0 failed=0 blocked=${scenariosSkipped}`);
    } else {
      onLog(`[mobile:launch] failed: ${message}`);
      jobStore.update(jobId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: message
      });
      onLog("[mobile:run] finished status=failed passed=0 failed=0 blocked=0");
    }
  } finally {
    logger.flush();
  }
}
