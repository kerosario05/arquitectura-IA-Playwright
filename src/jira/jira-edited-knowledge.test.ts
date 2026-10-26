import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeAuthoredJiraStep} from './jira-authored-step-format';
import {reviewEditedJiraScenarios} from './jira-scenario-edit';
import {persistClassicJiraDiscoveryRoute,buildJiraLearnedRoute} from './jira-knowledge-learning';
import {mergeJiraRoute,type JiraLearnedRoute} from './jira-knowledge-repository';
import {resolveJiraGenerationKnowledge} from './jira-generation-knowledge';
import {bindKnownJiraObservables} from './jira-step-delivery';
import fs from 'node:fs';
import path from 'node:path';

test('simple human clicks are quoted without hiding conditions or compounds',()=>{
 for(const [source,target] of [['presionar el boton sms','sms'],['presionar SMS','SMS'],['Pulsar el botón "Email"','Email'],['presionar "SMS"','SMS']]) {
  const result=normalizeAuthoredJiraStep(source);
  assert.equal(result,`Presionar "${target}"`);
  assert.equal(normalizeAuthoredJiraStep(result),result);
 }
 for(const step of ['Presionar SMS y continuar','Presionar SMS si está visible','Ingresar el valor en "Nombre"','Solicitar el código por SMS'])assert.equal(normalizeAuthoredJiraStep(step),step);
});

test('simple field actions quote their target while composite actions stay untouched',()=>{
 for(const [source,target] of [
  ['Ingresar monto en Monto','Ingresar monto en "Monto"'],
  ['Seleccionar Cuenta Corriente en cuenta de origen','Seleccionar Cuenta Corriente en "Cuenta de origen"'],
  ['Escribir el correo en el campo Email','Escribir el correo en "Email"'],
 ]) assert.equal(normalizeAuthoredJiraStep(source),target);
 for(const step of [
  'Ingresar el valor en "Contraseña"',
  'Ingresar usuario y contraseña en el formulario',
  'Seleccionar la cuenta de origen y luego validar el saldo',
 ]) assert.equal(normalizeAuthoredJiraStep(step),step);
});

test('review-edit returns normalized human steps',async()=>{
 const original={scenarioId:'HU-1:jira:1',sourceIssueKey:'HU-1',title:'Consulta',steps:['Abrir la aplicación configurada del proyecto','Presionar "Email"','Validar que se muestre "Resultado"'],expectedResult:'Resultado'};
 const [edited]=await reviewEditedJiraScenarios({key:'HU-1',summary:'Consulta',description:''} as any,[original],original.scenarioId,{...original,steps:[original.steps[0],'presionar el boton sms',original.steps[2]]});
 assert.equal(edited.steps[1],'Presionar "sms"');
 assert.equal(edited.validation.valid,true);
});

