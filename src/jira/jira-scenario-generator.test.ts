import test from "node:test";
import assert from "node:assert/strict";
import { jiraScenarioQualityGaps, buildJiraScenarioMessages, generateJiraScenarios, normalizeJiraGeneratedSteps, bindLearnedChallengeControls, jiraAcceptanceClauses, clauseCoverageGuidance, repairMissingDestinationAssertions, linkDistinctionCoverage, uncoveredAcceptanceClauses, auditGeneratedJiraSyntax, alignRepairedNegativeExpectedResult } from "./jira-scenario-generator";
import { deriveJiraInputRequirements } from "./jira-input-requirements";
import { prepareJiraGenerationDrafts } from "./jira-generation-preparation";
import { parseStepIntent } from "../discovery/step-intent-parser";
import type { AiProvider } from "../ai/ai-provider.types";
import type { JiraIssueSource } from "../scenarios/scenario-types";
import {jiraRepairPreservesActions} from './jira-scenario-generator';
import { JIRA_STEP_DELIVERY_INSTRUCTIONS } from './jira-step-delivery';

test('syntax repair preserves ordered authentication and business actions when multiple checks fail',async()=>{
 const source={...issue,description:'El cliente ingresa Usuario y un Token no válido para comprobar el rechazo.'};
 const draft={sourceIssueKey:source.key,title:'Rechazo de token no válido',steps:['Abrir la aplicación configurada del proyecto','Ingresar usuario en "Usuario"','Completar todos los campos del token','Validar que se muestre "Rechazo"'],expectedResult:'Rechazo'};
 let calls=0; const provider=fakeProvider([]);
 provider.completeJson=async(request)=>{
  assert.ok(request.messages[0].content.includes(JIRA_STEP_DELIVERY_INSTRUCTIONS),'initial generation and syntax repair share the delivery contract');
  return {rawText:'',model:'fixture',providerName:'fixture',durationMs:0,parsedJson:{scenarios:++calls===1?[draft]:[{...draft,steps:['Abrir la aplicación configurada del proyecto','Ingresar un token no válido en "Token"','Validar que se muestre "Rechazo"']}]}};
 };
 const result=await generateJiraScenarios([source],'fixture-profile',provider);
 assert.equal(calls,2);
 assert.ok(result.scenarios[0].steps.includes('Ingresar usuario en "Usuario"'));
 assert.equal(result.scenarios[0].validation.valid,false);
});

test('repair action lineage retains repeated submits, input conditions and order while permitting assertion edits',()=>{
 const steps=['Ingresar usuario en "Usuario"','Presionar "Iniciar sesión"','Ingresar código en "Código de acceso"','Presionar "Continuar"','Presionar "Operaciones"','Ingresar un token no válido en "Token"','Presionar "Continuar"','Validar que se muestre "Error"'];
 const original={steps};
 assert.equal(jiraRepairPreservesActions(original,{steps:[...steps.slice(0,-1),'Validar que se muestre "problema del token"']},[{stepIndex:8}]),true);
 for(let index=0;index<7;index++) assert.equal(jiraRepairPreservesActions(original,{steps:steps.filter((_,i)=>i!==index)},[{stepIndex:8}]),false,`removed action ${index+1}`);
 assert.equal(jiraRepairPreservesActions(original,{steps:[steps[1],steps[0],...steps.slice(2)]},[{stepIndex:8}]),false);
 assert.equal(jiraRepairPreservesActions(original,{steps:steps.map(step=>step.replace('token no válido','token válido'))},[{stepIndex:8}]),false);
 assert.equal(jiraRepairPreservesActions(original,{steps:steps.map((step,index)=>index===1?'Presionar "Acceder"':step)},[{stepIndex:2}]),true);
});

test('generation syntax audit exercises source conditional review before presenting an executable draft',async()=>{
 const source={...issue,description:'AC1 — Resumen\nEl resumen muestra el monto, la comisión cuando aplique.'};
 const draft={sourceIssueKey:source.key,title:'Revisión',acceptanceCriteriaRefs:['AC1.1'],steps:['Abrir la aplicación configurada del proyecto','Validar que se muestre "Comisión" en otra pantalla.','Validar que se muestre "Done"'],expectedResult:'Done'};
 const failures=await auditGeneratedJiraSyntax([draft],[source]);
 assert.ok(failures.some(failure=>failure.reason==='JIRA_CONDITION_STEP_UNSUPPORTED' && failure.stepIndex===2 && failure.step===draft.steps[1]));
 const generated=await generateJiraScenarios([source],'fixture-profile',fakeProvider([draft]));
 assert.ok(generated.scenarios[0].validation.issues?.some(issue=>issue.code==='JIRA_CONDITION_STEP_UNSUPPORTED' && issue.stepIndex===2 && issue.step===draft.steps[1]));
 assert.deepEqual(await auditGeneratedJiraSyntax([{...draft,steps:[draft.steps[0],'Validar que se muestre "Comisión" en la confirmación.',draft.steps[2]]}],[source]),[]);
});

const issue: JiraIssueSource = {key:"HU-1",summary:"Acceso y operación",description:"El usuario inicia sesión y autoriza una operación con otro código.",acceptanceCriteria:"",labels:[],components:[],status:"Open",issueType:"Story"};

test('generation audits, repairs and revalidates negative authentication before delivering the journey',async()=>{
 for(const [user,password,login,area] of [['Usuario','Contraseña','Iniciar sesión','Transferencias'],['Username','Password','Sign in','Inventory']]) {
  for(const repair of [true,false]) {
   const source={...issue,summary:'Rechazo de acceso',description:`Ingresar credenciales en "${user}" y "${password}" y presionar "${login}". Si son inválidas se muestra "Rechazo" y no se muestra "Resultado exitoso".`};
   const prefix=['Abrir la aplicación configurada del proyecto',`Ingresar usuario no válido en "${user}".`,`Ingresar contraseña en "${password}".`,`Presionar "${login}".`];
   const outcome=['Validar que se muestre "Rechazo"','Validar que no se muestre "Resultado exitoso"'];
   const bad={sourceIssueKey:source.key,title:'Rechazo de credenciales inválidas',steps:[...prefix,`Presionar "${area}"`,'Presionar "Otra operación"',...outcome],expectedResult:'No se muestra "Resultado exitoso".'};
   const syntax=await auditGeneratedJiraSyntax([bad],[source]);
   assert.deepEqual(syntax.map(failure=>failure.stepIndex),[5,6]);
   assert.ok(syntax.every(failure=>failure.reason==='JIRA_ACTION_AFTER_REJECTED_AUTHENTICATION'));
   let calls=0;
   const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(request){
    calls++;
    if(calls>1) {
     const payload=JSON.parse(request.messages[1].content);
     assert.ok(payload.syntaxFailures.some((failure:{reason:string})=>failure.reason==='JIRA_ACTION_AFTER_REJECTED_AUTHENTICATION'));
     assert.ok('learnedNavigation' in payload,'repair retains shared project knowledge context');
    }
    return {rawText:'',parsedJson:{scenarios:[{...bad,steps:repair&&calls>1?[...prefix,...outcome]:bad.steps}]},model:'fixture',providerName:'fixture',durationMs:0};
   }};
   const result=await generateJiraScenarios([source],'fixture',provider,{loginMode:'password'});
   assert.equal(calls,2);
   assert.equal(result.scenarios.length,1);
   assert.equal(result.scenarios[0].validation.valid,repair,JSON.stringify(result.scenarios[0].validation));
   assert.deepEqual(result.scenarios[0].steps,repair?[...prefix,...outcome]:bad.steps);
   if(!repair) assert.ok(result.scenarios[0].validation.errors.includes('JIRA_ACTION_AFTER_REJECTED_AUTHENTICATION'));
  }
 }
});

