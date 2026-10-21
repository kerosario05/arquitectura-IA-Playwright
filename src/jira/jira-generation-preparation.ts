import type {JiraIssueSource} from '../scenarios/scenario-types';
import {deriveJiraInputRequirements} from './jira-input-requirements';
import {jiraSourceConditions} from './jira-generation-contract';
import {parseStepIntent} from '../discovery/step-intent-parser';

type Draft=Record<string,unknown>;
function removeRedundantDynamicRowAssertions(draft:Draft,issue:JiraIssueSource):Draft{
 const steps=stepsOf(draft);
 const source=[issue.description,issue.acceptanceCriteria].filter(Boolean).join('\n');
 if(!/\b(?:agregar|agrega|añadir|anadir|add)\b[\s\S]{0,120}\b(?:fila|row)\b[\s\S]{0,120}\b(?:inicialmente\s+)?(?:vac[ií]a|empty)\b/i.test(source))return draft;
 const removed=new Set<number>();
 steps.forEach((step,index)=>{
  if(!/^\s*(?:Validar|Verificar)\b/i.test(step)||!/(?:fila|row)/i.test(step)||!/(?:segunda|second|disponible|visible|vac[ií]a|agregad[ao]|available|empty)/i.test(step))return;
  const laterRowAction=steps.slice(index+1).some(candidate=>parseStepIntent(candidate).some(intent=>
   ['action_fill','action_select'].includes(intent.type)&&/(?:segunda|second|fila\s*2|row\s*2)/i.test(`${candidate} ${intent.actionTarget??''}`)));
  if(laterRowAction)removed.add(index);
 });
 if(!removed.size)return draft;
 const reindex=(items:unknown, dropRemoved:boolean)=>Array.isArray(items)?items.flatMap(item=>{
  if(!item||typeof item!=='object'||!Number.isInteger((item as Record<string,unknown>).stepIndex))return [item];
  const record=item as Record<string,unknown>;const index=(record.stepIndex as number)-1;
  if(dropRemoved&&removed.has(index))return [];
  return [{...record,stepIndex:(record.stepIndex as number)-[...removed].filter(value=>value<index).length}];
 }):items;
 return {...draft,steps:steps.filter((_step,index)=>!removed.has(index)),
  ...(Array.isArray(draft.inputRequirements)?{inputRequirements:reindex(draft.inputRequirements,true)}:{}),
  ...(Array.isArray(draft.unresolvedUiRequirements)?{unresolvedUiRequirements:reindex(draft.unresolvedUiRequirements,true)}:{})};
}

function rowOrdinal(text:string):1|2|undefined{
 const value=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/\b(?:primera\s+fila|fila\s*(?:n(?:um(?:ero)?)?\s*)?1|first\s+row|row\s*1)\b/.test(value))return 1;
 if(/\b(?:segunda\s+fila|fila\s*(?:n(?:um(?:ero)?)?\s*)?2|second\s+row|row\s*2)\b/.test(value))return 2;
 return undefined;
}

function rowEntityTokens(text:string):string[]{
 const ignored=new Set(['agregar','agrega','anadir','add','fila','row','primera','segunda','first','second','de','del','la','el','en','una','un','tipo','importe','monto','frecuencia','amount','frequency','type','monthly']);
 return text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)?.filter(token=>!ignored.has(token)).map(token=>token.length>4&&token.endsWith('s')?token.slice(0,-1):token)??[];
}