test('verified classic edit reaches project knowledge and regeneration without crossing projects',async()=>{
 for(const appSlug of ['fixture-bank','fixture-store']) {
  const actions=['Abrir la aplicación configurada del proyecto','Presionar "SMS"'];
  const scenario={source:'testrail',externalId:'C1',caseId:1,title:'Flow',references:'HU-1',steps:actions.map((action,i)=>({index:i+1,action}))} as any;
  const plan={version:'1.0',source:'discovery_generated',status:'validated',scenario:{title:'Flow'},requiredData:[],createdAt:new Date().toISOString(),steps:[{index:1,action:'navigate',target:'APP_BASE_URL',description:actions[0]},{index:2,action:'click',target:{strategy:'css',value:'#observed'},description:actions[1]}]} as any;
  const routes:JiraLearnedRoute[]=[];
  const input={scenario,plan,status:'discovered_passed',appSlug,profileRevision:'rev',jobId:'job',evidenceRefs:['snapshot.json']};
  assert.equal((await persistClassicJiraDiscoveryRoute(input,async route=>{routes.push(route);})).status,'persisted');
  const issue={key:'HU-1',summary:'Flow',description:''} as any;
  const knowledge=resolveJiraGenerationKnowledge(appSlug,[issue],routes,'rev');
  assert.ok(knowledge.knowledge[0].routes[0].actions.some(action=>action.action==='click'&&action.field==='SMS'));
  assert.equal(resolveJiraGenerationKnowledge('other-app',[issue],routes,'rev').knowledge[0].routes.length,0);
  assert.doesNotMatch(JSON.stringify(routes),/#observed/);
  for(const patch of [{status:'discovery_failed'},{evidenceRefs:[]},{scenario:{...scenario,references:'HU-1 HU-2'}},{scenario:{...scenario,recordingId:'recording'}}]) {
   assert.equal((await persistClassicJiraDiscoveryRoute({...input,...patch},async()=>{assert.fail('unverified route must not persist');})).status,'skipped');
  }
  const updated=buildJiraLearnedRoute({scenario:{scenarioId:'C1:edited-abc123',sourceIssueKey:'HU-1',title:'Flow',steps:actions,expectedResult:''},discovery:{plan,sourceScenario:{},runtimeEntries:[]},appSlug,profileRevision:'rev',jobId:'new',evidenceRefs:['new.json']})!;
  assert.equal(updated.id,routes[0].id);
  assert.equal((mergeJiraRoute({jiraRoutes:routes},updated).jiraRoutes as unknown[]).length,1);
 }
});

test('known observable binding requires exact lineage and never downgrades comparisons',()=>{
 const requirement='Validar que se muestre "la pantalla de verificación"';
 assert.deepEqual(bindKnownJiraObservables([requirement],[{requirement,target:'Confirma tu identidad'}]),['Validar que se muestre "Confirma tu identidad"']);
 assert.deepEqual(bindKnownJiraObservables([requirement],[{requirement,target:'A'},{requirement,target:'B'}]),[requirement]);
 const comparison='Validar que el monto coincida con el valor ingresado';
 assert.deepEqual(bindKnownJiraObservables([comparison],[{requirement:comparison,target:'Monto'}]),[comparison]);
});

test('safe observed labels round-trip through project learning without sensitive values',()=>{
 const requirement='Validar que se muestre "la pantalla de verificación"';
 const sourceScenario={observableOracles:[
  {id:'safe',requirement,type:'literal_visible_text',backed:true,target:'Confirma tu identidad',source:'discovery',evidence:['live']},
  {id:'secret',requirement:'Secret',type:'literal_visible_text',backed:true,target:'Password synthetic-value',source:'discovery',evidence:['live']},
  {id:'account',requirement:'Account',type:'literal_visible_text',backed:true,target:'123456789012',source:'discovery',evidence:['live']},
  {id:'sanitized-feedback',requirement:'Feedback',type:'literal_visible_text',backed:true,target:'Credenciales inválidas',source:'discovery',evidence:['live']},
 ]} as any;
 const route=buildJiraLearnedRoute({scenario:{scenarioId:'S',sourceIssueKey:'HU-1',title:'Flow',steps:[],expectedResult:''},
  discovery:{plan:{status:'validated',steps:[{action:'click',target:{strategy:'text',value:'Observed'},description:'Presionar "Observed"'}]} as any,sourceScenario,runtimeEntries:[]},
  appSlug:'fixture',profileRevision:'rev',jobId:'J',evidenceRefs:['live.json']})!;
 assert.deepEqual(route.observables,[{requirement,target:'Confirma tu identidad'}]);
 const projected=resolveJiraGenerationKnowledge('fixture',[{key:'HU-1',summary:'Flow',description:''} as any],[route],'rev');
 assert.deepEqual(bindKnownJiraObservables([requirement],projected.knowledge[0].routes[0].observables??[]),['Validar que se muestre "Confirma tu identidad"']);
 assert.doesNotMatch(JSON.stringify(route),/synthetic-value|123456789012/);
});

test('classic workflow persists validated learning before optional promotion and isolates context-only runs',()=>{
 const source=fs.readFileSync(path.resolve('src/discovery/case-discovery-workflow.ts'),'utf8');
 const start=source.indexOf('await persistClassicJiraDiscoveryRoute(');
 assert.ok(start>0);
 assert.ok(start<source.indexOf('if (!options.autoPromote)',start));
 assert.match(source.slice(start-75,start),/if \(!options.contextOnly\)/);
});