test('negative journey audit preserves explicit credential recovery and transaction failures after valid login',async()=>{
 for(const [user,password,login,area] of [['Usuario','Contraseña','Iniciar sesión','Transferencias'],['Username','Password','Sign in','Inventory']]) {
  const prefix=['Abrir la aplicación configurada del proyecto',`Ingresar usuario no válido en "${user}".`,`Ingresar contraseña en "${password}".`,`Presionar "${login}".`,'Validar que se muestre "Rechazo"'];
  const corrected=[...prefix,`Ingresar usuario en "${user}".`,`Presionar "${login}".`,`Presionar "${area}"`,'Validar que se muestre "Done"'];
  assert.deepEqual(await auditGeneratedJiraSyntax([{sourceIssueKey:issue.key,title:'Recuperación explícita',steps:corrected,expectedResult:''}]),[]);
  const incomplete=[...prefix,`Ingresar usuario en "${user}".`,`Presionar "${area}"`,'Validar que se muestre "Done"'];
  assert.ok((await auditGeneratedJiraSyntax([{sourceIssueKey:issue.key,title:'Recuperación incompleta',steps:incomplete,expectedResult:''}])).some(failure=>failure.reason==='JIRA_ACTION_AFTER_REJECTED_AUTHENTICATION'));
  const transaction=[...prefix.slice(0,4).map(step=>step.replace('usuario no válido','usuario')),`Presionar "${area}"`,
   'Ingresar token no válido en "Token"','Presionar "Autorizar"','Validar que se muestre "Rechazo"','Validar que no se muestre "Resultado exitoso"'];
  assert.deepEqual(await auditGeneratedJiraSyntax([{sourceIssueKey:issue.key,title:'Rechazo de operación',steps:transaction,expectedResult:''}]),[]);
 }
});
test("Jira output instructions require one structured response with inline context", () => {
  const systemPrompt = buildJiraScenarioMessages([issue], "fixture-profile")[0].content;
  assert.match(systemPrompt, /Return the complete result as one valid JSON response matching the provided schema/);
  assert.match(systemPrompt, /No file inspection, file edits, commands or tool calls are needed/);
  assert.match(systemPrompt, /Request a security token by SMS as Solicitar el token por SMS only when the source names SMS/);
  assert.doesNotMatch(systemPrompt, /Use Presionar for tabs, links, buttons and requesting SMS/);
  assert.match(systemPrompt, /Do not add a separate click named "acceso al portal"/);
  assert.match(systemPrompt, /include an explicit continue action between the summary assertions and the later-screen assertion/);
  assert.match(systemPrompt, /adding a row is not equivalent to completing it: after creating a row, explicitly enter or select its required values/);
  assert.match(systemPrompt, /Treat each new row independently/);
  assert.match(systemPrompt, /If the source explicitly describes filling the first row and then adding a second row, treat the first row as already present/);
  assert.match(systemPrompt, /To test an incomplete newly added row, first complete the pre-existing row/);
  assert.match(systemPrompt, /Field-level validation is supported only with this exact syntax: Validar que el campo/);
  assert.match(systemPrompt, /uniquely identified control is invalid and has an associated visible or ARIA-linked error/);
  assert.match(systemPrompt, /Do not assert structural row counts or empty-row structure as simple visible text/);
  assert.match(systemPrompt, /Never validate a menu item by asserting its label as page content/);
  assert.match(systemPrompt, /activate the menu item and assert an observable result on the destination screen/);
  assert.match(systemPrompt, /After asserting the story's final success\/result screen, add no further navigation or action unless the story explicitly requires it/);
});
test('duplicate repair accepts only the bounded proposal and preserves every other requirement',async()=>{
 for(const approve of [true,false]) {
  const block=['Validar que se muestre "Fee"','Validar que se muestre "Total"','Presionar "Continue"'];
  const steps=[...block,...block,'Validar que se muestre "Done"'];
  let calls=0;
  const result=await generateJiraScenarios([issue],'fixture-profile',{providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(request){
   calls++;
   if(calls===1) return {rawText:'',parsedJson:{scenarios:[{sourceIssueKey:'HU-1',title:'Result',steps,expectedResult:'Done'}]},model:'fixture',providerName:'fixture',durationMs:0};
   const payload=JSON.parse(request.messages[1].content);
   assert.equal(payload.drafts.length,1);
   return {rawText:'',parsedJson:{scenarios:[{candidateId:'draft-1',sourceIssueKey:'HU-1',steps:approve ? payload.drafts[0].proposed.steps : ['Validar que se muestre "Done"']}]},model:'fixture',providerName:'fixture',durationMs:0};
  }});
  assert.equal(calls,2);
  assert.deepEqual(result.scenarios[0].steps,approve ? [...block,'Validar que se muestre "Done"'] : steps);
  assert.equal(result.scenarios[0].validation.errors.includes('JIRA_REPEATED_ASSERTION_BLOCK'),!approve);
 }
});
function fakeProvider(scenarios: unknown[]): AiProvider {
  return { providerType: "fake", providerName: "fixture", model: "fixture", completeJson: async () => ({ rawText: "", parsedJson: { scenarios }, model: "fixture", providerName: "fixture", durationMs: 0 }) };
}

test('conditional wording is repaired before coverage while source applicability remains declared',async()=>{
 const source={...issue,description:'Mostrar Comisión cuando aplique.',acceptanceCriteria:'AC1 — Resumen\nMostrar Comisión cuando aplique.'};
 const draft={sourceIssueKey:source.key,title:'Consultar resumen',steps:['Abrir la aplicación configurada del proyecto','Presionar "Consultar"','Validar que se muestre "Comisión" cuando aplique','Validar que se muestre "Resultado"'],expectedResult:'Resultado',acceptanceCriteriaRefs:['AC1.1']};
 for(const repair of [true,false]){
  let calls=0;let reported=false;
  const provider=fakeProvider([]);
  provider.completeJson=async request=>{
   calls++;
   if(calls>1){
    const payload=JSON.parse(request.messages[1].content);
    reported ||= (payload.syntaxFailures??[]).some((failure:{reason:string})=>failure.reason==='JIRA_CONDITION_STEP_UNSUPPORTED');
   }
   const corrected=repair&&calls>1?{...draft,steps:draft.steps.map(step=>step.replace(' cuando aplique',''))}:draft;
   return {rawText:'',parsedJson:{scenarios:[corrected]},model:'fixture',providerName:'fixture',durationMs:0};
  };
  const result=await generateJiraScenarios([source],'fixture-profile',provider);
  assert.equal(reported,false,'source-backed bounded applicability is normalized without an AI syntax repair');
  const scenario=result.scenarios[0];
   assert.equal(scenario.validation.valid,true,JSON.stringify(scenario.validation.errors));
   assert.ok(scenario.conditionRequirements?.some(condition=>condition.sourceClause.includes('cuando aplique')&&condition.stepIndices.includes(3)));
   assert.deepEqual(uncoveredAcceptanceClauses(source,result.scenarios),[]);
 }
});

test('late access-verification assertion reaches repair with knowledge context and cannot pass unchanged',async()=>{
 const source={...issue,description:'La aplicación muestra la pantalla de verificación de usuario y permite ingresar el código de acceso para continuar.'};
 const open='Abrir la aplicación configurada del proyecto';
 const verify='Validar que se muestre "verificación de usuario"';
 const draft={sourceIssueKey:source.key,title:'Acceso',steps:[open,'Ingresar contraseña en "Contraseña"','Presionar "Ingresar"','Ingresar código en "Código de acceso"','Presionar "Continuar"',verify,'Validar que se muestre "Resumen"'],expectedResult:'Resumen'};
 for(const repaired of [true,false]){
  let calls=0;let failure:unknown;
  const provider=fakeProvider([]);
  provider.completeJson=async request=>{
   calls++;
   if(calls>1){try{const payload=JSON.parse(request.messages[1].content);assert.ok(payload.syntaxFailures.some((item:any)=>item.reason==='JIRA_AUTH_STAGE_ORDER_INVALID'));assert.ok(Array.isArray(payload.learnedNavigation));}catch(error){failure=error;throw error;}}
   const steps=repaired&&calls>1?[...draft.steps.slice(0,3),verify,...draft.steps.slice(3,5),draft.steps[6]]:draft.steps;
   return {rawText:'',parsedJson:{scenarios:[{...draft,steps}]},model:'fixture',providerName:'fixture',durationMs:0};
  };
  const result=await generateJiraScenarios([source],'fixture-profile',provider);
  if(failure)throw failure;
  assert.ok(calls>1);
  assert.equal(result.scenarios[0].validation.valid,repaired,JSON.stringify(result.scenarios[0].validation.errors));
  if(!repaired)assert.ok(result.scenarios[0].validation.errors.includes('JIRA_AUTH_STAGE_ORDER_INVALID'));
 }
});
test("Jira uses full story prose and keeps explicit login, both challenges and per-step inputs", async () => {
  const steps=['Ingresar usuario en "Usuario"','Ingresar contraseña en "Contraseña"','Ingresar código en "SMS"','Presionar "Continuar"','Ingresar código en "SMS"','Validar que se muestre "Comprobante"'];
  const provider = fakeProvider([{sourceIssueKey:'HU-1',title:'Operación completa',steps,expectedResult:'Comprobante',acceptanceCriteriaRefs:['AC1','AC2']}]);
  const result=await generateJiraScenarios([issue],'app-a',provider);
  assert.deepEqual(result.scenarios[0].steps,steps);
  assert.equal(result.scenarios[0].inputRequirements?.length,4);
  assert.notEqual(result.scenarios[0].inputRequirements?.[2].key,result.scenarios[0].inputRequirements?.[3].key);
  assert.equal(result.scenarios[0].mcpExecutable,false);
  assert.equal(result.scenarios[0].executionReadiness,'requires_discovery');
  assert.equal(result.scenarios[0].authIntent,undefined);
  assert.match(buildJiraScenarioMessages([issue],'app-a')[1].content,/autoriza una operación/);
});
test('generation removes an unsupported new-row assertion only when a later row-specific field action exists',async()=>{
 const source={...issue,key:'HU-ROW',summary:'Add a repeated form row',description:'Add a new row and allow the user to select its type.',acceptanceCriteria:''};
 const draft={sourceIssueKey:'HU-ROW',title:'Select a value in the added row',steps:[
  'Presionar "Agregar fila"',
  'Validar que se muestre "una nueva fila de ingreso"',
  'Seleccionar en la segunda fila el campo "Tipo" con un valor ficticio válido',
  'Validar que se muestre "Detalle"',
 ],expectedResult:'The row type is selected and the details are displayed.'};
 const result=await generateJiraScenarios([source],'app-a',fakeProvider([draft]));
 assert.equal(result.scenarios.length,1);
 assert.deepEqual(result.scenarios[0].steps,[draft.steps[0],draft.steps[2],draft.steps[3]]);
 assert.equal(result.scenarios[0].validation.valid,true);
 assert.equal(result.scenarios[0].executionReadiness,'requires_discovery');
});
test("Jira generation is profile-agnostic and preserves each requested app profile", async () => {
  const steps=['Abrir la aplicación configurada del proyecto','Ingresar usuario en "Usuario"','Seleccionar USD en "Moneda"','Validar que se muestre "Operación completada"'];
  for (const appSlug of ['fenix', 'portal-comercial']) {
    let requestedProfile = '';
    const provider = fakeProvider([{sourceIssueKey:'HU-1',title:'Operación',steps,expectedResult:'Operación completada',acceptanceCriteriaRefs:['AC1']}]);
    const complete = provider.completeJson;
    provider.completeJson = async request => {
      requestedProfile = JSON.parse(request.messages[1].content).appSlug;
      return complete(request);
    };
    const result = await generateJiraScenarios([issue], appSlug, provider);
    assert.equal(requestedProfile, appSlug);
    assert.equal(result.scenarios[0].appSlug, appSlug);
    assert.deepEqual(result.scenarios[0].steps, steps);
    assert.equal(result.scenarios[0].inputRequirements?.[0].stepIndex, 2);
    assert.equal(result.scenarios[0].inputRequirements?.[0].key, 'jira_step_2');
    assert.equal(result.scenarios[0].inputRequirements?.[1].stepIndex, 3);
    assert.equal(result.scenarios[0].inputRequirements?.[1].operation, 'select');
  }
});
test('Jira generation inserts a missing review transition and removes unsupported actions after the final result across profiles',async()=>{
 const source={...issue,description:'El cliente consulta un resumen de confirmación y revisa esa información antes de continuar a la autorización.',acceptanceCriteria:'AC6: Fenix permite revisar el resumen antes de continuar y luego muestra la pantalla de validación de identidad. AC7: Cuando la transferencia concluye, Fenix muestra el comprobante de transacción exitosa con monto, cuentas y referencia.'};
 const draft={sourceIssueKey:source.key,title:'Transferencia exitosa',acceptanceCriteriaRefs:['AC6','AC7'],expectedResult:'Se muestra el comprobante de transacción exitosa con monto y referencia.',steps:[
  'Abrir la aplicación configurada del proyecto',
  'Validar que se muestre "resumen de confirmación"',
  'Validar que se muestre "total a debitar"',
  'Validar que se muestre "validación de identidad"',
  'Solicitar el token por SMS',
  'Ingresar token en "token de seguridad"',
  'Presionar "autorizar transferencia"',
  'Validar que se muestre "comprobante de transacción exitosa"',
  'Validar que se muestre "monto"',
  'Presionar "continuar"',
  'Validar que se muestre "referencia"',
 ]};
 for(const appSlug of ['app-alpha','app-beta']) {
  const result=await generateJiraScenarios([source],appSlug,fakeProvider([{...draft}]));
  const scenario=result.scenarios[0];
  const summaryIndex=scenario.steps.findIndex(step=>step.includes('resumen de confirmación'));
  const identityIndex=scenario.steps.findIndex(step=>step.includes('validación de identidad'));
  const receiptIndex=scenario.steps.findIndex(step=>step.includes('comprobante de transacción exitosa'));
  assert.equal(scenario.appSlug,appSlug);
  assert.ok(identityIndex>summaryIndex+1);
  assert.match(scenario.steps[identityIndex-1],/Presionar .*continuar/i);
  assert.equal(scenario.steps.slice(receiptIndex+1).some(step=>/^Presionar\b/.test(step)),false);
  assert.deepEqual(scenario.steps.slice(-2),['Validar que se muestre "monto"','Validar que se muestre "referencia"']);
 }
});
test("a second project cannot borrow another story's source identity", async () => {
  const provider=fakeProvider([{sourceIssueKey:'OTHER-2',title:'Invalid',steps:['Validar que se muestre "Detalle"']}]);
  await assert.rejects(generateJiraScenarios([issue],'app-b',provider),/REQUIRE_OBSERVABLE_RESULT/);
});
test("an unresolved conditional is retained for review instead of being certified as executable", async () => {
  let calls=0;
  const provider=fakeProvider([{sourceIssueKey:'HU-1',title:'Conditional',steps:['Cuando aparezca SMS, solicitar el código.', 'Validar que se muestre "Detalle"'],expectedResult:'Detalle'}]);
  const complete=provider.completeJson;
  provider.completeJson=async request=>{calls++; return complete(request);};
  const result=await generateJiraScenarios([issue],'app-b',provider);
  assert.equal(calls,2);
  assert.equal(result.scenarios[0].validation.valid,false);
  assert.equal(result.scenarios[0].executionReadiness,'blocked_syntax');
  assert.equal(result.scenarios[0].mcpExecutable,false);
});
test("an unquoted positive visibility subject is preserved without changing negative requirements", () => {
  assert.deepEqual(normalizeJiraGeneratedSteps(['Validar que se muestre el resumen de productos.', 'Validar que no se permita continuar.', 'Revisar la información de la transferencia']),
    ['Validar que se muestre "el resumen de productos"','Validar que no se permita continuar.', 'Validar que se muestre "la información de la transferencia"']);
});
test("semantic security-channel pseudo-controls become supported request actions", () => {
 assert.deepEqual(normalizeJiraGeneratedSteps([
  'Presionar "el código por SMS"',
  'Pulsar "el token por SMS"',
  'Hacer clic en "the verification code by email"',
 ]),[
  'Solicitar el código por SMS',
  'Solicitar el token por SMS',
  'Solicitar el código por correo electrónico',
 ]);
 const explicitlyNamed={...issue,description:'El control se llama "el código por SMS".',acceptanceCriteria:null};
 assert.deepEqual(normalizeJiraGeneratedSteps(['Presionar "el código por SMS"'],explicitlyNamed),['Presionar "el código por SMS"']);
});
test("a validated observed challenge control binds only to its same-issue code or token field across app profiles",()=>{
 for(const profile of ['profile-alpha','profile-beta']){
  const issueKey=`${profile.toUpperCase()}-17`;
  const route={sourceIssueKey:issueKey,actions:[
   {action:'click',field:profile==='profile-alpha'?'SMS':'Enviar código',targetKind:'observed_control'},
   {action:'fill',field:'Código',targetKind:undefined},
   {action:'click',field:'SMS',targetKind:'semantic_request'},
   {action:'fill',field:'Token',targetKind:undefined},
  ]};
  const steps=['Solicitar el código por SMS','Ingresar el código de acceso en "Código"','Solicitar el token por SMS','Ingresar token de autorización en "Token"'];
  assert.deepEqual(bindLearnedChallengeControls(steps,[route],issueKey),[
   `Presionar "${profile==='profile-alpha'?'SMS':'Enviar código'}"`,
   steps[1],
   steps[2],
   steps[3],
  ]);
  assert.deepEqual(bindLearnedChallengeControls(steps,[route],`${profile.toUpperCase()}-18`),steps,'another issue cannot donate a control');
 }
});
test("Jira continuation rationale remains one explicit click through syntax audit", async()=>{
 const raw='Presionar "Continuar" para avanzar después de revisar la confirmación.';
 const [step]=normalizeJiraGeneratedSteps([raw]);
 assert.equal(step,'Presionar "Continuar"');
 assert.equal(parseStepIntent(raw).length,2);
 assert.equal(parseStepIntent(step).length,1);
 const failures=await auditGeneratedJiraSyntax([{sourceIssueKey:issue.key,title:'Revisar confirmación',steps:['Abrir la aplicación configurada del proyecto',step,'Validar que se muestre "Comprobante"'],expectedResult:'Se muestra el comprobante.'}],[issue]);
 assert.deepEqual(failures,[]);
});
test("profile choices and submit labels stay clicks instead of becoming runtime data inputs",()=>{
 const source={...issue,description:'El cliente puede elegir el perfil Personal y después avanzar hasta la revisión.',acceptanceCriteria:null};
  assert.deepEqual(normalizeJiraGeneratedSteps(['Seleccionar "Personal"','Seleccionar el perfil de acceso "Empresarial"','Seleccionar "Continuar"','Seleccionar "Enviar"','Seleccionar "Agregar ingreso"','Seleccionar "Estado civil"'],source),
   ['Presionar "Personal"','Presionar "Empresarial"','Presionar "Continuar"','Presionar "Enviar"','Presionar "Agregar ingreso"','Seleccionar "Estado civil"']);
});
test("bare profile selection becomes a click and yields no input requirement, form select stays",()=>{
 const steps=normalizeJiraGeneratedSteps(['Seleccionar el perfil "Personal"','Elegir el perfil acceso "Empresarial"','Seleccionar un valor válido en el campo "Tipo de documento"']);
 assert.deepEqual(steps,['Presionar "Personal"','Presionar "Empresarial"','Seleccionar un valor válido en el campo "Tipo de documento"']);
 assert.deepEqual(deriveJiraInputRequirements(steps).map(f=>f.label),["Tipo de documento"]);
});
test("quoted-first absence wording is normalized to a supported negative observation",()=>{
 assert.equal(normalizeJiraGeneratedSteps(['Validar que "Solicitud recibida" no esté visible.'])[0],'Validar que no se muestre "Solicitud recibida"');
});
test("negative 'no se presenta' outcome is normalized without triggering a repair that duplicates the final assertion", async () => {
  const source: JiraIssueSource = {...issue,description:'AC8 — Errores: si las credenciales no son válidas, se informa el problema y no se presenta la operación como exitosa.',acceptanceCriteria:null};
  const steps=['Ingresar una contraseña no válida en "Contraseña"','Presionar "Iniciar sesión"','Validar "problema de credenciales"','Validar que no se presenta "operación exitosa"'];
  let calls=0;
  const provider=fakeProvider([{sourceIssueKey:'HU-1',title:'Rechazo de inicio de sesión con contraseña no válida',steps,expectedResult:'Se informa el problema y no se presenta una operación exitosa.',acceptanceCriteriaRefs:['AC8.1']}]);
  const complete=provider.completeJson;
  provider.completeJson=async request=>{calls++;return complete(request);};
  const result=await generateJiraScenarios([source],'app-b',provider);
  assert.equal(calls,1);
  assert.equal(result.scenarios.length,1);
  assert.deepEqual(result.scenarios[0].steps.slice(-2),['Validar que se muestre "problema de credenciales"','Validar que no se muestre "operación exitosa"']);
  assert.equal(result.scenarios[0].validation.valid,true);
});
test("syntax repair cannot remove a candidate or switch its Jira source", async () => {
  let calls=0;
  const provider=fakeProvider([]);
  provider.completeJson=async () => ({rawText:'',model:'fixture',providerName:'fixture',durationMs:0,parsedJson:{scenarios:++calls===1 ? [
    {sourceIssueKey:'HU-1',title:'First',steps:['Cuando aparezca SMS, solicitar el código.','Validar que se muestre "Detalle"']},
    {sourceIssueKey:'HU-1',title:'Second',steps:['Validar que se muestre "Comprobante"']},
  ] : [{candidateId:'draft-1',sourceIssueKey:'OTHER-2',title:'Wrong source',steps:['Validar que se muestre "Detalle"']}]}});
  const result=await generateJiraScenarios([issue],'app-b',provider);
  assert.deepEqual(result.scenarios.map(s=>s.title),['First','Second']);
  assert.ok(result.scenarios.every(s=>s.sourceIssueKey==='HU-1'));
});
test("syntax repair correlates an omitted candidate id by unique source and title, preserving all scenarios and metadata", async () => {
  let calls=0;
  const provider=fakeProvider([]);
  provider.completeJson=async () => ({rawText:'',model:'fixture',providerName:'fixture',durationMs:0,parsedJson:{scenarios:++calls===1 ? [
    {sourceIssueKey:'HU-1',title:'Happy path',steps:['Presionar "Continuar"','Validar que se muestre "Comprobante"'],expectedResult:'Comprobante',acceptanceCriteriaRefs:['AC1']},
    {sourceIssueKey:'HU-1',title:'SMS challenge',steps:['Cuando aparezca SMS, solicitar el código.','Validar que se muestre "Detalle"'],expectedResult:'Detalle',acceptanceCriteriaRefs:['AC2']},
  ] : [
    // File-output providers can omit the generated correlation id and unchanged metadata.
    {sourceIssueKey:'HU-1',title:'SMS challenge',steps:['Presionar "SMS"','Validar que se muestre "Detalle"'],expectedResult:'Detalle',acceptanceCriteriaRefs:['AC-OTHER']},
  ]}});
  const result=await generateJiraScenarios([issue],'app-b',provider);
  assert.equal(calls,2);
  assert.deepEqual(result.scenarios.map(s=>s.title),['Happy path','SMS challenge']);
  assert.deepEqual(result.scenarios[1].acceptanceCriteriaRefs,['AC2']);
  assert.equal(result.scenarios[1].validation.valid,true);
});
test("separate negative acceptance sentences stay separate source obligations", () => {
  const source={...issue,description:'AC8 — Errores\nSi el código no es válido, se informa el problema y no se muestra un resultado exitoso. Si la operación no se completa, tampoco se muestra un comprobante.\nConsideraciones para desarrollo\nUsar datos sintéticos.',acceptanceCriteria:null};
  assert.deepEqual(jiraAcceptanceClauses(source).map(c=>c.id),['AC8.1','AC8.2']);
  assert.match(jiraAcceptanceClauses(source)[1].text,/operación no se completa/);
});

test("acceptance criteria parser reads Jira inline AC markers and splits independent sentences",()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Resumen personal\nEl cliente consulta sus movimientos. Puede filtrar por fecha; también exportar el resultado.\nAC2 — Sin resultados\nSi no hay coincidencias, se informa al cliente."};
 assert.deepEqual(jiraAcceptanceClauses(source).map(clause=>clause.id),["AC1.1","AC1.2","AC2.1"]);
 assert.match(jiraAcceptanceClauses(source)[0].text,/consulta sus movimientos/);
 assert.deepEqual(jiraAcceptanceClauses({...issue,description:"",acceptanceCriteria:"AC1: Acceso. AC2: Autorización."}).map(clause=>clause.id),["AC1.1","AC2.1"]);
});

