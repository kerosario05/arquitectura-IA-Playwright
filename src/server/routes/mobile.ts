import { Router } from "express";
import { jobStore } from "../jobs/job-store";
import { startMobileEmulatorBootJob } from "../jobs/mobile-emulator-runner";
import { startMobileTestRunJob, type MobileTestRunParams } from "../jobs/mobile-test-runner";
import { getStatus as getEmulatorStatus, stopEmulator } from "../../mobile/emulator-manager";
import { getStatus as getAppiumStatus } from "../../mobile/appium-server-manager";
import { config, requireJiraConfig } from "../../config/env";
import { JiraClient } from "../../clients/jira.client";
import { generateMobileScenarios, mobileScenarioToLaunchScenario, type MobileGeneratedScenario } from "../../scenarios/mobile-scenario-generator";
import { launchExecution } from "../jobs/launch-orchestrator";
import { startMobileLaunchExecutionJob, deriveSourceIssueKey, type MobileLaunchExecutionParams } from "../jobs/mobile-launch-execution-runner";

export const mobileRouter = Router();

// POST /api/mobile/emulator/start — boots the Android emulator as a background job.
// Watch progress via GET /api/runs/:jobId/logs (SSE).
mobileRouter.post("/emulator/start", (req, res) => {
  const body = req.body as { avdName?: string; headless?: boolean };

  const existing = getEmulatorStatus();
  if (existing.running) {
    res.status(409).json({
      ok: false,
      error: "emulator_already_running",
      message: `Emulator already running (avd=${existing.avdName}, pid=${existing.pid}). Stop it first.`,
      status: existing
    });
    return;
  }

  const job = jobStore.create("mobile-emulator-boot", {
    avdName: body.avdName,
    headless: body.headless
  });
  setImmediate(() => startMobileEmulatorBootJob(job.id));

  res.status(202).json({
    ok: true,
    jobId: job.id,
    status: job.status,
    mode: "mobile-emulator-boot"
  });
});

// GET /api/mobile/emulator/status — synchronous read of the current emulator state.
mobileRouter.get("/emulator/status", (_req, res) => {
  res.json({ ok: true, ...getEmulatorStatus() });
});

// POST /api/mobile/emulator/stop — kills the running emulator, if any.
mobileRouter.post("/emulator/stop", async (_req, res, next) => {
  try {
    await stopEmulator();
    res.json({ ok: true, ...getEmulatorStatus() });
  } catch (err) {
    next(err);
  }
});

// GET /api/mobile/appium/status — synchronous read of the current Appium server state.
mobileRouter.get("/appium/status", (_req, res) => {
  res.json({ ok: true, ...getAppiumStatus() });
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

    const result = await generateMobileScenarios(jiraConfig, body.projectKey, sprintId, body.status, body.maxResults ?? 50, body.appSlug);

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
  const body = req.body as MobileLaunchExecutionParams;

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
  setImmediate(() => startMobileLaunchExecutionJob(job.id));

  // Surface the HU story + its defect checklist so the front can link straight to it once the run
  // produces defects. Defects are keyed by this issueKey (derived from the scenarioIds).
  const issueKey =
    body.scenarios.map((s) => deriveSourceIssueKey(s.scenarioId)).find(Boolean) || undefined;
  const checklistUrl = issueKey ? `/checklist/${issueKey}` : undefined;

  res.status(202).json({
    ok: true,
    jobId: job.id,
    status: job.status,
    mode: "mobile-launch-execution",
    issueKey,
    checklistUrl
  });
});
