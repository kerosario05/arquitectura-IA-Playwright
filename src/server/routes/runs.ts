import { Router } from "express";
import { jobStore } from "../jobs/job-store";
import { startSprintRun } from "../jobs/run-runner";
import { startDiscoveryBatchRun } from "../jobs/discovery-batch-runner";
import { startScenarioPreviewRun } from "../jobs/scenario-preview-runner";
import type { McpScenario } from "../../scenarios/scenario-types";

export const runsRouter = Router();

const SENSITIVE_PATTERNS = [
  /delete\s+all/i,
  /drop\s+table/i,
  /truncate\s+table/i,
  /format\s+disk/i,
  /rm\s+-rf/i,
  /sudo\s+rm/i,
];

function containsSensitiveAction(steps: string[]): boolean {
  return steps.some((step) => SENSITIVE_PATTERNS.some((p) => p.test(step)));
}

const TECHNICAL_SLUGS = new Set(["tests", "test", "api-tests", "api tests", "qa-tests", "qa tests", "default", "unknown", "undefined", "null"]);

function isTechnicalSlug(slug: string | undefined): boolean {
  if (!slug) return true;
  return TECHNICAL_SLUGS.has(slug.trim().toLowerCase());
}

function normalizeMaybeSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inferTargetAppSlug(body: {
  functionalAppSlug?: string;
  appSlug?: string;
  targetAppSlug?: string;
  scenarios?: McpScenario[];
}): { effectiveTargetAppSlug?: string; scenarioTargetAppSlugs: string[]; titlesSample: string[] } {
  const functionalAppSlug = normalizeMaybeSlug(body.functionalAppSlug);
  const scenarioTargetAppSlugs = Array.from(
    new Set(
      (body.scenarios ?? [])
        .map((scenario) => normalizeMaybeSlug(scenario.targetAppSlug))
        .filter((slug): slug is string => Boolean(slug)),
    ),
  );
  const titlesSample = (body.scenarios ?? [])
    .map((scenario) => scenario.title)
    .filter((title): title is string => typeof title === "string" && title.trim().length > 0)
    .slice(0, 3);
  const requestTargetAppSlug = normalizeMaybeSlug(body.targetAppSlug);
  const requestAppSlug = normalizeMaybeSlug(body.appSlug);

  if (functionalAppSlug && !isTechnicalSlug(functionalAppSlug)) {
    return { effectiveTargetAppSlug: functionalAppSlug, scenarioTargetAppSlugs, titlesSample };
  }

  const scenarioTarget = scenarioTargetAppSlugs.find((slug) => !isTechnicalSlug(slug));
  if (scenarioTarget) return { effectiveTargetAppSlug: scenarioTarget, scenarioTargetAppSlugs, titlesSample };
  if (requestTargetAppSlug && !isTechnicalSlug(requestTargetAppSlug)) {
    return { effectiveTargetAppSlug: requestTargetAppSlug, scenarioTargetAppSlugs, titlesSample };
  }
  if (requestAppSlug && !isTechnicalSlug(requestAppSlug)) {
    return { effectiveTargetAppSlug: requestAppSlug, scenarioTargetAppSlugs, titlesSample };
  }
  return { scenarioTargetAppSlugs, titlesSample };
}

export function buildRunStreamPayload(
  job: {
    status: string;
    exitCode?: number;
    summary?: Record<string, unknown>;
    errorMessage?: string;
    currentCase?: string | null;
  },
  terminal = false,
) {
  const payload = {
    status: job.status,
    summary: job.summary,
    currentCase: job.currentCase,
    ...(terminal ? {
      exitCode: job.exitCode,
      errorMessage: job.errorMessage ?? (job.summary as any)?.errorMessage,
    } : {}),
  };
  return payload;
}

