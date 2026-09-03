import { Router } from "express";
import { config, requireJiraConfig } from "../../config/env";
import { JiraClient } from "../../clients/jira.client";
import { normalizeJiraIssues } from "../../jira/jira-normalizer";
import type { TestScenario } from "../../types/testrail.types";
import { generateScenarioPreview } from "../../scenarios/scenario-preview.service";
import type { ScenarioPreviewRequest } from "../../scenarios/scenario-types";
import { planRouteDiscovery } from "../../scenarios/route-discovery-planner";
import { runGuidedRouteDiscovery } from "../../scenarios/guided-route-discovery";
import { executeApprovedDiscoveryCandidate } from "../../scenarios/approved-candidate-execution";
import type { ApprovedDiscoveryCandidateExecutionRequest } from "../../scenarios/scenario-types";
import type { RouteDiscoveryPlanRequest, GuidedRouteDiscoveryRequest } from "../../scenarios/scenario-types";

export const scenariosRouter = Router();

function buildJql(projectKey: string, sprintId: number, status?: string): string {
  const parts = [`project = "${projectKey}"`, `sprint = ${sprintId}`];
  if (status) parts.push(`status = "${status}"`);
  return parts.join(" AND ") + " ORDER BY created DESC";
}

function toTestRailFormat(scenario: TestScenario) {
  const stepsSeparated = scenario.steps.map((s) => ({
    content: s.action,
    expected: s.expected ?? ""
  }));
  const stepsText = scenario.steps
    .map((s, i) => `${i + 1}. ${s.action}${s.expected ? `\nEsperado: ${s.expected}` : ""}`)
    .join("\n");

  return {
    title: scenario.title,
    refs: scenario.externalId,
    custom_preconds: scenario.preconditions ?? null,
    custom_steps_separated: stepsSeparated,
    custom_steps: stepsText
  };
}

// POST /api/scenarios/preview — MCP-ready generation
scenariosRouter.post("/preview", async (req, res, next) => {
  try {
    const body = req.body as ScenarioPreviewRequest;
    // NEW: Log incoming request to diagnose issue selection
    console.log(
      `[scenarios:endpoint] POST /preview received projectKey=${body.projectKey} ` +
      `sprintId=${body.sprintId} activeSprint=${body.activeSprint} ` +
      `selectedIssueKeys=${body.selectedIssueKeys ? JSON.stringify(body.selectedIssueKeys) : "undefined"} ` +
      `status=${body.status ?? "any"}`
    );
    const result = await generateScenarioPreview(body);

    const _dbg = (result as any).scenarios ?? [];
    for (const _sc of _dbg) { console.log('[scenario-id-trace] BACKEND_HTTP_OUT=' + JSON.stringify({ bucket: 'scenario', title: _sc?.title ?? '', scenarioId: _sc?.scenarioId ?? '', id: _sc?.id ?? '', sourceIssueKey: _sc?.sourceIssueKey ?? '' })); }

    if (!result.ok) {
      const errorResult = result as Extract<typeof result, { ok: false }>;
      const status = errorResult.error === "no_active_sprint" ? 404 : errorResult.error === "invalid_request" ? 400 : 502;
      res.status(status).json(errorResult);
      return;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/scenarios/route-discovery/plan — Generic route discovery planner
// Does NOT execute browser navigation. Returns a contract for guided route discovery.
scenariosRouter.post("/route-discovery/plan", async (req, res, next) => {
  try {
    const body = req.body as RouteDiscoveryPlanRequest;

    if (!body.appSlug || !body.issueKey || !body.huIntent || !body.reasonCode) {
      console.log(`[route-discovery-plan] skipped reason=insufficient_payload`);
      res.status(400).json({
        ok: false,
        error: "insufficient_payload",
        message: "appSlug, issueKey, huIntent, reasonCode are required"
      });
      return;
    }

    const result = planRouteDiscovery(body);

    if (!result.ok) {
      const errorResult = result as Extract<typeof result, { ok: false }>;
      res.status(400).json(errorResult);
      return;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/scenarios/route-discovery/run — Generic guided route discovery execution
//
// dryRun=true: returns a plan (status="planned")
// dryRun=false:
//   status="candidate_found"       → 200
//   status="no_candidate_found"    → 200
//   status="insufficient_runtime_context" → 409
//   status="execution_failed"      → 500
scenariosRouter.post("/route-discovery/run", async (req, res, next) => {
  try {
    const body = req.body as GuidedRouteDiscoveryRequest;

    if (!body.appSlug || !body.issueKey || !body.huIntent || !body.reasonCode) {
      console.log(`[guided-route-discovery] skipped reason=insufficient_payload`);
      res.status(400).json({
        ok: false,
        status: "insufficient_payload",
        discoveryType: "intent_route_discovery",
        recommendedMode: "guided_route_discovery",
        nextAction: "provide_required_fields",
        appSlug: body.appSlug ?? "",
        issueKey: body.issueKey ?? "",
        huIntent: body.huIntent ?? "",
        reasonCode: body.reasonCode ?? "",
        candidateRoute: null,
        observations: [],
        warnings: ["appSlug, issueKey, huIntent, reasonCode are required"],
        message: "insufficient_payload",
        dryRun: body.dryRun !== false
      });
      return;
    }

    const result = await runGuidedRouteDiscovery(body);

    if (result.status === "insufficient_payload") {
      res.status(400).json(result);
      return;
    }

    if (result.status === "insufficient_runtime_context") {
      res.status(409).json(result);
      return;
    }

    if (result.status === "execution_failed") {
      res.status(500).json(result);
      return;
    }

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

scenariosRouter.post("/route-discovery/execute-candidate", async (req, res, next) => {
  try {
    const result = await executeApprovedDiscoveryCandidate(req.body as ApprovedDiscoveryCandidateExecutionRequest);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) { next(err); }
});

// GET /api/scenarios/preview?projectKey=AA&sprintId=42&status=Desestimado
scenariosRouter.get("/preview", async (req, res, next) => {
  try {
    const { projectKey, sprintId, activeSprint, status, maxResults } = req.query as Record<string, string>;

    if (!projectKey) {
      res.status(400).json({ error: "projectKey is required" });
      return;
    }
    if (!activeSprint && !sprintId) {
      res.status(400).json({ error: "activeSprint=true or sprintId is required" });
      return;
    }

    const jiraConfig = requireJiraConfig(config);
    const jira = new JiraClient(jiraConfig);

    let resolvedSprintId: number;
    let sprint: { id: number; name: string };

    if (activeSprint === "true") {
      const active = await jira.getActiveSprint(projectKey);
      if (!active) {
        res.status(404).json({ error: `No hay sprint activo para el proyecto ${projectKey}` });
        return;
      }
      resolvedSprintId = active.id;
      sprint = { id: active.id, name: active.name };
    } else {
      resolvedSprintId = Number(sprintId);
      sprint = { id: resolvedSprintId, name: `Sprint ${resolvedSprintId}` };
    }

    const jql = buildJql(projectKey, resolvedSprintId, status);
    const rawIssues = await jira.searchIssues(jql, undefined, Number(maxResults) || 50);
    const scenarios = normalizeJiraIssues(rawIssues, {
      acceptanceCriteriaField: jiraConfig.acceptanceCriteriaField
    });

    const result = scenarios.map((scenario) => ({
      jiraKey: scenario.externalId,
      title: scenario.title,
      stepCount: scenario.steps.length,
      testrailFormat: toTestRailFormat(scenario)
    }));

    res.json({
      sprint,
      jql,
      total: result.length,
      scenarios: result
    });
  } catch (err) {
    next(err);
  }
});
