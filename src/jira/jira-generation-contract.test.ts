import test from "node:test";
import assert from "node:assert/strict";
import {jiraGenerationContractErrors,jiraSourceConditions,jiraUiObservations,repairMenuLabelContentAssertions,repairMissingJiraConditionalAssertions,repairUnsubstantiatedPostOutcomeActions,repairUnsupportedAddedRowAssertions,repairContainerlessMatchingRowAssertions,repairUnbackedFilterSubmitActions,repairUnsupportedLiteralBranchClaims,repairSourceBackedLiteralBranchClaims} from "./jira-generation-contract";
import {parseStepIntent} from "../discovery/step-intent-parser";
import {jiraScenarioGenerationInstructions} from "./jira-input-requirements";
import {auditGeneratedJiraSyntax,generateJiraScenarios,normalizeJiraGeneratedSteps} from "./jira-scenario-generator";
import type {JiraIssueSource} from "../scenarios/scenario-types";
import {repairMissingJiraReviewTransition} from './jira-generation-contract';
test('review transition cannot be anchored to shared field names on a later receipt',()=>{
 const source={description:'El resumen muestra monto y comisión. El cliente revisa la información antes de continuar. Se muestra validación de identidad para autorizar. El comprobante muestra monto y referencia.'} as JiraIssueSource;
 const steps=['Validar que se muestre "monto" en la confirmación.','Presionar "Continuar"','Validar que se muestre "validación de identidad"','Presionar "Autorizar"','Validar que se muestre "monto" en el comprobante.','Validar que se muestre "referencia" en el comprobante.'];
 const draft={steps};
 assert.equal(repairMissingJiraReviewTransition(draft,source),draft);
 const repaired=repairMissingJiraReviewTransition({steps:steps.filter((_,index)=>index!==1)},source);
 assert.deepEqual(repaired.steps,steps.map((step,index)=>index===1?'Presionar la acción para continuar':step));
 assert.deepEqual(repairMissingJiraReviewTransition({steps:steps.slice(4)},source).steps,steps.slice(4));
});
test('compound confirmation summary preserves source-backed conditional checks without blocking launch',async()=>{
 for(const subject of ['descuento','tasa de cambio']) {
  const source={key:'HU-CONDITION',description:`AC1 — Confirmación\nEl resumen presenta el monto, los impuestos y la ${subject} cuando aplique.`} as JiraIssueSource;
  for(const suffix of ['', ' cuando aplique']) {
   const draft={sourceIssueKey:source.key,title:'Revisar confirmación',acceptanceCriteriaRefs:['AC1.1'],steps:[
    'Abrir la aplicación configurada del proyecto',
    'Validar que el resumen de confirmación muestre el monto.',
    `Validar que el resumen de confirmación muestre la ${subject}${suffix}.`,
    'Presionar "Continuar"',
   ],expectedResult:''};
   const fixed=repairMissingJiraConditionalAssertions(draft,source);
   assert.equal(fixed.steps[2],`Validar que se muestre "${subject}"`);
   assert.deepEqual(jiraSourceConditions(fixed,source)[0].stepIndices,[3]);
   assert.ok(!jiraGenerationContractErrors(fixed,source).includes('JIRA_CONDITION_ASSERTION_MISSING'));
   assert.deepEqual(await auditGeneratedJiraSyntax([fixed],[source]),[]);
   for(const step of [`Validar que el resumen de confirmación no muestre la ${subject}.`,`Validar que el resumen de confirmación muestre el monto y la ${subject}.`]) {
    const unchanged=repairMissingJiraConditionalAssertions({...draft,steps:[step]},source);
    assert.equal(unchanged.steps[0],step);
    assert.ok(jiraGenerationContractErrors(unchanged,source).includes('JIRA_CONDITION_ASSERTION_MISSING'));
   }
  }
 }
});
test("source conditions survive removal from generated text across projects",()=>{
 for(const target of ['tasa de cambio','descuento']) {
 const issue={description:`Mostrar monto y la ${target} cuando aplique.`} as JiraIssueSource;
 assert.deepEqual(jiraGenerationContractErrors({steps:[`Validar que se muestre "${target}"`]},issue),[]);
 assert.deepEqual(jiraGenerationContractErrors({steps:['Validar que se muestre "Error"']},issue),[]);
 }
});
test("a duplicate case must declare its setup instead of assuming seeded records",()=>{
 const steps=['Ingresar "Atlas" en "Alias"','Presionar "Guardar"','Validar que se muestre "Ya existe"'];
 const base={title:'Alias duplicado',expectedResult:'Se informa que el alias ya existe',steps};
 assert.deepEqual(jiraGenerationContractErrors(base),['JIRA_DUPLICATE_CASE_SETUP_UNDECLARED']);
 assert.deepEqual(jiraGenerationContractErrors({...base,preconditions:['Existe un alias "Atlas" registrado']}),[]);
 const repeated=['Ingresar "Atlas" en "Alias"','Presionar "Guardar"','Ingresar "Atlas" en "Alias"','Presionar "Guardar"','Validar que se muestre "Ya existe"'];
 const undeclared=['JIRA_DUPLICATE_CASE_SETUP_UNDECLARED'];
 // Distinct runtime keys (no proof of same value) cannot satisfy the setup contract.
 assert.deepEqual(jiraGenerationContractErrors({...base,steps:repeated}),undeclared);
 assert.deepEqual(jiraGenerationContractErrors({...base,steps:repeated,inputRequirements:[{key:'alias',label:'Alias',stepIndex:1,operation:'fill'},{key:'alias_2',label:'Alias',stepIndex:3,operation:'fill'}]}),undeclared);
 // A same-key claim without the explicit reuse pointer is still not honored by the resolver.
 assert.deepEqual(jiraGenerationContractErrors({...base,steps:repeated,inputRequirements:[{key:'alias',label:'Alias',stepIndex:1,operation:'fill'},{key:'alias',label:'Alias',stepIndex:3,operation:'fill'}]}),undeclared);
 // Explicit same-value binding to the original step passes.
 assert.deepEqual(jiraGenerationContractErrors({...base,steps:repeated,inputRequirements:[{key:'alias',label:'Alias',stepIndex:1,operation:'fill'},{key:'alias',label:'Alias',stepIndex:3,operation:'fill',reusesValueOfStepIndex:1}]}),[]);
 // The pointer must target an identical earlier step.
 assert.deepEqual(jiraGenerationContractErrors({...base,steps:repeated,inputRequirements:[{key:'alias',label:'Alias',stepIndex:1,operation:'fill'},{key:'alias',label:'Alias',stepIndex:3,operation:'fill',reusesValueOfStepIndex:2}]}),undeclared);
 assert.deepEqual(jiraGenerationContractErrors({title:'Alias nuevo',expectedResult:'Se guarda',steps}),[]);
});
test("unrelated preconditions and retried inputs do not satisfy duplicate setup",()=>{
 const base={title:'Alias duplicado',expectedResult:'Se informa que el alias ya existe'};
 const undeclared=['JIRA_DUPLICATE_CASE_SETUP_UNDECLARED'];
 assert.deepEqual(jiraGenerationContractErrors({...base,preconditions:['Usuario autenticado en la aplicación'],steps:['Ingresar "Atlas" en "Alias"','Presionar "Guardar"','Validar que se muestre "Ya existe"']}),undeclared);
 assert.deepEqual(jiraGenerationContractErrors({...base,preconditions:['Existe un cliente registrado'],steps:['Ingresar "Atlas" en "Alias"','Presionar "Guardar"','Validar que se muestre "Ya existe"']}),undeclared);
 assert.deepEqual(jiraGenerationContractErrors({...base,steps:['Ingresar "Atlas" en "Alias"','Ingresar "Atlas" en "Alias"','Presionar "Guardar"','Validar que se muestre "Ya existe"']}),undeclared);
});
test("duplicate setup: same-value natural steps and source-backed fixed literal; otherwise fail closed",()=>{
 const undeclared=['JIRA_DUPLICATE_CASE_SETUP_UNDECLARED'];
 const base={title:'Alias duplicado',expectedResult:'Se informa que el alias ya existe'};
 const same=['Ingresar "Atlas" en "Alias"','Presionar "Guardar"','Ingresar el mismo alias en "Alias"','Presionar "Guardar"','Validar que se muestre "Ya existe"'];
 assert.deepEqual(jiraGenerationContractErrors({...base,steps:same}),[]);
 assert.deepEqual(jiraGenerationContractErrors({...base,steps:same.map(step=>step.replace('mismo alias en "Alias"','mismo alias en "Alias del cliente"'))}),undeclared);
 const steps=['Ingresar el alias duplicado "Atlas" en "Alias"','Presionar "Guardar"','Validar que se muestre "Ya existe"'];
 const tied={acceptanceCriteria:'AC4.1 — Si el alias "Atlas" ya existe, se informa el duplicado.'} as JiraIssueSource;
 assert.deepEqual(jiraGenerationContractErrors({...base,steps},tied),[]);
 assert.deepEqual(jiraGenerationContractErrors({...base,steps}),undeclared);
 // Literal not tied to duplicate behavior, not filled by the scenario, or only the field label quoted: fail closed.
 assert.deepEqual(jiraGenerationContractErrors({...base,steps},{acceptanceCriteria:'AC1 — Registrar el alias "Atlas".\nAC4.1 — Si el alias ya existe, se informa.'} as JiraIssueSource),undeclared);
 assert.deepEqual(jiraGenerationContractErrors({...base,steps:steps.map(step=>step.replace('"Atlas"','"Otro"'))},tied),undeclared);
 assert.deepEqual(jiraGenerationContractErrors({...base,steps},{acceptanceCriteria:'AC4.1 — El campo "Alias" ya existe duplicado.'} as JiraIssueSource),undeclared);
});
test("a bare matching-row phrase is rebuilt from the case's own filter, container and save, else left unresolved",()=>{
 const steps=['Presionar "Guardar"','Validar que el nombre ingresado aparezca en "Tabla X"','Ingresar el nombre del cliente en "Buscar"','Validar que "fila coincidente" permanezca visible.'];
 const draft={steps,unresolvedUiRequirements:[{stepIndex:4,requirement:'identificar fila'},{stepIndex:2,requirement:'otro'}]};
 const fixed=repairContainerlessMatchingRowAssertions(draft);
 assert.equal(fixed.steps[3],'Validar que la fila coincidente agregada con el nombre del cliente permanezca visible en "Tabla X"');
 assert.deepEqual(fixed.unresolvedUiRequirements,[{stepIndex:2,requirement:'otro'}]);
 // Earliest consuming boundary: Discovery parses it as a container-scoped matching-row oracle.
 const intent=parseStepIntent(fixed.steps[3]).find(item=>item.type==='assertion');
 assert.equal(intent?.canonicalAssertion?.oracleType,'structural_row_count');
 assert.equal(intent?.canonicalAssertion?.subject,'Tabla X');
 // Missing container, filter fill or prior save: nothing is invented.
 for(const broken of [[steps[0],steps[2],steps[3]],[steps[0],steps[1],steps[3]],steps.slice(1)]) {
  assert.deepEqual(repairContainerlessMatchingRowAssertions({steps:broken}).steps,broken);
 }
});
test("a literal-specific alternative is claimed only by a scenario that enters that literal",()=>{
 const issue={acceptanceCriteria:'AC4 — Si se registra una cuenta ya existente o el alias Atlas, se muestra el mensaje exacto Ya existe un beneficiario con esa cuenta o alias. y el formulario Añadir beneficiario permanece abierto.'} as JiraIssueSource;
 const message='Validar que se muestre "Ya existe un beneficiario con esa cuenta o alias"';
 const repeated=['Ingresar "Alias Uno" en "Alias"','Presionar "Guardar"','Ingresar el mismo alias en "Alias"','Presionar "Guardar"',message];
 const literal=['Ingresar "Atlas" en "Alias"','Presionar "Guardar"',message];
 const open=[...literal,'Validar que el formulario "Añadir beneficiario" permanece abierto'];
 const draft=(steps:string[],refs:string[])=>({title:'Rechazo de alias',expectedResult:'Se muestra el rechazo',steps,acceptanceCriteriaRefs:refs});
 const bad=['JIRA_LITERAL_BRANCH_CLAIM_UNSUPPORTED'];
 const kept=(steps:string[],refs:string[])=>repairUnsupportedLiteralBranchClaims(draft(steps,refs),issue).acceptanceCriteriaRefs;
 // Arbitrary repeated alias cannot claim the Atlas branch AC4.1.2; the existing-account branch AC4.1.1 stays claimed.
 assert.deepEqual(jiraGenerationContractErrors(draft(repeated,['AC4.1.2']),issue),bad);
 assert.deepEqual(jiraGenerationContractErrors(draft(repeated,['AC4.1.1']),issue),[]);
 // Literal in the right field plus a later assertion supports AC4.1.2 on its own, with the unquoted source literal declaring the setup.
 assert.deepEqual(jiraGenerationContractErrors(draft(literal,['AC4.1.2']),issue),[]);
 // Literal in a different field, a different literal, or no assertion after it does not.
 assert.deepEqual(jiraGenerationContractErrors(draft(literal.map(s=>s.replace('"Alias"','"Nombre"')),['AC4.1.2']),issue),bad);
 assert.deepEqual(jiraGenerationContractErrors(draft(literal.map(s=>s.replace('"Atlas"','"Otro"')),['AC4.1.2']),issue),bad);
 assert.deepEqual(jiraGenerationContractErrors(draft(literal.slice(0,2),['AC4.1.2']),issue),bad);
 // Arbitrary alias / wrong field also fail the duplicate-setup guard.
 const dup={title:'Alias duplicado',expectedResult:'Se informa que el alias ya existe',preconditions:[]};
 assert.deepEqual(jiraGenerationContractErrors({...dup,steps:literal},issue),[]);
 assert.deepEqual(jiraGenerationContractErrors({...dup,steps:literal.map(s=>s.replace('"Atlas"','"Otro"'))},issue),['JIRA_DUPLICATE_CASE_SETUP_UNDECLARED']);
 assert.deepEqual(jiraGenerationContractErrors({...dup,steps:literal.map(s=>s.replace('"Alias"','"Nombre"'))},issue),['JIRA_DUPLICATE_CASE_SETUP_UNDECLARED']);
 assert.deepEqual(jiraGenerationContractErrors({...dup,steps:literal.slice(0,2)},issue),['JIRA_DUPLICATE_CASE_SETUP_UNDECLARED']);
 // One scenario never claims both sibling branches, even when it enters the literal.
 assert.deepEqual(kept(literal,['AC4.1.1','AC4.1.2']),['AC4.1.1']);
 // The bare clause ref AC4.1 cannot stand in for a branch (form-open alone never claims AC4.1).
 assert.deepEqual(kept(open,['AC4.1','AC4.2']),['AC4.2']);
 // AC4.2 (form stays open) is claimed only with its own open-state assertion.
 assert.deepEqual(kept(open,['AC4.2']),['AC4.2']);
 assert.deepEqual(kept(literal,['AC4.2']),[]);
 // Sources without a literal alternative are untouched.
 const plain={acceptanceCriteria:'AC4 — Si se registra una cuenta ya existente, se muestra Ya existe.'} as JiraIssueSource;
 const untouched=draft(repeated,['AC4.1']);
 assert.equal(repairUnsupportedLiteralBranchClaims(untouched,plain),untouched);
});
test("unquoted source literal in an explicit fill step supports setup and the Atlas branch ref",()=>{
 const issue={acceptanceCriteria:'AC4 — Si se registra una cuenta ya existente o el alias Atlas, se muestra el mensaje exacto Ya existe un beneficiario con esa cuenta o alias. y el formulario Añadir beneficiario permanece abierto.'} as JiraIssueSource;
 const steps=['Presionar "Guardar beneficiario".','Ingresar un alias válido distinto de Atlas en "Alias".','Presionar "Añadir beneficiario".','Ingresar Atlas en "Alias".','Presionar "Guardar beneficiario".','Validar que "Ya existe un beneficiario con esa cuenta o alias." esté visible en la pantalla activa.','Validar que el formulario con el campo "Alias" permanezca abierto.'];
 const draft=(s:string[],refs:string[])=>({title:'Rechazar alias',expectedResult:'Se informa que ya existe',steps:s,acceptanceCriteriaRefs:refs});
 const refsOf=(s:string[],refs:string[])=>repairSourceBackedLiteralBranchClaims(draft(s,refs),issue).acceptanceCriteriaRefs;
 assert.deepEqual(jiraGenerationContractErrors(draft(steps,['AC4.1.2','AC4.2']),issue),[]);
 // The background button label is not a dialog anchor: fail closed.
 assert.ok(jiraGenerationContractErrors(draft([...steps.slice(0,6),'Validar que el formulario "Añadir beneficiario" permanezca abierto.'],['AC4.2']),issue).includes('JIRA_DIALOG_ANCHOR_MISSING'));
 assert.deepEqual(refsOf(steps,['AC4.2']),['AC4.2','AC4.1.2']);
 assert.deepEqual(refsOf(steps,[]),['AC4.1.2','AC4.2']);
 // Wrong field, wrong literal, extra wording, or no later duplicate assertion never claim the branch.
 for(const broken of [steps.map(s=>s.replace('Atlas en "Alias"','Atlas en "Nombre"')),steps.map(s=>s.replace('Ingresar Atlas','Ingresar Otro')),steps.map(s=>s.replace('Ingresar Atlas','Ingresar el alias Atlas')),steps.slice(0,4)]){
  assert.ok(!(refsOf(broken,[]) as string[]).includes('AC4.1.2'));
 }
 // Form-open assertion alone claims AC4.2 only, never AC4.1.x; no assertion, no claim.
 assert.deepEqual(refsOf([steps[0],steps[6]],[]),['AC4.2']);
 assert.deepEqual(refsOf(steps.slice(0,4),[]),[]);
 // Title alone adds nothing.
 assert.deepEqual(repairSourceBackedLiteralBranchClaims({...draft([steps[0]],[]),title:'Rechazar el alias Atlas abierto'},issue).acceptanceCriteriaRefs,[]);
});
test("syntax audit accepts a bound matching-row assertion and still rejects an unbound one",async()=>{
 const base={title:'Buscar beneficiario',sourceIssueKey:'HU-1',expectedResult:'ok'};
 const row='Validar que la fila coincidente del beneficiario agregado permanezca visible en la lista Destinatarios guardados';
 assert.deepEqual(await auditGeneratedJiraSyntax([{...base,steps:['Ingresar "Ana" en "Buscar beneficiarios"',row]}]),[]);
 const unbound=await auditGeneratedJiraSyntax([{...base,steps:[row]}]);
 assert.equal(unbound[0]?.reason,'JIRA_ROW_DATA_BINDING_MISSING');
});
test("first (non-literal) alternative is claimed only by an in-journey save, identical repeat and rejection",()=>{
 const issue={acceptanceCriteria:'AC4 — Si se registra una cuenta ya existente o el alias Atlas, se muestra el mensaje exacto Ya existe un beneficiario con esa cuenta o alias. y el formulario Añadir beneficiario permanece abierto.'} as JiraIssueSource;
 const message='Validar que se muestre "Ya existe un beneficiario con esa cuenta o alias"';
 const draft=(steps:string[],refs:string[])=>({title:'Rechazar cuenta existente',expectedResult:'Se informa que ya existe',steps,acceptanceCriteriaRefs:refs});
 const entry='Ingresar "0011" en "Número de cuenta"';
 assert.deepEqual(repairSourceBackedLiteralBranchClaims(draft([entry,'Presionar "Guardar"',entry,'Presionar "Guardar"',message],[]),issue).acceptanceCriteriaRefs,['AC4.1.1']);
 // No saved first entry / no rejection / a literal alternative entered: nothing is claimed.
 assert.deepEqual(repairSourceBackedLiteralBranchClaims(draft([entry,entry,'Presionar "Guardar"',message],[]),issue).acceptanceCriteriaRefs,[]);
 assert.deepEqual(repairSourceBackedLiteralBranchClaims(draft([entry,'Presionar "Guardar"',entry,'Presionar "Guardar"'],[]),issue).acceptanceCriteriaRefs,[]);
});
test("generation instructions require a named row container and fixture-backed duplicate coverage",()=>{
 const text=jiraScenarioGenerationInstructions();
 assert.match(text,/never quote the bare phrase "fila coincidente"/);
 assert.match(text,/omit that criterion from acceptanceCriteriaRefs and leave it uncovered/);
});
test("ordinary inputs do not establish an incomplete-operation failure",()=>{
 assert.deepEqual(jiraGenerationContractErrors({title:'Operación no completada',steps:['Ingresar dato en "Dato"','Validar que no se muestre "Resultado"']}),['JIRA_FAILURE_SETUP_UNSPECIFIED']);
 assert.deepEqual(jiraGenerationContractErrors({title:'Operación no completada',steps:['Ingresar dato no válido en "Dato"']}),[]);
 assert.deepEqual(jiraGenerationContractErrors({steps:['Una instrucción sin acción'],unresolvedUiRequirements:[{stepIndex:1,requirement:'Unknown action'}]}),['JIRA_UI_OBSERVATION_REQUIRED']);
});
test('Jira generation blocks grouped multi-field actions across app profiles',()=>{
 for(const appSlug of ['app-alpha','app-beta']) {
  const errors=jiraGenerationContractErrors({appSlug,title:'Completar identidad',steps:['Completar individualmente los siete campos de identidad con datos válidos']});
  assert.ok(errors.includes('JIRA_COMPOSITE_STEP_REQUIRES_EXPLICIT_ACTIONS'));
 }
 assert.deepEqual(jiraGenerationContractErrors({steps:['Ingresar nombre en "Nombre"']}),[]);
});
test("source-backed incomplete required fields need a submit attempt and a field error",()=>{
 const issue={description:'Si una fila está incompleta, se bloquea el avance y se informa el campo.'} as JiraIssueSource;
 const valid={title:'Fila incompleta bloquea el avance',expectedResult:'La fila incompleta no permite continuar.',steps:[
  'Presionar "Continuar"','Validar que se muestre "Ingresos"','Validar que el campo "Importe mensual" muestre un error de validación',
 ]};
 assert.deepEqual(jiraGenerationContractErrors(valid,issue),[]);
 assert.deepEqual(jiraGenerationContractErrors({...valid,steps:['Seleccionar "Continuar"',...valid.steps.slice(1)]},issue),[]);
 assert.deepEqual(jiraGenerationContractErrors({...valid,steps:valid.steps.slice(1)},issue),['JIRA_FAILURE_SETUP_UNSPECIFIED']);
 assert.deepEqual(jiraGenerationContractErrors({...valid,steps:['Presionar "Continuar"','Validar que se muestre "Ingresos"']},issue),['JIRA_FAILURE_SETUP_UNSPECIFIED']);
  assert.deepEqual(jiraGenerationContractErrors({...valid,steps:['Activar "Continuar"',valid.steps[2]]},issue),[]);
});
test('removes unsupported new-row text only when a later row-scoped action proves the row can be used',()=>{
 const draft={steps:[
  'Presionar "Agregar ingreso"',
  'Validar que se muestre "una nueva fila de ingreso"',
  'Seleccionar en la segunda fila el campo "Tipo" con un valor ficticio válido',
  'Validar que el campo "Importe mensual" muestre un error de validación',
 ],inputRequirements:[{key:'second_row_type',stepIndex:3}],unresolvedUiRequirements:[
  {stepIndex:2,requirement:'Observe the new row'},
  {stepIndex:3,requirement:'Resolve the second-row type field'},
 ],conditionRequirements:[{stepIndices:[2,3]}]};
 const repaired=repairUnsupportedAddedRowAssertions(draft);
 assert.deepEqual(repaired.steps,[draft.steps[0],draft.steps[2],draft.steps[3]]);
 assert.deepEqual(repaired.inputRequirements,[{key:'second_row_type',stepIndex:2}]);
 assert.deepEqual(repaired.unresolvedUiRequirements,[{stepIndex:2,requirement:'Resolve the second-row type field'}]);
 assert.deepEqual(repaired.conditionRequirements,[{stepIndices:[2]}]);
 const unsupportedWithoutFollowup=repairUnsupportedAddedRowAssertions({steps:draft.steps.slice(0,2)});
 assert.deepEqual(unsupportedWithoutFollowup.steps,draft.steps.slice(0,2));
});
test('drops invented search submit after a fill unless the story declares a submit control, and fails closed without result evidence',()=>{
 const reactive={description:'El usuario filtra el registro escribiendo en el campo de filtro y la tabla muestra solo las filas coincidentes.'} as JiraIssueSource;
 const draft={steps:[
  'Ingresar "term" en "Filtro de registro"',
  'Presionar la acción de buscar en Registro de auditoría',
  'Validar que se muestre "una fila coincidente"',
 ],inputRequirements:[{key:'f',stepIndex:1}],unresolvedUiRequirements:[{stepIndex:2,requirement:'x'},{stepIndex:3,requirement:'rows'}]};
 const repaired=repairUnbackedFilterSubmitActions(draft,reactive);
 assert.deepEqual(repaired.steps,[draft.steps[0],draft.steps[2]]);
 assert.deepEqual(repaired.unresolvedUiRequirements,[{stepIndex:2,requirement:'rows'}]);
 assert.deepEqual(jiraGenerationContractErrors(repaired,reactive).includes('JIRA_FILTER_RESULT_EVIDENCE_MISSING'),false);
 // Unrepaired draft is rejected.
 assert.ok(jiraGenerationContractErrors(draft,reactive).includes('JIRA_FILTER_RESULT_EVIDENCE_MISSING'));
 // No observable result after the fill: fail closed.
 assert.ok(jiraGenerationContractErrors({steps:[draft.steps[0]]},reactive).includes('JIRA_FILTER_RESULT_EVIDENCE_MISSING'));
 // Unrelated later assertion does not count as result evidence.
 assert.ok(jiraGenerationContractErrors({steps:[draft.steps[0],'Validar que se muestre "el logotipo" en el encabezado']},reactive).includes('JIRA_FILTER_RESULT_EVIDENCE_MISSING'));
 // Explicit submit control in the story keeps the step.
 const explicit={description:'El usuario escribe el término y presiona el botón Buscar para filtrar la tabla.'} as JiraIssueSource;
 assert.equal(repairUnbackedFilterSubmitActions(draft,explicit),draft);
 assert.equal(jiraGenerationContractErrors(draft,explicit).includes('JIRA_FILTER_RESULT_EVIDENCE_MISSING'),false);
});
test('generation drops only the invented filter submit for reactive sources and keeps it for explicit-submit sources',async()=>{
 const fill='Ingresar "term" en "Filtro de registro"';
 const press='Presionar la acción de buscar en Registro de auditoría';
 const assertion='Validar que se muestre "una fila coincidente"';
 const draft={sourceIssueKey:'HU-9',title:'Filter records',steps:['Abrir la aplicación configurada del proyecto',fill,press,assertion],expectedResult:'una fila coincidente'};
 const run=(description:string)=>generateJiraScenarios([{key:'HU-9',summary:'Filtro',description} as JiraIssueSource],'app-a',{providerType:'fake',providerName:'fake',model:'fixture',async completeJson(){return {rawText:'',model:'fixture',providerName:'fake',durationMs:0,parsedJson:{scenarios:[{...draft}]}};}});
 const reactive=await run('El usuario filtra el registro escribiendo en el campo de filtro y la tabla muestra solo las filas coincidentes.');
 assert.deepEqual(reactive.scenarios[0].steps,[draft.steps[0],fill,assertion]);
 assert.equal(reactive.scenarios[0].validation.valid,true);
 const explicit=await run('El usuario escribe el término y presiona el botón Buscar para filtrar la tabla.');
 assert.ok(explicit.scenarios[0].steps.some(step=>/^Presionar\b.*buscar en Registro de auditor[ií]a/i.test(step)));
 assert.ok(explicit.scenarios[0].steps.includes(assertion));
});
test('removes unsupported navigation after a source-backed terminal result and reindexes Jira metadata across projects',()=>{
 const issue={description:'AC7 — Al completar la transferencia, la aplicación muestra el comprobante de transacción exitosa con monto, cuentas involucradas, fecha y referencia.'} as JiraIssueSource;
 const draft={expectedResult:'Se muestra el comprobante de transacción exitosa con monto y referencia.',steps:[
  'Validar que se muestre "resumen de confirmación"',
  'Presionar "continuar con la autorización"',
  'Validar que se muestre "validación de identidad"',
  'Validar que se muestre "comprobante de transacción exitosa"',
  'Validar que se muestre "monto"',
  'Presionar "continuar"',
  'Validar que se muestre "referencia"',
 ],inputRequirements:[{name:'monto',stepIndex:7}],unresolvedUiRequirements:[
  {stepIndex:6,requirement:'Unknown post-receipt navigation'},
  {stepIndex:7,requirement:'Inspect the receipt reference'},
 ]};
 for(const appSlug of ['app-alpha','app-beta']) {
  const fixed=repairUnsubstantiatedPostOutcomeActions(draft,issue);
  assert.equal((fixed.steps as string[]).includes('Presionar "continuar"'),false,appSlug);
  assert.deepEqual((fixed.steps as string[]).slice(-2),['Validar que se muestre "monto"','Validar que se muestre "referencia"']);
  assert.deepEqual(fixed.inputRequirements,[{name:'monto',stepIndex:6}]);
  assert.deepEqual(fixed.unresolvedUiRequirements,[{stepIndex:6,requirement:'Inspect the receipt reference'}]);
 }
});
test('keeps a post-outcome action only when the source explicitly requires it after the result',()=>{
 const issue={description:'La pantalla muestra el comprobante exitoso. Después, el cliente puede continuar al resumen de cuentas.'} as JiraIssueSource;
 const draft={expectedResult:'comprobante exitoso',steps:['Validar que se muestre "comprobante exitoso"','Presionar "continuar al resumen de cuentas"']};
 assert.deepEqual(repairUnsubstantiatedPostOutcomeActions(draft,issue),draft);
});
test('removes menu-label content assertions named by the source and reindexes metadata across projects',()=>{
 const cases=[
  {appSlug:'app-alpha',description:'AC1 — Tras ingresar, el menú principal muestra Productos, Saldos y Pagos.',labels:['productos','saldos','pagos']},
  {appSlug:'app-beta',description:'La navegación lateral presenta Inicio, Reportes y Ajustes.',labels:['Inicio','Reportes','Ajustes']},
 ];
 for(const {appSlug,description,labels} of cases) {
  const issue={description} as JiraIssueSource;
  const draft={appSlug,acceptanceCriteriaRefs:['AC1.1'],steps:[
   'Presionar "Continuar"',
   'Validar que se muestre "resumen general"',
   ...labels.map(label=>`Validar que se muestre "${label}"`),
   'Presionar "Solicitar"',
   'Validar que se muestre "formulario"',
  ],inputRequirements:[{name:'x',stepIndex:2},{name:'y',stepIndex:labels.length+3}],
  unresolvedUiRequirements:[{stepIndex:3,requirement:'menu label'},{stepIndex:labels.length+4,requirement:'form'}]};
  const fixed=repairMenuLabelContentAssertions(draft,issue);
  assert.deepEqual(fixed.steps,['Presionar "Continuar"','Validar que se muestre "resumen general"','Presionar "Solicitar"','Validar que se muestre "formulario"'],appSlug);
  assert.deepEqual(fixed.inputRequirements,[{name:'x',stepIndex:2},{name:'y',stepIndex:3}],appSlug);
  assert.deepEqual(fixed.unresolvedUiRequirements,[{stepIndex:4,requirement:'form'}],appSlug);
 }
});
test('keeps non-menu assertions and leaves candidates untouched without menu evidence in the source',()=>{
 const draft={steps:['Validar que se muestre "productos"','Validar que se muestre "resumen"','Validar que el campo "Saldos" muestre un error de validación']};
 assert.equal(repairMenuLabelContentAssertions(draft,{description:'El menú muestra Productos.'} as JiraIssueSource).steps.length,2);
 assert.deepEqual(repairMenuLabelContentAssertions(draft,{description:'La pantalla muestra productos y resumen.'} as JiraIssueSource),draft);
 assert.equal(repairMenuLabelContentAssertions(draft),draft);
});
test('menu cue in an earlier sentence of the same criterion suppresses labels and uncovers the criterion',()=>{
 const issue={description:'AC1 — Inicio.\nAC2 — Panel. Tras ingresar se carga el menú principal. Allí se listan Gamma, Delta y Épsilon.\nAC3 — Otro.'} as JiraIssueSource;
 const draft={acceptanceCriteriaRefs:['AC2.1','AC3'],steps:['Validar que se muestre "Gamma"','Validar que se muestre "Delta"','Validar que se muestre "otra cosa"']};
 const fixed=repairMenuLabelContentAssertions(draft,issue) as typeof draft&{contextCriteriaRefs?:string[]};
 assert.deepEqual(fixed.steps,['Validar que se muestre "otra cosa"']);
 assert.deepEqual(fixed.acceptanceCriteriaRefs,['AC3']);
 assert.deepEqual(fixed.contextCriteriaRefs,['AC2.1']);
});
test('menu cue in a different criterion does not suppress a content assertion',()=>{
 const issue={description:'AC1 — El menú principal muestra Gamma y Delta.\nAC2 — El resumen muestra Gamma y Delta.'} as JiraIssueSource;
 const draft={acceptanceCriteriaRefs:['AC2'],steps:['Validar que se muestre "Gamma"','Validar que se muestre "Delta"']};
 assert.equal(repairMenuLabelContentAssertions(draft,issue),draft);
 const unrelated={description:'AC1 — Flujo con navegación multipaso.\nAC2 — El resumen muestra Gamma.'} as JiraIssueSource;
 assert.equal(repairMenuLabelContentAssertions({acceptanceCriteriaRefs:['AC2'],steps:['Validar que se muestre "Gamma"']},unrelated).steps.length,1);
 // menu criterion not claimed by the candidate: nothing is suppressed
 assert.equal(repairMenuLabelContentAssertions({acceptanceCriteriaRefs:['AC2'],steps:['Validar que se muestre "Gamma"']},{description:'AC1 — El menú muestra Gamma.\nAC2 — Otro.'} as JiraIssueSource).steps.length,1);
});
test("generation retains conditional evidence for live Discovery without manual configuration",async()=>{
 for(const appSlug of ['app-a','app-b']) {
 let calls=0; const issue={key:'HU-1',summary:'Operation',description:'Mostrar descuento cuando aplique.',acceptanceCriteria:null,labels:[],components:[],status:'Open',issueType:'Story'} as JiraIssueSource;
 const result=await generateJiraScenarios([issue],appSlug,{providerType:'fake',providerName:'fake',model:'fixture',async completeJson(){calls++;return {rawText:'',model:'fixture',providerName:'fake',durationMs:0,parsedJson:{scenarios:[{sourceIssueKey:'HU-1',title:'Result',steps:['Validar que se muestre "descuento"'],expectedResult:'descuento'}]}};}});
 assert.equal(calls,1);assert.equal(result.scenarios[0].validation.valid,true);
 assert.equal(result.scenarios[0].executionReadiness,'requires_discovery');
 assert.deepEqual(result.scenarios[0].conditionRequirements?.[0].stepIndices,[1]);
 }
});
test('generation restores an omitted source-backed conditional check without another AI request across app profiles',async()=>{
 const issue={key:'HU-5',summary:'Transferencia',description:'AC5 — Confirmación\nAntes de autorizar, mostrar monto, comisión, impuestos, tasa de cambio cuando aplique y total a debitar.',acceptanceCriteria:null,labels:[],components:[],status:'Open',issueType:'Story'} as JiraIssueSource;
 const missingAssertion={sourceIssueKey:'HU-5',title:'Successful transfer',acceptanceCriteriaRefs:['AC5.1'],steps:[
  'Abrir la aplicación configurada del proyecto','Validar que se muestre "monto"',
  'Validar que se muestre "comisión"','Validar que se muestre "impuestos"',
  'Validar que se muestre "total a debitar"','Presionar "continuar"',
 ],expectedResult:'monto'};
 for(const appSlug of ['fenix-profile-fixture','commerce-profile-fixture']) {
  let calls=0;
  const result=await generateJiraScenarios([issue],appSlug,{providerType:'fake',providerName:'fake',model:'fixture',async completeJson(){calls++;return {rawText:'',model:'fixture',providerName:'fake',durationMs:0,parsedJson:{scenarios:[missingAssertion]}};}});
  assert.equal(calls,1);
  assert.equal(result.scenarios[0].validation.valid,true);
  assert.equal(result.scenarios[0].steps[4],'Validar que se muestre "tasa de cambio"');
  assert.deepEqual(result.scenarios[0].conditionRequirements?.[0].stepIndices,[5]);
 }
});
test('generation inserts a semantic continue action between a reviewed summary and a later authorization stage across profiles',async()=>{
 const issue={key:'HU-TRANSITION',summary:'Transferencia',description:'Antes de autorizar la operación, la aplicación presenta una confirmación con el monto, las cuentas, la comisión y el total a debitar. El cliente puede revisar esa información antes de continuar. Para autorizar la transferencia, la aplicación muestra la pantalla de validación de identidad y permite completar un token de seguridad.',acceptanceCriteria:null,labels:[],components:[],status:'Open',issueType:'Story'} as JiraIssueSource;
 const draft={sourceIssueKey:issue.key,title:'Complete transfer',steps:[
  'Abrir la aplicación configurada del proyecto',
  'Validar que se muestre "Monto"',
  'Validar que se muestre "Cuentas"',
  'Validar que se muestre "Comisión"',
  'Validar que se muestre "Total a debitar"',
  'Validar que se muestre "Validación de identidad"',
  'Solicitar el token por SMS',
  'Ingresar token de seguridad en "Security token"',
  'Validar que se muestre "Receipt"',
 ],expectedResult:'Receipt',inputRequirements:[{key:'token',stepIndex:8}],unresolvedUiRequirements:[{stepIndex:6,requirement:'Resolve token request control'}]};
 for(const appSlug of ['app-alpha','app-beta']) {
  const result=await generateJiraScenarios([issue],appSlug,{providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){return {rawText:'',parsedJson:{scenarios:[draft]},model:'fixture',providerName:'fixture',durationMs:0};}});
  assert.deepEqual(result.scenarios[0].steps.slice(4,7),[
   'Validar que se muestre "Total a debitar"',
   'Presionar "continuar"',
   'Validar que se muestre "Validación de identidad"',
  ]);
  assert.equal(result.scenarios[0].inputRequirements?.[0].stepIndex,9);
  assert.deepEqual(result.scenarios[0].unresolvedUiRequirements,[
   {stepIndex:6,requirement:'Discovery must resolve the control that continues from the reviewed summary to the authorization stage.'},
   {stepIndex:7,requirement:'Resolve token request control'},
  ]);
 }
});
test('generation normalizes configured-app entry and contextual conditional text across app profiles',async()=>{
 const issue={key:'HU-6',summary:'Transferencia',description:'AC5 — Confirmación\nAntes de autorizar se muestran los impuestos y la tasa de cambio cuando aplique.'} as JiraIssueSource;
 const draft={sourceIssueKey:'HU-6',title:'Transferencia exitosa',acceptanceCriteriaRefs:['AC5.1'],steps:[
  'Abrir la aplicación configurada "Aplicación QA"',
  'Validar que se muestre "impuestos"',
  'Validar la tasa de cambio en "resumen"',
 ],expectedResult:'impuestos'};
 for(const appSlug of ['app-a','app-b']) {
  const result=await generateJiraScenarios([issue],appSlug,{providerType:'fake',providerName:'fake',model:'fixture',async completeJson(){return {rawText:'',model:'fixture',providerName:'fake',durationMs:0,parsedJson:{scenarios:[draft]}};}});
  assert.equal(result.scenarios[0].validation.valid,true);
  assert.deepEqual(result.scenarios[0].steps,[
   'Abrir la aplicación configurada del proyecto',
   'Validar que se muestre "impuestos"',
   'Validar que se muestre "tasa de cambio"',
  ]);
  assert.deepEqual(result.scenarios[0].conditionRequirements?.[0].stepIndices,[3]);
 }
});
test('semantic action wrappers become a single click instead of a click plus inferred assertion',async()=>{
 const draft={sourceIssueKey:'HU-7',title:'Confirm transfer',steps:[
  'Abrir la aplicación configurada del proyecto',
  'Presionar la acción para confirmar la autorización',
  'Validar que se muestre "comprobante"',
 ],expectedResult:'comprobante'};
 const result=await generateJiraScenarios([{key:'HU-7',summary:'Transferencia',description:'El usuario confirma la autorización y ve el comprobante.'} as JiraIssueSource],'portal-comercial',{providerType:'fake',providerName:'fake',model:'fixture',async completeJson(){return {rawText:'',model:'fixture',providerName:'fake',durationMs:0,parsedJson:{scenarios:[draft]}};}});
 assert.deepEqual(result.scenarios[0].steps,[
  'Abrir la aplicación configurada del proyecto',
  'Presionar "confirmar la autorización"',
  'Validar que se muestre "comprobante"',
 ]);
 assert.equal(result.scenarios[0].validation.valid,true);
});
test('learned SMS intent echoed as a quoted label remains a semantic Jira action across profiles',async()=>{
 const issue={key:'HU-SMS',summary:'Account summary',description:'When Fenix requires additional device verification, the customer may request the verification code by SMS.'} as JiraIssueSource;
 assert.deepEqual(normalizeJiraGeneratedSteps([
  'Solicitar el código por SMS "código por SMS".',
  'Presionar "código por SMS".',
 ],issue),['Solicitar el código por SMS','Solicitar el código por SMS']);
 const draft={sourceIssueKey:'HU-SMS',title:'Review account summary after additional verification',steps:[
  'Abrir la aplicación configurada del proyecto',
  'Presionar "perfil empresarial"',
  'Ingresar RNC en "RNC"',
  'Ingresar usuario en "Usuario"',
  'Ingresar contraseña en "Contraseña"',
  'Presionar "continuar inicio de sesión"',
  'Presionar "código por SMS".',
  'Ingresar código de acceso en "Código de acceso"',
  'Presionar "continuar verificación de acceso"',
  'Validar que se muestre "Resumen"',
 ],expectedResult:'Resumen',unresolvedUiRequirements:[{stepIndex:7,requirement:'Discovery must resolve the observed SMS request control.'}]};
 for(const appSlug of ['app-one','app-two']) {
  const result=await generateJiraScenarios([issue],appSlug,{providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){return {rawText:'',parsedJson:{scenarios:[draft]},model:'fixture',providerName:'fixture',durationMs:0};}});
  assert.equal(result.scenarios.length,1);
  assert.equal(result.scenarios[0].steps[6],'Solicitar el código por SMS');
  assert.equal(result.scenarios[0].validation.valid,true);
  assert.deepEqual(result.scenarios[0].validation.errors,[]);
  assert.deepEqual(result.scenarios[0].unresolvedUiRequirements,[{stepIndex:7,requirement:'Discovery must resolve the observed SMS request control.'}]);
 }
});
test('AA-97 rejection language normalizes to supported observations without inventing app-specific labels',async()=>{
 const issue={key:'AA-97',description:'AC8 — Manejo de errores\nSi las credenciales, el código de acceso o el token de transferencia no son válidos, Fenix informa el problema y no presenta la operación como exitosa. Si la transferencia no se completa, tampoco debe mostrarse un comprobante exitoso.'} as JiraIssueSource;
 const candidates=[
  {title:'Rechazo de credenciales empresariales no válidas',steps:['Abrir la aplicación configurada del proyecto','Ingresar contraseña no válida en "Contraseña"','Validar que Fenix informe el problema de credenciales','Validar que no se presenta la operación como "exitosa"']},
  {title:'Rechazo de código de acceso no válido',steps:['Abrir la aplicación configurada del proyecto','Ingresar código de acceso no válido en "Código"','Validar que Fenix informe el problema del código de acceso','Validar que no se presenta la operación como "exitosa"']},
  {title:'Rechazo de token de transferencia no válido',steps:['Abrir la aplicación configurada del proyecto','Ingresar token de seguridad no válido en "Token"','Validar el problema del token de transferencia','Validar que no se presenta la operación como "exitosa"']},
  {title:'Transferencia no completada sin comprobante exitoso',steps:['Abrir la aplicación configurada del proyecto','Validar que se muestre "resumen de productos"','Validar que la transferencia no se completa','Validar que no se muestre "comprobante exitoso"']},
 ].map(candidate=>({...candidate,sourceIssueKey:'AA-97'}));
 const normalized=candidates.map(candidate=>({...candidate,steps:normalizeJiraGeneratedSteps(candidate.steps,issue)}));
 assert.equal(normalized[1].steps[2],'Validar que se muestre "problema de código de acceso"');
 assert.equal(normalized[2].steps[2],'Validar que se muestre "problema de token de transferencia"');
 assert.equal(normalized[0].steps.at(-1),'Validar que no se muestre "operación exitosa"');
 assert.equal(normalized[3].steps[2],'Validar que no se muestre "comprobante exitoso"');
 assert.deepEqual(await auditGeneratedJiraSyntax(normalized,[issue]),[]);
 const rejected=normalized[0];
 const generated=await generateJiraScenarios([issue],'portal-comercial',{providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){return {rawText:'',parsedJson:{scenarios:[{...rejected,expectedResult:'Fenix informa el problema de credenciales y no presenta la operación como "exitosa".'}]},model:'fixture',providerName:'fixture',durationMs:0};}});
 assert.equal(generated.scenarios[0].validation.valid,false);
 assert.ok(generated.scenarios[0].validation.errors.some(error=>error.startsWith('JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE:')));
 assert.equal(generated.scenarios[0].expectedResult,'Se informa problema de credenciales y no se presenta operación exitosa.');
});

