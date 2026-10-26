import {createHash} from 'node:crypto';
import type {ValidatedScenario} from '../scenarios/scenario-types';
import type {AiMessage,AiProvider} from '../ai/ai-provider.types';

export type JiraGenerationResult={scenarios:ValidatedScenario[];rejected:Array<{sourceIssueKey:string;title:string;reason:string}>;
 coverage?:Array<{sourceIssueKey:string;total:number;covered:number;status:'complete'|'incomplete';missingClauses:Array<{id:string;text:string}>}>};
export function jiraGenerationCacheKey(provider:Pick<AiProvider,'model'|'providerName'|'providerType'>,messages:AiMessage[]):string{
 return createHash('sha256').update(JSON.stringify({provider,messages})).digest('hex');
}
/** Only valid generation results are reused; every launch still needs Discovery. */
export class JiraGenerationCache {
 private readonly entries=new Map<string,{expires:number;result:JiraGenerationResult}>();
 constructor(private readonly ttlMs=300000,private readonly limit=16){}
 get(key:string,now=Date.now()):JiraGenerationResult|undefined{
  const entry=this.entries.get(key);
  if(!entry) return undefined;
  if(entry.expires<=now){this.entries.delete(key);return undefined;}
  return structuredClone(entry.result);
 }
 put(key:string,result:JiraGenerationResult,now=Date.now()):void{
  if(!result.scenarios.length || result.rejected.length || result.scenarios.some(scenario=>!scenario.validation.valid)) return;
  for(const [existing,entry] of this.entries) if(entry.expires<=now) this.entries.delete(existing);
  this.entries.delete(key);
  if(this.entries.size>=this.limit) this.entries.delete(this.entries.keys().next().value!);
  this.entries.set(key,{expires:now+this.ttlMs,result:structuredClone(result)});
 }
}
