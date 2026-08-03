import * as fs from "node:fs";
import * as path from "node:path";
import { jobStore } from "./job-store";
import { config } from "../../config/env";
import {
  getStatus as getEmulatorStatus,
  startEmulator,
  waitForBoot
} from "../../mobile/emulator-manager";
import {
  getStatus as getAppiumStatus,
  startAppiumServer,
  waitForReady as waitForAppiumReady
} from "../../mobile/appium-server-manager";
import { createSession, closeSession } from "../../mobile/appium-session";
import { executeMobileStep } from "../../mobile/mobile-step-executor";
import { buildEvidenceScenarioDir, buildScreenshotFilename } from "../../evidence/evidence-paths";
import { EvidenceRecorder } from "../../evidence/evidence-recorder";
import { RunEvidenceRecorder } from "../../evidence/run-evidence-recorder";
import { loadEvidenceConfig } from "../../evidence/evidence-types";
import { applyDataOverrides, type MobileStep, type MobileStepResult, type MobileDataField } from "../../mobile/mobile-step-types";
import { extractMobileScreenSnapshot, type MobileScreenSnapshot } from "../../mobile/mobile-knowledge-extractor";
import { persistMobileScreen, persistMobileRoute } from "../../mobile/mobile-knowledge-persister";

export type MobileTestRunParams = {
  avdName?: string;
  apkPath?: string;
  appPackage?: string;
  appActivity?: string;
  steps: MobileStep[];
  /** User-supplied real values, keyed by { stepIndex: value }. */
  dataOverrides?: Record<number, string>;
  /** Data-field metadata so select overrides can be re-targeted (optional). */
  requiredData?: MobileDataField[];
  /** Route-profile app slug; if set, enables knowledge learning for this run. */
  appSlug?: string;
};

export type ResolvedMobileTarget = {
  avdName: string;
  headless: boolean;
  bootTimeoutMs: number;
  appiumPort: number;
  apkPath?: string;
  appPackage?: string;
  appActivity?: string;
};

export function resolveMobileTarget(params: {
  avdName?: string;
  apkPath?: string;
  appPackage?: string;
  appActivity?: string;
}): ResolvedMobileTarget {
  return {
    avdName: params.avdName?.trim() || config.integrations.android?.avdName || "Pixel_7_Pro",
    headless: config.integrations.android?.headless ?? true,
    bootTimeoutMs: config.integrations.android?.bootTimeoutMs ?? 120000,
    appiumPort: config.integrations.android?.appiumPort ?? 4723,
    apkPath: params.apkPath?.trim() || config.integrations.android?.apkPath,
    appPackage: params.appPackage?.trim() || config.integrations.android?.appPackage,
    appActivity: params.appActivity?.trim() || config.integrations.android?.appActivity
  };
}

/**
 * Boots the emulator and Appium server if they aren't already running/ready. Safe to
 * call once per job even when the job executes multiple scenarios — reuses whatever
 * is already up instead of re-booting per scenario.
 */
export async function ensureMobileInfra(
  target: Pick<ResolvedMobileTarget, "avdName" | "headless" | "bootTimeoutMs" | "appiumPort">,
  onLog: (line: string) => void
): Promise<void> {
  if (!getEmulatorStatus().running) {
    onLog(`[mobile:infra] emulator not running, starting avd=${target.avdName}`);
    await startEmulator(target.avdName, { headless: target.headless }, onLog);
    await waitForBoot(target.bootTimeoutMs, onLog);
  } else {
    onLog("[mobile:infra] emulator already running, reusing");
  }

  if (!getAppiumStatus().ready) {
    onLog(`[mobile:infra] appium server not ready, starting on port=${target.appiumPort}`);
    await startAppiumServer(target.appiumPort, onLog);
    await waitForAppiumReady(30000, onLog);
  } else {
    onLog("[mobile:infra] appium server already ready, reusing");
  }
}

export type RunOneScenarioOptions = {
  appiumPort: number;
  apkPath?: string;
  appPackage?: string;
  appActivity?: string;
  steps: MobileStep[];
  evidenceScenarioId: string;
  evidenceScenarioTitle: string;
  runId: string;
  sectionSlug: string;
  /** Route-profile app slug (e.g. "app-conversacional-bsc"); enables knowledge learning. */
  appSlug?: string;
  sourceIssueKey?: string;
};

export type RunOneScenarioResult = {
  passed: number;
  failed: number;
  artifactsDir: string;
  results: MobileStepResult[];
};

/**
 * Runs ONE scenario's steps against a fresh Appium session (create -> activate app ->
 * execute steps with per-step evidence -> close session -> write results.json).
 * A fresh session per scenario is intentional even in a multi-scenario batch — every
 * AI-generated scenario starts with {"action":"launchApp"}, and a shared session
 * across scenarios would leave stale app/login state behind, turning that first step
 * into a no-op instead of a clean start.
 */
