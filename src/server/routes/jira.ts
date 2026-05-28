import { Router } from "express";
import { config, requireJiraConfig } from "../../config/env";
import { JiraClient } from "../../clients/jira.client";

export const jiraRouter = Router();

function client(): JiraClient {
  return new JiraClient(requireJiraConfig(config));
}

jiraRouter.get("/projects", async (_req, res, next) => {
  try {
    const projects = await client().getProjects();
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

jiraRouter.get("/projects/:key/sprints", async (req, res, next) => {
  try {
    const jira = client();
    const boards = await jira.getBoards(req.params.key);
    const scrumBoard = boards.find((b) => b.type === "scrum") ?? boards[0];
    if (!scrumBoard) {
      res.json({ board: null, sprints: [] });
      return;
    }
    const sprints = await jira.getSprints(scrumBoard.id);
    res.json({ board: scrumBoard, sprints });
  } catch (err) {
    next(err);
  }
});

jiraRouter.get("/projects/:key/sprint/active", async (req, res, next) => {
  try {
    const sprint = await client().getActiveSprint(req.params.key);
    res.json({ sprint: sprint ?? null });
  } catch (err) {
    next(err);
  }
});