test("acceptance parser stops formal AC coverage before appended journey and stress sections",()=>{
 const source={...issue,acceptanceCriteria:null,description:"AC13 — Carga y persistencia\nAl avanzar entre secciones se observa el estado de carga. Los datos permanecen al volver.\nRecorrido positivo detallado\nCompletar el formulario y enviar la solicitud.\nCriterio de estrés\nEl recorrido contiene al menos 50 interacciones."};
 const clauses=jiraAcceptanceClauses(source);
 assert.deepEqual(clauses.map(clause=>clause.id),["AC13.1","AC13.2"]);
 assert.ok(clauses.every(clause=>! /50 interacciones|Completar el formulario/.test(clause.text)));
});

test("an A-or-B clause stays uncovered until every branch has scenario evidence, even with a coarse AC ref",()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Acceso\nEl cliente puede validar con PIN o con token."};
 const pin={sourceIssueKey:source.key,title:"Validar con PIN",steps:['Ingresar el PIN en "PIN"','Validar que se muestre "Bienvenido"'],expectedResult:"Bienvenido",acceptanceCriteriaRefs:["AC1"]};
 const token={sourceIssueKey:source.key,title:"Validar con token",steps:['Ingresar token en "Token"','Validar que se muestre "Bienvenido"'],expectedResult:"Bienvenido",acceptanceCriteriaRefs:["AC1.1"]};
 assert.deepEqual(uncoveredAcceptanceClauses(source,[pin]).map(clause=>clause.id),["AC1.1"]);
 assert.deepEqual(uncoveredAcceptanceClauses(source,[token]).map(clause=>clause.id),["AC1.1"]);
 assert.deepEqual(uncoveredAcceptanceClauses(source,[pin,token]),[]);
 assert.deepEqual(uncoveredAcceptanceClauses(source,[{...token,acceptanceCriteriaRefs:["AC2"]},pin]).map(clause=>clause.id),["AC1.1"]);
});

test("an A-or-B branch named only in title or expectedResult is not covered by steps",()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Acceso\nEl cliente puede validar con PIN o con token."};
 const prose={sourceIssueKey:source.key,title:"Validar con PIN o token",steps:['Ingresar el PIN en "PIN"','Validar que se muestre "Bienvenido"'],expectedResult:"Acceso con token",acceptanceCriteriaRefs:["AC1"]};
 assert.deepEqual(uncoveredAcceptanceClauses(source,[prose]).map(clause=>clause.id),["AC1.1"]);
});

test("literal alternative clause needs a separate full-ref scenario per branch; AC4.2 form-open is its own clause",()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC4 — Si se registra una cuenta ya existente o el alias Atlas, se muestra el mensaje exacto Ya existe un beneficiario con esa cuenta o alias. y el formulario Añadir beneficiario permanece abierto."};
 assert.deepEqual(jiraAcceptanceClauses(source).map(clause=>clause.id),["AC4.1","AC4.2"]);
 const scenario=(title:string,steps:string[],refs:string[])=>({sourceIssueKey:source.key,title,steps,expectedResult:title,acceptanceCriteriaRefs:refs});
 const existing=scenario("Registrar cuenta ya existente",['Ingresar la cuenta existente en "Cuenta"','Validar que se muestre "Ya existe un beneficiario con esa cuenta o alias"'],["AC4.1.1"]);
 const atlas=scenario("Registrar alias Atlas",['Ingresar "Atlas" en "Alias"','Validar que se muestre "Ya existe un beneficiario con esa cuenta o alias"'],["AC4.1.2"]);
 const open=scenario("Formulario permanece abierto",['Validar que el formulario "Añadir beneficiario" permanece abierto'],["AC4.2"]);
 const ids=(items:unknown[])=>uncoveredAcceptanceClauses(source,items).map(clause=>clause.id);
 assert.deepEqual(ids([existing,atlas,open]),[]);
 // Each branch is independent evidence; missing one leaves the parent clause uncovered.
 assert.deepEqual(ids([existing,open]),["AC4.1"]);
 assert.deepEqual(ids([atlas,open]),["AC4.1"]);
 // Form-open claiming AC4.1 (bare) covers nothing; AC4.2 is a separate clause.
 assert.deepEqual(ids([{...open,acceptanceCriteriaRefs:["AC4.1"]}]),["AC4.1","AC4.2"]);
 assert.deepEqual(ids([existing,atlas,{...open,acceptanceCriteriaRefs:["AC4.1"]}]),["AC4.2"]);
 // A branch ref without that branch's evidence words does not count.
 assert.deepEqual(ids([existing,{...open,acceptanceCriteriaRefs:["AC4.1.2"]},open]),["AC4.1"]);
});

test("literal alternatives with an 'o' inside the outcome phrase still map to branches AC4.1.1 / AC4.1.2",()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC4 — Al guardar una cuenta ya existente o el alias Atlas se muestra exactamente Ya existe un beneficiario con esa cuenta o alias"};
 assert.deepEqual(jiraAcceptanceClauses(source).map(clause=>clause.id),["AC4.1"]);
 const outcome='Validar que se muestre "Ya existe un beneficiario con esa cuenta o alias"';
 const scenario=(title:string,steps:string[],refs:string[])=>({sourceIssueKey:source.key,title,steps:[...steps,outcome],expectedResult:"Ya existe un beneficiario con esa cuenta o alias",acceptanceCriteriaRefs:refs});
 const existing=scenario("Guardar cuenta existente",['Ingresar la cuenta existente en "Cuenta"'],["AC4.1.1"]);
 const atlas=scenario("Registrar alias Atlas",['Ingresar "Atlas" en "Alias"'],["AC4.1.2"]);
 const ids=(items:unknown[])=>uncoveredAcceptanceClauses(source,items).map(clause=>clause.id);
 assert.deepEqual(ids([existing,atlas]),[]);
 assert.deepEqual(ids([existing]),["AC4.1"]);
 assert.deepEqual(ids([atlas]),["AC4.1"]);
 // One scenario cannot stand in for the other branch, even with the shared outcome text.
 assert.deepEqual(ids([existing,{...existing,acceptanceCriteriaRefs:["AC4.1.2"]}]),["AC4.1"]);
 assert.deepEqual(ids([atlas,{...atlas,acceptanceCriteriaRefs:["AC4.1.1"]}]),["AC4.1"]);
});

