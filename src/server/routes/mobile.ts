import { Router } from "express";
import { jobStore } from "../jobs/job-store";
import { startMobileEmulatorBootJob, ensureAppiumReady } from "../jobs/mobile-emulator-runner";
import { startMobileTestRunJob, type MobileTestRunParams } from "../jobs/mobile-test-runner";
import { getStatus as getEmulatorStatus, stopEmulator } from "../../mobile/emulator-manager";
import { getStatus as getAppiumStatus, refreshStatus as refreshAppiumStatus, type AppiumServerState } from "../../mobile/appium-server-manager";
import { config, requireJiraConfig } from "../../config/env";
import { JiraClient } from "../../clients/jira.client";
import { generateMobileScenarios, mobileScenarioToLaunchScenario, type MobileGeneratedScenario } from "../../scenarios/mobile-scenario-generator";
import { launchExecution } from "../jobs/launch-orchestrator";
import { startMobileLaunchExecutionJob, deriveSourceIssueKey, type MobileLaunchExecutionParams } from "../jobs/mobile-launch-execution-runner";
import { getMobileScenarioGenerationJob, startOrReuseMobileScenarioGenerationJob } from "../jobs/mobile-scenario-generation-manager";
import { normalizeMobileLaunchExecutionParams, persistMobileExecutionManifest } from "../jobs/mobile-rerun-artifacts";

export const mobileRouter = Router();
let activeEmulatorBootJobId: string | null = null;

function normalizeSelectedIssueKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((entry) => String(entry ?? "").trim())
      .filter((entry) => entry.length > 0),
  )).sort();
}

function readActiveEmulatorBootJob() {
  if (!activeEmulatorBootJobId) return null;
  const job = jobStore.get(activeEmulatorBootJobId);
  if (!job) {
    activeEmulatorBootJobId = null;
    return null;
  }
  const isTerminal = job.status === "done" || job.status === "failed" || job.status === "cancelled";
  if (isTerminal) {
    activeEmulatorBootJobId = null;
    return null;
  }
  return job;
}

function appiumSummary(status: AppiumServerState): { ready: boolean; reused: boolean; external: boolean; port?: number } {
  return {
    ready: status.ready,
    reused: status.ready,
    external: status.external,
    port: status.port,
  };
}

function emulatorStartResponse(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    emulator: getEmulatorStatus(),
    appium: appiumSummary(getAppiumStatus()),
    ...extra,
  };
}

