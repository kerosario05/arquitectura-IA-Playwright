import * as fs from "node:fs";
import * as path from "node:path";
import { jobStore } from "./job-store";
import { config } from "../../config/env";
import {
  getStatus as getEmulatorStatus,
  startEmulator,
  waitForBoot,
  probeAdbHealth,
} from "../../mobile/emulator-manager";
import {
  type AppiumTraceChunkHandler,
  getStatus as getAppiumStatus,
  resolveAppiumStartTimeoutMs,
  startAppiumServer,
  waitForReady as waitForAppiumReady
} from "../../mobile/appium-server-manager";
import {
  closeSession,
  createSession,
} from "../../mobile/appium-session";
import {
  acquireSession,
  releaseSessionLock,
  __getCoordinatorStatsForTesting,
  __getCoordinatorLockForTesting,
  __setDeleteSessionFnForTesting as __setCoordinatorDeleteFn,
  __resetCoordinatorForTesting,
} from "../../mobile/appium-session-coordinator";
import { executeMobileStep } from "../../mobile/mobile-step-executor";
import { buildEvidenceScenarioDir, buildScreenshotFilename } from "../../evidence/evidence-paths";
import { EvidenceRecorder } from "../../evidence/evidence-recorder";
import { RunEvidenceRecorder } from "../../evidence/run-evidence-recorder";
import { loadEvidenceConfig } from "../../evidence/evidence-types";
import { applyDataOverrides, type MobileStep, type MobileStepResult, type MobileDataField } from "../../mobile/mobile-step-types";
import { extractMobileScreenSnapshot, type MobileScreenSnapshot } from "../../mobile/mobile-knowledge-extractor";
import { persistMobileScreen, persistMobileRoute } from "../../mobile/mobile-knowledge-persister";
import { extractObservedDestination } from "../../mobile/mobile-observed-destination";
import { buildBindingCandidate, canCreateBindingCandidate } from "../../mobile/mobile-destination-binding";
import { loadMobileRouteProfile } from "../../mobile/mobile-route-profile";
import { evaluateScenarioPrecheck, resolveMobileExecutionSignals } from "../../mobile/mobile-execution-precheck";
import { getProjectConfigurationBySlug } from "../../db/project-reader";
export { evaluateScenarioPrecheck, type ScenarioPrecheckResult } from "../../mobile/mobile-execution-precheck";
import { dismissAndroidCompatibilityDialog } from "../../mobile/mobile-modal-dismisser";
import { buildTextVariants } from "../../mobile/mobile-text-normalization";
import { createMobileJobLogger } from "./mobile-job-logger";

let createSessionFn: typeof createSession = createSession;
let closeSessionFn: typeof closeSession = closeSession;
let executeMobileStepFn: typeof executeMobileStep = executeMobileStep;

export function __setCreateSessionForTesting(fn: typeof createSession): void {
  createSessionFn = fn;
}
export function __resetCreateSessionForTesting(): void {
  createSessionFn = createSession;
}
export function __setCloseSessionForTesting(fn: typeof closeSession): void {
  closeSessionFn = fn;
}
export function __resetCloseSessionForTesting(): void {
  closeSessionFn = closeSession;
}
export function __setExecuteMobileStepForTesting(fn: typeof executeMobileStep): void {
  executeMobileStepFn = fn;
}
export function __resetExecuteMobileStepForTesting(): void {
  executeMobileStepFn = executeMobileStep;
}

// Coordinator test seams — re-exported so tests can inject fakes without importing the coordinator.
export { __setCoordinatorDeleteFn, __resetCoordinatorForTesting };
export { __getCoordinatorStatsForTesting, __getCoordinatorLockForTesting };

export type MobileTestRunParams = {
  avdName?: string;
  headless?: boolean;
  apkPath?: string;
  appPackage?: string;
  appActivity?: string;
  systemPort?: number;
  steps: MobileStep[];
  /** User-supplied real values, keyed by { stepIndex: value }. */
  dataOverrides?: Record<number, string>;
  /** Data-field metadata so select overrides can be re-targeted (optional). */
  requiredData?: MobileDataField[];
  /** Route-profile app slug; if set, enables knowledge learning for this run. */
  appSlug?: string;
  /** Step-level requirement refs from the scenario, to propagate into runtime transitions. */
  stepRequirementRefs?: Array<{ stepIndex: number; requirementIds: string[] }>;
};

export type ResolvedMobileTarget = {
  avdName: string;
  headless: boolean;
  bootTimeoutMs: number;
  appiumPort: number;
  systemPort: number;
  apkPath?: string;
  apkPathSource?: "payload" | "env.ANDROID_APK_PATH";
  appPackage?: string;
  appActivity?: string;
};

export type EmulatorOwnership = "runner" | "external_reused";

export type MobileInfraReadyState = {
  deviceId?: string;
  emulatorStartedByRunner: boolean;
  ownership: EmulatorOwnership;
  ownershipReason: "already_running_reused" | "start_result_reused" | "started_by_runner";
};

export function determineEmulatorOwnership(input: "already_running" | { reused: boolean; external: boolean }): MobileInfraReadyState {
  if (input === "already_running") {
    return {
      emulatorStartedByRunner: false,
      ownership: "external_reused",
      ownershipReason: "already_running_reused",
    };
  }
  if (!input.reused && !input.external) {
    return {
      emulatorStartedByRunner: true,
      ownership: "runner",
      ownershipReason: "started_by_runner",
    };
  }
  return {
    emulatorStartedByRunner: false,
    ownership: "external_reused",
    ownershipReason: "start_result_reused",
  };
}

export type MobileTargetValidationReasonCode =
  | "mobile_apk_not_found"
  | "mobile_apk_not_accessible"
  | "mobile_app_configuration_missing";

export class MobileTargetValidationError extends Error {
  readonly reasonCode: MobileTargetValidationReasonCode;
  readonly apkPath?: string;
  readonly permanent = true;

  constructor(reasonCode: MobileTargetValidationReasonCode, message: string, apkPath?: string) {
    super(message);
    this.name = "MobileTargetValidationError";
    this.reasonCode = reasonCode;
    this.apkPath = apkPath;
  }
}

function hasUnexpandedExpression(input: string): boolean {
  return /\$env:[A-Za-z_][A-Za-z0-9_]*/i.test(input) ||
    /%[A-Za-z_][A-Za-z0-9_]*%/.test(input) ||
    /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(input);
}

