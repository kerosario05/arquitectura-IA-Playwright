import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, firefox, webkit } from "@playwright/test";
import { jobStore } from "./job-store";
import { config, requireTestRailConfig } from "../../config/env";
import { loadAppConfig } from "../../automations/app-auto-resolver";
import { discoverJiraScenario, createJiraPlaywrightPort, normalizeJiraScenarioForExecution, observeAuthStageSettled, JiraRequiredDataError, jiraTargetDiagnosticField, type JiraScenarioInput } from "../../jira/jira-semantic-executor";
import { completeObservedOtpStage } from "../../jira/jira-observed-otp";
import { scanCurrentPage } from "../../explorer/page-scanner";
import { hasJiraAuthGateData, mapJiraAuthTestData, resolveJiraAuthFlow } from "./jira-auth-flow-wiring";
import { resolveExecutionEngine } from "../../jira/execution-origin";
import { launchRuntimeBrowserSession, type RuntimeBrowserSession } from "../../browser/browser-session";
import { JiraSpecVerificationError, promoteJiraSpec } from "../../jira/jira-spec-promotion";
import { TestRailClient } from "../../clients/testrail.client";
import { buildDataContext } from "../../data/data-context";
import { detectCredentialRole } from "../../data/data-key-resolver";
import { redactJiraScenarioInputs } from "../../jira/jira-rerun-manifest";
import { findJiraInvalidInputCollisions, jiraScenarioRuntimeValues, resolveJiraConfiguredInputValues } from "../../jira/jira-runtime-values";
import { RunEvidenceRecorder } from "../../evidence/run-evidence-recorder";
import { buildEvidenceRunPaths } from "../../evidence/evidence-paths";
import { loadEvidenceConfig } from "../../evidence/evidence-types";
import { buildJiraEvidenceScenarioRecords, jiraEvidenceScreenIdentityFields } from "../../jira/jira-evidence";
import { captureJiraEvidenceScreenshot, readJiraScreenIdentity } from "../../jira/jira-evidence-capture";
import { persistValidatedJiraDiscoveryRoute } from "../../jira/jira-knowledge-learning";
import { invalidateJiraRoute, jiraProfileRevision, shouldInvalidateJiraLearnedRoute } from "../../jira/jira-knowledge-repository";
import {prepareJiraScenarioReview} from "../../jira/jira-scenario-review";
import { persistJiraCaseInputs, resolveJiraPublishedCaseId } from "../../jira/jira-case-input-persistence";
import { linkJiraAutomationToTestRailCase } from "../../automations/automation-index";

