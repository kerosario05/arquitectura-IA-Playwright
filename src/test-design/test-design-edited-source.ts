import type { JiraIssueSource } from "../scenarios/scenario-types";
import { reviewEditedJiraScenarios, type EditableJiraScenario } from "../jira/jira-scenario-edit";
import type { TestDesignPublishedCaseLink } from "./test-design.types";

export type EditedSourceDeps = {
  loadIssue(issueKey: string): Promise<JiraIssueSource>;
  loginMode?: string;
  authFlowAvailable?: boolean;
};

/**
 * A Design case that a person edited keeps the Jira-engine scenario it was generated from. Replaying that
 * stale snapshot would run steps nobody wrote any more, so the edited Design steps are re-validated with the
 * same review the Jira editor uses and become the source the engine executes. Unedited cases are untouched.
 */
export async function refreshEditedJiraSource(link: TestDesignPublishedCaseLink, deps: EditedSourceDeps): Promise<TestDesignPublishedCaseLink> {
  const source = link.scenario.jiraSourceScenario;
  if (!source || link.scenario.edited !== true) return link;
  const steps = link.scenario.steps.map(step => step.action.trim()).filter(Boolean);
  if (!steps.length || JSON.stringify(steps) === JSON.stringify(source.steps)) return link;
  const issue = await deps.loadIssue(link.issueKey);
  const reviewed = await reviewEditedJiraScenarios(
    issue,
    [source as unknown as EditableJiraScenario],
    source.scenarioId as string,
    { title: link.scenario.title, steps, expectedResult: link.scenario.expectedResult },
    deps.loginMode,
    deps.authFlowAvailable,
  );
  const edited = reviewed.find(scenario => scenario.scenarioId === source.scenarioId || scenario.scenarioId.startsWith(`${source.scenarioId}:edited`));
  if (!edited) return link;
  return { ...link, scenario: { ...link.scenario, jiraSourceScenario: edited as unknown as typeof source } };
}
