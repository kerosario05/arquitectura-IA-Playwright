import test from 'node:test';
import assert from 'node:assert/strict';
import {generateJiraScenarios,normalizeJiraGeneratedSteps,normalizeJiraGeneratedEncoding,auditGeneratedJiraSyntax} from './jira-scenario-generator';
import {prepareJiraGenerationDrafts,realignRepairedUi,sourceHasControlledInputFailure,observedAccessSubmitTransitions} from './jira-generation-preparation';
import {deriveJiraInputRequirements} from './jira-input-requirements';
import {discoverJiraScenario,type JiraBrowserPort} from './jira-semantic-executor';
import {compileJiraSpec} from './jira-spec-compiler';
import path from 'node:path';
import {jiraGenerationContractErrors,jiraSourceConditions,repairMissingJiraConditionalAssertions} from './jira-generation-contract';
import {JiraGenerationCache,jiraGenerationCacheKey} from './jira-generation-cache';
import type {JiraIssueSource} from '../scenarios/scenario-types';
import type {AiProvider} from '../ai/ai-provider.types';
import {parseStepIntent} from '../discovery/step-intent-parser';

const issue:JiraIssueSource={key:'HU-1',summary:'Operation',description:'AC1 — Confirmation\nMostrar Discount cuando aplique.\nAC2 — Errors\nUn Token no válido impide completar la operación sin mostrar Receipt.',acceptanceCriteria:null,labels:[],components:[],status:'Open',issueType:'Story'};

test('explicit credential steps do not also invoke the configured full-authentication flow',()=>{
 const explicit=prepareJiraGenerationDrafts([{sourceIssueKey:'HU-1',title:'Personal login',authIntent:'full_authentication',steps:[
  'Ingresar Cédula en "Cédula"','Ingresar usuario en "Usuario"','Ingresar contraseña en "Contraseña"','Presionar "Iniciar sesión"',
 ]}], [issue])[0] as Record<string,unknown>;
 assert.equal(explicit.authIntent,undefined);
 const delegated=prepareJiraGenerationDrafts([{sourceIssueKey:'HU-1',title:'Login via app flow',authIntent:'full_authentication',steps:['Abrir aplicación','Validar pantalla de acceso']}], [issue])[0] as Record<string,unknown>;
 assert.equal(delegated.authIntent,'full_authentication');
});

test('dynamic table existence is proven through scoped row actions and later input metadata is reindexed',()=>{
 const source={...issue,description:'Agregar ingreso agrega una fila observable, inicialmente vacía; cada fila requiere tipo e importe antes de avanzar.'};
 const draft={sourceIssueKey:source.key,steps:['Presionar "Agregar ingreso"','Validar que "segunda fila de ingresos" esté disponible para completar','Seleccionar tipo de la segunda fila de ingresos','Ingresar importe en "importe de la segunda fila de ingresos"'],inputRequirements:[{key:'income-type-2',label:'tipo',stepIndex:3,operation:'select'},{key:'income-amount-2',label:'importe de la segunda fila de ingresos',stepIndex:4,operation:'fill'}],unresolvedUiRequirements:[{stepIndex:2,requirement:'observar fila'}]};
 const prepared=prepareJiraGenerationDrafts([draft],[source])[0] as typeof draft;
 assert.deepEqual(prepared.steps,['Presionar "Agregar ingreso"','Seleccionar tipo de la segunda fila de ingresos','Ingresar importe en "importe de la segunda fila de ingresos"']);
 assert.deepEqual(prepared.inputRequirements.map(item=>item.stepIndex),[2,3]);
 assert.deepEqual(prepared.unresolvedUiRequirements,[]);
});

test('navigation prose is dropped only when a later action targets the same destination, with metadata reindexed',()=>{
 const prep=(steps:string[],extra:Record<string,unknown>={})=>prepareJiraGenerationDrafts([{sourceIssueKey:'HU-1',steps,...extra}],[issue])[0] as {steps:string[];inputRequirements?:Array<{stepIndex:number}>;unresolvedUiRequirements?:Array<{stepIndex:number}>;conditionRequirements?:Array<{stepIndices:number[]}>};
 const prose='Navegar por la ruta de auditoría';
 // matching destination: removed, all step-indexed metadata shifted
 const matched=prep(['Abrir la aplicación configurada del proyecto.',prose,'Presionar "Auditoría"','Ingresar importe en "Monto"'],{
  inputRequirements:[{key:'a',label:'Monto',stepIndex:4,operation:'fill'}],
  unresolvedUiRequirements:[{stepIndex:2,requirement:'ruta'},{stepIndex:3,requirement:'x'}],
  conditionRequirements:[{key:'c',stepIndices:[2,3,4]}]});
 assert.deepEqual(matched.steps,['Abrir la aplicación configurada del proyecto.','Presionar "Auditoría"','Ingresar importe en "Monto"']);
 assert.deepEqual(matched.inputRequirements?.map(item=>item.stepIndex),[3]);
 assert.deepEqual(matched.unresolvedUiRequirements?.map(item=>item.stepIndex),[2]);
 assert.deepEqual(matched.conditionRequirements?.[0].stepIndices,[2,3]);
 // unrelated quoted action: prose and its unresolved requirement stay
 const unrelated=prep([prose,'Presionar "Empresarial"'],{unresolvedUiRequirements:[{stepIndex:1,requirement:'ruta'}]});
 assert.deepEqual(unrelated.steps,[prose,'Presionar "Empresarial"']);
 assert.deepEqual(unrelated.unresolvedUiRequirements?.map(item=>item.stepIndex),[1]);
 // no action at all: prose stays
 assert.deepEqual(prep([prose]).steps,[prose]);
});

test('an explicit first-row-then-second-row source removes a premature add-row click and reindexes inputs',()=>{
 const source={...issue,description:'Recorrido: registrar tipo, importe y frecuencia en la primera fila de ingresos, agregar una segunda fila y completar su tipo, importe y frecuencia.'};
 const draft={sourceIssueKey:source.key,title:'Complete two income rows',steps:[
  'Presionar "Agregar ingreso"',
  'Seleccionar tipo en "Tipo de ingreso de la fila 1"',
  'Ingresar importe en "Importe de la fila 1 de ingresos"',
  'Seleccionar frecuencia en "Frecuencia de la fila 1 de ingresos"',
  'Presionar "Agregar ingreso"',
  'Seleccionar tipo en "Tipo de ingreso de la fila 2"',
  'Ingresar importe en "Importe de la fila 2 de ingresos"',
  'Seleccionar frecuencia en "Frecuencia de la fila 2 de ingresos"',
 ],inputRequirements:[{key:'row-1-type',label:'Tipo de ingreso de la fila 1',stepIndex:2,operation:'select'},{key:'row-2-type',label:'Tipo de ingreso de la fila 2',stepIndex:6,operation:'select'}],unresolvedUiRequirements:[{stepIndex:1,requirement:'observe first row'}]};
 const prepared=prepareJiraGenerationDrafts([draft],[source])[0] as typeof draft;
 assert.deepEqual(prepared.steps,[...draft.steps.slice(1)]);
 assert.deepEqual(prepared.inputRequirements.map(field=>field.stepIndex),[1,5]);
 assert.deepEqual(prepared.unresolvedUiRequirements,[]);
 const noOrderedSource={...source,description:'La tabla permite agregar filas y completar cada ingreso.'};
 assert.deepEqual(prepareJiraGenerationDrafts([draft],[noOrderedSource])[0],draft);
});