export function validateResolvedMobileTarget(
  target: ResolvedMobileTarget,
  fsOps: Pick<typeof fs, "existsSync" | "statSync" | "accessSync"> = fs,
): ResolvedMobileTarget {
  const nextTarget: ResolvedMobileTarget = { ...target };
  const configuredApk = target.apkPath?.trim();
  const appPackage = target.appPackage?.trim();

  if (!configuredApk && !appPackage) {
    throw new MobileTargetValidationError(
      "mobile_app_configuration_missing",
      "Either apkPath or appPackage is required",
    );
  }

  if (!configuredApk) {
    nextTarget.apkPath = undefined;
    return nextTarget;
  }

  if (hasUnexpandedExpression(configuredApk)) {
    throw new MobileTargetValidationError(
      "mobile_apk_not_accessible",
      `APK path contains an unexpanded environment expression: ${configuredApk}`,
      configuredApk,
    );
  }

  if (!path.isAbsolute(configuredApk)) {
    throw new MobileTargetValidationError(
      "mobile_apk_not_accessible",
      `APK path must be absolute: ${configuredApk}`,
      configuredApk,
    );
  }

  const resolvedApkPath = path.resolve(configuredApk);
  if (!resolvedApkPath.toLowerCase().endsWith(".apk")) {
    throw new MobileTargetValidationError(
      "mobile_apk_not_accessible",
      `APK path must end with .apk: ${resolvedApkPath}`,
      resolvedApkPath,
    );
  }

  if (!fsOps.existsSync(resolvedApkPath)) {
    throw new MobileTargetValidationError(
      "mobile_apk_not_found",
      `APK file not found at path: ${resolvedApkPath}`,
      resolvedApkPath,
    );
  }

  let stat: fs.Stats;
  try {
    stat = fsOps.statSync(resolvedApkPath);
  } catch {
    throw new MobileTargetValidationError(
      "mobile_apk_not_accessible",
      `APK file is not accessible at path: ${resolvedApkPath}`,
      resolvedApkPath,
    );
  }

  if (!stat.isFile()) {
    throw new MobileTargetValidationError(
      "mobile_apk_not_accessible",
      `APK path does not point to a file: ${resolvedApkPath}`,
      resolvedApkPath,
    );
  }

  try {
    fsOps.accessSync(resolvedApkPath, fs.constants.R_OK);
  } catch {
    throw new MobileTargetValidationError(
      "mobile_apk_not_accessible",
      `APK file is not readable: ${resolvedApkPath}`,
      resolvedApkPath,
    );
  }

  nextTarget.apkPath = resolvedApkPath;
  return nextTarget;
}

function resolveAppProfileDefaults(appSlug?: string): { appPackage?: string; appActivity?: string } {
  const normalizedSlug = appSlug?.trim();
  if (!normalizedSlug) return {};
  const profile = loadMobileRouteProfile(normalizedSlug);
  if (!profile) return {};
  return {
    appPackage: profile.packageName?.trim() || undefined,
    appActivity: profile.mainActivity?.trim() || undefined,
  };
}

export function resolveMobileTarget(params: {
  avdName?: string;
  headless?: boolean;
  appSlug?: string;
  apkPath?: string;
  appPackage?: string;
  appActivity?: string;
  systemPort?: number;
  /** Resolved from SQL MobileProjectConfiguration.packageName by the async caller. */
  sqlPackageName?: string;
}): ResolvedMobileTarget {
  const appProfileDefaults = resolveAppProfileDefaults(params.appSlug);
  const avdName = params.avdName?.trim() || config.integrations.android?.avdName;
  const requestApkPath = params.apkPath?.trim() || undefined;
  const envApkPath = config.integrations.android?.apkPath;
  if (!avdName) {
    throw new Error(
      "Missing Android AVD name. Provide avdName in request payload or configure ANDROID_AVD_NAME."
    );
  }

  return {
    avdName,
    headless: params.headless ?? config.integrations.android?.headless ?? true,
    bootTimeoutMs: config.integrations.android?.bootTimeoutMs ?? 120000,
    appiumPort: config.integrations.android?.appiumPort ?? 4723,
    systemPort: params.systemPort
      ?? config.integrations.android?.systemPort
      ?? 8200,
    apkPath: requestApkPath || envApkPath,
    apkPathSource: requestApkPath ? "payload" : (envApkPath ? "env.ANDROID_APK_PATH" : undefined),
    appPackage: params.appPackage?.trim() || config.integrations.android?.appPackage || appProfileDefaults.appPackage || params.sqlPackageName?.trim() || undefined,
    appActivity: params.appActivity?.trim() || config.integrations.android?.appActivity || appProfileDefaults.appActivity
  };
}

/**
 * Boots the emulator and Appium server if they aren't already running/ready. Safe to
 * call once per job even when the job executes multiple scenarios — reuses whatever
 * is already up instead of re-booting per scenario.
 */
