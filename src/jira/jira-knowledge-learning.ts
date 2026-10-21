import { createHash } from 'node:crypto';
import { parseStepIntent } from '../discovery/step-intent-parser';
import type { JiraDiscoveredExecutionContract, JiraScenarioInput } from './jira-semantic-executor';
import { saveJiraRoute, type JiraLearnedAction, type JiraLearnedRoute } from './jira-knowledge-repository';

export function buildJiraLearnedRoute(input: {
  scenario: JiraScenarioInput; discovery: JiraDiscoveredExecutionContract; appSlug: string;
  profileRevision: string; jobId: string; evidenceRefs: string[]; now?: Date;
}): JiraLearnedRoute | undefined {
  if (input.discovery.plan.status !== 'validated' || !input.evidenceRefs.length) return undefined;
  // Learning is based on the validated Discovery plan below, not the source draft's
  // unresolved-review annotations. Those annotations can remain after Discovery has
  // resolved and executed the actual target successfully. Persist only semantic labels
  // and data references; the plan's locators are deliberately never copied.
  const actions: JiraLearnedAction[] = [];
  for (const step of input.discovery.plan.steps) {
    if (step.action.startsWith('assert')) continue;
    if (step.action === 'navigate') {
      if (step.target !== 'APP_BASE_URL') return undefined;
      actions.push({ action: 'navigate' }); continue;
    }
    // Learning follows the executed plan, not the unexecuted story draft.
    if (!step.target || typeof step.target === 'string') return undefined;
    const field = step.valueKey ? input.scenario.inputRequirements?.find(f => f.key === step.valueKey)?.label
      : semanticActionField(step.action, step.description ?? '');
    if (!field || /["\r\n]/.test(field)) return undefined;
    if (step.action === 'fill' || step.action === 'select') {
      if (!step.valueKey) return undefined;
      actions.push({ action: step.action, field, dataRef: step.valueKey });
    } else if (step.action === 'click') actions.push({ action: 'click', field });
    else if (step.action === 'press' && /^(Enter|Tab)$/i.test(step.value ?? '')) actions.push({ action: 'press', field, key: step.value });
    else return undefined;
  }
  if (!actions.some(a => a.action === 'click')) return undefined;
  return { schemaVersion: 1, engine: 'jira_semantic', appSlug: input.appSlug,
    id: createHash('sha256').update(`${input.appSlug}:${input.scenario.sourceIssueKey}:${input.scenario.scenarioId}`).digest('hex'),
    profileRevision: input.profileRevision, sourceIssueKey: input.scenario.sourceIssueKey,
    scenarioId: input.scenario.scenarioId, jobId: input.jobId,
    validatedAt: (input.now ?? new Date()).toISOString(), startsFrom: input.scenario.authIntent === 'full_authentication' ? 'authenticated_state' : 'project_entry',
    actions, evidenceRefs: input.evidenceRefs };
}

/** Persist a route once Discovery has executed and validated it, independently
 * from later generated-spec verification/promotion. */
export async function persistValidatedJiraDiscoveryRoute(
  input: Parameters<typeof buildJiraLearnedRoute>[0],
  persist: (route: JiraLearnedRoute) => Promise<void> = saveJiraRoute,
): Promise<{ status: 'persisted'; actions: number } | { status: 'skipped' }> {
  const route = buildJiraLearnedRoute(input);
  if (!route) return { status: 'skipped' };
  await persist(route);
  return { status: 'persisted', actions: route.actions.length };
}

/**
 * Convert an executed Jira click description to a reusable semantic target.
 * A few common action verbs (for example "Solicitar el código por SMS") are
 * valid click intents in the Jira executor but are not recognized by the
 * shared step-intent parser. Preserve the target phrase without copying the
 * resolved locator from the plan.
 */
function semanticActionField(action: string, description: string): string | undefined {
  const parsed = parseStepIntent(description)[0]?.actionTarget;
  if (parsed) return parsed;
  if (action !== 'click') return undefined;
  const target = description.trim()
    .replace(/^(?:solicitar|request)\s+(?:(?:el|la|los|las|un|una|the|a|an)\s+)?/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
  if (!target || target.length > 160 || /["'\r\n]/.test(target)) return undefined;
  return target;
}
