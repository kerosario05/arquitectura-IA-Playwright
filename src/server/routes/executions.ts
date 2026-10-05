import { Router, Request, Response } from "express";
import { buildExecutionSummary, listExecutionSummaries } from "../services/execution-summary.service";
import { filterByProjectAccess } from "../middleware/route-policy";

const router = Router();

// GET /api/executions — list all finished executions (compact), newest first.
router.get("/api/executions", (req: Request, res: Response) => {
  const filtered = filterByProjectAccess(req.principal, listExecutionSummaries(),
    (execution) => (execution as { appSlug?: string }).appSlug ?? null);
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 40;
  const requestedOffset = Number(req.query.offset);
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
  const executions = filtered.slice(offset, offset + limit);
  return res.json({
    ok: true,
    total: filtered.length,
    limit,
    offset,
    hasMore: offset + executions.length < filtered.length,
    executions,
  });
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