export async function ensureMobileInfra(
  target: Pick<ResolvedMobileTarget, "avdName" | "headless" | "bootTimeoutMs" | "appiumPort" | "systemPort">,
  onLog: (line: string) => void,
  context?: { runId?: string; traceAppiumChunk?: AppiumTraceChunkHandler },
): Promise<MobileInfraReadyState> {
  const runId = context?.runId ?? "n/a";
  const emulatorStatus = getEmulatorStatus();
  let ownership = determineEmulatorOwnership("already_running");
  let appiumSource: "started" | "reused" = "reused";
  const appiumStartedAt = Date.now();
  if (!emulatorStatus.running) {
    onLog(`[mobile:infra] emulator not running, starting avd=${target.avdName}`);
    const started = await startEmulator(target.avdName, { headless: target.headless }, onLog);
    ownership = determineEmulatorOwnership(started);
    onLog(`[mobile:infra] emulator start result reused=${started.reused} external=${started.external} pid=${started.pid ?? "external"} deviceId=${started.deviceId ?? "pending"}`);
    await waitForBoot(target.bootTimeoutMs, onLog);
  } else {
    ownership = determineEmulatorOwnership("already_running");
    onLog(`[mobile:infra] emulator already running status=${emulatorStatus.status} deviceId=${emulatorStatus.deviceId ?? "unknown"}, reusing`);
    if (!emulatorStatus.bootCompleted) {
      await waitForBoot(target.bootTimeoutMs, onLog);
    }
  }

  const appiumStatus = getAppiumStatus();
  const appiumStartTimeoutMs = resolveAppiumStartTimeoutMs();
  if (!appiumStatus.ready) {
    appiumSource = "started";
    onLog(`[mobile:infra] appium server not ready, starting on port=${target.appiumPort} timeoutMs=${appiumStartTimeoutMs}`);
    const started = await startAppiumServer(target.appiumPort, onLog, {
      onTraceChunk: context?.traceAppiumChunk,
    });
    onLog(`[mobile:infra] appium start result reused=${started.reused} external=${started.external} pid=${started.pid ?? "external"}`);
    await waitForAppiumReady(appiumStartTimeoutMs, onLog);
  } else {
    onLog(`[mobile:infra] appium server already ready status=${appiumStatus.status}, reusing`);
  }

  // ADB preflight: verify shell and settings service are reachable before the first POST /session.
  // A Broken-pipe or unresponsive settings service here means the emulator bridge is unhealthy;
  // stop early so no scenario attempts a session and no functional defects are created.
  const emulatorDeviceId = getEmulatorStatus().deviceId;
  const adbHealth = await probeAdbHealth(emulatorDeviceId);
  if (!adbHealth.healthy) {
    throw new Error(
      `mobile_adb_unhealthy: stage=${adbHealth.stage} reason=${adbHealth.reason} deviceId=${adbHealth.deviceId ?? "unknown"}`,
    );
  }
  const emulatorOwnership = getEmulatorStatus();
  const resolvedDeviceId = adbHealth.deviceId ?? emulatorOwnership.deviceId;
  const readyState: MobileInfraReadyState = {
    deviceId: resolvedDeviceId,
    emulatorStartedByRunner: ownership.emulatorStartedByRunner,
    ownership: ownership.ownership,
    ownershipReason: ownership.ownershipReason,
  };
  onLog(`[mobile:infra] appium status=ready source=${appiumSource} startupMs=${Date.now() - appiumStartedAt}`);
  onLog(`[mobile:infra] adb status=ready deviceId=${adbHealth.deviceId ?? "unknown"} systemPort=${target.systemPort}`);
  onLog(
    `[mobile:infra] emulator status=ready runId=${runId} deviceId=${resolvedDeviceId ?? "unknown"} emulatorStartedByRunner=${readyState.emulatorStartedByRunner} ownership=${readyState.ownership} reason=${readyState.ownershipReason} trackedExternal=${emulatorOwnership.external}`,
  );
  return readyState;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/([A-Za-z0-9_]*(?:password|token|secret|apikey)[A-Za-z0-9_]*)\s*[:=]\s*([^\s]+)/gi, "$1=[redacted]")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractAttributeValues(pageSource: string, attribute: string, max = 40): string[] {
  const values: string[] = [];
  const re = new RegExp(`${escapeRegex(attribute)}="([^"]+)"`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(pageSource)) !== null) {
    const next = sanitizeDiagnosticText(match[1] || "");
    if (!next) continue;
    if (!values.includes(next)) values.push(next);
    if (values.length >= max) break;
  }
  return values;
}

function looksLikeNavigationGateFailure(step: MobileStep, errorMessage?: string): boolean {
  if (!["click", "fill", "assertVisible", "waitFor", "assertEnabled"].includes(step.action)) return false;
  const normalized = (errorMessage || "").toLowerCase();
  return normalized.includes("target not found")
    || normalized.includes("no such element")
    || normalized.includes("could not be located")
    || normalized.includes("transition_not_reached")
    || normalized.includes("target_disabled")
    || normalized.includes("expected element to be visible")
    || normalized.includes("expected element to be present and enabled")
    || normalized.includes("data_precondition_failure");
}

/**
 * Detects an unequivocal loss of the WebDriver session / Appium channel / device.
 * Only unmistakable signals are matched so that ordinary automation failures
 * (e.g. target_not_found, no such element) are never aborted as infra loss.
 */
function looksLikeMobileSessionOrDeviceLost(errorMessage?: string): boolean {
  const message = (errorMessage || "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("session is either terminated or not started")
    || message.includes("invalid session id")
    || message.includes("session deleted")
    || message.includes("session not created")
    || message.includes("new session could not be created")
    || message.includes("no connected devices")
    || message.includes("device offline")
    || message.includes("session not started")
    // adb/device-specific "device '<...>' not found" (never the generic "not found").
    || /device\s+'[^']*'\s+not found/u.test(message)
    || message.includes("emulator") && message.includes("not found")
  );
}

function derivePrimaryFailureReasonCode(step: MobileStep, currentReasonCode: string, errorMessage?: string): string {
  if (
    currentReasonCode === "data_precondition_failure"
    || currentReasonCode === "non_executable_precondition"
    || currentReasonCode === "transition_not_reached"
    || currentReasonCode === "mobile_automation_channel_lost"
    || currentReasonCode === "mobile_text_encoding_invalid"
  ) {
    return currentReasonCode;
  }
  const normalized = (errorMessage || "").toLowerCase();
  if (
    (step.action === "assertVisible" || step.action === "waitFor")
    && (
      currentReasonCode === "target_not_found"
      || currentReasonCode === "step_execution_failed"
      || normalized.includes("expected element to be visible")
      || normalized.includes("waitfor target not found")
    )
  ) {
    return "transition_not_reached";
  }
  if (currentReasonCode === "target_not_found" || currentReasonCode === "target_disabled") {
    return currentReasonCode;
  }
  return "navigation_dependency_primary_failure";
}

function buildHierarchyFingerprint(pageSource: string): string {
  const text = extractAttributeValues(pageSource, "text", 25);
  const contentDesc = extractAttributeValues(pageSource, "content-desc", 25);
  const resourceIds = extractAttributeValues(pageSource, "resource-id", 25);
  const classes = extractAttributeValues(pageSource, "class", 25);
  const checkedCount = (pageSource.match(/checked="true"/g) ?? []).length;
  const selectedCount = (pageSource.match(/selected="true"/g) ?? []).length;
  return JSON.stringify({
    text,
    contentDesc,
    resourceIds,
    classes,
    checkedCount,
    selectedCount,
  });
}

function hierarchyContainsAnyVariant(pageSource: string, rawValue: string | undefined): boolean {
  const value = rawValue?.trim();
  if (!value) return false;
  for (const variant of buildTextVariants(value)) {
    if (!variant.trim()) continue;
    if (pageSource.includes(`text="${variant}"`) || pageSource.includes(`content-desc="${variant}"`) || pageSource.includes(`resource-id="${variant}"`)) {
      return true;
    }
  }
  return false;
}

