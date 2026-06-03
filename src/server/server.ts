import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health";
import { jiraRouter } from "./routes/jira";
import { testrailRouter } from "./routes/testrail";
import { runsRouter } from "./routes/runs";
import { scenariosRouter } from "./routes/scenarios";
import { debugRouter } from "./routes/debug";

const PORT = Number(process.env.API_PORT || "3001");
const HOST = process.env.API_HOST || "0.0.0.0";
const CORS_ORIGIN = process.env.API_CORS_ORIGIN || "*";
const API_KEY = process.env.API_KEY || "";

const app = express();

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "50mb" }));

// Ensure UTF-8 encoding for all JSON responses
app.use((req, res, next) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  next();
});

if (API_KEY) {
  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    if (req.headers["x-api-key"] !== API_KEY) {
      res.status(401).json({ error: "Unauthorized — missing or invalid X-Api-Key header" });
      return;
    }
    next();
  });
}

app.use(healthRouter);
app.use("/api/jira", jiraRouter);
app.use("/api/testrail", testrailRouter);
app.use("/api/runs", runsRouter);
app.use("/api/scenarios", scenariosRouter);

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

app.listen(PORT, HOST, () => {
  console.log(`\n[server] Automation Engine API → http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`[server] CORS origin : ${CORS_ORIGIN}`);
  console.log(`[server] Auth        : ${API_KEY ? "API key enabled (X-Api-Key header)" : "disabled"}`);
  console.log(`\n[server] Endpoints disponibles:`);
  console.log(`  GET  /health`);
  console.log(`  GET  /api/jira/projects`);
  console.log(`  GET  /api/jira/projects/:key/sprints`);
  console.log(`  GET  /api/jira/projects/:key/sprint/active`);
  console.log(`  GET  /api/testrail/status`);
  console.log(`  GET  /api/testrail/runs`);
  console.log(`  GET  /api/testrail/sections`);
  console.log(`  POST /api/testrail/cases/preview`);
  console.log(`  POST /api/runs/sprint`);
  console.log(`  GET  /api/runs`);
  console.log(`  GET  /api/runs/:jobId`);
  console.log(`  GET  /api/runs/:jobId/logs  (SSE)`);
  console.log(`  DEL  /api/runs/:jobId`);
  console.log(`  GET  /api/scenarios/preview?projectKey=AA&sprintId=42&status=...`);
  console.log(`  POST /api/scenarios/preview  { projectKey, sprintId|activeSprint, status }`);
  if (isDebugEnabled) {
    console.log(`\n[server] Debug endpoints (dev-only):`);
    console.log(`  GET  /api/debug/testrail/status`);
    console.log(`  POST /api/debug/testrail/publish-scenario`);
    console.log(`         DEBUG_TESTRAIL_PAYLOAD=${process.env.DEBUG_TESTRAIL_PAYLOAD ?? "false"} (set to true for full payload in response)`);
  }
  console.log("");
});