export async function runOneScenario(
  opts: RunOneScenarioOptions,
  onLog: (line: string) => void
): Promise<RunOneScenarioResult> {
  const scenarioDir = buildEvidenceScenarioDir({
    appSlug: "mobile",
    sectionSlug: opts.sectionSlug,
    scenarioId: opts.evidenceScenarioId,
    scenarioTitle: opts.evidenceScenarioTitle,
    runId: opts.runId
  });
  const screenshotsDir = path.join(scenarioDir, "screenshots");
  fs.mkdirSync(screenshotsDir, { recursive: true });
  onLog(`[mobile:scenario] evidence dir=${scenarioDir}`);

  onLog(`[mobile:scenario] creating appium session apkPath=${opts.apkPath ?? "(none)"} appPackage=${opts.appPackage ?? "(none)"}`);
  const browser = await createSession({
    appiumPort: opts.appiumPort,
    apkPath: opts.apkPath,
    appPackage: opts.appPackage,
    appActivity: opts.appActivity
  });
  onLog("[mobile:scenario] session created");

  // Start each scenario from 0: noReset keeps the app installed, so between scenarios it would
  // otherwise resume wherever the previous one left it (mid-flow, a modal open, etc.). Terminate
  // the app first, then relaunch it fresh from its launch screen. Best-effort; gated by flag.
  if (opts.appPackage) {
    const restartBetweenScenarios = config.integrations.android?.restartAppBetweenScenarios ?? true;
    if (restartBetweenScenarios) {
      try {
        await browser.terminateApp(opts.appPackage);
        onLog(`[mobile:scenario] terminated app package=${opts.appPackage} (fresh start from 0)`);
      } catch (err) {
        onLog(`[mobile:scenario] terminateApp failed (continuing anyway): ${err instanceof Error ? err.message : err}`);
      }
    }
    // Session-creation capabilities (appPackage/appActivity) don't reliably bring the app to the
    // foreground if the activity name is slightly off — explicitly (re)launch it so step execution
    // doesn't silently run against the home screen instead.
    try {
      await browser.activateApp(opts.appPackage);
      onLog(`[mobile:scenario] activated app package=${opts.appPackage}`);
    } catch (err) {
      onLog(`[mobile:scenario] activateApp failed (continuing anyway): ${err instanceof Error ? err.message : err}`);
    }
  }

  const results: MobileStepResult[] = [];
  let failedCount = 0;

  // Knowledge learning: capture the real screen (accessibility tree) after each step so
  // future generations know the actual elements of screens never declared by hand.
  const learningEnabled = (config.integrations.android?.knowledgeLearningEnabled ?? true) && Boolean(opts.appSlug);
  const screensByKey = new Map<string, MobileScreenSnapshot>();
  const executedClickTargets: string[] = [];

  try {
    for (let i = 0; i < opts.steps.length; i++) {
      const step = opts.steps[i];
      const filename = buildScreenshotFilename(i, step.description || step.action);
      const screenshotPath = path.join(screenshotsDir, filename);

      onLog(`[mobile:scenario] step ${i + 1}/${opts.steps.length} action=${step.action} ${step.description ?? ""}`);
      const result = await executeMobileStep(browser, step, i, screenshotPath);
      results.push(result);

      if (result.status === "failed") {
        failedCount++;
        onLog(`[mobile:scenario] step ${i + 1} FAILED: ${result.errorMessage}`);
      } else {
        onLog(`[mobile:scenario] step ${i + 1} passed (${result.durationMs}ms)`);
        if (step.action === "click" && step.target?.value) executedClickTargets.push(step.target.value);
      }

      if (learningEnabled) {
        try {
          const snapshot = extractMobileScreenSnapshot(await browser.getPageSource());
          if (!screensByKey.has(snapshot.screenKey)) screensByKey.set(snapshot.screenKey, snapshot);
        } catch {
          /* snapshot capture is best-effort */
        }
      }
    }
  } finally {
    await closeSession(browser);
    onLog("[mobile:scenario] session closed");
  }

  // Persist observed screens + route so the context grows with each run.
  if (learningEnabled && opts.appSlug) {
    const status: "passed" | "failed" = failedCount === 0 ? "passed" : "failed";
    for (const snapshot of screensByKey.values()) {
      persistMobileScreen(opts.appSlug, snapshot, { issueKey: opts.sourceIssueKey, scenarioTitle: opts.evidenceScenarioTitle, status: failedCount === 0 ? "passed" : "partial" });
    }
    if (executedClickTargets.length > 0) {
      persistMobileRoute(opts.appSlug, executedClickTargets, { issueKey: opts.sourceIssueKey, scenarioTitle: opts.evidenceScenarioTitle, status });
    }
    onLog(`[mobile:knowledge] learned screens=${screensByKey.size} routeTargets=${executedClickTargets.length}`);
  }

  const resultsPath = path.join(scenarioDir, "results.json");
  fs.writeFileSync(
    resultsPath,
    JSON.stringify({ runId: opts.runId, apkPath: opts.apkPath, appPackage: opts.appPackage, results }, null, 2),
    "utf-8"
  );

  // Write the web-schema evidence.json (+ optional per-scenario docx) by reusing the
  // same EvidenceRecorder the web pipeline uses — mobile already produced per-step
  // screenshots, so finish() runs without a Playwright Page. This makes mobile
  // evidence structurally identical to web (evidence.json under the same run layout),
  // which lets RunEvidenceRecorder consolidate it into a run docx afterwards.
  try {
    const recorder = new EvidenceRecorder({
      appSlug: "mobile",
      sectionSlug: opts.sectionSlug,
      scenarioId: opts.evidenceScenarioId,
      scenarioTitle: opts.evidenceScenarioTitle,
      runId: opts.runId
    });
    if (recorder.enabled) {
      await recorder.start();
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const step = opts.steps[i];
        recorder.addStepRecord(r.index, r.description || r.action, {
          target: step?.target?.value,
          status: r.status,
          errorMessage: r.errorMessage,
          screenshotPath: r.screenshotPath
        });
      }
      await recorder.finish();
    }
  } catch (err) {
    onLog(`[mobile:scenario] evidence.json generation failed (continuing): ${err instanceof Error ? err.message : err}`);
  }

  return {
    passed: results.length - failedCount,
    failed: failedCount,
    artifactsDir: scenarioDir,
    results
  };
}

