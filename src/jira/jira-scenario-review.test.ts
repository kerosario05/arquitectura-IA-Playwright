import test from 'node:test';
import assert from 'node:assert/strict';
import {isJiraStepAutoResolvable,prepareJiraScenarioReview,jiraRepeatedAssertionBlocks,proposeJiraDuplicateRepair,canonicalJiraConditionalVisibilityStep} from './jira-scenario-review';
import {jiraSourceConditions,repairMissingJiraConditionalAssertions} from './jira-generation-contract';
import {discoverJiraScenario,type JiraBrowserPort} from './jira-semantic-executor';
import {compileJiraSpec} from './jira-spec-compiler';
import {auditGeneratedJiraSyntax} from './jira-scenario-generator';
import type {JiraIssueSource} from '../scenarios/scenario-types';
import path from 'node:path';

test('source-backed applicability inside a quoted target is separated across domains and consumers',async()=>{
 for(const subject of ['tasa de cambio','descuento','shipping fee']) {
  const sourceClause=`El resumen presenta el monto, los impuestos y la ${subject} cuando aplique`;
  for(const suffix of ['cuando corresponda','cuando aplique','si aplica','when applicable','if applicable','aplicable','applicable']) {
   const input={scenarioId:'COND:jira:1',sourceIssueKey:'COND',title:'Confirmación',
    steps:['Abrir la aplicación configurada del proyecto',`Validar que el resumen de confirmación muestre la "${subject} ${suffix}".`,'Validar que se muestre "Done"'],expectedResult:'Done',
    conditionRequirements:[{key:'conditional-field',subject,sourceClause,stepIndices:[2]}]};
   const source={key:'COND',description:sourceClause} as JiraIssueSource;
   assert.deepEqual(await auditGeneratedJiraSyntax([input],[source]),[]);
   const generated=repairMissingJiraConditionalAssertions(input,source);
   assert.equal(generated.steps[1],`Validar que se muestre "${subject}"`);
   for(const applies of [true,false,undefined]) {
    const conditions:Record<string,boolean>=applies===undefined?{}:{'conditional-field':applies};
    const configured={...input,reviewConfiguration:{conditions}};
    const calls:string[]=[];
    const browser:JiraBrowserPort={async navigate(){},async act(){throw Error('unexpected action');},async assert(target){calls.push(target);return {observedText:target};}};
    const contract=await discoverJiraScenario(configured,browser);
    assert.deepEqual(calls,applies===false?['Done']:[subject,'Done']);
    const compiled=compileJiraSpec({plan:contract.plan,sourceScenario:contract.sourceScenario,appSlug:'fixture',sectionSlug:'jira',automationId:'condition',specPath:path.resolve('.artifacts/tmp/condition/case.spec.ts')});
    assert.deepEqual(compiled.unsupported,[]);
    assert.doesNotMatch(compiled.source,/cuando corresponda|cuando aplique|si aplica|when applicable|if applicable/);
   }
   for(const invalid of [
    `Validar que el resumen muestre la "otro ${suffix}".`,
    `Validar que no se muestre "${subject} ${suffix}".`,
    `Validar que el resumen muestre la "${subject} ${suffix}" y presionar "Continuar".`,
    `Validar que el resumen muestre la "${subject} si el saldo es positivo".`,
   ]) assert.ok(prepareJiraScenarioReview({...input,steps:[input.steps[0],invalid,input.steps[2]]}).errors.includes('JIRA_CONDITION_STEP_UNSUPPORTED'));
  }
 }
 const ordinary={steps:['Validar que el resumen muestre "Fee when applicable".'],conditionRequirements:[{key:'r',subject:'Fee',sourceClause:'El resumen presenta Fee',stepIndices:[1]}]};
 assert.deepEqual(prepareJiraScenarioReview(ordinary).errors,['JIRA_CONDITION_STEP_UNSUPPORTED'],'no invented applicability without source evidence');
});

