import type { McpScenario, McpRouteProfile } from "../scenarios/scenario-types";

export type VirtualCaseSource = "scenario_preview";

export type VirtualCase = {
  id: string;
  displayId: string;
  title: string;
  sourceIssueKey: string;
  steps: string[];
  expectedResult: string;
  caseOracle?: string;
  preconditions: string[];
  appSlug: string;
  routeProfile: string;
  dataRequirements: string;
  mcpExecutable: boolean;
  source: VirtualCaseSource;
  targetAppSlug?: string;
  targetAppName?: string;
  type: string;
  automationType: string;
  setupStrategy: string;
  sectionSlug?: string;
  sectionName?: string;
  sectionId?: string | number;
};

export type ScenarioPreviewRequest = {
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  sectionName?: string;
  sectionSlug?: string;
  sectionId?: string | number;
  testrailProjectId?: number;
  testrailSuiteId?: number;
  testrailSectionId?: number;
  publishToTestRail?: boolean;
  createTestRun?: boolean;
  reportResults?: boolean;
  source?: {
    projectKey: string;
    sprintId?: number;
    status?: string;
  };
  routeProfile?: McpRouteProfile;
  scenarios: McpScenario[];
  options?: {
    overwrite?: boolean;
    autoPromote?: boolean;
    autoPom?: boolean;
    rerunActive?: boolean;
    headed?: boolean;
  };
};

export type ScenarioPreviewResponse = {
  ok: true;
  jobId: string;
  status: string;
  mode: "scenario-preview";
  scenarioCount: number;
};

export type ScenarioPreviewError = {
  ok: false;
  error: string;
  message: string;
};

export function normalizeStep(step: string): string {
  return step.replace(/^\d+[\.)]\s*/, "").trim();
}

export function toVirtualCase(scenario: McpScenario, index: number, sectionSlug?: string, sectionName?: string, sectionId?: string | number): VirtualCase {
  const displayId = `PREVIEW-${String(index + 1).padStart(3, "0")}`;
  return {
    id: `preview-${String(index + 1).padStart(3, "0")}`,
    displayId,
    title: scenario.title,
    sourceIssueKey: scenario.sourceIssueKey,
    steps: scenario.steps.map(normalizeStep),
    expectedResult: scenario.expectedResult,
    preconditions: scenario.preconditions,
    appSlug: scenario.targetAppSlug ?? scenario.appSlug,
    routeProfile: scenario.routeProfile,
    dataRequirements: scenario.dataRequirements,
    mcpExecutable: scenario.mcpExecutable,
    source: "scenario_preview",
    targetAppSlug: scenario.targetAppSlug,
    targetAppName: scenario.targetAppName,
    type: scenario.type,
    automationType: scenario.automationType,
    setupStrategy: scenario.setupStrategy,
    sectionSlug,
    sectionName,
    sectionId,
  };
}
