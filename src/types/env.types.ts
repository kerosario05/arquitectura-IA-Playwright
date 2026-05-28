export type BrowserName = "chromium" | "firefox" | "webkit";

export type LoginMode = "password" | "no_login" | "manual";

export type MissingInputBehavior = "fail" | "prompt" | "skip" | "auto_generate";

export type TestDataValue = string | number | boolean;

export type TestDataMap = Record<string, TestDataValue>;

export type TestDataAliasesMap = Record<string, string[]>;

export type TestDataProfile = "demo" | "qa" | "staging" | "production_like";

export type AppConfig = {
  name?: string;
  baseUrl: string;
  loginMode: LoginMode;
  username?: string;
  password?: string;
  extraLoginFields?: Record<string, string>;
  testData: TestDataMap;
  rawTestData?: Record<string, unknown>;
  testDataAliases: TestDataAliasesMap;
  missingInputBehavior: MissingInputBehavior;
  appProfile?: string;
  autoGenerateTestData?: boolean;
  autoGenerateSensitiveData?: boolean;
  testDataProfile?: TestDataProfile;
  autoSelectSafeDefaults?: boolean;
  autoAcceptSafeCheckboxes?: boolean;
};

export type BrowserExecutionConfig = {
  browser: BrowserName;
  headless: boolean;
  evidenceDir: string;
  defaultTimeoutMs: number;
};

export type TestRailConfig = {
  url?: string;
  email?: string;
  apiKey?: string;
  projectId?: string;
  suiteId?: string;
  sectionId?: string;
  sessionId?: string;
};

export type RequiredTestRailRuntimeConfig = {
  url: string;
  email: string;
  apiKey: string;
};

export type FutureIntegrationsConfig = {
  testRail?: TestRailConfig;
  jira?: {
    baseUrl?: string;
    email?: string;
    apiToken?: string;
    projectKey?: string;
    acceptanceCriteriaField?: string;
    defaultJql?: string;
    dryRun?: boolean;
  };
  ai?: {
    provider?: string;
    agentProvider?: "codex" | "copilot" | "custom" | "none";
    model?: string;
    discoveryMode?: boolean;
    autoApproveDiscoveredObjects?: boolean;
    discoveryEnabled?: boolean;
    discoveryConfidenceThreshold?: number;
    discoveryRequireApprovalThreshold?: number;
    discoveryMaxAttempts?: number;
  };
  agent?: {
    provider?: "codex" | "copilot" | "custom" | "none";
    command?: string;
    extraArgs?: string;
    autoRepairTimeoutMs?: number;
    autoRepairEnabled?: boolean;
    autoRepairPromptMode?: "compact" | "verbose" | "compact-route-recovery";
    compactPrompt?: boolean;
    promptBudgetSeconds?: number;
    maxCandidates?: number;
    maxProposedActions?: number;
  };
  codex?: {
    command?: string;
    extraArgs?: string;
    autoRepairTimeoutMs?: number;
    autoRepairEnabled?: boolean;
    autoRepairPromptMode?: "compact" | "verbose" | "compact-route-recovery";
  };
};

export type FullConfig = {
  app: AppConfig;
  execution: BrowserExecutionConfig;
  integrations: FutureIntegrationsConfig;
};
