export type ExecutionPlanVersion = "1.0";

export type ExecutionPlanSource = "manual" | "rule_based" | "ai_generated" | "discovery_generated";

export type ExecutionPlanStatus =
  | "draft"
  | "validated"
  | "invalid"
  | "needs_data"
  | "needs_discovery"
  | "unsupported";

export type PlanAction =
  | "navigate"
  | "login"
  | "click"
  | "fill"
  | "select"
  | "check"
  | "uncheck"
  | "press"
  | "waitFor"
  | "assertVisible"
  | "assertText"
  | "assertUrl"
  | "screenshot"
  | "noop";

export type LocatorStrategy =
  | "role"
  | "text"
  | "label"
  | "placeholder"
  | "testId"
  | "css"
  | "xpath"
  | "semantic"
  | "registry";

export type PlanTarget = {
  strategy: LocatorStrategy;
  value?: string;
  hint?: string;
  role?: string;
  name?: string;
  exact?: boolean;
};

export type RequiredDataRef = {
  key: string;
  required: boolean;
  resolved: boolean;
  sensitive?: boolean;
  source?: string;
  reason?: string;
};

export type ExecutionPlanStep = {
  index: number;
  action: PlanAction;
  description?: string;
  target?: PlanTarget | "APP_BASE_URL";
  value?: string;
  valueKey?: string;
  expected?: string;
  timeoutMs?: number;
  optional?: boolean;
  evidence?: boolean;
};

export type ExecutionPlanScenarioRef = {
  source: "testrail" | "manual";
  externalId?: string;
  caseId?: number;
  title: string;
};

export type ExecutionPlan = {
  version: ExecutionPlanVersion;
  source: ExecutionPlanSource;
  status: ExecutionPlanStatus;
  scenario: ExecutionPlanScenarioRef;
  requiredData: RequiredDataRef[];
  steps: ExecutionPlanStep[];
  notes?: string[];
  createdAt: string;
};
