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
  source: "created" | "updated" | "reused" | "recovered" | "recovered_after_add_case_500" | "reused_from_same_launch_after_previous_500";
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
};

export function buildScenarioPreviewScenarioId(
  scenario: McpScenario,
  index: number,
  context?: { launchId?: string; cacheKey?: string; sourceScenarioId?: string }
): string {
  void scenario;

  // Priority 1: For launch execution, generate stable unique ID from launchId + index
  // This ID is used as custom_scenario_id in TestRail and must be globally unique
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
