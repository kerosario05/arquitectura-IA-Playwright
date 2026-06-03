export type ScenarioPreviewRequest = {
  projectKey?: string;
  sprintId?: number;
  activeSprint?: boolean;
  status?: string;
  testrailProjectId?: number;
  testrailSuiteId?: number;
  testrailSectionId?: number;
  testrailSectionName?: string;
  appSlug?: string;
  targetAppSlug?: string;
  targetAppName?: string;
  generationMode?: string;
  aiProvider?: string;
  sourceMode?: string;
  maxResults?: number;
  publishToTestRail?: boolean;
  createTestRun?: boolean;
  reportResults?: boolean;
};

export type AppInferenceMeta = {
  appName: string;
  appSlug: string;
  source: "explicit" | "testrail_section" | "testrail_project" | "jira" | "fallback";
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type JiraIssueSource = {
  key: string;
  summary: string;
  description: string;
  acceptanceCriteria: string | null;
  labels: string[];
  components: string[];
  status: string;
  issueType: string;
};

export type McpScenarioStep = string;

export type McpScenario = {
  sourceIssueKey: string;
  title: string;
  steps: McpScenarioStep[];
  preconditions: string[];
  expectedResult: string;
  caseOracle?: string;
  type: string;
  database: string;
  isConverted: number;
  automationType: string;
  setupStrategy: string;
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  routeProfile: string;
  dataRequirements: string;
  nonExecutableCriteria: string;
  mcpExecutable: boolean;
  caseId?: number;
  validation?: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
};

export type McpRouteProfile = {
  name: string;
  entry: Array<{ businessLabel: string; visibleLabel: string }>;
  aliases: Record<string, string | string[]>;
  intermediates: Record<string, string[]>;
  domainTerms: Record<string, string | string[]>;
  visibleControls: string[];
  representativeFixture: Record<string, string>;
  notes: string[];
};

export type McpRejectedScenario = {
  sourceIssueKey: string;
  reason: string;
};

export type McpGenerationResponse = {
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  confidence: string;
  reason: string;
  functionalRoute: string;
  routeProfile: McpRouteProfile;
  scenarios: McpScenario[];
  warnings: string[];
  rejected: McpRejectedScenario[];
};

export type ScenarioValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type ValidatedScenario = McpScenario & {
  validation: ScenarioValidationResult;
};

export type ScenarioPreviewResponse = {
  ok: boolean;
  source: {
    mode: string;
    projectKey: string;
    sprintId: number | null;
    status: string | null;
    issuesFound: number;
  };
  testrail: {
    projectId: number | null;
    suiteId: number | null;
    sectionId: number | null;
    sectionName: string | null;
  };
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  appInference?: AppInferenceMeta;
  appProfilePath?: string;
  summary: {
    generated: number;
    valid: number;
    invalid: number;
    rejected: number;
  };
  routeProfile: McpRouteProfile | null;
  scenarios: ValidatedScenario[];
  rejected: McpRejectedScenario[];
  warnings: string[];
};

export type ScenarioPreviewError = {
  ok: false;
  error: string;
  message: string;
};
