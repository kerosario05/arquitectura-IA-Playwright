import type { RawTestRailCase } from "../../types/testrail.types";
import { migrateTestRailRequirements } from "../../testrail/testrail-requirement-migration";

export type TestRailInputRequirementsMigrationJobInput = {
  projectSlug: string;
  projectId?: number;
  cases: RawTestRailCase[];
};

export type TestRailInputRequirementsMigrationJobCaseResult = {
  caseId: number;
  status: string;
  requirementsCount: number;
};

export type TestRailInputRequirementsMigrationJobOutput = {
  totalCases: number;
  completed: number;
  empty: number;
  blocked: number;
  results: TestRailInputRequirementsMigrationJobCaseResult[];
};

export async function runTestRailInputRequirementsMigrationJob(
  input: TestRailInputRequirementsMigrationJobInput,
): Promise<TestRailInputRequirementsMigrationJobOutput> {
  const results: TestRailInputRequirementsMigrationJobCaseResult[] = [];

  for (const rawCase of input.cases) {
    const caseId = Number(rawCase?.id) || 0;
    try {
      const migration = migrateTestRailRequirements({
        caseId,
        rawCase,
        approvedProposals: [],
      });
      results.push({
        caseId,
        status: migration.status,
        requirementsCount: migration.requirements.length,
      });
    } catch {
      results.push({ caseId, status: "blocked", requirementsCount: 0 });
    }
  }

  return {
    totalCases: results.length,
    completed: results.filter((result) => result.status === "completed").length,
    empty: results.filter((result) => result.status === "empty").length,
    blocked: results.filter((result) => result.status === "blocked").length,
    results,
  };
}