test('source-backed contextual conditional checks cross generation, review and Discovery',async()=>{
 for(const [appSlug,subject] of [['synthetic-a','descuento'],['synthetic-b','tasa de cambio']]) {
  const sourceClause=`El resumen presenta el monto, los impuestos y la ${subject} cuando aplique`;
  for(const conditionalStep of [`Validar que se muestre "${subject}" en la confirmación.`,`Validar que la confirmación muestre la "${subject}".`]) {
   const input={scenarioId:'HU-C:jira:1',sourceIssueKey:'HU-C',title:'Revisión',appSlug,
    steps:['Abrir la aplicación configurada del proyecto',conditionalStep,'Validar que se muestre "Done"'],expectedResult:'Done',
    conditionRequirements:[{key:'rule',subject,sourceClause,stepIndices:[2]}],
    unresolvedUiRequirements:[{stepIndex:2,requirement:'Verificar aplicabilidad'}]};
   const generated=repairMissingJiraConditionalAssertions(input,{description:sourceClause} as Parameters<typeof jiraSourceConditions>[1]);
   assert.equal(generated.steps[1],`Validar que se muestre "${subject}"`);
   assert.deepEqual(await auditGeneratedJiraSyntax([input],[{key:'HU-C',description:sourceClause} as JiraIssueSource]),[]);
   for(const applies of [true,false]) {
    const configured={...input,reviewConfiguration:{conditions:{rule:applies}}};
    const review=prepareJiraScenarioReview(configured);
    assert.deepEqual(review.errors,[]);
    assert.equal(review.scenario.steps[1],`Validar que se muestre "${subject}"`);
    assert.deepEqual(review.skippedAssertionSteps,applies?[]:[2]);
    const calls:string[]=[];
    const browser:JiraBrowserPort={async navigate(){},async act(){throw Error('unexpected action');},async assert(target){calls.push(target);return {observedText:target};}};
    await discoverJiraScenario(configured,browser);
    assert.deepEqual(calls,applies?[subject,'Done']:['Done']);
   }
   for(const invalid of [`Validar que no se muestre "${subject}" en la confirmación.`,`Validar que se muestre "${subject}" en la confirmación y presionar "Continuar".`,`Validar que se muestre "Otro" en la confirmación.`,`Validar que se muestre "${subject}" en el comprobante.`]) {
    assert.deepEqual(prepareJiraScenarioReview({...input,steps:[input.steps[0],invalid,input.steps[2]]}).errors,['JIRA_CONDITION_STEP_UNSUPPORTED']);
   }
  }
 }
});

test('generated “appears in summary” wording is normalized as a supported conditional visibility assertion',async()=>{
 for(const [subject,sourceClause,step] of [
  ['tasa de cambio','El resumen de confirmación presenta el monto, la comisión y la tasa de cambio cuando aplique.','Validar que "la tasa de cambio" aparezca en el resumen de confirmación.'],
  ['impuestos','El resumen de confirmación contiene el monto y los impuestos cuando aplique.','Verificar que "los impuestos" se incluyan en el resumen de confirmación.'],
 ] as const) {
  const source={key:'HU-CONDITION',description:sourceClause} as JiraIssueSource;
  const input={scenarioId:'HU-CONDITION:jira:1',sourceIssueKey:source.key,title:'Validar resumen',steps:['Abrir la aplicación configurada del proyecto',step],expectedResult:''};
  assert.deepEqual(await auditGeneratedJiraSyntax([input],[source]),[]);
  const repaired=repairMissingJiraConditionalAssertions(input,source);
  assert.equal(repaired.steps[1],`Validar que se muestre "${subject}"`);
  const reviewed=prepareJiraScenarioReview({...input,conditionRequirements:jiraSourceConditions(input,source)});
  assert.deepEqual(reviewed.errors,[]);
  assert.equal(reviewed.scenario.steps[1],`Validar que se muestre "${subject}"`);
  const observed:string[]=[];
  const browser:JiraBrowserPort={async navigate(){},async act(){throw Error('unexpected action');},async assert(target){observed.push(target);return {observedText:target};}};
  const discovery=await discoverJiraScenario({...input,conditionRequirements:jiraSourceConditions(input,source)},browser);
  assert.deepEqual(observed,[subject]);
  const compiled=compileJiraSpec({plan:discovery.plan,sourceScenario:discovery.sourceScenario,appSlug:'fixture',sectionSlug:'jira',automationId:'conditional-summary',specPath:path.resolve('.artifacts/tmp/conditional-summary/case.spec.ts')});
  assert.deepEqual(compiled.unsupported,[]);
 }
 assert.equal(canonicalJiraConditionalVisibilityStep('Validate that "the exchange rate" appears in the confirmation summary.',{key:'r',subject:'exchange rate',sourceClause:'The confirmation summary shows the exchange rate if applicable',stepIndices:[1]}),'Validar que se muestre "exchange rate"');
 const unrelated={steps:['Validar que "tasa de cambio" aparezca en la confirmación'],conditionRequirements:[{key:'r',subject:'tasa de cambio',sourceClause:'El sistema considera la tasa de cambio cuando aplique',stepIndices:[1]}]};
 assert.deepEqual(prepareJiraScenarioReview(unrelated).errors,['JIRA_CONDITION_STEP_UNSUPPORTED'],'do not reinterpret a non-summary assertion without source stage evidence');
});

