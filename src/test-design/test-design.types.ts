/**
 * Test design module: manual test scenarios authored from Jira stories, edited in
 * the panel and published to TestRail (cases) and Jira (one sub-task per story).
 *
 * Deliberately separate from `McpScenario`: these are human-readable cases with a
 * per-step expected result, not automation plans.
 */

/**
 * Test datum a case needs. Texts reference it as {{key}}; the panel shows a field per datum
 * and the publisher preserves those markers. Values stay in QA Lab, scoped by project/case.
 */
export type TestDesignDatum = {
  key: string;
  label?: string;
  value: string;
  sensitive: boolean;
  /** Short hint shown under the field, e.g. what kind of value is expected. */
  description: string;
  condition?: "valid" | "invalid" | "expired";
  /** User-selected project catalog binding; optional for legacy drafts. */
  catalogBinding?: { catalogId: string; optionId?: string; revision: number; mode: "manual" | "automatic" };
};

export type TestDesignStep = {
  action: string;
  expected: string;
};

export type TestDesignPriority = "low" | "medium" | "high" | "critical";

export type TestDesignScenarioType = "functional" | "negative" | "edge" | "regression" | "other";

export type TestDesignScenario = {
  /** Stable within the draft; generated server-side for AI and manual scenarios alike. */
  id: string;
  title: string;
  preconditions: string;
  steps: TestDesignStep[];
  /** Data fields referenced as {{key}} in preconditions, steps and expected results. */
  data: TestDesignDatum[];
  /** Shared Jira contract; presentation must not replace its runtime keys with labels. */
  inputRequirements?: import("../jira/jira-input-requirements").JiraInputRequirement[];
  acceptanceCriteriaRefs?: string[];
  /** Jira validation gaps retained for human review; these cases are not certified complete. */
  generationWarnings?: string[];
  expectedResult: string;
  priority: TestDesignPriority;
  type: TestDesignScenarioType;
  /** The two destinations are chosen independently per scenario. */
  selectedForTestRail: boolean;
  selectedForJira: boolean;
  /** Set once the case exists in TestRail; a republish updates it instead of duplicating. */
  testRailCaseId: number | null;
  /** True when the saved TestRail case content changed and needs an in-place update. */
  testRailDirty?: boolean;
  origin: "ai" | "manual";
  /** True once a person changed it: regeneration keeps edited scenarios. */
  edited: boolean;
};

export type TestDesignGenerationStatus = "pending" | "generating" | "ready" | "failed";

export type TestDesignDraftStatus = "draft" | "partially_published" | "published" | "archived";

export type TestDesignTestRailTarget = {
  projectId: number | null;
  suiteId: number | null;
  sectionId: number | null;
};

export type TestDesignDraftStory = {
  id: string;
  draftId: string;
  issueKey: string;
  issueSummary: string;
  position: number;
  generationStatus: TestDesignGenerationStatus;
  generationError: string | null;
  scenarios: TestDesignScenario[];
  jiraSubtaskKey: string | null;
  jiraPublishedAt: string | null;
  testRailPublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Jira story material used by Test Design, kept independent of automation scenarios. */
export type TestDesignJiraIssue = {
  key: string;
  summary: string;
  description: string;
  acceptanceCriteria: string | null;
  labels: string[];
  components: string[];
  status: string;
  issueType: string;
};

export type TestDesignDraft = {
  id: string;
  title: string | null;
  /** Automation project (Projects.slug), optional: a draft can target any Jira project. */
  projectSlug: string | null;
  jiraProjectKey: string;
  testRail: TestDesignTestRailTarget;
  instructions: string | null;
  status: TestDesignDraftStatus;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TestDesignDraftWithStories = TestDesignDraft & {
  stories: TestDesignDraftStory[];
};

export type TestDesignDraftSummary = TestDesignDraft & {
  storyCount: number;
  scenarioCount: number;
  issueKeys: string[];
};
