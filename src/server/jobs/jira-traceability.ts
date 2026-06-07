import { config, requireJiraConfig } from "../../config/env";
import type { LaunchExecutionInput } from "./launch-orchestrator";

export type JiraTraceabilityInput = {
  jiraKey: string;
  testRunId: number;
  launchId: string;
  appSlug?: string;
  sectionSlug?: string;
  finalStatus?: string;
  summary?: {
    total: number;
    passed: number;
    failed: number;
    synced: number;
    syncFailed: number;
  };
};

export type JiraLinkResult = {
  jiraKey: string;
  linkStatus: "linked" | "failed" | "skipped";
  linkedAt?: string;
  errorCode?: string;
  errorMessage?: string;
};

const TRACEABILITY_ENABLED = process.env.JIRA_TRACEABILITY_ENABLED?.toLowerCase() === "true";
const LINK_COMMENT_ENABLED = process.env.JIRA_LINK_COMMENT_ENABLED?.toLowerCase() !== "false";

async function addJiraComment(issueKey: string, comment: string): Promise<void> {
  const jiraConfig = requireJiraConfig(config);
  const base = jiraConfig.baseUrl.replace(/\/+$/, "");
  const authHeader = `Basic ${Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString("base64")}`;
  const url = `${base}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({ body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: comment }] }] } }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jira API error (HTTP ${res.status}) at addComment: ${body.slice(0, 500)}`);
  }
}

function buildJiraComment(input: JiraTraceabilityInput): string {
  const lines: string[] = [
    "QA Lab Automation Run completed.",
    "",
    `TestRail Run ID: ${input.testRunId}`,
    `Launch ID: ${input.launchId}`,
    `Status: ${input.finalStatus ?? "unknown"}`,
  ];

  if (input.summary) {
    lines.push(
      "",
      `Summary: total=${input.summary.total}, passed=${input.summary.passed}, failed=${input.summary.failed}, synced=${input.summary.synced}, syncFailed=${input.summary.syncFailed}`,
    );
  }

  if (input.appSlug) lines.push(`App: ${input.appSlug}`);
  if (input.sectionSlug) lines.push(`Section: ${input.sectionSlug}`);

  return lines.join("\n");
}

export async function linkTestRunToJiraIssue(
  input: JiraTraceabilityInput,
): Promise<JiraLinkResult> {
  const linkedAt = new Date().toISOString();

  if (!input.jiraKey) {
    return { jiraKey: "", linkStatus: "skipped", linkedAt, errorCode: "missing_jira_key" };
  }

  if (!TRACEABILITY_ENABLED) {
    console.log(`[jira-traceability] skipped reason="disabled" jiraKey=${input.jiraKey}`);
    return { jiraKey: input.jiraKey, linkStatus: "skipped", linkedAt, errorCode: "disabled" };
  }

  console.log(`[jira-traceability] linking testRunId=${input.testRunId} jiraKey=${input.jiraKey} launchId=${input.launchId}`);

  try {
    if (LINK_COMMENT_ENABLED) {
      const comment = buildJiraComment(input);
      await addJiraComment(input.jiraKey, comment);
      console.log(`[jira-traceability] linked jiraKey=${input.jiraKey} testRunId=${input.testRunId}`);
    }

    return { jiraKey: input.jiraKey, linkStatus: "linked", linkedAt };
  } catch (err: any) {
    const errorMsg = err.message ?? String(err);
    console.error(`[jira-traceability] failed jiraKey=${input.jiraKey} error="${errorMsg}"`);
    return { jiraKey: input.jiraKey, linkStatus: "failed", linkedAt, errorCode: "jira_link_failed", errorMessage: errorMsg };
  }
}
