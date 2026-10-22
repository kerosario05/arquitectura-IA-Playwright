import assert from 'node:assert/strict';
import test from 'node:test';
import {auditJiraStepDelivery,deduplicateJiraDrafts} from './jira-step-delivery';
import {deriveJiraInputRequirements} from './jira-input-requirements';
import {auditGeneratedJiraSyntax,generateJiraScenarios} from './jira-scenario-generator';
import {buildJiraLearnedRoute} from './jira-knowledge-learning';
import {resolveJiraGenerationKnowledge} from './jira-generation-knowledge';
import type {AiProvider} from '../ai/ai-provider.types';

test('generated narrative clicks, compound checks and message placeholders cannot pass delivery',()=>{
 for(const [step,reason] of [
  ['Presionar "el código por SMS"','JIRA_GENERATED_REQUEST_AS_CONTROL'],
  ['Presionar "la confirmación por correo"','JIRA_GENERATED_REQUEST_AS_CONTROL'],
  ['Validar el resumen con las cuentas, el monto y el total','JIRA_GENERATED_ASSERTION_NOT_ATOMIC'],
  ['Validar el rechazo del token y que no se presente la operación como exitosa','JIRA_GENERATED_ASSERTION_NOT_ATOMIC'],
  ['Validar que se muestre "un mensaje que informe el problema"','JIRA_GENERATED_NARRATIVE_TARGET'],
 ])assert.equal(auditJiraStepDelivery([step],[])[0]?.reason,reason);
 assert.deepEqual(auditJiraStepDelivery(['Presionar "SMS"'],[]),[]);
 assert.deepEqual(auditJiraStepDelivery(['Presionar "el código por SMS"'],[],'El botón se llama "el código por SMS"'),[]);
 assert.deepEqual(auditJiraStepDelivery(['Validar que se muestre "A, B y C"'],[]),[],'quoted literal labels retain punctuation');
});

test('readiness prose is not a functional expected result',async()=>{
 const steps=['Abrir la aplicación configurada del proyecto','Presionar "Enviar"','Validar que se muestre "Resultado"'];
 const failures=await auditGeneratedJiraSyntax([{title:'Flow',steps,expectedResult:'La observación queda pendiente de resolución por Discovery.'}]);
 assert.ok(failures.some(f=>f.reason==='JIRA_GENERATED_EXPECTED_RESULT_IS_READINESS'));
 const combined=await auditGeneratedJiraSyntax([{title:'Flow',steps:['Validar que se muestre "un mensaje que informe el problema"'],expectedResult:'Queda pendiente de Discovery.'}]);
 assert.ok(combined.some(f=>f.reason==='JIRA_GENERATED_EXPECTED_RESULT_IS_READINESS'));
 assert.ok(combined.some(f=>f.reason==='JIRA_GENERATED_NARRATIVE_TARGET'),'report both losses in the same repair request');
 assert.deepEqual(await auditGeneratedJiraSyntax([{title:'Flow',steps,expectedResult:'Resultado'}]),[]);
});

test('two projects transport request intent separately from observed edited controls',()=>{
 for(const appSlug of ['fixture-banking','fixture-inventory']) {
  const steps=['Abrir la aplicación configurada del proyecto','Solicitar el código por SMS','Presionar "SMS"'];
  const route=buildJiraLearnedRoute({appSlug,profileRevision:'rev',jobId:'J',evidenceRefs:['evidence.json'],
   scenario:{scenarioId:'S',sourceIssueKey:'HU-1',title:'Flow',steps,expectedResult:''},
   discovery:{plan:{status:'validated',steps:[{action:'navigate',target:'APP_BASE_URL',description:steps[0]},
    {action:'click',target:{strategy:'css',value:'#private'},description:steps[1]},
    {action:'click',target:{strategy:'css',value:'#private'},description:steps[2]}]} as any,sourceScenario:{},runtimeEntries:[]}})!;
  assert.equal(route.actions[1].targetKind,'semantic_request');
  assert.equal(route.actions[2].targetKind,'observed_control');
  const selected=resolveJiraGenerationKnowledge(appSlug,[{key:'HU-1',summary:'Flow',description:''} as any],[route],'rev').knowledge[0].routes[0];
  assert.equal(selected.actions[1].targetKind,'semantic_request');
  assert.equal(selected.actions[2].field,'SMS');
  assert.doesNotMatch(JSON.stringify(selected),/#private/);
 }
});

test('atomic alternatives retain their complete data binding',()=>{
 const steps=['Ingresar el monto en "Monto"','Validar que se muestre "Resumen"','Validar que no se muestre "Resultado exitoso"'];
 assert.deepEqual(auditJiraStepDelivery(steps,deriveJiraInputRequirements(steps)),[]);
});

test('exact duplicates collapse without merging different expected checks or negative data',()=>{
 const base={sourceIssueKey:'HU-1',title:'First',steps:['Ingresar el dato en "Referencia"'],expectedResult:'Resultado',inputRequirements:[{key:'ref',dataCondition:'valid'}],acceptanceCriteriaRefs:['AC1.1']};
 assert.equal(deduplicateJiraDrafts([base,{...base,title:'Renamed duplicate'}]).length,1);
 for(const different of [{...base,expectedResult:'Different check'},{...base,inputRequirements:[{key:'ref',dataCondition:'invalid'}]},{...base,acceptanceCriteriaRefs:['AC2.1']}])assert.equal(deduplicateJiraDrafts([base,different]).length,2);
});

test('existing repair loop corrects readiness prose instead of restoring the invalid original',async()=>{
 const source={key:'HU-1',summary:'Consultar',description:'Presionar "Consultar" y mostrar "Resultado".'} as any;
 const draft={sourceIssueKey:'HU-1',title:'Consultar',steps:['Abrir la aplicación configurada del proyecto','Presionar "Consultar"','Validar que se muestre "Resultado"'],expectedResult:'La observación queda pendiente de resolución por Discovery.'};
 let calls=0;
 const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){calls++;return {rawText:'',parsedJson:{scenarios:[calls===1?draft:{...draft,expectedResult:'Resultado'}]},providerName:'fixture',model:'fixture',durationMs:0};}};
 const result=await generateJiraScenarios([source],'fixture',provider,{loadProjectKnowledge:false});
 assert.equal(calls,2);
 assert.equal(result.scenarios[0].expectedResult,'Resultado');
 assert.equal(result.scenarios[0].validation.valid,true);
 assert.deepEqual(result.scenarios[0].steps,draft.steps);
});

test('coverage repair cannot append duplicate journeys that close no missing criterion',async()=>{
 const source={key:'HU-1',summary:'Movimientos',description:'',acceptanceCriteria:'AC1 — Movimientos\nEl cliente consulta sus movimientos. Puede filtrar por fecha.'} as any;
 const draft={sourceIssueKey:'HU-1',title:'Consultar',steps:['Abrir la aplicación configurada del proyecto','Validar que se muestre "Movimientos"'],expectedResult:'Se muestran los movimientos.',acceptanceCriteriaRefs:['AC1.1']};
 let calls=0;
 const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){calls++;return {rawText:'',parsedJson:{scenarios:[{...draft,title:calls===1?'Consultar':'Otro título'}]},providerName:'fixture',model:'fixture',durationMs:0};}};
 const result=await generateJiraScenarios([source],'fixture',provider,{loadProjectKnowledge:false});
 assert.ok(calls>=2);
 assert.equal(result.scenarios.length,1);
 assert.ok(result.rejected.some(r=>r.reason.includes('COVERAGE_INCOMPLETE')),'missing criterion remains visible, not falsely certified');
});
