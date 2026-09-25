"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checklistRouter = void 0;
const express_1 = require("express");
const defect_checklist_store_1 = require("../services/defect-checklist-store");
const router = (0, express_1.Router)();
exports.checklistRouter = router;
// POST /api/user-stories/:issueKey/checklist-url — get or create checklist URL for an issue
router.post("/api/user-stories/:issueKey/checklist-url", (req, res) => {
    const { issueKey } = req.params;
    if (!issueKey || typeof issueKey !== "string" || issueKey.trim().length === 0) {
        return res.status(400).json({ ok: false, error: "invalid_issue_key" });
    }
    const { title } = req.body || {};
    const list = defect_checklist_store_1.defectChecklistStore.getOrCreate(issueKey.trim(), title || undefined);
    const resp = defect_checklist_store_1.defectChecklistStore.toResponse(list);
    return res.json({ ok: true, issueKey: resp.issueKey, checklistUrl: resp.checklistUrl });
});
// GET /api/checklists/:issueKey — get checklist with defects. Filter strictly by ?runId= when
// present (execution isolation; no fallback to issueKey), otherwise optionally by ?jobId=.
router.get("/api/checklists/:issueKey", (req, res) => {
    const { issueKey } = req.params;
    const jobId = typeof req.query.jobId === "string" ? req.query.jobId : undefined;
    const runId = typeof req.query.runId === "string" ? req.query.runId : undefined;
    const list = defect_checklist_store_1.defectChecklistStore.get(issueKey);
    if (!list) {
        const checklistUrl = jobId
            ? `/checklist/${issueKey}?jobId=${encodeURIComponent(jobId)}`
            : `/checklist/${issueKey}`;
        return res.json({ issueKey, defects: [], total: 0, pendingReview: 0, highSeverity: 0, checklistUrl, createdAt: null, updatedAt: null });
    }
    const filter = { ...(jobId ? { jobId } : {}), ...(runId ? { runId } : {}) };
    const resp = defect_checklist_store_1.defectChecklistStore.toResponse(list, Object.keys(filter).length > 0 ? filter : undefined);
    console.log(`[checklist-query] issueKey=${issueKey} runId=${runId ?? 'none'} jobId=${jobId ?? 'none'} scope=${runId ? 'run' : (jobId ? 'job' : 'issue')} total=${resp.total} pending=${resp.pendingReview} highSeverity=${resp.highSeverity}`);
    const checklistUrl = jobId
        ? `/checklist/${resp.issueKey}?jobId=${encodeURIComponent(jobId)}`
        : resp.checklistUrl;
    return res.json({ ...resp, checklistUrl });
});
// POST /api/checklists/:issueKey/defects — add a defect
router.post("/api/checklists/:issueKey/defects", (req, res) => {
    const { issueKey } = req.params;
    const { description, severity, scenarioId, scenarioTitle, title, evidenceUrl } = req.body || {};
    if (!description || typeof description !== "string" || description.trim().length === 0) {
        return res.status(400).json({ ok: false, error: "description_required" });
    }
    if (!severity || typeof severity !== "string") {
        return res.status(400).json({ ok: false, error: "severity_required" });
    }
    const defect = defect_checklist_store_1.defectChecklistStore.addDefect(issueKey, {
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
router.patch("/api/checklists/:issueKey/defects/:defectId", (req, res) => {
    const { issueKey, defectId } = req.params;
    const { status } = req.body || {};
    if (!status || typeof status !== "string") {
        return res.status(400).json({ ok: false, error: "status_required" });
    }
    const updated = defect_checklist_store_1.defectChecklistStore.updateDefectStatus(issueKey, defectId, status);
    if (!updated) {
        return res.status(404).json({ ok: false, error: "defect_not_found" });
    }
    return res.json({ ok: true, defect: updated });
});