runsRouter.post("/scenario-preview", (req, res) => {
  const body = req.body as {
    functionalAppSlug?: string;
    appSlug?: string;
    targetAppSlug?: string;
    targetAppName?: string;
    sectionName?: string;
    testrailProjectId?: number;
    testrailSuiteId?: number;
    testrailSectionId?: number;
    publishToTestRail?: boolean;
    createTestRun?: boolean;
    reportResults?: boolean;
    source?: {
      projectKey: string;
      sprintId?: number;
      status?: string;
    };
    scenarios?: McpScenario[];
    options?: {
      overwrite?: boolean;
      autoPromote?: boolean;
      autoPom?: boolean;
      rerunActive?: boolean;
      headed?: boolean;
    };
  };

  if (!body.scenarios || body.scenarios.length === 0) {
    res.status(400).json({
      ok: false,
      error: "invalid_preview_scenarios",
      message: "No hay escenarios válidos para ejecutar.",
    });
    return;
  }

  const validScenarios = body.scenarios.filter(
    (s) => s.mcpExecutable === true && s.validation?.valid !== false
  );

  if (validScenarios.length === 0) {
    res.status(400).json({
      ok: false,
      error: "invalid_preview_scenarios",
      message: "No hay escenarios válidos para ejecutar.",
    });
    return;
  }

  for (const sc of validScenarios) {
    if (!sc.steps || sc.steps.length === 0) {
      res.status(400).json({
        ok: false,
        error: "invalid_preview_scenarios",
        message: `El escenario "${sc.sourceIssueKey}" no tiene steps.`,
      });
      return;
    }
    if (containsSensitiveAction(sc.steps)) {
      res.status(400).json({
        ok: false,
        error: "sensitive_action_blocked",
        message: `El escenario "${sc.sourceIssueKey}" contiene acciones sensibles no permitidas.`,
      });
      return;
    }
  }

  const inferred = inferTargetAppSlug({ ...body, scenarios: validScenarios });
  const inferredTargetAppSlug = inferred.effectiveTargetAppSlug;
  const inferredTargetAppName = body.targetAppName ?? validScenarios[0]?.targetAppName;

  if (!body.appSlug && !body.targetAppSlug) {
    res.status(400).json({
      ok: false,
      error: "invalid_preview_scenarios",
      message: "appSlug es requerido.",
    });
    return;
  }

  const requiresTestRailSync = body.publishToTestRail === true || body.createTestRun === true || body.reportResults === true;
  if (requiresTestRailSync) {
    if (!body.testrailProjectId || !body.testrailSuiteId || !body.testrailSectionId) {
      res.status(400).json({
        ok: false,
        error: "invalid_preview_scenarios",
        message: "projectId, suiteId y sectionId son requeridos para publicar y reportar en TestRail.",
      });
      return;
    }
  }

  const jobPayload = {
    ...body,
    targetAppSlug: inferredTargetAppSlug,
    targetAppName: inferredTargetAppName,
  };

  const job = jobStore.create("scenario-preview", jobPayload as Record<string, unknown>);
  setImmediate(() => startScenarioPreviewRun(job.id));

  res.status(202).json({
    ok: true,
    jobId: job.id,
    status: job.status,
    mode: "scenario-preview",
    scenarioCount: validScenarios.length,
  });
});

runsRouter.post("/discovery-batch", (req, res) => {
  const body = req.body as {
    caseIds?: number[];
    appSlug?: string;
    sectionName?: string;
    overwrite?: boolean;
    autoPromote?: boolean;
    autoPom?: boolean;
    rerunActive?: boolean;
    headed?: boolean;
  };

  if (!body.caseIds || body.caseIds.length === 0) {
    res.status(400).json({ error: "caseIds is required and must be a non-empty array" });
    return;
  }

  const invalidIds = body.caseIds.filter((id: number) => !Number.isInteger(id) || id <= 0);
  if (invalidIds.length > 0) {
    res.status(400).json({ error: "All caseIds must be positive integers", invalidIds });
    return;
  }

  const job = jobStore.create("discovery-batch", body as Record<string, unknown>);
  setImmediate(() => startDiscoveryBatchRun(job.id));

  res.status(202).json({ jobId: job.id, status: job.status });
});

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
    send("done", buildRunStreamPayload({
      status: current.status,
      exitCode: current.exitCode,
      summary: current.summary,
      errorMessage: current.errorMessage,
      currentCase: (current as any).currentCase,
    }, true));
    res.end();
    return;
  }

  if (current.status === "completed_with_failures") {
    send("done", buildRunStreamPayload({
      status: current.status,
      exitCode: current.exitCode,
      summary: current.summary,
      errorMessage: current.errorMessage,
      currentCase: (current as any).currentCase,
    }, true));
    res.end();
    return;
  }

  const unsubscribe = jobStore.subscribe(jobId, {
    onLog: (line) => send("log", { line }),
    onUpdate: (job) => {
      if (job.status === "done" || job.status === "failed" || job.status === "cancelled" || job.status === "completed_with_failures") {
        send("done", buildRunStreamPayload({
          status: job.status,
          exitCode: job.exitCode,
          summary: job.summary,
          errorMessage: job.errorMessage,
          currentCase: (job as any).currentCase,
        }, true));
        res.end();
      } else {
        send("status", buildRunStreamPayload({
          status: job.status,
          summary: job.summary,
          currentCase: (job as any).currentCase,
        }));
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
