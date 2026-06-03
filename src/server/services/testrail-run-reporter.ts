import fs from "node:fs";
import path from "node:path";
import { TestRailClient } from "../../clients/testrail.client";
import type { ScenarioPreviewCaseMapping, ScenarioPreviewTestRailResult } from "./testrail-sync-types";

export type TestRailRunReporterInput = {
  runId: number;
  projectId: number;
  suiteId?: number;
  sectionId: number;
  runName: string;
  artifactDir: string;
  results: ScenarioPreviewTestRailResult[];
  mappings: ScenarioPreviewCaseMapping[];
};

function mapScenarioStatusToTestRailStatusId(status: ScenarioPreviewTestRailResult["status"]): number {
  if (status === "passed") return 1;
  if (status === "skipped") return 2;
  return 5;
}

function buildComment(result: ScenarioPreviewTestRailResult, artifactDir: string): string {
  const parts = [
    `scenarioId=${result.scenarioId}`,
    `status=${result.status}`,
  ];
  if (result.title) parts.push(`title=${result.title}`);
  if (result.failureReason) parts.push(`failureReason=${result.failureReason}`);
  parts.push(`artifactDir=${artifactDir}`);
  if (result.artifactPath) parts.push(`artifactPath=${result.artifactPath}`);
  if (result.screenshotPath) parts.push(`screenshotPath=${result.screenshotPath}`);
  if (result.videoPath) parts.push(`videoPath=${result.videoPath}`);
  if (result.logs && result.logs.length > 0) {
    parts.push(`logs=${result.logs.slice(-5).join(" | ")}`);
  }
  return parts.join(" | ");
}

function persistPendingReport(artifactDir: string, payload: unknown): string {
  const filePath = path.join(artifactDir, "pending-testrail-report.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
  return filePath;
}

export async function reportScenarioPreviewResultsToTestRail(
  client: TestRailClient,
  input: TestRailRunReporterInput,
): Promise<{ added: number; pendingReportPath?: string }> {
  const results = input.results
    .map((result) => {
      const mapping = input.mappings.find((m) => m.scenarioId === result.scenarioId);
      if (!mapping) return null;
      return {
        runId: input.runId,
        caseId: mapping.testRailCaseId,
        statusId: mapScenarioStatusToTestRailStatusId(result.status),
        comment: buildComment(result, input.artifactDir),
        elapsed: undefined,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  try {
    const response = await client.addResultsForCases(input.runId, results);
    return { added: response.added };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const pendingReportPath = persistPendingReport(input.artifactDir, {
      runId: input.runId,
      projectId: input.projectId,
      suiteId: input.suiteId ?? null,
      sectionId: input.sectionId,
      runName: input.runName,
      error: message,
      results: results.map((r) => ({
        caseId: r.caseId,
        statusId: r.statusId,
        comment: r.comment,
      })),
    });
    return { added: 0, pendingReportPath };
  }
}

export function buildTestRailRunName(appSlug: string, sectionId: number, scenarioCount: number): string {
  return `[QA Lab] ${appSlug} section ${sectionId} - ${scenarioCount} scenarios`;
}
