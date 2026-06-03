import { Router } from "express";
import { config, requireJiraConfig } from "../../config/env";
import { JiraClient } from "../../clients/jira.client";
import { normalizeJiraIssues } from "../../jira/jira-normalizer";
import type { TestScenario } from "../../types/testrail.types";
import { generateScenarioPreview } from "../../scenarios/scenario-preview.service";
import type { ScenarioPreviewRequest } from "../../scenarios/scenario-types";

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
    const result = await generateScenarioPreview(body);

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
