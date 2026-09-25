"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scenariosRouter = void 0;
const express_1 = require("express");
const env_1 = require("../../config/env");
const jira_client_1 = require("../../clients/jira.client");
const jira_normalizer_1 = require("../../jira/jira-normalizer");
const scenario_preview_service_1 = require("../../scenarios/scenario-preview.service");
const route_discovery_planner_1 = require("../../scenarios/route-discovery-planner");
const guided_route_discovery_1 = require("../../scenarios/guided-route-discovery");
const approved_candidate_execution_1 = require("../../scenarios/approved-candidate-execution");
exports.scenariosRouter = (0, express_1.Router)();
function buildJql(projectKey, sprintId, status) {
    const parts = [`project = "${projectKey}"`, `sprint = ${sprintId}`];
    if (status)
        parts.push(`status = "${status}"`);
    return parts.join(" AND ") + " ORDER BY created DESC";
}
function toTestRailFormat(scenario) {
    const stepsSeparated = scenario.steps.map((s) => ({
        content: s.action,
        expected: s.expected ?? ""
    }));
    const stepsText = scenario.steps
        .map((s, i) => `${i + 1}. ${s.action}${s.expected ? `\nEsperado: ${s.expected}` : ""}`)
        .join("\n");
    return {
        title: scenario.title,
        refs: scenario.externalId,
        custom_preconds: scenario.preconditions ?? null,
        custom_steps_separated: stepsSeparated,
        custom_steps: stepsText
    };
}
// POST /api/scenarios/preview — MCP-ready generation
exports.scenariosRouter.post("/preview", async (req, res, next) => {
    try {
        const body = req.body;
        // NEW: Log incoming request to diagnose issue selection
        console.log(`[scenarios:endpoint] POST /preview received projectKey=${body.projectKey} ` +
            `sprintId=${body.sprintId} activeSprint=${body.activeSprint} ` +
            `selectedIssueKeys=${body.selectedIssueKeys ? JSON.stringify(body.selectedIssueKeys) : "undefined"} ` +
            `status=${body.status ?? "any"}`);
        const result = await (0, scenario_preview_service_1.generateScenarioPreview)(body);
        const _dbg = result.scenarios ?? [];
        for (const _sc of _dbg) {
            console.log('[scenario-id-trace] BACKEND_HTTP_OUT=' + JSON.stringify({ bucket: 'scenario', title: _sc?.title ?? '', scenarioId: _sc?.scenarioId ?? '', id: _sc?.id ?? '', sourceIssueKey: _sc?.sourceIssueKey ?? '' }));
        }
        if (!result.ok) {
            const errorResult = result;
            const status = errorResult.error === "no_active_sprint" ? 404 : errorResult.error === "invalid_request" ? 400 : 502;
            res.status(status).json(errorResult);
            return;
        }
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// POST /api/scenarios/route-discovery/plan — Generic route discovery planner
// Does NOT execute browser navigation. Returns a contract for guided route discovery.
exports.scenariosRouter.post("/route-discovery/plan", async (req, res, next) => {
    try {
        const body = req.body;
        if (!body.appSlug || !body.issueKey || !body.huIntent || !body.reasonCode) {
            console.log(`[route-discovery-plan] skipped reason=insufficient_payload`);
            res.status(400).json({
                ok: false,
                error: "insufficient_payload",
                message: "appSlug, issueKey, huIntent, reasonCode are required"
            });
            return;
        }
        const result = (0, route_discovery_planner_1.planRouteDiscovery)(body);
        if (!result.ok) {
            const errorResult = result;
            res.status(400).json(errorResult);
            return;
        }
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// POST /api/scenarios/route-discovery/run — Generic guided route discovery execution
//
// dryRun=true: returns a plan (status="planned")
// dryRun=false:
//   status="candidate_found"       → 200
//   status="no_candidate_found"    → 200
//   status="insufficient_runtime_context" → 409
//   status="execution_failed"      → 500
exports.scenariosRouter.post("/route-discovery/run", async (req, res, next) => {
    try {
        const body = req.body;
        if (!body.appSlug || !body.issueKey || !body.huIntent || !body.reasonCode) {
            console.log(`[guided-route-discovery] skipped reason=insufficient_payload`);
            res.status(400).json({
                ok: false,
                status: "insufficient_payload",
                discoveryType: "intent_route_discovery",
                recommendedMode: "guided_route_discovery",
                nextAction: "provide_required_fields",
                appSlug: body.appSlug ?? "",
                issueKey: body.issueKey ?? "",
                huIntent: body.huIntent ?? "",
                reasonCode: body.reasonCode ?? "",
                candidateRoute: null,
                observations: [],
                warnings: ["appSlug, issueKey, huIntent, reasonCode are required"],
                message: "insufficient_payload",
                dryRun: body.dryRun !== false
            });
            return;
        }
        const result = await (0, guided_route_discovery_1.runGuidedRouteDiscovery)(body);
        if (result.status === "insufficient_payload") {
            res.status(400).json(result);
            return;
        }
        if (result.status === "insufficient_runtime_context") {
            res.status(409).json(result);
            return;
        }
        if (result.status === "execution_failed") {
            res.status(500).json(result);
            return;
        }
        res.status(200).json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.scenariosRouter.post("/route-discovery/execute-candidate", async (req, res, next) => {
    try {
        const result = await (0, approved_candidate_execution_1.executeApprovedDiscoveryCandidate)(req.body);
        res.status(result.ok ? 200 : 400).json(result);
    }
    catch (err) {
        next(err);
    }
});
// GET /api/scenarios/preview?projectKey=AA&sprintId=42&status=Desestimado
exports.scenariosRouter.get("/preview", async (req, res, next) => {
    try {
        const { projectKey, sprintId, activeSprint, status, maxResults } = req.query;
        if (!projectKey) {
            res.status(400).json({ error: "projectKey is required" });
            return;
        }
        if (!activeSprint && !sprintId) {
            res.status(400).json({ error: "activeSprint=true or sprintId is required" });
            return;
        }
        const jiraConfig = (0, env_1.requireJiraConfig)(env_1.config);
        const jira = new jira_client_1.JiraClient(jiraConfig);
        let resolvedSprintId;
        let sprint;
        if (activeSprint === "true") {
            const active = await jira.getActiveSprint(projectKey);
            if (!active) {
                res.status(404).json({ error: `No hay sprint activo para el proyecto ${projectKey}` });
                return;
            }
            resolvedSprintId = active.id;
            sprint = { id: active.id, name: active.name };
        }
        else {
            resolvedSprintId = Number(sprintId);
            sprint = { id: resolvedSprintId, name: `Sprint ${resolvedSprintId}` };
        }
        const jql = buildJql(projectKey, resolvedSprintId, status);
        const rawIssues = await jira.searchIssues(jql, undefined, Number(maxResults) || 50);
        const scenarios = (0, jira_normalizer_1.normalizeJiraIssues)(rawIssues, {
            acceptanceCriteriaField: jiraConfig.acceptanceCriteriaField
        });
        const result = scenarios.map((scenario) => ({
            jiraKey: scenario.externalId,
            title: scenario.title,
            stepCount: scenario.steps.length,
            testrailFormat: toTestRailFormat(scenario)
        }));
        res.json({
            sprint,
            jql,
            total: result.length,
            scenarios: result
        });
    }
    catch (err) {
        next(err);
    }
});
