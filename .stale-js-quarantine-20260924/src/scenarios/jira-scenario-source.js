"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadJiraIssues = loadJiraIssues;
const jira_client_1 = require("../clients/jira.client");
const adf_extractor_1 = require("../jira/adf-extractor");
function buildJql(projectKey, sprintId, status) {
    const parts = [`project = "${projectKey}"`, `sprint = ${sprintId}`];
    if (status)
        parts.push(`status = "${status}"`);
    return parts.join(" AND ") + " ORDER BY created DESC";
}
function extractFieldText(value) {
    if (typeof value === "string")
        return value;
    if (value && typeof value === "object")
        return (0, adf_extractor_1.extractTextFromAdf)(value);
    return "";
}
function extractAcceptanceCriteria(issue, acField) {
    const raw = issue.fields[acField];
    if (!raw)
        return null;
    const text = extractFieldText(raw);
    if (!text.trim())
        return null;
    return text.trim();
}
async function loadJiraIssues(jiraConfig, projectKey, sprintId, status, maxResults = 50) {
    const jira = new jira_client_1.JiraClient(jiraConfig);
    const jql = buildJql(projectKey, sprintId, status);
    const rawIssues = await jira.searchIssues(jql, undefined, maxResults);
    return rawIssues.map((issue) => {
        const description = issue.fields.description
            ? extractFieldText(issue.fields.description)
            : "";
        const labels = Array.isArray(issue.fields.labels)
            ? issue.fields.labels
            : [];
        const components = Array.isArray(issue.fields.components)
            ? issue.fields.components.map((c) => c.name).filter(Boolean)
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
    });
}
