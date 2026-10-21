import type { JiraScenarioInput } from "./jira-semantic-executor";

export type MissingJiraRequiredInput = {
  scenarioId: string;
  scenarioTitle: string;
  key: string;
  label: string;
  stepIndex: number;
};

/** Return labels and identifiers only; values may contain credentials or tokens. */
export function collectMissingJiraRequiredInputs(
  scenarios: JiraScenarioInput[],
  effectiveValuesByScenario: Record<string, Record<string, string>>,
): MissingJiraRequiredInput[] {
  return scenarios.flatMap((scenario) => (scenario.inputRequirements ?? [])
    .filter((input) => input.required === true)
    .filter((input) => !String(effectiveValuesByScenario[scenario.scenarioId]?.[input.key] ?? "").trim())
    .map((input) => ({
      scenarioId: scenario.scenarioId,
      scenarioTitle: scenario.title,
      key: input.key,
      label: input.label,
      stepIndex: input.stepIndex,
    })));
}