function resolveTransitionSignalMatch(pageSource: string, signals: MobileExecutionSignals): string | undefined {
  const normalizedPage = normalizeSignalToken(pageSource);
  const groups: Array<{ name: string; values: string[] }> = [
    { name: "expectedScreenReached", values: signals.successSignals },
    { name: "knownAlternativeScreen", values: signals.rejectionSignals },
    { name: "validationMessage", values: signals.validationSignals },
    { name: "terminalError", values: signals.technicalErrorSignals },
  ];
  for (const group of groups) {
    for (const token of group.values) {
      if (normalizedPage.includes(normalizeSignalToken(token))) {
        return group.name;
      }
    }
  }
  return undefined;
}

async function assessClickTransitionOutcome(
  browser: WebdriverIO.Browser,
  step: MobileStep,
  nextStep: MobileStep | undefined,
  previousPageSource: string | undefined,
  executionSignals: MobileExecutionSignals,
  timeoutMs: number,
): Promise<{ reached: boolean; reason?: string }> {
  if (step.action !== "click") return { reached: true };
  const startedAt = Date.now();
  const requiredNextTargetValue = step.requiredNextTarget?.value ?? nextStep?.target?.value;
  const beforeFingerprint = previousPageSource ? buildHierarchyFingerprint(previousPageSource) : "";
  const beforeSelectedCount = (previousPageSource?.match(/selected="true"/g) ?? []).length;
  const beforeCheckedCount = (previousPageSource?.match(/checked="true"/g) ?? []).length;
  while (Date.now() - startedAt < timeoutMs) {
    const currentPageSource = await browser.getPageSource().catch(() => "");
    const signalMatch = resolveTransitionSignalMatch(currentPageSource, executionSignals);
    if (signalMatch === "expectedScreenReached" || signalMatch === "knownAlternativeScreen" || signalMatch === "validationMessage") {
      return { reached: true };
    }
    if (signalMatch === "terminalError") {
      return { reached: false, reason: "transition_not_reached: terminalError" };
    }
    const changedFingerprint = beforeFingerprint && buildHierarchyFingerprint(currentPageSource) !== beforeFingerprint;
    const nextTargetVisible = hierarchyContainsAnyVariant(currentPageSource, requiredNextTargetValue);
    const selectedCount = (currentPageSource.match(/selected="true"/g) ?? []).length;
    const checkedCount = (currentPageSource.match(/checked="true"/g) ?? []).length;
    const selectionChanged = selectedCount !== beforeSelectedCount || checkedCount !== beforeCheckedCount;
    const targetStillVisible = hierarchyContainsAnyVariant(currentPageSource, step.target?.value);

    if (step.expectedState === "selector_open" || step.actionRole === "open_selector") {
      if (changedFingerprint || targetStillVisible || selectionChanged) {
        return { reached: true };
      }
      await delay(200);
      continue;
    }

    if (step.expectedState === "option_selected" || step.actionRole === "select_option") {
      const selectorClosed = !targetStillVisible;
      if (nextTargetVisible || selectionChanged || (changedFingerprint && selectorClosed)) {
        return { reached: true };
      }
      await delay(200);
      continue;
    }

    if (changedFingerprint || nextTargetVisible) {
      return { reached: true };
    }
    await delay(200);
  }
  return { reached: false, reason: "transition_not_reached: transitionTimeout" };
}