test('Jira generation repairs unsupported assertions and excludes non-executable negative skeletons',async()=>{
 const issue={key:'AA-97',description:'AC8 — Manejo de errores. Si las credenciales no son válidas, Fenix informa el problema y no presenta la operación como exitosa.'} as JiraIssueSource;
 const valid={sourceIssueKey:'AA-97',title:'Rechazo de credenciales empresariales no válidas',acceptanceCriteriaRefs:['AC8.1'],expectedResult:'No se muestra "operación exitosa".',steps:[
  'Abrir la aplicación configurada del proyecto','Presionar "perfil empresarial"','Ingresar RNC en "RNC"','Ingresar usuario en "Usuario"',
  'Ingresar contraseña no válida en "Contraseña"','Presionar "iniciar sesión"','Validar que se muestre "problema de credenciales"',
  'Validar que no se muestre "operación exitosa"',
 ]};
 const unsupported={sourceIssueKey:'AA-97',title:'Validar la segunda fila del historial',acceptanceCriteriaRefs:['AC8.1'],expectedResult:'Se muestra el valor esperado en la segunda fila.',steps:[
  'Abrir la aplicación configurada del proyecto','Validar que se muestre "el valor esperado en la segunda fila del historial"',
 ]};
 const emptyFailure={sourceIssueKey:'AA-97',title:'Transferencia no completada sin comprobante exitoso',acceptanceCriteriaRefs:['AC8.1'],expectedResult:'No se muestra comprobante exitoso porque la transferencia no se completa.',steps:[
  'Abrir la aplicación configurada del proyecto','Validar que la transferencia no se completa.','Validar que no se muestre "comprobante exitoso"',
 ]};
 let call=0;
 const result=await generateJiraScenarios([issue],'profile-independent-fixture',{providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){
  call++;
  const scenarios=call===1?[valid,unsupported,emptyFailure]:[
   {...valid,candidateId:'draft-1'},
   {...unsupported,candidateId:'draft-2'},
   {...emptyFailure,candidateId:'draft-3'},
  ];
  return {rawText:'',parsedJson:{scenarios},model:'fixture',providerName:'fixture',durationMs:0};
 }});
 assert.equal(call,3,'unsupported assertion is repaired and missing source obligations receive a coverage pass');
 assert.equal(result.scenarios.length,1);
 assert.equal(result.scenarios[0].validation.valid,false);
 assert.ok(result.scenarios[0].validation.errors.some(error=>error.startsWith('JIRA_ACCEPTANCE_COVERAGE_INCOMPLETE:')));
 assert.equal(result.scenarios.some(s=>s.validation.errors.includes('JIRA_ASSERTION_CAPABILITY_UNSUPPORTED')),false);
 assert.ok(result.rejected.some(item=>item.title===unsupported.title));
 assert.ok(result.rejected.some(item=>item.title===emptyFailure.title && item.reason==='jira_failure_condition_not_executable'));
});

