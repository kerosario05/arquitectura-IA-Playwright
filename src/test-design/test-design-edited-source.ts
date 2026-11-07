import type { JiraIssueSource } from "../scenarios/scenario-types";
import { reviewEditedJiraScenarios, type EditableJiraScenario } from "../jira/jira-scenario-edit";
import type { TestDesignPublishedCaseLink, TestDesignScenario } from "./test-design.types";

export type EditedSourceDeps = {
  loadIssue(issueKey: string): Promise<JiraIssueSource>;
  loginMode?: string;
  authFlowAvailable?: boolean;
};

/** A saved Design edit needs a fresh execution review when its authored Jira steps changed. */
export function editedDesignSourceNeedsReview(scenario: TestDesignScenario): boolean {
  const source = scenario.jiraSourceScenario;
  if (!source || scenario.edited !== true) return false;
  const steps = scenario.steps.map(step => step.action.trim()).filter(Boolean);
  return JSON.stringify([steps, scenario.expectedResult.trim()])
    !== JSON.stringify([source.steps, source.expectedResult.trim()]);
}

/** Reuses Jira's existing deterministic edit review for the saved Design copy. */
export async function refreshEditedTestDesignScenario(
  scenario: TestDesignScenario,
  issue: JiraIssueSource,
  options: Pick<EditedSourceDeps, "loginMode" | "authFlowAvailable"> = {},
): Promise<TestDesignScenario> {
  const source = scenario.jiraSourceScenario;
  if (!source || !editedDesignSourceNeedsReview(scenario)) return scenario;
  const steps = scenario.steps.map(step => step.action.trim()).filter(Boolean);
  if (!steps.length) {
    // There is no executable content to re-review. Retire findings tied to the
    // deleted source steps, but keep the scenario explicitly uncertified; the
    // editor's normal “add a step” check remains the actionable state.
    const generationWarnings = (scenario.generationWarnings ?? []).filter(warning =>
      !/^Revisar este caso antes de publicarlo:\s*JIRA_[A-Z0-9_]+\b/.test(warning.trim()),
    );
    return {
      ...scenario,
      generationWarnings: generationWarnings.length ? generationWarnings : undefined,
      jiraSourceScenario: {
        ...source,
        steps: [],
        expectedResult: scenario.expectedResult.trim(),
        validation: { ...source.validation, valid: false, errors: [], issues: [] },
      },
    };
  }
  const reviewed = await reviewEditedJiraScenarios(
    issue,
    [source as unknown as EditableJiraScenario],
    source.scenarioId as string,
    { title: scenario.title, steps, expectedResult: scenario.expectedResult },
    options.loginMode,
    options.authFlowAvailable,
  );
  // A re-edit replaces the previous ":edited-<revision>" suffix, so match on the id without it.
  const baseId = (id: string) => id.replace(/:edited-[a-f0-9]+$/, "");
  const edited = reviewed.find(candidate => baseId(candidate.scenarioId) === baseId(source.scenarioId as string));
  if (!edited) return scenario;

  const activeIssueCodes = new Set([
    ...(edited.validation?.errors ?? []).map(error => error.split(":", 1)[0]),
    ...(edited.validation?.issues ?? []).map(issue => issue.code),
  ]);
  const generationWarnings = (scenario.generationWarnings ?? []).filter(warning => {
    const match = warning.match(/^Revisar este caso antes de publicarlo:\s*(JIRA_[A-Z0-9_]+)\b/);
    return !match || activeIssueCodes.has(match[1]);
  });
  return {
    ...scenario,
    generationWarnings: generationWarnings.length ? generationWarnings : undefined,
    jiraSourceScenario: edited as unknown as typeof source,
  };
}

/**
 * A Design case that a person edited keeps the Jira-engine scenario it was generated from. Replaying that
 * stale snapshot would run steps nobody wrote any more, so the edited Design steps are re-validated with the
 * same review the Jira editor uses and become the source the engine executes. Unedited cases are untouched.
 */
export async function refreshEditedJiraSource(link: TestDesignPublishedCaseLink, deps: EditedSourceDeps): Promise<TestDesignPublishedCaseLink> {
  const source = link.scenario.jiraSourceScenario;
  if (!source || link.scenario.edited !== true) return link;
  if (!editedDesignSourceNeedsReview(link.scenario)) return link;
  const issue = await deps.loadIssue(link.issueKey);
  const scenario = await refreshEditedTestDesignScenario(link.scenario, issue, deps);
  return { ...link, scenario };
}
