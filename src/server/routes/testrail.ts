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
