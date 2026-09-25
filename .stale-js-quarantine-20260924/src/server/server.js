"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("../config/env"); // Load .env before anything else
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const health_1 = require("./routes/health");
const jira_1 = require("./routes/jira");
const testrail_1 = require("./routes/testrail");
const runs_1 = require("./routes/runs");
const scenarios_1 = require("./routes/scenarios");
const mobile_1 = require("./routes/mobile");
const debug_1 = require("./routes/debug");
const checklist_1 = require("./routes/checklist");
const executions_1 = require("./routes/executions");
const internal_otp_1 = require("./routes/internal-otp");
const projects_1 = require("./routes/projects");
const recordings_1 = require("./routes/recordings");
const recording_store_1 = require("../recording/recording-store");
const config_1 = require("./config");
const mobile_utf8_json_1 = require("./middleware/mobile-utf8-json");
const runtime_inputs_1 = require("./routes/runtime-inputs");
const PORT = (0, config_1.resolveServerPort)(process.env);
const HOST = process.env.API_HOST || "0.0.0.0";
const CORS_ORIGIN = process.env.API_CORS_ORIGIN || "*";
const API_KEY = process.env.API_KEY || "";
const app = (0, express_1.default)();
const JSON_LIMIT = process.env.RECORDING_JSON_LIMIT ?? "2mb";
app.use((0, cors_1.default)({ origin: CORS_ORIGIN }));
app.use(express_1.default.json({
    limit: JSON_LIMIT,
    verify: (req, res, buf) => {
        (0, mobile_utf8_json_1.captureRawJsonBody)(req, res, buf);
    },
}));
app.use((err, req, res, next) => {
    if (err?.type === "entity.too.large" || err?.status === 413) {
        console.warn(`[recording-transport] 413 method=${req.method} path=${req.path} contentType=${req.headers["content-type"] ?? ""} contentLength=${req.headers["content-length"] ?? "unknown"} configuredJsonLimit=${JSON_LIMIT}`);
        res.status(413).json({ ok: false, errorCode: "PAYLOAD_TOO_LARGE", message: "No se pudo guardar la actualización de Recording porque la solicitud excedió el límite permitido." });
        return;
    }
    next(err);
});
app.use((0, mobile_utf8_json_1.mobileUtf8JsonReconciler)());
// Ensure UTF-8 encoding for all JSON responses
app.use((req, res, next) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    next();
});
if (API_KEY) {
    app.use((req, res, next) => {
        if (req.path === "/health")
            return next();
        if (req.headers["x-api-key"] !== API_KEY) {
            res.status(401).json({ error: "Unauthorized — missing or invalid X-Api-Key header" });
            return;
        }
        next();
    });
}
app.use(health_1.healthRouter);
app.use("/api/jira", jira_1.jiraRouter);
app.use("/api/testrail", testrail_1.testrailRouter);
app.use("/api/runs", runs_1.runsRouter);
app.use("/api/scenarios", scenarios_1.scenariosRouter);
app.use("/api/mobile", mobile_1.mobileRouter);
app.use("/api/internal/otp", internal_otp_1.internalOtpRouter);
app.use("/api/projects", projects_1.projectsRouter);
app.use("/api/recordings", recordings_1.recordingsRouter);
app.use(checklist_1.checklistRouter);
app.use(executions_1.executionsRouter);
app.use(runtime_inputs_1.runtimeInputsRouter);
const isDebugEnabled = process.env.NODE_ENV !== "production" ||
    process.env.DEBUG_TESTRAIL_ENDPOINTS === "true";
