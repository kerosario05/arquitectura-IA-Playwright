import type { EvidenceScenarioRecord, EvidenceStepRecord } from "../evidence/evidence-types";
import { normalizeJiraScenarioForExecution, type JiraScenarioInput } from "./jira-semantic-executor";

export type JiraScenarioOutcome = {
  caseId?: string;
  scenarioId?: string;
  status: "passed" | "failed" | "skipped" | string;
  failedAtStep?: number;
  failurePhase?: "discovery" | "spec_generation";
  initialScreenshotPath?: string;
  initialScreenIdentity?: { id: string; title: string };
  stepScreenshotPaths?: Record<string, string>;
  stepScreenIdentities?: Record<string, { id: string; title: string }>;
  screenshotPath?: string;
  evidenceScreenshotPath?: string;
};

/** Carries only observed screen identities from the Jira runner into evidence outcomes. */
export function jiraEvidenceScreenIdentityFields(
  identities: Pick<JiraScenarioOutcome, "initialScreenIdentity" | "stepScreenIdentities">,
): Pick<JiraScenarioOutcome, "initialScreenIdentity" | "stepScreenIdentities"> {
  return {
    ...(identities.initialScreenIdentity ? { initialScreenIdentity: identities.initialScreenIdentity } : {}),
    ...(identities.stepScreenIdentities && Object.keys(identities.stepScreenIdentities).length > 0
      ? { stepScreenIdentities: identities.stepScreenIdentities }
      : {}),
  };
}

export type JiraEvidenceContext = {
  requirementTitle?: string;
  appSlug: string;
  sectionSlug: string;
  sectionName?: string;
  analyst?: string;
  date?: string;
  /** Effective runtime values keyed by scenario ID; secret values are masked before entering evidence records. */
  dataValuesByScenario?: Record<string, Record<string, string>>;
};

const SENSITIVE_EVIDENCE_DATA = /(?:password|contrase[nñ]a|clave|\bpin\b|\botp\b|token|secret|secreto)/i;

