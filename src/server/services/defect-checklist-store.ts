import * as fs from "fs";
import * as path from "path";

export type Severity = "low" | "medium" | "high" | "critical";
export type DefectStatus = "pending_review" | "accepted" | "rejected" | "fixed";

export type Defect = {
  id: string;
  scenarioId?: string;
  scenarioTitle?: string;
  jobId?: string;
  description: string;
  severity: Severity;
  severityReason?: string;
  evidenceUrl?: string;
  status: DefectStatus;
  createdAt: string;
  updatedAt: string;
  technicalContext?: {
    reasonCode?: string;
    discoveryStatus?: string;
    failedAtStep?: number;
    failedTarget?: string;
    expectedResult?: string;
    rawError?: string;
    evidenceDir?: string;
    evidencePath?: string;
    lastSuccessfulStep?: {
      stepIndex: number;
      action?: string;
      target?: string;
      evidencePath?: string;
    };
    testRailCaseId?: number | string;
    testRailRunId?: number | string;
  };
};

export type Checklist = {
  id: string;
  issueKey: string;
  title?: string;
  urlSlug: string;
  defects: Defect[];
  createdAt: string;
  updatedAt: string;
};

const VALID_SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
const VALID_DEFECT_STATUSES: DefectStatus[] = ["pending_review", "accepted", "rejected", "fixed"];

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

class DefectChecklistStore {
  private filePath: string;
  private cache: Checklist[] | null = null;

  constructor() {
    this.filePath = path.join(process.cwd(), "data", "hu-defect-checklists.json");
  }

  private load(): Checklist[] {
    if (this.cache) return this.cache;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        this.cache = JSON.parse(raw) as Checklist[];
      } else {
        this.cache = [];
      }
    } catch {
      this.cache = [];
    }
    return this.cache!;
  }

  private save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), "utf-8");
  }

  getOrCreate(issueKey: string, title?: string): Checklist {
    const lists = this.load();
    let found = lists.find(c => c.issueKey === issueKey);
    if (found) return found;
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

  get(issueKey: string): Checklist | undefined {
    return this.load().find(c => c.issueKey === issueKey);
  }

  addDefect(
    issueKey: string,
    params: { description: string; severity: Severity; severityReason?: string; jobId?: string; scenarioId?: string; scenarioTitle?: string; evidenceUrl?: string; technicalContext?: Defect["technicalContext"] }
  ): Defect | null {
    if (!VALID_SEVERITIES.includes(params.severity)) return null;
    const list = this.getOrCreate(issueKey);
    const now = new Date().toISOString();
    const defect: Defect = {
      id: generateId(),
      description: params.description,
      severity: params.severity,
      severityReason: params.severityReason,
      jobId: params.jobId,
      status: "pending_review",
      scenarioId: params.scenarioId,
      scenarioTitle: params.scenarioTitle,
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

  get(issueKey: string): Checklist | undefined {
    return this.load().find(c => c.issueKey === issueKey);
  }

  updateDefectStatus(issueKey: string, defectId: string, status: DefectStatus): Defect | null {
    if (!VALID_DEFECT_STATUSES.includes(status)) return null;
    const list = this.load().find(c => c.issueKey === issueKey);
    if (!list) return null;
    const defect = list.defects.find(d => d.id === defectId);
    if (!defect) return null;
    defect.status = status;
    defect.updatedAt = new Date().toISOString();
    list.updatedAt = defect.updatedAt;
    this.save();
    return defect;
  }

  toResponse(list: Checklist, jobId?: string): { issueKey: string; title?: string; checklistUrl: string; defects: Defect[]; createdAt: string; updatedAt: string } {
    const defects = jobId ? list.defects.filter(d => d.jobId === jobId) : list.defects;
    return {
      issueKey: list.issueKey,
      title: list.title,
      checklistUrl: `/checklist/${list.urlSlug}`,
      defects,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
    };
  }
}

export const defectChecklistStore = new DefectChecklistStore();