test('normalizes source-backed SMS token requests and negative-result wording to executable Jira intents',async()=>{
 const issue={key:'AA-97',description:'La transferencia requiere un token de seguridad adicional y permite solicitarlo por el canal disponible, como SMS.'} as JiraIssueSource;
 const steps=normalizeJiraGeneratedSteps([
  'Solicitar el token de seguridad por el canal disponible.',
  'Validar "comprobante de transacción exitosa" no presentado.',
 ],issue);
 assert.equal(steps[0],'Solicitar el token por SMS');
 assert.equal(steps[1],'Validar que no se muestre "comprobante de transacción exitosa"');
 const scenario={sourceIssueKey:'AA-97',title:'Rechazo de token no válido',steps:[
  'Abrir la aplicación configurada del proyecto','Presionar "autorizar transferencia"',steps[0],
  'Ingresar token no válido en "Token de seguridad"','Validar que se muestre "problema de token"',steps[1],
 ],expectedResult:steps[1],inputRequirements:[{key:'token',label:'Token de seguridad',operation:'fill',stepIndex:4,dataCondition:'invalid'}]};
 assert.deepEqual(await auditGeneratedJiraSyntax([scenario],[issue]),[]);
 assert.deepEqual(jiraGenerationContractErrors(scenario,issue),[]);
});

