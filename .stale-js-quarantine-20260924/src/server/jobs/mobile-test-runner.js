"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MobileTargetValidationError = exports.__getCoordinatorLockForTesting = exports.__getCoordinatorStatsForTesting = exports.__resetCoordinatorForTesting = exports.__setCoordinatorDeleteFn = exports.evaluateScenarioPrecheck = void 0;
exports.__setCreateSessionForTesting = __setCreateSessionForTesting;
exports.__resetCreateSessionForTesting = __resetCreateSessionForTesting;
exports.__setCloseSessionForTesting = __setCloseSessionForTesting;
exports.__resetCloseSessionForTesting = __resetCloseSessionForTesting;
exports.__setExecuteMobileStepForTesting = __setExecuteMobileStepForTesting;
exports.__resetExecuteMobileStepForTesting = __resetExecuteMobileStepForTesting;
exports.determineEmulatorOwnership = determineEmulatorOwnership;
exports.validateResolvedMobileTarget = validateResolvedMobileTarget;
exports.resolveMobileTarget = resolveMobileTarget;
exports.ensureMobileInfra = ensureMobileInfra;
exports.runOneScenario = runOneScenario;
exports.consolidateMobileRunEvidence = consolidateMobileRunEvidence;
exports.startMobileTestRunJob = startMobileTestRunJob;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const job_store_1 = require("./job-store");
const env_1 = require("../../config/env");
const emulator_manager_1 = require("../../mobile/emulator-manager");
const appium_server_manager_1 = require("../../mobile/appium-server-manager");
const appium_session_1 = require("../../mobile/appium-session");
const appium_session_coordinator_1 = require("../../mobile/appium-session-coordinator");
Object.defineProperty(exports, "__getCoordinatorStatsForTesting", { enumerable: true, get: function () { return appium_session_coordinator_1.__getCoordinatorStatsForTesting; } });
Object.defineProperty(exports, "__getCoordinatorLockForTesting", { enumerable: true, get: function () { return appium_session_coordinator_1.__getCoordinatorLockForTesting; } });
Object.defineProperty(exports, "__setCoordinatorDeleteFn", { enumerable: true, get: function () { return appium_session_coordinator_1.__setDeleteSessionFnForTesting; } });
Object.defineProperty(exports, "__resetCoordinatorForTesting", { enumerable: true, get: function () { return appium_session_coordinator_1.__resetCoordinatorForTesting; } });
const mobile_step_executor_1 = require("../../mobile/mobile-step-executor");
const evidence_paths_1 = require("../../evidence/evidence-paths");
const evidence_recorder_1 = require("../../evidence/evidence-recorder");
const run_evidence_recorder_1 = require("../../evidence/run-evidence-recorder");
const evidence_types_1 = require("../../evidence/evidence-types");
const mobile_step_types_1 = require("../../mobile/mobile-step-types");
const mobile_knowledge_extractor_1 = require("../../mobile/mobile-knowledge-extractor");
const mobile_knowledge_persister_1 = require("../../mobile/mobile-knowledge-persister");
const mobile_observed_destination_1 = require("../../mobile/mobile-observed-destination");
const mobile_destination_binding_1 = require("../../mobile/mobile-destination-binding");
const mobile_route_profile_1 = require("../../mobile/mobile-route-profile");
const mobile_execution_precheck_1 = require("../../mobile/mobile-execution-precheck");
const project_reader_1 = require("../../db/project-reader");
var mobile_execution_precheck_2 = require("../../mobile/mobile-execution-precheck");
Object.defineProperty(exports, "evaluateScenarioPrecheck", { enumerable: true, get: function () { return mobile_execution_precheck_2.evaluateScenarioPrecheck; } });
const mobile_modal_dismisser_1 = require("../../mobile/mobile-modal-dismisser");
const mobile_text_normalization_1 = require("../../mobile/mobile-text-normalization");
const mobile_job_logger_1 = require("./mobile-job-logger");
let createSessionFn = appium_session_1.createSession;
let closeSessionFn = appium_session_1.closeSession;
let executeMobileStepFn = mobile_step_executor_1.executeMobileStep;
function __setCreateSessionForTesting(fn) {
    createSessionFn = fn;
}
function __resetCreateSessionForTesting() {
    createSessionFn = appium_session_1.createSession;
}
function __setCloseSessionForTesting(fn) {
    closeSessionFn = fn;
}
function __resetCloseSessionForTesting() {
    closeSessionFn = appium_session_1.closeSession;
}
function __setExecuteMobileStepForTesting(fn) {
    executeMobileStepFn = fn;
}
function __resetExecuteMobileStepForTesting() {
    executeMobileStepFn = mobile_step_executor_1.executeMobileStep;
}
function determineEmulatorOwnership(input) {
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
class MobileTargetValidationError extends Error {
    reasonCode;
    apkPath;
    permanent = true;
    constructor(reasonCode, message, apkPath) {
        super(message);
        this.name = "MobileTargetValidationError";
        this.reasonCode = reasonCode;
        this.apkPath = apkPath;
    }
}
exports.MobileTargetValidationError = MobileTargetValidationError;
function hasUnexpandedExpression(input) {
    return /\$env:[A-Za-z_][A-Za-z0-9_]*/i.test(input) ||
        /%[A-Za-z_][A-Za-z0-9_]*%/.test(input) ||
        /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(input);
}
function validateResolvedMobileTarget(target, fsOps = fs) {
    const nextTarget = { ...target };
    const configuredApk = target.apkPath?.trim();
    const appPackage = target.appPackage?.trim();
    if (!configuredApk && !appPackage) {
        throw new MobileTargetValidationError("mobile_app_configuration_missing", "Either apkPath or appPackage is required");
    }
    if (!configuredApk) {
        nextTarget.apkPath = undefined;
        return nextTarget;
    }
    if (hasUnexpandedExpression(configuredApk)) {
        throw new MobileTargetValidationError("mobile_apk_not_accessible", `APK path contains an unexpanded environment expression: ${configuredApk}`, configuredApk);
    }
    if (!path.isAbsolute(configuredApk)) {
        throw new MobileTargetValidationError("mobile_apk_not_accessible", `APK path must be absolute: ${configuredApk}`, configuredApk);
    }
    const resolvedApkPath = path.resolve(configuredApk);
    if (!resolvedApkPath.toLowerCase().endsWith(".apk")) {
        throw new MobileTargetValidationError("mobile_apk_not_accessible", `APK path must end with .apk: ${resolvedApkPath}`, resolvedApkPath);
    }
    if (!fsOps.existsSync(resolvedApkPath)) {
        throw new MobileTargetValidationError("mobile_apk_not_found", `APK file not found at path: ${resolvedApkPath}`, resolvedApkPath);
    }
    let stat;
    try {
        stat = fsOps.statSync(resolvedApkPath);
    }
    catch {
        throw new MobileTargetValidationError("mobile_apk_not_accessible", `APK file is not accessible at path: ${resolvedApkPath}`, resolvedApkPath);
    }
    if (!stat.isFile()) {
        throw new MobileTargetValidationError("mobile_apk_not_accessible", `APK path does not point to a file: ${resolvedApkPath}`, resolvedApkPath);
    }
    try {
        fsOps.accessSync(resolvedApkPath, fs.constants.R_OK);
    }
    catch {
        throw new MobileTargetValidationError("mobile_apk_not_accessible", `APK file is not readable: ${resolvedApkPath}`, resolvedApkPath);
    }
    nextTarget.apkPath = resolvedApkPath;
    return nextTarget;
}
function resolveAppProfileDefaults(appSlug) {
    const normalizedSlug = appSlug?.trim();
    if (!normalizedSlug)
        return {};
    const profile = (0, mobile_route_profile_1.loadMobileRouteProfile)(normalizedSlug);
    if (!profile)
        return {};
    return {
        appPackage: profile.packageName?.trim() || undefined,
        appActivity: profile.mainActivity?.trim() || undefined,
    };
}
function resolveMobileTarget(params) {
    const appProfileDefaults = resolveAppProfileDefaults(params.appSlug);
    const avdName = params.avdName?.trim() || env_1.config.integrations.android?.avdName;
    const requestApkPath = params.apkPath?.trim() || undefined;
    const envApkPath = env_1.config.integrations.android?.apkPath;
    if (!avdName) {
        throw new Error("Missing Android AVD name. Provide avdName in request payload or configure ANDROID_AVD_NAME.");
    }
    return {
        avdName,
        headless: params.headless ?? env_1.config.integrations.android?.headless ?? true,
        bootTimeoutMs: env_1.config.integrations.android?.bootTimeoutMs ?? 120000,
        appiumPort: env_1.config.integrations.android?.appiumPort ?? 4723,
        systemPort: params.systemPort
            ?? env_1.config.integrations.android?.systemPort
            ?? 8200,
        apkPath: requestApkPath || envApkPath,
        apkPathSource: requestApkPath ? "payload" : (envApkPath ? "env.ANDROID_APK_PATH" : undefined),
        appPackage: params.appPackage?.trim() || env_1.config.integrations.android?.appPackage || appProfileDefaults.appPackage || params.sqlPackageName?.trim() || undefined,
        appActivity: params.appActivity?.trim() || env_1.config.integrations.android?.appActivity || appProfileDefaults.appActivity
    };
}
/**
 * Boots the emulator and Appium server if they aren't already running/ready. Safe to
 * call once per job even when the job executes multiple scenarios — reuses whatever
 * is already up instead of re-booting per scenario.
 */
async function ensureMobileInfra(target, onLog, context) {
    const runId = context?.runId ?? "n/a";
    const emulatorStatus = (0, emulator_manager_1.getStatus)();
    let ownership = determineEmulatorOwnership("already_running");
    let appiumSource = "reused";
    const appiumStartedAt = Date.now();
    if (!emulatorStatus.running) {
        onLog(`[mobile:infra] emulator not running, starting avd=${target.avdName}`);
        const started = await (0, emulator_manager_1.startEmulator)(target.avdName, { headless: target.headless }, onLog);
        ownership = determineEmulatorOwnership(started);
        onLog(`[mobile:infra] emulator start result reused=${started.reused} external=${started.external} pid=${started.pid ?? "external"} deviceId=${started.deviceId ?? "pending"}`);
        await (0, emulator_manager_1.waitForBoot)(target.bootTimeoutMs, onLog);
    }
    else {
        ownership = determineEmulatorOwnership("already_running");
        onLog(`[mobile:infra] emulator already running status=${emulatorStatus.status} deviceId=${emulatorStatus.deviceId ?? "unknown"}, reusing`);
        if (!emulatorStatus.bootCompleted) {
            await (0, emulator_manager_1.waitForBoot)(target.bootTimeoutMs, onLog);
        }
    }
    const appiumStatus = (0, appium_server_manager_1.getStatus)();
    const appiumStartTimeoutMs = (0, appium_server_manager_1.resolveAppiumStartTimeoutMs)();
    if (!appiumStatus.ready) {
        appiumSource = "started";
        onLog(`[mobile:infra] appium server not ready, starting on port=${target.appiumPort} timeoutMs=${appiumStartTimeoutMs}`);
        const started = await (0, appium_server_manager_1.startAppiumServer)(target.appiumPort, onLog, {
            onTraceChunk: context?.traceAppiumChunk,
        });
        onLog(`[mobile:infra] appium start result reused=${started.reused} external=${started.external} pid=${started.pid ?? "external"}`);
        await (0, appium_server_manager_1.waitForReady)(appiumStartTimeoutMs, onLog);
    }
    else {
        onLog(`[mobile:infra] appium server already ready status=${appiumStatus.status}, reusing`);
    }
    // ADB preflight: verify shell and settings service are reachable before the first POST /session.
    // A Broken-pipe or unresponsive settings service here means the emulator bridge is unhealthy;
    // stop early so no scenario attempts a session and no functional defects are created.
    const emulatorDeviceId = (0, emulator_manager_1.getStatus)().deviceId;
    const adbHealth = await (0, emulator_manager_1.probeAdbHealth)(emulatorDeviceId);
    if (!adbHealth.healthy) {
        throw new Error(`mobile_adb_unhealthy: stage=${adbHealth.stage} reason=${adbHealth.reason} deviceId=${adbHealth.deviceId ?? "unknown"}`);
    }
    const emulatorOwnership = (0, emulator_manager_1.getStatus)();
    const resolvedDeviceId = adbHealth.deviceId ?? emulatorOwnership.deviceId;
    const readyState = {
        deviceId: resolvedDeviceId,
        emulatorStartedByRunner: ownership.emulatorStartedByRunner,
        ownership: ownership.ownership,
        ownershipReason: ownership.ownershipReason,
    };
    onLog(`[mobile:infra] appium status=ready source=${appiumSource} startupMs=${Date.now() - appiumStartedAt}`);
    onLog(`[mobile:infra] adb status=ready deviceId=${adbHealth.deviceId ?? "unknown"} systemPort=${target.systemPort}`);
    onLog(`[mobile:infra] emulator status=ready runId=${runId} deviceId=${resolvedDeviceId ?? "unknown"} emulatorStartedByRunner=${readyState.emulatorStartedByRunner} ownership=${readyState.ownership} reason=${readyState.ownershipReason} trackedExternal=${emulatorOwnership.external}`);
    return readyState;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function sanitizeDiagnosticText(value) {
    return value
        .replace(/([A-Za-z0-9_]*(?:password|token|secret|apikey)[A-Za-z0-9_]*)\s*[:=]\s*([^\s]+)/gi, "$1=[redacted]")
        .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
        .trim();
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function extractAttributeValues(pageSource, attribute, max = 40) {
    const values = [];
    const re = new RegExp(`${escapeRegex(attribute)}="([^"]+)"`, "g");
    let match;
    while ((match = re.exec(pageSource)) !== null) {
        const next = sanitizeDiagnosticText(match[1] || "");
        if (!next)
            continue;
        if (!values.includes(next))
            values.push(next);
        if (values.length >= max)
            break;
    }
    return values;
}
function looksLikeNavigationGateFailure(step, errorMessage) {
    if (!["click", "fill", "assertVisible", "waitFor", "assertEnabled"].includes(step.action))
        return false;
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
function looksLikeMobileSessionOrDeviceLost(errorMessage) {
    const message = (errorMessage || "").toLowerCase();
    if (!message)
        return false;
    return (message.includes("session is either terminated or not started")
        || message.includes("invalid session id")
        || message.includes("session deleted")
        || message.includes("session not created")
        || message.includes("new session could not be created")
        || message.includes("no connected devices")
        || message.includes("device offline")
        || message.includes("session not started")
        // adb/device-specific "device '<...>' not found" (never the generic "not found").
        || /device\s+'[^']*'\s+not found/u.test(message)
        || message.includes("emulator") && message.includes("not found"));
}
function derivePrimaryFailureReasonCode(step, currentReasonCode, errorMessage) {
    if (currentReasonCode === "data_precondition_failure"
        || currentReasonCode === "non_executable_precondition"
        || currentReasonCode === "transition_not_reached"
        || currentReasonCode === "mobile_automation_channel_lost"
        || currentReasonCode === "mobile_text_encoding_invalid") {
        return currentReasonCode;
    }
    const normalized = (errorMessage || "").toLowerCase();
    if ((step.action === "assertVisible" || step.action === "waitFor")
        && (currentReasonCode === "target_not_found"
            || currentReasonCode === "step_execution_failed"
            || normalized.includes("expected element to be visible")
            || normalized.includes("waitfor target not found"))) {
        return "transition_not_reached";
    }
    if (currentReasonCode === "target_not_found" || currentReasonCode === "target_disabled") {
        return currentReasonCode;
    }
    return "navigation_dependency_primary_failure";
}
function buildHierarchyFingerprint(pageSource) {
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
function hierarchyContainsAnyVariant(pageSource, rawValue) {
    const value = rawValue?.trim();
    if (!value)
        return false;
    for (const variant of (0, mobile_text_normalization_1.buildTextVariants)(value)) {
        if (!variant.trim())
            continue;
        if (pageSource.includes(`text="${variant}"`) || pageSource.includes(`content-desc="${variant}"`) || pageSource.includes(`resource-id="${variant}"`)) {
            return true;
        }
    }
    return false;
}
/**
 * The literal a target can be looked for by inside a page source.
 *
 * `hierarchyContainsAnyVariant` searches for an attribute VALUE, but an androidUiAutomator
 * target carries a selector EXPRESSION (`new UiSelector().className("…")`), which never
 * appears in the hierarchy — so the "did the next element show up?" probe silently answered
 * "no" every single time. Pulling the anchor literal out lets the probe answer the question it
 * was meant to ask. A class-only selector anchors on nothing identifying, so it returns
 * undefined: callers must read that as "cannot tell", never as "not present".
 */
function targetProbeValue(target) {
    const raw = target?.value?.trim();
    if (!raw)
        return undefined;
    if (target?.strategy !== "androidUiAutomator")
        return raw;
    const anchor = raw.match(/\.(?:description|descriptionContains|descriptionMatches|text|textContains|textMatches|resourceId)\(\s*"((?:[^"\\]|\\.)*)"\s*\)/);
    return anchor ? anchor[1].replace(/\\"/g, '"') : undefined;
}
function resolveTransitionSignalMatch(pageSource, signals) {
    const normalizedPage = normalizeSignalToken(pageSource);
    const groups = [
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
async function assessClickTransitionOutcome(browser, step, nextStep, previousPageSource, executionSignals, timeoutMs) {
    if (step.action !== "click")
        return { reached: true };
    const startedAt = Date.now();
    const requiredNextTargetValue = targetProbeValue(step.requiredNextTarget) ?? targetProbeValue(nextStep?.target);
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
        if (changedFingerprint || nextTargetVisible || selectionChanged) {
            return { reached: true };
        }
        await delay(200);
    }
    // Nothing observable changed. That is only evidence of failure when there was something to
    // observe: a declared next element that never appeared. Without one, this click had no
    // declared consequence — and some legitimately have none. Selecting a document type here
    // leaves the hierarchy byte-identical: the app exposes no selected="true"/checked="true"
    // anywhere, so a real, successful tap is indistinguishable from a no-op. Failing it means
    // failing every scenario that picks an option, for something the click did correctly.
    if (!requiredNextTargetValue) {
        return { reached: true, reason: "no_observable_transition" };
    }
    return { reached: false, reason: "transition_not_reached: transitionTimeout" };
}
async function captureNavigationFailureDiagnostics(browser, scenarioDir, step, stepIndex, elapsedSinceLaunchMs, onLog) {
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
    const browserWithAndroid = browser;
    const currentActivity = typeof browserWithAndroid.getCurrentActivity === "function"
        ? sanitizeDiagnosticText(await browserWithAndroid.getCurrentActivity().catch(() => ""))
        : undefined;
    const currentPackage = typeof browserWithAndroid.getCurrentPackage === "function"
        ? sanitizeDiagnosticText(await browserWithAndroid.getCurrentPackage().catch(() => ""))
        : undefined;
    let recommendedSelector = "none";
    if (hasAccessibilityMatch)
        recommendedSelector = "accessibilityId";
    else if (hasResourceIdMatch)
        recommendedSelector = "id";
    else if (hasVisibleTextMatch && classNames.length > 0)
        recommendedSelector = "class+text";
    else if (hasVisibleTextMatch)
        recommendedSelector = "text";
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
    onLog(`[mobile:diagnostics] step=${stepIndex + 1} selectorHierarchy accessibilityId=${hasAccessibilityMatch} resourceId=${hasResourceIdMatch} visibleText=${hasVisibleTextMatch} modalLikely=${modalLikely} elapsedSinceLaunchMs=${elapsedSinceLaunchMs} file=${diagnosticsPath}`);
    // Only consider it defect-eligible when evidence says the exact target should exist on the
    // current screen and no blocking modal/perms are suspected.
    const defectEligible = hasAccessibilityMatch && !modalLikely;
    return { diagnosticsPath, defectEligible };
}
async function createSessionWithControlledRetry(opts, onLog) {
    const appiumHost = process.env.APPIUM_SERVER_HOST?.trim() || "127.0.0.1";
    const emulatorDeviceId = opts.deviceId || (0, emulator_manager_1.getStatus)().deviceId || `${appiumHost}:${opts.appiumPort}`;
    const owner = `${opts.runId}:${opts.evidenceScenarioId}`;
    onLog(`[mobile:session] acquiring exclusive session lock deviceId=${emulatorDeviceId} owner=${owner}`);
    const handle = await (0, appium_session_coordinator_1.acquireSession)({
        runId: opts.runId,
        lockOwner: owner,
        deviceId: emulatorDeviceId,
        systemPort: opts.systemPort,
        appiumHost,
        appiumPort: opts.appiumPort,
        factory: () => createSessionFn({
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
            const appiumStatus = (0, appium_server_manager_1.getStatus)();
            const emulatorStatus = (0, emulator_manager_1.getStatus)();
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
function mapMobileStepFailureReasonCode(errorMessage) {
    const normalized = errorMessage.toLowerCase();
    if (normalized.includes("mobile_automation_channel_lost"))
        return "mobile_automation_channel_lost";
    if (normalized.includes("mobile_text_encoding_invalid"))
        return "mobile_text_encoding_invalid";
    if (normalized.includes("non_executable_precondition"))
        return "non_executable_precondition";
    if (normalized.includes("data_precondition_failure"))
        return "data_precondition_failure";
    if (normalized.includes("target not found") || normalized.includes("no such element") || normalized.includes("could not be located")) {
        return "target_not_found";
    }
    if (normalized.includes("target_disabled"))
        return "target_disabled";
    if (normalized.includes("timed out") || normalized.includes("timeout"))
        return "step_timeout";
    const otpReason = /otp_[a-z0-9_]+/.exec(normalized);
    if (otpReason)
        return otpReason[0];
    return "step_execution_failed";
}
function normalizeSignalToken(value) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}
/**
 * Runs ONE scenario's steps against a fresh Appium session (create -> activate app ->
 * execute steps with per-step evidence -> close session -> write results.json).
 * A fresh session per scenario is intentional even in a multi-scenario batch — every
 * AI-generated scenario starts with {"action":"launchApp"}, and a shared session
 * across scenarios would leave stale app/login state behind, turning that first step
 * into a no-op instead of a clean start.
 */
async function runOneScenario(opts, onLog) {
    const scenarioDir = (0, evidence_paths_1.buildEvidenceScenarioDir)({
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
    const scenarioPrecheck = (0, mobile_execution_precheck_1.evaluateScenarioPrecheck)(opts.steps, opts.appSlug);
    if (scenarioPrecheck.blocked) {
        const results = [];
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
    const sessionHandle = await createSessionWithControlledRetry({
        runId: opts.runId,
        appiumPort: opts.appiumPort,
        systemPort: opts.systemPort,
        deviceId: opts.deviceId,
        emulatorStartedByRunner: opts.emulatorStartedByRunner,
        apkPath: opts.apkPath,
        appPackage: opts.appPackage,
        appActivity: opts.appActivity,
        evidenceScenarioId: opts.evidenceScenarioId,
    }, onLog);
    const browser = sessionHandle.browser;
    onLog("[mobile:session] create completed");
    // Start each scenario from 0: noReset keeps the app installed, so between scenarios it would
    // otherwise resume wherever the previous one left it (mid-flow, a modal open, etc.). Terminate
    // the app first, then relaunch it fresh from its launch screen. Best-effort; gated by flag.
    if (opts.appPackage) {
        const restartBetweenScenarios = env_1.config.integrations.android?.restartAppBetweenScenarios ?? true;
        if (restartBetweenScenarios) {
            try {
                await browser.terminateApp(opts.appPackage);
                onLog(`[mobile:scenario] terminated app package=${opts.appPackage} (fresh start from 0)`);
            }
            catch (err) {
                onLog(`[mobile:scenario] terminateApp failed (continuing anyway): ${err instanceof Error ? err.message : err}`);
            }
        }
        // Session-creation capabilities (appPackage/appActivity) don't reliably bring the app to the
        // foreground if the activity name is slightly off — explicitly (re)launch it so step execution
        // doesn't silently run against the home screen instead.
        try {
            await browser.activateApp(opts.appPackage);
            onLog(`[mobile:scenario] activated app package=${opts.appPackage}`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`mobile_app_activation_not_completed: ${message}`);
        }
        // After activation, the Android OS may show a system compatibility-warning dialog
        // (app compiled with older page-size). Dismiss it generically (OK button) before
        // starting steps — this dialog is system-owned, not a functional app modal.
        const compatDismissed = await (0, mobile_modal_dismisser_1.dismissAndroidCompatibilityDialog)(browser, onLog);
        if (compatDismissed) {
            onLog(`[mobile:scenario] dismissed Android system compatibility dialog before first step`);
        }
    }
    const results = [];
    let failedCount = 0;
    let passedCount = 0;
    const scenarioStartedAt = Date.now();
    let launchStepCompletedAtMs;
    let primaryDependencyFailure;
    // Knowledge learning: capture the real screen (accessibility tree) after each step so
    // future generations know the actual elements of screens never declared by hand.
    const learningEnabled = (env_1.config.integrations.android?.knowledgeLearningEnabled ?? true) && Boolean(opts.appSlug);
    // Bounds how many states of a single screen a run may learn. Enough for a multi-step gate
    // (initial → first code sent → second code sent → gate open) without letting a screen with
    // volatile content — a countdown, a spinner — fill the knowledge file with near-duplicates.
    const MAX_LEARNED_STATES_PER_SCREEN = 4;
    // Keyed by `${screenKey}:${fingerprint}` — one entry per distinct STATE of a screen.
    const screensByKey = new Map();
    const statesByScreenKey = new Map();
    const executedClickTargets = [];
    const observedTransitions = [];
    let skippedByDependencyCount = 0;
    const executionSignals = (0, mobile_execution_precheck_1.resolveMobileExecutionSignals)(opts.appSlug);
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
            const filename = (0, evidence_paths_1.buildScreenshotFilename)(i, step.description || step.action);
            const screenshotPath = path.join(screenshotsDir, filename);
            let preStepPageSource = step.action === "click"
                ? await browser.getPageSource().catch(() => "")
                : undefined;
            // Structural screen fingerprint BEFORE the click (only when we have a usable page source).
            // A transition is only valid when the before/after screens have real observed content.
            let screenBeforeFingerprint;
            let screenBeforeHasContent = false;
            if (step.action === "click") {
                const expectedPkg = opts.appPackage?.trim();
                const deadline = Date.now() + Math.min(step.timeoutMs ?? 10000, 10000);
                let polls = 0;
                while (Date.now() < deadline) {
                    try {
                        if (!preStepPageSource || preStepPageSource.trim().length === 0) {
                            polls++;
                            await new Promise((r) => setTimeout(r, 500));
                            preStepPageSource = await browser.getPageSource().catch(() => "");
                            continue;
                        }
                        const snap = (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(preStepPageSource);
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
                    }
                    catch { /* snapshot failed, continue polling */ }
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
                // Lets an OTP step find the control that sent the code and see whether a later step
                // already drives the next validation cycle.
                steps: opts.steps,
            });
            if (result.status === "failed") {
                result.reasonCode = mapMobileStepFailureReasonCode(result.errorMessage ?? "");
            }
            else if (step.action === "click") {
                const transition = await assessClickTransitionOutcome(browser, step, opts.steps[i + 1], preStepPageSource, executionSignals, Math.min(step.timeoutMs ?? 10000, 2500));
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
                    const diagnostics = await captureNavigationFailureDiagnostics(browser, scenarioDir, step, i, elapsedSinceLaunchMs, onLog);
                    result.reasonCode = derivePrimaryFailureReasonCode(step, result.reasonCode ?? "step_execution_failed", result.errorMessage);
                    result.primaryCauseStepIndex = i;
                    result.diagnosticsPath = diagnostics.diagnosticsPath;
                    result.defectEligible = diagnostics.defectEligible;
                    primaryDependencyFailure = {
                        stepIndex: i,
                        reasonCode: result.reasonCode,
                        message: result.errorMessage ?? "navigation step failed",
                    };
                    onLog(`[mobile:scenario] primary navigation failure at step ${i + 1}; dependent steps will be skipped reasonCode=${result.reasonCode}`);
                }
            }
            else {
                passedCount++;
                onLog(`[mobile:scenario] step=${i + 1}/${opts.steps.length} status=passed durationMs=${result.durationMs}`);
                if (step.action === "launchApp" && launchStepCompletedAtMs === undefined) {
                    launchStepCompletedAtMs = Date.now();
                }
                if (step.action === "click" && step.target?.value)
                    executedClickTargets.push(step.target.value);
            }
            if (learningEnabled) {
                try {
                    const afterSource = await browser.getPageSource().catch(() => "");
                    let snapshot;
                    let afterSourceFailed = false;
                    let afterSnapshotFailed = false;
                    let snapshotErr = "";
                    try {
                        snapshot = (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(afterSource);
                    }
                    catch (e) {
                        afterSnapshotFailed = true;
                        const err = e;
                        snapshotErr = `${err?.name ?? "Error"}: ${(err?.message ?? "").slice(0, 120)}`;
                    }
                    const afterSourceOk = Boolean(afterSource && afterSource.trim().length > 0);
                    const afterHasContent = afterSnapshotFailed
                        ? false
                        : (snapshot?.clickTargets.length ?? 0) > 0 || (snapshot?.assertionTargets.length ?? 0) > 0;
                    const afterFingerprint = afterSnapshotFailed ? undefined : snapshot?.fingerprint;
                    if (!afterSnapshotFailed && snapshot) {
                        // Key by state, not by screen. screenKey comes from the screen's heading, so every
                        // state of one screen collapses into it: the contact-confirmation screen keeps the
                        // same heading whether it shows two "send code" buttons, the email boxes, or the
                        // phone boxes with Continuar finally enabled. Keying by screenKey kept only the first
                        // state ever seen, which is why the generator reported no evidence of the OTP screen
                        // and produced scenarios that stopped at the first code. The fingerprint is
                        // content-derived (and now includes gate state), so each state is learned once.
                        const stateKey = `${snapshot.screenKey}:${snapshot.fingerprint}`;
                        const statesForScreen = statesByScreenKey.get(snapshot.screenKey) ?? 0;
                        if (screensByKey.has(stateKey)) {
                            // already learned this exact state
                        }
                        else if (statesForScreen >= MAX_LEARNED_STATES_PER_SCREEN) {
                            onLog(`[mobile:knowledge] state skipped screen=${snapshot.screenKey} reason=state_cap_reached cap=${MAX_LEARNED_STATES_PER_SCREEN}`);
                        }
                        else {
                            screensByKey.set(stateKey, snapshot);
                            statesByScreenKey.set(snapshot.screenKey, statesForScreen + 1);
                        }
                    }
                    // Learn a structured navigation transition ONLY when we observed a click with valid
                    // STRUCTURAL fingerprints (real observed content) on both sides AND the state changed.
                    // Never infer navigation from clickTargets, visible text, slugs, or generic keys.
                    let discardReason;
                    const sameFingerprint = Boolean(screenBeforeFingerprint) &&
                        Boolean(afterFingerprint) &&
                        screenBeforeFingerprint === afterFingerprint;
                    if (step.action !== "click")
                        discardReason = "not_click";
                    else if (!step.target?.value)
                        discardReason = "target_missing";
                    else if (!screenBeforeFingerprint)
                        discardReason = "before_fingerprint_missing";
                    else if (!screenBeforeHasContent)
                        discardReason = "before_content_missing";
                    else if (!afterSourceOk)
                        discardReason = "after_source_failed";
                    else if (afterSnapshotFailed)
                        discardReason = "after_snapshot_failed";
                    else if (!afterFingerprint)
                        discardReason = "after_fingerprint_missing";
                    else if (!afterHasContent)
                        discardReason = "after_content_missing";
                    else if (sameFingerprint)
                        discardReason = "same_fingerprint";
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
                        onLog(`[mobile:transition] stepIndex=${i} beforeFingerprint=${screenBeforeFingerprint ? "present" : "absent"} ` +
                            `beforeHasContent=${screenBeforeHasContent} afterSource=${afterSourceOk ? "ok" : "failed"} ` +
                            `afterFingerprint=${afterFingerprint ? "present" : "absent"} afterHasContent=${afterHasContent} ` +
                            `sameFingerprint=${sameFingerprint} transitionPersistCandidate=${transitionPersistCandidate}` +
                            (discardReason ? ` discardReason=${discardReason}` : "") +
                            (afterSnapshotFailed ? ` snapshotErr="${snapshotErr}"` : ""));
                        try {
                            const diagDir = path.join(scenarioDir, "diagnostics");
                            fs.mkdirSync(diagDir, { recursive: true });
                            const diagFile = path.join(diagDir, "transition-captures.jsonl");
                            fs.appendFileSync(diagFile, JSON.stringify(transitionLog) + "\n", "utf-8");
                        }
                        catch { /* diagnostics write is best-effort */ }
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
                        const destEvidence = snapshot ? (0, mobile_observed_destination_1.extractObservedDestination)(snapshot) : undefined;
                        // Build binding candidate when all conditions are met.
                        // Candidate is observation-only — never auto-promotes to authoritative.
                        const candidateTransitionId = screenBeforeFingerprint && afterFingerprint
                            ? `${screenBeforeFingerprint}:${afterFingerprint}`
                            : undefined;
                        const bindingCandidate = (candidateTransitionId && destEvidence && actionSemanticValid && stepRequirementIds.length > 0)
                            ? (0, mobile_destination_binding_1.buildBindingCandidate)(candidateTransitionId, stepRequirementIds, destEvidence)
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
                }
                catch {
                    /* snapshot capture is best-effort */
                }
            }
        }
    }
    finally {
        try {
            await closeSessionFn(browser);
            onLog("[mobile:session] close status=completed");
        }
        finally {
            (0, appium_session_coordinator_1.releaseSessionLock)({
                lockKey: sessionHandle.lockKey,
                lockOwner: sessionHandle.lockOwner,
                runId: opts.runId,
                onLog,
            });
        }
    }
    if (skippedByDependencyCount > 0 && primaryDependencyFailure) {
        onLog(`[mobile:scenario] remainingSteps skipped=${skippedByDependencyCount} reasonCode=${primaryDependencyFailure.reasonCode}`);
    }
    // Persist observed screens + route via shared SQL-first persister (ProjectKnowledge -> app.knowledge.json)
    //
    // When learning is off this block used to do nothing and say nothing, so a run could complete
    // green while the knowledge file never grew — indistinguishable from a run that learned and
    // found nothing new. Reporting the reason makes the difference visible in the run log.
    if (!learningEnabled || !opts.appSlug) {
        onLog(`[mobile:knowledge] disabled reason=${!opts.appSlug ? "no_app_slug" : "MOBILE_KNOWLEDGE_LEARNING_ENABLED=false"} appSlug=${opts.appSlug ?? "-"}`);
    }
    if (learningEnabled && opts.appSlug) {
        const status = failedCount === 0 ? "passed" : "failed";
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
            const filteredSnapshot = {
                ...snapshot,
                observedControls: appOwnedControls,
                clickTargets: filteredClickTargets,
                assertionTargets: filteredAssertionTargets,
            };
            await (0, mobile_knowledge_persister_1.persistMobileScreen)(opts.appSlug, filteredSnapshot, { issueKey: opts.sourceIssueKey, scenarioTitle: opts.evidenceScenarioTitle, status: failedCount === 0 ? "passed" : "partial" });
        }
        if (executedClickTargets.length > 0) {
            await (0, mobile_knowledge_persister_1.persistMobileRoute)(opts.appSlug, executedClickTargets, { issueKey: opts.sourceIssueKey, scenarioTitle: opts.evidenceScenarioTitle, status, expectedAppPackage: opts.appPackage?.trim() }, observedTransitions);
        }
        onLog(`[mobile:knowledge] learned screens=${screensByKey.size} routeTargets=${executedClickTargets.length}`);
    }
    const resultsPath = path.join(scenarioDir, "results.json");
    fs.writeFileSync(resultsPath, JSON.stringify({ runId: opts.runId, apkPath: opts.apkPath, appPackage: opts.appPackage, results }, null, 2), "utf-8");
    // Write the web-schema evidence.json (+ optional per-scenario docx) by reusing the
    // same EvidenceRecorder the web pipeline uses — mobile already produced per-step
    // screenshots, so finish() runs without a Playwright Page. This makes mobile
    // evidence structurally identical to web (evidence.json under the same run layout),
    // which lets RunEvidenceRecorder consolidate it into a run docx afterwards.
    try {
        const recorder = new evidence_recorder_1.EvidenceRecorder({
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
    }
    catch (err) {
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
async function consolidateMobileRunEvidence(runId, sectionSlug, onLog) {
    const evidenceConfig = (0, evidence_types_1.loadEvidenceConfig)();
    if (!evidenceConfig.enabled || !evidenceConfig.docxEnabled) {
        onLog("[mobile:evidence] run consolidation skipped (evidence or docx disabled)");
        return;
    }
    try {
        const runRecorder = new run_evidence_recorder_1.RunEvidenceRecorder({ appSlug: "mobile", sectionSlug, runId });
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
    }
    catch (err) {
        onLog(`[mobile:evidence] consolidation failed (continuing): ${err instanceof Error ? err.message : err}`);
    }
}
async function startMobileTestRunJob(jobId) {
    const job = job_store_1.jobStore.getInternal(jobId);
    if (!job)
        return;
    const params = job.params;
    const logger = (0, mobile_job_logger_1.createMobileJobLogger)({
        runId: jobId,
        appendLog: (line) => job_store_1.jobStore.appendLog(jobId, line),
    });
    const onLog = (line) => logger.log(line);
    job_store_1.jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });
    onLog(`[mobile:run] started runId=${jobId} scenarios=1 appSlug=${params.appSlug ?? "mobile"}`);
    try {
        let target;
        try {
            // Resolve SQL packageName as last-resort fallback when other sources don't provide it.
            let sqlPackageName;
            if (params.appSlug?.trim()) {
                try {
                    const cfg = await (0, project_reader_1.getProjectConfigurationBySlug)(params.appSlug.trim());
                    sqlPackageName = cfg?.mobile?.packageName?.trim() || undefined;
                }
                catch { /* db read is best-effort */ }
            }
            target = validateResolvedMobileTarget(resolveMobileTarget({ ...params, sqlPackageName }));
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const reasonCode = err instanceof MobileTargetValidationError ? err.reasonCode : "mobile_apk_not_accessible";
            const apkPath = err instanceof MobileTargetValidationError ? err.apkPath : undefined;
            onLog(`[mobile:test] blocked reasonCode=${reasonCode} apkPath=${apkPath ?? "n/a"} message=${message}`);
            job_store_1.jobStore.update(jobId, {
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
        onLog(`[mobile:test] target resolved apkPathSource=${target.apkPathSource ?? "none"} apkPath=${target.apkPath ?? "none"} appPackage=${target.appPackage ?? "none"}`);
        if (!params.steps || params.steps.length === 0) {
            onLog("[mobile:test] Error: no steps provided");
            job_store_1.jobStore.update(jobId, {
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
        const stepsToRun = (0, mobile_step_types_1.applyDataOverrides)(params.steps, params.dataOverrides, params.requiredData);
        if (params.dataOverrides && Object.keys(params.dataOverrides).length > 0) {
            onLog(`[mobile:test] applied ${Object.keys(params.dataOverrides).length} data override(s)`);
        }
        const { passed, failed, artifactsDir } = await runOneScenario({
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
        }, onLog);
        await consolidateMobileRunEvidence(runId, sectionSlug, onLog);
        const status = failed === 0 ? "done" : "completed_with_failures";
        job_store_1.jobStore.update(jobId, {
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
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog(`[mobile:test] failed: ${message}`);
        job_store_1.jobStore.update(jobId, {
            status: "failed",
            completedAt: new Date().toISOString(),
            errorMessage: message
        });
    }
    finally {
        logger.flush();
    }
}