test('source-backed applicability after the stage survives review, Discovery and compilation',async()=>{
 for(const subject of ['tasa de cambio','shipping fee']) {
  const source={key:'HU-QUALIFIER',description:`El resumen de confirmación presenta el monto, los impuestos y ${subject} cuando aplique.`} as JiraIssueSource;
  const input={scenarioId:'HU-QUALIFIER:jira:1',sourceIssueKey:source.key,title:'Summary',steps:[`Validar que se muestre "${subject}" en la confirmación cuando corresponda.`],expectedResult:''};
  const scenario={...input,conditionRequirements:jiraSourceConditions(input,source)};
  const review=prepareJiraScenarioReview(scenario);
  assert.deepEqual(review.errors,[]);
  assert.equal(review.scenario.steps[0],`Validar que se muestre "${subject}"`);
  assert.deepEqual(await auditGeneratedJiraSyntax([input],[source]),[]);
  const observed:string[]=[];
  const browser:JiraBrowserPort={async navigate(){},async act(){throw Error('unexpected action');},async assert(target){observed.push(target);return {observedText:target};}};
  const discovered=await discoverJiraScenario(scenario,browser);
  assert.deepEqual(observed,[subject]);
  const compiled=compileJiraSpec({plan:discovered.plan,sourceScenario:discovered.sourceScenario,appSlug:'fixture',sectionSlug:'jira',automationId:'qualifier',specPath:path.resolve('.artifacts/tmp/qualifier/case.spec.ts')});
  assert.deepEqual(compiled.unsupported,[]);
  assert.equal(canonicalJiraConditionalVisibilityStep(input.steps[0],{key:'r',subject,sourceClause:`El resumen presenta ${subject}`,stepIndices:[1]}),input.steps[0]);
  for(const invalid of [`Validar que se muestre "Otro" cuando corresponda.`,`Presionar "Continuar" cuando corresponda.`,`Validar que no se muestre "${subject}" cuando corresponda.`]) {
   assert.equal(canonicalJiraConditionalVisibilityStep(invalid,scenario.conditionRequirements[0]),invalid);
  }
 }
});

test('test variant decisions stay scoped and never skip clicks or unknown outcomes',()=>{
 const input={steps:['Validar que se muestre "Discount"','Presionar "Continue"'],conditionRequirements:[{key:'rule',subject:'Discount',sourceClause:'Discount if applicable',stepIndices:[1]}]};
 assert.deepEqual(prepareJiraScenarioReview(input).errors,[]);
 assert.deepEqual(prepareJiraScenarioReview(input).skippedAssertionSteps,[]);
 assert.deepEqual(prepareJiraScenarioReview({...input,reviewConfiguration:{conditions:{rule:false}}}).skippedAssertionSteps,[1]);
 assert.deepEqual(prepareJiraScenarioReview({...input,conditionRequirements:[{...input.conditionRequirements[0],stepIndices:[2]}],reviewConfiguration:{conditions:{rule:false}}}).errors,['JIRA_CONDITION_STEP_UNSUPPORTED']);
 assert.deepEqual(prepareJiraScenarioReview({...input,conditionRequirements:[{...input.conditionRequirements[0],stepIndices:[]}],reviewConfiguration:{conditions:{rule:true}}}).errors,['JIRA_CONDITION_ASSERTION_MISSING']);
});

