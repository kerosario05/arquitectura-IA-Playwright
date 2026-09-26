import "../config/env"; // Load .env before anything else
import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health";
import { jiraRouter } from "./routes/jira";
import { testrailRouter } from "./routes/testrail";
import { runsRouter } from "./routes/runs";
import { scenariosRouter } from "./routes/scenarios";
import { mobileRouter } from "./routes/mobile";
import { debugRouter } from "./routes/debug";
import { checklistRouter } from "./routes/checklist";
import { executionsRouter } from "./routes/executions";
import { internalOtpRouter } from "./routes/internal-otp";
import { projectsRouter } from "./routes/projects";
import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { rolesRouter, permissionsRouter } from "./routes/roles";
import { recordingsRouter } from "./routes/recordings";
import { sweepOrphanFrames } from "../recording/recording-store";
import { jobStore } from "./jobs/job-store";
import { resolveServerPort } from "./config";
import { captureRawJsonBody, mobileUtf8JsonReconciler } from "./middleware/mobile-utf8-json";
import { runtimeInputsRouter } from "./routes/runtime-inputs";
import { attachPrincipal, isPublicPath, requireFullScope } from "./middleware/auth";
import { enforceRoutePolicy } from "./middleware/route-policy";
import { resolveAuthConfig } from "../auth/config";

const PORT = resolveServerPort(process.env as Record<string, string | undefined>);
const HOST = process.env.API_HOST || "0.0.0.0";
const CORS_ORIGIN = process.env.API_CORS_ORIGIN || "*";
const API_KEY = process.env.API_KEY || "";
const AUTH_ENABLED = resolveAuthConfig().enabled;

const app = express();
const JSON_LIMIT = process.env.RECORDING_JSON_LIMIT ?? "2mb";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({
  limit: JSON_LIMIT,
  verify: (req, res, buf) => {
    captureRawJsonBody(req, res, buf);
  },
}));
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err?.type === "entity.too.large" || err?.status === 413) {
    console.warn(`[recording-transport] 413 method=${req.method} path=${req.path} contentType=${req.headers["content-type"] ?? ""} contentLength=${req.headers["content-length"] ?? "unknown"} configuredJsonLimit=${JSON_LIMIT}`);
    res.status(413).json({ ok: false, errorCode: "PAYLOAD_TOO_LARGE", message: "No se pudo guardar la actualización de Recording porque la solicitud excedió el límite permitido." });
    return;
  }
  next(err);
});
app.use(mobileUtf8JsonReconciler());

// Ensure UTF-8 encoding for all JSON responses
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

// Identity pipeline. `attachPrincipal` resolves an X-Api-Key or a bearer session
// into req.principal without rejecting; the gate below turns "no principal" into
// a 401, and `requireFullScope` keeps a pending password change unskippable.
app.use(attachPrincipal());
app.use((req, res, next) => {
  if (isPublicPath(req.path)) return next();
  if (req.principal) return next();
  if (API_KEY && !AUTH_ENABLED) {
    res.status(401).json({ error: "Unauthorized — missing or invalid X-Api-Key header" });
    return;
  }
  res.status(401).json({
    ok: false,
    error: "missing_token",
    message: "Se requiere iniciar sesión",
  });
});
app.use(requireFullScope());
// Declarative per-route permissions and project scoping (see route-policy.ts).
app.use(enforceRoutePolicy());

