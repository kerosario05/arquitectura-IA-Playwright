"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mobileRouter = void 0;
const express_1 = require("express");
const job_store_1 = require("../jobs/job-store");
const mobile_emulator_runner_1 = require("../jobs/mobile-emulator-runner");
const mobile_test_runner_1 = require("../jobs/mobile-test-runner");
const emulator_manager_1 = require("../../mobile/emulator-manager");
const appium_server_manager_1 = require("../../mobile/appium-server-manager");
const env_1 = require("../../config/env");
const jira_client_1 = require("../../clients/jira.client");
const mobile_scenario_generator_1 = require("../../scenarios/mobile-scenario-generator");
const launch_orchestrator_1 = require("../jobs/launch-orchestrator");
const mobile_launch_execution_runner_1 = require("../jobs/mobile-launch-execution-runner");
const mobile_scenario_generation_manager_1 = require("../jobs/mobile-scenario-generation-manager");
const mobile_route_learning_runner_1 = require("../jobs/mobile-route-learning-runner");
const mobile_rerun_artifacts_1 = require("../jobs/mobile-rerun-artifacts");
const mobile_route_learning_autostart_1 = require("../jobs/mobile-route-learning-autostart");
const mobile_route_profile_1 = require("../../mobile/mobile-route-profile");
exports.mobileRouter = (0, express_1.Router)();
/**
 * True when the runner will be able to resolve an app to drive.
 *
 * The guards below used to check only the request body and .env, but resolveMobileTarget()
 * also falls back to the project profile (mobile.config.json, resolved from appSlug) — so a
 * perfectly serviceable request was rejected before it ever reached the runner. QA-lab sends
 * appSlug and no package when it executes, which is exactly that case. Mirroring the same
 * resolution order here keeps the guard from being stricter than what actually runs.
 */