test("a choice clause needs independent executable evidence for every named option",()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Roles\nEl rol permite elegir Operador, Aprobador o Administrador."};
 const scenario=(role:string,refs=["AC1.1"])=>({sourceIssueKey:source.key,title:`Rol ${role}`,steps:[`Seleccionar "${role}" en "Rol"`,`Validar que se muestre "${role}"`],expectedResult:role,acceptanceCriteriaRefs:refs});
 const ids=(items:unknown[])=>uncoveredAcceptanceClauses(source,items).map(clause=>clause.id);
 assert.deepEqual(ids([scenario("Operador"),scenario("Administrador")]),["AC1.1"]);
 assert.deepEqual(ids([scenario("Operador"),scenario("Aprobador"),scenario("Administrador")]),[]);
 assert.deepEqual(ids([scenario("Operador"),scenario("Aprobador",["AC2"]),scenario("Administrador")]),["AC1.1"]);
 // Validation-only candidates (no select/click of the option) are not choice evidence.
 const validationOnly=(role:string)=>({...scenario(role),steps:[`Validar que se muestre "${role}"`]});
 assert.deepEqual(ids(["Operador","Aprobador","Administrador"].map(validationOnly)),["AC1.1"]);
 // One scenario naming every option is not independent evidence for any of them.
 const all={...scenario("Operador"),steps:['Validar que se muestre "Operador, Aprobador y Administrador"']};
 assert.deepEqual(ids([all]),["AC1.1"]);
 // Ambiguous option list fails closed; unrelated lists without a choice verb are untouched.
 const ambiguous={...source,acceptanceCriteria:"AC1 — Roles\nEl rol permite elegir una de las opciones de la lista de roles o permisos que defina la entidad."};
 assert.deepEqual(uncoveredAcceptanceClauses(ambiguous,[scenario("Operador")]).map(clause=>clause.id),["AC1.1"]);
 const unrelated={...source,acceptanceCriteria:"AC1 — Roles\nEl listado muestra Operador, Aprobador y Administrador."};
 assert.deepEqual(uncoveredAcceptanceClauses(unrelated,[scenario("Operador")]),[]);
});

test("a procedural 'seleccionar ...; pulsar ...' clause is not an option list and is covered by its ref", ()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC4 — Positivo: seleccionar Cuenta Corriente Personal, Desde 2026-10-01 y Estado Completada; pulsar Aplicar filtros. La tabla muestra una fila."};
 const item={sourceIssueKey:source.key,title:"Filtrar",steps:['Seleccionar "Cuenta Corriente Personal" en "Cuenta"','Presionar "Aplicar filtros"','Validar que la tabla esté visible.'],expectedResult:"x",acceptanceCriteriaRefs:["AC4.1","AC4.2"]};
 assert.deepEqual(uncoveredAcceptanceClauses(source,[item]).map(clause=>clause.id),[]);
});

test("a conjunctive 'seleccionar A, B e ingresar C' clause is a procedure, not an ambiguous choice list", ()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Acceso\nLa pantalla permite elegir el perfil empresarial e ingresar usuario y contraseña. Fenix valida las credenciales.\nAC4 — Datos\nLa pantalla permite seleccionar una cuenta de origen, una cuenta de destino e ingresar el monto. Las cuentas se muestran distinguibles."};
 const item=(refs:string[])=>({sourceIssueKey:source.key,title:"Flujo",steps:['Seleccionar "Perfil"','Validar que se muestre "Perfil"'],expectedResult:"x",acceptanceCriteriaRefs:refs});
 const ids=(items:unknown[])=>uncoveredAcceptanceClauses(source,items).map(clause=>clause.id);
 // Covered when a referencing scenario exists...
 assert.deepEqual(ids([item(["AC1.1","AC1.2","AC4.1","AC4.2"])]),[]);
 // ...and still fail-closed without a reference.
 assert.deepEqual(ids([item(["AC1.2","AC4.2"])]),["AC1.1","AC4.1"]);
 // A genuine ambiguous choice list (no further action) still fails closed.
 const choice={...source,acceptanceCriteria:"AC1 — Roles\nEl rol permite elegir una de las opciones de la lista de roles o permisos que defina la entidad."};
 assert.deepEqual(uncoveredAcceptanceClauses(choice,[item(["AC1.1"])]).map(clause=>clause.id),["AC1.1"]);
 const mixed={...source,acceptanceCriteria:'AC1 — Roles\nEl rol permite elegir Operador, Aprobador o Administrador y completar el formulario.'};
 const oneOption={...item(['AC1.1']),steps:['Seleccionar "Operador" en "Rol"','Ingresar un dato en "Formulario"','Validar que se muestre "Operador"']};
 assert.deepEqual(uncoveredAcceptanceClauses(mixed,[oneOption]).map(clause=>clause.id),['AC1.1']);
});

test("a choice-only draft is anchored with its own field visibility check and covers its option", ()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC2: Rol de Laura M. permite elegir Operador, Aprobador o Administrador."};
 const draft=(role:string)=>({sourceIssueKey:source.key,title:`Rol ${role}`,steps:['Abrir la aplicación configurada del proyecto','Presionar "Administración".',`Seleccionar "${role}" en "Rol de Laura M.".`],
  inputRequirements:[{key:"r",label:"Rol de Laura M",stepIndex:3,operation:"select"}],unresolvedUiRequirements:[{stepIndex:3,requirement:"x"}],expectedResult:role,acceptanceCriteriaRefs:["AC2.1"]});
 const prepared=prepareJiraGenerationDrafts(["Operador","Aprobador","Administrador"].map(draft),[source],"app","password") as Record<string,unknown>[];
 assert.deepEqual(prepared[0].steps,['Abrir la aplicación configurada del proyecto','Presionar "Administración".','Validar que "Rol de Laura M." esté visible.','Seleccionar "Operador" en "Rol de Laura M.".']);
 assert.equal((prepared[0].inputRequirements as Array<{stepIndex:number}>)[0].stepIndex,4);
 assert.equal((prepared[0].unresolvedUiRequirements as Array<{stepIndex:number}>)[0].stepIndex,4);
 assert.deepEqual(uncoveredAcceptanceClauses(source,prepared).map(clause=>clause.id),[]);
 assert.deepEqual(uncoveredAcceptanceClauses(source,prepared.slice(0,2)).map(clause=>clause.id),["AC2.1"]);
});

test("a negative visibility clause needs an exact no-se-muestre assertion per omitted object",()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Perfil\nEl perfil Personal no muestra productos ni etiquetas empresariales."};
 const scenario=(steps:string[],refs=["AC1"])=>({sourceIssueKey:source.key,title:"Perfil Personal",steps,expectedResult:"No muestra productos ni etiquetas empresariales (pendiente de observación)",acceptanceCriteriaRefs:refs});
 const ids=(items:unknown[])=>uncoveredAcceptanceClauses(source,items).map(clause=>clause.id);
 const positive='Validar que se muestre "Perfil Personal"';
 assert.deepEqual(ids([scenario([positive])]),["AC1.1"]);
 assert.deepEqual(ids([scenario([positive,'Validar que no se muestre "productos"'])]),["AC1.1"]);
 assert.deepEqual(ids([scenario([positive,'Validar que no se muestre "productos"','Validar que no se muestre "etiquetas empresariales"'])]),[]);
 assert.deepEqual(ids([scenario([positive,'Validar que no se muestre "productos"','Validar que no se muestre "etiquetas empresariales"'],["AC2"])]),["AC1.1"]);
 // Ambiguous object extraction fails closed.
 const ambiguous={...source,acceptanceCriteria:"AC1 — Perfil\nEl perfil Personal no muestra productos salvo los autorizados por la entidad."};
 assert.deepEqual(uncoveredAcceptanceClauses(ambiguous,[scenario([positive,'Validar que no se muestre "productos"'])]).map(clause=>clause.id),["AC1.1"]);
});

test("a negated outcome predicate is not read as an omitted-object list",()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Errores\nSi las credenciales no son válidas, se informa el problema y no se presenta la operación como exitosa."};
 const host={sourceIssueKey:source.key,title:"Rechazo",steps:['Validar que se muestre "problema de credenciales"'],expectedResult:"",acceptanceCriteriaRefs:["AC1"]};
 // Ambiguous phrasing: no conjectural object is demanded; positive coverage rules are unchanged.
 assert.deepEqual(uncoveredAcceptanceClauses(source,[host]).map(clause=>clause.id),[]);
 assert.deepEqual(uncoveredAcceptanceClauses(source,[{...host,acceptanceCriteriaRefs:["AC2"]}]).map(clause=>clause.id),["AC1.1"]);
});

test("a clause without alternatives keeps coarse AC coverage",()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Acceso\nEl cliente valida con PIN."};
 const pin={sourceIssueKey:source.key,title:"x",steps:["Validar que se muestre \"Bienvenido\""],expectedResult:"",acceptanceCriteriaRefs:["AC1"]};
 assert.deepEqual(uncoveredAcceptanceClauses(source,[pin]),[]);
});

test("a literal after a noun is entered as data in a semantic field, never used as the field label",()=>{
 const [step]=normalizeJiraGeneratedSteps(['Ingresar el alias "Atlas"']);
 assert.equal(step,'Ingresar "Atlas" en "Alias"');
 const [field]=deriveJiraInputRequirements([step]);
 assert.equal(field.label,"Alias");
 assert.notEqual(field.label,"Atlas");
 assert.deepEqual(normalizeJiraGeneratedSteps(['Completar el campo "Alias"']),['Completar el campo "Alias"']);
});

test("Jira coverage repair adds only exact missing criteria and blocks any remaining gap",async()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Movimientos\nEl cliente consulta sus movimientos. Puede filtrar por fecha."};
 const initial={sourceIssueKey:source.key,title:"Consultar movimientos",steps:["Abrir la aplicación configurada del proyecto","Validar que se muestre \"Movimientos\""],expectedResult:"Se muestran los movimientos.",acceptanceCriteriaRefs:["AC1.1"]};
 let calls=0; let repairAssertionError: unknown;
 const provider=fakeProvider([]);
 provider.completeJson=async request=>{
  calls++;
  if(calls===1)return {rawText:"",parsedJson:{scenarios:[initial]},model:"fixture",providerName:"fixture",durationMs:0};
  try {
  const payload=JSON.parse(request.messages[1].content);
  assert.deepEqual(payload.issues[0].missingClauses.map((clause:{id:string})=>clause.id),["AC1.2"]);
  assert.equal(payload.appSlug,"app-a");
  assert.ok(Array.isArray(payload.learnedNavigation));
  assert.match(request.messages[0].content,/Field-level validation is supported only with this exact syntax/);
  assert.match(request.messages[0].content,/uniquely identified control is invalid and has an associated visible or ARIA-linked error/);
  assert.match(request.messages[0].content,/Never validate a menu item by asserting its label as page content/);
  assert.match(request.messages[0].content,/activate the menu item and assert an observable result on the destination screen/);
  return {rawText:"",parsedJson:{scenarios:[{sourceIssueKey:source.key,title:"Filtrar movimientos por fecha",steps:["Abrir la aplicación configurada del proyecto","Ingresar una fecha válida en \"Fecha\"","Presionar \"Filtrar\"","Validar que se muestre \"Movimientos filtrados\""],expectedResult:"Se muestran movimientos filtrados.",acceptanceCriteriaRefs:["AC1.2"]}]},model:"fixture",providerName:"fixture",durationMs:0};
  } catch (error) { repairAssertionError=error; throw error; }
 };
 const result=await generateJiraScenarios([source],"app-a",provider);
 if (repairAssertionError) throw repairAssertionError;
 assert.equal(calls,2);
 assert.equal(result.scenarios.length,2);
 assert.ok(result.scenarios.every(scenario=>scenario.validation.valid));
});