const premature='Validar que se muestre "Ref ABC-77, Total 2500"';
const journey=(tail:string[])=>({sourceIssueKey:'HU-1',title:'Filter',steps:[
 'Abrir la aplicación','Presionar "Acceso"',premature,'Ingresar Usuario en "Usuario"','Ingresar Contraseña en "Contraseña"','Presionar "Entrar"',
 'Presionar "Lista"','Ingresar 1 en "Desde"','Seleccionar X en "Tipo"','Presionar "Aplicar"',...tail,
],inputRequirements:[{key:'from',label:'Desde',stepIndex:8,operation:'fill'}]});

test('a result assertion placed before login moves after the submit that produces it',()=>{
 const source={...issue,description:'Al presionar Aplicar se muestra la fila ABC-77 con total 2500.'};
 const draft={...journey(['Ingresar 2 en "Hasta"','Presionar "Exportar"']),conditionRequirements:[{key:'c',kind:'x',stepIndices:[3,6,10]}]};
 const prepared=prepareJiraGenerationDrafts([draft],[source])[0] as typeof draft;
 assert.deepEqual(prepared.steps.slice(-4),['Presionar "Aplicar"',premature,'Ingresar 2 en "Hasta"','Presionar "Exportar"']);
 assert.equal(prepared.steps.indexOf(premature)>prepared.steps.indexOf('Presionar "Entrar"'),true);
 assert.equal(prepared.inputRequirements[0].stepIndex,7);
 assert.deepEqual(prepared.conditionRequirements[0],{key:'c',kind:'x',stepIndices:[10,5,9]});
});

test('action and result in separate sentences of one criterion relocate; across criteria they do not',()=>{
 const same={...issue,description:'AC1: Se ve la pantalla.\nAC4: El usuario debe pulsar Aplicar filtros. La tabla muestra la fila ABC-77 con total 2500.'};
 const draft=journey(['Ingresar 2 en "Hasta"']);
 const labeled={...draft,steps:draft.steps.map(step=>step==='Presionar "Aplicar"'?'Presionar "Aplicar filtros"':step)};
 const prepared=prepareJiraGenerationDrafts([labeled],[same])[0] as typeof draft;
 assert.equal(prepared.steps.indexOf(premature),prepared.steps.indexOf('Presionar "Aplicar filtros"')+1);
 const split={...issue,description:'AC1: El usuario debe pulsar Aplicar filtros.\nAC2: La tabla muestra la fila ABC-77 con total 2500.'};
 assert.deepEqual(prepareJiraGenerationDrafts([labeled],[split])[0],labeled);
});

test('dotted sub-criteria stay in their parent block; a sibling criterion does not merge',()=>{
 const draft=journey(['Ingresar 2 en "Hasta"']);
 const labeled={...draft,steps:draft.steps.map(step=>step==='Presionar "Aplicar"'?'Presionar "Aplicar filtros"':step)};
 const nested={...issue,description:'AC4 — Filtrado.\nEl usuario debe pulsar Aplicar filtros. Luego revisa el resultado.\nAC4.1 — La tabla muestra la fila ABC-77 con total 2500.\nAC4.2 — Se ve el contador.\nAC5 — Exportar.'};
 const prepared=prepareJiraGenerationDrafts([labeled],[nested])[0] as typeof draft;
 assert.equal(prepared.steps.indexOf(premature),prepared.steps.indexOf('Presionar "Aplicar filtros"')+1);
 const sibling={...issue,description:'AC4 — El usuario debe pulsar Aplicar filtros.\nAC5.1 — La tabla muestra la fila ABC-77 con total 2500.'};
 assert.deepEqual(prepareJiraGenerationDrafts([labeled],[sibling])[0],labeled);
});

test('a premature assertion does not move to an unrelated later press',()=>{
 const source={...issue,description:'Al presionar Aplicar se muestra la fila ABC-77 con total 2500.'};
 const unrelated={...journey(['Ingresar 2 en "Hasta"','Presionar "Exportar"']),steps:journey(['Ingresar 2 en "Hasta"','Presionar "Exportar"']).steps.filter(step=>step!=='Presionar "Aplicar"')};
 assert.deepEqual(prepareJiraGenerationDrafts([unrelated],[source])[0],unrelated);
});

test('a premature assertion stays put when the source does not establish it or no producing action exists',()=>{
 const ungrounded={...issue,description:'Al filtrar se muestra una fila.'};
 assert.deepEqual(prepareJiraGenerationDrafts([journey([])],[ungrounded])[0],journey([]));
 const source={...issue,description:'Al presionar Aplicar se muestra la fila ABC-77 con total 2500.'};
 const noProducer={...journey([]),steps:journey([]).steps.filter(step=>!/Aplicar|Desde|Tipo/.test(step))};
 assert.deepEqual(prepareJiraGenerationDrafts([{...noProducer,inputRequirements:[]}],[source])[0],{...noProducer,inputRequirements:[]});
});

const tableSource:JiraIssueSource={...issue,description:'',acceptanceCriteria:'AC1 — Filtrar por Código, Estado y Total. AC2 — Al aplicar, la tabla muestra Código ZX-91, Etiqueta Lote norte, Total − US$12,345.60 y Estado Activo. Se muestra el aviso Código ZX-91 guardado. El archivo incluye los encabezados Código, Etiqueta, Total y Estado.'};
const tableDraft=(steps:string[])=>({sourceIssueKey:tableSource.key,title:'Table',steps,inputRequirements:[{key:'k',label:'Código',stepIndex:steps.length,operation:'fill'}]});

test('tabular heading+value assertions keep only the cell value, rejoin grouped amounts, and remap metadata',()=>{
 const draft=tableDraft(['Presionar "Aplicar"','Validar que se muestre "Código ZX-91"','Validar que se muestre "Etiqueta Lote norte"','Validar que se muestre "Total − US$12"','Validar que se muestre "345.60"','Validar que se muestre "Estado Activo"','Ingresar 1 en "Código"']);
 const prepared=prepareJiraGenerationDrafts([draft],[tableSource])[0] as typeof draft;
 assert.deepEqual(prepared.steps,['Presionar "Aplicar"','Validar que se muestre "ZX-91"','Validar que se muestre "Lote norte"','Validar que se muestre "− US$12,345.60"','Validar que se muestre "Activo"','Ingresar 1 en "Código"']);
 assert.equal(prepared.inputRequirements[0].stepIndex,6);
});

test('tabular cell value keeps its leading sign so financial polarity is preserved',()=>{
 for(const sign of ['−','+','-']){
  const source={...tableSource,acceptanceCriteria:`AC1 — Filtrar por Total. AC2 — Al aplicar, la tabla muestra Total ${sign} RD$2,500.00. Filtrar por Total.`};
  const draft=tableDraft([`Validar que se muestre "Total ${sign} RD$2,500.00"`]);
  assert.deepEqual((prepareJiraGenerationDrafts([draft],[source])[0] as typeof draft).steps,[`Validar que se muestre "${sign} RD$2,500.00"`]);
 }
});

test('compound visible phrases outside a table sentence or without a recurring heading stay unchanged',()=>{
 const steps=['Validar que se muestre "aviso Código ZX-91 guardado"','Validar que se muestre "Lote norte"'];
 const draft=tableDraft(steps);
 assert.deepEqual((prepareJiraGenerationDrafts([draft],[tableSource])[0] as typeof draft).steps,steps);
 const noCue={...tableSource,acceptanceCriteria:'AC2 — Se muestra Código ZX-91. Filtrar por Código.'};
 const single=tableDraft(['Validar que se muestre "Código ZX-91"']);
 assert.deepEqual(prepareJiraGenerationDrafts([single],[noCue])[0],single);
});

