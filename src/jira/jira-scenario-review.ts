export type JiraConditionRequirement = {
  key: string;
  subject: string;
  sourceClause: string;
  stepIndices: number[];
};

export type JiraReviewConfiguration = {
  conditions?: Record<string, boolean>;
  uiTargets?: Record<string, string>;
};

export type JiraReviewIssue = { code: string; stepIndex: number; step: string };

type ReviewScenario = {
  steps: string[];
  inputRequirements?: Array<{stepIndex:number;label:string}>;
  unresolvedUiRequirements?: Array<{stepIndex: number; requirement: string}>;
  conditionRequirements?: JiraConditionRequirement[];
  reviewConfiguration?: JiraReviewConfiguration;
};

/** A source-backed summary qualifier describes the current stage, not another operation. */
export function canonicalJiraConditionalVisibilityStep(step:string,requirement:JiraConditionRequirement):string {
 if(typeof requirement.subject!=='string'||typeof requirement.sourceClause!=='string') return step;
 const originalStep=step;
 // Applicability belongs to the source condition metadata, including when the
 // generator places it after the stage rather than inside the quoted target.
 // Strip only the bounded qualifier backed by that source; predicates stay intact.
 if(/\b(?:cuando (?:aplique|corresponda)|si aplica|when applicable|if applicable)\b/i.test(requirement.sourceClause)) {
  step=step.replace(/\s+(?:cuando (?:aplique|corresponda)|si aplica|when applicable|if applicable)[.]?\s*$/i,'');
 }
 const contextual=step.match(/^\s*(?:Validar|Verificar) que\s+(?:el\s+|la\s+)?(?:resumen(?:\s+de\s+confirmaci[oó]n)?|confirmaci[oó]n|(?:confirmation\s+)?summary|confirmation)\s+(?:muestre|muestra|presente|presenta|shows?|displays?)\s+(?:el\s+|la\s+|los\s+|las\s+|the\s+)?["“]([^"”]+)["”][.]?$/i);
 const trailing=step.match(/^\s*(?:Validar|Verificar) que se (?:muestre|muestren)\s+["“]([^"”]+)["”]\s+(?:en\s+(?:el|la)\s+(?:resumen(?:\s+de\s+confirmaci[oó]n)?|confirmaci[oó]n)|in\s+the\s+(?:confirmation\s+summary|summary|confirmation))[.]?$/i);
 // Generators also phrase a summary assertion as “X appears/is included in
 // the confirmation summary”. Treat that as the same visibility assertion,
 // while keeping the quoted target and source-backed stage requirement.
 const summaryContains=step.match(/^\s*(?:Validar|Verificar|Comprobar|Validate|Check)\s+(?:que|that)\s+(?:el\s+|la\s+|los\s+|las\s+|the\s+)?["“]([^"”]+)["”]\s+(?:aparezca(?:n)?|aparece(?:n)?|se\s+incluya(?:n)?|se\s+muestre(?:n)?|figure(?:s)?|appear(?:s)?|is\s+included|are\s+included|be\s+included|is\s+shown|are\s+shown|be\s+shown)\s+(?:en|dentro\s+de|in|within)\s+(?:el\s+|la\s+|the\s+)?(?:resumen(?:\s+de\s+confirmaci[oó]n)?|confirmaci[oó]n|confirmation\s+summary|summary|confirmation)[.]?$/i);
 const fold=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/^(?:el|la|los|las|the)\s+/,'').trim();
 const direct=step.match(/^\s*(?:Validar|Verificar) que se (?:muestre|muestren)\s+["“]([^"”]+)["”][.]?$/i);
 const target=contextual?.[1]??trailing?.[1]??summaryContains?.[1]??direct?.[1];
 if(!target) return originalStep;
 if((contextual||trailing||summaryContains)&&! /\b(?:resumen|confirmaci[oó]n|summary|confirmation)\b/i.test(requirement.sourceClause)) return originalStep;
 let observable=target;
 if(fold(target)!==fold(requirement.subject)) {
  // Only a bounded applicability qualifier can be metadata. Arbitrary business
  // predicates, different subjects, negations and compound actions stay blocked.
  const applicability=/\b(?:cuando (?:aplique|corresponda)|si aplica|when applicable|if applicable)\b/i;
  if(!applicability.test(requirement.sourceClause)) return originalStep;
  observable=target.replace(/\s+(?:cuando (?:aplique|corresponda)|si aplica|when applicable|if applicable|aplicable|applicable)\s*$/i,'');
  if(fold(observable)!==fold(requirement.subject)) return originalStep;
 }
 return `Validar que se muestre "${observable.replace(/^(?:el|la|los|las|the)\s+/i,'')}"`;
}

/** Whether the shared semantic parser can hand this step to live Discovery. */
export function isJiraStepAutoResolvable(step: string): boolean {
  if (/^\s*(?:Solicitar|Request)\s+(?:el\s+|un\s+)?(?:c[oó]digo|code|token)(?:\s+de\s+seguridad)?\s+(?:por|v[ií]a|by|via)\s+(?:SMS|correo electr[oó]nico|email)[.]?$/i.test(step)) return true;
  const intents=parseStepIntent(step);
  return intents.length>0 && intents.every(intent=>[
    'action_click','action_submit','action_fill','action_select','action_press','assertion','navigation_path','setup_route'
  ].includes(intent.type) && (intent.type==='assertion' || Boolean(intent.actionTarget || intent.path?.length)));
}

/** Configuration describes the chosen test variant; it never certifies a DOM target. */
export function prepareJiraScenarioReview<T extends ReviewScenario>(scenario: T): {
  scenario: T;
  skippedAssertionSteps: number[];
  errors: string[];
  issues: JiraReviewIssue[];
} {
  const steps = [...scenario.steps];
  const fields = scenario.inputRequirements?.map(field=>({...field}));
  const errors: string[] = [];
  const issues: JiraReviewIssue[] = [];
  const skippedAssertionSteps: number[] = [];
  if (scenario.conditionRequirements?.some(requirement=>!requirement || typeof requirement.key!=='string' || !requirement.key.trim() || !Array.isArray(requirement.stepIndices))) {
    return {scenario,skippedAssertionSteps,errors:['JIRA_CONDITION_REQUIREMENT_INVALID'],issues};
  }
  for(const requirement of scenario.conditionRequirements ?? []) {
    for(const index of requirement.stepIndices) {
      if(Number.isInteger(index)&&steps[index-1]) steps[index-1]=canonicalJiraConditionalVisibilityStep(steps[index-1],requirement);
    }
  }
  for (const pending of scenario.unresolvedUiRequirements ?? []) {
    const step = steps[pending.stepIndex - 1];
    if (step && /^\s*(?:Validar|Verificar) que se (?:muestre|muestren)\s+["“][^"”]+["”][.]?$/i.test(step)
      && scenario.conditionRequirements?.some(requirement=>scenario.reviewConfiguration?.conditions?.[requirement.key]===false && requirement.stepIndices.includes(pending.stepIndex))) continue;
    const override = scenario.reviewConfiguration?.uiTargets?.[String(pending.stepIndex)]?.trim();
    if (!step || !Number.isInteger(pending.stepIndex)) {
      errors.push('JIRA_UI_REQUIREMENT_POSITION_INVALID');
      continue;
    }
    if (override) {
      // Replace a single target only. Input data, polarity and action stay authored.
      const matches = [...step.matchAll(/["“]([^"”]+)["”]/g)];
      if (matches.length !== 1 || /[\r\n"“”]/.test(override) || override.length > 250) {
        errors.push('JIRA_UI_TARGET_OVERRIDE_INVALID');
      } else {
        steps[pending.stepIndex - 1] = step.replace(matches[0][0], JSON.stringify(override));
        for (const field of fields ?? []) {
          if (field.stepIndex === pending.stepIndex && field.label === matches[0][1]) field.label = override;
        }
      }
    } else if (!isJiraStepAutoResolvable(step)) {
      // Let Discovery resolve authored clicks and explicit visibility targets live.
      // Only steps without an executable semantic target require a manual reference.
      errors.push('JIRA_UI_OBSERVATION_REQUIRED');
    }
  }
  for (const requirement of scenario.conditionRequirements ?? []) {
    const decision = scenario.reviewConfiguration?.conditions?.[requirement.key];
    if (decision !== false && !requirement.stepIndices.length) {
      errors.push('JIRA_CONDITION_ASSERTION_MISSING');
      continue;
    }
    for (const index of requirement.stepIndices) {
      const step = steps[index - 1];
      if (!Number.isInteger(index) || !step || !/^\s*(?:Validar|Verificar)(?: que se (?:muestre|muestren))?\s+["“][^"”]+["”][.]?$/i.test(step)) {
        errors.push('JIRA_CONDITION_STEP_UNSUPPORTED');
        issues.push({code:'JIRA_CONDITION_STEP_UNSUPPORTED',stepIndex:index,step:scenario.steps[index-1] ?? ''});
      } else if (decision === false) {
        skippedAssertionSteps.push(index);
      }
    }
  }
  return {scenario: {...scenario, steps, ...(fields ? {inputRequirements:fields} : {})}, skippedAssertionSteps: [...new Set(skippedAssertionSteps)], errors: [...new Set(errors)],issues};
}

/** Adjacent repeated assertion groups are reviewable defects, never silently removed. */
export function jiraRepeatedAssertionBlocks(steps: string[]): number[] {
  const duplicates: number[] = [];
  for (let start = 0; start < steps.length; start++) {
    for (let size = 3; start + 2 * size <= steps.length; size++) {
      const block = steps.slice(start, start + size);
      if (!block.slice(0, -1).every(step => /^\s*(?:Validar|Verificar)\b/i.test(step))
        || !/^\s*(?:Presionar|Pulsar|Press)\b/i.test(block.at(-1)!)) continue;
      if (block.every((step, offset) => step === steps[start + size + offset])) duplicates.push(start + size + 1);
    }
  }
  return [...new Set(duplicates)];
}

/** A proposed generation repair, not an automatic runtime action omission. */
export function proposeJiraDuplicateRepair(candidate: Record<string, unknown>): Record<string, unknown> | undefined {
  const steps=candidate.steps;
  if(!Array.isArray(steps) || !steps.every((step):step is string=>typeof step==='string')) return undefined;
  const starts=jiraRepeatedAssertionBlocks(steps);
  if(starts.length!==1) return undefined;
  const start=starts[0]-1;
  for(let size=3;size<=start && start+size<=steps.length;size++) {
    const before=steps.slice(start-size,start);
    if(!before.slice(0,-1).every(step=>/^\s*(?:Validar|Verificar)\b/i.test(step)) || !/^\s*(?:Presionar|Pulsar|Press)\b/i.test(before.at(-1)!)) continue;
    if(!before.every((step,index)=>step===steps[start+index])) continue;
    const updated=steps.filter((_step,index)=>index<start || index>=start+size);
    const remap=(items:unknown)=>Array.isArray(items) ? items.flatMap(item=> {
      if(!item || typeof item!=='object') return [item];
      const field=item as Record<string,unknown>;
      if(typeof field.stepIndex!=='number') return [item];
      if(field.stepIndex>start && field.stepIndex<=start+size) return [];
      return [{...field,stepIndex:field.stepIndex>start+size ? field.stepIndex-size : field.stepIndex}];
    }) : items;
    return {...candidate,steps:updated,inputRequirements:remap(candidate.inputRequirements),unresolvedUiRequirements:remap(candidate.unresolvedUiRequirements)};
  }
  return undefined;
}
import {parseStepIntent} from '../discovery/step-intent-parser';