test("coverage candidates receive a second atomic-field repair before validation across app profiles",async()=>{
 const source={...issue,key:"HU-PROFILE",description:"",acceptanceCriteria:"AC1 — Perfil\nEl cliente consulta sus cuentas. Puede actualizar su perfil al ingresar Nombre completo y Dirección."};
 for(const appSlug of ["app-alpha","app-beta"]){
  let calls=0;const provider=fakeProvider([]);
  provider.completeJson=async request=>{
   calls++;
   if(calls===1)return {rawText:"",parsedJson:{scenarios:[{sourceIssueKey:source.key,title:"Consultar cuentas",steps:["Abrir la aplicación configurada del proyecto",`Validar que se muestre "Cuentas"`],expectedResult:"Se muestran las cuentas.",acceptanceCriteriaRefs:["AC1.1"]}]},model:"fixture",providerName:"fixture",durationMs:0};
   if(calls===2)return {rawText:"",parsedJson:{scenarios:[{sourceIssueKey:source.key,title:"Actualizar perfil",steps:["Abrir la aplicación configurada del proyecto","Completar los datos del perfil: nombre completo y dirección",`Validar que se muestre "Perfil actualizado"`],expectedResult:"Se muestra el perfil actualizado.",acceptanceCriteriaRefs:["AC1.2"]}]},model:"fixture",providerName:"fixture",durationMs:0};
   assert.equal(JSON.parse(request.messages[1].content).appSlug,appSlug);
   assert.match(request.messages[0].content,/one exact-label action per field/i);
   assert.match(request.messages[0].content,/Never validate a menu item by asserting its label as page content/);
   assert.match(request.messages[0].content,/activate the menu item and assert an observable result on the destination screen/);
   assert.ok(JSON.parse(request.messages[1].content).syntaxFailures.some((failure:{reason:string})=>failure.reason==="JIRA_COMPOSITE_STEP_REQUIRES_EXPLICIT_ACTIONS"));
   return {rawText:"",parsedJson:{scenarios:[{sourceIssueKey:source.key,title:"Actualizar perfil",steps:["Abrir la aplicación configurada del proyecto",`Ingresar el nombre en "Nombre completo"`,`Ingresar la dirección en "Dirección"`,`Validar que se muestre "Perfil actualizado"`],expectedResult:"Se muestra el perfil actualizado.",acceptanceCriteriaRefs:["AC1.2"]}]},model:"fixture",providerName:"fixture",durationMs:0};
  };
  const result=await generateJiraScenarios([source],appSlug,provider);
  assert.equal(calls,3,appSlug);
  assert.equal(result.scenarios.length,2,JSON.stringify(result.rejected));
  assert.ok(result.scenarios.every(scenario=>scenario.validation.valid),JSON.stringify(result.scenarios.map(scenario=>scenario.validation.errors)));
  const profile=result.scenarios.find(scenario=>scenario.title==="Actualizar perfil");
  assert.deepEqual(profile?.steps.slice(1,3),[`Ingresar el nombre en "Nombre completo"`,`Ingresar la dirección en "Dirección"`]);
 }
});

const journeyPrefix=["Abrir la aplicación configurada del proyecto",`Ingresar código de acceso en "Código de acceso"`,`Presionar "Continuar"`];
const journeySource={...issue,key:"HU-JOURNEY",description:"",acceptanceCriteria:"AC1 — Cuenta\nEl cliente consulta sus cuentas. Puede actualizar su perfil al ingresar Nombre completo y Dirección."};
function journeyProvider(onRepair:(payload:any,system:string)=>unknown[]){
 let calls=0;const provider=fakeProvider([]);
 provider.completeJson=async request=>{
  calls++;
  const payload=calls===1?null:JSON.parse(request.messages[1].content);
  const scenarios=calls===1?[{sourceIssueKey:journeySource.key,title:"Consultar cuentas",steps:[...journeyPrefix,`Validar que se muestre "Cuentas"`],inputRequirements:[{key:"access",label:"Código de acceso",operation:"fill",stepIndex:2,sensitive:true}],expectedResult:"Se muestran las cuentas.",acceptanceCriteriaRefs:["AC1.1"]}]
   :calls===2?[{sourceIssueKey:journeySource.key,title:"Actualizar perfil",steps:["Abrir la aplicación configurada del proyecto","Completar los datos del perfil: nombre completo y dirección",`Validar que se muestre "Perfil actualizado"`],expectedResult:"Se muestra el perfil actualizado.",acceptanceCriteriaRefs:["AC1.2"]}]
   :onRepair(payload,request.messages[0].content);
  return {rawText:"",parsedJson:{scenarios},model:"fixture",providerName:"fixture",durationMs:0};
 };
 return provider;
}
test("post-coverage repair receives the validated journey and observed routes, and rebuilds an executable complementary case",async()=>{
 let seen:any;
 const provider=journeyProvider((payload,system)=>{
  seen=payload;
  assert.match(system,/copy that prefix verbatim/);
  assert.match(system,/transactional authorization-code/);
  return [{sourceIssueKey:journeySource.key,title:"Actualizar perfil",steps:[...journeyPrefix,`Ingresar el nombre en "Nombre completo"`,`Ingresar la dirección en "Dirección"`,`Validar que se muestre "Perfil actualizado"`],expectedResult:"Se muestra el perfil actualizado.",acceptanceCriteriaRefs:["AC1.2"]}];
 });
 const result=await generateJiraScenarios([journeySource],"app-a",provider);
 assert.ok(Array.isArray(seen.learnedNavigation));
 assert.deepEqual(seen.validatedJourneys.map((journey:{steps:string[]})=>journey.steps.slice(0,3)),[journeyPrefix]);
 const profile=result.scenarios.find(scenario=>scenario.title==="Actualizar perfil");
 assert.deepEqual(profile?.steps.slice(0,3),journeyPrefix);
 assert.ok(result.scenarios.every(scenario=>scenario.validation.valid),JSON.stringify(result.scenarios.map(scenario=>scenario.validation.errors)));
 assert.equal(uncoveredAcceptanceClauses(journeySource,result.scenarios).length,0);
});
test("post-coverage repair that stays invalid keeps the acceptance gate closed",async()=>{
 const provider=journeyProvider(()=>[{sourceIssueKey:journeySource.key,title:"Actualizar perfil",steps:["Abrir la aplicación configurada del proyecto","Completar los datos del perfil: nombre completo y dirección",`Validar que se muestre "Perfil actualizado"`],expectedResult:"Se muestra el perfil actualizado.",acceptanceCriteriaRefs:["AC1.2"]}]);
 const result=await generateJiraScenarios([journeySource],"app-a",provider);
 assert.ok(result.rejected.some(item=>item.reason.startsWith("JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE")&&item.reason.includes("AC1.2")));
 assert.ok(result.scenarios.some(scenario=>scenario.validation.valid));
 assert.ok(result.scenarios.filter(scenario=>scenario.acceptanceCriteriaRefs?.includes("AC1.2")).every(scenario=>!scenario.validation.valid));
});

const negativeReceiptSteps=["Abrir la aplicación configurada del proyecto",`Ingresar un token de transferencia no válido en "token de seguridad".`,`Presionar "Autorizar transferencia".`,`Validar que se muestre un mensaje que informe el problema del "token de seguridad".`,`Validar que no se muestre "comprobante de transacción exitosa"`];
const negativeReceiptDraft={sourceIssueKey:"HU-1",title:"No mostrar comprobante exitoso",steps:negativeReceiptSteps,expectedResult:"Mientras la transferencia no se completa, no se muestra un comprobante exitoso.",acceptanceCriteriaRefs:["AC8.2"]};
const negativeReceiptSource={...issue,description:'Si el token de transferencia no es válido, se informa el problema y no se muestra comprobante de transacción exitosa.'};

test('generation repairs absence without context using the source-backed field error and retains the negative oracle',async()=>{
 const source={...issue,description:'Si el código de acceso no es válido, se informa el error y no se muestra el resultado.'};
 const draft={sourceIssueKey:source.key,title:'Rechazo del código de acceso',steps:['Abrir la aplicación configurada del proyecto','Ingresar un código no válido en "Código de acceso"','Presionar "Continuar"','Validar que no se muestre "Resultado"'],expectedResult:'No se muestra "Resultado"'};
 let calls=0;let repairFailure:unknown;const provider=fakeProvider([]);
 provider.completeJson=async request=>{
  calls++;
  if(calls===1)return {rawText:'',parsedJson:{scenarios:[draft]},model:'fixture',providerName:'fixture',durationMs:0};
  try{
   const payload=JSON.parse(request.messages[1].content);
   assert.ok(payload.syntaxFailures.some((failure:{reason:string})=>failure.reason==='JIRA_ABSENCE_REQUIRES_OBSERVED_CONTEXT'));
   assert.match(request.messages[0].content,/source-backed positive observable context/);
  }catch(error){repairFailure=error;throw error;}
  return {rawText:'',parsedJson:{scenarios:[{...draft,steps:[...draft.steps.slice(0,-1),'Validar que el campo "Código de acceso" muestre un error de validación',draft.steps.at(-1)!]}]},model:'fixture',providerName:'fixture',durationMs:0};
 };
 const result=await generateJiraScenarios([source],'fixture-profile',provider);
 if(repairFailure)throw repairFailure;
 assert.equal(calls,2);
 assert.equal(result.scenarios[0].validation.valid,true,JSON.stringify(result.scenarios[0].validation.errors));
 assert.equal(result.scenarios[0].steps.at(-1),draft.steps.at(-1));
});

test('a failed context repair cannot remove the negative assertion gate',async()=>{
 const draft={sourceIssueKey:issue.key,title:'Rechazo',steps:['Abrir la aplicación configurada del proyecto','Ingresar un dato no válido en "Código"','Presionar "Continuar"','Validar que no se muestre "Resultado"'],expectedResult:'No se muestra "Resultado"'};
 const result=await generateJiraScenarios([{...issue,description:'Un código no válido impide la operación.'}],'fixture-profile',fakeProvider([draft]));
 assert.equal(result.scenarios[0].validation.valid,false);
 assert.ok(result.scenarios[0].validation.errors.includes('JIRA_ABSENCE_REQUIRES_OBSERVED_CONTEXT'));
 assert.equal(result.scenarios[0].steps.at(-1),draft.steps.at(-1));
});
test("repair aligns a negative expectedResult with the explicit final negative assertion after a source-backed invalid input",async()=>{
 assert.ok((await auditGeneratedJiraSyntax([negativeReceiptDraft])).some(failure=>failure.reason==="JIRA_ASSERTION_CAPABILITY_UNSUPPORTED"));
 const expectedResult=alignRepairedNegativeExpectedResult(negativeReceiptDraft,negativeReceiptSource) as string;
 assert.equal(expectedResult,'Mientras la transferencia no se completa, no se muestra un comprobante exitoso ("comprobante de transacción exitosa").');
 assert.deepEqual(await auditGeneratedJiraSyntax([{...negativeReceiptDraft,expectedResult}]),[]);
});
test("repair leaves expectedResult unchanged for unrelated outcome, flipped polarity or a trigger-less scenario",()=>{
 const unchanged=(patch:Record<string,unknown>)=>assert.equal(alignRepairedNegativeExpectedResult({...negativeReceiptDraft,...patch},negativeReceiptSource),patch.expectedResult??negativeReceiptDraft.expectedResult);
 unchanged({expectedResult:"No se muestra un saldo disponible."});
 unchanged({expectedResult:"Se muestra un comprobante exitoso."});
 unchanged({expectedResult:"Se informa el error y no se presenta un comprobante exitoso."});
 unchanged({steps:[negativeReceiptSteps[0],`Ingresar el token en "token de seguridad".`,...negativeReceiptSteps.slice(2)]});
 unchanged({steps:negativeReceiptSteps.slice(0,4)});
 unchanged({steps:negativeReceiptSteps.filter(step=>!step.startsWith('Presionar'))});
 assert.equal(alignRepairedNegativeExpectedResult(negativeReceiptDraft),negativeReceiptDraft.expectedResult);
 assert.equal(alignRepairedNegativeExpectedResult(negativeReceiptDraft,{...issue,description:'Mostrar el formulario.'}),negativeReceiptDraft.expectedResult);
});

test('coverage repair accepts the corrected negative journey and its equivalent final oracle across profiles',async()=>{
 const source={...negativeReceiptSource,description:'',acceptanceCriteria:'AC1 — Operación\nLa pantalla muestra Operación. Si el token de transferencia no es válido, se informa el problema y no se muestra comprobante de transacción exitosa.'};
 const initial={sourceIssueKey:source.key,title:'Abrir operación',steps:['Abrir la aplicación configurada del proyecto','Validar que se muestre "Operación"'],expectedResult:'Operación',acceptanceCriteriaRefs:['AC1.1']};
 const triggerless={...negativeReceiptDraft,sourceIssueKey:source.key,steps:['Abrir la aplicación configurada del proyecto','Presionar "Operación"','Validar que no se muestre "comprobante de transacción exitosa"'],acceptanceCriteriaRefs:['AC1.2']};
 for(const appSlug of ['profile-one','profile-two']){
  let calls=0;let repairFailure:unknown;const provider=fakeProvider([]);
  provider.completeJson=async request=>{
   calls++;
   try{
    if(calls===1)return {rawText:'',parsedJson:{scenarios:[initial]},model:'fixture',providerName:'fixture',durationMs:0};
    if(calls===2)return {rawText:'',parsedJson:{scenarios:[triggerless]},model:'fixture',providerName:'fixture',durationMs:0};
    assert.equal(calls,3);
    const payload=JSON.parse(request.messages[1].content);
    assert.ok(payload.syntaxFailures.some((failure:{reason:string})=>failure.reason==='JIRA_FAILURE_SETUP_UNSPECIFIED'));
    return {rawText:'',parsedJson:{scenarios:[{...triggerless,steps:negativeReceiptSteps}]},model:'fixture',providerName:'fixture',durationMs:0};
   }catch(error){repairFailure=error;throw error;}
  };
  const result=await generateJiraScenarios([source],appSlug,provider);
  if(repairFailure)throw repairFailure;
  assert.equal(calls,3);
  assert.deepEqual(result.rejected,[]);
  assert.ok(result.scenarios.every(scenario=>scenario.validation.valid),JSON.stringify(result.scenarios.map(scenario=>scenario.validation.errors)));
  const repaired=result.scenarios.find(scenario=>scenario.title===triggerless.title)!;
  assert.equal(repaired.sourceIssueKey,source.key);
  assert.deepEqual(repaired.acceptanceCriteriaRefs,['AC1.2']);
  assert.ok(repaired.steps.includes(negativeReceiptSteps[2]));
  assert.deepEqual(uncoveredAcceptanceClauses(source,result.scenarios),[]);
 }
});