test('an incomplete first-row scenario does not create an unrelated empty second row',()=>{
 const source={...issue,description:'Completar tipo, importe y frecuencia en la primera fila de ingresos y luego agregar una segunda fila. Si una fila está incompleta, no se avanza.'};
 const draft={sourceIssueKey:source.key,title:'Block on incomplete income row',steps:[
  'Presionar "Agregar ingreso"',
  'Seleccionar tipo en la primera fila de ingresos',
  'Seleccionar frecuencia en la primera fila de ingresos',
  'Presionar "Continuar"',
  'Validar que el campo "Importe" muestre un error de validación',
 ],inputRequirements:[{key:'type',label:'Tipo',stepIndex:2,operation:'select'},{key:'frequency',label:'Frecuencia',stepIndex:3,operation:'select'}]};
 const prepared=prepareJiraGenerationDrafts([draft],[source])[0] as typeof draft;
 assert.deepEqual(prepared.steps,[...draft.steps.slice(1)]);
 assert.deepEqual(prepared.inputRequirements.map(field=>field.stepIndex),[1,2]);
});

test('negative indicative visibility preserves target and polarity through the Jira audit',async()=>{
 const steps=normalizeJiraGeneratedSteps(['Validar que se muestre "Error"','Validar que no se muestra "Receipt".']);
 assert.deepEqual(steps,['Validar que se muestre "Error"','Validar que no se muestre "Receipt"']);
 assert.deepEqual(await auditGeneratedJiraSyntax([{title:'Negative',steps}]),[]);
 assert.equal(normalizeJiraGeneratedSteps(['Validar que no se permita continuar.'])[0],'Validar que no se permita continuar.');
});

test('provider encoding repair is reversible and does not change valid Unicode or literal controls',()=>{
 const correct='Ingresar token inválido en "Código".';
 const corrupt=Buffer.from(correct,'utf8').toString('latin1');
 assert.deepEqual(normalizeJiraGeneratedEncoding({steps:[corrupt],inputRequirements:[{label:'Código'}]}),{steps:[correct],inputRequirements:[{label:'Código'}]});
 for(const text of ['Ãrea','Código','日本語','Âmbito']) assert.equal(normalizeJiraGeneratedEncoding(text),text);
});

test('encoded controlled failure keeps its editable input condition and reaches Discovery readiness across profiles',async()=>{
 for(const appSlug of ['fixture-shop','fixture-service']) {
  const source={...issue,description:'El token no válido impide completar la operación y el sistema informa el problema sin mostrar Receipt.'};
  const encode=(text:string)=>Buffer.from(text,'utf8').toString('latin1');
  const draft={sourceIssueKey:source.key,title:'Operación no completada',preconditions:[],steps:[encode('Ingresar token inválido en "Código".'),'Validar que Sistema informe el problema.','Validar que no se muestra "Receipt".'],expectedResult:'No se muestra Receipt',inputRequirements:[{key:'token',label:encode('Código'),operation:'fill',stepIndex:1}]};
  let calls=0;
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){calls++;return {rawText:'',parsedJson:{scenarios:[draft]},model:'fixture',providerName:'fixture',durationMs:0};}};
  const result=await generateJiraScenarios([source],appSlug,provider);
  assert.equal(calls,1);
  assert.equal(result.scenarios[0].validation.valid,true);
  assert.equal(result.scenarios[0].executionReadiness,'requires_discovery');
  assert.equal(result.scenarios[0].inputRequirements?.[0].dataCondition,'invalid');
  assert.equal(result.scenarios[0].inputRequirements?.[0].label,'Código');
  assert.equal(result.scenarios[0].inputRequirements?.[0].key,'token');
 }
});

test('reported problem becomes an authored semantic target across projects without inventing error wording',async()=>{
 for(const actor of ['Sistema A','Servicio B']) {
  const steps=normalizeJiraGeneratedSteps([`Validar que ${actor} informe el problema.`,'Validar que no se muestra "Receipt".']);
  assert.deepEqual(steps,['Validar que se muestre "problema"','Validar que no se muestre "Receipt"']);
  assert.deepEqual(await auditGeneratedJiraSyntax([{title:actor,steps}]),[]);
 }
 assert.equal(normalizeJiraGeneratedSteps(['Validar que no informe el problema.'])[0],'Validar que no informe el problema.');
});

test('missing conditional subject is added only at a unique source-named stage with metadata reindexed',()=>{
 const source={...issue,description:'AC1 — Confirmation\nMostrar Discount cuando aplique.'};
 const draft={sourceIssueKey:source.key,title:'Completed',steps:['Validar que se muestre "Confirmation"','Ingresar valor en "Amount"','Validar que se muestre "Receipt"'],acceptanceCriteriaRefs:['AC1'],inputRequirements:[{stepIndex:2,label:'Amount',operation:'fill',key:'amount'}],unresolvedUiRequirements:[{stepIndex:3,requirement:'Receipt'}]};
 const prepared=prepareJiraGenerationDrafts([draft],[source])[0] as typeof draft;
 assert.equal(prepared.steps[1],'Validar que se muestre "discount"');
 assert.equal(prepared.inputRequirements[0].stepIndex,3);
 assert.equal(prepared.unresolvedUiRequirements[0].stepIndex,4);
 assert.deepEqual(jiraGenerationContractErrors(prepared,source),[]);
 for(const steps of [['Validar que se muestre "Summary"'],['Validar que se muestre "Confirmation"','Validar que se muestre "Confirmation"']]) {
  const ambiguous={...draft,steps};
  assert.deepEqual((prepareJiraGenerationDrafts([ambiguous],[source])[0] as typeof draft).steps,steps);
  assert.ok(jiraGenerationContractErrors(ambiguous,source).includes('JIRA_CONDITION_ASSERTION_MISSING'));
 }
});

