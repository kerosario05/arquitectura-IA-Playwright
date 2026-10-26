import type { JiraIssueTypeRef } from "../clients/jira.client";
import type { TestRailPriority } from "../clients/testrail.client";
import type { AddCaseInput, RawTestRailCase, UpdateCaseInput } from "../types/testrail.types";
import * as repo from "../db/test-design-repository";
import { deriveJiraInputRequirements } from "../jira/jira-input-requirements";
import { persistJiraCaseInputs } from "../jira/jira-case-input-persistence";
import { scenarioCaseSteps } from "../scenarios/scenario-case-transport";
import { buildSubtaskDescription, buildSubtaskSummary, testRailCaseUrl } from "./jira-subtask-formatter";
import { resolveSubtaskType } from "./jira-subtask-type";
import { testRailContentSignature } from "./test-design.validation";
import { sanitizeTestDesignLineageScenario, testRailPayloadContentVersion } from "./test-design-lineage";
import type {
  TestDesignDraftStatus,
  TestDesignDraftStory,
  TestDesignDraftWithStories,
  TestDesignPriority,
  TestDesignScenario,
} from "./test-design.types";

/**
 * Publishes a draft's selected scenarios.
 *
 * TestRail: one case per scenario selected for it. The case id is stored on the
 * scenario, so publishing again updates that case instead of creating another; a
 * case deleted in TestRail is recreated. Jira: one sub-task per story holding all
 * of its scenarios selected for Jira, created under the story the first time and
 * updated afterwards (recreated if someone deleted it).
 *
 * Each story and scenario reports its own outcome: one failure never hides the
 * results of the others, and whatever succeeded is saved immediately.
 */

// ---------------------------------------------------------------------------
// TestRail
// ---------------------------------------------------------------------------

export type TestRailPublishClient = {
  addCase(sectionId: string, input: AddCaseInput): Promise<RawTestRailCase>;
  updateCase(caseId: number, input: UpdateCaseInput): Promise<RawTestRailCase>;
  getCases(projectId: string, suiteId?: string, sectionId?: string): Promise<RawTestRailCase[]>;
  getPriorities(): Promise<TestRailPriority[]>;
};

export type TestRailPublishDeps = {
  client: TestRailPublishClient;
  requiredCustomFields: Record<string, unknown>;
  caseOracle: string;
  /** When set, each outcome links to its case. */
  testRailBaseUrl?: string | null;
};

async function savePublishedLineage(
  draft: TestDesignDraftWithStories,
  story: TestDesignDraftStory,
  scenario: TestDesignScenario,
  caseId: number,
  deps: TestRailPublishDeps,
): Promise<void> {
  const payload = toCaseInput(scenario, story.issueKey, deps);
  await repo.savePublishedCaseLink({
    testRailCaseId: caseId,
    testRailProjectId: draft.testRail.projectId!,
    testRailSuiteId: draft.testRail.suiteId,
    testRailSectionId: draft.testRail.sectionId!,
    projectSlug: scenario.knowledgeProfileSlug ?? draft.projectSlug ?? "",
    jiraProjectKey: draft.jiraProjectKey,
    issueKey: story.issueKey,
    draftId: draft.id,
    storyId: story.id,
    designScenarioId: scenario.id,
    jiraScenarioId: scenario.jiraSourceScenarioId ?? null,
    contentVersion: testRailPayloadContentVersion(payload),
    scenario: sanitizeTestDesignLineageScenario(scenario),
    publishedAt: new Date().toISOString(),
  });
}

export type ScenarioPublishOutcome = {
  scenarioId: string;
  title: string;
  status: "created" | "updated" | "recreated" | "failed";
  caseId?: number;
  caseUrl?: string;
  message?: string;
};

export type StoryTestRailResult = {
  storyId: string;
  issueKey: string;
  status: "published" | "partial" | "failed" | "skipped";
  scenarios: ScenarioPublishOutcome[];
  message?: string;
};

const DEFAULT_TEST_DESIGN_PRECONDITION = "La aplicación configurada del proyecto está disponible y los datos de prueba requeridos están preparados.";

/**
 * Maps low/medium/high/critical onto the instance's own priorities, ordered by
 * their `priority` weight. Instances with fewer than four levels share the top one.
 */
export function mapPriorities(priorities: TestRailPriority[]): Partial<Record<TestDesignPriority, number>> {
  const ordered = [...priorities].sort((a, b) => a.priority - b.priority);
  if (ordered.length === 0) return {};
  const pick = (index: number) => ordered[Math.min(index, ordered.length - 1)].id;
  return { low: pick(0), medium: pick(1), high: pick(2), critical: pick(3) };
}

