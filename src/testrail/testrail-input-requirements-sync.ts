import type { InputRequirement } from "../db/project-case-input-requirement-service";
import { getByProjectAndCase, replaceForProjectAndCase } from "../db/project-case-input-requirement-service";
import { getProjectBySlug } from "../db/project-repository";
import type { RawTestRailCase } from "../types/testrail.types";
import {
  extractTestRailInputRequirementsForSelection,
} from "./testrail-input-requirements-adapter";
import type { ParsedTestRailInputRequirements } from "./testrail-input-requirements-parser";
import { loadPromotedRuntimeInputRequirements } from "../automations/promoted-runtime-input-requirements";
import { normalizeTestRailCase } from "./testrail-normalizer";

export type TestRailInputRequirementsSyncInput = {
  projectSlug: string;
  caseId: number;
  rawTestRailCase: RawTestRailCase;
  requirements?: InputRequirement[];
};

export type TestRailInputRequirementsSyncDependencies = {
  loadPromotedRequirements?: typeof loadPromotedRuntimeInputRequirements;
  adapter?: (rawCase: RawTestRailCase) => ParsedTestRailInputRequirements;
  resolveProjectId?: (projectSlug: string) => Promise<string | null>;
  replaceForProjectAndCase?: (projectId: string, caseId: number, requirements: InputRequirement[]) => Promise<void>;
  getByProjectAndCase?: (projectSlug: string, caseId: number) => Promise<InputRequirement[]>;
};

export type TestRailInputRequirementsSyncResult = ParsedTestRailInputRequirements & {
  persisted: boolean;
};

export async function syncTestRailInputRequirements(
  input: TestRailInputRequirementsSyncInput,
  dependencies: TestRailInputRequirementsSyncDependencies = {},
): Promise<TestRailInputRequirementsSyncResult> {
  const adapter = dependencies.adapter ?? extractTestRailInputRequirementsForSelection;
  // A verified promoted plan owns its execution keys. Re-inferring fields from
  // prose creates new keys for inputs already bound by that plan.
  const promoted = input.requirements ? [] : await (dependencies.loadPromotedRequirements ?? loadPromotedRuntimeInputRequirements)({
    appSlug: input.projectSlug, caseId: input.caseId, scenario: normalizeTestRailCase(input.rawTestRailCase),
  });
  if (promoted.length > 0) {
    const persist = dependencies.replaceForProjectAndCase
      ?? (async (_projectId: string, caseId: number, requirements: InputRequirement[]) => {
        await replaceForProjectAndCase(input.projectSlug, caseId, requirements);
      });
    const projectId = await (dependencies.resolveProjectId ?? (async (slug: string) => (await getProjectBySlug(slug))?.id ?? null))(input.projectSlug);
    if (!projectId) throw new Error(`project not found: ${input.projectSlug}`);
    await persist(projectId, input.caseId, promoted);
    return { requirements: promoted, unresolvedPlaceholders: [], conflicts: [], persisted: true };
  }
  const parsed = adapter(input.rawTestRailCase);
  if (parsed.conflicts.length > 0) {
    throw new Error(`conflicting input requirement metadata for ${parsed.conflicts.map((conflict) => conflict.key).join(", ")}`);
  }
  let requirements = input.requirements ?? parsed.requirements;
  if (requirements.length === 0) return { ...parsed, persisted: false };

  const resolveProjectId = dependencies.resolveProjectId ?? (async (projectSlug: string) => {
    const project = await getProjectBySlug(projectSlug);
    return project?.id ?? null;
  });
  const projectId = await resolveProjectId(input.projectSlug);
  if (!projectId) throw new Error(`project not found: ${input.projectSlug}`);

  if (!input.requirements) {
    const existing = await (dependencies.getByProjectAndCase ?? getByProjectAndCase)(input.projectSlug, input.caseId);
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    requirements = [...existing];
    for (const requirement of parsed.requirements) {
      if (requirements.some(item => normalize(item.key) === normalize(requirement.key)
        || (requirement.source === "runtime_inferred" && item.label && requirement.label
          && normalize(item.label) === normalize(requirement.label)))) continue;
      requirements.push(requirement);
    }
  }

  const persist = dependencies.replaceForProjectAndCase
    ?? (async (_projectId: string, caseId: number, requirements: InputRequirement[]) => {
      await replaceForProjectAndCase(input.projectSlug, caseId, requirements);
    });
  await persist(projectId, input.caseId, requirements);
  return { ...parsed, requirements, persisted: true };
}