test("coverage repair makes another targeted pass when the provider only closes part of the coverage gap",async()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Account safety\nThe customer may review account details. An invalid authorization code shows an error and does not submit. The successful receipt is absent."};
 const initial={sourceIssueKey:source.key,title:"Review account details",steps:["Abrir la aplicación configurada del proyecto","Validar que se muestre \"Cuentas\""],expectedResult:"Se muestran las cuentas.",acceptanceCriteriaRefs:["AC1.1"]};
 let calls=0;const provider=fakeProvider([]);
 provider.completeJson=async request=>{
  calls++;
  if(calls===1)return {rawText:"",parsedJson:{scenarios:[initial]},model:"fixture",providerName:"fixture",durationMs:0};
  const payload=JSON.parse(request.messages[1].content);
  const missing=payload.issues[0].missingClauses.map((clause:{id:string})=>clause.id);
  if(calls===2){
   assert.deepEqual(missing,["AC1.2","AC1.3"]);
   return {rawText:"",parsedJson:{scenarios:[{sourceIssueKey:source.key,title:"Invalid authorization code is rejected",steps:["Abrir la aplicación configurada del proyecto","Presionar \"Autorización\"","Ingresar código inválido en \"Código de autorización\"","Presionar \"Enviar\"","Validar que el campo \"Código de autorización\" muestre un error de validación","Validar que no se muestre \"Solicitud recibida\""],expectedResult:"No se muestra Solicitud recibida.",acceptanceCriteriaRefs:["AC1.2"]}]},model:"fixture",providerName:"fixture",durationMs:0};
  }
  assert.deepEqual(missing,["AC1.3"]);
  assert.match(request.messages[0].content,/does not submit/i);
  return {rawText:"",parsedJson:{scenarios:[{sourceIssueKey:source.key,title:"No success receipt after rejected code",steps:["Abrir la aplicación configurada del proyecto","Ingresar código inválido en \"Código de autorización\"","Presionar \"Enviar\"","Validar que el campo \"Código de autorización\" muestre un error de validación","Validar que no se muestre \"Solicitud recibida\""],expectedResult:"No se muestra Solicitud recibida.",acceptanceCriteriaRefs:["AC1.3"]}]},model:"fixture",providerName:"fixture",durationMs:0};
 };
 const result=await generateJiraScenarios([source],"app-a",provider);
 assert.equal(calls,3);
 assert.equal(result.scenarios.length,3,JSON.stringify({scenarios:result.scenarios,rejected:result.rejected},null,2));
 assert.ok(result.scenarios.every(scenario=>scenario.validation.valid));
});

test("Jira coverage repair rejects disconnected scenarios with future-screen preconditions", async () => {
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Movimientos\nEl cliente consulta sus movimientos. Puede filtrar por fecha."};
 const initial={sourceIssueKey:source.key,title:"Consultar movimientos",steps:["Abrir la aplicación configurada del proyecto","Validar que se muestre \"Movimientos\""],expectedResult:"Se muestran los movimientos.",acceptanceCriteriaRefs:["AC1.1"]};
 let calls=0;const provider=fakeProvider([]);
 provider.completeJson=async request=>{
  calls++;
  if(calls===1)return {rawText:"",parsedJson:{scenarios:[initial]},model:"fixture",providerName:"fixture",durationMs:0};
  assert.match(request.messages[0].content,/keep preconditions empty/i);
  return {rawText:"",parsedJson:{scenarios:[{sourceIssueKey:source.key,title:"Filtrar movimientos",steps:["Abrir la aplicación configurada del proyecto","Presionar \"Filtrar\"","Validar que se muestre \"Movimientos filtrados\""],preconditions:["La sesión está autenticada y Movimientos está visible."],expectedResult:"Se muestran los movimientos filtrados.",acceptanceCriteriaRefs:["AC1.2"]}]},model:"fixture",providerName:"fixture",durationMs:0};
 };
 const result=await generateJiraScenarios([source],"app-a",provider);
 assert.equal(calls,2);
 assert.equal(result.scenarios.length,1);
 assert.equal(result.scenarios[0].validation.valid,true);
 assert.deepEqual(result.scenarios[0].validation.errors,[]);
 assert.ok(result.rejected.some(item=>item.reason.includes("AC1.2")));
});

test("valid scenarios remain available while a sibling acceptance gap is reported separately",async()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Movimientos\nEl cliente consulta sus movimientos. Puede filtrar por fecha."};
 const provider=fakeProvider([{sourceIssueKey:source.key,title:"Consultar movimientos",steps:["Abrir la aplicación configurada del proyecto","Validar que se muestre \"Movimientos\""],expectedResult:"Se muestran los movimientos.",acceptanceCriteriaRefs:["AC1.1"]}]);
 const result=await generateJiraScenarios([source],"app-a",provider);
 assert.equal(result.scenarios[0].validation.valid,true);
 assert.equal(result.scenarios[0].executionReadiness,"requires_discovery");
 assert.deepEqual(result.scenarios[0].validation.errors,[]);
 assert.ok(result.rejected.some(item=>item.reason.includes("AC1.2")));
});

test('coverage schema delivery failure recovers automatically and rechecks the missing obligations',async()=>{
 for(const recover of [true,false]) {
  const source={...issue,description:'',acceptanceCriteria:'AC1 — Movimientos\nEl cliente consulta sus movimientos. Puede filtrar por fecha.'};
  const initial={sourceIssueKey:source.key,title:'Consultar movimientos',steps:['Abrir la aplicación configurada del proyecto','Validar que se muestre "Movimientos"'],expectedResult:'Se muestran los movimientos.',acceptanceCriteriaRefs:['AC1.1']};
  let calls=0;
  const provider=fakeProvider([]);
  provider.completeJson=async request=>{
   calls++;
   if(calls===1) return {rawText:'',parsedJson:{scenarios:[initial]},model:'fixture',providerName:'fixture',durationMs:0};
   const payload=JSON.parse(request.messages[1].content);
   assert.deepEqual(payload.issues[0].missingClauses.map((clause:{id:string})=>clause.id),['AC1.2']);
   if(calls===2||!recover) throw Object.assign(new Error('invalid scenario delivery'),{code:'ai_provider_schema_invalid'});
   return {rawText:'',parsedJson:{scenarios:[{...initial,title:'Filtrar movimientos',steps:['Abrir la aplicación configurada del proyecto','Ingresar fecha en "Fecha"','Presionar "Filtrar"','Validar que se muestre "Movimientos filtrados"'],expectedResult:'Movimientos filtrados',acceptanceCriteriaRefs:['AC1.2']}]},model:'fixture',providerName:'fixture',durationMs:0};
  };
  const result=await generateJiraScenarios([source],'fixture',provider);
  assert.equal(calls,3,'only one extra delivery attempt is allowed');
  assert.ok(result.scenarios.every(scenario=>scenario.validation.valid));
  assert.equal(result.scenarios.length,recover?2:1);
  assert.equal(result.rejected.some(item=>item.reason.startsWith('JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE')),!recover);
 }
});

test("coverage provider failure preserves valid scenarios and records the suite gap",async()=>{
 const source={...issue,description:"",acceptanceCriteria:"AC1 — Movimientos\nEl cliente consulta sus movimientos. Puede filtrar por fecha."};
 let calls=0;const provider=fakeProvider([]);
 provider.completeJson=async()=>{calls++;if(calls>1)throw Object.assign(new Error("provider unavailable"),{code:"AI_PROVIDER_UNAVAILABLE"});return {rawText:"",parsedJson:{scenarios:[{sourceIssueKey:source.key,title:"Consultar movimientos",steps:["Abrir la aplicación configurada del proyecto","Validar que se muestre \"Movimientos\""] ,expectedResult:"Se muestran los movimientos.",acceptanceCriteriaRefs:["AC1.1"]}]},model:"fixture",providerName:"fixture",durationMs:0};};
 const result=await generateJiraScenarios([source],"app-a",provider);
 assert.equal(calls,2);assert.equal(result.scenarios.length,1);
 assert.equal(result.scenarios[0].validation.valid,true);
 assert.deepEqual(result.scenarios[0].validation.errors,[]);
 assert.ok(result.rejected.some(item=>item.reason.includes("AC1.2")));
});

test("file-output provider receives the failing draft and errors in its first user message", async () => {
  let calls = 0;
  const good = { sourceIssueKey: 'HU-1', title: 'Good', steps: ['Validar que se muestre "Comprobante"'] };
  const provider = fakeProvider([]);
  provider.completeJson = async request => {
    calls++;
    if (calls === 1) return { rawText: '', parsedJson: { scenarios: [good,
      { sourceIssueKey: 'HU-1', title: 'Bad', steps: ['Cuando aparezca SMS, solicitar el código.', 'Validar que se muestre "Detalle"'] }] },
      model: 'fixture', providerName: 'fixture', durationMs: 0 };
    const repair = JSON.parse(request.messages.find(message => message.role === 'user')!.content);
    assert.equal(repair.syntaxFailures.length, 1);
    assert.deepEqual(repair.learnedNavigation, [{sourceIssueKey:issue.key,routes:[]}]);
    assert.match(request.messages[0].content,/Never validate a menu item by asserting its label as page content/);
    assert.match(request.messages[0].content,/activate the menu item and assert an observable result on the destination screen/);
    assert.ok(request.messages[0].content.length < buildJiraScenarioMessages([issue],"app-b")[0].content.length);
    assert.deepEqual(repair.scenarios.map((draft: { title: string }) => draft.title), ['Bad']);
    return { rawText: '', parsedJson: { scenarios: [{ ...repair.scenarios[0], steps: ['Presionar "SMS"', 'Validar que se muestre "Detalle"'] }] },
      model: 'fixture', providerName: 'fixture', durationMs: 0 };
  };
  const result = await generateJiraScenarios([issue], 'app-b', provider);
  assert.equal(calls, 2);
  assert.deepEqual(result.scenarios[0].steps, good.steps);
  assert.equal(result.scenarios[1].validation.valid, true);
});

test("negative title without negative data remains blocked for review", async () => {
 const { auditGeneratedJiraSyntax } = await import('./jira-scenario-generator');
 const failures = await auditGeneratedJiraSyntax([{title:'Rechazo por token no válido',sourceIssueKey:'HU-1',steps:['Ingresar token en "Token"','Validar que se muestre "Error"'],expectedResult:'Error'}]);
 assert.equal(failures[0].reason,'JIRA_NEGATIVE_TEST_DATA_UNSPECIFIED');
});

