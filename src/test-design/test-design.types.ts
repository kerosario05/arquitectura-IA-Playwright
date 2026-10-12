/**
 * Test design module: manual test scenarios authored from Jira stories, edited in
 * the panel and published to TestRail (cases) and Jira (one sub-task per story).
 *
 * Deliberately separate from `McpScenario`: these are human-readable cases with a
 * per-step expected result, not automation plans.
 */

export type TestDesignStep = {
  action: string;
  expected: string;
};

/**
 * A value the case needs typed in (user, password, id number, amount, OTP...).
 * Steps reference it as `{{key}}`; the AI declares the field and leaves `value`
 * empty for the user to fill. Sensitive values are never published.
 */
export type TestDesignDataField = {
  key: string;
  label: string;
  description: string;
  value: string;
  sensitive: boolean;
};

export type TestDesignPriority = "low" | "medium" | "high" | "critical";

export type TestDesignScenarioType = "functional" | "negative" | "edge" | "regression" | "other";

export type TestDesignScenario = {
  /** Stable within the draft; generated server-side for AI and manual scenarios alike. */
  id: string;
  title: string;
  preconditions: string;
  steps: TestDesignStep[];
  expectedResult: string;
  /** Inputs the steps reference as {{key}}. */
  data: TestDesignDataField[];
  priority: TestDesignPriority;
  type: TestDesignScenarioType;
  /** The two destinations are chosen independently per scenario. */
  selectedForTestRail: boolean;
  selectedForJira: boolean;
  /** Set once the case exists in TestRail; a republish updates it instead of duplicating. */
  testRailCaseId: number | null;
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