/**
 * Consolidates every scenario's evidence.json under a run into evidence-run.json and a
 * single consolidated evidencia.docx — the mobile mirror of the web pipeline's
 * consolidateRunEvidence(). Reuses RunEvidenceRecorder unmodified; all scenarios must
 * share the same runId so they land under runs/<runId>/scenarios/.
 */
export async function consolidateMobileRunEvidence(
  runId: string,
  sectionSlug: string,
  onLog: (line: string) => void
): Promise<void> {
  const evidenceConfig = loadEvidenceConfig();
  if (!evidenceConfig.enabled || !evidenceConfig.docxEnabled) {
    onLog("[mobile:evidence] run consolidation skipped (evidence or docx disabled)");
    return;
  }

  try {
    const runRecorder = new RunEvidenceRecorder({ appSlug: "mobile", sectionSlug, runId });
    await runRecorder.start();

    const scenariosDir = path.join(evidenceConfig.outputRoot, "mobile", sectionSlug, "runs", runId, "scenarios");
    if (fs.existsSync(scenariosDir)) {
      const scenarioDirs = fs
        .readdirSync(scenariosDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
      for (const sd of scenarioDirs) {
        const evidenceJsonPath = path.join(scenariosDir, sd, "evidence.json");
        if (fs.existsSync(evidenceJsonPath)) {
          await runRecorder.addScenarioFromFile(evidenceJsonPath);
        }
      }
    }

    const record = await runRecorder.finish();
    onLog(`[mobile:evidence] run consolidated docx=${record.docxPath ?? "(none)"} scenarios=${record.scenarios?.length ?? 0}`);
  } catch (err) {
    onLog(`[mobile:evidence] consolidation failed (continuing): ${err instanceof Error ? err.message : err}`);
  }
}

export async function startMobileTestRunJob(jobId: string): Promise<void> {
  const job = jobStore.getInternal(jobId);
  if (!job) return;

  const params = job.params as MobileTestRunParams;
  const onLog = (line: string) => jobStore.appendLog(jobId, line);

  jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });

  const target = resolveMobileTarget(params);

  if (!target.apkPath && !target.appPackage) {
    jobStore.appendLog(jobId, "[mobile:test] Error: either apkPath or appPackage is required");
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: "Either apkPath or appPackage is required"
    });
    return;
  }

  if (!params.steps || params.steps.length === 0) {
    jobStore.appendLog(jobId, "[mobile:test] Error: no steps provided");
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: "No steps provided"
    });
    return;
  }

  try {
    await ensureMobileInfra(target, onLog);

    // Use the jobId as the evidence runId so the consolidated docx lands under
    // runs/<jobId>/ where GET /api/runs/:jobId/evidence-docx can find it.
    const runId = jobId;
    const sectionSlug = target.appPackage?.replace(/[^a-zA-Z0-9_-]/g, "_") || "android";

    const stepsToRun = applyDataOverrides(params.steps, params.dataOverrides, params.requiredData);
    if (params.dataOverrides && Object.keys(params.dataOverrides).length > 0) {
      onLog(`[mobile:test] applied ${Object.keys(params.dataOverrides).length} data override(s)`);
    }

    const { passed, failed, artifactsDir } = await runOneScenario(
      {
        appiumPort: target.appiumPort,
        apkPath: target.apkPath,
        appPackage: target.appPackage,
        appActivity: target.appActivity,
        steps: stepsToRun,
        evidenceScenarioId: "mobile-test",
        evidenceScenarioTitle: "Mobile test run",
        runId,
        sectionSlug,
        appSlug: params.appSlug
      },
      onLog
    );

    await consolidateMobileRunEvidence(runId, sectionSlug, onLog);

    const status = failed === 0 ? "done" : "completed_with_failures";
    jobStore.update(jobId, {
      status,
      completedAt: new Date().toISOString(),
      summary: {
        totalStories: 1,
        synced: 0,
        passed,
        failed,
        artifactsDir
      }
    });
    onLog(`[mobile:test] finished status=${status} passed=${passed} failed=${failed} evidence=${artifactsDir}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onLog(`[mobile:test] failed: ${message}`);
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: message
    });
  }
}
