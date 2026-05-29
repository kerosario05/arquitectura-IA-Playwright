import { Router } from "express";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";

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
