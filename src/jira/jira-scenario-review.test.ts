import test from 'node:test';
import assert from 'node:assert/strict';
import {isJiraStepAutoResolvable,prepareJiraScenarioReview,jiraRepeatedAssertionBlocks,proposeJiraDuplicateRepair} from './jira-scenario-review';
import {jiraSourceConditions,repairMissingJiraConditionalAssertions} from './jira-generation-contract';
import {discoverJiraScenario,type JiraBrowserPort} from './jira-semantic-executor';
import {compileJiraSpec} from './jira-spec-compiler';
import {auditGeneratedJiraSyntax} from './jira-scenario-generator';
import type {JiraIssueSource} from '../scenarios/scenario-types';
import path from 'node:path';

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

test('test variant decisions stay scoped and never skip clicks or unknown outcomes',()=>{
 const input={steps:['Validar que se muestre "Discount"','Presionar "Continue"'],conditionRequirements:[{key:'rule',subject:'Discount',sourceClause:'Discount if applicable',stepIndices:[1]}]};
 assert.deepEqual(prepareJiraScenarioReview(input).errors,[]);
 assert.deepEqual(prepareJiraScenarioReview(input).skippedAssertionSteps,[]);
 assert.deepEqual(prepareJiraScenarioReview({...input,reviewConfiguration:{conditions:{rule:false}}}).skippedAssertionSteps,[1]);
 assert.deepEqual(prepareJiraScenarioReview({...input,conditionRequirements:[{...input.conditionRequirements[0],stepIndices:[2]}],reviewConfiguration:{conditions:{rule:false}}}).errors,['JIRA_CONDITION_STEP_UNSUPPORTED']);
 assert.deepEqual(prepareJiraScenarioReview({...input,conditionRequirements:[{...input.conditionRequirements[0],stepIndices:[]}],reviewConfiguration:{conditions:{rule:true}}}).errors,['JIRA_CONDITION_ASSERTION_MISSING']);
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
