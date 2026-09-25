"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("../src/config/env");
const jira_client_1 = require("../src/clients/jira.client");
const jira_scenario_source_1 = require("../src/scenarios/jira-scenario-source");
const canonical_hu_context_1 = require("../src/scenarios/canonical-hu-context");
const hu_scope_guard_1 = require("../src/scenarios/hu-scope-guard");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
function stats(text) {
    const lines = text.split("\n");
    return {
        chars: text.length,
        lines: lines.length,
        paragraphs: text.split(/\n\s*\n/).filter(Boolean).length,
        blankLines: lines.filter((line) => !line.trim()).length,
        bulletLines: lines.filter((line) => /^\s*(?:[-*•])\s+/.test(line)).length,
        numberedLines: lines.filter((line) => /^\s*\d+[.)]\s+/.test(line)).length,
        colonLines: lines.filter((line) => line.includes(":")).length,
        arrowLines: lines.filter((line) => /(?:->|→)/.test(line)).length,
        sentenceCount: (text.match(/[.!?]+(?=\s|$)/g) ?? []).length,
    };
}
async function main() {
    const key = process.argv[2];
    if (!key)
        throw new Error("Usage: npx tsx tests/diagnose-real-canonical-hu.ts <issue-key>");
    const jiraConfig = (0, env_1.requireJiraConfig)(env_1.config);
    const jira = new jira_client_1.JiraClient(jiraConfig);
    const sprint = await jira.getActiveSprint(jiraConfig.projectKey);
    if (!sprint)
        throw new Error("No active sprint");
    const issues = await (0, jira_scenario_source_1.loadJiraIssues)(jiraConfig, jiraConfig.projectKey, sprint.id, undefined, 200);
    const issue = issues.find((candidate) => candidate.key === key);
    if (!issue)
        throw new Error(`Issue not found in active sprint: ${key}`);
    const context = (0, canonical_hu_context_1.buildCanonicalHuContext)(issue);
    const detectedFlows = (0, hu_scope_guard_1.detectOptionFlows)(issue).flows;
    const structuredFlows = (0, scenario_preview_service_1.extractStructuredOptionFlows)(context.text);
    const visibleOptions = structuredFlows.map((flow) => flow.optionLabel);
    const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(context.text, visibleOptions, detectedFlows, structuredFlows);
    const requirements = (0, scenario_functional_quality_1.buildRequirementManifest)(context.text, branches);
    const lines = context.text.split("\n");
    const candidateSections = context.text.split(/\n\s*\n/).filter(Boolean);
    const candidateLists = lines.filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line));
    const selectionHeadingCandidates = lines.filter((line) => {
        const normalized = line.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return /(?:seleccion\w*|eleg\w*|elig\w*|escog\w*|opcion\w*|alternativ\w*)/i.test(normalized) && /:/.test(line);
    }).length;
    const selectionOutcomeCandidates = lines.filter((line) => /(?:cuando|si|al)\s+(?:(?:el|la)\s+)?(?:usuario|cliente|persona)?\s*(?:seleccion\w*|elig\w*|escog\w*|eleg\w*)\s+.+?,\s*.+/i.test(line)).length;
    const selectableListGroupSizes = [];
    for (let index = 0; index < lines.length; index++) {
        const normalized = lines[index].normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!/(?:seleccion\w*|eleg\w*|elig\w*|escog\w*|opcion\w*|alternativ\w*)/i.test(normalized) || !/:/.test(lines[index]))
            continue;
        let cursor = index + 1;
        let count = 0;
        while (cursor < lines.length && /^\s*(?:[-*•]|\d+[.)])\s+/.test(lines[cursor])) {
            count++;
            cursor++;
        }
        if (count > 0)
            selectableListGroupSizes.push(count);
    }
    const lineShapes = lines.map((line, index) => ({
        index,
        kind: /^\s*(?:[-*•])\s+/.test(line) ? "bullet" : /^\s*\d+[.)]\s+/.test(line) ? "numbered" : "paragraph",
        chars: line.length,
        hasColon: line.includes(":"),
        hasArrow: /(?:->|→)/.test(line),
        quoteCount: (line.match(/["']/g) ?? []).length,
        commaCount: (line.match(/,/g) ?? []).length,
        selectionSignal: /seleccion|eleg|escoj|opci[oó]n|alternativ/i.test(line),
        outcomeSignal: /debe|permit|mostrar|redirig|naveg|resultado|acceso|autentic/i.test(line),
        listMarker: line.match(/^\s*((?:[-*•])|(?:\d+[.)]))\s+/)?.[1] ?? null,
    }));
    console.log(JSON.stringify({
        sourceShapes: {
            summary: typeof issue.summary,
            description: typeof issue.description,
            acceptanceCriteria: typeof issue.acceptanceCriteria,
        },
        normalizedStats: stats(context.text),
        candidateSectionCount: candidateSections.length,
        candidateListCount: candidateLists.length,
        candidateGroupCount: structuredFlows.length,
        candidateAlternativeCountBeforeFiltering: structuredFlows.length,
        candidateAlternativeCountAfterFiltering: visibleOptions.length,
        flowLabelLengths: structuredFlows.map((flow) => ({ labelChars: flow.optionLabel.length, resultChars: flow.expectedResult.length })),
        selectionHeadingCandidates,
        selectionOutcomeCandidates,
        selectableListGroupSizes,
        lineShapes,
        phases: {
            rawJiraFields: Boolean(issue.summary || issue.description || issue.acceptanceCriteria),
            normalizedCanonicalText: Boolean(context.text),
            structuralSections: candidateSections.length,
            candidateAlternatives: structuredFlows.length,
            filteredAlternatives: visibleOptions.length,
            visibleOptions: visibleOptions.length,
            optionFlows: detectedFlows.length + structuredFlows.length,
            functionalBranches: branches.length,
            canonicalRequirements: requirements.length,
            effectiveIntent: structuredFlows.length > 1 ? "multi_branch_navigation" : "generic",
        },
        issueKey: issue.key,
    }, null, 2));
}
void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
