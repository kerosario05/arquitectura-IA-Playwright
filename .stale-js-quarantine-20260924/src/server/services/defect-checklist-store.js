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
exports.defectChecklistStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const VALID_SEVERITIES = ["low", "medium", "high", "critical"];
const VALID_DEFECT_STATUSES = ["pending_review", "accepted", "rejected", "fixed"];
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
/** The runId a defect belongs to is the explicitly persisted mobile execution runId only.
 *  It is NEVER derived from testRailRunId, launchId or jobId — those remain independent
 *  metadata in technicalContext. */
function resolveDefectRunId(defect) {
    return defect.runId;
}
class DefectChecklistStore {
    filePath;
    cache = null;
    constructor() {
        this.filePath = path.join(process.cwd(), "data", "hu-defect-checklists.json");
    }
    load() {
        if (this.cache)
            return this.cache;
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, "utf-8");
                this.cache = JSON.parse(raw);
            }
            else {
                this.cache = [];
            }
        }
        catch {
            this.cache = [];
        }
        return this.cache;
    }
    save() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), "utf-8");
    }
    getOrCreate(issueKey, title) {
        const lists = this.load();
        let found = lists.find(c => c.issueKey === issueKey);
        if (found)
            return found;
        const now = new Date().toISOString();
        found = {
            id: generateId(),
            issueKey,
            title,
            urlSlug: issueKey,
            defects: [],
            createdAt: now,
            updatedAt: now,
        };
        lists.push(found);
        this.save();
        return found;
    }
    get(issueKey) {
        return this.load().find(c => c.issueKey === issueKey);
    }
    addDefect(issueKey, params) {
        if (!VALID_SEVERITIES.includes(params.severity))
            return null;
        const list = this.getOrCreate(issueKey);
        const now = new Date().toISOString();
        const defect = {
            id: generateId(),
            description: params.description,
            severity: params.severity,
            severityReason: params.severityReason,
            jobId: params.jobId,
            runId: params.runId,
            status: "pending_review",
            scenarioId: params.scenarioId,
            scenarioTitle: params.scenarioTitle,
            title: params.title,
            evidenceUrl: params.evidenceUrl,
            technicalContext: params.technicalContext,
            createdAt: now,
            updatedAt: now,
        };
        list.defects.push(defect);
        list.updatedAt = now;
        this.save();
        return defect;
    }
    get(issueKey) {
        return this.load().find(c => c.issueKey === issueKey);
    }
    updateDefectStatus(issueKey, defectId, status) {
        if (!VALID_DEFECT_STATUSES.includes(status))
            return null;
        const list = this.load().find(c => c.issueKey === issueKey);
        if (!list)
            return null;
        const defect = list.defects.find(d => d.id === defectId);
        if (!defect)
            return null;
        defect.status = status;
        defect.updatedAt = new Date().toISOString();
        list.updatedAt = defect.updatedAt;
        this.save();
        return defect;
    }
    findDefect(issueKey, defectId) {
        const list = this.load().find(c => c.issueKey === issueKey);
        return list?.defects.find(d => d.id === defectId);
    }
    persist() {
        this.save();
    }
    toResponse(list, filter) {
        let defects = list.defects;
        if (filter?.runId) {
            // Strict run isolation: when a runId is provided, show ONLY defects of that run. No
            // fallback to issueKey/story even if the runId matches nothing.
            const runId = String(filter.runId);
            defects = defects.filter((d) => resolveDefectRunId(d) === runId);
        }
        else if (filter?.jobId) {
            defects = defects.filter((d) => d.jobId === filter.jobId);
        }
        const withRunId = defects.map((d) => ({ ...d, runId: resolveDefectRunId(d) }));
        return {
            issueKey: list.issueKey,
            title: list.title,
            checklistUrl: `/checklist/${list.urlSlug}`,
            defects: withRunId,
            total: withRunId.length,
            pendingReview: withRunId.filter((d) => d.status === "pending_review").length,
            highSeverity: withRunId.filter((d) => d.severity === "high" || d.severity === "critical").length,
            createdAt: list.createdAt,
            updatedAt: list.updatedAt,
        };
    }
}
exports.defectChecklistStore = new DefectChecklistStore();