async function captureNavigationFailureDiagnostics(
    browser: WebdriverIO.Browser,
    scenarioDir: string,
    step: MobileStep,
    stepIndex: number,
    elapsedSinceLaunchMs: number,
    onLog: (line: string) => void,
): Promise<{ diagnosticsPath?: string; defectEligible: boolean }> {
    const diagnosticsDir = path.join(scenarioDir, "diagnostics");
    fs.mkdirSync(diagnosticsDir, { recursive: true });
    const pageSourceRaw = await browser.getPageSource().catch(() => "");
    const pageSource = sanitizeDiagnosticText(pageSourceRaw);
    const visibleTexts = extractAttributeValues(pageSource, "text", 40);
    const accessibilityIds = extractAttributeValues(pageSource, "content-desc", 40);
    const resourceIds = extractAttributeValues(pageSource, "resource-id", 40);
    const classNames = extractAttributeValues(pageSource, "class", 25);
    const targetValue = step.target?.value?.trim() || "";
    const hasAccessibilityMatch = !!targetValue && accessibilityIds.includes(targetValue);
    const hasResourceIdMatch = !!targetValue && resourceIds.includes(targetValue);
    const hasVisibleTextMatch = !!targetValue && visibleTexts.includes(targetValue);
    const modalLikely = /permissioncontroller|allow|permitir|android:id\/button1|alertdialog|dialog/i.test(pageSource);

    const browserWithAndroid = browser as WebdriverIO.Browser & {
      getCurrentActivity?: () => Promise<string>;
      getCurrentPackage?: () => Promise<string>;
    };
    const currentActivity = typeof browserWithAndroid.getCurrentActivity === "function"
      ? sanitizeDiagnosticText(await browserWithAndroid.getCurrentActivity().catch(() => ""))
      : undefined;
    const currentPackage = typeof browserWithAndroid.getCurrentPackage === "function"
      ? sanitizeDiagnosticText(await browserWithAndroid.getCurrentPackage().catch(() => ""))
      : undefined;

    let recommendedSelector: string = "none";
    if (hasAccessibilityMatch) recommendedSelector = "accessibilityId";
    else if (hasResourceIdMatch) recommendedSelector = "id";
    else if (hasVisibleTextMatch && classNames.length > 0) recommendedSelector = "class+text";
    else if (hasVisibleTextMatch) recommendedSelector = "text";

    const diagnostics = {
      stepIndex,
      action: step.action,
      target: step.target,
      elapsedSinceLaunchMs,
      currentPackage,
      currentActivity,
      modalLikely,
      targetExistsAsAccessibilityId: hasAccessibilityMatch,
      targetExistsAsResourceId: hasResourceIdMatch,
      targetExistsAsVisibleText: hasVisibleTextMatch,
      selectorRecommendation: recommendedSelector,
      sampleVisibleTexts: visibleTexts.slice(0, 20),
      sampleAccessibilityIds: accessibilityIds.slice(0, 20),
      sampleResourceIds: resourceIds.slice(0, 20),
      sampleClassNames: classNames.slice(0, 20),
      pageSourcePreview: pageSource.slice(0, 8000),
    };

    const diagnosticsPath = path.join(diagnosticsDir, `step-${stepIndex + 1}-selector-diagnostics.json`);
    fs.writeFileSync(diagnosticsPath, JSON.stringify(diagnostics, null, 2), "utf-8");
    onLog(
      `[mobile:diagnostics] step=${stepIndex + 1} selectorHierarchy accessibilityId=${hasAccessibilityMatch} resourceId=${hasResourceIdMatch} visibleText=${hasVisibleTextMatch} modalLikely=${modalLikely} elapsedSinceLaunchMs=${elapsedSinceLaunchMs} file=${diagnosticsPath}`,
    );

    // Only consider it defect-eligible when evidence says the exact target should exist on the
    // current screen and no blocking modal/perms are suspected.
    const defectEligible = hasAccessibilityMatch && !modalLikely;
    return { diagnosticsPath, defectEligible };
  }

  async function createSessionWithControlledRetry(
    opts: Pick<RunOneScenarioOptions, "runId" | "evidenceScenarioId" | "appiumPort" | "apkPath" | "appPackage" | "appActivity" | "deviceId" | "systemPort" | "emulatorStartedByRunner">,
    onLog: (line: string) => void,
  ): Promise<{ browser: WebdriverIO.Browser; lockKey: string; lockOwner: string }> {
    const appiumHost = process.env.APPIUM_SERVER_HOST?.trim() || "127.0.0.1";
    const emulatorDeviceId = opts.deviceId || getEmulatorStatus().deviceId || `${appiumHost}:${opts.appiumPort}`;
    const owner = `${opts.runId}:${opts.evidenceScenarioId}`;

    onLog(`[mobile:session] acquiring exclusive session lock deviceId=${emulatorDeviceId} owner=${owner}`);

    const handle = await acquireSession({
      runId: opts.runId,
      lockOwner: owner,
      deviceId: emulatorDeviceId,
      systemPort: opts.systemPort,
      appiumHost,
      appiumPort: opts.appiumPort,
      factory: () =>
        createSessionFn({
          appiumPort: opts.appiumPort,
          apkPath: opts.apkPath,
          appPackage: opts.appPackage,
          appActivity: opts.appActivity,
          deviceId: emulatorDeviceId,
          systemPort: opts.systemPort,
          maxSessionAttempts: 1,
        }),
      emulatorStartedByRunner: opts.emulatorStartedByRunner,
      canRetry: async () => {
        const appiumStatus = getAppiumStatus();
        const emulatorStatus = getEmulatorStatus();
        const appiumReady = appiumStatus.ready === true;
        const emulatorReady = emulatorStatus.running && emulatorStatus.bootCompleted;
        if (!appiumReady || !emulatorReady) {
          return {
            allowed: false,
            reason: `infra_unhealthy appiumReady=${appiumReady} emulatorReady=${emulatorReady} deviceId=${emulatorStatus.deviceId ?? "unknown"}`,
          };
        }
        return { allowed: true, reason: "infra_healthy" };
      },
      onLog,
    });

    onLog(`[mobile:session] coordinator returned browser deviceId=${emulatorDeviceId} systemPort=${opts.systemPort}`);
    return {
      browser: handle.browser,
      lockKey: handle.lockKey,
      lockOwner: owner,
    };
  }

  function mapMobileStepFailureReasonCode(errorMessage: string): string {
    const normalized = errorMessage.toLowerCase();
    if (normalized.includes("mobile_automation_channel_lost")) return "mobile_automation_channel_lost";
    if (normalized.includes("mobile_text_encoding_invalid")) return "mobile_text_encoding_invalid";
    if (normalized.includes("non_executable_precondition")) return "non_executable_precondition";
    if (normalized.includes("data_precondition_failure")) return "data_precondition_failure";
    if (normalized.includes("target not found") || normalized.includes("no such element") || normalized.includes("could not be located")) {
      return "target_not_found";
    }
    if (normalized.includes("target_disabled")) return "target_disabled";
    if (normalized.includes("timed out") || normalized.includes("timeout")) return "step_timeout";
    const otpReason = /otp_[a-z0-9_]+/.exec(normalized);
    if (otpReason) return otpReason[0];
    return "step_execution_failed";
  }

function normalizeSignalToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export type RunOneScenarioOptions = {
  appiumPort: number;
  systemPort: number;
  deviceId?: string;
  emulatorStartedByRunner?: boolean;
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
  /** Runtime data for OTP identity resolution: maps identityField -> stepIndex and supplies override values. */
  requiredData?: MobileDataField[];
  dataOverrides?: Record<number, string>;
  /** Step-level requirement refs from the scenario, to propagate into runtime transitions. */
  stepRequirementRefs?: Array<{ stepIndex: number; requirementIds: string[] }>;
};

