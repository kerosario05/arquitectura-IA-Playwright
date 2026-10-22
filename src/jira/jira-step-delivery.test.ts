import assert from 'node:assert/strict';
import test from 'node:test';
import { auditJiraStepDelivery, JIRA_STEP_DELIVERY_INSTRUCTIONS, JIRA_OUTCOME_DELIVERY_INSTRUCTIONS, repairSourceBackedRejectionMessages } from './jira-step-delivery';
import { deriveJiraInputRequirements, jiraScenarioGenerationInstructions } from './jira-input-requirements';
import { auditGeneratedJiraSyntax, normalizeJiraGeneratedSteps, normalizeExplicitRejectionSummary } from './jira-scenario-generator';
import { parseStepIntent } from '../discovery/step-intent-parser';

test('controlled natural journeys keep independent labels, keys and stages across unrelated projects', async()=>{
 for(const [field,list,result] of [['Identificador','Cuenta origen','Comprobante'],['Correo','Almacén','Pedido registrado']]) {
  const steps=['Abrir la aplicación configurada del proyecto',`Ingresar el dato en "${field}"`,'Presionar "Acceder"',
   'Ingresar el código de acceso en "Código de acceso"','Presionar "Confirmar acceso"',
   `Seleccionar el valor en "${list}"`,'Ingresar el código de autorización en "Código de autorización"',
   'Presionar "Guardar"',`Validar que se muestre "${result}"`];
  const supplied=[{key:'identity',label:field,stepIndex:2,operation:'fill'},
   {key:'access_code',label:'Código de acceso',stepIndex:4,operation:'fill'},
   {key:'destination',label:list,stepIndex:6,operation:'select'},
   {key:'authorization_code',label:'Código de autorización',stepIndex:7,operation:'fill'}];
  const fields=deriveJiraInputRequirements(steps,supplied);
  assert.deepEqual(auditJiraStepDelivery(steps,fields),[]);
  assert.deepEqual(fields.map(f=>f.key),supplied.map(f=>f.key));
  assert.deepEqual(fields.map(f=>f.stepIndex),[2,4,6,7]);
  assert.ok(steps.slice(1).every(step=>parseStepIntent(step).length===1));
  assert.deepEqual(await auditGeneratedJiraSyntax([{title:'Journey',steps,inputRequirements:supplied,expectedResult:result}]),[]);
 }
});

test('grouped actions are reported with exact location for the existing repair loop',()=>{
 const steps=['Ingresar el usuario en "Usuario" y presionar "Acceder"'];
 assert.equal(auditJiraStepDelivery(steps,deriveJiraInputRequirements(steps))[0]?.reason,'JIRA_GENERATED_STEP_NOT_ATOMIC');
 assert.equal(auditJiraStepDelivery(steps,[])[0]?.stepIndex,1);
});

test('a lost or stale field binding never receives a fabricated data requirement',()=>{
 const steps=['Ingresar el valor en "Referencia"'];
 const fields=deriveJiraInputRequirements(steps);
 assert.deepEqual(auditJiraStepDelivery(steps,fields),[]);
 assert.equal(auditJiraStepDelivery(steps,fields.map(f=>({...f,stepIndex:8})))[0]?.reason,'JIRA_GENERATED_FIELD_UNBOUND');
});

test('initial generation and repair use the same project-neutral delivery instructions',()=>{
 assert.ok(jiraScenarioGenerationInstructions().includes(JIRA_STEP_DELIVERY_INSTRUCTIONS));
 assert.doesNotMatch(JIRA_STEP_DELIVERY_INSTRUCTIONS,/fenix|demoblaze|santacruz/i);
 assert.ok(jiraScenarioGenerationInstructions().includes(JIRA_OUTCOME_DELIVERY_INSTRUCTIONS));
 assert.doesNotMatch(JIRA_OUTCOME_DELIVERY_INSTRUCTIONS,/fenix|demoblaze|santacruz/i);
});

test('a source-backed message replaces an invented field error across unrelated fields',async()=>{
 for(const [field,message] of [['Código de acceso','Código inválido'],['Referencia de artículo','Referencia incorrecta']]) {
  const source=`Si ${field} es inválido, se muestra el mensaje "${message}".`;
  const steps=['Abrir la aplicación configurada del proyecto',`Ingresar un dato no válido en "${field}"`,'Presionar "Enviar"',`Validar que el campo "${field}" muestre un error de validación`,'Validar que no se muestre "Resultado exitoso"'];
  const normalized=normalizeJiraGeneratedSteps(steps,{description:source} as any);
  assert.equal(normalized[3],`Validar que se muestre "${message}"`);
  assert.deepEqual(normalized.slice(0,3),steps.slice(0,3));
  assert.equal(normalized[4],steps[4]);
  const expectedResult=normalizeExplicitRejectionSummary('La aplicación informa el rechazo y no presenta un resultado exitoso.',normalized);
  assert.deepEqual(await auditGeneratedJiraSyntax([{title:'Rechazo',steps:normalized,expectedResult}]),[]);
  assert.deepEqual(repairSourceBackedRejectionMessages(steps,''),steps);
  assert.deepEqual(repairSourceBackedRejectionMessages(steps,source+`\n${field} inválido muestra el mensaje "Otro rechazo"`),steps);
 }
});

test('credential rejection summary reuses both authored oracles without adding a compound unsupported step',async()=>{
 const steps=['Abrir la aplicación configurada del proyecto','Ingresar un usuario no válido en "Usuario"','Ingresar contraseña en "Contraseña"','Presionar "Acceder"','Validar que se muestre "Credenciales inválidas"','Validar que no se muestre "Resultado exitoso"'];
 const expectedResult=normalizeExplicitRejectionSummary('La aplicación informa credenciales inválidas y no presenta el resultado exitoso.',steps);
 assert.equal(expectedResult,'Se informa Credenciales inválidas y no se presenta Resultado exitoso.');
 assert.deepEqual(await auditGeneratedJiraSyntax([{title:'Rechazo de credenciales inválidas',steps,expectedResult}]),[]);
});