app.use(healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/permissions", permissionsRouter);
app.use("/api/jira", jiraRouter);
app.use("/api/testrail", testrailRouter);
app.use("/api/runs", runsRouter);
app.use("/api/scenarios", scenariosRouter);
app.use("/api/mobile", mobileRouter);
app.use("/api/internal/otp", internalOtpRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/recordings", recordingsRouter);
app.use(checklistRouter);
app.use(executionsRouter);
app.use(runtimeInputsRouter);

const isDebugEnabled =
  process.env.NODE_ENV !== "production" ||
  process.env.DEBUG_TESTRAIL_ENDPOINTS === "true";
if (isDebugEnabled) {
  app.use("/api/debug", debugRouter);
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[server] Error:`, message);
  res.status(500).json({ error: message });
});

// Screenshots from a crashed recording must never survive a restart: they were only ever
// meant to feed one derivation pass.
const sweptFrames = sweepOrphanFrames();
if (sweptFrames > 0) console.log(`[server] limpieza: ${sweptFrames} carpetas de frames huérfanos eliminadas`);

// Jobs live in SQLite, so a restart no longer loses the run list. Anything that
// was still running belonged to the dead process and is closed out as failed.
const JOB_RETENTION_DAYS = Number(process.env.JOB_RETENTION_DAYS ?? 30);
jobStore
  .hydrate({ retentionDays: Number.isFinite(JOB_RETENTION_DAYS) ? JOB_RETENTION_DAYS : 30 })
  .then(({ restored, interrupted, pruned }) => {
    console.log(
      `[server] jobs      : ${restored} recuperados de SQLite` +
        (interrupted > 0 ? `, ${interrupted} marcados como interrumpidos` : "") +
        (pruned > 0 ? `, ${pruned} purgados por antigüedad` : ""),
    );
  })
  .catch((err) => {
    console.error(`[server] no se pudieron recuperar los jobs:`, err instanceof Error ? err.message : err);
  });

// Give the write-behind queue a chance to land before the process exits.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    jobStore
      .drain()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
}

const server = app.listen(PORT, HOST, () => {
  console.log(`\n[server] Automation Engine API → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`[server] CORS origin : ${CORS_ORIGIN}`);
  console.log(`[server] Auth        : ${AUTH_ENABLED ? "sesiones de usuario (Bearer)" : "sesiones opcionales"}` +
    `${API_KEY ? " + API key (X-Api-Key)" : ""}`);
  console.log(`\n[server] Endpoints disponibles:`);
  console.log(`  GET  /health`);
  console.log(`  POST /api/auth/login          { username, password }`);
  console.log(`  POST /api/auth/logout`);
  console.log(`  GET  /api/auth/me`);
  console.log(`  POST /api/auth/change-password { currentPassword, newPassword }`);
  console.log(`  GET  /api/auth/permissions`);
  console.log(`  GET  /api/permissions`);
  console.log(`  GET  /api/users?enabled=&role=&q=`);
  console.log(`  POST /api/users            { username, fullName, email?, password?, roles[], allProjects?, projects[] }`);
  console.log(`  GET  /api/users/:id`);
  console.log(`  PATCH /api/users/:id       { fullName?, email?, username?, enabled? }`);
  console.log(`  DEL  /api/users/:id        (desactiva)`);
  console.log(`  POST /api/users/:id/reset-password  { password? }`);
  console.log(`  PUT  /api/users/:id/roles           { roles: [slug|id] }`);
  console.log(`  PUT  /api/users/:id/projects        { allProjects?, projects[] }`);
  console.log(`  GET  /api/users/:id/audit`);
  console.log(`  GET  /api/roles`);
  console.log(`  POST /api/roles            { slug, name, description?, permissions[] }`);
  console.log(`  GET  /api/roles/:id`);
  console.log(`  PATCH /api/roles/:id       { name?, description? }`);
  console.log(`  PUT  /api/roles/:id/permissions  { permissions[] }`);
  console.log(`  DEL  /api/roles/:id`);
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
  console.log(`  POST /api/recordings/:recordingId/control`);
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

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n[server] Error: port ${PORT} is already in use — another process (possibly a previous "npm run server" instance) is already listening there.`);
    console.error(`[server] Run "lsof -i :${PORT}" to find it, or set PORT/API_PORT in .env to use a different port.`);
  } else {
    console.error(`\n[server] Failed to start:`, err.message);
  }
  process.exit(1);
});