export type RunOneScenarioResult = {
  passed: number;
  failed: number;
  blocked?: number;
  artifactsDir: string;
  results: MobileStepResult[];
  blockedReasonCode?: string;
  blockedDetail?: string;
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
  onLog(`[mobile:scenario] started scenarioId=${opts.evidenceScenarioId} title="${opts.evidenceScenarioTitle}" steps=${opts.steps.length}`);
  onLog(`[mobile:scenario] evidence dir=${scenarioDir}`);

  const scenarioPrecheck = evaluateScenarioPrecheck(opts.steps, opts.appSlug);
  if (scenarioPrecheck.blocked) {
    const results: MobileStepResult[] = [];
    for (let i = 0; i < opts.steps.length; i++) {
      const step = opts.steps[i];
      results.push({
        index: i,
        action: step.action,
        description: step.description,
        status: "skipped_dependency_failed",
        reasonCode: i === 0 ? "non_executable_precondition" : "skipped_due_to_prior_failure",
        primaryCauseStepIndex: 0,
        errorMessage: i === 0
          ? `non_executable_precondition: ${scenarioPrecheck.detail}`
          : "skipped_due_to_prior_failure: blocked by non_executable_precondition",
        durationMs: 0,
      });
    }
    onLog(`[mobile:scenario] blocked reasonCode=${scenarioPrecheck.reasonCode} detail=${scenarioPrecheck.detail} stage=pre_session`);
    return {
      passed: 0,
      failed: 0,
      blocked: 1,
      artifactsDir: scenarioDir,
      results,
      blockedReasonCode: scenarioPrecheck.reasonCode,
      blockedDetail: scenarioPrecheck.detail,
    };
  }

  onLog(`[mobile:scenario] creating appium session apkPath=${opts.apkPath ?? "(none)"} appPackage=${opts.appPackage ?? "(none)"}`);
  const sessionHandle = await createSessionWithControlledRetry(
    {
      runId: opts.runId,
      appiumPort: opts.appiumPort,
      systemPort: opts.systemPort,
      deviceId: opts.deviceId,
      emulatorStartedByRunner: opts.emulatorStartedByRunner,
      apkPath: opts.apkPath,
      appPackage: opts.appPackage,
      appActivity: opts.appActivity,
      evidenceScenarioId: opts.evidenceScenarioId,
    },
    onLog,
  );
  const browser = sessionHandle.browser;
  onLog("[mobile:session] create completed");

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
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`mobile_app_activation_not_completed: ${message}`);
    }

    // After activation, the Android OS may show a system compatibility-warning dialog
    // (app compiled with older page-size). Dismiss it generically (OK button) before
    // starting steps — this dialog is system-owned, not a functional app modal.
    const compatDismissed = await dismissAndroidCompatibilityDialog(browser, onLog);
    if (compatDismissed) {
      onLog(`[mobile:scenario] dismissed Android system compatibility dialog before first step`);
    }
  }

  const results: MobileStepResult[] = [];
  let failedCount = 0;
  let passedCount = 0;
  const scenarioStartedAt = Date.now();
  let launchStepCompletedAtMs: number | undefined;
  let primaryDependencyFailure:
    | {
      stepIndex: number;
      reasonCode: string;
      message: string;
    }
    | undefined;

  // Knowledge learning: capture the real screen (accessibility tree) after each step so
  // future generations know the actual elements of screens never declared by hand.
  const learningEnabled = (config.integrations.android?.knowledgeLearningEnabled ?? true) && Boolean(opts.appSlug);
  const screensByKey = new Map<string, MobileScreenSnapshot>();
  const executedClickTargets: string[] = [];
  const observedTransitions: Array<{
    stepIndex?: number;
    action: string;
    actionTarget: { strategy: string; value: string };
    screenBefore: string;
    screenAfter: string;
    controlPackage?: string;
    controlResourceId?: string;
    controlContentDesc?: string;
    actionLocatorIdentity?: string;
  }> = [];
  let skippedByDependencyCount = 0;
  const executionSignals = resolveMobileExecutionSignals(opts.appSlug);

  try {
    for (let i = 0; i < opts.steps.length; i++) {
      const step = opts.steps[i];
      if (primaryDependencyFailure) {
        skippedByDependencyCount++;
        const skipReason = "skipped_due_to_prior_failure";
        results.push({
          index: i,
          action: step.action,
          description: step.description,
          status: "skipped_dependency_failed",
          reasonCode: skipReason,
          primaryCauseStepIndex: primaryDependencyFailure.stepIndex,
          errorMessage: `${skipReason}: blocked by step ${primaryDependencyFailure.stepIndex + 1} (${primaryDependencyFailure.reasonCode})`,
          durationMs: 0,
        });
        continue;
      }

      const filename = buildScreenshotFilename(i, step.description || step.action);
      const screenshotPath = path.join(screenshotsDir, filename);
      let preStepPageSource = step.action === "click"
        ? await browser.getPageSource().catch(() => "")
        : undefined;
      // Structural screen fingerprint BEFORE the click (only when we have a usable page source).
      // A transition is only valid when the before/after screens have real observed content.
      let screenBeforeFingerprint: string | undefined;
      let screenBeforeHasContent = false;
      if (step.action === "click") {
        const expectedPkg = opts.appPackage?.trim();
        const deadline = Date.now() + Math.min(step.timeoutMs ?? 10000, 10000);
        let polls = 0;
        while (Date.now() < deadline) {
          try {
            if (!preStepPageSource || preStepPageSource.trim().length === 0) { polls++; await new Promise((r) => setTimeout(r, 500)); preStepPageSource = await browser.getPageSource().catch(() => ""); continue; }
            const snap = extractMobileScreenSnapshot(preStepPageSource);
            // Snapshot is usable ONLY when there are explicit app-owned controls:
            // at least one observedControl with package === expectedAppPackage.
            // dominantPackage alone is NOT enough (undefined/ambiguous/tie → not owned).
            const hasAppOwnedControl = expectedPkg
              ? snap.observedControls.some((c) => c.package === expectedPkg)
              : false;
            if (hasAppOwnedControl) {
              screenBeforeFingerprint = snap.fingerprint;
              screenBeforeHasContent = true;
              break;
            }
          } catch { /* snapshot failed, continue polling */ }
          polls++;
          await new Promise((r) => setTimeout(r, 500));
          preStepPageSource = await browser.getPageSource().catch(() => "");
        }
        if (!screenBeforeHasContent && polls > 0) {
          onLog(`[mobile:before-snapshot] polls=${polls} usable=false reason=no_usable_content`);
        }
      }

      onLog(`[mobile:scenario] step=${i + 1}/${opts.steps.length} action=${step.action} status=started description="${step.description ?? step.action}"`);
      const result = await executeMobileStepFn(browser, step, i, screenshotPath, {
        appSlug: opts.appSlug,
        requiredData: opts.requiredData,
        dataOverrides: opts.dataOverrides,
      });
      if (result.status === "failed") {
        result.reasonCode = mapMobileStepFailureReasonCode(result.errorMessage ?? "");
      } else if (step.action === "click") {
        const transition = await assessClickTransitionOutcome(
          browser,
          step,
          opts.steps[i + 1],
          preStepPageSource,
          executionSignals,
          Math.min(step.timeoutMs ?? 10000, 2500),
        );
        if (!transition.reached) {
          result.status = "failed";
          result.reasonCode = "transition_not_reached";
          result.errorMessage = transition.reason ?? "transition_not_reached: transitionTimeout";
        }
      }
      results.push(result);

      if (result.status === "failed") {
        failedCount++;
        onLog(`[mobile:scenario] step=${i + 1}/${opts.steps.length} status=failed reasonCode=${result.reasonCode ?? "step_execution_failed"} message="${result.errorMessage ?? "unknown"}"`);
        if ((result.errorMessage || "").startsWith("mobile_automation_channel_lost:")) {
          throw new Error(result.errorMessage || "mobile_automation_channel_lost: webdriver channel lost");
        }
        if ((result.errorMessage || "").startsWith("mobile_text_encoding_invalid:")) {
          throw new Error(result.errorMessage || "mobile_text_encoding_invalid: corrupted mobile text payload");
        }
        // Unequivocal session/device loss: abort immediately instead of continuing to
        // run remaining steps against a dead session. Normalize to the existing marker
        // so classifyScenarioFailure maps it to infrastructure_failure (never functional).
        if (looksLikeMobileSessionOrDeviceLost(result.errorMessage)) {
          throw new Error(`mobile_automation_channel_lost: ${result.errorMessage ?? "webdriver session or device lost"}`);
        }
        if (looksLikeNavigationGateFailure(step, result.errorMessage)) {
          const elapsedSinceLaunchMs = launchStepCompletedAtMs
            ? Math.max(0, Date.now() - launchStepCompletedAtMs)
            : Math.max(0, Date.now() - scenarioStartedAt);
          const diagnostics = await captureNavigationFailureDiagnostics(
            browser,
            scenarioDir,
            step,
            i,
            elapsedSinceLaunchMs,
            onLog,
          );
          result.reasonCode = derivePrimaryFailureReasonCode(step, result.reasonCode ?? "step_execution_failed", result.errorMessage);
          result.primaryCauseStepIndex = i;
          result.diagnosticsPath = diagnostics.diagnosticsPath;
          result.defectEligible = diagnostics.defectEligible;
          primaryDependencyFailure = {
            stepIndex: i,
            reasonCode: result.reasonCode,
            message: result.errorMessage ?? "navigation step failed",
          };
          onLog(
            `[mobile:scenario] primary navigation failure at step ${i + 1}; dependent steps will be skipped reasonCode=${result.reasonCode}`,
          );
        }
      } else {
        passedCount++;
        onLog(`[mobile:scenario] step=${i + 1}/${opts.steps.length} status=passed durationMs=${result.durationMs}`);
        if (step.action === "launchApp" && launchStepCompletedAtMs === undefined) {
          launchStepCompletedAtMs = Date.now();
        }
        if (step.action === "click" && step.target?.value) executedClickTargets.push(step.target.value);
      }

      if (learningEnabled) {
        try {
          const afterSource = await browser.getPageSource().catch(() => "");
          let snapshot;
          let afterSourceFailed = false;
          let afterSnapshotFailed = false;
          let snapshotErr = "";
          try {
            snapshot = extractMobileScreenSnapshot(afterSource);
          } catch (e) {
            afterSnapshotFailed = true;
            const err = e as { name?: string; message?: string };
            snapshotErr = `${err?.name ?? "Error"}: ${(err?.message ?? "").slice(0, 120)}`;
          }
          const afterSourceOk = Boolean(afterSource && afterSource.trim().length > 0);
          const afterHasContent = afterSnapshotFailed
            ? false
            : (snapshot?.clickTargets.length ?? 0) > 0 || (snapshot?.assertionTargets.length ?? 0) > 0;
          const afterFingerprint = afterSnapshotFailed ? undefined : snapshot?.fingerprint;
          if (!afterSnapshotFailed && snapshot && !screensByKey.has(snapshot.screenKey)) {
            screensByKey.set(snapshot.screenKey, snapshot);
          }
          // Learn a structured navigation transition ONLY when we observed a click with valid
          // STRUCTURAL fingerprints (real observed content) on both sides AND the state changed.
          // Never infer navigation from clickTargets, visible text, slugs, or generic keys.
          let discardReason: string | undefined;
          const sameFingerprint =
            Boolean(screenBeforeFingerprint) &&
            Boolean(afterFingerprint) &&
            screenBeforeFingerprint === afterFingerprint;
          if (step.action !== "click") discardReason = "not_click";
          else if (!step.target?.value) discardReason = "target_missing";
          else if (!screenBeforeFingerprint) discardReason = "before_fingerprint_missing";
          else if (!screenBeforeHasContent) discardReason = "before_content_missing";
          else if (!afterSourceOk) discardReason = "after_source_failed";
          else if (afterSnapshotFailed) discardReason = "after_snapshot_failed";
          else if (!afterFingerprint) discardReason = "after_fingerprint_missing";
          else if (!afterHasContent) discardReason = "after_content_missing";
          else if (sameFingerprint) discardReason = "same_fingerprint";

          const transitionPersistCandidate = discardReason === undefined;
          if (step.action === "click" && step.target?.value) {
            const transitionLog = {
              stepIndex: i,
              stepDescription: step.description ?? step.action,
              beforeFingerprint: screenBeforeFingerprint ?? null,
              beforeHasContent: screenBeforeHasContent,
              afterSource: afterSourceOk ? "ok" : "failed",
              afterFingerprint: afterFingerprint ?? null,
              afterHasContent,
              sameFingerprint,
              transitionPersistCandidate,
              discardReason: discardReason ?? null,
              snapshotErr: afterSnapshotFailed ? snapshotErr : null,
            };
            onLog(
              `[mobile:transition] stepIndex=${i} beforeFingerprint=${screenBeforeFingerprint ? "present" : "absent"} ` +
                `beforeHasContent=${screenBeforeHasContent} afterSource=${afterSourceOk ? "ok" : "failed"} ` +
                `afterFingerprint=${afterFingerprint ? "present" : "absent"} afterHasContent=${afterHasContent} ` +
                `sameFingerprint=${sameFingerprint} transitionPersistCandidate=${transitionPersistCandidate}` +
                (discardReason ? ` discardReason=${discardReason}` : "") +
                (afterSnapshotFailed ? ` snapshotErr="${snapshotErr}"` : ""),
            );
            try {
              const diagDir = path.join(scenarioDir, "diagnostics");
              fs.mkdirSync(diagDir, { recursive: true });
              const diagFile = path.join(diagDir, "transition-captures.jsonl");
              fs.appendFileSync(diagFile, JSON.stringify(transitionLog) + "\n", "utf-8");
            } catch { /* diagnostics write is best-effort */ }
          }

          if (transitionPersistCandidate && screenBeforeFingerprint) {
            // Use the exact executed control identity from the executor — NOT a post-hoc
            // re-resolution against beforeSnapshot.observedControls. The executor captured
            // technical attributes from the real DOM element that Appium resolved.
            const ec = result.executedControl;
            const stepRequirementIds = opts.stepRequirementRefs
              ?.filter((ref) => ref.stepIndex === i)
              .flatMap((ref) => ref.requirementIds) ?? [];
            // Action semantic authority: validated only when ALL conditions are met.
            const controlOwnedByApp = ec?.package === opts.appPackage?.trim();
            const hasCanonicalRefs = stepRequirementIds.length > 0;
            const actionSemanticValid = controlOwnedByApp && hasCanonicalRefs;
            const destEvidence = snapshot ? extractObservedDestination(snapshot) : undefined;
            // Build binding candidate when all conditions are met.
            // Candidate is observation-only — never auto-promotes to authoritative.
            const candidateTransitionId = screenBeforeFingerprint && afterFingerprint
              ? `${screenBeforeFingerprint}:${afterFingerprint}`
              : undefined;
            const bindingCandidate = (candidateTransitionId && destEvidence && actionSemanticValid && stepRequirementIds.length > 0)
              ? buildBindingCandidate(candidateTransitionId, stepRequirementIds, destEvidence)
              : undefined;
            observedTransitions.push({
              stepIndex: i,
              action: step.action,
              actionTarget: { strategy: step.target.strategy, value: step.target.value },
              screenBefore: screenBeforeFingerprint,
              screenAfter: afterFingerprint,
              controlPackage: ec?.package,
              controlResourceId: ec?.resourceId,
              controlContentDesc: ec?.contentDesc,
              actionLocatorIdentity: ec?.locatorIdentity,
              requirementIds: stepRequirementIds.length > 0 ? stepRequirementIds : undefined,
              actionSemanticAuthority: actionSemanticValid ? "validated" : undefined,
              transitionValidated: true,
              executionBacked: true,
              observedDestinationEvidence: destEvidence,
              bindingCandidate,
            });
          }
        } catch {
          /* snapshot capture is best-effort */
        }
      }
    }
  } finally {
    try {
      await closeSessionFn(browser);
      onLog("[mobile:session] close status=completed");
    } finally {
      releaseSessionLock({
        lockKey: sessionHandle.lockKey,
        lockOwner: sessionHandle.lockOwner,
        runId: opts.runId,
        onLog,
      });
    }
  }
  if (skippedByDependencyCount > 0 && primaryDependencyFailure) {
    onLog(
      `[mobile:scenario] remainingSteps skipped=${skippedByDependencyCount} reasonCode=${primaryDependencyFailure.reasonCode}`,
    );
  }

  // Persist observed screens + route via shared SQL-first persister (ProjectKnowledge -> app.knowledge.json)
  if (learningEnabled && opts.appSlug) {
    const status: "passed" | "failed" = failedCount === 0 ? "passed" : "failed";
    const expectedPackage = opts.appPackage?.trim();
    for (const snapshot of screensByKey.values()) {
      // Filter to app-owned controls only: preserve only controls whose package
      // matches the expected appPackage. External controls (System UI, launcher,
      // dialogs) are excluded to prevent them from being treated as functional
      // project knowledge.
      const appOwnedControls = expectedPackage
        ? snapshot.observedControls.filter((c) => c.package === expectedPackage)
        : snapshot.observedControls;
      const appOwnedLabels = new Set(appOwnedControls.map((c) => c.label));
      const filteredClickTargets = snapshot.clickTargets.filter((l) => appOwnedLabels.has(l));
      const filteredAssertionTargets = snapshot.assertionTargets.filter((l) => appOwnedLabels.has(l));

      // Skip entirely if no app-owned controls survive filtering.
      if (appOwnedControls.length === 0 && filteredClickTargets.length === 0 && filteredAssertionTargets.length === 0) {
        onLog(`[mobile:knowledge] skipped screen=${snapshot.screenKey} reason=external_package dominant=${snapshot.dominantPackage ?? "unknown"} expected=${expectedPackage ?? "none"}`);
        continue;
      }

      // Project a filtered snapshot so only app-owned data is persisted.
      const filteredSnapshot: typeof snapshot = {
        ...snapshot,
        observedControls: appOwnedControls,
        clickTargets: filteredClickTargets,
        assertionTargets: filteredAssertionTargets,
      };

      await persistMobileScreen(opts.appSlug, filteredSnapshot, { issueKey: opts.sourceIssueKey, scenarioTitle: opts.evidenceScenarioTitle, status: failedCount === 0 ? "passed" : "partial" });
    }
    if (executedClickTargets.length > 0) {
      await persistMobileRoute(opts.appSlug, executedClickTargets, { issueKey: opts.sourceIssueKey, scenarioTitle: opts.evidenceScenarioTitle, status, expectedAppPackage: opts.appPackage?.trim() }, observedTransitions);
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
          status: r.status === "passed" ? "passed" : r.status === "failed" ? "failed" : "skipped",
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
    passed: passedCount,
    failed: failedCount,
    blocked: 0,
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
  const logger = createMobileJobLogger({
    runId: jobId,
    appendLog: (line) => jobStore.appendLog(jobId, line),
  });
  const onLog = (line: string) => logger.log(line);

  jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });
  onLog(`[mobile:run] started runId=${jobId} scenarios=1 appSlug=${params.appSlug ?? "mobile"}`);

  try {
    let target: ResolvedMobileTarget;
    try {
      // Resolve SQL packageName as last-resort fallback when other sources don't provide it.
      let sqlPackageName: string | undefined;
      if (params.appSlug?.trim()) {
        try {
          const cfg = await getProjectConfigurationBySlug(params.appSlug.trim());
          sqlPackageName = cfg?.mobile?.packageName?.trim() || undefined;
        } catch { /* db read is best-effort */ }
      }
      target = validateResolvedMobileTarget(resolveMobileTarget({ ...params, sqlPackageName }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const reasonCode = err instanceof MobileTargetValidationError ? err.reasonCode : "mobile_apk_not_accessible";
      const apkPath = err instanceof MobileTargetValidationError ? err.apkPath : undefined;
      onLog(`[mobile:test] blocked reasonCode=${reasonCode} apkPath=${apkPath ?? "n/a"} message=${message}`);
      jobStore.update(jobId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: message,
        summary: {
          totalStories: 1,
          synced: 0,
          passed: 0,
          failed: 0,
          reasonCode,
          errorMessage: message,
        }
      });
      return;
    }
    onLog(
      `[mobile:test] target resolved apkPathSource=${target.apkPathSource ?? "none"} apkPath=${target.apkPath ?? "none"} appPackage=${target.appPackage ?? "none"}`,
    );

    if (!params.steps || params.steps.length === 0) {
      onLog("[mobile:test] Error: no steps provided");
      jobStore.update(jobId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: "No steps provided"
      });
      return;
    }

    const infraState = await ensureMobileInfra(target, onLog, {
      runId: jobId,
      traceAppiumChunk: logger.traceAppiumChunk,
    });

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
        systemPort: target.systemPort,
        deviceId: infraState.deviceId,
        emulatorStartedByRunner: infraState.emulatorStartedByRunner,
        apkPath: target.apkPath,
        appPackage: target.appPackage,
        appActivity: target.appActivity,
        steps: stepsToRun,
        evidenceScenarioId: "mobile-test",
        evidenceScenarioTitle: "Mobile test run",
        runId,
        sectionSlug,
        appSlug: params.appSlug,
        requiredData: params.requiredData,
        dataOverrides: params.dataOverrides,
        stepRequirementRefs: params.stepRequirementRefs,
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
    onLog(`[mobile:run] finished status=${status} passed=${passed} failed=${failed} blocked=0`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onLog(`[mobile:test] failed: ${message}`);
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: message
    });
  } finally {
    logger.flush();
  }
}
