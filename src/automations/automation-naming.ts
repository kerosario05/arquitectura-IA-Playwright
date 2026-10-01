import type { PromotedAutomationSource } from "../types/automation-promotion.types";

const INVALID_WINDOWS_CHARS = /[<>:"/\\|?*]/g;
const MULTIPLE_HYPHENS = /-+/g;

export function sanitizeAutomationFileName(value: string): string {
  let result = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\-_]/g, "-")
    .replace(INVALID_WINDOWS_CHARS, "-")
    .replace(/_/g, "-")
    .replace(MULTIPLE_HYPHENS, "-")
    .replace(/^-+|-+$/g, "");

  if (result.length > 120) {
    result = result.substring(0, 120).replace(/-+$/g, "");
  }

  return result || "automation";
}

export function buildAutomationId(input: {
  externalId?: string;
  caseId?: number;
  title: string;
}): string {
  const parts: string[] = [];

  if (input.externalId) {
    parts.push(sanitizeAutomationFileName(input.externalId.trim()));
  } else if (input.caseId !== undefined && input.caseId !== null) {
    parts.push(String(input.caseId));
  }

  const sanitizedTitle = sanitizeAutomationFileName(input.title);
  if (parts.length > 0) {
    parts.push(sanitizedTitle);
  } else {
    parts.push(sanitizedTitle);
  }

  return parts.join("-");
}

// The observed titles of recorded scenarios run to ~100 characters, and a case folder holds
// runs/evidence subfolders several levels deep: the whole title would push them past the
// Windows 260-character path limit.
const RECORDED_TITLE_SLUG_LENGTH = 40;

/**
 * Folder/registry id of the case promoted from an execution plan.
 *
 * A case that comes from a Recording is named after its RecordedScenario ("rec-7bde3453-01-…"):
 * the batch display id (PREVIEW-001) is only a position, so two recordings with the same title
 * used to land in the same folder and the folder could not be traced back to its recording.
 */
export function buildPlanAutomationId(scenario: {
  externalId?: string;
  caseId?: number;
  title: string;
  recordedScenarioId?: string;
}): string {
  const recordedScenarioId = scenario.recordedScenarioId?.trim();
  if (recordedScenarioId) {
    const fullSlug = sanitizeAutomationFileName(scenario.title);
    // Cut at the last whole word that fits, not in the middle of one.
    const titleSlug = fullSlug.length > RECORDED_TITLE_SLUG_LENGTH
      ? fullSlug.slice(0, RECORDED_TITLE_SLUG_LENGTH + 1).replace(/-[^-]*$/, "")
      : fullSlug;
    return [sanitizeAutomationFileName(recordedScenarioId), titleSlug].filter(Boolean).join("-");
  }
  return buildAutomationId({ externalId: scenario.externalId, caseId: scenario.caseId, title: scenario.title });
}

export function buildAutomationPaths(id: string, outputRoot?: string): {
  planDir: string;
  specDir: string;
  planPath: string;
  specPath: string;
} {
  const root = outputRoot ?? ".";
  const planDir = `${root}/automations/plans`;
  const specDir = `${root}/tests/generated`;
  return {
    planDir,
    specDir,
    planPath: `${planDir}/${id}.plan.json`,
    specPath: `${specDir}/${id}.spec.ts`
  };
}

export function buildPromotedAutomationPaths(appSlug: string, automationId: string): {
  planDir: string;
  specDir: string;
  planPath: string;
  specPath: string;
} {
  const planDir = `automations/apps/${appSlug}/plans`;
  const specDir = `automations/apps/${appSlug}/cases/${automationId}`;
  return {
    planDir,
    specDir,
    planPath: `${planDir}/${automationId}.plan.json`,
    specPath: `${specDir}/case.spec.ts`
  };
}

export function determineAutomationStatus(
  planStatus: string,
  source: PromotedAutomationSource
): "active" | "draft" {
  if (planStatus === "validated") {
    return "active";
  }
  return "draft";
}