test('conditional assertions stay with the source business stage when an earlier screen has a similar summary across profiles',async()=>{
 const source={...issue,key:'HU-RATE',description:'AC5 — Confirmación\nAntes de autorizar la transferencia, la aplicación presenta un resumen con las cuentas seleccionadas, el monto, la comisión, los impuestos, la tasa de cambio cuando aplique y el total a debitar.'};
 const draft={sourceIssueKey:source.key,title:'Own-account transfer',acceptanceCriteriaRefs:['AC5'],expectedResult:'Se muestra el comprobante de transacción exitosa.',steps:[
  'Abrir la aplicación configurada del proyecto',
  'Presionar "perfil empresarial"',
  'Ingresar RNC en "RNC"',
  'Ingresar usuario en "Usuario"',
  'Ingresar contraseña en "Contraseña"',
  'Presionar "continuar inicio de sesión"',
  'Validar que se muestre "verificación de usuario"',
  'Solicitar el código por SMS',
  'Ingresar código de acceso en "Código"',
  'Presionar "continuar inicio de sesión"',
  'Validar que se muestre "resumen de productos"',
  'Validar que se muestre "tasa de cambio"',
  'Presionar "Transferencias"',
  'Presionar "Cuentas Propias"',
  'Validar que se muestre "transferencias"',
  'Seleccionar cuenta de origen en "Cuenta de origen"',
  'Seleccionar cuenta de destino en "Cuenta de destino"',
  'Ingresar monto en "Monto"',
  'Validar que se muestre "cuenta de origen"',
  'Validar que se muestre "cuenta de destino"',
  'Presionar "Continuar"',
  'Validar que se muestre "cuentas seleccionadas"',
  'Validar que se muestre "monto"',
  'Validar que se muestre "comisión"',
  'Validar que se muestre "impuestos"',
  'Validar que se muestre "tasa de cambio aplicable"',
  'Validar que se muestre "total a debitar"',
  'Presionar "Continuar"',
  'Validar que se muestre "validación de identidad"',
  'Solicitar el token por SMS',
  'Ingresar token de seguridad en "Token"',
  'Presionar "Autorizar transferencia"',
  'Validar que se muestre "comprobante de transacción exitosa"',
  'Validar que se muestre "monto"',
  'Validar que se muestre "cuentas involucradas"',
  'Validar que se muestre "fecha y hora"',
  'Validar que se muestre "referencia de la operación"',
 ],inputRequirements:[{key:'amount',label:'Monto',operation:'fill',stepIndex:18}],unresolvedUiRequirements:[{stepIndex:26,requirement:'Observe the exchange rate in the confirmation.'}]};

 for(const appSlug of ['profile-one','profile-two']) {
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){return {rawText:'',parsedJson:{scenarios:[draft]},model:'fixture',providerName:'fixture',durationMs:0};}};
  const result=await generateJiraScenarios([source],appSlug,provider);
  const prepared=result.scenarios[0];
  assert.equal(prepared.validation.valid,true,JSON.stringify(prepared.validation.errors));
  const transferIndex=prepared.steps.indexOf('Presionar "Transferencias"');
  assert.ok(!prepared.steps.slice(0,transferIndex).some(step=>/tasa de cambio/i.test(step)));
  const rateIndex=prepared.steps.indexOf('Validar que se muestre "tasa de cambio aplicable"');
  assert.ok(rateIndex>prepared.steps.indexOf('Validar que se muestre "impuestos"'),JSON.stringify(prepared.steps));
  assert.ok(rateIndex<prepared.steps.indexOf('Validar que se muestre "total a debitar"'));
  assert.deepEqual(jiraSourceConditions(prepared,source)[0].stepIndices,[rateIndex+1]);
  assert.equal(prepared.inputRequirements?.find(field=>field.label==='Monto')?.stepIndex,17);
  assert.equal(prepared.unresolvedUiRequirements?.[0]?.stepIndex,25);
  assert.deepEqual(jiraGenerationContractErrors(prepared,source),[]);

  const missingConfirmationRate={...draft,steps:draft.steps.filter(step=>step!=='Validar que se muestre "tasa de cambio aplicable"'),unresolvedUiRequirements:[]};
  const missingProvider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){return {rawText:'',parsedJson:{scenarios:[missingConfirmationRate]},model:'fixture',providerName:'fixture',durationMs:0};}};
  const repairedMissing=await generateJiraScenarios([source],appSlug,missingProvider);
  const repairedSteps=repairedMissing.scenarios[0].steps;
  const repairedRateIndex=repairedSteps.findIndex(step=>/Validar que se muestre "tasa de cambio(?: aplicable)?"/.test(step));
  assert.ok(repairedRateIndex>repairedSteps.indexOf('Validar que se muestre "impuestos"'));
  assert.ok(repairedRateIndex<repairedSteps.indexOf('Validar que se muestre "total a debitar"'));
  assert.deepEqual(repairedMissing.scenarios[0].conditionRequirements?.[0].stepIndices,[repairedRateIndex+1]);
 }
});

test('source failure grammar recognizes negated valid inputs without treating valid data as a failure',()=>{
 for(const clause of ['El Token no es válido.','Los códigos no son válidos.','Un Token no válido.']) assert.equal(sourceHasControlledInputFailure({...issue,description:clause}),true);
 assert.equal(sourceHasControlledInputFailure({...issue,description:'El Token es válido.'}),false);
});

