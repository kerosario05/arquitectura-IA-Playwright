"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureAppiumReady = ensureAppiumReady;
exports.startMobileEmulatorBootJob = startMobileEmulatorBootJob;
const job_store_1 = require("./job-store");
const env_1 = require("../../config/env");
const emulator_manager_1 = require("../../mobile/emulator-manager");
const appium_server_manager_1 = require("../../mobile/appium-server-manager");
// Ensures Appium is ready by reusing the existing server when /status is already
// ready, otherwise starting it through the Appium manager (same launcher used by
// mobile-test-runner). Reuses all existing fixes: external reuse, readiness
// polling, final status check, process-tree cleanup and diagnostics.
async function ensureAppiumReady(onLog) {
    const appiumPort = env_1.config.integrations.android?.appiumPort ?? 4723;
    const appiumStatus = (0, appium_server_manager_1.getStatus)();
    const appiumStartTimeoutMs = (0, appium_server_manager_1.resolveAppiumStartTimeoutMs)();
    if (appiumStatus.ready) {
        onLog(`[mobile:infra] appium server already ready status=${appiumStatus.status}, reusing`);
        return {
            ready: true,
            reused: true,
            external: appiumStatus.external,
            port: appiumStatus.port ?? appiumPort,
        };
    }
    onLog(`[mobile:infra] appium server not ready, starting on port=${appiumPort} timeoutMs=${appiumStartTimeoutMs}`);
    const started = await (0, appium_server_manager_1.startAppiumServer)(appiumPort, onLog);
    onLog(`[mobile:infra] appium start result reused=${started.reused} external=${started.external} pid=${started.pid ?? "external"}`);
    await (0, appium_server_manager_1.waitForReady)(appiumStartTimeoutMs, onLog);
    const finalStatus = (0, appium_server_manager_1.getStatus)();
    onLog(`[mobile:infra] appium ready=${finalStatus.ready} reused=${started.reused} external=${finalStatus.external} port=${finalStatus.port ?? appiumPort}`);
    return {
        ready: finalStatus.ready,
        reused: started.reused,
        external: finalStatus.external,
        port: finalStatus.port ?? appiumPort,
    };
}
async function startMobileEmulatorBootJob(jobId) {
    const job = job_store_1.jobStore.getInternal(jobId);
    if (!job)
        return;
    const params = job.params;
    const requestedAvdName = params.avdName?.trim() || undefined;
    const requestedHeadless = params.headless;
    const avdName = requestedAvdName || env_1.config.integrations.android?.avdName;
    if (!avdName) {
        const message = "Missing Android AVD name. Provide avdName in request payload or configure ANDROID_AVD_NAME.";
        job_store_1.jobStore.update(jobId, {
            status: "failed",
            completedAt: new Date().toISOString(),
            errorMessage: message,
        });
        job_store_1.jobStore.appendLog(jobId, `[mobile:emulator] failed: ${message}`);
        return;
    }
    const headless = params.headless ?? env_1.config.integrations.android?.headless ?? true;
    const bootTimeoutMs = env_1.config.integrations.android?.bootTimeoutMs ?? 120000;
    job_store_1.jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });
    job_store_1.jobStore.appendLog(jobId, `[mobile:emulator] start request avdName=${requestedAvdName ?? "auto"} headless=${requestedHeadless === undefined ? "auto" : requestedHeadless} effectiveAvdName=${avdName} effectiveHeadless=${headless}`);
    const onLog = (line) => job_store_1.jobStore.appendLog(jobId, line);
    try {
        const start = await (0, emulator_manager_1.startEmulator)(avdName, { headless }, onLog);
        job_store_1.jobStore.appendLog(jobId, `[mobile:emulator] start result reused=${start.reused} external=${start.external} pid=${start.pid ?? "external"} deviceId=${start.deviceId ?? "pending"}`);
        await (0, emulator_manager_1.waitForBoot)(bootTimeoutMs, onLog);
        const appium = await ensureAppiumReady(onLog);
        job_store_1.jobStore.update(jobId, {
            status: "done",
            completedAt: new Date().toISOString(),
            summary: JSON.stringify({ appium }),
        });
        job_store_1.jobStore.appendLog(jobId, `[mobile:emulator] ready avd=${avdName} pid=${start.pid ?? "external"} deviceId=${start.deviceId ?? "detected"} appium.ready=${appium.ready} appium.reused=${appium.reused} appium.external=${appium.external} appium.port=${appium.port ?? "unknown"}`);
        job_store_1.jobStore.appendLog(jobId, `[mobile:infra] infrastructure ready emulator.ready=true appium.ready=${appium.ready}`);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        job_store_1.jobStore.appendLog(jobId, `[mobile:emulator] failed: ${message}`);
        job_store_1.jobStore.update(jobId, {
            status: "failed",
            completedAt: new Date().toISOString(),
            errorMessage: message
        });
    }
}
