import type { InputRequirement } from "../db/project-case-input-requirement-service";
import { replaceForProjectAndCase } from "../db/project-case-input-requirement-service";
import { getProjectBySlug } from "../db/project-repository";
import type { RawTestRailCase } from "../types/testrail.types";
import {
  extractTestRailInputRequirements,
} from "./testrail-input-requirements-adapter";
import type { ParsedTestRailInputRequirements } from "./testrail-input-requirements-parser";

export type TestRailInputRequirementsSyncInput = {
  projectSlug: string;
  caseId: number;
  rawTestRailCase: RawTestRailCase;
  requirements?: InputRequirement[];
};

export type TestRailInputRequirementsSyncDependencies = {
  adapter?: (rawCase: RawTestRailCase) => ParsedTestRailInputRequirements;
  resolveProjectId?: (projectSlug: string) => Promise<string | null>;
  replaceForProjectAndCase?: (projectId: string, caseId: number, requirements: InputRequirement[]) => Promise<void>;
};

export type TestRailInputRequirementsSyncResult = ParsedTestRailInputRequirements & {
  persisted: boolean;
};

export async function syncTestRailInputRequirements(
  input: TestRailInputRequirementsSyncInput,
  dependencies: TestRailInputRequirementsSyncDependencies = {},
): Promise<TestRailInputRequirementsSyncResult> {
  const adapter = dependencies.adapter ?? extractTestRailInputRequirements;
  const parsed = adapter(input.rawTestRailCase);
  if (parsed.conflicts.length > 0) {
    throw new Error(`conflicting input requirement metadata for ${parsed.conflicts.map((conflict) => conflict.key).join(", ")}`);
  }
  const requirements = input.requirements ?? parsed.requirements;
  if (requirements.length === 0) return { ...parsed, persisted: false };

  const resolveProjectId = dependencies.resolveProjectId ?? (async (projectSlug: string) => {
    const project = await getProjectBySlug(projectSlug);
    return project?.id ?? null;
  });
  const projectId = await resolveProjectId(input.projectSlug);
  if (!projectId) throw new Error(`project not found: ${input.projectSlug}`);

  const persist = dependencies.replaceForProjectAndCase
    ?? (async (_projectId: string, caseId: number, requirements: InputRequirement[]) => {
      await replaceForProjectAndCase(input.projectSlug, caseId, requirements);
    });
  await persist(projectId, input.caseId, requirements);
  return { ...parsed, requirements, persisted: true };
}