test("named navigation choices stay click instructions while genuine lists remain inputs", async () => {
 const {buildJiraScenarioMessages}=await import('./jira-scenario-generator');
 const {deriveJiraInputRequirements}=await import('./jira-input-requirements');
 for(const label of ['Business','Professional']) {
  const messages=buildJiraScenarioMessages([],label.toLowerCase());
  assert.match(messages[0].content,/named navigation mode/);
  assert.match(messages[0].content,/exact option label from story/);
  const fields=deriveJiraInputRequirements([`Presionar "${label}"`,'Seleccionar cuenta en "Cuenta de origen"']);
  assert.equal(fields.length,1);assert.equal(fields[0].label,'Cuenta de origen');
 }
});
const distinctionIssue={...issue,key:'HU-D',description:'',acceptanceCriteria:'AC1 Autorización: El cliente autoriza con su token de seguridad. El código de autorización es independiente del token de la transacción.'} as JiraIssueSource;
const authSteps=['Abrir la aplicación configurada del proyecto','Ingresar token en "Token de seguridad"','Presionar "Autorizar"','Validar que se muestre "Comprobante"'];
const authDraft=(extra:Record<string,unknown>={})=>({sourceIssueKey:'HU-D',title:'Autorización',steps:authSteps,authIntent:'full_authentication',acceptanceCriteriaRefs:['AC1.1'],inputRequirements:[{key:'token',label:'Token de seguridad',operation:'fill',stepIndex:2,sensitive:true}],...extra});
test('distinction clause links to the positive full-authentication scenario with a separate security input',()=>{
 const host=authDraft() as Record<string,unknown>;
 linkDistinctionCoverage([distinctionIssue],[host]);
 assert.deepEqual(host.acceptanceCriteriaRefs,['AC1.1','AC1.2']);
 assert.deepEqual(uncoveredAcceptanceClauses(distinctionIssue,[host]),[]);
});
test('distinction clause stays uncovered without separate-input evidence or positive intent',()=>{
 const invalidSteps=authSteps.map(s=>s.replace('Ingresar token en','Ingresar un token no válido en'));
 const invalidInputs=[{key:'token',label:'Token de seguridad',operation:'fill',stepIndex:2,sensitive:true,dataCondition:'invalid'}];
 for(const extra of [{authIntent:'gate_observation'},{steps:authSteps.filter(s=>!s.startsWith('Ingresar')),inputRequirements:[]},{steps:invalidSteps,inputRequirements:invalidInputs}]){
  const host=authDraft(extra) as Record<string,unknown>;
  linkDistinctionCoverage([distinctionIssue],[host]);
  assert.deepEqual(host.acceptanceCriteriaRefs,['AC1.1']);
  assert.deepEqual(uncoveredAcceptanceClauses(distinctionIssue,[host]).map(c=>c.id),['AC1.2']);
 }
});
test('an invalid candidate cannot be the only reference of a clause',async()=>{
 const src={...distinctionIssue,acceptanceCriteria:'AC1 Autorización. El cliente autoriza con su token. AC2 Detalle. El sistema muestra el detalle.'} as JiraIssueSource;
 const result=await generateJiraScenarios([src],'app-b',fakeProvider([
  authDraft(),
  {sourceIssueKey:'HU-D',title:'Detalle',steps:['Navegar a detalle','Validar que se muestre "Detalle"'],expectedResult:'Detalle',acceptanceCriteriaRefs:['AC2.1']},
 ]));
 assert.ok(result.rejected.some(r=>r.reason.startsWith('JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE')&&r.reason.includes('AC2.1')));
 assert.ok(result.scenarios.some(s=>s.validation.valid));
 assert.ok(result.scenarios.filter(s=>s.acceptanceCriteriaRefs?.includes("AC2.1")).every(s=>!s.validation.valid));
});
test('clause guidance asks per-option scenarios for choices and same-scenario destination assertions',()=>{
 const choice=clauseCoverageGuidance({id:'AC2.1',text:'Rol de Laura M. permite elegir Operador, Aprobador o Administrador'});
 assert.equal(choice.length,1);
 assert.match(choice[0],/3 distinct scenarios.*Operador \| Aprobador \| Administrador.*AC2\.1/);
 const nav=clauseCoverageGuidance({id:'AC2.2',text:'El cambio de vista presenta Cargando información segura y finalmente la tabla de movimientos personales'});
 assert.match(nav[0],/"Cargando información segura", "tabla de movimientos personales"/);
 assert.deepEqual(clauseCoverageGuidance({id:'AC1.1',text:'El usuario abre Movimientos'}),[]);
 assert.deepEqual(clauseCoverageGuidance({id:'AC1.2',text:'No se muestra el saldo ni el alias'}),[]);
 const prompt=JSON.parse(buildJiraScenarioMessages([{...issue,acceptanceCriteria:'AC2 Rol de Laura M. permite elegir Operador, Aprobador o Administrador.'}],'x')[1].content);
 assert.ok(prompt.issues[0].acceptanceClauses[0].guidance.length);
});
test('navigation ending on a pressed control gains source-named loading and destination assertions; absent pair stays uncovered',()=>{
 const nav={...issue,key:'HU-N',description:'',acceptanceCriteria:'AC1 Navegación. El usuario abre Movimientos. El cambio de vista presenta Cargando información segura y finalmente la tabla de movimientos personales.'} as JiraIssueSource;
 const draft={sourceIssueKey:'HU-N',title:'Abrir Movimientos',steps:['Abrir la aplicación configurada del proyecto','Presionar "Movimientos".'],expectedResult:'Se abre Movimientos.',acceptanceCriteriaRefs:[] as string[]};
 assert.ok(uncoveredAcceptanceClauses(nav,[draft]).length>0);
 const repaired=repairMissingDestinationAssertions(draft,nav);
 assert.deepEqual(repaired.steps.slice(2),['Validar que se muestre "Cargando información segura"','Validar que se muestre "tabla de movimientos personales"']);
 assert.deepEqual(uncoveredAcceptanceClauses(nav,[repaired]),[]);
 // Unrelated control: no change. Already repaired: idempotent.
 assert.equal(repairMissingDestinationAssertions({...draft,steps:['Presionar "Otro".']},nav).steps.length,1);
 assert.deepEqual(repairMissingDestinationAssertions(repaired,nav),repaired);
});
test('nav control matches source only as whole phrase, not as a substring of another word',()=>{
 const nav={...issue,key:'HU-P',description:'',acceptanceCriteria:'AC1 Navegación. El usuario abre Movimientos. El cambio de vista presenta Cargando información segura y finalmente la tabla de movimientos personales.'} as JiraIssueSource;
 const draft={sourceIssueKey:'HU-P',title:'Abrir Movimientos',steps:['Abrir la aplicación configurada del proyecto','Presionar "Personal"','Presionar "Movimientos"','Presionar "Filtrar"'],expectedResult:'Se abre Movimientos.',acceptanceCriteriaRefs:[] as string[]};
 const repaired=repairMissingDestinationAssertions(draft,nav);
 assert.deepEqual(repaired.steps,['Abrir la aplicación configurada del proyecto','Presionar "Personal"','Presionar "Movimientos"','Validar que se muestre "Cargando información segura"','Validar que se muestre "tabla de movimientos personales"','Presionar "Filtrar"']);
 const onlyPersonal={...draft,steps:['Presionar "Personal"']};
 assert.equal(repairMissingDestinationAssertions(onlyPersonal,nav),onlyPersonal);
 assert.deepEqual(repairMissingDestinationAssertions(repaired,nav),repaired);
 // Real phrase equality (diacritics/case folded) still repairs.
 const exact={...nav,acceptanceCriteria:'AC1 Navegación. El usuario abre Mi Perfil. El cambio de vista presenta Cargando datos y finalmente la lista de cuentas.'} as JiraIssueSource;
 const fixed=repairMissingDestinationAssertions({...draft,steps:['Presionar "mi perfíl"'.replace('perfíl','perfil')]},exact);
 assert.deepEqual(fixed.steps.slice(1),['Validar que se muestre "Cargando datos"','Validar que se muestre "lista de cuentas"']);
});
test('option label ending in a control name (Cuenta Corriente Personal) is not the Personal navigation',()=>{
 const src={...issue,key:'HU-L',description:'',acceptanceCriteria:'AC1 Acceso. El usuario debe seleccionar Personal; ingresar su identificación. La vista presenta Resumen de cuenta. AC2 Movimientos. El usuario abre Movimientos. El cambio de vista presenta Cargando información segura y finalmente la tabla de movimientos. AC4 Filtros. El usuario selecciona Cuenta Corriente Personal y presiona Aplicar filtros. La tabla presenta la fila 10 oct 2026 TRX-800124.'} as JiraIssueSource;
 const draft={sourceIssueKey:'HU-L',title:'Movimientos',steps:['Abrir la aplicación configurada del proyecto','Presionar "Personal"','Presionar "Movimientos"','Presionar "Aplicar filtros"'],expectedResult:'ok',acceptanceCriteriaRefs:[] as string[]};
 const out=repairMissingDestinationAssertions(draft,src).steps;
 // AC1 (login/profile pick + Resumen) is not a navigation: nothing inserted after Personal.
 assert.equal(out[1],'Presionar "Personal"');
 assert.equal(out[2],'Presionar "Movimientos"');
 assert.ok(!out.some(s=>/Resumen de cuenta/.test(s)));
 // AC2: both assertions right after Movimientos.
 const mov=out.indexOf('Presionar "Movimientos"');
 assert.equal(out[mov+1],'Validar que se muestre "Cargando información segura"');
 assert.equal(out[mov+2],'Validar que se muestre "tabla de movimientos"');
 // AC4: table-result criterion never yields a compound phrase after Aplicar filtros.
 assert.equal(out.indexOf('Presionar "Aplicar filtros"'),mov+3);
 assert.equal(out.length,mov+4);
 assert.ok(!out.some(s=>/TRX-800124/.test(s)));
});
test('filter criterion citing the submit click gets no destination assertion; existing data assertions stay',()=>{
 const src={...issue,key:'HU-F',description:'',acceptanceCriteria:'AC4 Filtros. El usuario selecciona Cuenta Corriente Personal y presiona Aplicar filtros. La tabla muestra la fila Fecha 10 oct 2026 Referencia TRX-800124.'} as JiraIssueSource;
 const draft={sourceIssueKey:'HU-F',title:'Filtrar',steps:['Seleccionar "Cuenta Corriente Personal"','Presionar "Aplicar filtros"','Validar que se muestre "Fecha 10 oct 2026"','Validar que se muestre "TRX-800124"'],expectedResult:'ok',acceptanceCriteriaRefs:[] as string[]};
 assert.equal(repairMissingDestinationAssertions(draft,src),draft);
});
test('destination assertion insertion reindexes step-indexed metadata after the navigation only',()=>{
 const nav={...issue,key:'HU-R',description:'',acceptanceCriteria:'AC1 Navegación. El usuario abre Movimientos. El cambio de vista presenta Cargando información segura y finalmente la tabla de movimientos personales.'} as JiraIssueSource;
 const draft={sourceIssueKey:'HU-R',title:'Cuenta',steps:['Abrir la aplicación configurada del proyecto','Presionar "Movimientos"','Presionar "Filtrar"','Ingresar la cuenta'],expectedResult:'ok',acceptanceCriteriaRefs:[] as string[],
  inputRequirements:[{key:'a',label:'Pre',stepIndex:1,required:true},{key:'b',label:'Nav',stepIndex:2,required:true},{key:'c',label:'Cuenta',stepIndex:4,required:true,sensitive:false}],
  unresolvedUiRequirements:[{stepIndex:2,requirement:'x'},{stepIndex:3,requirement:'y'}],
  conditionRequirements:[{key:'k',stepIndices:[1,2,3,4]}]};
 const repaired=repairMissingDestinationAssertions(draft,nav);
 assert.deepEqual(repaired.inputRequirements.map(r=>r.stepIndex),[1,2,6]);
 assert.deepEqual(repaired.inputRequirements[2],{key:'c',label:'Cuenta',stepIndex:6,required:true,sensitive:false});
 assert.deepEqual(repaired.unresolvedUiRequirements.map(r=>r.stepIndex),[2,5]);
 assert.deepEqual(repaired.conditionRequirements[0],{key:'k',stepIndices:[1,2,5,6]});
 assert.equal(repaired.steps[5],'Ingresar la cuenta');
});
test('mid-journey navigation gets destination assertions inserted right after it, keeping later order; fail-closed when source has no destination',()=>{
 const nav={...issue,key:'HU-M',description:'',acceptanceCriteria:'AC1 Navegación. El usuario abre Movimientos. El cambio de vista presenta Cargando información segura y finalmente la tabla de movimientos personales.'} as JiraIssueSource;
 const draft={sourceIssueKey:'HU-M',title:'Abrir Movimientos',steps:['Abrir la aplicación configurada del proyecto','Presionar "Movimientos".','Presionar "Filtrar"','Presionar "Exportar"'],expectedResult:'Se abre Movimientos.',acceptanceCriteriaRefs:[] as string[]};
 const repaired=repairMissingDestinationAssertions(draft,nav);
 assert.deepEqual(repaired.steps,['Abrir la aplicación configurada del proyecto','Presionar "Movimientos".','Validar que se muestre "Cargando información segura"','Validar que se muestre "tabla de movimientos personales"','Presionar "Filtrar"','Presionar "Exportar"']);
 assert.deepEqual(uncoveredAcceptanceClauses(nav,[repaired]),[]);
 assert.deepEqual(repairMissingDestinationAssertions(repaired,nav),repaired);
 // Unrelated controls only: untouched, refs not added.
 const other={...draft,steps:['Presionar "Filtrar"','Presionar "Exportar"']};
 assert.equal(repairMissingDestinationAssertions(other,nav),other);
 // Source without a destination clause: fail closed, clause stays uncovered.
 const bare={...nav,acceptanceCriteria:'AC1 Navegación. El usuario abre Movimientos.'} as JiraIssueSource;
 assert.equal(repairMissingDestinationAssertions(draft,bare),draft);
});

