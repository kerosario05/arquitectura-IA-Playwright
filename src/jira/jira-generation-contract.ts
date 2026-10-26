import type { JiraIssueSource } from "../scenarios/scenario-types";
import {deriveJiraInputRequirements} from "./jira-input-requirements";
import {isJiraStepAutoResolvable} from './jira-scenario-review';
import {jiraRepeatedAssertionBlocks, canonicalJiraConditionalVisibilityStep, type JiraConditionRequirement} from "./jira-scenario-review";
import {parseStepIntent} from '../discovery/step-intent-parser';
import {jiraAcceptanceClauses,literalAlternativeBranches} from './jira-source-clauses';
export {literalAlternativeBranches};
import {jiraRowFormContractErrors} from './jira-row-form-contracts';
import {jiraExplicitRowScope} from './jira-semantic-executor';

function normalized(text: string) {return text.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/^(?:el|la|los|las|un|una|the)\s+/,"").trim();}
const conditionalStageStopWords=new Set(['a','al','and','antes','aplica','aplique','application','aplicacion','autorizar','before','con','cuando','de','del','display','el','en','es','fenix','if','la','las','los','muestra','mostrar','para','por','presenta','present','se','si','the','transfer','transferencia','un','una','when','with']);
function assertionTarget(step:string):string|undefined {
 if(!/^\s*(?:Validar|Verificar)\b/i.test(step)) return undefined;
 return step.match(/["“]([^"”]+)["”]/)?.[1];
}
function conditionalTargetMatches(target:string,subject:string):boolean {
 const actual=normalized(target);const required=normalized(subject);
 return actual===required || actual.startsWith(`${required} `) || required.endsWith(` ${actual}`);
}
function conditionalAssertionIndices(steps:string[],subject:string):number[] {
 return steps.flatMap((step,index)=>{
  const target=assertionTarget(step);
  return target&&conditionalTargetMatches(target,subject)?[index]:[];
 });
}
type ConditionalStage={stepIndices:number[];insertionIndex:number};
/** Source-named data producers distinguish a business review from an earlier landing summary. */
function sourceNamedSummaryInputs(steps:string[],sourceClause:string,subject:string):number[] {
 if(!/\b(?:resumen|confirmaci[oó]n|summary|confirmation)\b/i.test(sourceClause)) return [];
 const excluded=new Set([...conditionalStageStopWords,...normalized(subject).split(/[^a-z0-9]+/)]);
 const terms=new Set(normalized(sourceClause).split(/[^a-z0-9]+/).filter(term=>term.length>=3&&!excluded.has(term)));
 return deriveJiraInputRequirements(steps).filter(field=>normalized(field.label).split(/[^a-z0-9]+/).some(term=>terms.has(term)))
  .map(field=>field.stepIndex-1);
}
/**
 * Pick the assertion block that best matches the other subjects named beside a
 * conditional field in a source-backed summary/confirmation clause. This avoids
 * binding a transaction-summary requirement to an earlier product summary.
 */
function conditionalSummaryStage(steps:string[],sourceClause:string,subject:string):ConditionalStage|undefined {
 if(!/\b(?:resumen|confirmaci[oó]n|summary|confirmation)\b/i.test(sourceClause)) return undefined;
 const subjectTokens=new Set(normalized(subject).split(/[^a-z0-9]+/).filter(Boolean));
 const evidenceTerms=new Set(normalized(sourceClause).split(/[^a-z0-9]+/)
  .filter(term=>term.length>=3&&!subjectTokens.has(term)&&!conditionalStageStopWords.has(term)));
 if(evidenceTerms.size<2) return undefined;
 const producers=sourceNamedSummaryInputs(steps,sourceClause,subject);
 const groups:number[][]=[];
 for(let index=0;index<steps.length;index++) {
  if(!assertionTarget(steps[index])) continue;
  const previous=groups.at(-1);
  if(previous?.at(-1)===index-1) previous.push(index);
  else groups.push([index]);
 }
 const scored=groups.filter(indices=>!producers.some(index=>index>indices.at(-1)!)).map(stepIndices=>{
  const targets=stepIndices.map(index=>normalized(assertionTarget(steps[index])??''));
  const matchedTerms=[...evidenceTerms].filter(term=>targets.some(target=>target.split(/[^a-z0-9]+/).includes(term)));
  const insertionAnchor=[...stepIndices].reverse().find(index=>targets[stepIndices.indexOf(index)]
   .split(/[^a-z0-9]+/).some(term=>evidenceTerms.has(term)));
  return {stepIndices,score:matchedTerms.length,insertionIndex:(insertionAnchor??stepIndices.at(-1)!)+1};
 }).sort((left,right)=>right.score-left.score);
 const best=scored[0];
 if(best&&best.score>=2&&(!scored[1]||scored[1].score!==best.score)) return best;
 // A live summary may show selected product names rather than repeat the HU's
 // word "summary". Its preceding input-group submit is an independent source
 // anchor; accept it only when exactly one assertion block has that provenance.
 const produced=scored.filter(group=>{
  const submit=group.stepIndices[0]-1;
  const intents=parseStepIntent(steps[submit]??'');
  if(intents.length!==1||!['action_click','action_submit','action_press'].includes(intents[0].type)) return false;
  for(let index=submit-1;index>=0;index--){
   const input=parseStepIntent(steps[index]);
   if(input.length!==1||!['action_fill','action_select'].includes(input[0].type)) break;
   if(producers.includes(index)) return true;
  }
  return false;
 });
 return produced.length===1?{...produced[0],insertionIndex:produced[0].stepIndices.at(-1)!+1}:undefined;
}

export function jiraSourceConditions(candidate: Record<string, unknown>, issue?: JiraIssueSource): JiraConditionRequirement[] {
 const steps=Array.isArray(candidate.steps)?candidate.steps.filter((s):s is string=>typeof s==='string'):[];
 const source=[issue?.description,issue?.acceptanceCriteria].filter(Boolean).join("\n");
 const requirements: JiraConditionRequirement[]=[];
 for(const match of source.matchAll(/([^.!?\n]+?)\s+(?:cuando aplique|si aplica|when applicable|if applicable)/gi)) {
  const subject=normalized((match[1].split(/,|\s+y\s+|\s+and\s+/i).at(-1) ?? "").replace(/^(?:mostrar|show|presentar|display)\s+/i,""));
  if(!subject) continue;
  const criterion=[...source.slice(0,match.index).matchAll(/\b(AC\d+)\s*[—–:-]/gi)].at(-1)?.[1];
  const refs=Array.isArray(candidate.acceptanceCriteriaRefs)?candidate.acceptanceCriteriaRefs:[];
  const claimed=criterion && refs.some(ref=>typeof ref==='string' && (ref===criterion || ref.startsWith(criterion+'.')));
   const stage=conditionalSummaryStage(steps,match[0].trim(),subject);
   const producers=sourceNamedSummaryInputs(steps,match[0].trim(),subject);
   const matchingIndices=conditionalAssertionIndices(steps,subject).filter(index=>!producers.some(producer=>producer>index));
   const stepIndices=(stage?matchingIndices.filter(index=>stage.stepIndices.includes(index)):matchingIndices).map(index=>index+1);
  if(claimed || stepIndices.length) {
   const key=`${criterion ?? 'source'}:${subject}`;
   const existing=requirements.find(requirement=>requirement.key===key);
   if(existing) existing.stepIndices=[...new Set([...existing.stepIndices,...stepIndices])];
   else requirements.push({key,subject,sourceClause:match[0].trim(),stepIndices});
  }
 }
 return requirements;
}

/**
 * Add a source-backed conditional assertion when its business stage is unambiguous.
 * The insertion point is derived from the source clause and the latest existing
 * assertion in that clause; otherwise the draft remains blocked for review.
 */
export function repairMissingJiraConditionalAssertions<T extends Record<string, unknown>>(candidate: T, issue?: JiraIssueSource): T {
 const initialSteps=Array.isArray(candidate.steps)?candidate.steps.filter((step):step is string=>typeof step==='string'):[];
 let steps=[...initialSteps];
 let inputRequirements=Array.isArray(candidate.inputRequirements)?candidate.inputRequirements.map(item=>item && typeof item==='object'?{...(item as Record<string,unknown>)}:item):undefined;
 let unresolvedUiRequirements=Array.isArray(candidate.unresolvedUiRequirements)?candidate.unresolvedUiRequirements.map(item=>item && typeof item==='object'?{...(item as Record<string,unknown>)}:item):undefined;
 let changed=false;

 // Atomic source-backed prose assertions already name the conditional subject
 // at their authored stage. Make that subject explicit for the contract rather
 // than treating an unquoted, otherwise executable assertion as missing.
 for(const requirement of jiraSourceConditions({...candidate,steps},issue)) {
  if(!/\b(?:resumen|confirmaci[oó]n|summary|confirmation)\b/i.test(requirement.sourceClause)) continue;
  steps=steps.map(step=>{
   // Already atomic targets keep their authored wording; stage relocation must
   // not rename a later, correctly placed observable while removing an early one.
   const direct=step.match(/^\s*(?:Validar|Verificar) que se (?:muestre|muestren) ["“]([^"”]+)["”][.]?$/i);
   if(direct&&conditionalTargetMatches(direct[1],requirement.subject)
    &&! /\b(?:cuando aplique|si aplica|when applicable|if applicable)\b/i.test(direct[1])) return step;
   const contextual=canonicalJiraConditionalVisibilityStep(step,requirement);
   if(contextual!==step) {changed=true;return contextual;}
   const match=step.match(/^\s*(?:Validar|Verificar)\s+que\s+(?:el\s+|la\s+)?(?:resumen(?:\s+de\s+confirmaci[oó]n)?|confirmaci[oó]n|(?:confirmation\s+)?summary|confirmation)\s+(?:muestre|muestra|presente|presenta)\s+([^"“”]+?)[.]?$/i);
   const subject=match?.[1].replace(/\s+(?:cuando aplique|si aplica|when applicable|if applicable|aplicable|applicable)$/i,'');
   if(!subject||normalized(subject)!==requirement.subject) return step;
   changed=true;
   return `Validar que se muestre "${requirement.subject}"`;
  });
 }

 // A repeated subject can occur on an earlier screen (for example a product
 // summary) and in the later business summary required by the story. Keep or
 // insert the conditional assertion only in the uniquely best-matching block.
 for(const requirement of jiraSourceConditions({...candidate,steps},issue)) {
  const stage=conditionalSummaryStage(steps,requirement.sourceClause,requirement.subject);
  if(!stage) continue;
  const allMatches=conditionalAssertionIndices(steps,requirement.subject);
  const selected=allMatches.filter(index=>stage.stepIndices.includes(index));
  const stale=allMatches.filter(index=>!stage.stepIndices.includes(index));
  if(!stale.length&&selected.length) continue;
  const removed=new Set(selected.length?stale:allMatches);
  const removedBeforeInsertion=[...removed].filter(index=>index<stage.insertionIndex).length;
  steps=steps.filter((_step,index)=>!removed.has(index));
  const remapAfterRemoval=(items:unknown[]|undefined)=>items?.flatMap(item=>{
   if(!item||typeof item!=='object') return [item];
   const record=item as Record<string,unknown>;
   if(!Number.isInteger(record.stepIndex)) return [item];
   const oldIndex=record.stepIndex as number;
   if(removed.has(oldIndex-1)) return [];
   const preceding=[...removed].filter(index=>index<oldIndex-1).length;
   return [{...record,stepIndex:oldIndex-preceding}];
  });
  inputRequirements=remapAfterRemoval(inputRequirements);
  unresolvedUiRequirements=remapAfterRemoval(unresolvedUiRequirements);
  changed=removed.size>0||changed;
  if(!selected.length) {
   const insertionIndex=Math.max(0,stage.insertionIndex-removedBeforeInsertion);
   steps.splice(insertionIndex,0,`Validar que se muestre "${requirement.subject}"`);
   const insertedStepNumber=insertionIndex+1;
   const reindexAfterInsertion=(items:unknown[]|undefined)=>items?.map(item=>{
    if(!item||typeof item!=='object') return item;
    const record=item as Record<string,unknown>;
    return Number.isInteger(record.stepIndex)&&(record.stepIndex as number)>=insertedStepNumber
     ? {...record,stepIndex:(record.stepIndex as number)+1}:record;
   });
   inputRequirements=reindexAfterInsertion(inputRequirements);
   unresolvedUiRequirements=reindexAfterInsertion(unresolvedUiRequirements);
   changed=true;
  }
 }

 for(const requirement of jiraSourceConditions({...candidate,steps},issue).filter(item=>item.stepIndices.length===0)) {
  const contextualIndex=steps.findIndex(step=>{
   const contextual=step.match(/^\s*(?:Validar|Verificar)\s+(.+?)\s+en\s+["“][^"”]+["”][.]?$/i);
   return Boolean(contextual && normalized(contextual[1])===requirement.subject);
  });
  if(contextualIndex>=0) {
   steps[contextualIndex]=`Validar que se muestre "${requirement.subject}"`;
   changed=true;
   continue;
  }
  // A HU can describe the conditional field as part of a confirmation summary
  // without using the same name for the summary assertion. Attach the check to
  // that observed summary so the criterion is covered before authorization.
  const sourceDescribesSummary=/\b(?:resumen|confirmaci[oó]n|summary|confirmation)\b/i.test(requirement.sourceClause);
  const summaryAnchors=sourceDescribesSummary ? steps.flatMap((step,index)=>{
   const target=step.match(/^\s*(?:Validar|Verificar)\b[\s\S]*?["“]([^"”]+)["”]/i)?.[1] ?? '';
    return /\b(?:resumen|confirmaci[oó]n|summary|confirmation)\b/i.test(target)
      &&!sourceNamedSummaryInputs(steps,requirement.sourceClause,requirement.subject).some(producer=>producer>index)?[index]:[];
   }) : [];
  const summaryAnchor=summaryAnchors.length===1?summaryAnchors[0]:-1;
  if(summaryAnchor>=0) {
   const insertionIndex=summaryAnchor+1;
   const insertedStepNumber=insertionIndex+1;
   steps.splice(insertionIndex,0,`Validar que se muestre "${requirement.subject}"`);
   const reindex=(items:unknown[]|undefined)=>items?.map(item=>{
    if(!item||typeof item!=='object') return item;
    const record=item as Record<string,unknown>;
    return Number.isInteger(record.stepIndex) && (record.stepIndex as number)>=insertedStepNumber
     ? {...record,stepIndex:(record.stepIndex as number)+1}:record;
   });
   inputRequirements=reindex(inputRequirements);
   unresolvedUiRequirements=reindex(unresolvedUiRequirements);
   changed=true;
   continue;
  }
  const clauseWithoutCondition=normalized(requirement.sourceClause).replace(/\s+(?:cuando aplique|si aplica|when applicable|if applicable)$/i,'').trim();
  const sourceClause=clauseWithoutCondition.endsWith(requirement.subject)
   ? clauseWithoutCondition.slice(0,-requirement.subject.length).trim():clauseWithoutCondition;
  if(!sourceClause) continue;
  const assertionGroups:number[][]=[];
  for(let index=0;index<steps.length;index++) {
   if(/^\s*(?:Validar|Verificar)\b/i.test(steps[index])) {
    if(!assertionGroups.length || assertionGroups.at(-1)!.at(-1)!==index-1) assertionGroups.push([]);
    assertionGroups.at(-1)!.push(index);
   }
  }
  const rankedGroups=assertionGroups.map(indices=>({indices,matches:indices.filter(index=>
   [...steps[index].matchAll(/["“]([^"”]+)["”]/g)].some(match=>{
    const target=normalized(match[1]);
    return target.length>=3 && sourceClause.includes(target);
   })
  )})).filter(group=>group.matches.length>0).sort((left,right)=>right.matches.length-left.matches.length);
  const best=rankedGroups[0];
  if(!best || (rankedGroups[1] && rankedGroups[1].matches.length===best.matches.length)) continue;
  const anchor=best.matches.at(-1)!;
  const insertionIndex=anchor+1;
  const assertion=`Validar que se muestre "${requirement.subject}"`;
  if(steps.some(step=>step===assertion)) continue;
  steps.splice(insertionIndex,0,assertion);
  const insertedStepNumber=insertionIndex+1;
  const reindex=(items:unknown[]|undefined)=>items?.map(item=>{
   if(!item||typeof item!=='object') return item;
   const record=item as Record<string,unknown>;
   return Number.isInteger(record.stepIndex) && (record.stepIndex as number)>=insertedStepNumber
    ? {...record,stepIndex:(record.stepIndex as number)+1}:record;
  });
  inputRequirements=reindex(inputRequirements);
  unresolvedUiRequirements=reindex(unresolvedUiRequirements);
  changed=true;
 }
 if(!changed) return candidate;
 return {...candidate,steps,...(inputRequirements?{inputRequirements}:{}),...(unresolvedUiRequirements?{unresolvedUiRequirements}:{})};
}

/**
 * Restore an explicit transition between a reviewed summary and a later
 * authorization stage when the story says the customer reviews before
 * continuing. The action remains semantic so Discovery resolves the real
 * control for each application.
 */
export function repairMissingJiraReviewTransition<T extends Record<string, unknown>>(candidate: T, issue?: JiraIssueSource): T {
 const source=[issue?.description,issue?.acceptanceCriteria].filter(Boolean).join("\n");
 const review=source.match(/\b(?:revis\w*|review\w*)\b[\s\S]{0,180}?\b(?:antes de continuar|before continuing|before proceeding|antes de proseguir)\b/i);
 if(!review || !/\b(?:resumen|confirmaci[oó]n|summary|confirmation)\b/i.test(source.slice(0,review.index))) return candidate;
 const authorizationText=source.slice((review.index ?? 0)+review[0].length);
 if(!/\b(?:autoriz\w*|token(?:\s+de\s+(?:seguridad|security))?|validaci[oó]n\s+de\s+identidad|identity\s+validation)\b/i.test(authorizationText)) return candidate;
 const steps=Array.isArray(candidate.steps)?candidate.steps.filter((step):step is string=>typeof step==='string'):[ ];
 const summarySource=normalized(source.slice(0,(review.index ?? 0)+review[0].length));
 const laterSource=normalized(authorizationText);
 // An absence oracle is not an observed destination. In particular, a rejected
 // login must not gain a successful Continue before “no receipt is shown”.
 const assertions=steps.map((step,index)=>({step,index,target:/^\s*(?:Validar|Verificar)\s+(?:que\s+)?no\b/i.test(step)
  ? undefined : step.match(/^\s*(?:Validar|Verificar)\b[\s\S]*?["“]([^"”]+)["”]/i)?.[1]}));
 // Shared field words (amount/accounts) can occur again on the final receipt.
 // Only the summary before a source-distinct later stage can own this transition.
 const sourceDeclaresStage=(target:string)=>new RegExp(`(?:pantalla(?: de)?|screen|muestra|shows?)\\s+(?:(?:el|la|the)\\s+)?${normalized(target).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:\\b|$)`,'i').test(laterSource);
 const firstLaterStage=assertions.find(item=>item.target && normalized(item.target).length>=3
  && sourceDeclaresStage(item.target)&&!summarySource.includes(normalized(item.target)));
 if(!firstLaterStage) return candidate;
 const summaryIndices=assertions.filter(item=>item.index<firstLaterStage.index && item.target && normalized(item.target).length>=3 && summarySource.includes(normalized(item.target))).map(item=>item.index);
 const lastSummary=summaryIndices.at(-1);
 if(lastSummary===undefined) return candidate;
 const nextStage=assertions.find(item=>item.index>lastSummary && item.target && normalized(item.target).length>=3 && laterSource.includes(normalized(item.target)));
 if(!nextStage) return candidate;
 const hasTransition=steps.slice(lastSummary+1,nextStage.index).some(step=>parseStepIntent(step).some(intent=>
  ['action_click','action_fill','action_select','action_submit','action_press','action_check','action_uncheck'].includes(intent.type)));
 if(hasTransition) return candidate;

 const insertionIndex=nextStage.index;
 const insertedStepNumber=insertionIndex+1;
 const reindex=(items:unknown[]|undefined)=>items?.map(item=>{
  if(!item||typeof item!=='object') return item;
  const record=item as Record<string,unknown>;
  return Number.isInteger(record.stepIndex) && (record.stepIndex as number)>=insertedStepNumber
   ? {...record,stepIndex:(record.stepIndex as number)+1}:record;
 });
 const unresolved=reindex(Array.isArray(candidate.unresolvedUiRequirements)?candidate.unresolvedUiRequirements:[]) ?? [];
 unresolved.push({stepIndex:insertedStepNumber,requirement:'Discovery must resolve the control that continues from the reviewed summary to the authorization stage.'});
 unresolved.sort((left,right)=>Number((left as Record<string,unknown>).stepIndex)-Number((right as Record<string,unknown>).stepIndex));
 return {
  ...candidate,
  steps:[...steps.slice(0,insertionIndex),'Presionar la acción para continuar',...steps.slice(insertionIndex)],
  ...(Array.isArray(candidate.inputRequirements)?{inputRequirements:reindex(candidate.inputRequirements)}:{}),
  unresolvedUiRequirements:unresolved,
 };
}

/**
 * Keep a generated journey from navigating away after its source-backed final
 * result. Actions after a terminal success assertion are retained only when
 * the story explicitly describes that action after the same result.
 */
export function repairUnsubstantiatedPostOutcomeActions<T extends Record<string, unknown>>(candidate: T, issue?: JiraIssueSource): T {
 const steps=Array.isArray(candidate.steps)?candidate.steps.filter((step):step is string=>typeof step==='string'):[];
 const expected=normalized(typeof candidate.expectedResult==='string'?candidate.expectedResult:'');
 const source=normalized([issue?.description,issue?.acceptanceCriteria].filter(Boolean).join('\n'));
 if(!steps.length || !expected || !source) return candidate;

 const terminal=steps.map((step,index)=>{
  const target=step.match(/^\s*(?:Validar|Verificar)\b[\s\S]*?["“]([^"”]+)["”]/i)?.[1];
  return target && /\b(?:comprobante|recibo|receipt|transacci[oó]n exitosa|operaci[oó]n exitosa|successful|successfully completed)\b/i.test(target)
   && expected.includes(normalized(target)) && source.includes(normalized(target)) ? {index,target}:undefined;
 }).find(Boolean);
 if(!terminal) return candidate;

 const sourceTerminalIndex=source.indexOf(normalized(terminal.target));
 const sourceAfterOutcome=source.slice(sourceTerminalIndex+normalized(terminal.target).length);
 const removedIndices:number[]=[];
 for(let index=terminal.index+1;index<steps.length;index++) {
  const intents=parseStepIntent(steps[index]).filter(intent=>[
   'action_click','action_fill','action_select','action_submit','action_press','action_check','action_uncheck',
  ].includes(intent.type));
  if(!intents.length) continue;
  const supported=intents.some(intent=>{
   const target=normalized(intent.actionTarget ?? intent.actionVerb ?? '');
   return target.length>=2 && sourceAfterOutcome.includes(target);
  });
  if(!supported) removedIndices.push(index);
 }
 if(!removedIndices.length) return candidate;

 const removed=new Set(removedIndices);
 const remainingSteps=steps.filter((_,index)=>!removed.has(index));
 const reindex=(items:unknown[]|undefined,dropRemoved=false)=>items?.flatMap(item=>{
  if(!item || typeof item!=='object') return [item];
  const record=item as Record<string,unknown>;
  const stepIndex=Number.isInteger(record.stepIndex)?record.stepIndex as number:undefined;
  if(dropRemoved && stepIndex!==undefined && removed.has(stepIndex-1)) return [];
  const next={...record};
  if(stepIndex!==undefined) next.stepIndex=stepIndex-removedIndices.filter(index=>index<stepIndex-1).length;
  if(Array.isArray(record.stepIndices)) next.stepIndices=record.stepIndices
   .filter((value):value is number=>Number.isInteger(value) && !removed.has((value as number)-1))
   .map(value=>value-removedIndices.filter(index=>index<value-1).length);
  return [next];
 });
 return {
  ...candidate,
  steps:remainingSteps,
  ...(Array.isArray(candidate.inputRequirements)?{inputRequirements:reindex(candidate.inputRequirements)}:{}),
  ...(Array.isArray(candidate.unresolvedUiRequirements)?{unresolvedUiRequirements:reindex(candidate.unresolvedUiRequirements,true)}:{}),
 };
}

const FILTER_SUBMIT_STEP=/^\s*(?:presionar|pulsar|hacer\s+clic|clic|click|press)\b[^"“]*?(?:\b(?:acci[oó]n|action|bot[oó]n|button)\s+(?:de\s+)?)?["“]?(?:buscar|filtrar|b[uú]squeda|aplicar\s+filtro|search|filter|apply\s+filter)\b/i;
const FILL_STEP=/^\s*(?:ingresar|escribir|digitar|introducir|filtrar|buscar|enter|fill|type)\b/i;
// Source declares a submit control only by naming a button/Enter/press-click on a search verb.
const SOURCE_SEARCH_SUBMIT=/\b(?:bot[oó]n|button|enter|intro)\b[^.\n]{0,40}\b(?:buscar|filtrar|b[uú]squeda|search|filter)|\b(?:presion\w*|pulsar|clic|click|press)\b[^.\n]{0,40}\b(?:buscar|filtrar|search|filter)\b/i;

function jiraUnbackedFilterSubmitIndices(steps:string[],issue?:JiraIssueSource):number[] {
 const source=normalized([issue?.description,issue?.acceptanceCriteria].filter(Boolean).join('\n'));
 if(!source || SOURCE_SEARCH_SUBMIT.test(source)) return [];
 return steps.flatMap((step,index)=>index>0&&FILTER_SUBMIT_STEP.test(step)&&FILL_STEP.test(steps[index-1])?[index]:[]);
}

/**
 * A fill followed by an invented search/filter submit is dropped unless the
 * story declares a submit control. Observable results are not synthesized here:
 * the contract check below fails closed when no later assertion remains.
 */
export function repairUnbackedFilterSubmitActions<T extends Record<string, unknown>>(candidate: T, issue?: JiraIssueSource): T {
 const steps=Array.isArray(candidate.steps)?candidate.steps.filter((step):step is string=>typeof step==='string'):[];
 const removedIndices=jiraUnbackedFilterSubmitIndices(steps,issue);
 if(!removedIndices.length) return candidate;
 const removed=new Set(removedIndices);
 const shift=(index:number)=>index-removedIndices.filter(r=>r<index-1).length;
 const reindex=(items:unknown[]|undefined)=>items?.flatMap(item=>{
  if(!item||typeof item!=='object') return [item];
  const record=item as Record<string,unknown>;
  const stepIndex=Number.isInteger(record.stepIndex)?record.stepIndex as number:undefined;
  if(stepIndex!==undefined&&removed.has(stepIndex-1)) return [];
  const next={...record};
  if(stepIndex!==undefined) next.stepIndex=shift(stepIndex);
  return [next];
 });
 return {
  ...candidate,
  steps:steps.filter((_,index)=>!removed.has(index)),
  ...(Array.isArray(candidate.inputRequirements)?{inputRequirements:reindex(candidate.inputRequirements)}:{}),
  ...(Array.isArray(candidate.unresolvedUiRequirements)?{unresolvedUiRequirements:reindex(candidate.unresolvedUiRequirements)}:{}),
 };
}

/** After a fill with no declared submit, the step must be followed by an assertion proving the observable result. */
function jiraReactiveFilterResultMissing(steps:string[],issue?:JiraIssueSource):boolean {
 const source=normalized([issue?.description,issue?.acceptanceCriteria].filter(Boolean).join('\n'));
 if(!source || SOURCE_SEARCH_SUBMIT.test(source)) return false;
 // Evidence = later assertion tied to results/list/rows/count, not any assertion (logo, header, nav...).
 const resultTerm=/\b(?:resultados?|results?|listas?|listados?|lists?|filas?|rows?|registros?|records?|coincid\w*|match\w*|cantidad|total|count|tabla|table|elementos|items?)\b/i;
 return steps.some((step,index)=>FILL_STEP.test(step)&&/\b(?:filtro|filtrar|filter|buscar|b[uú]squeda|search)\b/i.test(normalized(step))
  && !steps.slice(index+1).some(next=>/^\s*(?:Validar|Verificar)\b/i.test(next)&&resultTerm.test(normalized(next))));
}

/**
 * A result assertion after a list filter/search needs a known row fixture. Without one,
 * a perfectly valid empty result (as on a clean project) makes the generated assertion
 * impossible to prove. Accept explicit source-authored setup or a declared data precondition;
 * never silently assume the target environment is seeded.
 */
function jiraFilterResultFixtureMissing(candidate:Record<string,unknown>,steps:string[]):boolean {
 const assertsFilteredCollection=steps.some((step,index)=>{
  if(!/^\s*(?:validar|verificar|comprobar)\b/i.test(step)) return false;
  const assertion=normalized(step);
  const collection=/\b(?:solicitudes?|resultados?|filas?|registros?|listados?|records?|rows?|results?|items?)\b/i.test(assertion);
  const relation=/\b(?:correspond\w*|coincid\w*|pertenec\w*|match\w*|filtrad\w*|selected\s+state|estado\s+seleccionado|filtro\s+seleccionado|criterio\s+seleccionado)\b/i.test(assertion);
  if(!collection||!relation) return false;
  return steps.slice(0,index).some(prior=>
   /\b(?:seleccionar|ingresar|escribir|digitar|introducir|buscar|filtrar|search|filter)\b/i.test(normalized(prior))
   && /\b(?:estado|filtro|buscar|b[uú]squeda|search|filter|criterio)\b/i.test(normalized(prior))
  );
 });
 if(!assertsFilteredCollection) return false;

 const preconditions=Array.isArray(candidate.preconditions)
  ? candidate.preconditions.filter((value):value is string=>typeof value==='string').join(' ')
  : '';
 const explicitDataFixture=/\b(?:existe|existen|hay|disponible|preparad\w*|cargad\w*|seed\w*|fixture|datos?\s+de\s+prueba|data\s+set)\b[^.!?]{0,140}\b(?:solicitud|solicitudes|registro|registros|fila|filas|resultado|resultados|request|record|row|rows)\b/i.test(preconditions)
  || /\b(?:solicitud|solicitudes|registro|registros|fila|filas|resultado|resultados|request|record|row|rows)\b[^.!?]{0,140}\b(?:existe|existen|hay|disponible|preparad\w*|cargad\w*|seed\w*|fixture|datos?\s+de\s+prueba|data\s+set)\b/i.test(preconditions);
 const createsRecordBeforeFilter=steps.some((step,index)=>{
  if(!/^\s*(?:presionar|pulsar|hacer\s+clic|clic|click|press)\b/i.test(step)
   || !/\b(?:guardar|crear|registrar|agregar|a[nñ]adir|save|create|register|add|submit)\b/i.test(normalized(step))) return false;
  return steps.slice(0,index).some(prior=>/\b(?:nueva?\s+solicitud|crear\s+(?:una\s+)?(?:solicitud|registro)|agregar\s+(?:una\s+)?(?:solicitud|registro)|new\s+(?:request|record)|create\s+(?:a\s+)?(?:request|record))\b/i.test(normalized(prior)))
   && steps.slice(index+1).some(next=>/\b(?:filtrar|filtro|buscar|b[uú]squeda|search|filter)\b/i.test(normalized(next)));
 });
 return !explicitDataFixture&&!createsRecordBeforeFilter;
}

/** Remove a structural new-row assertion only when a later row-scoped field action already proves the row can be used. */
export function repairUnsupportedAddedRowAssertions<T extends Record<string, unknown>>(candidate: T): T {
 const steps=Array.isArray(candidate.steps)?candidate.steps.filter((step):step is string=>typeof step==='string'):[];
 const removedIndices=steps.flatMap((step,index)=>{
  const assertion=parseStepIntent(step).some(intent=>intent.type==='assertion');
  const target=step.match(/^\s*(?:Validar|Verificar|Comprobar)\b[\s\S]*?["“]([^"”]+)["”]/i)?.[1];
  if(!assertion||!target) return [];
  const structuralAddedRow=/(?:nueva?s?|new|added|agregad[oa]s?|anadid[oa]s?)\b.{0,40}\b(?:fila|filas|row|rows)\b|\b(?:fila|filas|row|rows)\b.{0,40}\b(?:nueva?s?|new|added|agregad[oa]s?|anadid[oa]s?)\b/i.test(normalized(target));
  if(!structuralAddedRow) return [];
  const followedByRowAction=steps.slice(index+1).some(next=>{
   const rowScope=jiraExplicitRowScope(next);
   return rowScope!==undefined&&rowScope>1&&parseStepIntent(next).some(intent=>['action_fill','action_select'].includes(intent.type));
  });
  return followedByRowAction?[index]:[];
 });
 if(!removedIndices.length) return candidate;
 const removed=new Set(removedIndices);
 const reindex=(items:unknown[]|undefined)=>items?.flatMap(item=>{
  if(!item||typeof item!=='object') return [item];
  const record=item as Record<string,unknown>;
  const stepIndex=Number.isInteger(record.stepIndex)?record.stepIndex as number:undefined;
  if(stepIndex!==undefined&&removed.has(stepIndex-1)) return [];
  const next={...record};
  if(stepIndex!==undefined) next.stepIndex=stepIndex-removedIndices.filter(index=>index<stepIndex-1).length;
  if(Array.isArray(record.stepIndices)) next.stepIndices=record.stepIndices
   .filter((value):value is number=>Number.isInteger(value)&&!removed.has((value as number)-1))
   .map(value=>value-removedIndices.filter(index=>index<value-1).length);
  return [next];
 });
 return {
  ...candidate,
  steps:steps.filter((_,index)=>!removed.has(index)),
  ...(Array.isArray(candidate.inputRequirements)?{inputRequirements:reindex(candidate.inputRequirements)}:{}),
  ...(Array.isArray(candidate.unresolvedUiRequirements)?{unresolvedUiRequirements:reindex(candidate.unresolvedUiRequirements)}:{}),
  ...(Array.isArray(candidate.conditionRequirements)?{conditionRequirements:reindex(candidate.conditionRequirements)}:{}),
 };
}

/**
 * A "matching row" assertion must name its table/container and the filter value. When the provider
 * quotes the bare phrase, rebuild it only from steps already in this case: the filter fill directly
 * before it, the container an earlier step asserted content in, and a prior save/add action proving
 * the record was added. Any piece missing leaves the step untouched (it stays unresolved, fail closed).
 */
export function repairContainerlessMatchingRowAssertions<T extends Record<string, unknown>>(candidate: T): T {
 const steps=Array.isArray(candidate.steps)?candidate.steps.filter((step):step is string=>typeof step==='string'):[];
 const bare=/^\s*(?:Validar|Verificar|Comprobar)\s+que\s+["“](?:(?:la|el)\s+)?(?:(?:fila|row)\s+(?:coincidente|que\s+coincide|matching)|matching\s+row)["”]/i;
 const saves=/^\s*(?:presionar|clic|click|hacer clic|press)\b.*\b(?:guardar|crear|registrar|agregar|a[nñ]adir|enviar|save|create|register|add|submit)\b/i;
 const placed=/^\s*(?:Validar|Verificar|Comprobar)\b.*\b(?:aparezca|aparezcan|se\s+muestre|se\s+muestren|figure|figuren)\b.*\ben\s+["“]([^"”]+)["”]/i;
 const repaired=new Map<number,string>();
 steps.forEach((step,index)=>{
  if(!bare.test(step)||index<2) return;
  const filter=steps[index-1].match(/^\s*(?:Ingresar|Escribir|Digitar|Introducir)\s+(.+?)\s+en\s+["“]([^"”]+)["”]/i);
  const container=[...steps.slice(0,index-1)].reverse().map(prior=>prior.match(placed)?.[1]).find(Boolean);
  if(!filter||!container||normalized(container)===normalized(filter[2])||!steps.slice(0,index-1).some(prior=>saves.test(prior))) return;
  repaired.set(index,`Validar que la fila coincidente agregada con ${filter[1]} permanezca visible en "${container}"`);
 });
 if(!repaired.size) return candidate;
 return {
  ...candidate,
  steps:steps.map((step,index)=>repaired.get(index)??step),
  ...(Array.isArray(candidate.unresolvedUiRequirements)?{unresolvedUiRequirements:candidate.unresolvedUiRequirements.filter(item=>
   !(item&&typeof item==='object'&&Number.isInteger((item as Record<string,unknown>).stepIndex)&&repaired.has((item as {stepIndex:number}).stepIndex-1)))}:{}),
 };
}

/**
 * Drop content assertions whose only subject is a navigation-menu label named by the story.
 * A label inside a nav/menu is not page content; the prompt forbids it, and this guard
 * enforces it when the provider ignores the rule. Menu evidence comes from the source
 * sentence ("menu"/"navigation" before the label), never from app or label names.
 */
export function repairMenuLabelContentAssertions<T extends Record<string, unknown>>(candidate: T, issue?: JiraIssueSource): T {
 const steps=Array.isArray(candidate.steps)?candidate.steps.filter((step):step is string=>typeof step==='string'):[];
 // Provenance unit = one acceptance criterion (AC<n> marker to the next marker); text with no marker
 // is split per line and needs no claim. A cue only applies inside its own unit, and a label that
 // also appears outside a menu zone in any unit (e.g. as page content) keeps its assertion.
 const refs=Array.isArray(candidate.acceptanceCriteriaRefs)?candidate.acceptanceCriteriaRefs.filter((ref):ref is string=>typeof ref==='string'):[];
 const claims=(id:string)=>refs.some(ref=>ref===id||ref.startsWith(`${id}.`));
 const units=[issue?.description,issue?.acceptanceCriteria].filter(Boolean).join("\n").split(/(?=\bAC\d+\s*[—–:-])/i).flatMap(part=>{
  const id=part.match(/^\s*(AC\d+)\s*[—–:-]/i)?.[1].toUpperCase();
  return (id?[part]:part.split("\n")).map(text=>{
   const clean=normalized(text);
   const cue=clean.match(/\b(?:menu|navegacion|navigation|sidebar|barra lateral)\b/);
   return {id,pre:cue?clean.slice(0,cue.index):clean,zone:cue?clean.slice((cue.index??0)+cue[0].length):'',hasCue:Boolean(cue)};
  });
 });
 if(!units.some(unit=>unit.hasCue)) return candidate;
 const suppressedCriteria=new Set<string>();
 const removedIndices=steps.flatMap((step,index)=>{
  const target=step.match(/^\s*(?:Validar|Verificar|Comprobar)\s+que\s+se\s+muestre\s+["“]([^"”]+)["”][.]?\s*$/i)?.[1];
  const label=target?normalized(target):'';
  if(label.length<3) return [];
  const pattern=new RegExp(`(?:^|[^a-z0-9])${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^a-z0-9])`);
  const mentions=units.filter(unit=>pattern.test(unit.pre)||pattern.test(unit.zone));
  if(!mentions.length||mentions.some(unit=>pattern.test(unit.pre)||!unit.hasCue)) return [];
  const backed=mentions.filter(unit=>!unit.id||claims(unit.id));
  if(!backed.length) return [];
  backed.forEach(unit=>unit.id&&suppressedCriteria.add(unit.id));
  return [index];
 });
 if(!removedIndices.length) return candidate;
 const removed=new Set(removedIndices);
 // Fail closed: a criterion whose assertion was suppressed is no longer claimed as covered.
 const suppressedRefs=refs.filter(ref=>[...suppressedCriteria].some(id=>ref===id||ref.startsWith(`${id}.`)));
 const reindex=(items:unknown[]|undefined)=>items?.flatMap(item=>{
  if(!item||typeof item!=='object') return [item];
  const record=item as Record<string,unknown>;
  const stepIndex=Number.isInteger(record.stepIndex)?record.stepIndex as number:undefined;
  if(stepIndex!==undefined&&removed.has(stepIndex-1)) return [];
  const next={...record};
  if(stepIndex!==undefined) next.stepIndex=stepIndex-removedIndices.filter(index=>index<stepIndex-1).length;
  if(Array.isArray(record.stepIndices)) next.stepIndices=record.stepIndices
   .filter((value):value is number=>Number.isInteger(value)&&!removed.has((value as number)-1))
   .map(value=>value-removedIndices.filter(index=>index<value-1).length);
  return [next];
 });
 return {
  ...candidate,
  steps:steps.filter((_,index)=>!removed.has(index)),
  ...(suppressedRefs.length?{
   acceptanceCriteriaRefs:refs.filter(ref=>!suppressedRefs.includes(ref)),
   contextCriteriaRefs:[...new Set([...(Array.isArray(candidate.contextCriteriaRefs)?candidate.contextCriteriaRefs as unknown[]:[]),...suppressedRefs])],
  }:{}),
  ...(Array.isArray(candidate.inputRequirements)?{inputRequirements:reindex(candidate.inputRequirements)}:{}),
  ...(Array.isArray(candidate.unresolvedUiRequirements)?{unresolvedUiRequirements:reindex(candidate.unresolvedUiRequirements)}:{}),
  ...(Array.isArray(candidate.conditionRequirements)?{conditionRequirements:reindex(candidate.conditionRequirements)}:{}),
 };
}

/** Preserve source conditions even when generated prose drops its conditional suffix. */
/**
 * A duplicate-record case presumes an existing record. It must declare that setup, either as an
 * explicit precondition or by creating the record in-journey (same fill step entered twice);
 * otherwise it silently depends on seeded data, so the draft is blocked.
 */
function jiraDuplicateCaseSetupUndeclared(candidate:Record<string,unknown>,steps:string[],issue?:JiraIssueSource):boolean{
 const subject=[candidate.title,candidate.expectedResult].filter(v=>typeof v==='string').join(' ');
 if(!/\b(?:duplicad[oa]s?|duplicate|ya\s+existe|already\s+exists?|existente)\b/i.test(subject))return false;
 const words=(text:string)=>text.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().split(/[^a-z0-9]+/).filter(word=>word.length>=4);
 const isFill=(step:string)=>/^(?:ingresar|escribir|digitar|introducir|completar|llenar|enter|fill|type)\b/i.test(step.trim());
 const fills=steps.filter(isFill);
 const fillWords=new Set(words(fills.join(' ')));
 // A precondition counts only if it declares an existing record AND names something this case enters.
 const preconditions=Array.isArray(candidate.preconditions)?candidate.preconditions.filter((p):p is string=>typeof p==='string'):[];
 if(preconditions.some(p=>/\b(?:existe|existen|existente|registrad[oa]s?|cread[oa]s?|guardad[oa]s?|previamente|exists?|existing|already|seeded|registered)\b/i.test(p)&&words(p).some(word=>fillWords.has(word))))return false;
 // Source-backed fixed literal: the source ties that exact literal to duplicate/already-exists behavior and a fill enters it.
 const sourceSentences=[issue?.description,issue?.acceptanceCriteria].filter(Boolean).join('\n').split(/[\n.!?]+/);
 // Only the value quoted before `en "<campo>"` counts; a quoted field label never establishes setup.
 const filledLiterals=new Set(fills.map(step=>step.match(/["“]([^"”]+)["”]\s+en\s+(?:el\s+)?(?:campo\s+)?["“][^"”]+["”]/i)?.[1]?.toLowerCase()));
 const literalFilled=(literal:string)=>filledLiterals.has(literal.toLowerCase());
 if(sourceSentences.some(sentence=>/\b(?:duplicad[oa]s?|duplicate|ya\s+existe|already\s+exists?|existente)\b/i.test(sentence)
  &&[...sentence.matchAll(/["“]([^"”]+)["”]/g)].some(match=>literalFilled(match[1]))))return false;
 // Unquoted form ("... o el alias Atlas"): the clause ties field+literal to duplicate behavior; the scenario enters it in that field and later asserts the rejection.
 const duplicateWording=/\b(?:duplicad[oa]s?|duplicate|ya\s+existe|already\s+exists?|existente)\b/i;
 if(issue&&jiraAcceptanceClauses(issue).some(clause=>duplicateWording.test(clause.text)&&literalAlternativeBranches(clause.text).some(({field,literal})=>{
  const fillAt=literalFillIndex(steps,field,literal);
  return fillAt>=0&&steps.slice(fillAt+1).some(step=>ASSERT_STEP.test(step)&&duplicateWording.test(step));
 })))return false;
 // In-journey setup: the same fill is saved/submitted, then entered again for the duplicate attempt.
 const isSave=(step:string)=>/^(?:presionar|clic|click|hacer clic|press)\b.*\b(?:guardar|crear|registrar|agregar|a[nñ]adir|enviar|save|create|register|add|submit)\b/i.test(step.trim());
 // Fail closed: the repeat counts only if both steps resolve to the same runtime valueKey (distinct keys = distinct values).
 const fields=deriveJiraInputRequirements(steps,candidate.inputRequirements);
 const valueKeyAt=(index:number)=>fields.find(field=>field.stepIndex===index+1)?.key;
 for(let first=0;first<steps.length;first++){
  if(!isFill(steps[first]))continue;
  const key=steps[first].trim().toLowerCase();
  let saved=false;
  for(let later=first+1;later<steps.length;later++){
   if(isSave(steps[later]))saved=true;
   else if(saved&&isFill(steps[later])&&(steps[later].trim().toLowerCase()===key||valueKeyAt(first)===valueKeyAt(later))){
    const original=valueKeyAt(first);
    if(original&&original===valueKeyAt(later))return false;
   }
  }
 }
 return true;
}

const ASSERT_STEP=/^\s*(?:Validar|Verificar|Comprobar)\b/i;
/** Index of the step entering `literal` into a field labelled with `field`, or -1. */
function literalFillIndex(steps:string[],field:string,literal:string):number{
 return steps.findIndex(step=>{
  // Quoted value, or an exact unquoted value in an explicit fill step ("Ingresar Atlas en "Alias"").
  const fill=step.match(/["“]([^"”]+)["”]\s+en\s+(?:el\s+)?(?:campo\s+)?["“]([^"”]+)["”]/i)
   ??step.match(/^\s*(?:\d+[.)]\s*)?(?:Ingresar|Escribir|Digitar|Introducir)\s+([^"“”]+?)\s+en\s+(?:el\s+)?(?:campo\s+)?["“]([^"”]+)["”]\s*\.?\s*$/i);
  return Boolean(fill)&&normalized(fill![1])===literal&&normalized(fill![2]).split(/[^a-z0-9]+/).includes(field);
 });
}

function repeatsSavedEntryThenRejects(steps:string[],rejection:RegExp):boolean{
 const isFill=(step:string)=>/^(?:ingresar|escribir|digitar|introducir|enter|fill|type)\b/i.test(step.trim());
 const isSave=(step:string)=>/^(?:presionar|clic|click|hacer clic|press)\b.*\b(?:guardar|crear|registrar|agregar|a[nñ]adir|enviar|save|create|register|add|submit)\b/i.test(step.trim());
 return steps.some((first,at)=>{
  if(!isFill(first))return false;
  const save=steps.findIndex((step,index)=>index>at&&isSave(step));
  const repeat=save<0?-1:steps.findIndex((step,index)=>index>save&&step.trim().toLowerCase()===first.trim().toLowerCase());
  return repeat>=0&&steps.slice(repeat+1).some(step=>ASSERT_STEP.test(step)&&rejection.test(step));
 });
}

/**
 * Add the literal-branch ref (AC4.1.2) a scenario demonstrably exercises: the source literal is entered in
 * its field and a duplicate-wording assertion follows. The form-stays-open ref (AC4.2) is added only for an
 * explicit open-state assertion naming the clause subject. Never from the title; never AC4.1 from form-open.
 */
export function repairSourceBackedLiteralBranchClaims<T extends Record<string, unknown>>(candidate: T, issue?: JiraIssueSource): T {
 const steps=Array.isArray(candidate.steps)?candidate.steps.filter((step):step is string=>typeof step==='string'):[];
 const refs=Array.isArray(candidate.acceptanceCriteriaRefs)?candidate.acceptanceCriteriaRefs.filter((ref):ref is string=>typeof ref==='string'):[];
 if(!issue||!steps.length)return candidate;
 const upper=(ref:string)=>ref.toUpperCase();
 const added:string[]=[];
 const duplicateWording=/\b(?:duplicad[oa]s?|duplicate|ya\s+existe|already\s+exists?|existente)\b/i;
 for(const clause of jiraAcceptanceClauses(issue)){
  const alternatives=literalAlternativeBranches(clause.text);
  if(alternatives.length&&duplicateWording.test(clause.text)&&!refs.some(ref=>upper(ref).startsWith(`${clause.id}.`))){
   const hits=alternatives.filter(({field,literal})=>{
    const fillAt=literalFillIndex(steps,field,literal);
    return fillAt>=0&&steps.slice(fillAt+1).some(step=>ASSERT_STEP.test(step)&&duplicateWording.test(step));
   });
   // One journey per alternative: an ambiguous scenario claims neither.
   if(hits.length===1)added.push(`${clause.id}.${hits[0].branch}`);
   // First (non-literal) alternative: claimed only when the journey itself creates the record, saves, repeats the identical entry and asserts the rejection.
   else if(!hits.length&&!alternatives.some(({field,literal})=>literalFillIndex(steps,field,literal)>=0)&&repeatsSavedEntryThenRejects(steps,duplicateWording))added.push(`${clause.id}.1`);
  }
  if(/\b(?:permanece|sigue|queda|remains?|stays?)\s+(?:abiert[oa]|open)\b/i.test(clause.text)&&!refs.some(ref=>upper(ref)===clause.id)){
   const subject=new Set(normalized(clause.text).split(/[^a-z0-9]+/).filter(word=>word.length>=5&&!/^(?:permanece|abiert[oa]|sigue|queda|remains?|stays?)$/.test(word)));
   if(steps.some(step=>ASSERT_STEP.test(step)&&/\b(?:abiert[oa]|open)\b/i.test(step)&&normalized(step).split(/[^a-z0-9]+/).some(word=>subject.has(word))))added.push(clause.id);
  }
 }
 return added.length?{...candidate,acceptanceCriteriaRefs:[...refs,...added]}:candidate;
}

/**
 * A clause that lists alternatives ("X o el <campo> <Literal>") is covered by branch refs
 * `<clauseId>.<N>` (AC4.1.1, AC4.1.2). A literal branch ref is supported only by a scenario that fills
 * that literal into that field and asserts afterwards, and never together with a sibling branch of the
 * same clause (each alternative needs its own journey).
 */
function jiraUnsupportedLiteralBranchRefs(candidate:Record<string,unknown>,steps:string[],issue?:JiraIssueSource):string[]{
 const refs=Array.isArray(candidate.acceptanceCriteriaRefs)?candidate.acceptanceCriteriaRefs.filter((ref):ref is string=>typeof ref==='string'):[];
 if(!refs.length||!issue)return [];
 const unsupported=new Set<string>();
 const upper=(ref:string)=>ref.toUpperCase();
 const drop=(id:string)=>refs.filter(ref=>upper(ref)===id).forEach(ref=>unsupported.add(ref));
 for(const clause of jiraAcceptanceClauses(issue)){
  const alternatives=literalAlternativeBranches(clause.text);
  if(alternatives.length){
   drop(clause.id); // the bare clause ref cannot stand in for a branch
   for(const {branch,field,literal} of alternatives){
    const full=`${clause.id}.${branch}`;
    if(!refs.some(ref=>upper(ref)===full))continue;
    const fillAt=literalFillIndex(steps,field,literal);
    const asserted=fillAt>=0&&steps.slice(fillAt+1).some(step=>ASSERT_STEP.test(step));
    const mixed=refs.some(ref=>upper(ref).startsWith(`${clause.id}.`)&&upper(ref)!==full);
    if(!asserted||mixed)drop(full);
   }
  }
  // A "stays open" clause is claimed only by a scenario asserting that open state on the clause's own subject.
  if(/\b(?:permanece|sigue|queda|remains?|stays?)\s+(?:abiert[oa]|open)\b/i.test(clause.text)){
   const subject=new Set(normalized(clause.text).split(/[^a-z0-9]+/).filter(word=>word.length>=5));
   const openAsserted=steps.some(step=>ASSERT_STEP.test(step)&&/\b(?:abiert[oa]|open)\b/i.test(step)&&normalized(step).split(/[^a-z0-9]+/).some(word=>subject.has(word)));
   if(!openAsserted)drop(clause.id);
  }
 }
 return [...unsupported];
}

/** Fail closed: drop a claim on a literal-specific alternative the steps do not exercise; the criterion stays uncovered. */
export function repairUnsupportedLiteralBranchClaims<T extends Record<string, unknown>>(candidate: T, issue?: JiraIssueSource): T {
 const steps=Array.isArray(candidate.steps)?candidate.steps.filter((step):step is string=>typeof step==='string'):[];
 const unsupported=jiraUnsupportedLiteralBranchRefs(candidate,steps,issue);
 if(!unsupported.length)return candidate;
 return {...candidate,acceptanceCriteriaRefs:(candidate.acceptanceCriteriaRefs as unknown[]).filter(ref=>!unsupported.includes(ref as string))};
}

export function jiraGenerationContractErrors(candidate: Record<string,unknown>, issue?: JiraIssueSource): string[] {
 const steps=Array.isArray(candidate.steps)?candidate.steps.filter((s):s is string=>typeof s==='string'):[];
 const errors:string[]=[];
 const references=Array.isArray(candidate.acceptanceCriteriaRefs)?candidate.acceptanceCriteriaRefs:[];
 for(const requirement of jiraSourceConditions(candidate,issue)) {
  const criterion=requirement.key.split(':',1)[0];
  const claimsCriterion=references.some(ref=>typeof ref==='string'&&(ref===criterion||ref.startsWith(`${criterion}.`)));
  if(claimsCriterion&&!requirement.stepIndices.length) errors.push('JIRA_CONDITION_ASSERTION_MISSING');
 }
 const fields=deriveJiraInputRequirements(steps,candidate.inputRequirements);
 // An explicitly source-named access verification screen belongs before a
 // successful access-code submission, not after that submission has finished.
 const source=[issue?.description,issue?.acceptanceCriteria].filter(Boolean).join(' ');
 const accessStage=source.match(/(?:muestra|presenta|shows?|displays?)\s+(?:(?:la|una|the)\s+)?(?:pantalla\s+de\s+)?(verificaci[oó]n de usuario|user verification)/i)?.[1];
 if(accessStage){
  const stage=normalized(accessStage);
  const accessFields=fields.filter(field=>field.operation==='fill'&&!['invalid','expired'].includes(field.dataCondition??'')&&/c[oó]digo.*acceso|access code/i.test(field.label));
  const misplaced=accessFields.some(field=>steps.some((step,index)=>index>field.stepIndex&&/^\s*(?:Validar|Verificar)\b/i.test(step)&&normalized(step).includes(stage)
   &&steps.slice(field.stepIndex,index).some(action=>/^\s*(?:Presionar|Pulsar|Press)\b/i.test(action))));
  if(misplaced)errors.push('JIRA_AUTH_STAGE_ORDER_INVALID');
 }
 const compositeFieldAction=steps.some(step=>{
  const action=/^(?:completar|llenar|ingresar|introducir|seleccionar|fill|enter|select)\b/i.test(step);
  return action&&/(?:individualmente\s+(?:los|las)\s+(?:\w+\s+)?(?:campos|documentos|declaraciones|entradas|controles)|\b(?:todos|todas|cada)\s+(?:los\s+|las\s+)?(?:campos|documentos|declaraciones|entradas|controles)\b|\b(?:los|las)\s+(?:datos|campos|documentos|consentimientos|declaraciones)\b|\b(?:todos los campos|cada campo|los campos requeridos)\b)/i.test(step);
 });
 if(compositeFieldAction) errors.push('JIRA_COMPOSITE_STEP_REQUIRES_EXPLICIT_ACTIONS');
 const outcome=[candidate.title,candidate.expectedResult].filter(v=>typeof v==='string').join(" ");
 const intentionalBlankField=steps.some(step=>parseStepIntent(step).some(intent=>intent.type==='action_fill'&&intent.actionVerb==='clear'&&Boolean(intent.actionTarget)));
 const fieldValidation=steps.some(step=>parseStepIntent(step).some(intent=>intent.type==='assertion'&&intent.canonicalAssertion?.intent==='validation_present'&&/\b(?:campo|field)\b/i.test(step)));
 const sourceAllowsIncompleteField=/(?:incomplet|campo requerido|field required|dejar.{0,20}vac[ií]o|leave.{0,20}blank)/i.test([issue?.description,issue?.acceptanceCriteria].join(' '));
 const incompleteFieldSubmit=sourceAllowsIncompleteField&&fieldValidation&&steps.some((step,index)=>parseStepIntent(step).some(intent=>
  ['action_click','action_press','action_submit','action_select'].includes(intent.type)
   && /^(?:continuar|siguiente|enviar|submit|continue|next)$/i.test(intent.actionTarget ?? ''))
  && steps.slice(index+1).some(next=>parseStepIntent(next).some(intent=>intent.type==='assertion'&&intent.canonicalAssertion?.intent==='validation_present')));
 if (/(?:no (?:se )?complet|not complet|incomplet|unsuccessful)/i.test(outcome)
  && !fields.some(field=>field.dataCondition==='invalid'||field.dataCondition==='expired')
  && !(intentionalBlankField&&fieldValidation&&sourceAllowsIncompleteField)
  && !incompleteFieldSubmit) errors.push("JIRA_FAILURE_SETUP_UNSPECIFIED");
 if(jiraUiObservations(candidate).some(observation=>!isJiraStepAutoResolvable(steps[observation.stepIndex-1] ?? ""))) errors.push("JIRA_UI_OBSERVATION_REQUIRED");
 if(jiraRepeatedAssertionBlocks(steps).length) errors.push("JIRA_REPEATED_ASSERTION_BLOCK");
 if(jiraDuplicateCaseSetupUndeclared(candidate,steps,issue)) errors.push("JIRA_DUPLICATE_CASE_SETUP_UNDECLARED");
 if(jiraUnsupportedLiteralBranchRefs(candidate,steps,issue).length) errors.push("JIRA_LITERAL_BRANCH_CLAIM_UNSUPPORTED");
 if(jiraUnbackedFilterSubmitIndices(steps,issue).length||jiraReactiveFilterResultMissing(steps,issue)) errors.push("JIRA_FILTER_RESULT_EVIDENCE_MISSING");
 if(jiraFilterResultFixtureMissing(candidate,steps)) errors.push("JIRA_FILTER_TEST_DATA_UNSPECIFIED");
 errors.push(...jiraRowFormContractErrors(candidate,issue));
 return [...new Set(errors)];
}

/** Only structured, bounded observations cross the Jira response boundary. */
export function jiraUiObservations(candidate: Record<string, unknown>): Array<{stepIndex:number;requirement:string}> {
 const steps=Array.isArray(candidate.steps)?candidate.steps:[];
 if(!Array.isArray(candidate.unresolvedUiRequirements)) return [];
 return candidate.unresolvedUiRequirements.flatMap(item=>{
  if(!item || typeof item!=='object') return [];
  const {stepIndex,requirement}=item as Record<string,unknown>;
  return Number.isInteger(stepIndex) && (stepIndex as number)>0 && (stepIndex as number)<=steps.length && typeof requirement==='string' && requirement.trim()
   ? [{stepIndex:stepIndex as number,requirement:requirement.trim().slice(0,500)}] : [];
 }).slice(0,steps.length);
}
