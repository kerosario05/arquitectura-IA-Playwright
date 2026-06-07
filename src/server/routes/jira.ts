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

jiraRouter.get("/issues", async (req, res, next) => {
  try {
    const projectId = req.query.projectId as string | undefined;
    const sprintId = req.query.sprintId as string | undefined;
    const status = req.query.status as string | undefined;

    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const jqlParts: string[] = [`project = "${projectId.replace(/"/g, '\\"')}"`];
    if (sprintId) jqlParts.push(`sprint = ${parseInt(sprintId, 10)}`);
    if (status) jqlParts.push(`status = "${status.replace(/"/g, '\\"')}"`);

    const jql = jqlParts.join(" AND ");
    const fields = ["summary", "status", "issuetype", "priority"];
    const issues = await client().searchIssues(jql, fields);

    const mapped = issues.map((issue) => ({
      id: issue.id,
      key: issue.key,
      summary: issue.fields?.summary ?? "",
      status: issue.fields?.status?.name ?? "",
      issueType: issue.fields?.issuetype?.name ?? "",
      projectId,
      sprintId: sprintId ? parseInt(sprintId, 10) : undefined,
    }));

    console.log(`[jira] issues fetched count=${mapped.length} project=${projectId} sprint=${sprintId ?? "none"} status=${status ?? "none"}`);
    res.json({ issues: mapped });
  } catch (err) {
    next(err);
  }
});
