import fs from "node:fs/promises";
import path from "node:path";
import { loadAutomationIndex } from "../automations/automation-index";
import { normalizeAppProfile } from "../config/env";
import { normalizeAppSlug } from "../automations/app-profile";
import type { PromotedAutomationIndex, PromotedAutomationIndexEntry } from "../types/automation-promotion.types";
import type { RawTestRailCase } from "../types/testrail.types";
import type {
  CaseAutomationListResult,
  CaseAutomationStatus,
  CaseAutomationSummary
} from "../types/case-automation-status.types";

function computeAutomationStatus(
  entry: PromotedAutomationIndexEntry | undefined,
  currentProfile: string
): CaseAutomationStatus {
  if (!entry) {
    return "not_automated";
  }

  const entryProfile = normalizeAppSlug(entry.appSlug ?? entry.appProfile ?? "default");
  if (currentProfile !== "default" && entryProfile !== currentProfile) {
    return "different_profile";
  }

  return entry.status;
}

function mapCaseToSummary(
  testCase: RawTestRailCase,
  automationIndex: Map<number, PromotedAutomationIndexEntry>,
  currentProfile: string
): CaseAutomationSummary {
  const entry = automationIndex.get(testCase.id);
  const status = computeAutomationStatus(entry, currentProfile);

  return {
    caseId: testCase.id,
    externalId: testCase.refs,
    title: testCase.title,
    automationStatus: status,
    automationId: entry?.id,
    specPath: entry?.specPath,
    planPath: entry?.planPath,
    lastUpdated: entry?.updatedAt,
    appProfile: entry ? normalizeAppSlug(entry.appSlug ?? entry.appProfile ?? "default") : undefined,
    currentProfile: currentProfile !== "default" ? currentProfile : undefined
  };
}

async function loadAllAppIndices(): Promise<PromotedAutomationIndexEntry[]> {
  const appsDir = "automations/apps";
  const allEntries: PromotedAutomationIndexEntry[] = [];

  try {
    const appDirs = await fs.readdir(appsDir, { withFileTypes: true });
    for (const dirent of appDirs) {
      if (!dirent.isDirectory()) continue;
      const indexPath = path.join(appsDir, dirent.name, "index.json");
      try {
        const index = await loadAutomationIndex(indexPath);
        allEntries.push(...index.automations);
      } catch {
        // skip apps without index
      }
    }
  } catch {
    // apps dir may not exist yet
  }

  return allEntries;
}

export async function getCaseAutomationStatus(
  cases: RawTestRailCase[],
  indexPath?: string,
  options?: { allApps?: boolean; appSlug?: string; currentProfile?: string }
): Promise<CaseAutomationListResult> {
  const globalIndex = await loadAutomationIndex(indexPath);
  const currentProfile = normalizeAppSlug(options?.currentProfile ?? process.env.APP_PROFILE ?? "default");
  const explicitAppFilter = options?.appSlug ? normalizeAppSlug(options.appSlug) : undefined;

  // Collect entries from global index + per-app indices
  let allEntries = [...globalIndex.automations];
  if (options?.allApps) {
    const appEntries = await loadAllAppIndices();
    // Merge, dedup by id
    const seen = new Set(allEntries.map((e) => e.id));
    for (const entry of appEntries) {
      if (!seen.has(entry.id)) {
        allEntries.push(entry);
        seen.add(entry.id);
      }
    }
  }

  const automationMap = new Map<number, PromotedAutomationIndexEntry>();
  for (const entry of allEntries) {
    const entrySlug = normalizeAppSlug(entry.appSlug ?? entry.appProfile ?? "default");
    if (explicitAppFilter && entrySlug !== explicitAppFilter) {
      continue;
    }
    if (entry.caseId) {
      // Prefer entries matching current profile, or non-different_profile
      const existing = automationMap.get(entry.caseId);
      if (!existing) {
        automationMap.set(entry.caseId, entry);
      } else {
        const existingProfile = normalizeAppSlug(existing.appSlug ?? existing.appProfile ?? "default");
        const entryProfile = normalizeAppSlug(entry.appSlug ?? entry.appProfile ?? "default");
        if (currentProfile !== "default" && currentProfile === entryProfile && existingProfile !== currentProfile) {
          automationMap.set(entry.caseId, entry);
        }
      }
    }
  }

  const summaries = cases.map((testCase) =>
    mapCaseToSummary(testCase, automationMap, currentProfile)
  );

  const automatedCount = summaries.filter(
    (s) => s.automationStatus === "active" || s.automationStatus === "draft"
  ).length;

  return {
    cases: summaries,
    totalCount: summaries.length,
    automatedCount,
    notAutomatedCount: summaries.length - automatedCount,
    fetchedAt: new Date().toISOString()
  };
}