test('conditional business summary follows its source-named input submit when the summary uses observed product names',async()=>{
 for(const [field,subject] of [['Monto','tasa de cambio'],['Cantidad','descuento']]) {
  const source={...issue,description:`AC5 — Confirmación\nAntes de autorizar la operación, la aplicación presenta un resumen con ${field.toLowerCase()}, ${subject} cuando aplique.`};
  const draft={sourceIssueKey:issue.key,title:'Operación',acceptanceCriteriaRefs:['AC5'],steps:[
   'Validar que se muestre "el resumen de sus productos"',`Validar que se muestre "${subject}"`,
   'Presionar "Operaciones"',`Ingresar un valor en "${field}"`,'Presionar "Continuar"',
   'Validar que se muestre "Producto A · Producto B"','Presionar "Continuar"','Validar que se muestre "Autorización"',
  ],inputRequirements:[{key:'amount',label:field,operation:'fill',stepIndex:4}],unresolvedUiRequirements:[{stepIndex:6,requirement:'Observe the reviewed products.'}]};
  const repaired=repairMissingJiraConditionalAssertions(draft,source);
  const conditionIndex=repaired.steps.indexOf(`Validar que se muestre "${subject}"`);
  assert.equal(conditionIndex,repaired.steps.indexOf('Validar que se muestre "Producto A · Producto B"')+1);
  assert.equal(repaired.steps.filter(step=>step===`Validar que se muestre "${subject}"`).length,1);
  assert.equal(repaired.inputRequirements[0].key,'amount');
  assert.equal(repaired.inputRequirements[0].stepIndex,3);
  assert.equal(repaired.unresolvedUiRequirements[0].stepIndex,5);
  assert.deepEqual(jiraSourceConditions(JSON.parse(JSON.stringify(repaired)),source)[0].stepIndices,[conditionIndex+1]);
  let submitted=false;
  const browser:JiraBrowserPort={async navigate(){},async act(_step,target){
   if(target==='Continuar')submitted=true;
   return {strategy:'css',value:'#fixture-control'};
  },async assert(target){
   if(target===subject)assert.equal(submitted,true,'conditional oracle must follow the source-named data submit');
   return {observedText:target};
  }};
  const execution={...JSON.parse(JSON.stringify(repaired)),scenarioId:`${issue.key}:jira:stage`,expectedResult:'Autorización',
   conditionRequirements:jiraSourceConditions(repaired,source),inputRequirements:deriveJiraInputRequirements(repaired.steps,repaired.inputRequirements)};
  const contract=await discoverJiraScenario(execution,browser,{amount:'synthetic-value'});
  const plannedCondition=contract.plan.steps.find(step=>step.description===repaired.steps[conditionIndex]);
  assert.ok(plannedCondition);
  assert.equal(contract.sourceScenario.observableOracles?.find(oracle=>oracle.target===subject)?.stepIndex,plannedCondition.index);
  const compiled=compileJiraSpec({plan:contract.plan,sourceScenario:contract.sourceScenario,appSlug:'fixture-summary',sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-conditional-stage/case.spec.ts')});
  assert.deepEqual(compiled.unsupported,[]);
  const missingReview={...draft,steps:draft.steps.slice(0,5)};
  const blocked=repairMissingJiraConditionalAssertions(missingReview,source);
  assert.ok(jiraGenerationContractErrors(blocked,source).includes('JIRA_CONDITION_ASSERTION_MISSING'));
 }
});

test('source-backed quoted conditional text is normalized while literal UI labels remain unchanged',()=>{
 const draft={sourceIssueKey:issue.key,title:'Result',steps:['Validar que se muestre "Discount cuando aplique"'],acceptanceCriteriaRefs:['AC1']};
 const prepared=prepareJiraGenerationDrafts([draft],[issue])[0] as typeof draft;
 assert.deepEqual(prepared.steps,['Validar que se muestre "Discount"']);
 assert.deepEqual(jiraGenerationContractErrors(prepared,issue),[]);
 assert.deepEqual(prepareJiraGenerationDrafts([draft],[{...issue,description:'Mostrar Total.'}])[0],draft);
 assert.deepEqual(jiraGenerationContractErrors({...draft,steps:['Validar que se muestre "Total"']},issue),['JIRA_CONDITION_ASSERTION_MISSING']);
});

test('same-source controlled rejection prepares incomplete cases without extra AI calls across profiles',async()=>{
 const sourceIssue={...issue,description:'Confirmation: Show Discount when applicable. Errors: An invalid Token prevents operation completion without Receipt.',acceptanceCriteria:null};
 for(const appSlug of ['fixture-shop','fixture-service']) {
  const positive={sourceIssueKey:issue.key,title:'Completed',preconditions:[],steps:['Validar "Discount cuando aplique"','Validar "Receipt"'],expectedResult:'Receipt',acceptanceCriteriaRefs:['AC1']};
  const rejected={sourceIssueKey:issue.key,title:'Token rejected',preconditions:[],steps:['Ingresar token no válido en "Token"','Validar "Error"','Validar que se muestre "la ausencia de Receipt"'],expectedResult:'No se muestra Receipt',acceptanceCriteriaRefs:['AC1','AC2']};
  const incomplete={sourceIssueKey:issue.key,title:'Operación no completada',preconditions:[],steps:['Ingresar token en "Token"','Validar que se muestre "la ausencia de Receipt"'],expectedResult:'No se muestra Receipt',acceptanceCriteriaRefs:['AC2']};
  let calls=0;
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){calls++;return {rawText:'',parsedJson:{scenarios:calls===1?[positive,rejected,incomplete]:[]},model:'fixture',providerName:'fixture',durationMs:0};}};
  const result=await generateJiraScenarios([sourceIssue],appSlug,provider);
  assert.equal(calls,1);
  assert.ok(result.scenarios.every(scenario=>scenario.validation.valid),JSON.stringify(result.scenarios.map(scenario=>({title:scenario.title,errors:scenario.validation.errors,refs:scenario.acceptanceCriteriaRefs}))));
  assert.deepEqual(result.scenarios[0].conditionRequirements?.[0].stepIndices,[1]);
  assert.ok(result.scenarios[1]?.acceptanceCriteriaRefs?.includes('AC2'));
  assert.deepEqual(result.scenarios[2].steps,[...normalizeJiraGeneratedSteps(rejected.steps).slice(0,-1),'Validar que no se muestre "Receipt"']);
  assert.equal(result.scenarios[2].title,incomplete.title);
  assert.equal(result.scenarios[2].inputRequirements?.[0].dataCondition,'invalid');
  assert.equal(result.scenarios[2].steps.at(-1),'Validar que no se muestre "Receipt"');
  const browser:JiraBrowserPort={async navigate(){},async act(){return {strategy:'css',value:'#token'};},async assert(target){return {observedText:target};},async assertAbsent(){return {absent:true};}};
  for(const scenario of result.scenarios){
   assert.ok(scenario.scenarioId);
   const values=Object.fromEntries((scenario.inputRequirements ?? []).map(field=>[field.key,'synthetic-input']));
   const contract=await discoverJiraScenario({...scenario,scenarioId:scenario.scenarioId,sourceIssueKey:issue.key,expectedResult:scenario.expectedResult ?? ''},browser,values);
   const compiled=compileJiraSpec({plan:contract.plan,sourceScenario:contract.sourceScenario,appSlug,sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-generation-preparation/case.spec.ts')});
   assert.deepEqual(compiled.unsupported,[]);
  }
 }
});

test('controlled setup cannot borrow from another source, discard an action, or invent an absent failure mechanism',()=>{
 const recipient={sourceIssueKey:issue.key,title:'Operación no completada',steps:['Ingresar token en "Token"','Presionar "Cancel"','Validar que no se muestre "Receipt"'],expectedResult:'No Receipt'};
 const donor={sourceIssueKey:issue.key,title:'Rejected',steps:['Ingresar token no válido en "Token"','Validar que se muestre "Error"','Validar que no se muestre "Receipt"']};
 assert.deepEqual(prepareJiraGenerationDrafts([recipient,donor],[issue])[0],recipient);
 const compatible={...recipient,steps:recipient.steps.filter(step=>!step.includes('Cancel'))};
 assert.deepEqual(prepareJiraGenerationDrafts([compatible,{...donor,sourceIssueKey:'OTHER-2'}],[issue])[0],compatible);
 assert.deepEqual(prepareJiraGenerationDrafts([compatible,donor],[{...issue,description:'La operación puede no completarse.'}])[0],compatible);
});

test('navigation-and-absence skeleton adopts a complete same-source rejection across profiles without another AI call',async()=>{
 const sourceIssue={...issue,description:'An invalid Token prevents operation completion without Receipt.',acceptanceCriteria:null};
 for(const appSlug of ['fixture-shop','fixture-service']) {
  const donor={sourceIssueKey:issue.key,title:'Token rejected',preconditions:[],steps:['Abrir la aplicación configurada del proyecto','Ingresar usuario en "Usuario"','Presionar "Access"','Ingresar token no válido en "Token"','Presionar "Authorize"','Validar que se muestre "Error"','Validar ausencia de "Receipt"'],expectedResult:'No Receipt',acceptanceCriteriaRefs:['AC2']};
  const skeleton={sourceIssueKey:issue.key,title:'Operación no completada',preconditions:[],steps:['Abrir la aplicación configurada del proyecto','Validar ausencia de "Receipt"'],expectedResult:'No Receipt',acceptanceCriteriaRefs:['AC2']};
  let calls=0;
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){calls++;return {rawText:'',parsedJson:{scenarios:calls===1?[donor,skeleton]:[]},model:'fixture',providerName:'fixture',durationMs:0};}};
  const result=await generateJiraScenarios([sourceIssue],appSlug,provider);
  assert.equal(calls,1);
  const prepared=result.scenarios[1];
  assert.equal(prepared.validation.valid,true,JSON.stringify(prepared.validation.errors));
  assert.deepEqual(prepared.steps,normalizeJiraGeneratedSteps(donor.steps));
  assert.equal(prepared.title,skeleton.title);
  assert.deepEqual(prepared.inputRequirements?.map(field=>[field.label,field.dataCondition]),[['Usuario',undefined],['Token','invalid']]);
  const observed:string[]=[];
  const browser:JiraBrowserPort={async navigate(){},async act(){return {strategy:'css',value:'#field'};},async assert(target){observed.push(target);return {observedText:target};},async assertAbsent(target){observed.push(`absent:${target}`);return {absent:true};}};
  const values=Object.fromEntries((prepared.inputRequirements ?? []).map(field=>[field.key,'synthetic-input']));
  const contract=await discoverJiraScenario({...prepared,scenarioId:prepared.scenarioId!,sourceIssueKey:issue.key,expectedResult:prepared.expectedResult ?? ''},browser,values);
  assert.deepEqual(observed,['Error','absent:Receipt']);
  assert.deepEqual(compileJiraSpec({plan:contract.plan,sourceScenario:contract.sourceScenario,appSlug,sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-skeleton/case.spec.ts')}).unsupported,[]);
 }
});

test('skeleton composition preserves actions and fails closed for missing, ambiguous or cross-source donors',()=>{
 const skeleton={sourceIssueKey:issue.key,title:'Operación no completada',steps:['Abrir la aplicación configurada del proyecto','Validar que no se muestre "Receipt"']};
 const donor={sourceIssueKey:issue.key,steps:['Abrir la aplicación configurada del proyecto','Ingresar token no válido en "Token"','Validar que se muestre "Error"','Validar que no se muestre "Receipt"']};
 for(const peers of [[],[{...donor,sourceIssueKey:'OTHER'}],[donor,{...donor,steps:donor.steps.map(step=>step.replace('"Error"','"Other error"'))}]]) {
  assert.deepEqual(prepareJiraGenerationDrafts([skeleton,...peers],[issue])[0],skeleton);
 }
 const additional={...skeleton,steps:[skeleton.steps[0],'Presionar "Cancel"',skeleton.steps[1]]};
 assert.deepEqual(prepareJiraGenerationDrafts([additional,donor],[issue])[0],additional);
 assert.deepEqual(prepareJiraGenerationDrafts([skeleton,donor],[{...issue,description:'Operation fails without a specified mechanism.'}])[0],skeleton);
});

test('a composite negative-case setup expands from the same-source positive path and remaps invalid inputs',()=>{
 const source={...issue,description:'An invalid authorization code shows an error and does not submit the application.'};
 const positive={sourceIssueKey:source.key,title:'Submit application with valid authorization',preconditions:[],steps:[
  'Abrir la aplicación configurada del proyecto','Presionar "Personal"','Ingresar usuario en "Usuario"',
  'Presionar "Solicitar préstamo"','Validar que se muestre "Revisión"',
  'Ingresar código de autorización válido en "Código de autorización"','Presionar "Enviar"',
  'Validar que se muestre "Solicitud recibida"',
 ],inputRequirements:[
  {key:'username',label:'Usuario',stepIndex:3,operation:'fill',dataCondition:'valid'},
  {key:'auth_code',label:'Código de autorización',stepIndex:6,operation:'fill',dataCondition:'valid'},
 ] as unknown[] ,expectedResult:'Application is received'};
 const composite='Completar todas las secciones requeridas de la solicitud con datos ficticios válidos, incluyendo las filas requeridas de ingresos y compromisos';
 const negative={sourceIssueKey:source.key,title:'Reject invalid authorization code',preconditions:[],steps:[
  'Abrir la aplicación configurada del proyecto',composite,
  'Ingresar código de autorización inválido en "Código de autorización"','Presionar "Enviar"',
  'Validar que se muestre "Error"','Validar que no se muestre "Solicitud recibida"',
 ],inputRequirements:[{key:'auth_code_invalid',label:'Código de autorización',stepIndex:3,operation:'fill',dataCondition:'invalid'}],
 expectedResult:'The application is not submitted'};
 const prepared=prepareJiraGenerationDrafts([positive,negative],[source])[1] as typeof negative;
 assert.deepEqual(prepared.steps,[...positive.steps.slice(0,5),...negative.steps.slice(2)]);
 assert.ok(!prepared.steps.includes(composite));
 assert.deepEqual(prepared.inputRequirements?.map(field=>[field.label,field.stepIndex,field.dataCondition]),[
  ['Usuario',3,'valid'],['Código de autorización',6,'invalid'],
 ]);
 assert.equal(prepared.title,negative.title);
 assert.equal(prepared.expectedResult,negative.expectedResult);
 assert.deepEqual(jiraGenerationContractErrors(prepared,source),[]);
 assert.ok(prepared.steps.every(step=>parseStepIntent(step).length===1&&parseStepIntent(step)[0].type!=='unknown'));
});

test('unquoted navigation prose is dropped only when a concrete quoted action names the same destination',()=>{
 const prose='Navegar por la ruta de Continuar.';
 const backed={sourceIssueKey:issue.key,steps:['Abrir la aplicación configurada del proyecto',prose,'Presionar "Continuar"'],
  unresolvedUiRequirements:[{stepIndex:2,kind:'navigation'},{stepIndex:3,kind:'control'}]};
 const prepared=prepareJiraGenerationDrafts([backed],[issue])[0] as typeof backed;
 assert.deepEqual(prepared.steps,['Abrir la aplicación configurada del proyecto','Presionar "Continuar"']);
 assert.deepEqual(prepared.unresolvedUiRequirements,[{stepIndex:2,kind:'control'}]);
 const unbacked={sourceIssueKey:issue.key,steps:['Abrir la aplicación configurada del proyecto',prose,'Validar que se muestre "Inicio"']};
 assert.deepEqual((prepareJiraGenerationDrafts([unbacked],[issue])[0] as typeof unbacked).steps,unbacked.steps);
});

test('an absence noun becomes a negative oracle only with source support and never overrides an authored literal message',()=>{
 const draft={sourceIssueKey:issue.key,steps:['Validar que se muestre "la ausencia de Receipt"']};
 const prepared=prepareJiraGenerationDrafts([draft],[issue])[0] as typeof draft;
 assert.deepEqual(prepared.steps,['Validar que no se muestre "Receipt"']);
 const literalSource={...issue,description:'Mostrar el mensaje "la ausencia de Receipt" cuando el resultado no está disponible.'};
 assert.deepEqual(prepareJiraGenerationDrafts([draft],[literalSource])[0],draft);
 assert.deepEqual(prepareJiraGenerationDrafts([draft],[{...issue,description:'Mostrar Receipt.'}])[0],draft);
});

test('generation cache isolates model, story, profile and results; invalid generations are never reused',async()=>{
 const cacheIssue={...issue,description:'',acceptanceCriteria:''};
 const result=await generateJiraScenarios([cacheIssue],'fixture-shop',{providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){return {rawText:'',parsedJson:{scenarios:[{sourceIssueKey:cacheIssue.key,title:'Done',steps:['Validar que se muestre "Done"'],expectedResult:'Done'}]},model:'fixture',providerName:'fixture',durationMs:0};}});
 const provider={providerType:'fake' as const,providerName:'fixture',model:'fixture'};
 const key=jiraGenerationCacheKey(provider,[{role:'user',content:JSON.stringify({appSlug:'fixture-shop',issue:cacheIssue})}]);
 const cache=new JiraGenerationCache(100,2);
 cache.put(key,result,0);
 const copy=cache.get(key,1)!;
 copy.scenarios[0].title='Changed';
 assert.equal(cache.get(key,1)?.scenarios[0].title,'Done');
 assert.equal(cache.get(key,101),undefined);
 assert.notEqual(key,jiraGenerationCacheKey({...provider,model:'other'},[{role:'user',content:JSON.stringify({appSlug:'fixture-shop',issue})}]));
 assert.notEqual(key,jiraGenerationCacheKey(provider,[{role:'user',content:JSON.stringify({appSlug:'fixture-service',issue})}]));
 assert.notEqual(key,jiraGenerationCacheKey(provider,[{role:'user',content:JSON.stringify({appSlug:'fixture-shop',issue:{...cacheIssue,description:'Changed'}})}]));
 cache.put(key,{...result,scenarios:result.scenarios.map(scenario=>({...scenario,validation:{...scenario.validation,valid:false}}))},0);
 assert.equal(cache.get(key,1),undefined);
});

test('app-profile slug step and untargeted login under full authentication are dropped with indexes aligned',()=>{
 const plain={...issue,description:'Token independiente del acceso.'};
 const draft={sourceIssueKey:'HU-1',authIntent:'full_authentication',steps:[
  'Abrir la aplicación configurada del proyecto','Seleccionar el perfil de aplicación "lab-app"','Iniciar sesión con un Código de acceso válido',
  'Ingresar un token válido distinto al Código de acceso en "Token de seguridad"','Presionar "Autorizar"'],
  inputRequirements:[{key:'token_seguridad',label:'Token de seguridad',stepIndex:4,operation:'fill'}],
  unresolvedUiRequirements:[{stepIndex:3,requirement:'login'},{stepIndex:5,requirement:'autorizar'}]};
 const prepared=prepareJiraGenerationDrafts([draft],[plain],'lab-app')[0] as typeof draft;
 assert.deepEqual(prepared.steps,[draft.steps[0],draft.steps[3],draft.steps[4]]);
 assert.deepEqual(prepared.inputRequirements.map(item=>item.stepIndex),[2]);
 assert.deepEqual(prepared.unresolvedUiRequirements,[{stepIndex:3,requirement:'autorizar'}]);
 assert.equal((prepareJiraGenerationDrafts([draft],[plain],'another-app')[0] as typeof draft).steps.length,4);
});

test('generic "perform login actions until reaching X" step is dropped under full authentication, AC steps kept',()=>{
 const steps=['Abrir la aplicación configurada del proyecto','Realizar las acciones de inicio de sesión necesarias hasta llegar a "Datos de la transferencia"','Pulsar "Continuar"'];
 const draft={sourceIssueKey:'HU-1',authIntent:'full_authentication',steps,unresolvedUiRequirements:[{stepIndex:2,requirement:'login'}]};
 const prepared=prepareJiraGenerationDrafts([draft],[issue])[0] as typeof draft;
 assert.deepEqual(prepared.steps,[steps[0],steps[2]]);
 assert.deepEqual(prepared.unresolvedUiRequirements,[]);
 assert.equal((prepareJiraGenerationDrafts([{...draft,authIntent:undefined}],[issue])[0] as typeof draft).steps.length,3);
});

test('explicit login-code fill is dropped only under full authentication; business token step/input kept and reindexed',()=>{
 const steps=['Abrir la aplicación configurada del proyecto','Completar el campo "Código de acceso de inicio de sesión" con un código de acceso válido','Completar el campo "Token de seguridad" con un token válido distinto del código de acceso de inicio de sesión','Pulsar "Autorizar transferencia"'];
 const draft={sourceIssueKey:'HU-1',authIntent:'full_authentication',acceptanceCriteriaRefs:['AC3.2'],steps,
  inputRequirements:[{key:'codigo_acceso_inicio_sesion',label:'Código de acceso de inicio de sesión',stepIndex:2,operation:'fill'},{key:'token_seguridad',label:'Token de seguridad',stepIndex:3,operation:'fill'}],
  unresolvedUiRequirements:[{stepIndex:3,requirement:'token'},{stepIndex:4,requirement:'autorizar'}]};
 const prepared=prepareJiraGenerationDrafts([draft],[issue])[0] as typeof draft;
 assert.deepEqual(prepared.steps,[steps[0],steps[2],steps[3]]);
 assert.deepEqual(prepared.inputRequirements.map(item=>[item.key,item.stepIndex]),[['token_seguridad',2]]);
 assert.deepEqual(prepared.unresolvedUiRequirements.map(item=>item.stepIndex),[2,3]);
 assert.deepEqual(prepared.acceptanceCriteriaRefs,['AC3.2']);
 const kept=prepareJiraGenerationDrafts([{...draft,authIntent:undefined}],[issue])[0] as typeof draft;
 assert.deepEqual(kept.steps,steps);
 assert.equal(kept.inputRequirements.length,2);
});

test('stale declared input index still binds its semantic key and unresolved notes follow identical steps',()=>{
 const fields=deriveJiraInputRequirements(['Abrir la aplicación','Presionar "Continuar"','Ingresar un token válido en "Token de seguridad"'],[{key:'token_seguridad',label:'Token de seguridad',stepIndex:2,operation:'fill'}]);
 assert.equal(fields[0].key,'token_seguridad');
 const original={steps:['Presionar "A"','Presionar "Continuar"'],unresolvedUiRequirements:[{stepIndex:2,requirement:'r'}]};
 const repaired=realignRepairedUi(original,{...original,steps:['Presionar "A"','Presionar "P"','Presionar "Continuar"']});
 assert.deepEqual(repaired.unresolvedUiRequirements,[{stepIndex:3,requirement:'r'}]);
});

test('password profile delegates login to the configured flow; no_login and public stories stay unauthenticated',()=>{
 const protectedIssue={...issue,description:'AC1 — Transferencia\nEl usuario autoriza la transferencia.'};
 const draft={sourceIssueKey:'HU-1',title:'Transfer',steps:['Abrir la aplicación configurada del proyecto','Ingresar token en "Token de seguridad"','Validar que se muestre "Comprobante"']};
 const authOf=(d:unknown,i:JiraIssueSource,mode?:string)=>(prepareJiraGenerationDrafts([d],[i],'p',mode)[0] as Record<string,unknown>).authIntent;
 assert.equal(authOf(draft,protectedIssue,'password'),'full_authentication');
 assert.equal(authOf(draft,protectedIssue,'no_login'),undefined);
 assert.equal(authOf(draft,protectedIssue),undefined);
 const publicIssue={...issue,description:'AC1 — Consulta pública\nLa página es pública y no requiere inicio de sesión.'};
 assert.equal(authOf(draft,publicIssue,'password'),undefined);
 const ownLogin={...draft,steps:['Ingresar usuario en "Usuario"','Ingresar contraseña en "Contraseña"','Presionar "Iniciar sesión"','Validar que se muestre "Inicio"']};
 assert.equal(authOf(ownLogin,protectedIssue,'password'),undefined);
 const loginCodeFill={...draft,steps:['Ingresar código en "Código de acceso de inicio de sesión"',...draft.steps]};
 const prepared=prepareJiraGenerationDrafts([loginCodeFill],[protectedIssue],'p','password')[0] as Record<string,unknown>;
 assert.equal(prepared.authIntent,'full_authentication');
 assert.ok(!(prepared.steps as string[]).some(step=>/inicio de sesión/i.test(step)));
});

test('independence clause is certified only by a scenario supplying a distinct security input',async()=>{
 const source={...issue,description:'AC1 — Autorización\nEl usuario completa el Token de seguridad. El token es independiente del Código de acceso de inicio de sesión.'};
 const run=(steps:string[])=>generateJiraScenarios([source],'fixture-profile',{providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){
  return {rawText:'',parsedJson:{scenarios:[{sourceIssueKey:'HU-1',title:'Authorize',steps,expectedResult:'Comprobante',acceptanceCriteriaRefs:['AC1.1','AC1.2']}]},model:'fixture',providerName:'fixture',durationMs:0};
 }},{loginMode:'password'});
 const withToken=await run(['Abrir la aplicación configurada del proyecto','Presionar "Transferencias"','Ingresar token en "Token de seguridad"','Validar que se muestre "Comprobante"']);
 assert.equal(withToken.scenarios[0].authIntent,'full_authentication');
 assert.ok(!withToken.scenarios[0].validation.errors.some(error=>error.startsWith('JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE')));
 // A non-secret stimulus keeps the scenario navigable, so only the independence clause stays uncovered.
 const withoutToken=await run(['Abrir la aplicación configurada del proyecto','Presionar "Transferencias"','Presionar "Autorizar"','Validar que se muestre "Comprobante"']);
 assert.ok(withoutToken.scenarios[0].validation.errors.includes('JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE:AC1.2'));
});

test('observed access-code submit is inserted once, before the first functional step, with requirement indices shifted',()=>{
 const routes=[{actions:[{action:'fill',field:'Código de acceso'},{action:'click',field:'Continuar'},{action:'click',field:'Transferencias'}]}];
 const transitions=observedAccessSubmitTransitions(routes);
 assert.deepEqual(transitions,[{fillLabel:'Código de acceso',clickLabel:'Continuar'}]);
 const draft={sourceIssueKey:'HU-1',title:'T',authIntent:'full_authentication',steps:['Ingresar código válido en "Código de acceso"','Presionar "Transferencia propia"','Ingresar monto en "Monto"','Validar que se muestre "Comprobante"'],
  inputRequirements:[{stepIndex:3,label:'Monto'}],unresolvedUiRequirements:[{stepIndex:2},{stepIndex:1}]};
 const run=(d:unknown,mode='password',t=transitions)=>prepareJiraGenerationDrafts([d],[issue],'p',mode,t)[0] as typeof draft;
 const prepared=run(draft);
 assert.deepEqual(prepared.steps.slice(0,3),['Ingresar código válido en "Código de acceso"','Presionar "Continuar"','Presionar "Transferencia propia"']);
 assert.deepEqual(prepared.inputRequirements.map(item=>item.stepIndex),[4]);
 assert.deepEqual(prepared.unresolvedUiRequirements.map(item=>item.stepIndex),[3,1]);
 // Explicit submit is not duplicated; idempotent on re-run.
 const explicit={...draft,steps:['Ingresar código válido en "Código de acceso"','Presionar "Continuar"','Presionar "Transferencia propia"','Validar que se muestre "Comprobante"']};
 assert.deepEqual(run(explicit).steps,explicit.steps);
 assert.deepEqual(run(prepared).steps,prepared.steps);
 // No observed transition, no_login, or gate observation: nothing is invented.
 assert.deepEqual(run(draft,'password',[]).steps,draft.steps);
 assert.deepEqual(run(draft,'no_login').steps,draft.steps);
 assert.deepEqual(run({...draft,authIntent:'gate_observation'}).steps,draft.steps);
});

test('coverage ignores candidates without navigation, repairs with validated journeys, and stays blocked if no valid route comes back',async()=>{
 const source={...issue,description:'AC1 — Datos\nMostrar Total.\nAC2 — Resumen\nMostrar Resumen.'};
 const open='Abrir la aplicación configurada del proyecto';
 const mk=(title:string,steps:string[],ref:string)=>({sourceIssueKey:'HU-1',title,preconditions:[],steps,expectedResult:title,acceptanceCriteriaRefs:[ref]});
 const withNav=mk('Con ruta',[open,'Presionar "Transferencias"','Validar que se muestre "Total"'],'AC1.1');
 const noNav=mk('Sin ruta',[open,'Validar que se muestre "Resumen"'],'AC2.1');
 const run=async(repair:unknown[])=>{
  const payloads:Array<Record<string,unknown>>=[];
  let calls=0;
  const provider:AiProvider={providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(request){
   calls++;
   const isCoverage=String(request.messages[0]?.content??'').startsWith('Complete all currently missing');
   if(isCoverage)payloads.push(JSON.parse(String(request.messages[1].content)));
   const scenarios=calls===1?[withNav,noNav]:isCoverage&&payloads.length===1?repair:[];
   return {rawText:'',parsedJson:{scenarios},model:'fixture',providerName:'fixture',durationMs:0};
  }};
  const result=await generateJiraScenarios([source],'fixture-profile',provider,{loginMode:'password'});
  return {result,payloads};
 };
 const ok=await run([mk('Con ruta reparada',[open,'Presionar "Transferencias"','Validar que se muestre "Resumen"'],'AC2.1')]);
 assert.equal(ok.payloads.length,1);
 const payload=ok.payloads[0] as {issues:Array<{missingClauses:Array<{id:string}>}>;validatedJourneys:Array<{title:string}>};
 assert.deepEqual(payload.issues[0].missingClauses.map(clause=>clause.id),['AC2.1']);
 assert.deepEqual(payload.validatedJourneys.map(journey=>journey.title),['Con ruta']);
 assert.ok(ok.result.scenarios.some(scenario=>scenario.title==='Con ruta reparada'&&scenario.validation.valid));
 assert.ok(!ok.result.scenarios.some(scenario=>scenario.validation.errors.some(error=>error.startsWith('JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE'))));
 const blocked=await run([mk('Otra sin ruta',[open,'Validar que se muestre "Resumen"'],'AC2.1')]);
 assert.equal(blocked.payloads.length,1);
 assert.ok(blocked.result.scenarios.some(scenario=>scenario.validation.errors.includes('JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE:AC2.1')));
 assert.ok(!blocked.result.scenarios.some(scenario=>scenario.validation.valid&&scenario.acceptanceCriteriaRefs?.includes('AC2.1')));
});

test('transactional security token is not learned as an access-code submit; ambiguous submits are dropped',()=>{
 const tokenRoute=[{actions:[{action:'fill',field:'Token de seguridad'},{action:'click',field:'Confirmar'}]}];
 assert.deepEqual(observedAccessSubmitTransitions(tokenRoute),[]);
 const ambiguous=[{actions:[{action:'fill',field:'Código de acceso'},{action:'click',field:'Continuar'}]},{actions:[{action:'fill',field:'Código de acceso'},{action:'click',field:'Enviar'}]}];
 assert.deepEqual(observedAccessSubmitTransitions(ambiguous),[]);
});

test('quoted comma list strips a source-present category prefix from the first item only when everything else is grounded',()=>{
 const src={...issue,acceptanceCriteria:'AC1 — Permisos\nSe muestran los permisos Consultar cuentas, Crear transferencias, Aprobar pagos y Administrar usuarios.'};
 const prep=(step:string)=>(prepareJiraGenerationDrafts([{sourceIssueKey:src.key,steps:['Presionar "Ver detalle"',step]}],[src])[0] as {steps:string[]}).steps;
 assert.deepEqual(prep('Validar que se muestre "permisos Consultar cuentas, Crear transferencias, Aprobar pagos, Administrar usuarios"'),
  ['Presionar "Ver detalle"','Validar que se muestre "Consultar cuentas"','Validar que se muestre "Crear transferencias"','Validar que se muestre "Aprobar pagos"','Validar que se muestre "Administrar usuarios"']);
 // negative: unsupported item -> whole assertion unchanged
 const unsupported='Validar que se muestre "permisos Consultar cuentas, Crear transferencias, Exportar reportes"';
 assert.equal(prep(unsupported)[1],unsupported);
 // negative: prefix word not in source -> unchanged
 const foreign='Validar que se muestre "columnas Consultar cuentas, Crear transferencias"';
 assert.equal(prep(foreign)[1],foreign);
 // negative: source quotes the prefixed label on its own -> prefix kept, group still splits into grounded exact labels
 const quotedSrc={...src,acceptanceCriteria:'Se muestra "permisos Consultar cuentas", Crear transferencias.'};
 const whole='Validar que se muestre "permisos Consultar cuentas, Crear transferencias"';
 const quotedSteps=(prepareJiraGenerationDrafts([{sourceIssueKey:quotedSrc.key,steps:['Presionar "Ver detalle"',whole]}],[quotedSrc])[0] as {steps:string[]}).steps;
 assert.equal(quotedSteps[1],'Validar que se muestre "permisos Consultar cuentas"');
 assert.equal(quotedSteps[2],'Validar que se muestre "Crear transferencias"');
});

test('quoted comma list splits only when every segment is an exact label in the issue acceptance criteria',()=>{
 const source={...issue,acceptanceCriteria:'AC1 — Detalle\nSe muestran "Política de aprobación", "Rol de Laura M." y "Límite de aprobación".'};
 const prep=(step:string,src:JiraIssueSource=source)=>prepareJiraGenerationDrafts([{sourceIssueKey:src.key,steps:['Presionar "Ver detalle"',step,'Validar que se muestre "Cerrar"'],
  inputRequirements:[{key:'a',label:'x',stepIndex:3,operation:'fill'}],conditionRequirements:[{key:'AC1:0',stepIndices:[2,3]}]}],[src])[0] as {steps:string[];inputRequirements:Array<{stepIndex:number}>;conditionRequirements:Array<{stepIndices:number[]}>};
 const list='Validar que se muestre "Política de aprobación, Rol de Laura M., Límite de aprobación"';
 const split=prep(list);
 assert.deepEqual(split.steps,['Presionar "Ver detalle"','Validar que se muestre "Política de aprobación"','Validar que se muestre "Rol de Laura M."','Validar que se muestre "Límite de aprobación"','Validar que se muestre "Cerrar"']);
 assert.deepEqual(split.inputRequirements.map(item=>item.stepIndex),[5]);
 assert.deepEqual(split.conditionRequirements[0].stepIndices,[2,3,4,5]);
 // negative: one segment not grounded in the criteria -> unchanged
 const ungrounded='Validar que se muestre "Política de aprobación, Saldo total, Límite de aprobación"';
 assert.equal(prep(ungrounded).steps[1],ungrounded);
 // negative: no acceptance criteria -> unchanged
 assert.equal(prep(list,{...source,acceptanceCriteria:null}).steps[1],list);
});
