import { JiraClient } from "../clients/jira.client";
import type { RequiredJiraRuntimeConfig } from "../types/jira.types";
import type { JiraIssueSource } from "./scenario-types";
import { extractTextFromAdf } from "../jira/adf-extractor";
import type { RawJiraIssue } from "../types/jira.types";

function buildJql(projectKey: string, sprintId: number, status?: string): string {
  const parts = [`project = "${projectKey}"`, `sprint = ${sprintId}`];
  if (status) parts.push(`status = "${status}"`);
  return parts.join(" AND ") + " ORDER BY created DESC";
}

function extractFieldText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return extractTextFromAdf(value as any);
  return "";
}

function extractAcceptanceCriteria(issue: RawJiraIssue, acField: string): string | null {
  const raw = issue.fields[acField];
  if (!raw) return null;
  const text = extractFieldText(raw);
  if (!text.trim()) return null;
  return text.trim();
}

export async function loadJiraIssues(
  jiraConfig: RequiredJiraRuntimeConfig,
  projectKey: string,
  sprintId: number,
  status?: string,
  maxResults = 50
): Promise<JiraIssueSource[]> {
  const jira = new JiraClient(jiraConfig);
  const jql = buildJql(projectKey, sprintId, status);
  const rawIssues = await jira.searchIssues(jql, undefined, maxResults);
  return rawIssues.map((issue: RawJiraIssue) => toIssueSource(issue, jiraConfig));
}

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]*$/i;

/**
 * The stories the user picked in the panel, looked up by key inside the project — no sprint
 * and no status filter. Keys that are malformed or not in the project are simply not returned.
 */
export async function loadJiraIssuesByKeys(
  jiraConfig: RequiredJiraRuntimeConfig,
  projectKey: string,
  issueKeys: string[],
): Promise<JiraIssueSource[]> {
  const query = buildIssueKeysJql(projectKey, issueKeys);
  if (!query) return [];
  const jira = new JiraClient(jiraConfig);
  const rawIssues = await jira.searchIssues(query.jql, undefined, query.keys.length);
  return rawIssues.map((issue: RawJiraIssue) => toIssueSource(issue, jiraConfig));
}

/** JQL for picked keys inside one project; null when no key is well formed (nothing to load). */
export function buildIssueKeysJql(projectKey: string, issueKeys: string[]): { jql: string; keys: string[] } | null {
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  if (!PROJECT_KEY.test(normalizedProjectKey)) return null;
  const keys = Array.from(new Set(issueKeys.map((key) => key.trim().toUpperCase()).filter((key) => ISSUE_KEY.test(key))));
  if (keys.length === 0) return null;
  return { jql: `project = "${normalizedProjectKey}" AND key in (${keys.join(", ")}) ORDER BY created DESC`, keys };
}

function toIssueSource(issue: RawJiraIssue, jiraConfig: RequiredJiraRuntimeConfig): JiraIssueSource {
  const description = issue.fields.description
    ? extractFieldText(issue.fields.description)
    : "";

  const labels: string[] = Array.isArray(issue.fields.labels)
    ? issue.fields.labels
    : [];

  const components: string[] = Array.isArray(issue.fields.components)
    ? issue.fields.components.map((c: any) => c.name).filter(Boolean)
    : [];

  return {
    key: issue.key,
    summary: issue.fields.summary?.trim() || issue.key,
    description,
    acceptanceCriteria: extractAcceptanceCriteria(issue, jiraConfig.acceptanceCriteriaField),
    labels,
    components,
    status: issue.fields.status?.name || "",
    issueType: issue.fields.issuetype?.name || "",
  };
}