if (isDebugEnabled) {
    app.use("/api/debug", debug_1.debugRouter);
}
app.use((err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[server] Error:`, message);
    res.status(500).json({ error: message });
});
// Screenshots from a crashed recording must never survive a restart: they were only ever
// meant to feed one derivation pass.
const sweptFrames = (0, recording_store_1.sweepOrphanFrames)();
if (sweptFrames > 0)
    console.log(`[server] limpieza: ${sweptFrames} carpetas de frames huérfanos eliminadas`);
const server = app.listen(PORT, HOST, () => {
    console.log(`\n[server] Automation Engine API → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
    console.log(`[server] CORS origin : ${CORS_ORIGIN}`);
    console.log(`[server] Auth        : ${API_KEY ? "API key enabled (X-Api-Key header)" : "disabled"}`);
    console.log(`\n[server] Endpoints disponibles:`);
    console.log(`  GET  /health`);
    console.log(`  GET  /api/jira/projects`);
    console.log(`  GET  /api/jira/projects/:key/sprints`);
    console.log(`  GET  /api/jira/projects/:key/sprint/active`);
    console.log(`  GET  /api/jira/issues?projectId=...&sprintId=...&status=...`);
    console.log(`  GET  /api/testrail/status`);
    console.log(`  GET  /api/testrail/runs`);
    console.log(`  GET  /api/testrail/sections`);
    console.log(`  POST /api/testrail/cases/preview`);
    console.log(`  POST /api/recordings/start   { projectSlug, label? }`);
    console.log(`  GET  /api/recordings?projectSlug=...`);
    console.log(`  GET  /api/recordings/:recordingId`);
    console.log(`  POST /api/recordings/:recordingId/stop`);
    console.log(`  POST /api/recordings/:recordingId/derive`);
    console.log(`  GET  /api/recordings/:recordingId/scenarios`);
    console.log(`  PUT  /api/recordings/:recordingId/scenario-value`);
    console.log(`  POST /api/recordings/:recordingId/execute`);
    console.log(`  POST /api/recordings/:recordingId/testrail`);
    console.log(`  POST /api/runs/scenario-preview`);
    console.log(`  POST /api/runs/discovery-batch`);
    console.log(`  POST /api/runs/sprint`);
    console.log(`  GET  /api/runs`);
    console.log(`  GET  /api/runs/:jobId`);
    console.log(`  GET  /api/runs/:jobId/logs  (SSE)`);
    console.log(`  DEL  /api/runs/:jobId`);
    console.log(`  POST /api/runs/:jobId/rerun  { mode: "failed_only" | "all" }`);
    console.log(`  POST /api/runs/launch-execution  { appSlug, projectId, sectionId, selectedScenarios, existingTestRailCaseIds? }`);
    console.log(`  GET  /api/scenarios/preview?projectKey=AA&sprintId=42&status=...`);
    console.log(`  POST /api/scenarios/preview  { projectKey, sprintId|activeSprint, status }`);
    console.log(`  POST /api/mobile/emulator/start  { avdName?, headless? }`);
    console.log(`  GET  /api/mobile/emulator/status`);
    console.log(`  POST /api/mobile/emulator/stop`);
    console.log(`  GET  /api/mobile/appium/status`);
    console.log(`  POST /api/mobile/tests/run  { apkPath|appPackage, appActivity?, steps, dataOverrides? }`);
    console.log(`  POST /api/mobile/scenarios/preview  { projectKey, sprintId|activeSprint, status }`);
    console.log(`  POST /api/mobile/scenarios/generation  { projectKey, sprintId|activeSprint, status, appSlug, selectedIssueKeys? }`);
    console.log(`  GET  /api/mobile/scenarios/generation/:generationJobId`);
    console.log(`  POST /api/mobile/runs/launch-execution  { appSlug, projectId, sectionId, scenarios }`);
    console.log(`  POST /api/mobile/runs/execute  { launchId, testRunId, publishedCases, scenarios, dataOverrides? }`);
    console.log(`  POST /api/internal/otp/local-token/generate  { identity, channel, appSlug }`);
    console.log(`  POST /api/internal/otp/local-token/latest  { identity, channel, appSlug, generatedAfter, requestId? }`);
    if (isDebugEnabled) {
        console.log(`\n[server] Debug endpoints (dev-only):`);
        console.log(`  GET  /api/debug/testrail/status`);
        console.log(`  POST /api/debug/testrail/publish-scenario`);
        console.log(`         DEBUG_TESTRAIL_PAYLOAD=${process.env.DEBUG_TESTRAIL_PAYLOAD ?? "false"} (set to true for full payload in response)`);
    }
    console.log("");
});
server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error(`\n[server] Error: port ${PORT} is already in use — another process (possibly a previous "npm run server" instance) is already listening there.`);
        console.error(`[server] Run "lsof -i :${PORT}" to find it, or set PORT/API_PORT in .env to use a different port.`);
    }
    else {
        console.error(`\n[server] Failed to start:`, err.message);
    }
    process.exit(1);
});