// POST /api/mobile/emulator/start — boots the Android emulator as a background job.
// Watch progress via GET /api/runs/:jobId/logs (SSE).
mobileRouter.post("/emulator/start", (req, res) => {
  const body = req.body as { avdName?: string; headless?: boolean };
  const requestedAvdName = body.avdName?.trim() || undefined;
  const requestedHeadless = body.headless;
  const effectiveAvdName = requestedAvdName || config.integrations.android?.avdName;
  const effectiveHeadless = requestedHeadless ?? config.integrations.android?.headless ?? true;
  console.log(
    `[mobile] emulator/start request requestedAvdName=${requestedAvdName ?? "auto"} requestedHeadless=${requestedHeadless === undefined ? "auto" : requestedHeadless} effectiveAvdName=${effectiveAvdName ?? "missing"} effectiveHeadless=${effectiveHeadless}`
  );

  const activeJob = readActiveEmulatorBootJob();
  if (activeJob) {
    res.status(202).json(emulatorStartResponse({
      ok: true,
      reused: true,
      jobId: activeJob.id,
      status: activeJob.status,
      mode: "mobile-emulator-boot",
      message: "Emulator start already in progress; returning existing job.",
    }));
    return;
  }

  if (!effectiveAvdName) {
    res.status(400).json({
      ok: false,
      error: "invalid_request",
      message: "Missing avdName. Provide avdName in request payload or configure ANDROID_AVD_NAME.",
    });
    return;
  }

  const existing = getEmulatorStatus();
  if (existing.running) {
    const appium = getAppiumStatus();
    const payload = emulatorStartResponse({
      ok: true,
      reused: true,
      status: existing,
      mode: "mobile-emulator-boot",
    });
    if (appium.ready) {
      payload.message = `Emulator already ${existing.status}; reusing existing instance. Appium ready.`;
    } else {
      payload.appiumStarting = true;
      payload.message = `Emulator already ${existing.status}; reusing existing instance. Appium not ready; starting in background.`;
      setImmediate(() => {
        ensureAppiumReady((line) => console.log(line)).catch((err) => {
          console.log(`[mobile:infra] appium ensure failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      });
    }
    res.status(202).json(payload);
    return;
  }

  const job = jobStore.create("mobile-emulator-boot", {
    avdName: body.avdName,
    headless: body.headless
  });
  activeEmulatorBootJobId = job.id;
  setImmediate(() => startMobileEmulatorBootJob(job.id));

  res.status(202).json(emulatorStartResponse({
    ok: true,
    jobId: job.id,
    status: job.status,
    mode: "mobile-emulator-boot",
    message: "Emulator boot + Appium readiness job started.",
  }));
});

// GET /api/mobile/emulator/status — synchronous read of the current emulator state.
mobileRouter.get("/emulator/status", (_req, res) => {
  const activeJob = readActiveEmulatorBootJob();
  res.json({
    ok: true,
    ...getEmulatorStatus(),
    appium: appiumSummary(getAppiumStatus()),
    activeJobId: activeJob?.id,
    activeJobStatus: activeJob?.status,
  });
});

// POST /api/mobile/emulator/stop — kills the running emulator, if any.
mobileRouter.post("/emulator/stop", async (_req, res, next) => {
  try {
    await stopEmulator(
      (line) => console.log(line),
      { caller: "api:/api/mobile/emulator/stop" },
    );
    activeEmulatorBootJobId = null;
    res.json({ ok: true, ...getEmulatorStatus() });
  } catch (err) {
    next(err);
  }
});

// GET /api/mobile/appium/status — synchronous read of the current Appium server state.
mobileRouter.get("/appium/status", async (_req, res, next) => {
  try {
    const current = getAppiumStatus();
    const refreshed = await refreshAppiumStatus(current.port);
    res.json({ ok: true, ...refreshed });
  } catch (err) {
    next(err);
  }
});

// POST /api/mobile/tests/run — ensures emulator+Appium are up, then runs the given
// steps against an installed/launched app, capturing evidence. Watch progress via
// GET /api/runs/:jobId/logs (SSE).
mobileRouter.post("/tests/run", (req, res) => {
  const body = req.body as MobileTestRunParams;

  // apkPath/appPackage/appActivity can also come from .env (ANDROID_APK_PATH,
  // ANDROID_APP_PACKAGE, ANDROID_APP_ACTIVITY) — only reject if neither the request
  // nor the config has one, matching what mobile-test-runner.ts actually resolves.
  const hasApp = Boolean(
    body.apkPath?.trim() || body.appPackage?.trim() ||
    config.integrations.android?.apkPath || config.integrations.android?.appPackage
  );
  if (!hasApp) {
    res.status(400).json({
      ok: false,
      error: "invalid_request",
      message: "Either apkPath or appPackage is required (in the request body or via ANDROID_APK_PATH/ANDROID_APP_PACKAGE in .env)"
    });
    return;
  }

  if (!body.steps || body.steps.length === 0) {
    res.status(400).json({
      ok: false,
      error: "invalid_request",
      message: "steps is required and must be a non-empty array"
    });
    return;
  }

  const job = jobStore.create("mobile-test-run", body as unknown as Record<string, unknown>);
  setImmediate(() => startMobileTestRunJob(job.id));

  res.status(202).json({
    ok: true,
    jobId: job.id,
    status: job.status,
    mode: "mobile-test-run"
  });
});

// POST /api/mobile/scenarios/generation — async mobile scenario generation job with
// idempotency, issue-level progress, and result retrieval via status endpoint.
mobileRouter.post("/scenarios/generation", async (req, res) => {
  const body = req.body as {
    projectKey?: string;
    sprintId?: number;
    activeSprint?: boolean;
    status?: string;
    maxResults?: number;
    appSlug?: string;
    selectedIssueKeys?: string[];
    sourceRevision?: string;
    launchDraftId?: string;
  };
  const requestId = String(req.headers["x-request-id"] ?? body.launchDraftId ?? "").trim() || undefined;
  const projectKey = String(body.projectKey ?? "").trim();
  if (!projectKey) {
    res.status(400).json({ ok: false, error: "invalid_request", errorCode: "MISSING_PROJECT_KEY", message: "projectKey is required" });
    return;
  }
  if (!body.activeSprint && !body.sprintId) {
    res.status(400).json({ ok: false, error: "invalid_request", errorCode: "MISSING_SPRINT", message: "activeSprint: true or sprintId is required" });
    return;
  }

  const selectedIssueKeys = normalizeSelectedIssueKeys(body.selectedIssueKeys);
  const startResult = await startOrReuseMobileScenarioGenerationJob({
    projectKey,
    sprintId: typeof body.sprintId === "number" && Number.isFinite(body.sprintId) ? Number(body.sprintId) : undefined,
    activeSprint: body.activeSprint === true,
    status: typeof body.status === "string" ? body.status : undefined,
    maxResults: typeof body.maxResults === "number" && Number.isFinite(body.maxResults) ? Number(body.maxResults) : undefined,
    appSlug: typeof body.appSlug === "string" ? body.appSlug : undefined,
    selectedIssueKeys,
    sourceRevision: typeof body.sourceRevision === "string" ? body.sourceRevision : undefined,
    launchDraftId: typeof body.launchDraftId === "string" ? body.launchDraftId : undefined,
  }, { requestId });

  const job = startResult.job;
  const scenarioCountByIssue = Object.fromEntries(
    job.issueProgress.map((entry) => [entry.issueKey, entry.scenarioCount]),
  );
  console.log(
    `[mobile:scenario-generation] requestId=${job.requestId} generationJobId=${job.generationJobId} launchDraftId=${job.launchDraftId ?? "—"} appSlug=${job.appSlug ?? "—"} issueKeys=${job.issueKeys.join(",") || "-"} startedAt=${job.startedAt ?? "—"} finishedAt=${job.finishedAt ?? "—"} status=${job.status} cache=${startResult.cacheHit ? "hit" : (startResult.reused ? "reuse_running" : "miss")} consumersWaiting=${job.consumersWaiting} scenariosByIssue=${JSON.stringify(scenarioCountByIssue)}`,
  );

  res.status(202).json({
    ok: true,
    requestId: job.requestId,
    generationJobId: job.generationJobId,
    launchDraftId: job.launchDraftId,
    idempotencyKeyHash: job.idempotencyKeyHash,
    issueKeys: job.issueKeys,
    appSlug: job.appSlug,
    status: job.status,
    reused: startResult.reused,
    cacheHit: startResult.cacheHit,
    consumersWaiting: job.consumersWaiting,
  });
});

// GET /api/mobile/scenarios/generation/:generationJobId — async generation status + result.
mobileRouter.get("/scenarios/generation/:generationJobId", (req, res) => {
  const generationJobId = String(req.params.generationJobId ?? "").trim();
  if (!generationJobId) {
    res.status(400).json({ ok: false, error: "invalid_request", errorCode: "MISSING_GENERATION_JOB_ID", message: "generationJobId is required" });
    return;
  }
  const job = getMobileScenarioGenerationJob(generationJobId);
  if (!job) {
    res.status(404).json({ ok: false, error: "generation_job_not_found", errorCode: "GENERATION_JOB_NOT_FOUND", message: `Generation job ${generationJobId} not found` });
    return;
  }

  const scenarioCountByIssue = Object.fromEntries(
    job.issueProgress.map((entry) => [entry.issueKey, entry.scenarioCount]),
  );
  console.log(
    `[mobile:scenario-generation:status] requestId=${job.requestId} generationJobId=${job.generationJobId} launchDraftId=${job.launchDraftId ?? "—"} issueKeys=${job.issueKeys.join(",") || "-"} startedAt=${job.startedAt ?? "—"} finishedAt=${job.finishedAt ?? "—"} status=${job.status} consumersWaiting=${job.consumersWaiting} scenariosByIssue=${JSON.stringify(scenarioCountByIssue)}`,
  );

  res.json({
    ok: true,
    requestId: job.requestId,
    generationJobId: job.generationJobId,
    launchDraftId: job.launchDraftId,
    status: job.status,
    appSlug: job.appSlug,
    issueKeys: job.issueKeys,
    issueProgress: job.issueProgress,
    partial: job.partial,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    consumersWaiting: job.consumersWaiting,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  });
});

// POST /api/mobile/scenarios/preview — AI-generated Appium steps from Jira issues.
// Mirrors /api/scenarios/preview's request shape. Synchronous (each issue is a
// separate AI call, done sequentially) since there's no long-running boot involved —
// only network/AI latency, same as the web scenario preview endpoint.
mobileRouter.post("/scenarios/preview", async (req, res, next) => {
  try {
    const body = req.body as {
      projectKey?: string;
      sprintId?: number;
      activeSprint?: boolean;
      status?: string;
      maxResults?: number;
      appSlug?: string;
      selectedIssueKeys?: string[];
    };

    if (!body.projectKey) {
      res.status(400).json({ ok: false, error: "invalid_request", message: "projectKey is required" });
      return;
    }
    if (!body.activeSprint && !body.sprintId) {
      res.status(400).json({ ok: false, error: "invalid_request", message: "activeSprint: true or sprintId is required" });
      return;
    }

    const jiraConfig = requireJiraConfig(config);
    const jira = new JiraClient(jiraConfig);

    let sprintId: number;
    if (body.activeSprint) {
      const active = await jira.getActiveSprint(body.projectKey);
      if (!active) {
        res.status(404).json({ ok: false, error: "no_active_sprint", message: `No hay sprint activo para el proyecto ${body.projectKey}` });
        return;
      }
      sprintId = active.id;
    } else {
      sprintId = body.sprintId!;
    }

    const selectedIssueKeys = Array.isArray(body.selectedIssueKeys)
      ? body.selectedIssueKeys.map((key) => String(key).trim()).filter(Boolean)
      : [];
    const effectiveMaxResults = body.maxResults
      ?? (selectedIssueKeys.length > 0 ? selectedIssueKeys.length : 1);
    const result = await generateMobileScenarios(
      jiraConfig,
      body.projectKey,
      sprintId,
      body.status,
      effectiveMaxResults,
      body.appSlug,
      { selectedIssueKeys },
    );

    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

// POST /api/mobile/runs/launch-execution — publishes AI-generated mobile scenarios as
// TestRail cases and creates a TestRail Run, identical to the web
// /api/runs/launch-execution flow (reuses launchExecution() unmodified). Synchronous,
// same as the web endpoint — no device/emulator work happens here.
mobileRouter.post("/runs/launch-execution", async (req, res, next) => {
  try {
    const body = req.body as {
      appSlug?: string;
      projectId?: number;
      sectionId?: string | number;
      testrailSectionId?: number;
      suiteId?: number;
      jiraKey?: string;
      sprintName?: string;
      publishStrategy?: "always_create" | "use_existing";
      scenarios?: MobileGeneratedScenario[];
    };

    if (!body.projectId) {
      res.status(400).json({ ok: false, error: "invalid_request", message: "projectId is required" });
      return;
    }
    if (!body.testrailSectionId && !body.sectionId) {
      res.status(400).json({ ok: false, error: "invalid_request", message: "sectionId or testrailSectionId is required" });
      return;
    }
    if (!body.scenarios || body.scenarios.length === 0) {
      res.status(400).json({ ok: false, error: "invalid_request", message: "scenarios is required and must be a non-empty array" });
      return;
    }

    const result = await launchExecution({
      appSlug: body.appSlug || "mobile",
      projectId: body.projectId,
      sectionId: body.sectionId,
      testrailSectionId: body.testrailSectionId,
      suiteId: body.suiteId,
      jiraKey: body.jiraKey,
      jiraTitle: (body as { jiraTitle?: string; storyTitle?: string }).jiraTitle ?? (body as { storyTitle?: string }).storyTitle,
      sprintName: body.sprintName,
      publishStrategy: body.publishStrategy,
      selectedScenarios: body.scenarios.map(mobileScenarioToLaunchScenario)
    });

    if (!result.ok) {
      res.status(400).json(result);
      return;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/mobile/runs/execute — runs the scenarios published by launch-execution
// against a real emulator/Appium session and syncs pass/fail back to the TestRail Run
// (reuses syncDiscoveryResultToTestRail() unmodified). Watch progress via
// GET /api/runs/:jobId/logs (SSE).
mobileRouter.post("/runs/execute", (req, res) => {
  const body = normalizeMobileLaunchExecutionParams(req.body as MobileLaunchExecutionParams);

  if (!body.testRunId) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "testRunId is required" });
    return;
  }
  if (!body.publishedCases || body.publishedCases.length === 0) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "publishedCases is required and must be a non-empty array" });
    return;
  }
  if (!body.scenarios || body.scenarios.length === 0) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "scenarios is required and must be a non-empty array" });
    return;
  }

  const hasApp = Boolean(
    body.apkPath?.trim() || body.appPackage?.trim() ||
    config.integrations.android?.apkPath || config.integrations.android?.appPackage
  );
  if (!hasApp) {
    res.status(400).json({
      ok: false,
      error: "invalid_request",
      message: "Either apkPath or appPackage is required (in the request body or via ANDROID_APK_PATH/ANDROID_APP_PACKAGE in .env)"
    });
    return;
  }

  const job = jobStore.create("mobile-launch-execution", body as unknown as Record<string, unknown>);
  try {
    persistMobileExecutionManifest(job.id, body, {
      sourceJobId: typeof (body as { sourceJobId?: unknown }).sourceJobId === "string"
        ? (body as { sourceJobId?: string }).sourceJobId
        : undefined,
    });
  } catch (err) {
    console.warn(
      `[mobile:rerun] failed to persist mobile execution manifest jobId=${job.id} error=${err instanceof Error ? err.message : String(err)}`,
    );
  }
  setImmediate(() => startMobileLaunchExecutionJob(job.id));

  // Surface the HU story + its defect checklist so the front can link straight to it once the run
  // produces defects. Defects are keyed by this issueKey (derived from the scenarioIds). The mobile
  // execution runId (== the execution jobId, the same value logged by `[mobile:run] started runId=`)
  // is appended so the checklist view is isolated to THIS execution's defects only.
  const issueKey =
    body.scenarios.map((s) => deriveSourceIssueKey(s.scenarioId)).find(Boolean) || undefined;
  const checklistUrl = issueKey
    ? `/checklist/${issueKey}?runId=${encodeURIComponent(job.id)}`
    : undefined;

  res.status(202).json({
    ok: true,
    jobId: job.id,
    status: job.status,
    mode: "mobile-launch-execution",
    issueKey,
    checklistUrl
  });
});