test('review keeps the exact authored position and text for every unsupported conditional step',()=>{
 const steps=['Presionar "Continue"','Validar que se muestre "Fee" en otra pantalla.','Validar que se muestre "Done"','Validar que se muestre "Tax" y presionar "Pay".'];
 const result=prepareJiraScenarioReview({steps,conditionRequirements:[
  {key:'fee',subject:'Fee',sourceClause:'Fee if applicable',stepIndices:[2]},
  {key:'tax',subject:'Tax',sourceClause:'Tax if applicable',stepIndices:[4]},
 ]});
 assert.deepEqual(result.errors,['JIRA_CONDITION_STEP_UNSUPPORTED']);
 assert.deepEqual(result.issues,[{code:'JIRA_CONDITION_STEP_UNSUPPORTED',stepIndex:2,step:steps[1]},{code:'JIRA_CONDITION_STEP_UNSUPPORTED',stepIndex:4,step:steps[3]}]);
});

test('atomic and trailing quoted applicability keeps the original metadata and literal subjects',()=>{
 const requirement={key:'r',subject:'shipping fee',sourceClause:'The confirmation summary shows shipping fee if applicable',stepIndices:[1]};
 for(const step of ['Validar que se muestre "shipping fee if applicable".',
  'Validar que se muestre "shipping fee when applicable" en la confirmación.']) {
  const input={steps:[step],conditionRequirements:[requirement]};
  const review=prepareJiraScenarioReview(input);
  assert.deepEqual(review.errors,[]);
  assert.deepEqual(review.scenario.steps,['Validar que se muestre "shipping fee"']);
  assert.deepEqual(review.scenario.conditionRequirements,[requirement]);
  assert.equal(input.steps[0],step);
 }
 const literal={...requirement,subject:'Fee if applicable'};
 assert.deepEqual(prepareJiraScenarioReview({steps:['Validar que se muestre "Fee if applicable"'],conditionRequirements:[literal]}).scenario.steps,
  ['Validar que se muestre "Fee if applicable"'],'a matching literal source subject must not lose words');
});

test('target review changes one target and preserves field binding without certifying it',()=>{
 const draft={steps:['Ingresar dato en "Unknown"'],inputRequirements:[{stepIndex:1,label:'Unknown',key:'user.key'}],unresolvedUiRequirements:[{stepIndex:1,requirement:'Input label'}]};
 assert.deepEqual(prepareJiraScenarioReview(draft).errors,[]);
 const result=prepareJiraScenarioReview({...draft,reviewConfiguration:{uiTargets:{'1':'User name'}}});
 assert.deepEqual(result.scenario.steps,['Ingresar dato en "User name"']);
 assert.equal(result.scenario.inputRequirements?.[0].key,'user.key');
 assert.equal(result.scenario.inputRequirements?.[0].label,'User name');
 assert.equal(draft.inputRequirements[0].label,'Unknown');
 assert.deepEqual(prepareJiraScenarioReview({...draft,reviewConfiguration:{uiTargets:{'1':'"bad"'}}}).errors,['JIRA_UI_TARGET_OVERRIDE_INVALID']);
});