/** Remove an add-row action that contradicts an explicitly ordered, already-present first row. */
function removePrematureSecondRowAdd(draft:Draft,issue:JiraIssueSource):Draft{
 const source=[issue.description,issue.acceptanceCriteria].filter(Boolean).join('\n').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const sourceDefinesOrder=/(?:primera\s+fila|fila\s*1|first\s+row)[\s\S]{0,500}(?:agregar|agrega|anadir|add)[\s\S]{0,180}(?:segunda\s+fila|fila\s*2|second\s+row)/.test(source);
 if(!sourceDefinesOrder)return draft;
 const steps=stepsOf(draft);
 const removed=new Set<number>();
 const rowActions=steps.map((step,index)=>{
  const intent=parseStepIntent(step).find(item=>item.type==='action_fill'||item.type==='action_select');
  const ordinal=rowOrdinal(`${step} ${intent?.actionTarget??''}`);
  return intent&&ordinal?{index,ordinal,tokens:rowEntityTokens(`${step} ${intent.actionTarget??''}`)}:undefined;
 }).filter((item):item is NonNullable<typeof item>=>Boolean(item));
 const addActions=steps.map((step,index)=>{
  const intent=parseStepIntent(step).find(item=>item.type==='action_click'||item.type==='action_press');
  return intent&&/^(?:agregar|agrega|anadir|add)\b/i.test(intent.actionTarget??'')
   ?{index,tokens:rowEntityTokens(intent.actionTarget??'')}:undefined;
 }).filter((item):item is NonNullable<typeof item>=>Boolean(item));
 for(const add of addActions){
  const laterFirstRow=rowActions.find(action=>action.index>add.index&&action.ordinal===1&&add.tokens.some(token=>action.tokens.includes(token)));
  if(laterFirstRow)removed.add(add.index);
 }
 if(!removed.size)return draft;
 const reindex=(items:unknown)=>Array.isArray(items)?items.flatMap(item=>{
  if(!item||typeof item!=='object'||!Number.isInteger((item as Record<string,unknown>).stepIndex))return [item];
  const record=item as Record<string,unknown>;const index=(record.stepIndex as number)-1;
  if(removed.has(index))return [];
  return [{...record,stepIndex:(record.stepIndex as number)-[...removed].filter(value=>value<index).length}];
 }):items;
 return {...draft,steps:steps.filter((_step,index)=>!removed.has(index)),
  ...(Array.isArray(draft.inputRequirements)?{inputRequirements:reindex(draft.inputRequirements)}:{}),
  ...(Array.isArray(draft.unresolvedUiRequirements)?{unresolvedUiRequirements:reindex(draft.unresolvedUiRequirements)}:{})};
}
export function sourceHasControlledInputFailure(issue?:JiraIssueSource):boolean{
 return /(?:no\s+(?:(?:es|son|sea|sean|est[aá]n?)\s+)?v[aá]lid|inv[aá]lid|incorrect|expirad|vencid|invalid|expired)/i.test([issue?.description,issue?.acceptanceCriteria].join(' '));
}
function stepsOf(draft:Draft):string[]{return Array.isArray(draft.steps) ? draft.steps.filter((step):step is string=>typeof step==='string') : [];}
function removesDuplicateAuthFlow(draft:Draft):Draft{
 if(draft.authIntent!=="full_authentication") return draft;
 const steps=stepsOf(draft).join(" ").toLocaleLowerCase("es");
 const identifier=/\b(?:rnc|c[eé]dula|identificaci[oó]n|documento)\b/.test(steps);
 const username=/\b(?:usuario|username)\b/.test(steps);
 const password=/\b(?:contrase[nñ]a|password|clave)\b/.test(steps);
 const submit=/\b(?:iniciar sesi[oó]n|acceder|sign in|log in|login)\b/.test(steps);
 return identifier&&username&&password&&submit ? {...draft,authIntent:undefined} : draft;
}
function negativeTargets(draft:Draft):string[]{return stepsOf(draft).flatMap(step=>{const match=step.match(/^Validar que no se muestre ["“]([^"”]+)["”][.]?$/i);return match ? [match[1]] : [];});}
function failureFields(draft:Draft){return deriveJiraInputRequirements(stepsOf(draft),draft.inputRequirements).filter(field=>field.dataCondition==='invalid'||field.dataCondition==='expired');}
function stepIdentity(step:string):string{
 const intents=parseStepIntent(step);
 if(intents.length!==1 || intents[0].type==='unknown') return step;
 const intent=intents[0];
 return JSON.stringify([intent.type,intent.actionTarget,intent.type==='action_press'?intent.value:undefined,intent.type==='assertion' && /^Validar que no /i.test(step)]);
}
function retainsSteps(original:string[],replacement:string[]):boolean{
 let offset=0;
 for(const step of replacement) if(offset<original.length && stepIdentity(step)===stepIdentity(original[offset])) offset++;
 return offset===original.length;
}

/** Normalize only source-backed conditional subjects, without deleting real UI text. */
function conditionalTargets(draft:Draft,issue:JiraIssueSource):Draft {
 const source=[issue.description,issue.acceptanceCriteria].filter(Boolean).join('\n');
 const normalized=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const literalLabels=[...source.matchAll(/["“]([^"”]+)["”]/g)].map(match=>normalized(match[1]));
 const negativeClauses=source.split(/[.!?\n]/).filter(clause=>/\b(?:no|tampoco|sin|not|without)\b/i.test(clause)).map(normalized);
 const original=stepsOf(draft).map(step=>{
  const match=step.match(/^(?:Validar|Verificar) que se (?:muestre|muestren) ["“]((?:(?:la|the)\s+)?(?:ausencia de|absence of)\s+([^"”]+))["”][.]?$/i);
  return match && !literalLabels.includes(normalized(match[1])) && negativeClauses.some(clause=>clause.includes(normalized(match[2])))
   ? `Validar que no se muestre "${match[2]}"` : step;
 });
 const proposed=original.map(step=>step.replace(/^((?:Validar|Verificar) que se (?:muestre|muestren) ["“])([^"”]+?)\s+(?:cuando aplique|si aplica|when applicable|if applicable)(["”][.]?)$/i,'$1$2$3'));
 const requirements=jiraSourceConditions({...draft,steps:proposed},issue);
 let result:Draft={...draft,steps:original.map((step,index)=>requirements.some(requirement=>requirement.stepIndices.includes(index+1)) ? proposed[index] : step)};
 // Add a missing source subject only beside a unique assertion naming its own
 // acceptance-criterion stage. No guessed business position or UI locator.
 for(const requirement of jiraSourceConditions(result,issue).filter(item=>!item.stepIndices.length)) {
  const criterion=requirement.key.split(':')[0];
  const heading=[...source.matchAll(/(?:^|\n)(AC\d+)\s*[—–:-]\s*([^\n]+)/gi)].find(match=>match[1].toUpperCase()===criterion)?.[2].trim();
  if(!heading) continue;
  const steps=stepsOf(result);
  const anchors=steps.flatMap((step,index)=>{
   const target=step.match(/^Validar que se muestre ["“]([^"”]+)["”][.]?$/i)?.[1];
   return target && normalized(target).includes(normalized(heading)) ? [index+1] : [];
  });
  if(anchors.length!==1) continue;
  const offset=anchors[0];
  const updated=[...steps.slice(0,offset),`Validar que se muestre "${requirement.subject}"`,...steps.slice(offset)];
  const remap=(items:unknown)=>Array.isArray(items)?items.map(item=>item && typeof item==='object' && typeof item.stepIndex==='number' ? {...item,stepIndex:item.stepIndex>offset?item.stepIndex+1:item.stepIndex} : item):items;
  result={...result,steps:updated,inputRequirements:remap(result.inputRequirements),unresolvedUiRequirements:remap(result.unresolvedUiRequirements)};
 }
 return result;
}

/** A declared failure case can supply its same-source input action to an incomplete case. */
function controlledSetup(draft:Draft,peers:Draft[],issue:JiraIssueSource):Draft {
 if(!/(?:no (?:se )?complet|not complet|incomplet|unsuccessful)/i.test([draft.title,draft.expectedResult].join(' ')) || failureFields(draft).length) return draft;
 if(!sourceHasControlledInputFailure(issue)) return draft;
 const targets=negativeTargets(draft);
 if(!targets.length) return draft;
 const steps=stepsOf(draft);
 const fields=deriveJiraInputRequirements(steps,draft.inputRequirements);
 const options=peers.filter(peer=>peer!==draft && peer.sourceIssueKey===draft.sourceIssueKey && negativeTargets(peer).some(target=>targets.includes(target))).flatMap(peer=>failureFields(peer).flatMap(failure=>{
  const matches=fields.filter(field=>field.label===failure.label && field.operation===failure.operation);
  const sourceStep=stepsOf(peer)[failure.stepIndex-1];
  // A generated skeleton with navigation/absence only has no input to match.
  // Supply its complete, same-source rejection journey only when every existing
  // step remains represented; never substitute a journey containing other actions.
  const skeleton=!fields.length && steps.every(step=>{
   const intents=parseStepIntent(step);
   return /^Abrir la aplicación configurada del proyecto[.]?$/i.test(step) || (intents.length===1 && intents[0].type==='assertion');
  });
  return (matches.length===1 || skeleton) && sourceStep && [...sourceStep.matchAll(/["“]([^"”]+)["”]/g)].length===1 && retainsSteps(steps,stepsOf(peer))
   ? [{index:matches[0]?.stepIndex ?? failure.stepIndex,step:sourceStep,peer}] : [];
 }));
 if(!options.length) return draft;
 const latest=Math.max(...options.map(option=>option.index));
 const selected=options.filter(option=>option.index===latest);
 if(new Set(selected.map(option=>JSON.stringify([option.step,option.peer.steps,option.peer.preconditions]))).size!==1) return draft;
 const peer=selected[0].peer;
 const updated=stepsOf(peer);
 return {...draft,steps:updated,preconditions:peer.preconditions,authIntent:peer.authIntent,
  unresolvedUiRequirements:peer.unresolvedUiRequirements,inputRequirements:deriveJiraInputRequirements(updated,peer.inputRequirements)};
}

/** Replace a grouped journey in a source-backed negative case with its peer's explicit positive path. */
function expandCompositeFailureJourney(draft:Draft,peers:Draft[],issue:JiraIssueSource):Draft{
 const failures=failureFields(draft);
 if(failures.length!==1||!sourceHasControlledInputFailure(issue))return draft;
 const failure=failures[0];
 const negativeSteps=stepsOf(draft);
 const failureIndex=failure.stepIndex-1;
 if(failureIndex<0||negativeSteps.slice(0,failureIndex).every(step=>parseStepIntent(step).every(intent=>intent.type!=='unknown'&&intent.type!=='composite_action')))return draft;
 const normalizedLabel=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
 const donors=peers.filter(peer=>peer!==draft&&peer.sourceIssueKey===draft.sourceIssueKey&&!failureFields(peer).length
  &&stepsOf(peer).some(step=>/^Validar que se muestre\b/i.test(step))&&!!(peer.expectedResult as string|undefined)?.trim()).flatMap(peer=>{
   const positiveSteps=stepsOf(peer);
   const matchingFields=deriveJiraInputRequirements(positiveSteps,peer.inputRequirements).filter(field=>field.operation===failure.operation&&normalizedLabel(field.label)===normalizedLabel(failure.label));
   if(matchingFields.length!==1)return [];
   const positiveInputIndex=matchingFields[0].stepIndex-1;
   const prefix=positiveSteps.slice(0,positiveInputIndex);
   const suffix=negativeSteps.slice(failureIndex);
   const parsedFailure=parseStepIntent(suffix[0]??'');
   const submits=suffix.slice(1).some(step=>parseStepIntent(step).some(intent=>['action_click','action_press','action_submit'].includes(intent.type)));
   const hasOutcome=suffix.slice(1).some(step=>parseStepIntent(step).some(intent=>intent.type==='assertion'));
   const prefixIsExecutable=prefix.length>0&&/^Abrir la aplicación configurada del proyecto\.?$/i.test(prefix[0])
    &&prefix.every(step=>parseStepIntent(step).length>0&&parseStepIntent(step).every(intent=>intent.type!=='unknown'&&intent.type!=='composite_action'));
   if(!prefixIsExecutable||parsedFailure.length!==1||!['action_fill','action_select'].includes(parsedFailure[0].type)||!submits||!hasOutcome)return [];
   return [{peer,positiveSteps,prefix,suffix,positiveInputIndex}];
  });
 if(donors.length!==1)return draft;
 const donor=donors[0];
 const steps=[...donor.prefix,...donor.suffix];
 const prefixInputs=deriveJiraInputRequirements(donor.positiveSteps,donor.peer.inputRequirements).filter(field=>field.stepIndex<=donor.positiveInputIndex);
 const suffixInputs=deriveJiraInputRequirements(negativeSteps,draft.inputRequirements).filter(field=>field.stepIndex>=failureIndex+1).map(field=>({...field,stepIndex:field.stepIndex-failureIndex+donor.prefix.length}));
 const inputRequirements=[...prefixInputs,...suffixInputs];
 const prefixUnresolved=Array.isArray(donor.peer.unresolvedUiRequirements)?donor.peer.unresolvedUiRequirements.filter(item=>item&&typeof item==='object'&&Number.isInteger((item as Record<string,unknown>).stepIndex)&&(item as Record<string,number>).stepIndex<=donor.positiveInputIndex).map(item=>({...item as Record<string,unknown>})):[];
 const suffixUnresolved=Array.isArray(draft.unresolvedUiRequirements)?draft.unresolvedUiRequirements.filter(item=>item&&typeof item==='object'&&Number.isInteger((item as Record<string,unknown>).stepIndex)&&(item as Record<string,number>).stepIndex>=failureIndex+1).map(item=>({...item as Record<string,unknown>,stepIndex:(item as Record<string,number>).stepIndex-failureIndex+donor.prefix.length})):[];
 return {...draft,steps,preconditions:[],inputRequirements,unresolvedUiRequirements:[...prefixUnresolved,...suffixUnresolved],...(donor.peer.authIntent?{authIntent:donor.peer.authIntent}:{authIntent:undefined})};
}

/** Keep context criteria separate from claims this negative journey actually checks. */
function contextCriteria(draft:Draft,issue:JiraIssueSource):Draft {
 if(!failureFields(draft).length || !Array.isArray(draft.acceptanceCriteriaRefs)) return draft;
 const unasserted=jiraSourceConditions(draft,issue).filter(requirement=>!requirement.stepIndices.length).map(requirement=>requirement.key.split(':')[0]);
 const context=draft.acceptanceCriteriaRefs.filter((ref):ref is string=>typeof ref==='string' && unasserted.some(criterion=>ref===criterion || ref.startsWith(criterion+'.')));
 if(!context.length) return draft;
 return {...draft,acceptanceCriteriaRefs:draft.acceptanceCriteriaRefs.filter(ref=>!context.includes(String(ref))),contextCriteriaRefs:[...new Set([...(Array.isArray(draft.contextCriteriaRefs)?draft.contextCriteriaRefs:[]),...context])]};
}

function dropSteps(draft:Draft,removed:Set<number>):Draft{
 const reindex=(items:unknown)=>Array.isArray(items)?items.flatMap(item=>{
  if(!item||typeof item!=='object'||!Number.isInteger((item as Record<string,unknown>).stepIndex))return [item];
  const record=item as Record<string,unknown>;const index=(record.stepIndex as number)-1;
  if(removed.has(index))return [];
  return [{...record,stepIndex:(record.stepIndex as number)-[...removed].filter(value=>value<index).length}];
 }):items;
 const shift=(value:number)=>value-[...removed].filter(index=>index<value-1).length;
 // Condition requirements keep their entry but lose/shift the step indices they point at.
 const reindexConditions=(items:unknown)=>Array.isArray(items)?items.map(item=>{
  if(!item||typeof item!=='object'||!Array.isArray((item as Record<string,unknown>).stepIndices))return item;
  const record=item as Record<string,unknown>;
  return {...record,stepIndices:(record.stepIndices as unknown[]).filter((value):value is number=>Number.isInteger(value)&&!removed.has((value as number)-1)).map(shift)};
 }):items;
 return {...draft,steps:stepsOf(draft).filter((_step,index)=>!removed.has(index)),
  ...(Array.isArray(draft.inputRequirements)?{inputRequirements:reindex(draft.inputRequirements)}:{}),
  ...(Array.isArray(draft.unresolvedUiRequirements)?{unresolvedUiRequirements:reindex(draft.unresolvedUiRequirements)}:{}),
  ...(Array.isArray(draft.conditionRequirements)?{conditionRequirements:reindexConditions(draft.conditionRequirements)}:{})};
}

const norm=(text:string)=>text.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
// Generic navigation wording only; says nothing about any destination.
const NAV_FILLER=new Set(['navegar','navigate','por','la','el','los','las','de','del','a','al','hacia','to','the','ruta','route','pantalla','screen','seccion','section','menu','opcion','option','path']);
const destinationTerms=(text:string)=>norm(text).split(/[^a-z0-9]+/).filter(term=>term.length>=4&&!NAV_FILLER.has(term));

/**
 * The app-profile slug is routing context already covered by "Abrir la aplicación configurada",
 * not a UI control; an untargeted login step under full_authentication duplicates the auth flow
 * and names no control Discovery could resolve.
 */
function removeNonUiSetupSteps(draft:Draft,appSlug?:string):Draft{
 const removed=new Set<number>();
 stepsOf(draft).forEach((step,index)=>{
  const profile=step.match(/^\s*(?:Seleccionar|Elegir|Escoger|Select)\s+(?:el\s+|the\s+)?perfil\b[^"“]*["“]([^"”]+)["”][.]?\s*$/i)?.[1];
  if(appSlug&&profile&&profile.trim().toLowerCase()===appSlug.toLowerCase())removed.add(index);
  else if(draft.authIntent==='full_authentication'&&(
   (!/["“]/.test(step)&&/^\s*(?:Iniciar sesi[oó]n|Autenticarse|Log in|Sign in)\b/i.test(step))
   // Generic "do the login actions until reaching X": names no control; the quoted X is a destination, not a target.
   ||/^\s*(?:Realizar|Ejecutar|Completar|Perform|Complete)\s+(?:las?\s+|the\s+)?(?:acciones|pasos|actions|steps)\b[^"“]*(?:inicio de sesi[oó]n|autenticaci[oó]n|login|sign[- ]in)/i.test(step)
   // Fill of a field whose exact label is the login access code: auth flow already enters it.
   ||/^\s*(?:Completar|Ingresar|Escribir|Fill|Enter)\b[^"“]*["“]\s*(?:c[oó]digo de acceso(?: de)? (?:inicio de sesi[oó]n|login)|login access code)\s*["”]/i.test(step)))removed.add(index);
 });
 return removed.size?dropSteps(draft,removed):draft;
}

/**
 * Unquoted "Navegar ..." prose parses as `unknown` and is not executable. Drop it only when a later
 * explicit action's quoted target shares a meaningful destination term with the prose (it demonstrably
 * reaches the same destination); otherwise keep it so the validator still blocks the candidate.
 */
function removeRedundantNavigationProse(draft:Draft):Draft{
 const steps=stepsOf(draft);
 const removed=new Set<number>();
 steps.forEach((step,index)=>{
  if(/["“”]|https?:\/\/|\//.test(step)||!/^\s*(?:navegar|navigate|ir a|go to)\b/i.test(step))return;
  const own=parseStepIntent(step);
  if(own.length!==1||own[0].type!=='unknown')return;
  const terms=destinationTerms(step);
  if(!terms.length)return;
  const reached=steps.slice(index+1).some(later=>{
   if(!/["“][^"”]+["”]/.test(later))return false;
   const intents=parseStepIntent(later);
   const target=intents.length===1&&intents[0].type.startsWith('action_')?intents[0].actionTarget:undefined;
   return !!target&&destinationTerms(target).some(term=>terms.includes(term));
  });
  if(reached)removed.add(index);
 });
 return removed.size?dropSteps(draft,removed):draft;
}

/**
 * A repair may insert/remove steps without reindexing unresolvedUiRequirements. When the provider
 * echoed the original list unchanged, move each item to the identical step it described; items
 * whose step no longer exists are dropped (the replacement step is re-validated on its own).
 */
export function realignRepairedUi(original:Draft,repaired:Draft):Draft{
 const before=stepsOf(original),after=stepsOf(repaired);
 const unresolved=repaired.unresolvedUiRequirements;
 if(!Array.isArray(unresolved)||JSON.stringify(before)===JSON.stringify(after)
  ||JSON.stringify(unresolved)!==JSON.stringify(original.unresolvedUiRequirements))return repaired;
 const map=new Map<number,number>();
 let from=0;
 before.forEach((step,index)=>{const found=after.indexOf(step,from);if(found>=0){map.set(index+1,found+1);from=found+1;}});
 return {...repaired,unresolvedUiRequirements:unresolved.flatMap(item=>{
  const mapped=item&&typeof item==='object'?map.get((item as Record<string,unknown>).stepIndex as number):undefined;
  return mapped?[{...item as Record<string,unknown>,stepIndex:mapped}]:[];
 })};
}

export type AccessSubmitTransition={fillLabel:string;clickLabel:string};
const labelKey=(text:string)=>text.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
// Login/verification access code only; a bare transactional "token" is not matched.
const ACCESS_CODE_LABEL=/\b(?:c[oó]digo|code|otp|sms)\b|\btoken\b[^"“]{0,20}\b(?:acceso|access|sms|otp|verific\w*|login|sesi[oó]n)|\b(?:acceso|access|sms|otp|verific\w*|login|sesi[oó]n)\b[^"“]{0,20}\btoken\b/i;

/** fill(label) immediately followed by click(label) in an observed route; a fill label with several different submits is ambiguous and dropped. */
export function observedAccessSubmitTransitions(routes:Array<{actions:Array<{action:string;field?:string}>}>):AccessSubmitTransition[]{
 const byFill=new Map<string,Set<string>>();const labels=new Map<string,AccessSubmitTransition>();
 for(const route of routes)route.actions.forEach((action,index)=>{
  const next=route.actions[index+1];
  if(action.action!=='fill'||!action.field||!ACCESS_CODE_LABEL.test(action.field)||next?.action!=='click'||!next.field)return;
  const key=labelKey(action.field);
  byFill.set(key,(byFill.get(key)??new Set()).add(labelKey(next.field)));
  labels.set(key,{fillLabel:action.field,clickLabel:next.field});
 });
 return [...labels].filter(([key])=>byFill.get(key)!.size===1).map(([,value])=>value);
}

/** Submit an access-code fill with the observed control before the first functional step; never invents a control. */
function insertObservedAccessSubmit(draft:Draft,transitions:AccessSubmitTransition[]):Draft{
 if(!transitions.length||draft.authIntent==='gate_observation')return draft;
 let result=draft;
 for(let guard=0;guard<20;guard++){
  const steps=stepsOf(result);
  let at=-1;let transition:AccessSubmitTransition|undefined;
  steps.some((step,index)=>{
   const fill=parseStepIntent(step).find(item=>item.type==='action_fill');
   const label=fill?.actionTarget??step.match(/["“]([^"”]+)["”]/)?.[1];
   const found=label?transitions.find(item=>labelKey(item.fillLabel)===labelKey(label)):undefined;
   const next=steps[index+1];
   if(!fill||!found||next===undefined)return false;
   const nextIntents=parseStepIntent(next);
   if(!nextIntents.some(item=>item.type.startsWith('action_')))return false;
   if(nextIntents.some(item=>['action_click','action_press','action_submit'].includes(item.type)&&labelKey(item.actionTarget??'')===labelKey(found.clickLabel)))return false;
   at=index;transition=found;return true;
  });
  if(!transition)return result;
  const offset=at+1;
  const remap=(items:unknown)=>Array.isArray(items)?items.map(item=>item&&typeof item==='object'&&typeof (item as Record<string,unknown>).stepIndex==='number'&&(item as Record<string,number>).stepIndex>offset?{...item as Record<string,unknown>,stepIndex:(item as Record<string,number>).stepIndex+1}:item):items;
  result={...result,steps:[...steps.slice(0,offset),`Presionar "${transition.clickLabel}"`,...steps.slice(offset)],
   ...(Array.isArray(result.inputRequirements)?{inputRequirements:remap(result.inputRequirements)}:{}),
   ...(Array.isArray(result.unresolvedUiRequirements)?{unresolvedUiRequirements:remap(result.unresolvedUiRequirements)}:{})};
 }
 return result;
}

const PUBLIC_STORY=/\b(?:p[uú]blic[oa]s?|an[oó]nim[oa]s?|sin\s+(?:iniciar\s+sesi[oó]n|autenticaci[oó]n|login)|no\s+requiere\s+(?:inicio\s+de\s+sesi[oó]n|autenticaci[oó]n|login)|without\s+(?:login|signing\s+in)|unauthenticated|anonymous)\b/i;
const CREDENTIAL_ENTRY=/["“][^"”]*\b(?:usuario|username|contrase[nñ]a|password|c[eé]dula|rnc|identificaci[oó]n)\b[^"”]*["”]|\b(?:iniciar sesi[oó]n|sign in|log in)\b/i;
/** A protected-app journey with no login of its own delegates authentication to the profile's configured flow. */
function requireProfileAuth(draft:Draft,issue:JiraIssueSource|undefined,loginMode?:string):Draft{
 if(!loginMode||loginMode==='no_login'||draft.authIntent)return draft;
 if(stepsOf(draft).some(step=>CREDENTIAL_ENTRY.test(step)))return draft;
 if(issue&&PUBLIC_STORY.test([issue.description,issue.acceptanceCriteria].join(' ')))return draft;
 return {...draft,authIntent:'full_authentication'};
}
/**
 * A choice-only draft (select an option, no assertion) is dropped for lacking an observable result.
 * Its own field label is source-grounded and the select action itself confirms the shown option,
 * so anchor it with the same visibility check the other drafts carry. Never adds a new claim.
 */
function anchorSelectionDraft(draft:Draft):Draft{
 const steps=stepsOf(draft);
 if(!steps.length||steps.some(step=>/^\s*(?:Validar|Verificar)\b/i.test(step)))return draft;
 const at=steps.findIndex(step=>/^\s*Seleccionar\s+["“][^"”]+["”]\s+en\s+["“][^"”]+["”]/i.test(step));
 if(at<0)return draft;
 const field=/\s+en\s+["“]([^"”]+)["”]/i.exec(steps[at])![1];
 const remap=(items:unknown)=>Array.isArray(items)?items.map(item=>item&&typeof item==='object'&&typeof (item as Record<string,unknown>).stepIndex==='number'&&(item as Record<string,number>).stepIndex>at?{...item as Record<string,unknown>,stepIndex:(item as Record<string,number>).stepIndex+1}:item):items;
 return {...draft,steps:[...steps.slice(0,at),`Validar que "${field}" esté visible.`,...steps.slice(at)],
  ...(Array.isArray(draft.inputRequirements)?{inputRequirements:remap(draft.inputRequirements)}:{}),
  ...(Array.isArray(draft.unresolvedUiRequirements)?{unresolvedUiRequirements:remap(draft.unresolvedUiRequirements)}:{})};
}

/**
 * `Validar que se muestre "A, B, C"` is one exact visible target at runtime. Split it into one
 * assertion per label only when every comma segment is independently an exact label in this
 * issue's acceptance criteria; any ungrounded segment leaves the step untouched.
 */
function splitGroundedLabelLists(draft:Draft,issue:JiraIssueSource):Draft{
 const criteria=issue.acceptanceCriteria??'';
 const grounded=(label:string)=>{
  const at=criteria.indexOf(label);
  for(let from=at;from>=0;from=criteria.indexOf(label,from+1)){
   if(!/[\p{L}\p{N}]/u.test(criteria[from-1]??' ')&&!/[\p{L}\p{N}]/u.test(criteria[from+label.length]??' '))return true;
  }
  return false;
 };
 const expanded:string[][]=stepsOf(draft).map(step=>{
  const match=step.match(/^(\s*(?:Validar|Verificar)\s+que\s+se\s+\w+\s+)["“]([^"”]+)["”]([.]?)\s*$/i);
  const labels=match?.[2].split(',').map(label=>label.trim());
  // A generic category prefix on the first item ("permisos Consultar cuentas") is not part of the label:
  // strip it only when the source uses the prefix as list context ("los permisos <first>, ...") and the
  // remainder is itself an exact source item; never when the source quotes the whole prefix+remainder as a label.
  const prefixed=labels&&/^(permisos|opciones|campos|columnas)\s+(.+)$/iu.exec(labels[0]);
  if(labels&&prefixed&&!criteria.includes(`"${labels[0]}"`)&&!criteria.includes(`“${labels[0]}”`)&&grounded(prefixed[2])
   &&new RegExp(`\\b(?:los|las)\\s+${prefixed[1]}\\s+${prefixed[2].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*[,;]`,'iu').test(criteria))labels[0]=prefixed[2];
  if(!match||!labels||labels.length<2||!labels.every(label=>label&&grounded(label)))return [step];
  return labels.map(label=>`${match[1]}"${label}"${match[3]}`);
 });
 return regroupSteps(draft,expanded);
}

/** Replace each old step by its group of new steps (empty group = merged away) and remap 1-based step metadata. */
function regroupSteps(draft:Draft,expanded:string[][]):Draft{
 const before=stepsOf(draft);
 if(expanded.every((group,index)=>group.length===1&&group[0]===before[index]))return draft;
 // Old 1-based index -> first new index; steps after a split shift by the extra steps before them.
 const first=(old:number)=>1+expanded.slice(0,old-1).reduce((sum,group)=>sum+group.length,0);
 const remap=(items:unknown)=>Array.isArray(items)?items.map(item=>item&&typeof item==='object'&&Number.isInteger((item as Record<string,unknown>).stepIndex)?{...item as Record<string,unknown>,stepIndex:first((item as Record<string,number>).stepIndex)}:item):items;
 const remapConditions=(items:unknown)=>Array.isArray(items)?items.map(item=>{
  if(!item||typeof item!=='object'||!Array.isArray((item as Record<string,unknown>).stepIndices))return item;
  const record=item as Record<string,unknown>;
  return {...record,stepIndices:(record.stepIndices as unknown[]).flatMap(value=>Number.isInteger(value)&&(value as number)>=1&&(value as number)<=expanded.length
   ?Array.from({length:expanded[(value as number)-1].length},(_,offset)=>first(value as number)+offset):[value])};
 }):items;
 return {...draft,steps:expanded.flat(),
  ...(Array.isArray(draft.inputRequirements)?{inputRequirements:remap(draft.inputRequirements)}:{}),
  ...(Array.isArray(draft.unresolvedUiRequirements)?{unresolvedUiRequirements:remap(draft.unresolvedUiRequirements)}:{}),
  ...(Array.isArray(draft.conditionRequirements)?{conditionRequirements:remapConditions(draft.conditionRequirements)}:{})};
}

/**
 * In a table, a column heading and its cell are separate visible nodes, so `"Fecha 10 oct 2026"` never
 * matches one node. When the source names the pair inside a table/row sentence and the heading also
 * appears elsewhere in the source, assert only the cell value (one step in, one step out). A value the
 * generator split over thousands punctuation ("RD$2" + "500.00") is first rejoined when the source
 * has the joined text. Anything not source-grounded this way is left untouched (fail closed).
 */
function splitTabularLabelValues(draft:Draft,issue:JiraIssueSource):Draft{
 const source=[issue.description,issue.acceptanceCriteria].filter((part):part is string=>typeof part==='string').join('\n');
 const edge=/[\p{L}\p{N}]/u;
 const findAll=(needle:string)=>{
  const found:number[]=[];
  for(let at=source.indexOf(needle);needle&&at>=0;at=source.indexOf(needle,at+1))
   if(!edge.test(source[at-1]??' ')&&!edge.test(source[at+needle.length]??' '))found.push(at);
  return found;
 };
 const shape=/^(\s*(?:Validar|Verificar)\s+que\s+se\s+\w+\s+)["“]([^"”]+)["”]([.]?)\s*$/i;
 const tableCue=/(?<![\p{L}\p{N}])(?:tabla|table|fila|filas|row|rows|grilla|grid|columnas?|columns?|celdas?|cells?)(?![\p{L}\p{N}])/iu;
 const valueOf=(text:string):string|undefined=>{
  for(const at of findAll(text)){
   let cut=0;
   for(const boundary of source.slice(0,at).matchAll(/[.;]\s+|\n/g))cut=boundary.index+boundary[0].length;
   if(!tableCue.test(source.slice(cut,at)))continue;
   const words=text.split(/\s+/);
   for(let n=words.length-1;n>=1;n--){
    const heading=words.slice(0,n).join(' ');
    // Keep any leading sign (− + -) attached to the cell value: it carries financial polarity.
    const value=words.slice(n).join(' ');
    if(/^\p{L}/u.test(heading)&&value&&findAll(heading).some(other=>other!==at))return value;
   }
  }
  return undefined;
 };
 const steps=stepsOf(draft);
 const groups:string[][]=[];
 for(let index=0;index<steps.length;index++){
  const head=shape.exec(steps[index]);
  const tail=shape.exec(steps[index+1]??'');
  let text=head?.[2];
  let consumed=1;
  if(head&&tail&&head[1]===tail[1]&&/\d$/.test(head[2])&&/^\d{3}(?!\d)/.test(tail[2])){
   const sep=[',','.'].find(candidate=>findAll(`${head[2]}${candidate}${tail[2]}`).length);
   if(sep){text=`${head[2]}${sep}${tail[2]}`;consumed=2;}
  }
  const value=text?valueOf(text):undefined;
  if(value&&head){groups.push([`${head[1]}"${value}"${head[3]}`]);if(consumed===2)groups.push([]);index+=consumed-1;}
  else groups.push([steps[index]]);
 }
 return regroupSteps(draft,groups);
}

/**
 * A data-bearing result assertion placed before the login that precedes the screen showing it cannot
 * hold. Move it right after the input-group submit (inputs then a press, after login) whose label is
 * named in the same source criterion as all of the assertion's digit tokens. Fail closed: no login,
 * no digits, or no such source-linked producer leaves the draft untouched for downstream rejection.
 */
function relocatePrematureResultAssertions(draft:Draft,issue:JiraIssueSource):Draft{
 const steps=stepsOf(draft);
 const fold=(text:string)=>text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 // Source blocks: an acceptance-criterion marker (AC4, CA-2, Criterio 3, "1.") opens a block spanning its following lines and sentences; unmarked lines are their own block.
 const marker=/^\s*(?:[-*]\s*)?(?:(?:ac|ca|criterio(?:\s+de\s+aceptacion)?)\s*[-#:.]?\s*(\d+(?:\.\d+)*)|\d+[.)])(?![\p{L}\p{N}])/u;
 const segments=[issue.description,issue.acceptanceCriteria].flatMap(part=>{
  const blocks:string[]=[];let openId:string|undefined;
  for(const line of fold(typeof part==='string'?part:'').split('\n')){
   const match=marker.exec(line);
   // Unmarked continuation lines and dotted sub-criteria (AC4.1 under AC4) belong to the open block; sibling criteria never merge.
   if(openId!==undefined&&(!match&&line.trim()||match?.[1]?.startsWith(`${openId}.`)))blocks[blocks.length-1]+=` ${line}`;
   else{blocks.push(line);openId=match?(match[1]??''):undefined;}
  }
  return blocks;
 });
 const token=(value:string)=>new RegExp(`(?<![\\p{L}\\p{N}])${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\p{L}\\p{N}])`,'u');
 const input=/^\s*(?:Ingresar|Seleccionar)\b/i,press=/^\s*Presionar\b/i,assertion=/^\s*(?:Validar|Verificar)\s+que\s+se\s+\w+\s+["“]([^"”]+)["”][.]?\s*$/i;
 const login=steps.findIndex(step=>CREDENTIAL_ENTRY.test(step));
 if(login<0)return draft;
 // Producers: presses after login that submit an input group.
 const producers=steps.flatMap((step,index)=>index>login&&press.test(step)&&input.test(steps[index-1]??'')&&!CREDENTIAL_ENTRY.test(steps[index-1])?[index]:[]);
 // Source linkage: one source criterion must name the asserted output (all its digit tokens) and the producing press label.
 const producerFor=(text:string)=>{
  const digits=text.match(/\d+/g);
  if(!digits)return -1;
  const sentences=segments.filter(segment=>digits.every(digit=>token(digit).test(segment)));
  for(const index of [...producers].reverse()){
   const label=/["“]([^"”]+)["”]/.exec(steps[index])?.[1];
   if(label&&sentences.some(segment=>token(fold(label)).test(segment)))return index;
  }
  return -1;
 };
 const targets=new Map<number,number>();
 steps.forEach((step,index)=>{
  const text=index<login?assertion.exec(step)?.[1]:undefined;
  const at=text?producerFor(text):-1;
  if(at>=0)targets.set(index,at);
 });
 if(!targets.size)return draft;
 const order:number[]=[];
 steps.forEach((_,index)=>{
  if(targets.has(index))return;
  order.push(index);
  targets.forEach((at,moved)=>{if(at===index)order.push(moved);});
 });
 const to=(old:number)=>order.indexOf(old-1)+1;
 const remap=(items:unknown)=>Array.isArray(items)?items.map(item=>{
  const record=item as Record<string,unknown>;
  const index=record&&typeof record==='object'?record.stepIndex:undefined;
  return typeof index==='number'&&to(index)>0?{...record,stepIndex:to(index)}:item;
 }):items;
 const remapConditions=(items:unknown)=>Array.isArray(items)?items.map(item=>{
  const record=item as Record<string,unknown>;
  return record&&typeof record==='object'&&Array.isArray(record.stepIndices)
   ?{...record,stepIndices:record.stepIndices.map(value=>typeof value==='number'&&to(value)>0?to(value):value)}:item;
 }):items;
 return {...draft,steps:order.map(index=>steps[index]),
  ...(Array.isArray(draft.inputRequirements)?{inputRequirements:remap(draft.inputRequirements)}:{}),
  ...(Array.isArray(draft.unresolvedUiRequirements)?{unresolvedUiRequirements:remap(draft.unresolvedUiRequirements)}:{}),
  ...(Array.isArray(draft.conditionRequirements)?{conditionRequirements:remapConditions(draft.conditionRequirements)}:{})};
}

export function prepareJiraGenerationDrafts(candidates:unknown[],issues:JiraIssueSource[],appSlug?:string,loginMode?:string,accessSubmits:AccessSubmitTransition[]=[]):unknown[]{
 const normalized=candidates.map(candidate=>{
  if(!candidate || typeof candidate!=='object') return candidate;
  const base=removesDuplicateAuthFlow(candidate as Draft);
  const issue=issues.find(issue=>issue.key===base.sourceIssueKey);
  let draft=anchorSelectionDraft(removeRedundantNavigationProse(removeNonUiSetupSteps(requireProfileAuth(base,issue,loginMode),appSlug)));
  if(loginMode!=='no_login')draft=insertObservedAccessSubmit(draft,accessSubmits);
  if(issue)draft=removeRedundantDynamicRowAssertions(draft,issue);
  if(issue)draft=removePrematureSecondRowAdd(draft,issue);
  if(issue)draft=relocatePrematureResultAssertions(draft,issue);
  if(issue)draft=splitGroundedLabelLists(draft,issue);
  if(issue)draft=splitTabularLabelValues(draft,issue);
  return issue ? conditionalTargets(draft,issue) : draft;
 });
 const peers=normalized.filter((candidate):candidate is Draft=>Boolean(candidate)&&typeof candidate==='object');
 return normalized.map(candidate=>{
  if(!candidate || typeof candidate!=='object') return candidate;
  const draft=candidate as Draft;
  const issue=issues.find(issue=>issue.key===draft.sourceIssueKey);
  if(!issue)return draft;
  const withControlledSetup=controlledSetup(draft,peers,issue);
  return contextCriteria(expandCompositeFailureJourney(withControlledSetup,peers,issue),issue);
 });
}
