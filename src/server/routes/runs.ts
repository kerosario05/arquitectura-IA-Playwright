import { Router } from "express";
import { jobStore } from "../jobs/job-store";
import { startSprintRun } from "../jobs/run-runner";
import { startScenarioRun } from "../jobs/scenario-runner";

export const runsRouter = Router();

runsRouter.post("/sprint", (req, res) => {
  const body = req.body as {
    projectKey?: string;
    sprintId?: number;
    activeSprint?: boolean;
    status?: string;
    maxResults?: number;
    app?: string;
    headed?: boolean;
    autoPromote?: boolean;
    dryRun?: boolean;
    overwrite?: boolean;
  };

  if (!body.projectKey) {
    res.status(400).json({ error: "projectKey is required" });
    return;
  }

  if (!body.activeSprint && !body.sprintId) {
    res.status(400).json({ error: "activeSprint: true or sprintId is required" });
    return;
  }

  const job = jobStore.create("sprint", body as Record<string, unknown>);
  setImmediate(() => startSprintRun(job.id));

  res.status(202).json({ jobId: job.id, status: job.status });
});

// POST /api/runs/from-scenarios
// Acepta el response del preview como body, guarda en TestRail y ejecuta la automatización
runsRouter.post("/from-scenarios", (req, res) => {
  const body = req.body as {
    stories?: unknown[];
    sprint?: { id: number; name: string };
    sectionId?: string;
    app?: string;
    headed?: boolean;
    autoPromote?: boolean;
    overwrite?: boolean;
    force?: boolean;
    autoRepair?: boolean;
    repairTimeoutMs?: number;
  };

  if (!body.stories || !Array.isArray(body.stories) || body.stories.length === 0) {
    res.status(400).json({ error: "stories es requerido — pega el response del preview" });
    return;
  }

  const job = jobStore.create("scenario-run", body as Record<string, unknown>);
  setImmediate(() => startScenarioRun(job.id));

  res.status(202).json({ jobId: job.id, status: job.status });
});

runsRouter.get("/", (_req, res) => {
  res.json({ jobs: jobStore.list() });
});

runsRouter.get("/:jobId", (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

runsRouter.get("/:jobId/logs", (req, res) => {
  const jobId = req.params.jobId;
  const current = jobStore.get(jobId);

  if (!current) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Replay buffered logs immediately
  for (const line of current.logs) {
    send("log", { line });
  }

  // If already finished, close right away
  if (current.status === "done" || current.status === "failed" || current.status === "cancelled") {
    send("done", { status: current.status, exitCode: current.exitCode });
    res.end();
    return;
  }

  const unsubscribe = jobStore.subscribe(jobId, {
    onLog: (line) => send("log", { line }),
    onUpdate: (job) => {
      if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
        send("done", { status: job.status, exitCode: job.exitCode });
        res.end();
      } else {
        send("status", { status: job.status });
      }
    }
  });

  req.on("close", unsubscribe);
});

runsRouter.delete("/:jobId", (req, res) => {
  const internal = jobStore.getInternal(req.params.jobId);
  if (!internal) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (internal.status !== "running") {
    res.status(400).json({ error: `Cannot cancel a job in status: ${internal.status}` });
    return;
  }

  internal.process?.kill("SIGTERM");
  jobStore.update(req.params.jobId, {
    status: "cancelled",
    completedAt: new Date().toISOString()
  });

  res.json({ ok: true, jobId: req.params.jobId });
});