function jiraApplicationHttpErrorDiagnostic(error: unknown): { status: number; method: string; path: string } | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/^JIRA_APPLICATION_HTTP_SERVER_ERROR:(5\d\d)\s+([A-Z]+)\s+(\/[^\s?#]*)/);
  if (!match) return undefined;
  const path = match[3]
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id")
    .replace(/\/\d{4,}(?=\/|$)/g, "/:id");
  return { status: Number(match[1]), method: match[2], path };
}

export async function startJiraSemanticRun(jobId: string): Promise<void> {
  const job = jobStore.getInternal(jobId);
  if (!job) return;
  const p = job.params;
  let session: RuntimeBrowserSession | undefined;
  let passed = 0, failed = 0;
  const results: Array<Record<string, unknown>> = [];
  const dir = path.resolve(".artifacts/scenario-preview-runs", jobId);
  const emit = (event: Record<string, unknown>) => jobStore.appendLog(jobId, JSON.stringify({ executionEngine: "jira_semantic", ...event }));
  const cancelled = () => jobStore.get(jobId)?.status === "cancelled";
  const controller = new AbortController();
  const unsubscribe = jobStore.subscribe(jobId, { onLog: () => {}, onUpdate: update => { if (update.status === "cancelled") { controller.abort(); void session?.close(); } } });
  try {
    if (resolveExecutionEngine(p) !== "jira_semantic") throw new Error("INVALID_EXECUTION_ORIGIN");
    const scenarios = p.scenarios as JiraScenarioInput[];
    const appSlug = String(p.appSlug ?? p.targetAppSlug ?? "");
    const profile = await loadAppConfig(appSlug);
    if (!profile || typeof profile.baseUrl !== "string") throw new Error("JIRA_APP_PROFILE_MISSING");
    const baseUrl = new URL(profile.baseUrl).toString();
    const runtimeConfig = { ...config, app: { ...config.app, baseUrl, appProfile: appSlug, name: appSlug,
      username: typeof profile.username === "string" ? profile.username : undefined,
      password: typeof profile.password === "string" ? profile.password : undefined,
      testDataAliases: (profile.testDataAliases ?? {}) as typeof config.app.testDataAliases,
      extraLoginFields: (profile.extraLoginFields ?? {}) as Record<string, string>,
      testData: (profile.testData ?? {}) as typeof config.app.testData, rawTestData: (profile.testData ?? {}) as Record<string, unknown> } };
    const configuredRuntimeValues = Object.fromEntries(buildDataContext(runtimeConfig).entries.map(entry => [entry.key, entry.value]));
    // Extra credential roles (e.g. company identifier) come from configured data only; exact auth.<role> key first.
    const configuredCredentialFields: Record<string, string> = {};
    for (const role of ["company_identifier"] as const) {
      const entries = buildDataContext(runtimeConfig).entries.filter(entry => detectCredentialRole(entry.key) === role && entry.value.trim());
      const value = (entries.find(entry => entry.key === `auth.${role}`) ?? entries[0])?.value;
      if (value) configuredCredentialFields[role] = value;
    }
    const peerRuntimeInputs =scenarios.map((candidate) => {
      const requirements = candidate.inputRequirements ?? [];
      const resolved = resolveJiraConfiguredInputValues({
        overrides: p.dataOverrides,
        scenarioId: candidate.scenarioId,
        displayId: candidate.scenarioId,
        requirements,
        testData: runtimeConfig.app.testData,
        testDataAliases: runtimeConfig.app.testDataAliases,
        profileUsername: runtimeConfig.app.username,
        profilePassword: runtimeConfig.app.password,
      });
      return {
        scenarioId: candidate.scenarioId,
        sourceIssueKey: candidate.sourceIssueKey,
        requirements,
        values: jiraScenarioRuntimeValues(resolved, configuredRuntimeValues, requirements),
      };
    });
    const options = (p.options ?? {}) as { headed?: boolean; autoPromote?: boolean; autoPom?: boolean; overwrite?: boolean };
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "jira-scenarios.json"), JSON.stringify(scenarios.map(redactJiraScenarioInputs)));
    jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });
    for (const [offset, scenario] of scenarios.entries()) {
      if (cancelled()) break;
      let failedAtStep: number | undefined;
      let evidenceScreenshotPath: string | undefined;
      let initialScreenshotPath: string | undefined;
      let initialScreenIdentity: { id: string; title: string } | undefined;
      const stepScreenshotPaths: Record<string, string> = {};
      const stepScreenIdentities: Record<string, { id: string; title: string }> = {};
      let discoveryCompleted = false;
      const caseId = scenario.scenarioId;
      const normalization = normalizeJiraScenarioForExecution({ ...scenario, appSlug }, appSlug);
      const reviewed = prepareJiraScenarioReview(normalization.scenario);
      const executionScenario = reviewed.scenario;
      if (normalization.removedFrameworkPreconditions) emit({ type: "framework_preconditions_normalized", caseId, removedCount: 6 });
      if (normalization.removedRedundantOrdinalSelectionCount) emit({ type: "redundant_ordinal_selection_removed", caseId,
        removedCount: normalization.removedRedundantOrdinalSelectionCount, reason: "direct_navigation_destination_asserted" });
      jobStore.update(jobId, { currentCaseId: caseId, currentCaseTitle: scenario.title });
      emit({ type: "case_started", caseId, title: scenario.title, index: offset + 1, total: scenarios.length, appSlug,
        steps: executionScenario.steps });
      let result: Record<string, unknown>;
      try {
        if (reviewed.errors.length) throw new Error(reviewed.errors[0]);
        emit({type:"test_variant_prepared",caseId,notApplicableStepIndices:reviewed.skippedAssertionSteps});
        const resolvedScenarioValues = resolveJiraConfiguredInputValues({
          overrides: p.dataOverrides,
          scenarioId: scenario.scenarioId,
          displayId: caseId,
          requirements: executionScenario.inputRequirements ?? [],
          testData: runtimeConfig.app.testData,
          testDataAliases: runtimeConfig.app.testDataAliases,
          profileUsername: runtimeConfig.app.username,
          profilePassword: runtimeConfig.app.password,
        });
        // Use the scenario resolver's scoped values only. Merging the whole project
        // data context here can reintroduce a valid configured OTP/token into a
        // negative input that the resolver intentionally left unresolved.
        const effectiveRuntimeValues = jiraScenarioRuntimeValues(
          resolvedScenarioValues,
          configuredRuntimeValues,
          executionScenario.inputRequirements ?? [],
        );
        const requiredInputs = (executionScenario.inputRequirements ?? []).filter(input => input.required);
        const missingInputs = requiredInputs
          .filter(input => !String(effectiveRuntimeValues[input.key] ?? "").trim())
          .map(input => ({ key: input.key, label: input.label, stepIndex: input.stepIndex }));
        emit({ type: "runtime_data_preflight", caseId, required: requiredInputs.length,
          supplied: requiredInputs.length - missingInputs.length, missing: missingInputs.length,
          overrideFields: Object.values(effectiveRuntimeValues).filter(value => String(value).trim().length > 0).length });
        try {
          const persisted = await persistJiraCaseInputs({ projectSlug: appSlug, scenarioId: scenario.scenarioId,
            publishedCases: p.publishedCases, requirements: executionScenario.inputRequirements ?? [], values: effectiveRuntimeValues });
          emit({ type: "case_inputs_persisted", scenarioId: scenario.scenarioId, ...persisted });
        } catch {
          emit({ type: "case_inputs_persistence_failed", scenarioId: scenario.scenarioId, reason: "JIRA_CASE_INPUT_STORAGE_UNAVAILABLE" });
        }
        if (missingInputs.length) throw new JiraRequiredDataError(missingInputs);
        const collision = findJiraInvalidInputCollisions([
          ...peerRuntimeInputs.filter((candidate) => candidate.scenarioId !== caseId),
          {
            scenarioId: caseId,
            sourceIssueKey: scenario.sourceIssueKey,
            requirements: executionScenario.inputRequirements ?? [],
            values: effectiveRuntimeValues,
          },
        ]).find((candidate) => candidate.scenarioId === caseId);
        if (collision) {
          emit({ type: "negative_input_collision_detected", caseId, inputKey: collision.inputKey,
            matchingScenarioId: collision.matchingScenarioId });
          throw new Error("JIRA_NEGATIVE_INPUT_MATCHES_VALID_SCENARIO_INPUT");
        }
        session = await launchRuntimeBrowserSession({ browserType: ({ chromium, firefox, webkit })[config.execution.browser],
          headless: !options.headed, targetUrl: baseUrl, contextOptions: { ignoreHTTPSErrors: profile.ignoreHTTPSErrors === true } });
        session.page.setDefaultTimeout(config.execution.defaultTimeoutMs);
        const authTestData = mapJiraAuthTestData(runtimeConfig.app.rawTestData);
        const authFlow = await resolveJiraAuthFlow({
          authIntent: executionScenario.authIntent,
          loginMode: typeof profile.loginMode === "string" ? profile.loginMode : undefined,
          hasPasswordCredentials: Boolean(runtimeConfig.app.username && runtimeConfig.app.password),
          hasAuthGateData: hasJiraAuthGateData(authTestData),
          load: () => loadConfiguredJiraAuthFlow(appSlug, session!.page, authTestData),
        });
        const discovery = await discoverJiraScenario(executionScenario, createJiraPlaywrightPort(session.page, baseUrl, authFlow),
          effectiveRuntimeValues, async (stepIndex, phase) => {
            failedAtStep = stepIndex;
            emit({ type: "step_progress", caseId, stepIndex, phase });
            if (phase === "passed") {
              const stepScreenshotPath = path.join(dir, `scenario-${offset + 1}-step-${stepIndex}.png`);
              try {
                await captureJiraEvidenceScreenshot(session!.page, { path: stepScreenshotPath, fullPage: true });
                stepScreenshotPaths[String(stepIndex)] = stepScreenshotPath;
                const identity = await readJiraScreenIdentity(session!.page);
                if (identity) stepScreenIdentities[String(stepIndex)] = identity;
                emit({ type: "step_evidence_captured", caseId, stepIndex });
              } catch {
                emit({ type: "step_evidence_capture_failed", caseId, stepIndex, reason: "screenshot_unavailable" });
              }
            }
          }, cancelled, async () => {
            // Capture the project's real initial screen only after Discovery has navigated
            // to the configured base URL, but before the first scenario action runs.
            initialScreenshotPath = path.join(dir, `scenario-${offset + 1}-initial.png`);
            try {
              await captureJiraEvidenceScreenshot(session!.page, { path: initialScreenshotPath, fullPage: true });
              initialScreenIdentity = await readJiraScreenIdentity(session!.page);
              emit({ type: "initial_evidence_captured", caseId });
            } catch {
              initialScreenshotPath = undefined;
              emit({ type: "initial_evidence_capture_failed", caseId, reason: "screenshot_unavailable" });
            }
          }, profile.loginMode === "password" && runtimeConfig.app.username && runtimeConfig.app.password
            ? { username: runtimeConfig.app.username, password: runtimeConfig.app.password, fields: configuredCredentialFields } : undefined);
        discoveryCompleted = true;
        // Discovery has executed and validated these semantic actions. Persist
        // the reusable route now; spec compilation/verification is a separate gate.
        try {
          const learning = await persistValidatedJiraDiscoveryRoute({ scenario: executionScenario, discovery, appSlug,
            profileRevision: jiraProfileRevision(profile), jobId,
            evidenceRefs: Object.values(stepScreenshotPaths).map(file => path.relative(dir, file)) });
          if (learning.status === "persisted") emit({ type: "knowledge_learning_finished", status: "persisted", actions: learning.actions });
          else emit({ type: "knowledge_learning_finished", status: "skipped", reason: "incomplete_learning_contract" });
        } catch {
          emit({ type: "knowledge_learning_finished", status: "failed", reason: "knowledge_storage_unavailable" });
        }
        const lastCapturedStep = Object.keys(stepScreenshotPaths).map(Number).sort((a, b) => b - a)[0];
        evidenceScreenshotPath = lastCapturedStep === undefined ? path.join(dir, `scenario-${offset + 1}-final.png`) : stepScreenshotPaths[String(lastCapturedStep)];
        if (lastCapturedStep === undefined) {
          await captureJiraEvidenceScreenshot(session.page, { path: evidenceScreenshotPath, fullPage: true }).catch(() => {
            evidenceScreenshotPath = undefined;
          });
        }
        await session.close(); session = undefined;
        if (cancelled()) break;
        emit({ type: "discovery_finished", caseId, status: "passed", executionEngine: "jira_semantic" });
        let specPath: string | undefined;
        if (options.autoPromote !== false) {
          emit({ type: "spec_generation_started", caseId, compiler: "jira-semantic-v1" });
          const sectionSlug = `jira-${scenario.sourceIssueKey.toLowerCase()}`;
          failedAtStep = undefined; // A spec failure is not the last successful Discovery step.
          controller.signal.throwIfAborted();
          const discoveredValues = Object.fromEntries(discovery.runtimeEntries.map(entry => [entry.key, entry.value]));
          const entry = await promoteJiraSpec({ plan: discovery.plan, sourceScenario: discovery.sourceScenario,
            appSlug, baseUrl, fullConfig: runtimeConfig, runtimeValues: { ...effectiveRuntimeValues, ...discoveredValues },
            sectionSlug, overwrite: options.overwrite === true, headed: options.headed === true, signal: controller.signal });
          if (entry.specVerificationStatus !== "passed" || entry.status !== "active") throw new Error("JIRA_SPEC_VERIFICATION_NOT_PASSED");
          specPath = entry.specPath;
          emit({ type: "spec_generation_finished", caseId, compiler: "jira-semantic-v1", status: "passed", specPath });
          const publishedTestRailCaseId = resolveJiraPublishedCaseId(p.publishedCases, scenario.scenarioId);
          if (publishedTestRailCaseId === undefined) {
            emit({ type: "testrail_promotion_link", status: "skipped", reason: "published_case_mapping_unresolved" });
          } else {
            try {
              const link = await linkJiraAutomationToTestRailCase({
                appSlug,
                externalId: scenario.scenarioId,
                caseId: publishedTestRailCaseId,
                automationId: entry.id,
              });
              emit({ type: "testrail_promotion_link", status: link.linked ? "linked" : "failed",
                caseId: publishedTestRailCaseId, automationId: entry.id, reason: link.reason });
            } catch {
              emit({ type: "testrail_promotion_link", status: "failed", caseId: publishedTestRailCaseId,
                automationId: entry.id, reason: "link_storage_unavailable" });
            }
          }
        }
        passed++;
        result = { caseId, scenarioId: caseId, status: "passed", automationReady: Boolean(specPath), promotionAllowed: Boolean(specPath), specPath,
          ...(initialScreenshotPath ? { initialScreenshotPath } : {}),
          ...(Object.keys(stepScreenshotPaths).length ? { stepScreenshotPaths } : {}),
          ...jiraEvidenceScreenIdentityFields({ initialScreenIdentity, stepScreenIdentities }),
          ...(evidenceScreenshotPath ? { evidenceScreenshotPath } : {}) };
      } catch (error) {
        if (cancelled()) break;
        // Only invalidate a learned route when a concrete action/target failure
        // proves its navigation may be stale. A generated assertion or missing
        // business step must not erase a route that Discovery previously proved.
        const code = error instanceof Error ? error.message.match(/^([A-Z][A-Z_]+)(?::[a-z_]+)?/)?.[1] ?? "JIRA_EXECUTION_FAILED" : "JIRA_EXECUTION_FAILED";
        const applicationHttpError = jiraApplicationHttpErrorDiagnostic(error);
        if (applicationHttpError) emit({ type: "application_http_error", caseId, failedAtStep,
          ...applicationHttpError, reason: "same_origin_application_response_5xx" });
        if (!discoveryCompleted && shouldInvalidateJiraLearnedRoute(code)) {
          try { await invalidateJiraRoute(appSlug, scenario.scenarioId); }
          catch { emit({ type: "knowledge_invalidation_failed", caseId, reason: "knowledge_storage_unavailable" }); }
        } else if (!discoveryCompleted) emit({ type: "knowledge_invalidation_skipped", caseId, reason: "failure_not_route_evidence", failureCode: code });
        failed++;
        // Error classes only: Playwright messages can embed filled credentials.
        const screenshotPath = path.join(dir, `failed-${offset + 1}.png`);
        if (session) {
          await captureJiraEvidenceScreenshot(session.page, { path: screenshotPath }).catch(() => {});
          if (failedAtStep !== undefined) {
            const identity = await readJiraScreenIdentity(session.page);
            if (identity) stepScreenIdentities[String(failedAtStep)] = identity;
          }
        }
        evidenceScreenshotPath = fsSync.existsSync(screenshotPath) ? screenshotPath : undefined;
        result = { caseId, scenarioId: caseId, status: "failed", failedAtStep, failedReason: code, automationReady: false, promotionAllowed: false,
          ...(applicationHttpError ? { applicationHttpError } : {}),
          ...(error instanceof JiraSpecVerificationError ? { specVerificationCategory: error.category,
            specVerificationDiagnosticPath: error.diagnosticPath, specVerificationArtifactsDir: error.artifactsDir } : {}),
          ...(error instanceof JiraRequiredDataError ? {missingInputs:error.missingInputs} : {}),
          ...jiraTargetDiagnosticField(error),
          failurePhase: discoveryCompleted ? "spec_generation" : "discovery",
          ...(initialScreenshotPath ? { initialScreenshotPath } : {}),
          ...(Object.keys(stepScreenshotPaths).length ? { stepScreenshotPaths } : {}),
          ...jiraEvidenceScreenIdentityFields({ initialScreenIdentity, stepScreenIdentities }),
          ...(evidenceScreenshotPath ? { screenshotPath: evidenceScreenshotPath, evidenceScreenshotPath } : {}) };
      } finally { await session?.close().catch(() => {}); session = undefined; }
      results.push(result!);
      emit({ type: "case_finished", ...result!, title: scenario.title, index: offset + 1, total: scenarios.length });
      jobStore.update(jobId, { summary: { passed, failed, completed: passed + failed, totalCases: scenarios.length, artifactsDir: dir } });
    }
    await fs.writeFile(path.join(dir, "results.json"), JSON.stringify({ results, summary: { passed, failed } }, null, 2));
    if (cancelled()) return;
    const evidence = await generateJiraEvidence(jobId, p, scenarios, results, dir);
    if (evidence.attempted) {
      emit({ type: "evidence_document_finished", status: evidence.generated ? "ready" : "failed",
        pdfReady: evidence.pdfReady, docxReady: evidence.docxReady, reasonCode: evidence.reasonCode });
    } else {
      emit({ type: "evidence_document_finished", status: "unavailable", reasonCode: evidence.reasonCode });
    }
    const priorSummary = jobStore.getInternal(jobId)?.summary;
    jobStore.update(jobId, { summary: { ...priorSummary, passed, failed, completed: passed + failed, totalCases: scenarios.length,
      artifactsDir: dir, documentAttempted: evidence.attempted, documentGenerated: evidence.generated,
      documentPathPresent: evidence.pathPresent, ...(evidence.documentPath ? { documentPath: evidence.documentPath, evidenceDir: path.dirname(evidence.documentPath) } : {}),
      ...(evidence.reasonCode ? { documentError: evidence.reasonCode } : {}) } });
    // Report only to the already-created launch run. No case or run publication here.
    let syncFailed = false;
    if (p.testRunId && Array.isArray(p.publishedCases)) {
      try {
        const mappings = p.publishedCases as Array<{ scenarioId: string; caseId: number; executionScenarioId?: string; launchScenarioId?: string }>;
        const mapped = results.map(r => {
          const candidates = mappings.filter(m => [m.scenarioId, m.executionScenarioId, m.launchScenarioId].includes(String(r.scenarioId)));
          if (candidates.length !== 1) throw new Error("JIRA_TESTRAIL_MAPPING_UNRESOLVED");
          return { runId: Number(p.testRunId), caseId: candidates[0].caseId, statusId: r.status === "passed" ? 1 : 5, comment: `engine=jira_semantic; scenarioId=${r.scenarioId}; jobId=${jobId}` };
        });
        await new TestRailClient(requireTestRailConfig(config)).addResultsForCases(Number(p.testRunId), mapped);
      } catch { syncFailed = true; emit({ type: "sync_failed", reason: "JIRA_TESTRAIL_SYNC_FAILED" }); }
    }
    jobStore.update(jobId, { status: syncFailed ? "completed_with_sync_errors" : failed ? "completed_with_failures" : "done", completedAt: new Date().toISOString() });
  } catch {
    if (!cancelled()) jobStore.update(jobId, { status: "failed", errorMessage: "JIRA_ENGINE_SETUP_FAILED", completedAt: new Date().toISOString() });
  } finally { unsubscribe(); await session?.close().catch(() => {}); jobStore.clearTransientParams(jobId); }
}

