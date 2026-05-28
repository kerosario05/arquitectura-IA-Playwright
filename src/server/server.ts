import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health";
import { jiraRouter } from "./routes/jira";
import { testrailRouter } from "./routes/testrail";
import { runsRouter } from "./routes/runs";

const PORT = Number(process.env.API_PORT || "3001");
const HOST = process.env.API_HOST || "0.0.0.0";
const CORS_ORIGIN = process.env.API_CORS_ORIGIN || "*";
const API_KEY = process.env.API_KEY || "";

const app = express();

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

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
  console.log(`  POST /api/runs/sprint`);
  console.log(`  GET  /api/runs`);
  console.log(`  GET  /api/runs/:jobId`);
  console.log(`  GET  /api/runs/:jobId/logs  (SSE)`);
  console.log(`  DEL  /api/runs/:jobId\n`);
});