function jiraEvidenceTestData(
  source: JiraScenarioInput,
  values: Record<string, string> | undefined,
): Array<{ label: string; value: string }> {
  if (!values) return [];
  const seen = new Set<string>();
  return (source.inputRequirements ?? []).flatMap(requirement => {
    const label = requirement.label.trim();
    const value = String(values[requirement.key] ?? "").trim();
    if (!label || !value) return [];
    const identity = `${requirement.key}\u0000${label}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [{
      label,
      value: requirement.sensitive || SENSITIVE_EVIDENCE_DATA.test(`${requirement.key} ${label}`)
        ? "[Protegido]"
        : value,
    }];
  });
}

/** Turns the scenario's visible test-data requirements into report preconditions.
 * Actual values are stored separately in testData after sensitive-value masking.
 */
export function jiraEvidencePreconditions(source: {
  preconditions?: unknown;
  inputRequirements?: unknown;
}): string[] {
  const explicit = Array.isArray(source.preconditions)
    ? source.preconditions.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map(value => value.trim())
    : [];
  const conditionLabel = { valid: "válido", invalid: "no válido", expired: "expirado" } as const;
  const inputRequirements = Array.isArray(source.inputRequirements) ? source.inputRequirements : [];
  const dataRequirements = inputRequirements.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const requirement = value as Record<string, unknown>;
    const label = typeof requirement.label === "string" ? requirement.label.trim() : "";
    if (!label || requirement.required === false) return [];
    const condition = typeof requirement.dataCondition === "string" && requirement.dataCondition in conditionLabel
      ? conditionLabel[requirement.dataCondition as keyof typeof conditionLabel]
      : "requerido";
    const step = Number.isInteger(requirement.stepIndex) && Number(requirement.stepIndex) > 0
      ? ` · paso ${requirement.stepIndex}` : "";
    return [`${label} · ${condition}${step}`];
  });
  return [...new Set([...explicit, ...dataRequirements])];
}

function evidenceStepStatus(
  outcome: JiraScenarioOutcome,
  stepNumber: number,
): EvidenceStepRecord["status"] {
  if (outcome.status === "passed") return "passed";
  if (outcome.failurePhase === "spec_generation") return "passed";
  const failedAt = outcome.failedAtStep ?? 1;
  if (stepNumber < failedAt) return "passed";
  if (stepNumber === failedAt) return "failed";
  return "skipped";
}

function formatEvidenceDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleDateString("es-DO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Santo_Domingo",
  });
}

/** Projects Jira execution inputs/results into the shared report model without touching Recording. */
export function buildJiraEvidenceScenarioRecords(
  scenarios: JiraScenarioInput[],
  outcomes: JiraScenarioOutcome[],
  context: JiraEvidenceContext,
): EvidenceScenarioRecord[] {
  const outcomeById = new Map(outcomes.map((outcome) => [String(outcome.scenarioId ?? outcome.caseId ?? ""), outcome]));
  const timestamp = context.date ?? new Date().toISOString();

  return scenarios.map((source) => {
    const scenario = normalizeJiraScenarioForExecution(source, context.appSlug).scenario;
    const outcome = outcomeById.get(source.scenarioId) ?? { scenarioId: source.scenarioId, status: "skipped" };
    const status = outcome.status === "passed" ? "Exitoso" : outcome.status === "failed" ? "Fallido" : "No ejecutado";
    const screenshotPath = outcome.evidenceScreenshotPath ?? outcome.screenshotPath;
    const screenVisits: string[] = [];
    let priorScreenId: string | undefined;
    let visitNumber = 0;
    for (let index = 0; index < scenario.steps.length; index += 1) {
      const identity = outcome.stepScreenIdentities?.[String(index + 1)];
      const isUnexecuted = evidenceStepStatus(outcome, index + 1) === "skipped";
      // Unexecuted steps have no observed application screen. Keep them together in
      // one explicit pending section instead of inventing one screen per step.
      const screenId = identity?.id ?? (isUnexecuted ? "jira-unexecuted-steps" : undefined);
      if (screenId !== priorScreenId) visitNumber += 1;
      priorScreenId = screenId;
      screenVisits[index] = screenId ? `${screenId}#visit-${visitNumber}` : `step-${index + 1}`;
    }
    const lastScreenshotByVisit = new Map<string, number>();
    for (let index = 0; index < scenario.steps.length; index += 1) {
      const stepNumber = index + 1;
      const stepStatus = evidenceStepStatus(outcome, stepNumber);
      const hasStepScreenshot = Boolean(outcome.stepScreenshotPaths?.[String(stepNumber)])
        || (stepStatus === "failed" && Boolean(screenshotPath))
        || (outcome.status === "passed" && stepNumber === scenario.steps.length && Boolean(screenshotPath));
      if (hasStepScreenshot) lastScreenshotByVisit.set(screenVisits[index], stepNumber);
    }

    const steps: EvidenceStepRecord[] = scenario.steps.map((stepText, index) => {
      const stepNumber = index + 1;
      const stepStatus = evidenceStepStatus(outcome, stepNumber);
      const identity = outcome.stepScreenIdentities?.[String(stepNumber)];
      const isRepresentativeScreenshot = lastScreenshotByVisit.get(screenVisits[index]) === stepNumber;
      const stepScreenshotPath = isRepresentativeScreenshot
        ? outcome.stepScreenshotPaths?.[String(stepNumber)]
          ?? (stepStatus === "failed" ? screenshotPath : undefined)
          ?? (outcome.status === "passed" && stepNumber === scenario.steps.length ? screenshotPath : undefined)
        : undefined;
      return {
        index: stepNumber,
        stepIndex: stepNumber,
        stepText,
        status: stepStatus,
        timestamp,
        ...(identity
          ? { screenId: identity.id, screenTitle: identity.title }
          : stepStatus === "skipped"
            ? { screenId: "jira-unexecuted-steps", screenTitle: "Pasos no ejecutados" }
            : {}),
        ...(stepScreenshotPath
          ? { screenshotPath: stepScreenshotPath }
          : {}),
      };
    });

    return {
      scenarioId: source.scenarioId,
      scenarioTitle: source.title,
      issueKey: source.sourceIssueKey,
      expectedResult: source.expectedResult,
      testType: source.testType,
      testApproach: source.testApproach,
      preconditions: jiraEvidencePreconditions(source),
      testData: jiraEvidenceTestData(source, context.dataValuesByScenario?.[source.scenarioId]),
      requirement: [source.sourceIssueKey, context.requirementTitle?.trim()].filter(Boolean).join(" "),
      analyst: context.analyst || "QA Lab",
      date: formatEvidenceDate(timestamp),
      status,
      evidenceKind: "jira_semantic",
      captureStatus: "success",
      discoveryStatus: outcome.status,
      functionalStatus: outcome.status === "passed" ? "passed" : outcome.status === "failed" ? "failed" : "not_run",
      appSlug: context.appSlug,
      sectionSlug: context.sectionSlug,
      sectionName: context.sectionName,
      ...(outcome.initialScreenshotPath ? { initialScreenEvidence: {
        status: "ready" as const,
        captured: true,
        path: outcome.initialScreenshotPath,
        capturedAt: timestamp,
        ...(outcome.initialScreenIdentity ? {
          screenId: outcome.initialScreenIdentity.id,
          screenTitle: outcome.initialScreenIdentity.title,
        } : {}),
      } } : {}),
      steps,
      ...(screenshotPath ? { finalScreenEvidence: { captured: true, path: screenshotPath, capturedAt: timestamp } } : {}),
    };
  });
}
