import { Router, Request, Response } from "express";
import { buildExecutionSummary, listExecutionSummaries } from "../services/execution-summary.service";
import { filterByProjectAccess } from "../middleware/route-policy";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";

/**
 * Section names by id. Older runs and publications stored only the section id; the detail shows
 * its name, looked up once per id. A failed lookup is not cached and never fails the detail.
 */
const sectionNameCache = new Map<string, string>();
const SECTION_LOOKUP_TIMEOUT_MS = 4_000;

async function lookupSectionName(sectionId: number | string): Promise<string | undefined> {
  const key = String(sectionId);
  if (sectionNameCache.has(key)) return sectionNameCache.get(key);
  const numeric = Number(key);
  if (!Number.isInteger(numeric) || numeric <= 0) return undefined;
  try {
    const client = new TestRailClient(requireTestRailConfig(config));
    const section = await Promise.race([
      client.getSection(numeric),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), SECTION_LOOKUP_TIMEOUT_MS)),
    ]);
    if (section?.name) sectionNameCache.set(key, section.name);
    return section?.name;
  } catch {
    return undefined;
  }
}

const router = Router();

// GET /api/executions — list all finished executions (compact), newest first.
router.get("/api/executions", (req: Request, res: Response) => {
  const executions = filterByProjectAccess(
    req.principal,
    listExecutionSummaries(),
    (execution) => (execution as { appSlug?: string }).appSlug ?? null,
  );
  return res.json({ ok: true, total: executions.length, executions });
});

// GET /api/executions/:launchId — full summary for one execution (HU, TestRail project/section,
// scenarios pushed to TestRail + result, Test Run, and defects registered in Jira).
router.get("/api/executions/:launchId", async (req: Request, res: Response) => {
  const { launchId } = req.params;
  if (!launchId || typeof launchId !== "string" || launchId.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "invalid_launch_id" });
  }
  const summary = buildExecutionSummary(launchId.trim());
  if (!summary) {
    return res.status(404).json({ ok: false, error: "execution_not_found" });
  }
  if (summary.testRail.sectionId != null && !summary.testRail.sectionName) {
    const sectionName = await lookupSectionName(summary.testRail.sectionId);
    if (sectionName) summary.testRail.sectionName = sectionName;
  }
  return res.json({ ok: true, execution: summary });
});

export { router as executionsRouter };