test('SMS token requests stay executable Jira actions across app profiles',async()=>{
 const step='Solicitar el token por SMS.';
 for(const appSlug of ['profile-one','profile-two']) {
  assert.equal(isJiraStepAutoResolvable(step),true);
  const input={scenarioId:'HU-TOKEN:jira:1',sourceIssueKey:'HU-TOKEN',title:'Request security token',appSlug,
   steps:['Abrir la aplicación configurada del proyecto',step,'Validar que se muestre "Token de seguridad"'],expectedResult:'Token de seguridad',
   unresolvedUiRequirements:[{stepIndex:2,requirement:'Discovery resolves the SMS token request control.'}]};
  assert.deepEqual(prepareJiraScenarioReview(input).errors,[]);
  const actions:string[]=[];
  const browser:JiraBrowserPort={async navigate(){},async act(_plan,target){actions.push(target);return {strategy:'role',role:'button',name:target,exact:true};},async assert(target){return {observedText:target};}};
  await discoverJiraScenario(input,browser);
  assert.deepEqual(actions,[step.slice(0,-1)]);
 }
});

test('source variants and repeated blocks use labels from distinct profiles',()=>{
 for(const subject of ['discount','commission']) {
  const block=[`Validar que se muestre "${subject}"`,'Validar que se muestre "Total"','Presionar "Continue"'];
  assert.deepEqual(jiraRepeatedAssertionBlocks([...block,...block]),[4]);
  assert.deepEqual(jiraRepeatedAssertionBlocks([...block,'Ingresar dato en "Token"',...block]),[]);
  const requirements=jiraSourceConditions({steps:block},{description:`Show ${subject} if applicable.`} as Parameters<typeof jiraSourceConditions>[1]);
  assert.equal(requirements[0].subject,subject);
  assert.deepEqual(requirements[0].stepIndices,[1]);
 }
});

test('duplicate generation proposal preserves values and reindexes later fields',()=>{
 const block=['Validar que se muestre "Total"','Validar que se muestre "Fee"','Presionar "Continue"'];
 const draft={steps:[...block,...block,'Ingresar token en "Token"'],inputRequirements:[{key:'auth.token',stepIndex:7}],unresolvedUiRequirements:[{stepIndex:4,requirement:'Duplicate'},{stepIndex:7,requirement:'Token'}]};
 const proposal=proposeJiraDuplicateRepair(draft)!;
 assert.deepEqual(proposal.steps,[...block,'Ingresar token en "Token"']);
 assert.deepEqual(proposal.inputRequirements,[{key:'auth.token',stepIndex:4}]);
 assert.deepEqual(proposal.unresolvedUiRequirements,[{stepIndex:4,requirement:'Token'}]);
 assert.equal(draft.steps.length,7);
});

test('configured Jira decisions reach Discovery and its dedicated compiler across profiles',async()=>{
 for(const appSlug of ['synthetic-a','synthetic-b']) {
  const calls:string[]=[];
  const browser:JiraBrowserPort={async navigate(){},async act(_step,target){calls.push(target);return {strategy:'role',role:'button',name:target,exact:true};},async assert(target){calls.push(target);return {observedText:target};}};
  const input={scenarioId:'HU-1:jira:1',sourceIssueKey:'HU-1',title:'Outcome',appSlug,steps:['Presionar "Unknown"','Validar que se muestre "Discount"','Validar que se muestre "Done"'],expectedResult:'Done',unresolvedUiRequirements:[{stepIndex:1,requirement:'Action label'}],conditionRequirements:[{key:'condition',subject:'Discount',sourceClause:'Discount if applicable',stepIndices:[2]}],reviewConfiguration:{uiTargets:{'1':'Enter'},conditions:{condition:false}}};
  const contract=await discoverJiraScenario(input,browser);
  assert.deepEqual(calls,['Enter','Done']);
  const spec=compileJiraSpec({plan:contract.plan,sourceScenario:contract.sourceScenario,appSlug,sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-review/case.spec.ts')});
  assert.deepEqual(spec.unsupported,[]);
  assert.match(spec.source,/Enter/);
  assert.doesNotMatch(spec.source,/Unknown|Discount/);
  await assert.rejects(discoverJiraScenario({...input,reviewConfiguration:{conditions:{condition:true}}},{...browser,async act(){throw Error('JIRA_TARGET_AMBIGUOUS');}}),/JIRA_TARGET_AMBIGUOUS/);
 }
});
