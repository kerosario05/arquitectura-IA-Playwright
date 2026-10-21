import { parseStepIntent } from "../discovery/step-intent-parser";
import type { JiraScenarioInput } from "./jira-semantic-executor";

/** Persist execution lineage, never literal input values. Reruns resolve these keys from runtime/config again. */
export function redactJiraScenarioInputs(scenario: JiraScenarioInput): JiraScenarioInput {
  let canonicalIndex = 1;
  return { ...scenario, steps: scenario.steps.map(step => {
    const [text, expected] = step.split(/\nEsperado:\s*/i);
    const intent = parseStepIntent(text)[0];
    const index = canonicalIndex;
    canonicalIndex += expected?.trim() ? 2 : 1;
    if (intent?.type !== "action_fill" || intent.value === undefined) return step;
    const key = intent.valueKey ?? `jira_step_${index}`;
    return `Ingresar [${key}] en ${JSON.stringify(intent.actionTarget ?? "")}${expected ? `\nEsperado:${expected}` : ""}`;
  }) };
}