async function generateJiraEvidence(
  jobId: string,
  params: Record<string, unknown>,
  scenarios: JiraScenarioInput[],
  outcomes: Array<Record<string, unknown>>,
  artifactsDir: string,
): Promise<{ attempted: boolean; generated: boolean; pathPresent: boolean; documentPath?: string; pdfReady: boolean; docxReady: boolean; reasonCode?: string }> {
  const config = loadEvidenceConfig();
  if (!config.enabled || !config.docxEnabled) {
    return { attempted: false, generated: false, pathPresent: false, pdfReady: false, docxReady: false, reasonCode: "evidence_disabled" };
  }
  if (scenarios.length === 0 || outcomes.length === 0) {
    return { attempted: false, generated: false, pathPresent: false, pdfReady: false, docxReady: false, reasonCode: "evidence_scenarios_missing" };
  }

  const appSlug = String(params.appSlug ?? params.targetAppSlug ?? "");
  const sectionSlug = String(params.sectionSlug ?? "default-section");
  const sectionName = typeof params.sectionName === "string" ? params.sectionName : undefined;
  const analyst = typeof params.analystName === "string" ? params.analystName : undefined;
  const requirementTitle = typeof params.jiraTitle === "string" ? params.jiraTitle : typeof params.huTitle === "string" ? params.huTitle : undefined;
  const requirementKey = typeof params.issueKey === "string" ? params.issueKey : typeof params.jiraKey === "string" ? params.jiraKey : undefined;
  try {
    const recorder = new RunEvidenceRecorder({ appSlug, sectionSlug, sectionName,
      requirement: requirementKey ? [requirementKey, requirementTitle].filter(Boolean).join(" ") : undefined,
      runId: jobId, outputRoot: config.outputRoot, analystName: analyst });
    await recorder.start();
    const records = buildJiraEvidenceScenarioRecords(scenarios, outcomes as Parameters<typeof buildJiraEvidenceScenarioRecords>[1], {
      appSlug, sectionSlug, sectionName, analyst, requirementTitle });
    for (const record of records) recorder.addScenario(record);
    const runRecord = await recorder.finish();
    const paths = buildEvidenceRunPaths({ appSlug, sectionSlug, sectionName, runId: jobId, outputRoot: config.outputRoot });
    const pdfReady = Boolean(runRecord.pdfPath && fsSync.existsSync(paths.pdfPath));
    const docxReady = Boolean(runRecord.docxPath && fsSync.existsSync(paths.docxPath));
    const documentPath = (pdfReady ? paths.pdfPath : undefined) ?? (docxReady ? paths.docxPath : undefined);
    return { attempted: true, generated: Boolean(documentPath), pathPresent: Boolean(documentPath), documentPath, pdfReady, docxReady,
      ...(!documentPath ? { reasonCode: "document_generation_failed" } : {}) };
  } catch {
    return { attempted: true, generated: false, pathPresent: false, pdfReady: false, docxReady: false, reasonCode: "document_generation_failed" };
  }
}