function hasResolvableApp(body) {
    if (body.apkPath?.trim() || body.appPackage?.trim())
        return true;
    if (env_1.config.integrations.android?.apkPath || env_1.config.integrations.android?.appPackage)
        return true;
    const slug = body.appSlug?.trim();
    if (!slug)
        return false;
    const profile = (0, mobile_route_profile_1.loadMobileRouteProfile)(slug);
    return Boolean(profile?.packageName?.trim());
}
let activeEmulatorBootJobId = null;
function normalizeSelectedIssueKeys(value) {
    if (!Array.isArray(value))
        return [];
    return Array.from(new Set(value
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry.length > 0))).sort();
}
function readActiveEmulatorBootJob() {
    if (!activeEmulatorBootJobId)
        return null;
    const job = job_store_1.jobStore.get(activeEmulatorBootJobId);
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
function appiumSummary(status) {
    return {
        ready: status.ready,
        reused: status.ready,
        external: status.external,
        port: status.port,
    };
}
function emulatorStartResponse(extra) {
    return {
        emulator: (0, emulator_manager_1.getStatus)(),
        appium: appiumSummary((0, appium_server_manager_1.getStatus)()),
        ...extra,
    };
}
// POST /api/mobile/emulator/start — boots the Android emulator as a background job.
// Watch progress via GET /api/runs/:jobId/logs (SSE).
exports.mobileRouter.post("/emulator/start", (req, res) => {
    const body = req.body;
    const requestedAvdName = body.avdName?.trim() || undefined;
    const requestedHeadless = body.headless;
    const effectiveAvdName = requestedAvdName || env_1.config.integrations.android?.avdName;
    const effectiveHeadless = requestedHeadless ?? env_1.config.integrations.android?.headless ?? true;
    console.log(`[mobile] emulator/start request requestedAvdName=${requestedAvdName ?? "auto"} requestedHeadless=${requestedHeadless === undefined ? "auto" : requestedHeadless} effectiveAvdName=${effectiveAvdName ?? "missing"} effectiveHeadless=${effectiveHeadless}`);
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
    const existing = (0, emulator_manager_1.getStatus)();
    if (existing.running) {
        const appium = (0, appium_server_manager_1.getStatus)();
        const payload = emulatorStartResponse({
            ok: true,
            reused: true,
            status: existing,
            mode: "mobile-emulator-boot",
        });
        if (appium.ready) {
            payload.message = `Emulator already ${existing.status}; reusing existing instance. Appium ready.`;
        }
        else {
            payload.appiumStarting = true;
            payload.message = `Emulator already ${existing.status}; reusing existing instance. Appium not ready; starting in background.`;
            setImmediate(() => {
                (0, mobile_emulator_runner_1.ensureAppiumReady)((line) => console.log(line)).catch((err) => {
                    console.log(`[mobile:infra] appium ensure failed: ${err instanceof Error ? err.message : String(err)}`);
                });
            });
        }
        res.status(202).json(payload);
        return;
    }
    const job = job_store_1.jobStore.create("mobile-emulator-boot", {
        avdName: body.avdName,
        headless: body.headless
    });
    activeEmulatorBootJobId = job.id;
    setImmediate(() => (0, mobile_emulator_runner_1.startMobileEmulatorBootJob)(job.id));
    res.status(202).json(emulatorStartResponse({
        ok: true,
        jobId: job.id,
        status: job.status,
        mode: "mobile-emulator-boot",
        message: "Emulator boot + Appium readiness job started.",
    }));
});
// GET /api/mobile/emulator/status — synchronous read of the current emulator state.
exports.mobileRouter.get("/emulator/status", (_req, res) => {
    const activeJob = readActiveEmulatorBootJob();
    res.json({
        ok: true,
        ...(0, emulator_manager_1.getStatus)(),
        appium: appiumSummary((0, appium_server_manager_1.getStatus)()),
        activeJobId: activeJob?.id,
        activeJobStatus: activeJob?.status,
    });
});
// POST /api/mobile/emulator/stop — kills the running emulator, if any.
exports.mobileRouter.post("/emulator/stop", async (_req, res, next) => {
    try {
        await (0, emulator_manager_1.stopEmulator)((line) => console.log(line), { caller: "api:/api/mobile/emulator/stop" });
        activeEmulatorBootJobId = null;
        res.json({ ok: true, ...(0, emulator_manager_1.getStatus)() });
    }
    catch (err) {
        next(err);
    }
});
// GET /api/mobile/appium/status — synchronous read of the current Appium server state.
exports.mobileRouter.get("/appium/status", async (_req, res, next) => {
    try {
        const current = (0, appium_server_manager_1.getStatus)();
        const refreshed = await (0, appium_server_manager_1.refreshStatus)(current.port);
        res.json({ ok: true, ...refreshed });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/mobile/tests/run — ensures emulator+Appium are up, then runs the given
// steps against an installed/launched app, capturing evidence. Watch progress via
// GET /api/runs/:jobId/logs (SSE).
exports.mobileRouter.post("/tests/run", (req, res) => {
    const body = req.body;
    // apkPath/appPackage/appActivity can also come from .env (ANDROID_APK_PATH,
    // ANDROID_APP_PACKAGE, ANDROID_APP_ACTIVITY) — only reject if neither the request
    // nor the config has one, matching what mobile-test-runner.ts actually resolves.
    const hasApp = hasResolvableApp(body);
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
    const job = job_store_1.jobStore.create("mobile-test-run", body);
    setImmediate(() => (0, mobile_test_runner_1.startMobileTestRunJob)(job.id));
    res.status(202).json({
        ok: true,
        jobId: job.id,
        status: job.status,
        mode: "mobile-test-run"
    });
});
// POST /api/mobile/route-learning — walks the app to capture REAL screens and records the
// traversed path as a named flow in mobile.config.json. The mobile counterpart of
// /api/scenarios/route-discovery/* (those drive Playwright and cannot serve a native app).
// Never presses a control that would commit the flow unless stopBeforeSubmit is false.
// Watch progress via GET /api/runs/:jobId/logs (SSE).
exports.mobileRouter.post("/route-learning", (req, res) => {
    const body = req.body;
    if (!body.appSlug?.trim()) {
        res.status(400).json({
            ok: false,
            error: "invalid_request",
            errorCode: "MISSING_APP_SLUG",
            message: "appSlug is required — it is what enables knowledge learning for the walk",
        });
        return;
    }
    const hasApp = hasResolvableApp(body);
    if (!hasApp) {
        res.status(400).json({
            ok: false,
            error: "invalid_request",
            errorCode: "MISSING_APP",
            message: "Either apkPath or appPackage is required (in the request body or via ANDROID_APK_PATH/ANDROID_APP_PACKAGE in .env)"
        });
        return;
    }
    const job = job_store_1.jobStore.create("mobile-route-learning", body);
    setImmediate(() => (0, mobile_route_learning_runner_1.startMobileRouteLearningJob)(job.id));
    res.status(202).json({
        ok: true,
        jobId: job.id,
        status: job.status,
        mode: "mobile-route-learning",
        appSlug: body.appSlug,
        flowId: body.flowId ?? null,
        stopBeforeSubmit: body.stopBeforeSubmit !== false,
    });
});
// POST /api/mobile/scenarios/generation — async mobile scenario generation job with
// idempotency, issue-level progress, and result retrieval via status endpoint.
exports.mobileRouter.post("/scenarios/generation", async (req, res) => {
    const body = req.body;
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
    const startResult = await (0, mobile_scenario_generation_manager_1.startOrReuseMobileScenarioGenerationJob)({
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
    const scenarioCountByIssue = Object.fromEntries(job.issueProgress.map((entry) => [entry.issueKey, entry.scenarioCount]));
    console.log(`[mobile:scenario-generation] requestId=${job.requestId} generationJobId=${job.generationJobId} launchDraftId=${job.launchDraftId ?? "—"} appSlug=${job.appSlug ?? "—"} issueKeys=${job.issueKeys.join(",") || "-"} startedAt=${job.startedAt ?? "—"} finishedAt=${job.finishedAt ?? "—"} status=${job.status} cache=${startResult.cacheHit ? "hit" : (startResult.reused ? "reuse_running" : "miss")} consumersWaiting=${job.consumersWaiting} scenariosByIssue=${JSON.stringify(scenarioCountByIssue)}`);
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
exports.mobileRouter.get("/scenarios/generation/:generationJobId", (req, res) => {
    const generationJobId = String(req.params.generationJobId ?? "").trim();
    if (!generationJobId) {
        res.status(400).json({ ok: false, error: "invalid_request", errorCode: "MISSING_GENERATION_JOB_ID", message: "generationJobId is required" });
        return;
    }
    const job = (0, mobile_scenario_generation_manager_1.getMobileScenarioGenerationJob)(generationJobId);
    if (!job) {
        res.status(404).json({ ok: false, error: "generation_job_not_found", errorCode: "GENERATION_JOB_NOT_FOUND", message: `Generation job ${generationJobId} not found` });
        return;
    }
    const scenarioCountByIssue = Object.fromEntries(job.issueProgress.map((entry) => [entry.issueKey, entry.scenarioCount]));
    console.log(`[mobile:scenario-generation:status] requestId=${job.requestId} generationJobId=${job.generationJobId} launchDraftId=${job.launchDraftId ?? "—"} issueKeys=${job.issueKeys.join(",") || "-"} startedAt=${job.startedAt ?? "—"} finishedAt=${job.finishedAt ?? "—"} status=${job.status} consumersWaiting=${job.consumersWaiting} scenariosByIssue=${JSON.stringify(scenarioCountByIssue)}`);
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
exports.mobileRouter.post("/scenarios/preview", async (req, res, next) => {
    try {
        const body = req.body;
        if (!body.projectKey) {
            res.status(400).json({ ok: false, error: "invalid_request", message: "projectKey is required" });
            return;
        }
        if (!body.activeSprint && !body.sprintId) {
            res.status(400).json({ ok: false, error: "invalid_request", message: "activeSprint: true or sprintId is required" });
            return;
        }
        const jiraConfig = (0, env_1.requireJiraConfig)(env_1.config);
        const jira = new jira_client_1.JiraClient(jiraConfig);
        let sprintId;
        if (body.activeSprint) {
            const active = await jira.getActiveSprint(body.projectKey);
            if (!active) {
                res.status(404).json({ ok: false, error: "no_active_sprint", message: `No hay sprint activo para el proyecto ${body.projectKey}` });
                return;
            }
            sprintId = active.id;
        }
        else {
            sprintId = body.sprintId;
        }
        const selectedIssueKeys = Array.isArray(body.selectedIssueKeys)
            ? body.selectedIssueKeys.map((key) => String(key).trim()).filter(Boolean)
            : [];
        const effectiveMaxResults = body.maxResults
            ?? (selectedIssueKeys.length > 0 ? selectedIssueKeys.length : 1);
        const result = await (0, mobile_scenario_generator_1.generateMobileScenarios)(jiraConfig, body.projectKey, sprintId, body.status, effectiveMaxResults, body.appSlug, { selectedIssueKeys });
        res.json({ ok: true, ...result });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/mobile/runs/launch-execution — publishes AI-generated mobile scenarios as
// TestRail cases and creates a TestRail Run, identical to the web
// /api/runs/launch-execution flow (reuses launchExecution() unmodified). Synchronous,
// same as the web endpoint — no device/emulator work happens here.
exports.mobileRouter.post("/runs/launch-execution", async (req, res, next) => {
    try {
        const body = req.body;
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
        // Separate scenarios that need route learning: they are functionally valid but their
        // technical locators lack validated runtime evidence, so they must NOT be published or
        // launched as standard executable scenarios. They remain visible so the user knows the
        // story exists and only needs route learning to become executable.
        const standardScenarios = (body.scenarios ?? []).filter((s) => s.requiresRouteLearning !== true);
        const routeLearningScenarios = (body.scenarios ?? []).filter((s) => s.requiresRouteLearning === true);
        if (routeLearningScenarios.length > 0) {
            console.log(`[runs:launch] routeLearningExcluded=${routeLearningScenarios.length} standard=${standardScenarios.length} reason=requires_route_learning scenarioIds=${routeLearningScenarios.map((s) => s.scenarioId).join(",")}`);
        }
        // Excluding these scenarios is right, but on its own it leaves the story parked until
        // somebody fires the walk by hand. Start it here so a new story reaching unknown screens
        // resolves itself.
        const learningFlowId = routeLearningScenarios.find((s) => s.sourceIssueKey)?.sourceIssueKey;
        const autostart = (0, mobile_route_learning_autostart_1.planRouteLearningAutostart)({
            flowId: learningFlowId,
            flowAlreadyLearned: (0, mobile_route_learning_autostart_1.isFlowAlreadyLearned)((0, mobile_route_profile_1.loadMobileRouteProfile)((body.appSlug ?? "").trim()), learningFlowId),
            appSlug: body.appSlug,
            routeLearningScenarios,
            hasApp: hasResolvableApp(body),
            autoEnabled: body.autoRouteLearning !== false,
            busyJob: (0, mobile_route_learning_autostart_1.findDeviceBusyJob)(job_store_1.jobStore.list()),
            recentWalk: (0, mobile_route_learning_autostart_1.findRecentRouteLearningJob)(job_store_1.jobStore.list(), (body.appSlug ?? "").trim(), learningFlowId, Date.now()),
            base: {
                apkPath: body.apkPath,
                appPackage: body.appPackage,
                appActivity: body.appActivity,
                avdName: body.avdName,
                headless: body.headless,
            },
        });
        let routeLearningJobId = null;
        if (autostart.start && autostart.params) {
            const learningJob = job_store_1.jobStore.create("mobile-route-learning", autostart.params);
            routeLearningJobId = learningJob.id;
            setImmediate(() => (0, mobile_route_learning_runner_1.startMobileRouteLearningJob)(learningJob.id));
            console.log(`[runs:launch] routeLearningAutostarted jobId=${learningJob.id} reason=${autostart.reason} preferLabels=${(autostart.params.preferLabels ?? []).join("|")}`);
        }
        else if (routeLearningScenarios.length > 0) {
            console.log(`[runs:launch] routeLearningAutostartSkipped reason=${autostart.reason}`);
        }
        const routeLearningInfo = {
            routeLearningJobId,
            routeLearningAutostart: { started: autostart.start, reason: autostart.reason },
        };
        if (standardScenarios.length === 0) {
            res.status(202).json({
                ok: true,
                launchId: null,
                status: "requires_route_learning",
                publishedCases: [],
                testRunId: undefined,
                routeLearningScenarios: routeLearningScenarios.map((s) => ({
                    scenarioId: s.scenarioId,
                    sourceIssueKey: s.sourceIssueKey,
                    title: s.title,
                    requiresRouteLearning: true,
                    locatorExecutionBacked: s.locatorExecutionBacked ?? false,
                })),
                ...routeLearningInfo,
                message: routeLearningJobId
                    ? "Todos los escenarios requieren aprendizaje de ruta: se inició la exploración automáticamente. Al terminar, regenera los escenarios."
                    : "Todos los escenarios requieren aprendizaje de ruta: no se publicaron ni ejecutaron como estándar.",
            });
            return;
        }
        const result = await (0, launch_orchestrator_1.launchExecution)({
            appSlug: body.appSlug || "mobile",
            projectId: body.projectId,
            sectionId: body.sectionId,
            testrailSectionId: body.testrailSectionId,
            suiteId: body.suiteId,
            jiraKey: body.jiraKey,
            jiraTitle: body.jiraTitle ?? body.storyTitle,
            sprintName: body.sprintName,
            publishStrategy: body.publishStrategy,
            selectedScenarios: standardScenarios.map(mobile_scenario_generator_1.mobileScenarioToLaunchScenario)
        });
        if (!result.ok) {
            res.status(400).json(result);
            return;
        }
        res.json({
            ...result,
            ...(routeLearningScenarios.length > 0
                ? {
                    routeLearningScenarios: routeLearningScenarios.map((s) => ({
                        scenarioId: s.scenarioId,
                        sourceIssueKey: s.sourceIssueKey,
                        title: s.title,
                        requiresRouteLearning: true,
                        locatorExecutionBacked: s.locatorExecutionBacked ?? false,
                    })),
                    ...routeLearningInfo,
                }
                : {}),
        });
    }
    catch (err) {
        next(err);
    }
});
// POST /api/mobile/runs/execute — runs the scenarios published by launch-execution
// against a real emulator/Appium session and syncs pass/fail back to the TestRail Run
// (reuses syncDiscoveryResultToTestRail() unmodified). Watch progress via
// GET /api/runs/:jobId/logs (SSE).
exports.mobileRouter.post("/runs/execute", (req, res) => {
    const body = (0, mobile_rerun_artifacts_1.normalizeMobileLaunchExecutionParams)(req.body);
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
    // Refuse while a walk holds the emulator. Without this the run starts, fights the walk for the
    // Appium session lock and dies inside session creation as `mobile_session_state_unknown` —
    // which reads as an infrastructure fault and says nothing about the walk that caused it.
    const activeWalk = (0, mobile_route_learning_autostart_1.findActiveRouteLearningJob)(job_store_1.jobStore.list());
    if (activeWalk) {
        console.log(`[runs:execute] rejected reason=route_learning_in_progress jobId=${activeWalk.id}`);
        res.status(409).json({
            ok: false,
            error: "route_learning_in_progress",
            routeLearningJobId: activeWalk.id,
            message: `Hay un aprendizaje de ruta en curso (job ${activeWalk.id}) usando el emulador. ` +
                `Espera a que termine y vuelve a ejecutar; su progreso está en GET /api/runs/${activeWalk.id}/logs.`,
        });
        return;
    }
    const hasApp = hasResolvableApp(body);
    if (!hasApp) {
        res.status(400).json({
            ok: false,
            error: "invalid_request",
            message: "Either apkPath or appPackage is required (in the request body or via ANDROID_APK_PATH/ANDROID_APP_PACKAGE in .env)"
        });
        return;
    }
    const job = job_store_1.jobStore.create("mobile-launch-execution", body);
    try {
        (0, mobile_rerun_artifacts_1.persistMobileExecutionManifest)(job.id, body, {
            sourceJobId: typeof body.sourceJobId === "string"
                ? body.sourceJobId
                : undefined,
        });
    }
    catch (err) {
        console.warn(`[mobile:rerun] failed to persist mobile execution manifest jobId=${job.id} error=${err instanceof Error ? err.message : String(err)}`);
    }
    setImmediate(() => (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJob)(job.id));
    // Surface the HU story + its defect checklist so the front can link straight to it once the run
    // produces defects. Defects are keyed by this issueKey (derived from the scenarioIds). The mobile
    // execution runId (== the execution jobId, the same value logged by `[mobile:run] started runId=`)
    // is appended so the checklist view is isolated to THIS execution's defects only.
    const issueKey = body.scenarios.map((s) => (0, mobile_launch_execution_runner_1.deriveSourceIssueKey)(s.scenarioId)).find(Boolean) || undefined;
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
