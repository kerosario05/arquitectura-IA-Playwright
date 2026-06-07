import fs from "fs";
import path from "path";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import type { AddResultForCaseInput } from "../../types/testrail.types";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const LAUNCH_ARTIFACTS_DIR = path.join(ROOT, ".artifacts", "scenario-launch-runs");

export type ResultSyncInput = {
  runId: number;
  caseId: number;
  scenarioId: string;
  discoveryStatus: "passed" | "failed" | "skipped" | "review_needed";
  title?: string;
  artifactsDir?: string;
  errorMessage?: string;
  durationMs?: number;
  launchId?: string;
  appSlug?: string;
  sectionSlug?: string;
};

export type ResultSyncOutput = {
  statusId: number;
  syncStatus: "synced" | "skipped_no_case_id" | "failed";
  syncedAt?: string;
  error?: string;
};

export type SyncResultEntry = {
  scenarioId: string;
  caseId: number;
  discoveryStatus: string;
  testRailStatusId: number;
  syncStatus: string;
  syncedAt?: string;
  error?: string;
};

const DEFAULT_STATUS_IDS = {
  passed: Number(process.env.TESTRAIL_STATUS_PASSED_ID) || 1,
  blocked: Number(process.env.TESTRAIL_STATUS_BLOCKED_ID) || 2,
  untested: Number(process.env.TESTRAIL_STATUS_UNTESTED_ID) || 3,
  retest: Number(process.env.TESTRAIL_STATUS_RETEST_ID) || 4,
  failed: Number(process.env.TESTRAIL_STATUS_FAILED_ID) || 5,
  skipped: Number(process.env.TESTRAIL_STATUS_SKIPPED_ID) || undefined,
};

function mapDiscoveryStatusToTestRail(discoveryStatus: string): number {
  switch (discoveryStatus) {
    case "passed":
      return DEFAULT_STATUS_IDS.passed;
    case "failed":
    case "exploration_failed":
    case "error":
      return DEFAULT_STATUS_IDS.failed;
    case "skipped":
      return DEFAULT_STATUS_IDS.skipped ?? DEFAULT_STATUS_IDS.blocked;
    case "review_needed":
    case "needs_agent":
      return DEFAULT_STATUS_IDS.blocked;
    default:
      return DEFAULT_STATUS_IDS.untested;
  }
}

export async function syncDiscoveryResultToTestRail(
  input: ResultSyncInput,
): Promise<ResultSyncOutput> {
  if (!input.caseId) {
    return { statusId: 0, syncStatus: "skipped_no_case_id" };
  }

  const statusId = mapDiscoveryStatusToTestRail(input.discoveryStatus);

  try {
    const trConfig = requireTestRailConfig(config);
    const trClient = new TestRailClient(trConfig);

    const commentParts: string[] = [
      `QA Lab discovery result: ${input.discoveryStatus}`,
      `scenarioId=${input.scenarioId}`,
    ];
    if (input.launchId) commentParts.push(`launchId=${input.launchId}`);
    if (input.title) commentParts.push(`title="${input.title.slice(0, 100)}"`);
    if (input.artifactsDir) commentParts.push(`artifacts=${input.artifactsDir}`);
    if (input.errorMessage) commentParts.push(`error="${input.errorMessage.slice(0, 200)}"`);
    if (input.appSlug) commentParts.push(`appSlug=${input.appSlug}`);
    if (input.sectionSlug) commentParts.push(`sectionSlug=${input.sectionSlug}`);

    const result: AddResultForCaseInput = {
      runId: input.runId,
      caseId: input.caseId,
      statusId,
      comment: commentParts.join(" | "),
    };

    if (input.durationMs) {
      const seconds = Math.round(input.durationMs / 1000);
      result.elapsed = `${seconds}s`;
    }

    await trClient.addResultsForCases(input.runId, [result]);

    return {
      statusId,
      syncStatus: "synced",
      syncedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    const errorMsg = err.message ?? String(err);
    console.error(`[testrail-sync] failed to sync caseId=${input.caseId} scenarioId=${input.scenarioId}: ${errorMsg}`);
    return {
      statusId,
      syncStatus: "failed",
      error: errorMsg,
    };
  }
}

export function updateLaunchManifestJiraLink(
  launchId: string,
  jiraResult: { jiraKey: string; linkStatus: string; linkedAt?: string; errorCode?: string; errorMessage?: string },
): void {
  const manifestPath = path.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json");
  if (!fs.existsSync(manifestPath)) return;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest.jira = {
      key: jiraResult.jiraKey || null,
      linkStatus: jiraResult.linkStatus,
      linkedAt: jiraResult.linkedAt || null,
      ...(jiraResult.errorCode ? { errorCode: jiraResult.errorCode } : {}),
      ...(jiraResult.errorMessage ? { errorMessage: jiraResult.errorMessage } : {}),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(`[launch-manifest] jira link updated status=${jiraResult.linkStatus} jiraKey=${jiraResult.jiraKey}`);
  } catch (err) {
    console.error(`[launch-manifest] failed to update jira link for launchId=${launchId}: ${err}`);
  }
}

export function finalizeLaunchManifest(
  launchId: string,
  finalStatus: string,
  syncFailedCount: number,
  scenarioCount: number,
): void {
  const manifestPath = path.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.log(`[launch-manifest] finalize skipped reason="missing_launch_id"`);
    return;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const results = manifest.results ?? [];
    const synced = results.filter((r: any) => r.syncStatus === "synced").length;
    const syncFailed = results.filter((r: any) => r.syncStatus === "failed").length;

    manifest.status = finalStatus;
    manifest.completedAt = new Date().toISOString();
    manifest.summary = {
      total: scenarioCount,
      passed: results.filter((r: any) => r.discoveryStatus === "passed").length,
      failed: results.filter((r: any) => r.discoveryStatus !== "passed").length,
      synced,
      syncFailed,
      syncSkipped: results.filter((r: any) => r.syncStatus === "skipped_no_case_id").length,
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(`[launch-manifest] finalized launchId=${launchId} status=${finalStatus} synced=${synced} syncFailed=${syncFailed}`);
  } catch (err) {
    console.error(`[launch-manifest] failed to finalize for launchId=${launchId}: ${err}`);
  }
}

export function updateLaunchManifestWithResult(
  launchId: string,
  entry: SyncResultEntry,
  scenarioCount: number,
): void {
  const manifestPath = path.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json");
  if (!fs.existsSync(manifestPath)) return;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    if (!manifest.results) manifest.results = [];
    const existingIdx = manifest.results.findIndex((r: any) => r.scenarioId === entry.scenarioId);
    if (existingIdx >= 0) {
      manifest.results[existingIdx] = entry;
    } else {
      manifest.results.push(entry);
    }

    const passed = manifest.results.filter((r: any) => r.discoveryStatus === "passed").length;
    const failed = manifest.results.filter((r: any) => r.discoveryStatus !== "passed").length;
    const synced = manifest.results.filter((r: any) => r.syncStatus === "synced").length;
    const syncFailed = manifest.results.filter((r: any) => r.syncStatus === "failed").length;

    manifest.status = failed > 0 ? "completed_with_failures" : "completed";
    manifest.summary = {
      total: scenarioCount,
      passed,
      failed,
      synced,
      syncFailed,
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  } catch (err) {
    console.error(`[testrail-sync] failed to update manifest for launchId=${launchId}: ${err}`);
  }
}
