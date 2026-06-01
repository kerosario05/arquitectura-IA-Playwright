import { Router } from "express";
import { config, requireTestRailConfig, requireJiraConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import { JiraClient } from "../../clients/jira.client";
import { normalizeJiraIssue } from "../../jira/jira-normalizer";
import { extractTextFromAdf } from "../../jira/adf-extractor";
import { createAiProviderFromEnv } from "../../ai/ai-provider-factory";
import { generateScenariosForStory } from "../../testrail/scenario-generator";

export const testrailRouter = Router();

function client(): TestRailClient {
  return new TestRailClient(requireTestRailConfig(config));
}

testrailRouter.get("/status", async (_req, res, next) => {
  try {
    const result = await client().testConnection();
    res.json({
      ok: result.ok,
      userEmail: result.userEmail,
      projectId: config.integrations.testRail?.projectId,
      suiteId: config.integrations.testRail?.suiteId,
      sectionId: config.integrations.testRail?.sectionId
    });
  } catch (err) {
    next(err);
  }
});

testrailRouter.get("/projects", async (req, res, next) => {
  try {
    const tr = client();
    const withCounts = req.query["counts"] === "true";
    const projects = await tr.getProjects();

    const enriched = await Promise.all(
      projects.map(async (project) => {
        try {
          const suites = await tr.getSuites(String(project.id));

          if (!withCounts) {
            return { ...project, suites };
          }

          const suitesWithCounts = await Promise.all(
            suites.map(async (suite) => {
              const { count, hasMore } = await tr.getCaseCount(String(project.id), String(suite.id));
              return { ...suite, caseCount: count, caseCountApproximate: hasMore };
            })
          );
          const totalCaseCount = suitesWithCounts.reduce((sum, s) => sum + s.caseCount, 0);
          return { ...project, suites: suitesWithCounts, totalCaseCount };
        } catch {
          return { ...project, suites: [] };
        }
      })
    );

    res.json({ projects: enriched });
  } catch (err) {
    next(err);
  }
});

testrailRouter.get("/projects/:projectId/suites", async (req, res, next) => {
  try {
    const suites = await client().getSuites(req.params.projectId);
    res.json({ suites });
  } catch (err) {
    next(err);
  }
});

testrailRouter.get("/projects/:projectId/suites/:suiteId/sections", async (req, res, next) => {
  try {
    const sections = await client().getSections(req.params.projectId, req.params.suiteId);
    res.json({ sections });
  } catch (err) {
    next(err);
  }
});

// GET /api/testrail/sections?projectId=1&suiteId=2
// projectId es requerido; suiteId es opcional (fallback al configurado en .env)
testrailRouter.get("/sections", async (req, res, next) => {
  try {
    const projectId = (req.query["projectId"] as string) || config.integrations.testRail?.projectId;
    const suiteId = (req.query["suiteId"] as string) || config.integrations.testRail?.suiteId;
    if (!projectId) {
      res.status(400).json({ error: "projectId es requerido (query param o TESTRAIL_PROJECT_ID en .env)" });
      return;
    }
    const sections = await client().getSections(projectId, suiteId);
    res.json({ projectId, suiteId, total: sections.length, sections });
  } catch (err) {
    next(err);
  }
});

// GET /api/testrail/sections/:sectionId/cases?projectId=1&suiteId=2
testrailRouter.get("/sections/:sectionId/cases", async (req, res, next) => {
  try {
    const projectId = (req.query["projectId"] as string) || config.integrations.testRail?.projectId;
    const suiteId = (req.query["suiteId"] as string) || config.integrations.testRail?.suiteId;
    if (!projectId) {
      res.status(400).json({ error: "projectId es requerido (query param o TESTRAIL_PROJECT_ID en .env)" });
      return;
    }
    const cases = await client().getCases(projectId, suiteId, req.params.sectionId);
    res.json({ projectId, suiteId, sectionId: req.params.sectionId, total: cases.length, cases });
  } catch (err) {
    next(err);
  }
});

// POST /api/testrail/cases/preview
// Usa la IA para generar múltiples escenarios por historia del sprint activo, sin crear nada en TestRail
testrailRouter.post("/cases/preview", async (req, res, next) => {
  try {
    const { projectKey, status, maxResults } = req.body as {
      projectKey?: string;
      status?: string;
      maxResults?: number;
    };

    if (!projectKey) {
      res.status(400).json({ error: "projectKey es requerido" });
      return;
    }

    const jiraConfig = requireJiraConfig(config);
    const jira = new JiraClient(jiraConfig);

    const activeSprint = await jira.getActiveSprint(projectKey);
    if (!activeSprint) {
      res.status(404).json({ error: `No hay sprint activo para el proyecto ${projectKey}` });
      return;
    }

    const parts = [`project = "${projectKey}"`, `sprint = ${activeSprint.id}`];
    if (status) parts.push(`status = "${status}"`);
    const jql = parts.join(" AND ") + " ORDER BY created DESC";

    const rawIssues = await jira.searchIssues(jql, undefined, maxResults ?? 50);
    const aiProvider = await createAiProviderFromEnv();

    const stories = await Promise.all(
      rawIssues.map(async (issue) => {
        const storyTitle = issue.fields.summary?.trim() || issue.key;
        const rawField = jiraConfig.acceptanceCriteriaField === "description"
          ? issue.fields.description
          : issue.fields[jiraConfig.acceptanceCriteriaField];
        const acceptanceCriteria = typeof rawField === "string"
          ? rawField
          : (rawField && typeof rawField === "object" ? extractTextFromAdf(rawField as any) : "");

        const normalized = normalizeJiraIssue(issue, { acceptanceCriteriaField: jiraConfig.acceptanceCriteriaField });
        const fallbackSteps = normalized.steps.map((s) => s.action);

        const result = await generateScenariosForStory(
          issue.key, storyTitle, acceptanceCriteria, fallbackSteps, aiProvider
        );

        return {
          jiraKey: issue.key,
          title: storyTitle,
          storyType: result.storyType,
          generatedByAi: result.generatedByAi,
          scenarioCount: result.scenarios.length,
          scenarios: result.scenarios.map((scenario) => ({
            title: scenario.title,
            refs: issue.key,
            custom_preconds: scenario.preconditions,
            custom_steps_separated: scenario.steps.map((s) => ({ content: s.content, expected: "" })),
            custom_expected: scenario.expectedResult
          }))
        };
      })
    );

    res.json({
      sprint: { id: activeSprint.id, name: activeSprint.name },
      jql,
      totalStories: stories.length,
      totalScenarios: stories.reduce((sum, s) => sum + s.scenarioCount, 0),
      stories
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/testrail/cases/push
// Genera los escenarios con IA (igual que preview) y los crea/actualiza en TestRail
// sectionId: requerido en body o TESTRAIL_SECTION_ID en .env
// createRun: si true crea un TestRail Run con todos los casos sincronizados
testrailRouter.post("/cases/push", async (req, res, next) => {
  try {
    const { projectKey, sectionId, status, maxResults, createRun } = req.body as {
      projectKey?: string;
      sectionId?: string;
      status?: string;
      maxResults?: number;
      createRun?: boolean;
    };

    if (!projectKey) {
      res.status(400).json({ error: "projectKey es requerido" });
      return;
    }

    const trProjectId = config.integrations.testRail?.projectId;
    const trSuiteId = config.integrations.testRail?.suiteId;
    const resolvedSectionId = sectionId || config.integrations.testRail?.sectionId;

    if (!trProjectId) {
      res.status(400).json({ error: "TESTRAIL_PROJECT_ID no está configurado en .env" });
      return;
    }
    if (!resolvedSectionId) {
      res.status(400).json({ error: "sectionId es requerido (body o TESTRAIL_SECTION_ID en .env)" });
      return;
    }

    const jiraConfig = requireJiraConfig(config);
    const jira = new JiraClient(jiraConfig);

    const activeSprint = await jira.getActiveSprint(projectKey);
    if (!activeSprint) {
      res.status(404).json({ error: `No hay sprint activo para el proyecto ${projectKey}` });
      return;
    }

    const parts = [`project = "${projectKey}"`, `sprint = ${activeSprint.id}`];
    if (status) parts.push(`status = "${status}"`);
    const jql = parts.join(" AND ") + " ORDER BY created DESC";

    const rawIssues = await jira.searchIssues(jql, undefined, maxResults ?? 50);
    const aiProvider = await createAiProviderFromEnv();
    const tr = client();

    const synced: { jiraKey: string; scenarioTitle: string; caseId: number; action: "created" | "updated" }[] = [];
    const errors: { jiraKey: string; scenarioTitle: string; error: string }[] = [];

    for (const issue of rawIssues) {
      const storyTitle = issue.fields.summary?.trim() || issue.key;
      const rawField = jiraConfig.acceptanceCriteriaField === "description"
        ? issue.fields.description
        : issue.fields[jiraConfig.acceptanceCriteriaField];
      const acceptanceCriteria = typeof rawField === "string"
        ? rawField
        : (rawField && typeof rawField === "object" ? extractTextFromAdf(rawField as any) : "");

      const normalized = normalizeJiraIssue(issue, { acceptanceCriteriaField: jiraConfig.acceptanceCriteriaField });
      const fallbackSteps = normalized.steps.map((s) => s.action);

      const result = await generateScenariosForStory(
        issue.key, storyTitle, acceptanceCriteria, fallbackSteps, aiProvider
      );

      // Obtener casos existentes de esta historia para detectar duplicados por título
      let existingCases: { id: number; title: string }[] = [];
      try {
        existingCases = await tr.getCasesByRefs(trProjectId, issue.key, trSuiteId, resolvedSectionId);
      } catch {
        existingCases = [];
      }

      for (const scenario of result.scenarios) {
        const stepsSeparated = scenario.steps.map((s) => ({ content: s.content, expected: "" }));

        try {
          const match = existingCases.find((c) => c.title === scenario.title);
          if (match) {
            const updated = await tr.updateCase(match.id, {
              title: scenario.title,
              refs: issue.key,
              preconditions: scenario.preconditions ?? undefined,
              stepsSeparated,
              expectedResult: scenario.expectedResult
            });
            synced.push({ jiraKey: issue.key, scenarioTitle: scenario.title, caseId: updated.id, action: "updated" });
          } else {
            const created = await tr.addCase(resolvedSectionId, {
              title: scenario.title,
              refs: issue.key,
              preconditions: scenario.preconditions ?? undefined,
              stepsSeparated,
              expectedResult: scenario.expectedResult
            });
            synced.push({ jiraKey: issue.key, scenarioTitle: scenario.title, caseId: created.id, action: "created" });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ jiraKey: issue.key, scenarioTitle: scenario.title, error: msg });
        }
      }
    }

    let run = null;
    if (createRun && synced.length > 0) {
      const runName = `[Jira] ${projectKey} — ${activeSprint.name} — ${new Date().toISOString().slice(0, 10)}`;
      run = await tr.addRun({
        projectId: trProjectId,
        suiteId: trSuiteId,
        name: runName,
        description: `Sincronizado desde Jira con IA. JQL: ${jql}`,
        caseIds: synced.map((s) => s.caseId)
      });
    }

    res.json({
      sprint: { id: activeSprint.id, name: activeSprint.name },
      jql,
      totalSynced: synced.length,
      synced,
      errors,
      run: run ? { id: run.id, name: run.name, url: run.url ?? null } : null
    });
  } catch (err) {
    next(err);
  }
});

testrailRouter.get("/runs", async (_req, res, next) => {
  try {
    const projectId = config.integrations.testRail?.projectId;
    if (!projectId) {
      res.status(400).json({ error: "TESTRAIL_PROJECT_ID not configured" });
      return;
    }
    const suiteId = config.integrations.testRail?.suiteId;
    const runs = await client().getRuns(projectId, suiteId);
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});
