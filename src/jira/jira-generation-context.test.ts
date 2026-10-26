import test from 'node:test';
import assert from 'node:assert/strict';
import {compactJiraGenerationMessages} from './jira-generation-context';
import type {AiMessage} from '../ai/ai-provider.types';

test('shared route context shrinks losslessly without changing fields, source or indices',()=>{
  const prefix=Array.from({length:20},(_,i)=>`Presionar "Control observado ${i+1} del recorrido de prueba"`);
  const journeys=Array.from({length:12},(_,i)=>({sourceIssueKey:'CTX-1',title:`Branch ${i}`,authIntent:'full_authentication',
    steps:[...prefix,`Validar que se muestre "Resultado ${i}"`],inputRequirements:[{key:'referencia',stepIndex:12,sensitive:true}]}));
  const source={description:'Complete story retained',acceptanceCriteria:'Every acceptance clause retained'};
  const messages:AiMessage[]=[{role:'system',content:'Preserve source requirements.'},{role:'user',content:JSON.stringify({issues:[source],validatedJourneys:journeys})}];
  const compact=compactJiraGenerationMessages(messages);
  const payload=JSON.parse(compact[1].content);
  const expanded=payload.validatedJourneys.map((journey:Record<string,unknown>)=>{
    const {stepsPrefixId,stepsSuffix,...rest}=journey;
    const found=payload.validatedJourneyPrefixes.find((item:{id:string})=>item.id===stepsPrefixId);
    return {...rest,steps:[...found.steps,...stepsSuffix as string[]]};
  });
  assert.deepEqual(expanded,journeys);
  assert.deepEqual(payload.issues,[source]);
  assert.ok(compact.reduce((n,m)=>n+m.content.length,0)<messages.reduce((n,m)=>n+m.content.length,0)*0.4);
  assert.match(compact[0].content,/full sequence, never the suffix/);
  assert.deepEqual(compactJiraGenerationMessages(compact),compact,'idempotent');
  assert.equal(JSON.parse(messages[1].content).validatedJourneyPrefixes,undefined,'original data untouched');
});

test('distinct issues/authentication contexts and small or malformed payloads are unchanged',()=>{
  const steps=['Abrir aplicación','Presionar acceso','Ingresar usuario'];
  for(const payload of [
    {validatedJourneys:[{sourceIssueKey:'ONE',steps},{sourceIssueKey:'TWO',steps}]},
    {validatedJourneys:[{sourceIssueKey:'ONE',authIntent:'one',steps},{sourceIssueKey:'ONE',authIntent:'two',steps}]},
    {validatedJourneys:[{sourceIssueKey:'ONE',steps},{sourceIssueKey:'ONE',steps}]},
    {validatedJourneys:[null,{steps:'not a sequence'}]},
  ]) {
    const messages:AiMessage[]=[{role:'system',content:'policy'},{role:'user',content:JSON.stringify(payload)}];
    assert.deepEqual(compactJiraGenerationMessages(messages),messages);
  }
  const messages:AiMessage[]=[{role:'user',content:'not JSON'}];
  assert.deepEqual(compactJiraGenerationMessages(messages),messages);
});
