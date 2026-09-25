"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__setRemoteForTesting = __setRemoteForTesting;
exports.__resetRemoteForTesting = __resetRemoteForTesting;
exports.classifyMobileSessionFailure = classifyMobileSessionFailure;
exports.probeAppiumHealth = probeAppiumHealth;
exports.cleanupDanglingAppiumSessions = cleanupDanglingAppiumSessions;
exports.resolveMobileSessionRetryBackoffMs = resolveMobileSessionRetryBackoffMs;
exports.resolveSessionCreateTimeoutMs = resolveSessionCreateTimeoutMs;
exports.createSession = createSession;
exports.closeSession = closeSession;
const webdriverio_1 = require("webdriverio");
const appium_server_manager_1 = require("./appium-server-manager");
let remoteFn = webdriverio_1.remote;
function __setRemoteForTesting(fn) {
    remoteFn = fn;
}
function __resetRemoteForTesting() {
    remoteFn = webdriverio_1.remote;
}
function classifyMobileSessionFailure(errorMessage) {
    const msg = errorMessage.toLowerCase();
    if (msg.includes("does not exist or is not accessible") ||
        msg.includes("apk file not found") ||
        msg.includes("appium:app") ||
        msg.includes("must be absolute path") ||
        msg.includes("path contains an unexpanded environment expression")) {
        return { reasonCode: msg.includes("not found") ? "mobile_apk_not_found" : "mobile_apk_not_accessible", recoverable: false };
    }
    if (msg.includes("either apkpath or apppackage is required") ||
        msg.includes("apppackage") && msg.includes("required")) {
        return { reasonCode: "mobile_app_configuration_missing", recoverable: false };
    }
    if (msg.includes("cannot activate app") ||
        msg.includes("activateapp") ||
        msg.includes("app activation")) {
        return { reasonCode: "mobile_app_activation_not_completed", recoverable: false };
    }
    if (msg.includes("install") &&
        (msg.includes("failed") || msg.includes("cannot") || msg.includes("could not"))) {
        return { reasonCode: "mobile_app_installation_not_completed", recoverable: false };
    }
    if (msg.includes("device is busy") ||
        msg.includes("device busy") ||
        msg.includes("device is still busy") ||
        msg.includes("device offline")) {
        return { reasonCode: "mobile_device_temporarily_busy", recoverable: true };
    }
    if (msg.includes("econnrefused") ||
        msg.includes("econnreset") ||
        msg.includes("socket hang up") ||
        msg.includes("operation was aborted") ||
        msg.includes("timeout") ||
        msg.includes("timed out") ||
        msg.includes("temporarily unavailable")) {
        return { reasonCode: "mobile_session_transient_unavailable", recoverable: true };
    }
    if (msg.includes("session not created") || msg.includes("failed to create session")) {
        return { reasonCode: "mobile_session_not_created", recoverable: true };
    }
    if (msg.includes("instrumentation process is not running") ||
        msg.includes("uiautomator2 server cannot start") ||
        msg.includes("uiautomator2 server not running") ||
        msg.includes("uiautomator2 server not responding") ||
        msg.includes("invalid session id") ||
        msg.includes("session deleted because of page crash")) {
        return { reasonCode: "mobile_automation_channel_lost", recoverable: false };
    }
    // ADB-level infra failures: Broken pipe from adbExec/settings service, non-zero exit from adb shell.
    // These are permanent infrastructure problems — the emulator or ADB bridge is unhealthy.
    if (msg.includes("broken pipe") ||
        msg.includes("failure calling service settings") ||
        (msg.includes("adbexec") && (msg.includes("error executing") || msg.includes("exit code")))) {
        return { reasonCode: "mobile_adb_unhealthy", recoverable: false };
    }
    // Session state is ambiguous — a prior request may still be active on the device.
    // Never retry: a second POST /session would cause overlapping sessions and "device already in use".
    if (msg.includes("mobile_session_state_unknown") ||
        msg.includes("session_state_unknown")) {
        return { reasonCode: "mobile_session_state_unknown", recoverable: false };
    }
    return { reasonCode: "mobile_session_create_failed", recoverable: false };
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function resolveAppiumHost() {
    return process.env.APPIUM_SERVER_HOST?.trim() || "127.0.0.1";
}
function withTimeout(signalTimeoutMs) {
    if (!Number.isFinite(signalTimeoutMs) || signalTimeoutMs <= 0 || typeof AbortController === "undefined") {
        return undefined;
    }
    const controller = new AbortController();
    setTimeout(() => controller.abort(), signalTimeoutMs);
    return controller.signal;
}
function normalizeSessionId(entry) {
    if (!entry || typeof entry !== "object")
        return undefined;
    const candidate = entry;
    if (typeof candidate.id === "string" && candidate.id.trim())
        return candidate.id.trim();
    if (typeof candidate.sessionId === "string" && candidate.sessionId.trim())
        return candidate.sessionId.trim();
    return undefined;
}
async function probeAppiumHealth(appiumPort, timeoutMs = 3000) {
    const resolved = (0, appium_server_manager_1.getCurrentAppiumServer)();
    const host = resolved?.host ?? resolveAppiumHost();
    const port = resolved?.port ?? appiumPort;
    const url = `http://${host}:${port}/status`;
    try {
        const res = await fetch(url, {
            method: "GET",
            signal: withTimeout(timeoutMs),
        });
        if (!res.ok) {
            return { ready: false, error: `HTTP_${res.status}` };
        }
        const payload = await res.json().catch(() => ({}));
        return {
            ready: payload.value?.ready === true,
            message: payload.value?.message,
            version: payload.value?.build?.version,
            error: payload.value?.ready === true ? undefined : "status_not_ready",
        };
    }
    catch (err) {
        return { ready: false, error: err instanceof Error ? err.message : String(err) };
    }
}
async function cleanupDanglingAppiumSessions(appiumPort, timeoutMs = 4000) {
    const resolved = (0, appium_server_manager_1.getCurrentAppiumServer)();
    const host = resolved?.host ?? resolveAppiumHost();
    const port = resolved?.port ?? appiumPort;
    const sessionsUrl = `http://${host}:${port}/sessions`;
    try {
        const res = await fetch(sessionsUrl, {
            method: "GET",
            signal: withTimeout(timeoutMs),
        });
        if (!res.ok) {
            return { clearedSessionIds: [], failedSessionIds: [], error: `sessions_list_http_${res.status}` };
        }
        const payload = await res.json().catch(() => ({}));
        const ids = Array.isArray(payload.value) ? payload.value.map(normalizeSessionId).filter((id) => Boolean(id)) : [];
        const clearedSessionIds = [];
        const failedSessionIds = [];
        for (const sessionId of ids) {
            const deleteRes = await fetch(`http://${host}:${port}/session/${encodeURIComponent(sessionId)}`, {
                method: "DELETE",
                signal: withTimeout(timeoutMs),
            }).catch(() => null);
            if (deleteRes?.ok) {
                clearedSessionIds.push(sessionId);
            }
            else {
                failedSessionIds.push(sessionId);
            }
        }
        return { clearedSessionIds, failedSessionIds };
    }
    catch (err) {
        return {
            clearedSessionIds: [],
            failedSessionIds: [],
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
function resolveMobileSessionRetryBackoffMs(rawValue = process.env.MOBILE_SESSION_RETRY_BACKOFF_MS) {
    const fallback = 1250;
    if (!rawValue || !rawValue.trim())
        return fallback;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed))
        return fallback;
    if (parsed < 250)
        return 250;
    if (parsed > 10000)
        return 10000;
    return parsed;
}
function resolveSessionCreateTimeoutMs() {
    const raw = process.env.APPIUM_SESSION_CREATE_TIMEOUT_MS;
    if (!raw?.trim())
        return 90000;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n))
        return 90000;
    if (n < 15000)
        return 15000;
    if (n > 300000)
        return 300000;
    return n;
}
async function createSession(opts) {
    // Always connect to the port/host the Appium manager actually resolved (it may
    // have selected a fallback port when the preferred one was occupied). Fall back
    // to the caller-provided port only when the manager has no tracked server.
    const resolvedServer = (0, appium_server_manager_1.getCurrentAppiumServer)();
    const appiumHost = resolvedServer?.host ?? resolveAppiumHost();
    const appiumPort = resolvedServer?.port ?? opts.appiumPort;
    const capabilities = {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:noReset": true
    };
    if (opts.apkPath) {
        capabilities["appium:app"] = opts.apkPath;
    }
    else if (opts.appPackage) {
        capabilities["appium:appPackage"] = opts.appPackage;
        if (opts.appActivity)
            capabilities["appium:appActivity"] = opts.appActivity;
    }
    else {
        throw new Error("Either apkPath or appPackage must be provided to start an Appium session.");
    }
    // Use a session-creation timeout that matches Appium's actual startup latency.
    // Default 90 s (configurable via APPIUM_SESSION_CREATE_TIMEOUT_MS).
    // The old 10 s connectionRetryTimeout caused client-side timeouts while Appium was
    // still processing POST /session, leading to overlapping sessions.
    const sessionTimeoutMs = resolveSessionCreateTimeoutMs();
    if (opts.deviceId?.trim()) {
        capabilities["appium:udid"] = opts.deviceId.trim();
    }
    if (Number.isInteger(opts.systemPort) && Number(opts.systemPort) > 0) {
        capabilities["appium:systemPort"] = Number(opts.systemPort);
    }
    const remoteOptions = {
        hostname: appiumHost,
        port: appiumPort,
        path: "/",
        connectionRetryCount: 0,
        connectionRetryTimeout: sessionTimeoutMs,
        capabilities: capabilities
    };
    // No internal retry — the coordinator in mobile-test-runner owns retry logic.
    try {
        return await remoteFn(remoteOptions);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const classified = classifyMobileSessionFailure(message);
        throw new Error(`${classified.reasonCode}: ${message}`);
    }
}
async function closeSession(browser) {
    try {
        await browser.deleteSession();
    }
    catch {
        // Best effort — session may already be gone.
    }
}
