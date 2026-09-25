"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildExecutionSummary = buildExecutionSummary;
exports.listExecutionSummaries = listExecutionSummaries;
/**
 * Execution summary service.
 *
 * Aggregates everything about a finished execution into a single view, read straight from the
 * persisted launch manifest (`.artifacts/scenario-launch-runs/<launchId>/launch-manifest.json`,
 * survives restarts) plus the defect checklist store:
 *   - the HU used (+ TestRail project/section and automation project)
 *   - the scenarios that were executed and pushed to TestRail, with their result
 *   - the TestRail Test Run (id + derived URL) and the run summary
 *   - the defects that were registered in Jira for that run
 *
 * Read-only. No manifest is written here.
 */
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const env_1 = require("../../config/env");
const defect_checklist_store_1 = require("./defect-checklist-store");
const LAUNCH_ARTIFACTS_DIR = path.join(process.cwd(), ".artifacts", "scenario-launch-runs");
const EVIDENCE_ROOT = path.join(process.cwd(), ".artifacts", "evidence");
function readManifest(launchId) {
    const p = path.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json");
    try {
        if (!fs.existsSync(p))
            return null;
        return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
    catch {
        return null;
    }
}
/** Builds the TestRail Run URL from the configured base URL + runId (not persisted in the manifest). */
function buildTestRailRunUrl(runId) {
    const base = env_1.config.integrations.testRail?.url?.trim();
    if (!base || runId == null || runId === "")
        return undefined;
    return `${base.replace(/\/+$/, "")}/index.php?/runs/view/${runId}`;
}
/** True when a consolidated evidence docx exists for this run's jobId. */
function hasEvidenceDocx(jobId) {
    if (!jobId)
        return false;
    try {
        // Structured layout: .artifacts/evidence/<appSlug>/<sectionSlug>/runs/<jobId>/evidencia.docx
        // Fall back to a shallow scan since appSlug/sectionSlug aren't needed to confirm existence.
        const stack = [EVIDENCE_ROOT];
        while (stack.length) {
            const dir = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch {
                continue;
            }
            for (const e of entries) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) {
                    // Only descend where the jobId could live to keep the scan cheap.
                    if (e.name === jobId) {
                        if (fs.existsSync(path.join(full, "evidencia.docx")))
                            return true;
                    }
                    stack.push(full);
                }
            }
        }
    }
    catch {
        /* ignore */
    }
    return false;
}
/** Maps a TestRail discoveryStatus to the summary's result enum. */
function toResult(discoveryStatus) {
    if (discoveryStatus === "passed")
        return "passed";
    if (discoveryStatus == null)
        return "pending";
    return "failed";
}
function buildScenarioSummaries(manifest) {
    const published = manifest.publishedCases ?? [];
    // Index results by every id a scenario might be referenced under.
    const resultById = new Map();
    for (const r of manifest.results ?? []) {
        if (r.scenarioId)
            resultById.set(r.scenarioId, r);
    }
    const planTitleById = new Map();
    for (const s of manifest.executionPlan?.standardScenarios ?? []) {
        if (s.scenarioId && s.title)
            planTitleById.set(s.scenarioId, s.title);
    }
    if (published.length > 0) {
        return published.map((pc) => {
            const ids = [pc.scenarioId, pc.executionScenarioId, pc.launchScenarioId, pc.testrailCustomScenarioId].filter(Boolean);
            const r = ids.map((id) => resultById.get(id)).find(Boolean);
            const title = pc.title || ids.map((id) => planTitleById.get(id)).find(Boolean) || pc.scenarioId || "escenario";
            return {
                scenarioId: pc.scenarioId || ids[0] || "unknown",
                caseId: pc.caseId,
                title,
                result: toResult(r?.discoveryStatus),
                syncStatus: r?.syncStatus,
                testRailStatusId: r?.testRailStatusId,
            };
        });
    }
    // Fallback: no publishedCases (e.g. a run that only has results/plan).
    return (manifest.results ?? []).map((r) => ({
        scenarioId: r.scenarioId || "unknown",
        caseId: r.caseId,
        title: (r.scenarioId && planTitleById.get(r.scenarioId)) || r.scenarioId || "escenario",
        result: toResult(r.discoveryStatus),
        syncStatus: r.syncStatus,
        testRailStatusId: r.testRailStatusId,
    }));
}
/**
 * Collects the defects for this execution from the HU's checklist, flagging which ones were
 * actually registered as Jira issues (have a Jira key). When the manifest carries the executing
 * jobId we scope to that exact run; otherwise (older manifests without a jobId) we return all of
 * the HU's defects. Includes not-yet-uploaded defects so the summary is useful before the Jira
 * upload step runs — the `registeredInJira` flag distinguishes them.
 */