test('omitted optional assertion cannot silently claim its acceptance criterion',()=>{
 assert.deepEqual(jiraGenerationContractErrors({steps:['Validar que se muestre "Monto"'],acceptanceCriteriaRefs:['AC5.1']},{description:'AC5 — Confirmation\nMostrar monto y descuento cuando aplique.'} as JiraIssueSource),['JIRA_CONDITION_ASSERTION_MISSING']);
});
test('source-backed conditional assertion is inserted at its unambiguous assertion stage and references are reindexed',()=>{
 const issue={key:'AA-97',description:'AC5 — Confirmación\nAntes de autorizar la transferencia se presenta un resumen con el monto, la comisión, los impuestos, la tasa de cambio cuando aplique y el total a debitar.'} as JiraIssueSource;
 const draft={acceptanceCriteriaRefs:['AC5.1'],steps:[
  'Abrir la aplicación configurada del proyecto',
  'Validar que se muestre "cuentas seleccionadas"',
  'Validar que se muestre "monto"',
  'Validar que se muestre "comisión"',
  'Validar que se muestre "impuestos"',
  'Validar que se muestre "total a debitar"',
  'Presionar "continuar"',
  'Validar que se muestre "comprobante"',
  'Validar que se muestre "monto"',
  'Validar que se muestre "cuentas involucradas"',
  'Validar que se muestre "fecha y hora"',
  'Validar que se muestre "referencia"',
 ],inputRequirements:[{key:'token',stepIndex:11}],unresolvedUiRequirements:[{stepIndex:10,requirement:'Resolve the next control'}]};
 const repaired=repairMissingJiraConditionalAssertions(draft,issue);
 assert.deepEqual(repaired.steps.slice(3,8),[
  'Validar que se muestre "comisión"','Validar que se muestre "impuestos"',
  'Validar que se muestre "tasa de cambio"','Validar que se muestre "total a debitar"','Presionar "continuar"',
 ]);
 assert.equal(repaired.inputRequirements?.[0].stepIndex,12);
 assert.equal(repaired.unresolvedUiRequirements?.[0].stepIndex,11);
 assert.deepEqual(jiraGenerationContractErrors(repaired,issue),[]);
});
test('conditional summary fields are inserted after the summary assertion before authorization across projects',async()=>{
 const issue={key:'HU-SUMMARY',summary:'Transferencia',description:'AC5 — Confirmación\nAntes de autorizar, la aplicación presenta un resumen con monto, comisión, impuestos y tasa de cambio cuando aplique.',acceptanceCriteria:null,labels:[],components:[],status:'Open',issueType:'Story'} as JiraIssueSource;
 const draft={sourceIssueKey:issue.key,title:'Transferencia con token no válido',acceptanceCriteriaRefs:['AC5.1'],steps:[
  'Abrir la aplicación configurada del proyecto','Validar que se muestre "Resumen de confirmación"',
  'Validar que se muestre "monto"','Validar que se muestre "comisión"','Validar que se muestre "impuestos"',
  'Presionar "continuar autorización"','Validar que se muestre "validación de identidad"',
  'Ingresar un token no válido en "Token de seguridad"','Presionar "autorizar transferencia"',
  'Validar que se muestre "problema de token"',
 ],expectedResult:'Se muestra problema de token.',inputRequirements:[{key:'token',stepIndex:8,dataCondition:'invalid'}]};
 for(const appSlug of ['fenix-profile-fixture','commerce-profile-fixture']) {
  const result=await generateJiraScenarios([issue],appSlug,{providerType:'fake',providerName:'fixture',model:'fixture',async completeJson(){return {rawText:'',model:'fixture',providerName:'fixture',durationMs:0,parsedJson:{scenarios:[draft]}};}});
  const scenario=result.scenarios[0];
  assert.equal(scenario.validation.valid,true);
   assert.deepEqual(scenario.steps.slice(1,7),[
    'Validar que se muestre "Resumen de confirmación"',
    'Validar que se muestre "monto"',
    'Validar que se muestre "comisión"',
    'Validar que se muestre "impuestos"',
    'Validar que se muestre "tasa de cambio"',
    'Presionar "continuar autorización"',
  ]);
  assert.equal(scenario.inputRequirements?.[0].stepIndex,9);
   assert.deepEqual(scenario.conditionRequirements?.[0].stepIndices,[6]);
  assert.deepEqual(jiraGenerationContractErrors(scenario,issue),[]);
 }
});
test('atomic summary prose retains its source-backed conditional assertion and stage',()=>{
 const source={key:'HU-42',description:'AC5 — Confirmación\nAntes de autorizar, se presenta un resumen con monto, comisión, impuestos y tasa de cambio cuando aplique.'} as JiraIssueSource;
 const draft={acceptanceCriteriaRefs:['AC5.1'],steps:['Presionar "Continuar"','Validar que la confirmación muestre la tasa de cambio.','Presionar "Autorizar"'],inputRequirements:[{key:'auth',stepIndex:3}]};
 const repaired=repairMissingJiraConditionalAssertions(draft,source);
 assert.deepEqual(repaired.steps,[draft.steps[0],'Validar que se muestre "tasa de cambio"',draft.steps[2]]);
 assert.deepEqual(repaired.inputRequirements,draft.inputRequirements);
 assert.deepEqual(jiraGenerationContractErrors(repaired,source),[]);
 assert.deepEqual(jiraSourceConditions(repaired,source)[0].stepIndices,[2]);
 for(const text of ['Validar que el comprobante muestre la tasa de cambio.','Validar que la confirmación no muestre la tasa de cambio.','Validar que la confirmación muestre el monto y la tasa de cambio.']){
  const other={...draft,steps:[text]};
  assert.deepEqual(repairMissingJiraConditionalAssertions(other,source).steps,[text]);
  assert.ok(jiraGenerationContractErrors(other,source).includes('JIRA_CONDITION_ASSERTION_MISSING'));
 }
});

