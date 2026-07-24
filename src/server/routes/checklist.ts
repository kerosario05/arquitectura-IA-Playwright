import { Router, Request, Response } from "express";
import { defectChecklistStore } from "../services/defect-checklist-store";

const router = Router();

// POST /api/user-stories/:issueKey/checklist-url — get or create checklist URL for an issue
router.post("/api/user-stories/:issueKey/checklist-url", (req: Request, res: Response) => {
  const { issueKey } = req.params;
  if (!issueKey || typeof issueKey !== "string" || issueKey.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "invalid_issue_key" });
  }
  const { title } = req.body || {};
  const list = defectChecklistStore.getOrCreate(issueKey.trim(), title || undefined);
  const resp = defectChecklistStore.toResponse(list);
  return res.json({ ok: true, issueKey: resp.issueKey, checklistUrl: resp.checklistUrl });
});

// GET /api/checklists/:issueKey — get checklist with defects (optional ?jobId= to filter by run)
router.get("/api/checklists/:issueKey", (req: Request, res: Response) => {
  const { issueKey } = req.params;
  const jobId = req.query.jobId as string | undefined;
  const list = defectChecklistStore.get(issueKey);
  if (!list) {
    return res.json({ issueKey, defects: [], checklistUrl: `/checklist/${issueKey}`, createdAt: null, updatedAt: null });
  }
  const resp = defectChecklistStore.toResponse(list, jobId);
  console.log(`[checklist-query] issueKey=${issueKey} jobId=${jobId ?? 'none'} scope=${jobId ? 'job' : 'issue'} total=${resp.defects.length}`);
  return res.json(resp);
});

// POST /api/checklists/:issueKey/defects — add a defect
router.post("/api/checklists/:issueKey/defects", (req: Request, res: Response) => {
  const { issueKey } = req.params;
  const { description, severity, scenarioId, scenarioTitle, title, evidenceUrl } = req.body || {};
  if (!description || typeof description !== "string" || description.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "description_required" });
  }
  if (!severity || typeof severity !== "string") {
    return res.status(400).json({ ok: false, error: "severity_required" });
  }
  const defect = defectChecklistStore.addDefect(issueKey, {
    description: description.trim(),
    severity,
    scenarioId: scenarioId || undefined,
    scenarioTitle: scenarioTitle || undefined,
    title: (typeof title === "string" && title.trim()) ? title.trim() : undefined,
    evidenceUrl: evidenceUrl || undefined,
  });
  if (!defect) {
    return res.status(400).json({ ok: false, error: "invalid_severity" });
  }
  return res.status(201).json({ ok: true, defect });
});

// PATCH /api/checklists/:issueKey/defects/:defectId — update defect status
router.patch("/api/checklists/:issueKey/defects/:defectId", (req: Request, res: Response) => {
  const { issueKey, defectId } = req.params;
  const { status } = req.body || {};
  if (!status || typeof status !== "string") {
    return res.status(400).json({ ok: false, error: "status_required" });
  }
  const updated = defectChecklistStore.updateDefectStatus(issueKey, defectId, status);
  if (!updated) {
    return res.status(404).json({ ok: false, error: "defect_not_found" });
  }
  return res.json({ ok: true, defect: updated });
});

export { router as checklistRouter };