function buildDefectSummaries(huKey, jobId) {
    if (!huKey)
        return [];
    const list = defect_checklist_store_1.defectChecklistStore.get(huKey);
    if (!list)
        return [];
    return list.defects
        .filter((d) => (jobId ? d.jobId === jobId : true))
        .map((d) => ({
        id: d.id,
        title: d.title || d.scenarioTitle || d.scenarioId || "Defecto",
        severity: d.severity,
        status: d.status,
        registeredInJira: Boolean(d.jiraIssueKey),
        jiraIssueKey: d.jiraIssueKey,
        jiraIssueUrl: d.jiraIssueUrl,
    }));
}
/** Builds the full summary for one execution, or null if the manifest is missing/unreadable. */
function buildExecutionSummary(launchId) {
    const manifest = readManifest(launchId);
    if (!manifest)
        return null;
    const scenarios = buildScenarioSummaries(manifest);
    const passed = scenarios.filter((s) => s.result === "passed").length;
    const failed = scenarios.filter((s) => s.result === "failed").length;
    const huKey = manifest.jira?.key;
    return {
        launchId,
        jobId: manifest.jobId,
        createdAt: manifest.createdAt,
        completedAt: manifest.completedAt,
        status: manifest.status,
        hu: { key: huKey, title: manifest.jira?.title },
        project: { appSlug: manifest.appSlug },
        testRail: {
            projectId: manifest.testRail?.projectId,
            suiteId: manifest.testRail?.suiteId,
            sectionId: manifest.testRail?.sectionId ?? manifest.sectionId,
            sectionName: manifest.sectionName,
            sectionSlug: manifest.sectionSlug,
            runId: manifest.testRail?.runId,
            runUrl: buildTestRailRunUrl(manifest.testRail?.runId),
        },
        scenarios,
        summary: {
            total: manifest.summary?.total ?? scenarios.length,
            passed: manifest.summary?.passed ?? passed,
            failed: manifest.summary?.failed ?? failed,
            synced: manifest.summary?.synced,
            syncFailed: manifest.summary?.syncFailed,
        },
        defects: buildDefectSummaries(huKey, manifest.jobId),
        evidenceAvailable: hasEvidenceDocx(manifest.jobId),
    };
}
/** Lists all executions (compact), newest first. */
function listExecutionSummaries() {
    let dirs;
    try {
        dirs = fs
            .readdirSync(LAUNCH_ARTIFACTS_DIR, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name);
    }
    catch {
        return [];
    }
    const items = [];
    for (const launchId of dirs) {
        const m = readManifest(launchId);
        if (!m)
            continue;
        const scenarios = buildScenarioSummaries(m);
        items.push({
            launchId,
            createdAt: m.createdAt,
            completedAt: m.completedAt,
            status: m.status,
            huKey: m.jira?.key,
            huTitle: m.jira?.title,
            appSlug: m.appSlug,
            testRunId: m.testRail?.runId,
            scenarioCount: m.summary?.total ?? scenarios.length,
            passed: m.summary?.passed ?? scenarios.filter((s) => s.result === "passed").length,
            failed: m.summary?.failed ?? scenarios.filter((s) => s.result === "failed").length,
        });
    }
    return items.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}
