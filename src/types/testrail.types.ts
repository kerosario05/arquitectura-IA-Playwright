export type TestRailCaseId = number;

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
};

export type TestScenario = {
  source: "testrail";
  externalId: string;
  caseId: number;
  title: string;
  preconditions?: string;
  references?: string;
  steps: TestScenarioStep[];
  raw?: RawTestRailCase;
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
};
