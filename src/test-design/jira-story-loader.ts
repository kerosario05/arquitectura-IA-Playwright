import { JiraClient } from "../clients/jira.client";
import { extractTextFromAdf } from "../jira/adf-extractor";
import type { RawJiraIssue, RequiredJiraRuntimeConfig } from "../types/jira.types";
import type { TestDesignJiraIssue } from "./test-design.types";

function fieldText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    return extractTextFromAdf(value as Parameters<typeof extractTextFromAdf>[0]);
  }
  return "";
}

/** Maps Jira data for the manual Test Design feature without depending on Jira scenario execution. */
export function mapJiraIssueForTestDesign(
  issue: RawJiraIssue,
  acceptanceCriteriaField: string,
): TestDesignJiraIssue {
  const fields = issue.fields;
  const rawLabels = fields.labels;
  const rawComponents = fields.components;
  const acceptanceCriteria = fieldText(fields[acceptanceCriteriaField]);

  return {
    key: issue.key,
    summary: fields.summary?.trim() || issue.key,
    description: fieldText(fields.description),
    acceptanceCriteria: acceptanceCriteria || null,
    labels: Array.isArray(rawLabels)
      ? rawLabels.filter((label): label is string => typeof label === "string")
      : [],
    components: Array.isArray(rawComponents)
      ? rawComponents.flatMap((component) => {
          if (!component || typeof component !== "object") return [];
          const name = (component as { name?: unknown }).name;
          return typeof name === "string" && name.trim() ? [name.trim()] : [];
        })
      : [],
    status: fields.status?.name ?? "",
    issueType: fields.issuetype?.name ?? "",
  };
}

export async function loadTestDesignJiraIssue(
  jiraConfig: RequiredJiraRuntimeConfig,
  issueKey: string,
): Promise<TestDesignJiraIssue> {
  const issue = await new JiraClient(jiraConfig).getIssue(issueKey, [
    "summary",
    "description",
    "labels",
    "components",
    "status",
    "issuetype",
  ]);
  return mapJiraIssueForTestDesign(issue, jiraConfig.acceptanceCriteriaField);
}
