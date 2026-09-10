export type TestRailCaseId = number;

export type TestRailProject = {
  id: number;
  name: string;
  announcement?: string;
  is_completed: boolean;
  suite_mode: 1 | 2 | 3; // 1=single, 2=single+baselines, 3=multiple suites
  url?: string;
  [key: string]: unknown;
};

export type TestRailSuite = {
  id: number;
  name: string;
  description?: string;
  project_id: number;
  is_master?: boolean;
  is_baseline?: boolean;
  is_completed?: boolean;
  url?: string;
  [key: string]: unknown;
};

export type TestRailSection = {
  id: number;
  name: string;
  parent_id: number | null;
  depth: number;
  display_order: number;
  suite_id: number;
  [key: string]: unknown;
};

export type RawTestRailCase = {
  id: number;
  title: string;
  section_id?: number;
  template_id?: number;
  type_id?: number;
  priority_id?: number;
  refs?: string;
  custom_preconds?: string;
  custom_steps?: string;
  custom_expected?: string;
  custom_steps_separated?: Array<{
    content?: string;
    expected?: string;
    additional_info?: string;
    refs?: string;
  }>;
  [key: string]: unknown;
};

export type TestScenarioStep = {
  index: number;
  action: string;
  expected?: string;
  dataHints: string[];
  inputIntent?: import("./execution-plan.types").InputIntent;
  requirementRefs?: string[];
  polarity?: "positive" | "negative";
  canonicalAssertion?: import("../scenarios/canonical-scenario").CanonicalAssertion;
  conditionalAction?: import("../scenarios/canonical-scenario").CanonicalConditionalAction;
  entityScope?: string;
  rowScope?: number;
  rowRelation?: "next" | "added";
  associatedField?: string;
  selectionField?: string;
  expectedValueKey?: string;
};

export type TestScenario = {
  source: "testrail" | "jira";
  externalId: string;
  caseId: number;
  title: string;
  preconditions?: string;
  references?: string;
  steps: TestScenarioStep[];
  authIntent?: "gate_observation" | "full_authentication";
  raw?: RawTestRailCase;
  sectionId?: number;
  sectionName?: string;
  canonicalScenarioId?: string;
  canonicalRequirements?: import("../scenarios/canonical-scenario").CanonicalRequirement[];
  canonicalInputRequirements?: import("../scenarios/canonical-scenario").CanonicalInputRequirement[];
  expectedResultRequirementRefs?: string[];
  stepRequirementRefs?: Array<{ stepIndex: number; requirementId: string; facet?: string }>;
  stepClaims?: Array<{ stepIndex: number; claimId: string; requirementId?: string; facet?: string; required?: boolean; coverable?: boolean }>;
  /** Contract-derived inputs carried into discovery without materializing values. */
  runtimeInputRequirements?: Array<{
    key: string;
    required?: boolean;
    source?: "contract" | "runtime_inferred";
    provenance?: "contract_declaration" | "placeholder_reference" | "runtime_inference";
    valueRole?: "runtime_input" | "expected_oracle" | "runtime_derived_oracle";
    oracleSource?: string;
    dependsOn?: string[];
  }>;
};

export type TestRailCaseFetchResult = {
  cases: RawTestRailCase[];
  fetchedAt: string;
};

export type TestRailRun = {
  id: number;
  name: string;
  project_id?: number;
  suite_id?: number;
  include_all?: boolean;
  case_ids?: number[];
  url?: string;
  [key: string]: unknown;
};

export type TestRailResultStatus =
  | 'passed'
  | 'blocked'
  | 'untested'
  | 'retest'
  | 'failed'
  | 'skipped'
  | 'custom';

export type TestRailStatusMapping = {
  passed: number;
  failed: number;
  skipped?: number;
  partial?: number;
};

export type AddResultForCaseInput = {
  runId: number;
  caseId: number;
  statusId: number;
  comment?: string;
  elapsed?: string;
  defects?: string;
};

export type CreateRunInput = {
  projectId: string;
  suiteId?: string;
  name: string;
  description?: string;
  caseIds: number[];
  refs?: string;
};

export type AddCaseInput = {
  title: string;
  refs?: string;
  preconditions?: string;
  customExpected?: string;
  customCaseOracle?: string;
  stepsSeparated?: Array<{ content: string; expected?: string }>;
  customFields?: Record<string, unknown>;
};

export type UpdateCaseInput = {
  custom_preconds?: string;
  title?: string;
  refs?: string;
  preconditions?: string;
  customExpected?: string;
  customCaseOracle?: string;
  stepsSeparated?: Array<{ content: string; expected?: string }>;
  customFields?: Record<string, unknown>;
};
