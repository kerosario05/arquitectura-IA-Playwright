import { Router } from "express";
import { config } from "../../config/env";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    engine: {
      baseUrl: config.app.baseUrl,
      appSlug: process.env.APP_SLUG || "default",
      jiraProject: process.env.JIRA_PROJECT_KEY || null,
      testRailProject: config.integrations.testRail?.projectId || null
    }
  });
});
