import type { McpScenario } from "../../scenarios/scenario-types";

export type ScenarioPreviewCaseMapping = {
  scenarioId: string;
  scenarioTitle: string;
  cacheKey: string;
  testRailRef?: string;
  testRailCaseId: number;
  sectionId: number;
  projectId: number;
  suiteId?: number;
  updatedAt: string;
  source: "created" | "updated" | "reused" | "recovered" | "recovered_after_add_case_500" | "reused_from_same_launch_after_previous_500" | "skipped_already_published" | "created_with_unique_title" | "recovered_after_unique_title_500";
};

export type ScenarioPreviewTestRailResult = {
  scenarioId: string;
  testRailCaseId?: number;
  status: "passed" | "failed" | "skipped" | "review_needed";
  failureReason?: string;
  artifactPath?: string;
  screenshotPath?: string;
  videoPath?: string;
  logs?: string[];
  title?: string;
};

export type ScenarioPreviewPublishContext = {
  projectId: number;
  suiteId?: number;
  sectionId: number;
  appSlug: string;
  sprintId?: number;
  storyKey?: string;
  scenarios: McpScenario[];
  cacheKey: string;
  publishStrategy?: "always_create" | "use_existing";
  launchId?: string;
  /** Recording keeps batch/reconciliation semantics without changing the shared case payload. */
  recordingBatch?: boolean;
  /** Traceability stays server-side; it is never appended to human preconditions. */
  suppressAutomationMarker?: boolean;
};

export function buildScenarioPreviewScenarioId(
  scenario: McpScenario,
  index: number,
  context?: { launchId?: string; cacheKey?: string; sourceScenarioId?: string }
): string {
  void scenario;

  // Priority 1: For launch execution, generate a stable unique mapping identity from launchId + index.
  // A TestRail custom field is optional; the server-side mapping is authoritative.
  if (context?.launchId) {
    const shortLaunchId = context.launchId.slice(0, 8); // First 8 chars of UUID
    return `L-${shortLaunchId}-${String(index + 1).padStart(3, "0")}`;
  }

  // Priority 2: For preview runs with launch- cacheKey, use cacheKey + index to avoid collisions
  if (context?.cacheKey && context.cacheKey.startsWith("launch-")) {
    const shortCache = context.cacheKey.replace("launch-", "").slice(0, 8);
    return `L-${shortCache}-${String(index + 1).padStart(3, "0")}`;
  }

  // Fallback: Legacy PREVIEW-xxx format (only for standalone discovery:preview without launch context)
  return `PREVIEW-${String(index + 1).padStart(3, "0")}`;
}

export function normalizeScenarioPreviewScenarioKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