test('conditional assertion repair stays fail-closed without a source-clause assertion anchor',()=>{
 const issue={key:'HU-2',description:'AC5 — Confirmation\nDisplay the exchange rate when applicable.'} as JiraIssueSource;
 const draft={acceptanceCriteriaRefs:['AC5.1'],steps:['Validar que se muestre "Welcome"']};
 assert.equal(repairMissingJiraConditionalAssertions(draft,issue),draft);
 assert.deepEqual(jiraGenerationContractErrors(draft,issue),['JIRA_CONDITION_ASSERTION_MISSING']);
});

test('access-stage order guard preserves invalid-code checks and later transaction identity stages',()=>{
 const source={description:'El portal muestra la pantalla de verificación de usuario y permite ingresar el código de acceso.'} as JiraIssueSource;
 const steps=['Ingresar código válido en "Código de acceso"','Presionar "Continuar"','Validar que se muestre "verificación de usuario"'];
 assert.ok(jiraGenerationContractErrors({steps},source).includes('JIRA_AUTH_STAGE_ORDER_INVALID'));
 assert.ok(!jiraGenerationContractErrors({steps:[steps[2],...steps.slice(0,2)]},source).includes('JIRA_AUTH_STAGE_ORDER_INVALID'));
 assert.ok(!jiraGenerationContractErrors({steps:['Ingresar un código no válido en "Código de acceso"',...steps.slice(1)]},source).includes('JIRA_AUTH_STAGE_ORDER_INVALID'));
 assert.ok(!jiraGenerationContractErrors({steps:[...steps.slice(0,2),'Validar que se muestre "validación de identidad para autorizar"']},source).includes('JIRA_AUTH_STAGE_ORDER_INVALID'));
 assert.ok(!jiraGenerationContractErrors({steps},{description:'Consultar el saldo.'} as JiraIssueSource).includes('JIRA_AUTH_STAGE_ORDER_INVALID'));
});
test('structured observations preserve valid step references only',async()=>{
 const draft={sourceIssueKey:'HU-2',title:'Observed requirement',steps:['Abrir la aplicación configurada del proyecto.','Validar que se muestre "Resultado"'],expectedResult:'Resultado',unresolvedUiRequirements:[{stepIndex:2,requirement:'Confirm exact outcome text'},{stepIndex:99,requirement:'Invalid position'}]};
 assert.deepEqual(jiraUiObservations(draft),[{stepIndex:2,requirement:'Confirm exact outcome text'}]);
 const result=await generateJiraScenarios([{key:'HU-2',summary:'Outcome',description:'Outcome',acceptanceCriteria:null} as JiraIssueSource],'app-b',{providerType:'fake',providerName:'fake',model:'fixture',async completeJson(){return {rawText:'',model:'fixture',providerName:'fake',durationMs:0,parsedJson:{scenarios:[draft]}};}});
 assert.deepEqual(result.scenarios[0].unresolvedUiRequirements,jiraUiObservations(draft));
 assert.equal(result.scenarios[0].validation.valid,true);
});