async function loadConfiguredJiraAuthFlow(
  appSlug: string,
  page: RuntimeBrowserSession["page"],
  authTestData: Record<string, unknown> | undefined,
): Promise<(observedStage?: string) => Promise<{ success: boolean }>> {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(appSlug)) throw new Error("JIRA_AUTH_FLOW_UNAVAILABLE");
  const flowPath = path.resolve("automations/apps", appSlug, "flows", "auth.flow.ts");
  try { await fs.access(flowPath); } catch { throw new Error("JIRA_AUTH_FLOW_UNAVAILABLE"); }
  try {
    const flowModule = await import(pathToFileURL(flowPath).href) as {
      AuthFlow?: new (page: RuntimeBrowserSession["page"]) => { ensureAuthenticated(options?: { alias?: string }): Promise<{ success: boolean }> };
      setAuthFlowTestData?: (data: Record<string, unknown>) => void;
    };
    if (!flowModule.AuthFlow || !flowModule.setAuthFlowTestData) throw new Error("JIRA_AUTH_FLOW_UNAVAILABLE");
    if (authTestData && Object.keys(authTestData).length) flowModule.setAuthFlowTestData(authTestData);
    const flow = new flowModule.AuthFlow(page);
    const code = (authTestData?.clients as Record<string, Record<string, unknown>> | undefined)?.defaultClient?.otp;
    return (observedStage) => observedStage === "otp"
      ? completeObservedOtpStage(page, typeof code === "string" ? code : undefined, () => observeAuthStageSettled({ scan: () => scanCurrentPage(page), wait: ms => page.waitForTimeout(ms), now: Date.now }))
      : flow.ensureAuthenticated({ alias: "defaultClient" });
  } catch {
    throw new Error("JIRA_AUTH_FLOW_UNAVAILABLE");
  }
}
