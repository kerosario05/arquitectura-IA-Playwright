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