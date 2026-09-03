export type EvidenceStepStatus = "passed" | "failed" | "skipped";

export type EvidenceScenarioStatus = "Exitoso" | "Fallido" | "No ejecutado" | "Parcial / Con observaciones";

export interface EvidenceConfig {
  enabled: boolean;
  docxEnabled: boolean;
  perScenarioDocx: boolean;
  templatePath: string;
  outputRoot: string;
  screenshotMode: "after_step";
  fullPage: boolean;
  failOnError: boolean;
  analystName: string;
  preserveTemplateLayout: boolean;
}

export interface EvidenceScenarioContext {
  appSlug: string;
  sectionSlug: string;
  sectionName?: string;
  scenarioId: string;
  scenarioTitle: string;
  caseId?: number | string;
  runId?: string;
  outputRoot?: string;
  analystName?: string;
  templatePath?: string;
}

export interface EvidenceStepRecord {
  index: number;
  stepIndex?: number;
  stepText: string;
  target?: string;
  status: EvidenceStepStatus;
  screenshotPath?: string;
  snapshotPath?: string;
  timestamp: string;
  errorMessage?: string;
}

export interface InitialScreenEvidence {
  status: "ready" | "load_failed";
  captured: boolean;
  path: string | null;
  capturedAt: string;
  reason?: string;
}

export interface DetailEvidenceMetadata {
  required: boolean;
  captured: boolean;
  target?: string;
  capturedAfterStep?: number;
  screenshotPath?: string;
  reason?: string; // "detail_loaded" | "insufficient_detail_signals" | "missing" | "not_required"
  // Oracle signal details for diagnostics
  detailOpened?: boolean;
  detailHeading?: boolean;
  detailSections?: boolean;
  actionButtons?: boolean;
  oracleReason?: string; // Same as reason, kept for backward compat
}

export interface EvidenceScenarioRecord {
  scenarioId: string;
  scenarioTitle: string;
  requirement: string;
  analyst: string;
  date: string;
  status: EvidenceScenarioStatus;
  appSlug: string;
  sectionSlug: string;
  sectionName?: string;
  initialScreenEvidence?: InitialScreenEvidence;
  steps: EvidenceStepRecord[];
  finalScreenEvidence?: {
    captured: boolean;
    path: string | null;
    capturedAt: string;
  };
  docxPath?: string;
  evidenceJsonPath?: string;
  detailEvidence?: DetailEvidenceMetadata;
  evidenceKind?: string;
  isDetailEvidence?: boolean;
  lastActionTarget?: string;
}

export const DEFAULT_EVIDENCE_CONFIG: EvidenceConfig = {
  enabled: true,
  docxEnabled: true,
  perScenarioDocx: false,
  templatePath: "templates/evidence/execution-evidence-template.docx",
  outputRoot: ".artifacts/evidence",
  screenshotMode: "after_step",
  fullPage: true,
  failOnError: false,
  analystName: "",
  preserveTemplateLayout: true,
};

export function loadEvidenceConfig(env: Record<string, string | undefined> = process.env): EvidenceConfig {
  return {
    enabled: env.EVIDENCE_ENABLED !== "false",
    docxEnabled: env.EVIDENCE_DOCX_ENABLED !== "false",
    perScenarioDocx: env.EVIDENCE_PER_SCENARIO_DOCX === "true",
    templatePath: env.EVIDENCE_TEMPLATE_PATH ?? DEFAULT_EVIDENCE_CONFIG.templatePath,
    outputRoot: env.EVIDENCE_OUTPUT_DIR ?? DEFAULT_EVIDENCE_CONFIG.outputRoot,
    screenshotMode: (env.EVIDENCE_SCREENSHOT_MODE as any) ?? "after_step",
    fullPage: env.EVIDENCE_FULL_PAGE !== "false",
    failOnError: env.EVIDENCE_FAIL_ON_ERROR === "true",
    analystName: env.EVIDENCE_ANALYST_NAME ?? "",
    preserveTemplateLayout: env.EVIDENCE_PRESERVE_TEMPLATE_LAYOUT !== "false",
  };
}

export function mapStatusToSpanish(status: EvidenceStepStatus): EvidenceScenarioStatus {
  switch (status) {
    case "passed": return "Exitoso";
    case "failed": return "Fallido";
    case "skipped": return "No ejecutado";
  }
}

export function deriveScenarioStatus(steps: EvidenceStepRecord[]): EvidenceScenarioStatus {
  if (steps.length === 0) return "No ejecutado";
  const hasFailed = steps.some(s => s.status === "failed");
  const hasSkipped = steps.some(s => s.status === "skipped");
  const hasPassed = steps.some(s => s.status === "passed");

  // If has failed steps but also passed steps, it's partial (recovered from failure)
  if (hasFailed && hasPassed) return "Parcial / Con observaciones";

  // If has failed steps and no passed steps, it's failed
  if (hasFailed) return "Fallido";

  // If has skipped and passed, it's partial
  if (hasSkipped && hasPassed) return "Parcial / Con observaciones";

  // If all passed, it's successful
  if (hasPassed) return "Exitoso";

  return "No ejecutado";
}

// ── Run-level evidence types ──

export interface EvidenceRunContext {
  appSlug: string;
  sectionSlug: string;
  sectionName?: string;
  runId: string;
  outputRoot?: string;
  analystName?: string;
  templatePath?: string;
}

export interface EvidenceRunRecord {
  runId: string;
  appSlug: string;
  sectionSlug: string;
  sectionName?: string;
  analyst: string;
  date: string;
  scenarios: EvidenceScenarioRecord[];
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  partialScenarios: number;
  docxPath?: string;
  evidenceJsonPath?: string;
}
