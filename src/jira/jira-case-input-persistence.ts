import { replaceForProjectAndCase } from "../db/project-case-input-requirement-service";
import { persistConfirmedRuntimeValues } from "../db/project-case-runtime-value-service";
import type { JiraInputRequirement } from "./jira-input-requirements";

/** Resolve the unique TestRail case associated with a Jira scenario identity. */
export function resolveJiraPublishedCaseId(publishedCases: unknown, scenarioId: string): number | undefined {
  const mappings = Array.isArray(publishedCases) ? publishedCases : [];
  const caseIds = new Set<number>();
  for (const mapping of mappings) {
    if (!mapping || typeof mapping !== "object") continue;
    if (![mapping.scenarioId, mapping.executionScenarioId, mapping.launchScenarioId].includes(scenarioId)) continue;
    if (Number.isSafeInteger(mapping.caseId) && mapping.caseId > 0) caseIds.add(mapping.caseId);
  }
  return caseIds.size === 1 ? Array.from(caseIds)[0] : undefined;
}

/** Bridge Jira's authoritative input keys to the TestRail case selected later in QA Lab. */
export async function persistJiraCaseInputs(input: {
  projectSlug: string;
  scenarioId: string;
  publishedCases: unknown;
  requirements: JiraInputRequirement[];
  values: Record<string, string>;
}, dependencies: {
  replace?: typeof replaceForProjectAndCase;
  persist?: typeof persistConfirmedRuntimeValues;
} = {}): Promise<{ status: "persisted" | "unmapped"; caseId?: number; fields: number; values: number }> {
  const caseId = resolveJiraPublishedCaseId(input.publishedCases, input.scenarioId);
  if (caseId === undefined) return { status: "unmapped", fields: 0, values: 0 };
  const requirements = input.requirements.map(requirement => ({
    key: requirement.key, label: requirement.label, controlType: requirement.controlType,
    required: requirement.required, sensitive: requirement.sensitive, allowedValues: [],
  }));
  await (dependencies.replace ?? replaceForProjectAndCase)(input.projectSlug, caseId, requirements);
  const values = input.requirements.flatMap(requirement => {
    const value = input.values[requirement.key];
    return typeof value === "string" && value.trim()
      ? [{ key: requirement.key, value, sensitive: requirement.sensitive, fieldKind: requirement.controlType, verified: false }]
      : [];
  });
  const persisted = await (dependencies.persist ?? persistConfirmedRuntimeValues)({
    projectSlug: input.projectSlug, caseId, values,
  });
  return { status: "persisted", caseId, fields: requirements.length, values: persisted };
}
