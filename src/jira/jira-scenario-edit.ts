import {createHash} from 'node:crypto';
import type {JiraIssueSource} from '../scenarios/scenario-types';
import {deriveJiraInputRequirements, type JiraInputRequirement} from './jira-input-requirements';
import {auditGeneratedJiraSyntax,jiraScenarioQualityGaps,uncoveredAcceptanceClauses,jiraNavigationMissing} from './jira-scenario-generator';
import {jiraGenerationContractErrors,jiraSourceConditions} from './jira-generation-contract';
import {isJiraStepAutoResolvable} from './jira-scenario-review';

export interface EditableJiraScenario {
 scenarioId:string;sourceIssueKey:string;title:string;steps:string[];expectedResult:string;
 preconditions?:string[];acceptanceCriteriaRefs?:string[];inputRequirements?:JiraInputRequirement[];
 authIntent?:'full_authentication'|'gate_observation';
 reviewConfiguration?:{conditions?:Record<string,boolean>;uiTargets?:Record<string,string>};
}
export type JiraScenarioEditPatch=Pick<EditableJiraScenario,'title'|'steps'|'expectedResult'>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,16);

/** Validate human-authored steps without AI rewrites or DOM certification. */
export async function reviewEditedJiraScenarios(issue:JiraIssueSource,scenarios:EditableJiraScenario[],scenarioId:string,patch:JiraScenarioEditPatch,loginMode?:string){
 if(!Array.isArray(scenarios)||!scenarios.length||scenarios.length>100||scenarios.some(s=>!s||typeof s!=='object')||new Set(scenarios.map(s=>s.scenarioId)).size!==scenarios.length
  ||scenarios.some(s=>s.sourceIssueKey!==issue.key||typeof s.scenarioId!=='string'||!s.scenarioId.trim())
  ||scenarios.some(s=>typeof s.title!=='string'||typeof s.expectedResult!=='string'||!Array.isArray(s.steps)||s.steps.some(step=>typeof step!=='string')||(s.inputRequirements!==undefined&&!Array.isArray(s.inputRequirements)))
  ||!scenarios.some(s=>s.scenarioId===scenarioId))throw new Error('JIRA_EDIT_SCENARIO_OWNERSHIP_INVALID');
 if(typeof patch.title!=='string'||!patch.title.trim()||patch.title.length>500||typeof patch.expectedResult!=='string'||!patch.expectedResult.trim()||patch.expectedResult.length>4000
  ||!Array.isArray(patch.steps)||!patch.steps.length||patch.steps.length>250||patch.steps.some(s=>typeof s!=='string'||!s.trim()||s.length>4000))throw new Error('JIRA_EDIT_CONTENT_INVALID');
 const reviewed=[];
 for(const original of scenarios){
  const changed=original.scenarioId===scenarioId&&JSON.stringify([original.title,original.steps,original.expectedResult])!==JSON.stringify([patch.title,patch.steps,patch.expectedResult]);
  const draft:EditableJiraScenario=changed?{...original,title:patch.title.trim(),steps:patch.steps.map(s=>s.trim()),expectedResult:patch.expectedResult.trim()}:original;
  if(!Array.isArray(draft.steps)||draft.steps.some(s=>typeof s!=='string'))throw new Error('JIRA_EDIT_CONTENT_INVALID');
  const revision=digest([draft.title,draft.steps,draft.expectedResult,draft.preconditions]);
  // Preserve values only for uniquely unchanged authored inputs, never by their old numeric position.
  const inputs=deriveJiraInputRequirements(draft.steps);
  const inputRequirements=changed?inputs.map(field=>{
   const text=draft.steps[field.stepIndex-1];
   const oldPositions=original.steps.flatMap((s,i)=>s===text?[i+1]:[]);
   const old=oldPositions.length===1&&draft.steps.filter(s=>s===text).length===1
    ?original.inputRequirements?.find(f=>f.stepIndex===oldPositions[0]&&f.operation===field.operation&&f.label===field.label):undefined;
   return {...field,key:old?.key??`jira_edit_${revision}_${field.stepIndex}`};
  }):deriveJiraInputRequirements(draft.steps,original.inputRequirements);
  const reviewConfiguration=changed?{conditions:original.reviewConfiguration?.conditions}:original.reviewConfiguration;
  const conditionRequirements=jiraSourceConditions({...draft,inputRequirements},issue);
  const unresolvedUiRequirements=draft.steps.flatMap((step,i)=>isJiraStepAutoResolvable(step)?[]:[{stepIndex:i+1,requirement:step}]);
  const candidate={...draft,inputRequirements,conditionRequirements,reviewConfiguration,unresolvedUiRequirements};
  const errors=[...(await auditGeneratedJiraSyntax([candidate],[issue])).map(f=>f.reason),...jiraGenerationContractErrors(candidate,issue),...jiraScenarioQualityGaps(candidate,draft.steps)];
  if(jiraNavigationMissing(candidate,draft.steps,loginMode,[issue.summary,issue.description,issue.acceptanceCriteria].join(' ')))errors.push('JIRA_NAVIGATION_TO_TARGET_SCREEN_MISSING');
  reviewed.push({...candidate,
   scenarioId:changed?`${original.scenarioId.replace(/:edited-[a-f0-9]+$/,'')}:edited-${revision}`:original.scenarioId,
   unresolvedUiRequirements,
   validation:{valid:errors.length===0,errors:[...new Set(errors)],warnings:['Los pasos editados requieren Discovery para verificar controles y resultados.']},
   executionReadiness:errors.length?'blocked_syntax':'requires_discovery',mcpExecutable:false});
 }
 const missing=uncoveredAcceptanceClauses(issue,reviewed.filter(s=>s.validation.valid));
 if(missing.length)for(const scenario of reviewed){
  scenario.validation.errors.push(`JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE:${missing.map(c=>c.id).join(',')}`);
  scenario.validation.valid=false;scenario.executionReadiness='blocked_acceptance_coverage';
 }
 return reviewed;
}
