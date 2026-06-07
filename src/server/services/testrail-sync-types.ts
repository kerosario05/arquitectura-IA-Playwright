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

export function buildScenarioPreviewScenarioId(scenario: McpScenario, index: number): string {
  void scenario;
  return `PREVIEW-${String(index + 1).padStart(3, "0")}`;
}

export function normalizeScenarioPreviewScenarioKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