/** {{key}} -> its value. Sensitive or empty data stay as placeholders, so secrets never leave the draft. */
export function fillPlaceholders(text: string, data: TestDesignScenario["data"]): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, key: string) => {
    const datum = data.find((d) => d.key.toLowerCase() === key.toLowerCase());
    return datum && !datum.sensitive && datum.value ? datum.value : whole;
  });
}

export function toCaseInput(
  scenario: TestDesignScenario,
  issueKey: string,
  deps: Pick<TestRailPublishDeps, "requiredCustomFields" | "caseOracle">,
  priorityId?: number,
): AddCaseInput {
  return {
    title: scenario.title,
    refs: issueKey,
    priorityId,
    preconditions: scenario.preconditions || (scenario.jiraSourceScenarioId || scenario.jiraSourceScenario
      ? undefined
      : DEFAULT_TEST_DESIGN_PRECONDITION),
    stepsSeparated: scenarioCaseSteps(scenario.steps),
    customExpected: scenario.expectedResult || undefined,
    customCaseOracle: deps.caseOracle,
    customFields: deps.requiredCustomFields,
  };
}

/** Natural Jira steps and authored placeholders use the same runtime field contract. */
export function designCaseInputRequirements(scenario: TestDesignScenario) {
  return deriveJiraInputRequirements(scenario.steps.map(step => step.action), scenario.inputRequirements)
    .map(requirement => ({ ...requirement, sensitive: requirement.sensitive || scenario.data.some(datum => datum.key === requirement.key && datum.sensitive) }));
}

/** Same project/case stores consumed by Jira/TestRail rerun input hydration. */
export async function persistDesignCaseInputs(projectSlug: string | null, caseId: number, scenario: TestDesignScenario,
  dependencies: Parameters<typeof persistJiraCaseInputs>[1] = {}): Promise<void> {
  const requirements = designCaseInputRequirements(scenario);
  if (!requirements.length) return;
  if (!projectSlug) throw new Error("Selecciona el proyecto de automatización para conservar los datos en QA Lab");
  await persistJiraCaseInputs({ projectSlug, scenarioId: scenario.id,
    publishedCases: [{ scenarioId: scenario.id, caseId }],
    requirements, values: designCaseRuntimeValues(scenario) }, dependencies);
}

