import { Router, Request, Response } from "express";
import { buildExecutionSummary, listExecutionSummaries } from "../services/execution-summary.service";

const router = Router();

// GET /api/executions — list all finished executions (compact), newest first.
router.get("/api/executions", (_req: Request, res: Response) => {
  const executions = listExecutionSummaries();
  return res.json({ ok: true, total: executions.length, executions });
});

// GET /api/executions/:launchId — full summary for one execution (HU, TestRail project/section,
// scenarios pushed to TestRail + result, Test Run, and defects registered in Jira).
router.get("/api/executions/:launchId", (req: Request, res: Response) => {
  const { launchId } = req.params;
  if (!launchId || typeof launchId !== "string" || launchId.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "invalid_launch_id" });
  }
  const summary = buildExecutionSummary(launchId.trim());
  if (!summary) {
    return res.status(404).json({ ok: false, error: "execution_not_found" });
  }
  return res.json({ ok: true, execution: summary });
});

export { router as executionsRouter };
