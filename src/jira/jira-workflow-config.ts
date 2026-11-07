import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { loadAppConfig } from "../automations/app-auto-resolver";
import { jiraWorkflowApplications } from "./jira-workflow";

export async function readJiraApplications(projectSlug: string) {
  const profile = await loadAppConfig(projectSlug);
  if (!profile) throw new Error("JIRA_APP_PROFILE_MISSING");
  return jiraWorkflowApplications(profile);
}

export async function saveJiraApplications(projectSlug: string, applications: unknown) {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectSlug)) throw new Error("JIRA_WORKFLOW_PROJECT_INVALID");
  const normalized = jiraWorkflowApplications({ jiraApplications: applications });
  if (Object.keys(normalized).length > 10 || Object.hasOwn(normalized, "principal")) throw new Error("JIRA_WORKFLOW_APPLICATIONS_INVALID");
  const profile = await loadAppConfig(projectSlug);
  if (!profile) throw new Error("JIRA_APP_PROFILE_MISSING");
  const target = path.resolve("automations/apps", projectSlug, "app.config.json");
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify({ ...profile, jiraApplications: normalized }, null, 2), { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
  return normalized;
}
