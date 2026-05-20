import type { PlansExecutionSummary, PlanExecutionResult } from "../types/plan-execution.types";
import type { AddResultForCaseInput } from "../types/testrail.types";
import { TestRailClient } from "../clients/testrail.client";

const STATUS_MAP: Record<string, number> = {
  passed: 1,
  blocked: 2,
  untested: 3,
  retest: 4,
  failed: 5
};

export function mapExecutionStatusToTestRail(status: string): number {
  if (status === "passed") return STATUS_MAP.passed;
  if (status === "failed") return STATUS_MAP.failed;
  if (status === "partial") return STATUS_MAP.failed;
  if (status === "skipped") return STATUS_MAP.blocked;
  return STATUS_MAP.untested;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export function buildComment(result: PlanExecutionResult): string {
  const parts: string[] = [];
  const stepSummary = result.steps.filter((s) => s.status !== "skipped");
  const failedSteps = stepSummary.filter((s) => s.status === "failed");

  if (failedSteps.length > 0) {
    parts.push(`Failed steps: ${failedSteps.map((s) => `#${s.index} (${s.action})`).join(", ")}`);
    const firstError = failedSteps.find((s) => s.error)?.error;
    if (firstError) {
      parts.push(`Error: ${firstError}`);
    }
  }

  parts.push(`Evidence: ${result.evidenceDir}`);
  return parts.join(" | ");
}

export interface TestRailReportInput {
  resultsSummary: PlansExecutionSummary;
  projectId: string;
  suiteId?: string;
  runName: string;
  runDescription?: string;
  dryRun: boolean;
}

export interface TestRailReportOutput {
  dryRun: boolean;
  runId?: number;
  runUrl?: string;
  runName: string;
  caseIds: number[];
  resultsCount: number;
  results: {
    caseId: number;
    externalId: string;
    status: string;
    statusId: number;
    comment: string;
  }[];
}

export async function reportToTestRail(
  client: TestRailClient,
  input: TestRailReportInput
): Promise<TestRailReportOutput> {
  const { resultsSummary, projectId, suiteId, runName, runDescription, dryRun } = input;

  const testrailResults = resultsSummary.results.filter(
    (r) => r.scenario.source === "testrail" && r.scenario.caseId != null
  );

  const caseIds = testrailResults.map((r) => r.scenario.caseId as number);

  const results: AddResultForCaseInput[] = testrailResults.map((r) => ({
    runId: 0,
    caseId: r.scenario.caseId as number,
    statusId: mapExecutionStatusToTestRail(r.status),
    comment: buildComment(r),
    elapsed: formatDuration(r.durationMs)
  }));

  const resultDetails = testrailResults.map((r) => ({
    caseId: r.scenario.caseId as number,
    externalId: r.scenario.externalId ?? `C${r.scenario.caseId}`,
    status: r.status,
    statusId: mapExecutionStatusToTestRail(r.status),
    comment: buildComment(r)
  }));

  if (dryRun) {
    return {
      dryRun: true,
      runName,
      caseIds,
      resultsCount: results.length,
      results: resultDetails
    };
  }

  const run = await client.addRun({
    projectId,
    suiteId,
    name: runName,
    description: runDescription,
    caseIds
  });

  for (const result of results) {
    result.runId = run.id;
  }

  await client.addResultsForCases(run.id, results);

  return {
    dryRun: false,
    runId: run.id,
    runUrl: run.url,
    runName: run.name,
    caseIds,
    resultsCount: results.length,
    results: resultDetails
  };
}