import { createHash } from 'node:crypto';
import { parseStepIntent } from '../discovery/step-intent-parser';
import type { JiraDiscoveredExecutionContract, JiraScenarioInput } from './jira-semantic-executor';
import { saveJiraRoute, type JiraLearnedAction, type JiraLearnedRoute } from './jira-knowledge-repository';
import type { TestScenario } from '../types/testrail.types';
import type { ExecutionPlan } from '../types/execution-plan.types';
import { deriveJiraInputRequirements } from './jira-input-requirements';
import { sanitizeSnapshotText, isPotentiallySensitiveText } from '../explorer/snapshot-sanitizer';
import { isCredentialRejectionExpectation } from '../discovery/feedback-message-resolver';

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
    } else if (step.action === 'click') actions.push({ action: 'click', field,
      targetKind:/^(?:solicitar|request)\s/i.test(step.description??'')?'semantic_request':'observed_control' });
    else if (step.action === 'press' && /^(Enter|Tab)$/i.test(step.value ?? '')) actions.push({ action: 'press', field, key: step.value });
    else return undefined;
  }
  if (!actions.some(a => a.action === 'click')) return undefined;
  return { schemaVersion: 1, engine: 'jira_semantic', appSlug: input.appSlug,
    id: createHash('sha256').update(`${input.appSlug}:${input.scenario.sourceIssueKey}:${input.scenario.scenarioId.replace(/:edited-[a-f0-9]+$/,'')}`).digest('hex'),
    profileRevision: input.profileRevision, sourceIssueKey: input.scenario.sourceIssueKey,
    scenarioId: input.scenario.scenarioId, jobId: input.jobId,
    validatedAt: (input.now ?? new Date()).toISOString(), startsFrom: input.scenario.authIntent === 'full_authentication' ? 'authenticated_state' : 'project_entry',
    actions, evidenceRefs: input.evidenceRefs,
    observables:(input.discovery.sourceScenario.observableOracles ?? []).flatMap(oracle=>{
      const target=oracle.target?.trim();
      if (!oracle.backed || !['literal_visible_text','heading_or_control'].includes(oracle.type) || !target
        || /\d|\[REDACTED\]/.test(target) || isPotentiallySensitiveText(target) || isCredentialRejectionExpectation(target) || sanitizeSnapshotText(target)!==target
        || /compar|coincid|igual|mismo valor|same value/i.test(oracle.requirement)) return [];
      return [{requirement:oracle.requirement,target}];
    }),
  };
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

/** Bridge validated classic Discovery to the SAME project knowledge repository.
 * Recording and ambiguous/missing Jira lineage cannot teach a Jira route.
 */
export async function persistClassicJiraDiscoveryRoute(input: {
 scenario: TestScenario; plan?: ExecutionPlan; status: string; appSlug?: string;
 profileRevision: string; jobId: string; evidenceRefs: string[];
 sourceScenario?: JiraDiscoveredExecutionContract['sourceScenario'];
}, persist: (route: JiraLearnedRoute) => Promise<void> = saveJiraRoute) {
 const keys = [...new Set(`${input.scenario.references ?? ''} ${input.scenario.raw?.refs ?? ''} ${input.scenario.source==='jira'?input.scenario.externalId:''}`.match(/\b[A-Z][A-Z0-9_]*-\d+\b/g) ?? [])];
 if (!input.appSlug || !input.plan || !['discovered_passed','repaired_passed'].includes(input.status)
   || keys.length !== 1 || input.scenario.recordingId || input.scenario.recordingExecutionContract) return {status:'skipped' as const};
 return persistValidatedJiraDiscoveryRoute({
  appSlug:input.appSlug, profileRevision:input.profileRevision,jobId:input.jobId,evidenceRefs:input.evidenceRefs,
  scenario:{scenarioId:input.scenario.externalId,sourceIssueKey:keys[0],title:input.scenario.title,
   steps:input.scenario.steps.map(step=>step.action),expectedResult:'',authIntent:input.scenario.authIntent,
   inputRequirements:deriveJiraInputRequirements(input.scenario.steps.map(step=>step.action)).map(field=>({...field,
    key:input.plan!.steps.find(step=>step.index===field.stepIndex&&step.valueKey)?.valueKey??field.key})),
  },
  discovery:{plan:input.plan,sourceScenario:input.sourceScenario??{},runtimeEntries:[]},
 },persist);
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
  if (parsed) return /^(?:solicitar|request)\s/i.test(description.trim())
    ? parsed.replace(/^(?:el|la|los|las|un|una|the|a|an)\s+/i,'') : parsed;
  if (action !== 'click') return undefined;
  const target = description.trim()
    .replace(/^(?:solicitar|request)\s+(?:(?:el|la|los|las|un|una|the|a|an)\s+)?/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
  if (!target || target.length > 160 || /["'\r\n]/.test(target)) return undefined;
  return target;
}
