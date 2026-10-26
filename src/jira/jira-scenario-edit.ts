import {createHash} from 'node:crypto';
import type {JiraIssueSource} from '../scenarios/scenario-types';
import {deriveJiraInputRequirements, type JiraInputRequirement} from './jira-input-requirements';
import {auditGeneratedJiraSyntax,jiraScenarioQualityGaps,jiraNavigationMissing} from './jira-scenario-generator';
import {jiraGenerationContractErrors,jiraSourceConditions} from './jira-generation-contract';
import {isJiraStepAutoResolvable} from './jira-scenario-review';
import {normalizeAuthoredJiraStep} from './jira-authored-step-format';

export interface EditableJiraScenario {
 scenarioId:string;sourceIssueKey:string;title:string;steps:string[];expectedResult:string;
 expectedResultMode?:'assertion'|'documentation';
 preconditions?:string[];acceptanceCriteriaRefs?:string[];inputRequirements?:JiraInputRequirement[];
 authIntent?:'full_authentication'|'gate_observation';
 reviewConfiguration?:{conditions?:Record<string,boolean>;uiTargets?:Record<string,string>};
}
export type JiraScenarioEditPatch=Pick<EditableJiraScenario,'title'|'steps'|'expectedResult'>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,16);
const normalizeOracleTarget=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function removedExpectedResultAssertion(original:EditableJiraScenario,editedSteps:string[],expectedResult:string):boolean{
 if(expectedResult.trim()!==original.expectedResult.trim())return false;
 const expected=normalizeOracleTarget(original.expectedResult);
 if(!/\bno\s+(?:se\s+)?(?:muestra|muestre|presenta|presente|aparece|aparezca)\b/i.test(original.expectedResult))return false;
 const negativeAssertion=/^\s*(?:Validar|Verificar) que no se (?:muestre|muestren|presente|presenten|vea|vean)\s+["“]([^"”]+)["”]/i;
 return original.steps.some(step=>{
  const match=step.match(negativeAssertion);
  if(!match||!expected.includes(normalizeOracleTarget(match[1])))return false;
  return !editedSteps.some(candidate=>{
   const remaining=candidate.match(negativeAssertion);
   return Boolean(remaining&&normalizeOracleTarget(remaining[1])===normalizeOracleTarget(match[1]));
  });
 });
}

/** `full_authentication` demands the app's AuthFlow. A project that has none cannot satisfy it, so a reviewed scenario falls back to its authored login steps. Project capability decides, never step wording. */
function authIntentAfterEdit(original:EditableJiraScenario,authFlowAvailable?:boolean):EditableJiraScenario['authIntent']{
 return original.authIntent==='full_authentication'&&authFlowAvailable===false?undefined:original.authIntent;
}

/** Validate human-authored steps without AI rewrites or DOM certification. */
export async function reviewEditedJiraScenarios(issue:JiraIssueSource,scenarios:EditableJiraScenario[],scenarioId:string,patch:JiraScenarioEditPatch,loginMode?:string,authFlowAvailable?:boolean){
 if(!Array.isArray(scenarios)||!scenarios.length||scenarios.length>100||scenarios.some(s=>!s||typeof s!=='object')||new Set(scenarios.map(s=>s.scenarioId)).size!==scenarios.length
  ||scenarios.some(s=>s.sourceIssueKey!==issue.key||typeof s.scenarioId!=='string'||!s.scenarioId.trim())
  ||scenarios.some(s=>typeof s.title!=='string'||typeof s.expectedResult!=='string'||!Array.isArray(s.steps)||s.steps.some(step=>typeof step!=='string')||(s.inputRequirements!==undefined&&!Array.isArray(s.inputRequirements)))
  ||!scenarios.some(s=>s.scenarioId===scenarioId))throw new Error('JIRA_EDIT_SCENARIO_OWNERSHIP_INVALID');
 if(typeof patch.title!=='string'||!patch.title.trim()||patch.title.length>500||typeof patch.expectedResult!=='string'||!patch.expectedResult.trim()||patch.expectedResult.length>4000
  ||!Array.isArray(patch.steps)||!patch.steps.length||patch.steps.length>250||patch.steps.some(s=>typeof s!=='string'||!s.trim()||s.length>4000))throw new Error('JIRA_EDIT_CONTENT_INVALID');
 const reviewed=[];
 for(const original of scenarios){
  const changed=original.scenarioId===scenarioId&&JSON.stringify([original.title,original.steps,original.expectedResult])!==JSON.stringify([patch.title,patch.steps,patch.expectedResult]);
  const editedSteps=patch.steps.map(normalizeAuthoredJiraStep);
  const edited:EditableJiraScenario=changed?{...original,title:patch.title.trim(),steps:editedSteps,expectedResult:patch.expectedResult.trim(),expectedResultMode:removedExpectedResultAssertion(original,editedSteps,patch.expectedResult)?'documentation':original.expectedResultMode}:original;
  // The edited scenario is always re-evaluated, even when the authored steps are unchanged: a stale generator intent must not outlive a review.
  const draft:EditableJiraScenario=original.scenarioId===scenarioId?{...edited,authIntent:authIntentAfterEdit(original,authFlowAvailable)}:edited;
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
  const syntaxIssues=await auditGeneratedJiraSyntax([candidate],[issue]);
  // Editing is an authoring operation: source coverage and navigation heuristics
  // must not discard a user's explicit change. Discovery owns runtime validation
  // of the resulting journey and may report a concrete step for correction.
  const reviewFindings=[...syntaxIssues.map(f=>f.reason),...jiraGenerationContractErrors(candidate,issue),...jiraScenarioQualityGaps(candidate,draft.steps)];
  const reviewIssues=syntaxIssues.filter(f=>f.stepIndex>0).map(f=>({code:f.reason,stepIndex:f.stepIndex,step:f.step}));
  if(jiraNavigationMissing(candidate,draft.steps,loginMode,[issue.summary,issue.description,issue.acceptanceCriteria].join(' ')))reviewFindings.push('JIRA_NAVIGATION_TO_TARGET_SCREEN_MISSING');
  reviewed.push({...candidate,
   scenarioId:changed?`${original.scenarioId.replace(/:edited-[a-f0-9]+$/,'')}:edited-${revision}`:original.scenarioId,
   unresolvedUiRequirements,
   validation:{valid:true,errors:[] as string[],issues:reviewIssues,warnings:[
    'Edición guardada. Discovery verificará el recorrido al ejecutar el escenario.',
    ...(reviewFindings.length?['La revisión automática encontró observaciones que Discovery comprobará durante la ejecución.']:[]),
   ]},
   executionReadiness:'requires_discovery',mcpExecutable:false});
 }
 return reviewed;
}