const gaps=(steps:string[],extra:Record<string,unknown>={})=>jiraScenarioQualityGaps({title:'t',expectedResult:'',...extra},steps);
const addRow=['Presionar "Añadir"','Ingresar "Ana Ruiz" en "Nombre"','Ingresar "Atlas" en "Alias"','Presionar "Guardar"'];
test('added row must be proven by one assertion carrying all entered identifying values',()=>{
  assert.deepEqual(gaps([...addRow,'Validar que se muestre "Ana Ruiz"','Validar que se muestre "Atlas"']),['JIRA_ADDED_ROW_IDENTITY_INCOMPLETE']);
  assert.deepEqual(gaps([...addRow,'Validar que se muestre "Ana Ruiz - Atlas"']),[]);
  assert.deepEqual(gaps([...addRow,'Validar que se muestre "Guardado"']),['JIRA_ADDED_ROW_IDENTITY_INCOMPLETE']);
  assert.deepEqual(gaps(addRow),['JIRA_ADDED_ROW_IDENTITY_INCOMPLETE']);
});
test('added-row rule scopes to create/add intent; ordinary multi-field forms are not blocked',()=>{
  const login=['Ingresar "usuario1" en "Usuario"','Ingresar "clave-sintetica" en "Referencia"','Presionar "Continuar"','Validar que se muestre "Inicio"'];
  const transfer=['Presionar "Transferir"','Ingresar "100" en "Monto"','Ingresar "Cuenta 9" en "Destino"','Presionar "Confirmar"','Validar que se muestre "Transferencia exitosa"'];
  assert.deepEqual(gaps(login,{title:'Ingreso satisfactorio'}),[]);
  assert.deepEqual(gaps(transfer,{title:'Transferencia entre cuentas',expectedResult:'Se confirma la operación'}),[]);
  // Create intent from the title alone, or from an opener control alone, still fails closed.
  const form=['Ingresar "Ana Ruiz" en "Nombre"','Ingresar "Atlas" en "Alias"','Presionar "Guardar"','Validar que se muestre "Guardado"'];
  assert.deepEqual(gaps(form,{title:'Crear destinatario'}),['JIRA_ADDED_ROW_IDENTITY_INCOMPLETE']);
  assert.deepEqual(gaps(['Presionar "Agregar"',...form]),['JIRA_ADDED_ROW_IDENTITY_INCOMPLETE']);
});
test('search exclusion evidence is required only when the scenario itself claims exclusion',()=>{
  const noRows=['Ingresar "Zeta" en "Buscar"','Validar que se muestre "Zeta"'];
  assert.deepEqual(gaps(noRows,{title:'Búsqueda simple'}),[]);
  assert.deepEqual(gaps(noRows,{title:'Filtrar'}),[]);
  assert.deepEqual(gaps(noRows,{title:'Filtrar',expectedResult:'Los no coincidentes desaparecen'}),['JIRA_SEARCH_NONMATCH_EVIDENCE_MISSING']);
  assert.deepEqual(gaps([...noRows,'Validar que las filas que no coinciden se ocultan']),['JIRA_SEARCH_NONMATCH_EVIDENCE_MISSING']);
});
test('search over created rows requires a nonmatching row to disappear; exclusion claim without evidence fails closed',()=>{
  const search=[...addRow,'Validar que se muestre "Ana Ruiz - Atlas"','Ingresar "Zeta" en "Buscar"','Validar que se muestre "Zeta"'];
  // Entered but never observed after save: not evidence of a nonmatching row.
  const unobserved=['Ingresar "Ana Ruiz" en "Nombre"','Presionar "Guardar"','Ingresar "Zeta" en "Buscar"','Validar que se muestre "Zeta"'];
  assert.deepEqual(gaps(unobserved,{expectedResult:'Las filas que no coinciden se ocultan'}),['JIRA_SEARCH_NONMATCH_EVIDENCE_MISSING']);
  assert.deepEqual(gaps(unobserved),[]);
  assert.deepEqual(gaps(search),['JIRA_SEARCH_NONMATCH_ASSERTION_MISSING']);
  assert.deepEqual(gaps([...search,'Validar que no se muestre "Ana Ruiz"']),[]);
  const noRows=['Ingresar "Zeta" en "Buscar"','Validar que se muestre "Zeta"'];
  assert.deepEqual(gaps(noRows),[]);
  assert.deepEqual(gaps(noRows,{expectedResult:'Las filas que no coinciden se ocultan'}),['JIRA_SEARCH_NONMATCH_EVIDENCE_MISSING']);
  // A saved value overlapping the term is ambiguous, not evidence of a nonmatching row.
  assert.deepEqual(gaps(['Ingresar "Ana Ruiz" en "Nombre"','Presionar "Guardar"','Ingresar "Ana" en "Buscar"','Validar que se muestre "Ana"']),[]);
});
test('dialog open assertions must target the dialog or an exclusive field, not background text',()=>{
  const base=['Validar que se muestre "Beneficiarios"','Presionar "Añadir beneficiario"'];
  const form=['Ingresar "Ana" en "Nombre"','Presionar "Guardar"'];
  assert.deepEqual(gaps([...base,'Validar que se muestre "Beneficiarios"',...form]),['JIRA_DIALOG_ASSERTION_TARGET_UNSCOPED']);
  assert.deepEqual(gaps([...base,'Validar que se muestre "Añadir beneficiario"',...form]),['JIRA_DIALOG_ASSERTION_TARGET_UNSCOPED']);
  assert.deepEqual(gaps([...base,'Validar que se muestre "Nombre"',...form]),[]);
  assert.deepEqual(gaps([...base,'Validar que se muestre "Formulario de alta"',...form]),[]);
  assert.deepEqual(gaps([...base,'Validar que se muestre "Cuenta"',...form]),['JIRA_DIALOG_ASSERTION_TARGET_UNSCOPED']);
});
test('reopening a form after a verified save drops the closed modal labels from background; page labels stay rejected',()=>{
  const first=['Validar que se muestre "Beneficiarios"','Presionar "Añadir beneficiario"','Validar que se muestre "Nombre"','Ingresar "Ana" en "Nombre"','Presionar "Guardar"'];
  assert.deepEqual(gaps([...first,'Presionar "Añadir beneficiario"','Validar que se muestre "Nombre"','Ingresar "Zoe" en "Nombre"','Presionar "Guardar"']),[]);
  assert.deepEqual(gaps([...first,'Presionar "Añadir beneficiario"','Validar que se muestre "Beneficiarios"','Ingresar "Zoe" en "Nombre"','Presionar "Guardar"']),['JIRA_DIALOG_ASSERTION_TARGET_UNSCOPED']);
});
test('add -> exclusive field anchors -> save -> reopen -> anchors passes; background button/page label still rejected',()=>{
  const cycle=(open2:string,id1=['Validar que se muestre "Ana - Atlas"'],id2=['Validar que se muestre "Zoe - Luna"'])=>['Validar que se muestre "Beneficiarios"','Presionar "Añadir beneficiario"','Validar que se muestre "Nombre"','Validar que se muestre "Alias"','Ingresar "Ana" en "Nombre"','Ingresar "Atlas" en "Alias"','Presionar "Guardar"',...id1,'Presionar "Añadir beneficiario"',open2,'Ingresar "Zoe" en "Nombre"','Ingresar "Luna" en "Alias"','Presionar "Guardar"',...id2];
  assert.deepEqual(gaps(cycle('Validar que se muestre "Alias"')),[]);
  // Reopen anchors never replace row identity: each successful save needs its own.
  assert.deepEqual(gaps(cycle('Validar que se muestre "Alias"',[])),['JIRA_ADDED_ROW_IDENTITY_INCOMPLETE']);
  assert.deepEqual(gaps(cycle('Validar que se muestre "Alias"',undefined,[])),['JIRA_ADDED_ROW_IDENTITY_INCOMPLETE']);
  assert.deepEqual(gaps(cycle('Validar que se muestre "Añadir beneficiario"')),['JIRA_DIALOG_ASSERTION_TARGET_UNSCOPED']);
  assert.deepEqual(gaps(cycle('Validar que se muestre "Beneficiarios"')),['JIRA_DIALOG_ASSERTION_TARGET_UNSCOPED']);
});
test('loose "fila con ..." wording normalizes to executable matching-row wording',()=>{
  const out=normalizeJiraGeneratedSteps(['Validar que la fila con el nombre y alias ingresados aparezca en "Destinatarios guardados"']);
  assert.deepEqual(out,['Validar que la fila coincidente con el nombre y alias ingresados aparezca en "Destinatarios guardados"']);
});
test('duplicate case isolates the named field: same data for it, distinct data for the others',()=>{
  const dup=(account2:string,alias2:string)=>['Ingresar "111" en "Cuenta"','Ingresar "Atlas" en "Alias"','Presionar "Guardar"','Validar que se muestre "111 - Atlas"',`Ingresar "${account2}" en "Cuenta"`,`Ingresar "${alias2}" en "Alias"`,'Presionar "Guardar"','Validar que se muestre "Alias duplicado"'];
  const claim={title:'Rechaza alias duplicado'};
  assert.deepEqual(gaps(dup('222','Atlas'),claim),[]);
  assert.deepEqual(gaps(dup('111','Atlas'),claim),['JIRA_DUPLICATE_COLLISION_NOT_ISOLATED']);
  assert.deepEqual(gaps(dup('222','Otro'),claim),['JIRA_DUPLICATE_BASELINE_ATTEMPT_UNLINKED']);
  assert.deepEqual(gaps(dup('111','Otro'),{title:'Rechaza cuenta duplicada'}),[]);
  assert.deepEqual(gaps(dup('222','Atlas'),{title:'Rechaza registro duplicado'}),['JIRA_DUPLICATE_TARGET_AMBIGUOUS']);
  // No field repeated between baseline and attempt: fail closed.
  assert.deepEqual(gaps(['Ingresar "111" en "Cuenta"','Presionar "Guardar"','Validar que se muestre "111"','Ingresar "222" en "Otro"','Presionar "Guardar"'],claim),['JIRA_DUPLICATE_TARGET_AMBIGUOUS']);
  // Baseline never observed before the duplicate attempt.
  // The baseline is itself a created row, so with no assertion at all it also lacks same-row identity.
  assert.deepEqual(gaps(dup('222','Atlas').filter(step=>step!=='Validar que se muestre "111 - Atlas"'),claim),['JIRA_ADDED_ROW_IDENTITY_INCOMPLETE','JIRA_DUPLICATE_BASELINE_UNOBSERVED']);
  // Baseline observed, but by separate assertions: identity gap only. The rejected attempt (no row added) needs no identity assertion.
  const split=dup('222','Atlas').flatMap(step=>step==='Validar que se muestre "111 - Atlas"'?['Validar que se muestre "111"','Validar que se muestre "Atlas"']:[step]);
  assert.deepEqual(gaps(split,claim),['JIRA_ADDED_ROW_IDENTITY_INCOMPLETE']);
});
test('unquoted dynamic inputs bind by field label: row identity, modal cycle, nonregression, duplicates',()=>{
  const dyn=['Presionar "Añadir"','Ingresar un nombre nuevo en "Nombre del beneficiario"','Ingresar un alias nuevo en "Alias"','Presionar "Guardar"'];
  assert.deepEqual(gaps(dyn),['JIRA_ADDED_ROW_IDENTITY_INCOMPLETE']);
  assert.deepEqual(gaps([...dyn,'Validar que se muestre "Guardado"']),['JIRA_ADDED_ROW_IDENTITY_INCOMPLETE']);
  assert.deepEqual(gaps([...dyn,'Validar que la fila coincidente con el nombre y alias ingresados aparezca en "Destinatarios guardados"']),[]);
  // modal open/save/reopen: dialog-exclusive dynamic labels anchor; page labels do not
  const rowId='Validar que la fila coincidente con el nombre y alias ingresados aparezca en "Destinatarios guardados"';
  const cycle=(open2:string)=>['Validar que se muestre "Beneficiarios"','Presionar "Añadir beneficiario"','Validar que se muestre "Alias"','Ingresar un nombre nuevo en "Nombre del beneficiario"','Ingresar un alias nuevo en "Alias"','Presionar "Guardar"',rowId,'Presionar "Añadir beneficiario"',open2,'Ingresar otro nombre en "Nombre del beneficiario"','Ingresar otro alias en "Alias"','Presionar "Guardar"',rowId];
  assert.deepEqual(gaps(cycle('Validar que se muestre "Alias"')),[]);
  assert.deepEqual(gaps(cycle('Validar que se muestre "Beneficiarios"')),['JIRA_DIALOG_ASSERTION_TARGET_UNSCOPED']);
  // login / transfer forms are not rows
  assert.deepEqual(gaps(['Ingresar el usuario en "Usuario"','Ingresar el monto en "Monto"','Presionar "Continuar"','Validar que se muestre "Inicio"'],{title:'Ingreso'}),[]);
  assert.deepEqual(gaps(['Presionar "Transferir"','Seleccionar cuenta en "Cuenta de origen"','Ingresar un monto válido en "Monto"','Presionar "Confirmar"','Validar que se muestre "Éxito"'],{title:'Transferencia'}),[]);
  // dynamic search + claimed exclusion without UI evidence fails closed
  assert.deepEqual(gaps(['Ingresar un término en "Buscar"','Validar que se muestre "Resultados"'],{expectedResult:'Los no coincidentes desaparecen'}),['JIRA_SEARCH_NONMATCH_EVIDENCE_MISSING']);
  // duplicate: only explicit same-value intent links baseline and attempt
  const dup=(reuse:boolean)=>['Ingresar una cuenta nueva en "Cuenta"','Ingresar un alias nuevo en "Alias"','Presionar "Guardar"','Validar que se muestre "Alias"',`Ingresar ${reuse?'el mismo alias':'otro alias'} en "Alias"`,'Ingresar otra cuenta en "Cuenta"','Presionar "Guardar"','Validar que se muestre "Alias duplicado"'];
  assert.ok(gaps(dup(false),{title:'Rechaza alias duplicado'}).includes('JIRA_DUPLICATE_BASELINE_ATTEMPT_UNLINKED'));
  assert.ok(!gaps(dup(true),{title:'Rechaza alias duplicado'}).includes('JIRA_DUPLICATE_BASELINE_ATTEMPT_UNLINKED'));
});
