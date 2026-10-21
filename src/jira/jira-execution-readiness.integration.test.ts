import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {generateJiraScenarios,normalizeJiraGeneratedSteps,auditGeneratedJiraSyntax} from './jira-scenario-generator';
import {discoverJiraScenario,type JiraBrowserPort} from './jira-semantic-executor';
import {compileJiraSpec} from './jira-spec-compiler';
import {deriveJiraInputRequirements} from './jira-input-requirements';
import type {JiraIssueSource} from '../scenarios/scenario-types';
import type {AiProvider} from '../ai/ai-provider.types';

const issue: JiraIssueSource={key:'HU-101',summary:'Controlled operation',description:'AC1 — Confirmation\nMostrar Cargo cuando aplique.\nAC2 — Rejection\nUn token no válido impide completar la operación y no muestra Resultado.',acceptanceCriteria:null,labels:[],components:[],status:'Open',issueType:'Story'};

test('authored rejection wording survives generation audit, saved Jira execution and compilation',async()=>{
 for(const [appSlug,errorLabel,resultLabel] of [['fixture-shop','Pago rechazado','Recibo'],['fixture-service','Acceso rechazado','Panel']]) {
  const draft={sourceIssueKey:'HU-102',title:'Rechazo con dato no válido',steps:['Abrir la aplicación configurada del proyecto','Ingresar dato no válido en "Dato"',`Validar que se informa el "${errorLabel}"`,`Validar que no se muestra el "${resultLabel}"`],expectedResult:`Se informa el "${errorLabel}" y no se muestra el "${resultLabel}".`};
  assert.deepEqual(await auditGeneratedJiraSyntax([draft]),[]);
  assert.deepEqual(normalizeJiraGeneratedSteps(draft.steps).slice(-2),[`Validar que se muestre "${errorLabel}"`,`Validar que no se muestre "${resultLabel}"`]);
  const observed:string[]=[];
  const browser:JiraBrowserPort={async navigate(){},async act(){return {strategy:'css',value:'#data'};},async assert(target){observed.push(target);return {observedText:target};},async assertAbsent(target){observed.push(`absent:${target}`);return {absent:true};}};
  const fields=deriveJiraInputRequirements(draft.steps);
  const contract=await discoverJiraScenario({...draft,scenarioId:'HU-102:jira:1',appSlug,inputRequirements:fields},browser,Object.fromEntries(fields.map(field=>[field.key,'synthetic-invalid'])));
  assert.deepEqual(observed,[errorLabel,`absent:${resultLabel}`]);
  const compiled=compileJiraSpec({plan:contract.plan,sourceScenario:contract.sourceScenario,appSlug,sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-assertion/case.spec.ts')});
  assert.deepEqual(compiled.unsupported,[]);
  await assert.rejects(discoverJiraScenario({...draft,scenarioId:'HU-102:jira:1',inputRequirements:fields},{...browser,async assertAbsent(){throw new Error('result remains visible');}},Object.fromEntries(fields.map(field=>[field.key,'synthetic-invalid']))),/result remains visible/);
 }
});

test('Jira generation, automatic conditions, negative assertions and dedicated compiler work across profiles',async()=>{
 for(const appSlug of ['fixture-shop','fixture-service']) {
  const draft={sourceIssueKey:issue.key,title:'Operación no completada',preconditions:[],steps:['Ingresar token en "Token"','Validar "Cargo".','Validar "Error".','Validar "Resultado" no está presente.'],expectedResult:'No se muestra Resultado',acceptanceCriteriaRefs:['AC1','AC2']};
  let calls=0;
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(request){
   calls++;
   if(calls===1) return {rawText:'',parsedJson:{scenarios:[draft]},model:'fixture',providerName:'fixture',durationMs:0};
   const payload=JSON.parse(request.messages[1].content);
   assert.ok(payload.syntaxFailures.some((failure:{reason:string})=>failure.reason==='JIRA_FAILURE_SETUP_UNSPECIFIED'));
   const candidate=payload.scenarios[0];
   return {rawText:'',parsedJson:{scenarios:[{...candidate,steps:['Ingresar token no válido en "Token"',...candidate.steps.slice(1)]}]},model:'fixture',providerName:'fixture',durationMs:0};
  }};
  const result=await generateJiraScenarios([issue],appSlug,provider);
  const scenario=result.scenarios[0];
  assert.equal(calls,2);
  assert.equal(scenario.validation.valid,true);
  assert.equal(scenario.executionReadiness,'requires_discovery');
  assert.equal(scenario.mcpExecutable,false);
  assert.equal(scenario.inputRequirements?.[0].dataCondition,'invalid');
  const observed:string[]=[];
  const browser:JiraBrowserPort={async navigate(){},async act(){return {strategy:'css',value:'#token'};},async assert(target){observed.push(target);return {observedText:target};},async assertAbsent(target){observed.push(`absent:${target}`);return {absent:true};}};
  assert.ok(scenario.scenarioId);
  const input={...scenario,scenarioId:scenario.scenarioId,expectedResult:scenario.expectedResult ?? '',sourceIssueKey:issue.key};
  const values=Object.fromEntries((scenario.inputRequirements ?? []).map(field=>[field.key,'synthetic-input']));
  const progress:string[]=[];
  const contract=await discoverJiraScenario(input,browser,values,(_index,phase)=>{progress.push(phase);});
  assert.deepEqual(observed,['Cargo','Error','absent:Resultado']);
  assert.ok(progress.includes('condition_applies_observed'));
  assert.ok(contract.sourceScenario.observableOracles?.some(oracle=>oracle.polarity==='negative' && oracle.target==='Resultado'));
  const spec=compileJiraSpec({plan:contract.plan,sourceScenario:contract.sourceScenario,appSlug,sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-readiness/case.spec.ts')});
  assert.deepEqual(spec.unsupported,[]);
  await assert.rejects(discoverJiraScenario(input,{...browser,async assert(){throw new Error('JIRA_ASSERTION_NOT_SATISFIED');}},values),/JIRA_CONDITION_APPLICABILITY_UNRESOLVED/);
 }
});

test('normalization preserves absence without converting blocked transitions into visibility',()=>{
 assert.deepEqual(normalizeJiraGeneratedSteps(['Validar "Receipt" no está presente.','Validar "Receipt".','Validar que no se permita continuar.']),['Validar que no se muestre "Receipt"','Validar que se muestre "Receipt"','Validar que no se permita continuar.']);
});

test('semantic absence wording survives generation, Discovery and promoted-spec compilation across profiles',async()=>{
 for(const appSlug of ['fixture-retail','fixture-service']) {
  const raw='Validar que se muestre "ausencia de operación exitosa"';
  const steps=normalizeJiraGeneratedSteps(['Ingresar contraseña no válida en "Contraseña"','Presionar "Iniciar sesión"','Validar que se muestre "Usuario o Contraseña inválidos"',raw]);
  assert.equal(steps.at(-1),'Validar que no se muestre "operación exitosa"');
  const observed:string[]=[];
  const fields=deriveJiraInputRequirements(steps);
  const values=Object.fromEntries(fields.map(field=>[field.key,'synthetic-invalid']));
  const discovered=await discoverJiraScenario({sourceIssueKey:'HU-ABSENCE',scenarioId:'HU-ABSENCE:jira:1',title:'Rejected credentials',appSlug,steps,inputRequirements:fields,expectedResult:''},{
   async navigate(){},async act(_step,target){return {strategy:'text',value:target};},
   async assert(target){observed.push(`visible:${target}`);return {observedText:target};},
   async assertAbsent(target){observed.push(`absent:${target}`);return {absent:true};},
  },values);
  assert.deepEqual(observed,['visible:Usuario o Contraseña inválidos','absent:operación exitosa']);
  const compiled=compileJiraSpec({plan:discovered.plan,sourceScenario:discovered.sourceScenario,appSlug,sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-semantic-absence/case.spec.ts')});
  assert.deepEqual(compiled.unsupported,[]);
  assert.ok(compiled.source.includes('assertJiraSpecAbsentText(page, "operación exitosa")'));
 }
});

test('quoted screen assertion reaches Jira discovery as the visible page heading',async()=>{
 const seen:string[]=[];
 const browser:JiraBrowserPort={async navigate(){},async act(){throw new Error('no action expected');},async assert(target){seen.push(target);return {observedText:'Verificación de Usuario'};}};
 const result=await discoverJiraScenario({scenarioId:'HU-105:jira:1',sourceIssueKey:'HU-105',title:'Verificación',steps:['Validar "pantalla de verificación de usuario".'],expectedResult:''},browser);
 assert.deepEqual(seen,['verificación de usuario']);
 assert.equal(result.sourceScenario.observableOracles?.[0]?.target,'Verificación de Usuario');
});

test('postfix negative visibility remains executable through Jira syntax audit and saved-job execution',async()=>{
 for(const label of ['Order receipt','Account overview']) {
  const draft={sourceIssueKey:'HU-103',title:'Rejected input',steps:['Validar que se muestre "Error"',`Validar "${label}" no visible`],expectedResult:`El "${label}" no está visible después del rechazo.`};
  assert.deepEqual(await auditGeneratedJiraSyntax([draft]),[]);
  const seen:string[]=[];
  const contract=await discoverJiraScenario({...draft,scenarioId:'HU-103:jira:1'},{async navigate(){},async act(){throw new Error('no action expected');},async assert(target){return {observedText:target};},async assertAbsent(target){seen.push(target);return {absent:true};}});
  assert.deepEqual(seen,[label]);
  assert.equal(contract.sourceScenario.observableOracles?.at(-1)?.polarity,'negative');
 }
});

test('post-rejection expected summaries reuse explicit negative assertions across profiles',async()=>{
 for(const [appSlug,errorLabel,resultLabel] of [['fixture-retail','Credenciales no válidas','Resumen de productos'],['fixture-banking','Código no válido','Comprobante de transacción exitosa'],['fixture-service','Token no válido','Resultado exitoso']]) {
  const draft={sourceIssueKey:'HU-104',title:'Rejection for invalid input',steps:['Ingresar dato no válido en "Dato"',`Validar que se muestre "${errorLabel}"`,`Validar "${resultLabel}" no visible`],expectedResult:`El "${resultLabel}" no está visible después del rechazo.`};
  assert.deepEqual(await auditGeneratedJiraSyntax([draft]),[]);
  const observed:string[]=[];
  const fields=deriveJiraInputRequirements(draft.steps);
  const values=Object.fromEntries(fields.map(field=>[field.key,'synthetic-invalid']));
  const discovered=await discoverJiraScenario({...draft,scenarioId:'HU-104:jira:1',appSlug,inputRequirements:fields},{
   async navigate(){},async act(_step,target){return {strategy:'text',value:target};},
   async assert(target){observed.push(`visible:${target}`);return {observedText:target};},
   async assertAbsent(target){observed.push(`absent:${target}`);return {absent:true};},
  },values);
  assert.deepEqual(observed,[`visible:${errorLabel}`,`absent:${resultLabel}`]);
  const compiled=compileJiraSpec({plan:discovered.plan,sourceScenario:discovered.sourceScenario,appSlug,sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-negative-summary/case.spec.ts')});
  assert.deepEqual(compiled.unsupported,[]);
 }
 for(const appSlug of ['fixture-retail','fixture-banking']) {
  const source={...issue,key:'HU-104',summary:'Reject invalid input',description:'',acceptanceCriteria:null};
  const drafts=[
   {sourceIssueKey:source.key,title:'Rechazo por contraseña no válida',steps:['Ingresar dato no válido en "Dato"','Validar que se muestre "Error de credenciales"','Validar "Resumen de productos" no visible'],expectedResult:'El "Resumen de productos" no está visible después del rechazo de credenciales.'},
   {sourceIssueKey:source.key,title:'Rechazo por código no válido',steps:['Ingresar dato no válido en "Código"','Validar que se muestre "Error del código"','Validar "Resumen de productos" no visible'],expectedResult:'El "Resumen de productos" no está visible después del rechazo del código.'},
   {sourceIssueKey:source.key,title:'Rechazo por token no válido',steps:['Ingresar dato no válido en "Token"','Validar que se muestre "Error del token"','Validar "Comprobante exitoso" no visible'],expectedResult:'El "Comprobante exitoso" no está visible después del rechazo del token.'},
  ];
  let calls=0;
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){calls++;return {rawText:'',parsedJson:{scenarios:drafts},model:'fixture',providerName:'fixture',durationMs:0};}};
  const generated=await generateJiraScenarios([source],appSlug,provider);
  assert.equal(calls,1);
  assert.equal(generated.scenarios.length,3);
  assert.deepEqual(generated.scenarios.map(scenario=>scenario.validation.errors),[[],[],[]]);
 }
});

test('a missing conditional assertion is repaired from the source and reaches review with its new index',async()=>{
 for(const appSlug of ['fixture-shop','fixture-service']) {
  const draft={sourceIssueKey:issue.key,title:'Completed operation',preconditions:[],steps:['Validar "Summary"','Validar "Done"','Validar que no se muestre "Resultado"'],expectedResult:'Done',acceptanceCriteriaRefs:['AC1','AC2']};
  let calls=0;
  let syntaxRepairs=0;
  const coverageRequests:Array<{missingClauses:Array<{id:string}>}>=[];
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(request){
   calls++;
   if(calls===1) return {rawText:'',parsedJson:{scenarios:[draft]},model:'fixture',providerName:'fixture',durationMs:0};
   const payload=JSON.parse(request.messages[1].content);
   if(!payload.syntaxFailures){
    // Draft declares AC1 and AC2, so any coverage request here is unexpected.
    coverageRequests.push(...payload.issues);
    return {rawText:'',parsedJson:{scenarios:[]},model:'fixture',providerName:'fixture',durationMs:0};
   }
   syntaxRepairs++;
   assert.ok(payload.syntaxFailures.some((failure:{reason:string})=>failure.reason==='JIRA_CONDITION_ASSERTION_MISSING'));
   return {rawText:'',parsedJson:{scenarios:[{...payload.scenarios[0],steps:['Validar "Summary"','Validar "Cargo"','Validar "Done"','Validar que no se muestre "Resultado"']}]},model:'fixture',providerName:'fixture',durationMs:0};
  }};
  const result=await generateJiraScenarios([issue],appSlug,provider);
  assert.equal(calls,2,`unexpected provider calls; coverage requests: ${JSON.stringify(coverageRequests.map(issue=>issue.missingClauses.map(clause=>clause.id)))}`);
  assert.equal(syntaxRepairs,1);
  assert.deepEqual(coverageRequests,[]);
  assert.equal(result.scenarios[0].validation.valid,true);
  assert.deepEqual(result.scenarios[0].conditionRequirements?.[0].stepIndices,[2]);
 }
});

test('an unsupported failure setup stays unresolved when the source supplies no mechanism',async()=>{
 const source={...issue,description:'No se muestra Resultado cuando la operación no se completa.'};
 const draft={sourceIssueKey:source.key,title:'Operación no completada',preconditions:[],steps:['Ingresar dato en "Dato"','Validar "Error"','Validar "Resultado" no está presente'],expectedResult:'No se muestra Resultado',acceptanceCriteriaRefs:[]};
 const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(request){
  const repair=JSON.parse(request.messages[1].content);
  const corrections=repair.scenarios?.map((candidate:typeof draft)=>({...candidate,steps:['Ingresar dato no válido en "Dato"',...candidate.steps.slice(1)]}));
  return {rawText:'',parsedJson:{scenarios:corrections ?? [draft]},model:'fixture',providerName:'fixture',durationMs:0};
 }};
 const result=await generateJiraScenarios([source],'fixture-app',provider);
 assert.ok(result.scenarios[0].validation.errors.includes('JIRA_FAILURE_SETUP_UNSPECIFIED'));
 assert.equal(result.scenarios[0].validation.valid,false);
 assert.notEqual(result.scenarios[0].inputRequirements?.[0].dataCondition,'invalid');
});

test('malformed screen preconditions can be repaired into a self-contained journey with concrete data requirements',async()=>{
 for(const appSlug of ['fixture-shop','fixture-service']) {
  const source={...issue,description:'El cliente ingresa Usuario y Contraseña, presiona Acceder y consulta Resultado.'};
  const draft={sourceIssueKey:source.key,title:'Consulta',preconditions:['"Pantalla de acceso"'],steps:['Presionar "Consulta"','Validar "Resultado"'],expectedResult:'Resultado',acceptanceCriteriaRefs:[]};
  let calls=0;
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(request){
   calls++;
   if(calls===1) return {rawText:'',parsedJson:{scenarios:[draft]},model:'fixture',providerName:'fixture',durationMs:0};
   const payload=JSON.parse(request.messages[1].content);
   assert.ok(payload.syntaxFailures.some((failure:{reason:string})=>failure.reason==='JIRA_PRECONDITION_NOT_OBSERVABLE'));
   return {rawText:'',parsedJson:{scenarios:[{...payload.scenarios[0],preconditions:[],steps:['Ingresar usuario en "Usuario"','Ingresar contraseña en "Contraseña"','Presionar "Acceder"',...draft.steps]}]},model:'fixture',providerName:'fixture',durationMs:0};
  }};
  const result=await generateJiraScenarios([source],appSlug,provider);
  assert.equal(calls,2);
  assert.equal(result.scenarios[0].validation.valid,true);
  assert.deepEqual(result.scenarios[0].preconditions,[]);
  assert.deepEqual(result.scenarios[0].inputRequirements?.map(field=>field.label),['Usuario','Contraseña']);
  assert.ok(result.scenarios[0].steps.includes('Presionar "Acceder"'));
 }
});

test('declared required data is checked before navigation instead of using authored prose as input',async()=>{
 const steps=['Ingresar usuario en "Usuario"','Ingresar contraseña en "Contraseña"','Presionar "Acceder"','Validar que se muestre "Resultado"'];
 const input={scenarioId:'HU-101:jira:1',sourceIssueKey:'HU-101',title:'Acceso',steps,expectedResult:'Resultado',inputRequirements:deriveJiraInputRequirements(steps)};
 let navigations=0;
 const browser:JiraBrowserPort={async navigate(){navigations++;},async act(){return {strategy:'css',value:'#field'};},async assert(target){return {observedText:target};}};
 await assert.rejects(discoverJiraScenario(input,browser),/JIRA_REQUIRED_DATA_MISSING:Usuario/);
 assert.equal(navigations,0);
 const values=Object.fromEntries(input.inputRequirements.map(field=>[field.key,'synthetic-data']));
 await discoverJiraScenario(input,browser,values);
 assert.equal(navigations,1);
});
