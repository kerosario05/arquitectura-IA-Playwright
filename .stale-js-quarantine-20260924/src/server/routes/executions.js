"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executionsRouter = void 0;
const express_1 = require("express");
const execution_summary_service_1 = require("../services/execution-summary.service");
const router = (0, express_1.Router)();
exports.executionsRouter = router;
// GET /api/executions — list all finished executions (compact), newest first.
router.get("/api/executions", (_req, res) => {
    const executions = (0, execution_summary_service_1.listExecutionSummaries)();
    return res.json({ ok: true, total: executions.length, executions });
});
// GET /api/executions/:launchId — full summary for one execution (HU, TestRail project/section,
// scenarios pushed to TestRail + result, Test Run, and defects registered in Jira).
router.get("/api/executions/:launchId", (req, res) => {
    const { launchId } = req.params;
    if (!launchId || typeof launchId !== "string" || launchId.trim().length === 0) {
        return res.status(400).json({ ok: false, error: "invalid_launch_id" });
    }
    const summary = (0, execution_summary_service_1.buildExecutionSummary)(launchId.trim());
    if (!summary) {
        return res.status(404).json({ ok: false, error: "execution_not_found" });
    }
    return res.json({ ok: true, execution: summary });
});