/** Canonical keys win; legacy drafts may bind a unique display label without changing saved source data. */
export function designCaseRuntimeValues(scenario: TestDesignScenario): Record<string, string> {
  const requirements = designCaseInputRequirements(scenario);
  return Object.fromEntries(requirements.flatMap(requirement => {
    const exact = scenario.data.find(datum => datum.key === requirement.key);
    const legacy = scenario.data.filter(datum => datum.key.toLocaleLowerCase() === requirement.label.toLocaleLowerCase());
    const uniqueLabel = requirements.filter(other => other.label === requirement.label).length === 1;
    const datum = exact ?? (uniqueLabel && legacy.length === 1 ? legacy[0] : undefined);
    return datum?.value.trim() ? [[requirement.key, datum.value]] : [];
  }));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function httpStatus(err: unknown): number | undefined {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return status;
  const match = /HTTP (\d{3})/.exec(errorMessage(err));
  return match ? Number(match[1]) : undefined;
}

/** TestRail answers 400 "Field :case_id is not a valid test case" when the case was deleted. */
function isMissingCase(err: unknown): boolean {
  return httpStatus(err) === 400 && /case_id|not a valid test case/i.test(errorMessage(err));
}

/**
 * TestRail sometimes commits a case and still answers 5xx from a post-processing
 * hook. Before reporting a failure, look for exactly one case with this title in
 * the section that did not exist before the attempt.
 */
async function recoverAfterServerError(
  client: TestRailPublishClient,
  target: { projectId: number; suiteId: number | null; sectionId: number },
  title: string,
  knownIds: Set<number>,
): Promise<number | null> {
  try {
    const cases = await client.getCases(
      String(target.projectId),
      target.suiteId ? String(target.suiteId) : undefined,
      String(target.sectionId),
    );
    const fresh = cases.filter((c) => c.title === title && !knownIds.has(c.id));
    return fresh.length === 1 ? fresh[0].id : null;
  } catch {
    return null;
  }
}

async function publishStoryToTestRail(
  draft: TestDesignDraftWithStories,
  story: TestDesignDraftStory,
  deps: TestRailPublishDeps,
  priorityIds: Partial<Record<TestDesignPriority, number>>,
): Promise<StoryTestRailResult> {
  const target = {
    projectId: draft.testRail.projectId!,
    suiteId: draft.testRail.suiteId,
    sectionId: draft.testRail.sectionId!,
  };
  const selected = story.scenarios.filter((s) => s.selectedForTestRail);
  if (selected.length === 0) {
    return { storyId: story.id, issueKey: story.issueKey, status: "skipped", scenarios: [], message: "Ningún escenario seleccionado para TestRail" };
  }

  // Ids that already exist in the section: a 5xx recovery must only accept a new one.
  let knownIds = new Set<number>();
  try {
    const existing = await deps.client.getCases(
      String(target.projectId),
      target.suiteId ? String(target.suiteId) : undefined,
      String(target.sectionId),
    );
    knownIds = new Set(existing.map((c) => c.id));
  } catch {
    // Without the baseline, recovery is skipped (knownIds stays empty only for the check below).
  }

  const outcomes: ScenarioPublishOutcome[] = [];
  const caseIds = new Map<string, number>();

  for (const scenario of selected) {
    const input = toCaseInput(scenario, story.issueKey, deps, priorityIds[scenario.priority]);
    try {
      if (scenario.testRailCaseId !== null) {
        try {
          await deps.client.updateCase(scenario.testRailCaseId, input);
          // Retain the remote case ID even if a local persistence step fails so a retry updates it.
          caseIds.set(scenario.id, scenario.testRailCaseId);
          await persistDesignCaseInputs(scenario.knowledgeProfileSlug ?? draft.projectSlug, scenario.testRailCaseId, scenario);
          await savePublishedLineage(draft, story, scenario, scenario.testRailCaseId, deps);
          outcomes.push({ scenarioId: scenario.id, title: scenario.title, status: "updated", caseId: scenario.testRailCaseId });
          continue;
        } catch (err) {
          if (!isMissingCase(err)) throw err;
          // Deleted in TestRail: fall through and create it again.
        }
      }
      let caseId: number;
      try {
        caseId = (await deps.client.addCase(String(target.sectionId), input)).id;
      } catch (err) {
        const status = httpStatus(err);
        const recovered =
          status !== undefined && status >= 500 && knownIds.size > 0
            ? await recoverAfterServerError(deps.client, target, scenario.title, knownIds)
            : null;
        if (recovered === null) throw err;
        caseId = recovered;
      }
      knownIds.add(caseId);
      // Record the successful TestRail write before dependent local persistence.
      caseIds.set(scenario.id, caseId);
      await persistDesignCaseInputs(scenario.knowledgeProfileSlug ?? draft.projectSlug, caseId, scenario);
      await savePublishedLineage(draft, story, scenario, caseId, deps);
      outcomes.push({
        scenarioId: scenario.id,
        title: scenario.title,
        status: scenario.testRailCaseId !== null ? "recreated" : "created",
        caseId,
      });
    } catch (err) {
      outcomes.push({ scenarioId: scenario.id, title: scenario.title, status: "failed", message: errorMessage(err) });
    }
  }

  if (deps.testRailBaseUrl) {
    for (const outcome of outcomes) {
      if (outcome.caseId) outcome.caseUrl = testRailCaseUrl(deps.testRailBaseUrl, outcome.caseId);
    }
  }

  if (caseIds.size > 0) {
    // Re-read: the panel may have saved edits while cases were being created.
    const current = (await repo.getStory(draft.id, story.id))?.scenarios ?? story.scenarios;
    const publishedScenarios = new Map(selected.map(s => [s.id, s]));
    const successfulScenarioIds = new Set(outcomes.filter(outcome => outcome.status !== "failed").map(outcome => outcome.scenarioId));
    const merged = current.map((s) => {
      const published = publishedScenarios.get(s.id);
      if (!published || !caseIds.has(s.id)) return s;
      const unchangedDuringPublish = testRailContentSignature(s) === testRailContentSignature(published);
      return {
        ...s,
        testRailCaseId: caseIds.get(s.id)!,
        testRailDirty: successfulScenarioIds.has(s.id) ? !unchangedDuringPublish : true,
      };
    });
    await repo.markStoryPublished(draft.id, story.id, { destination: "testrail", scenarios: merged });
  }

  const failed = outcomes.filter((o) => o.status === "failed").length;
  return {
    storyId: story.id,
    issueKey: story.issueKey,
    status: failed === 0 ? "published" : failed === outcomes.length ? "failed" : "partial",
    scenarios: outcomes,
  };
}

export async function publishDraftToTestRail(
  draft: TestDesignDraftWithStories,
  stories: TestDesignDraftStory[],
  deps: TestRailPublishDeps,
): Promise<StoryTestRailResult[]> {
  let priorityIds: Partial<Record<TestDesignPriority, number>> = {};
  try {
    priorityIds = mapPriorities(await deps.client.getPriorities());
  } catch (err) {
    console.warn(`[test-design:testrail] sin prioridades de TestRail, se usará la por defecto: ${errorMessage(err)}`);
  }
  const results: StoryTestRailResult[] = [];
  for (const story of stories) {
    results.push(await publishStoryToTestRail(draft, story, deps, priorityIds));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

export type JiraPublishClient = {
  getSubtaskIssueTypes(projectKey: string): Promise<JiraIssueTypeRef[]>;
  createIssueWithFields(fields: Record<string, unknown>): Promise<{ key: string; id: string }>;
  updateIssueFields(issueKey: string, fields: Record<string, unknown>): Promise<void>;
  issueExists(issueKey: string): Promise<boolean>;
  browseUrl(issueKey: string): string;
};

export type JiraPublishDeps = {
  client: JiraPublishClient;
  testRailBaseUrl?: string | null;
  publishedBy?: string | null;
};

export type StoryJiraResult = {
  storyId: string;
  issueKey: string;
  status: "created" | "updated" | "recreated" | "failed" | "skipped";
  subtaskKey?: string;
  url?: string;
  issueType?: string;
  scenarioCount: number;
  message?: string;
};

export async function publishDraftToJira(
  draft: TestDesignDraftWithStories,
  stories: TestDesignDraftStory[],
  deps: JiraPublishDeps,
): Promise<StoryJiraResult[]> {
  const sectionLabel = draft.testRail.sectionId ? `sección ${draft.testRail.sectionId}` : null;
  const results: StoryJiraResult[] = [];

  for (const story of stories) {
    const selected = story.scenarios.filter((s) => s.selectedForJira);
    const base = { storyId: story.id, issueKey: story.issueKey, scenarioCount: selected.length };
    if (selected.length === 0) {
      results.push({ ...base, status: "skipped", message: "Ningún escenario seleccionado para Jira" });
      continue;
    }
    try {
      const summary = buildSubtaskSummary(story.issueKey, story.issueSummary);
      const description = buildSubtaskDescription(selected, {
        issueKey: story.issueKey,
        issueSummary: story.issueSummary,
        testRailBaseUrl: deps.testRailBaseUrl,
        testRailSectionLabel: sectionLabel,
        updatedBy: deps.publishedBy,
      });

      let subtaskKey = story.jiraSubtaskKey;
      let status: StoryJiraResult["status"];
      let issueType: string | undefined;

      if (subtaskKey && (await deps.client.issueExists(subtaskKey))) {
        await deps.client.updateIssueFields(subtaskKey, { summary, description });
        status = "updated";
      } else {
        const type = await resolveSubtaskType(draft.jiraProjectKey, (key) => deps.client.getSubtaskIssueTypes(key));
        issueType = type.name;
        const created = await deps.client.createIssueWithFields({
          project: { key: draft.jiraProjectKey },
          parent: { key: story.issueKey },
          issuetype: { id: type.id },
          summary,
          description,
        });
        status = subtaskKey ? "recreated" : "created";
        subtaskKey = created.key;
      }

      await repo.markStoryPublished(draft.id, story.id, { destination: "jira", subtaskKey });
      results.push({ ...base, status, subtaskKey, url: deps.client.browseUrl(subtaskKey), issueType });
    } catch (err) {
      results.push({ ...base, status: "failed", message: errorMessage(err) });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Draft status
// ---------------------------------------------------------------------------

/**
 * "published" once every story is out to each destination it has scenarios for
 * (for TestRail: every selected scenario has its case); "partially_published"
 * once anything is; otherwise unchanged.
 */
export function computeDraftStatus(draft: TestDesignDraftWithStories): TestDesignDraftStatus {
  if (draft.status === "archived") return "archived";
  let any = false;
  let all = true;
  for (const story of draft.stories) {
    const needsTestRail = story.scenarios.some((s) => s.selectedForTestRail);
    const needsJira = story.scenarios.some((s) => s.selectedForJira);
    if (story.testRailPublishedAt || story.jiraPublishedAt) any = true;
    const testRailPending = story.scenarios.some((s) => s.selectedForTestRail && s.testRailCaseId === null);
    if ((needsTestRail && (!story.testRailPublishedAt || testRailPending)) || (needsJira && !story.jiraPublishedAt)) {
      all = false;
    }
    if (!needsTestRail && !needsJira) all = false;
  }
  if (!any) return draft.status;
  return all ? "published" : "partially_published";
}
