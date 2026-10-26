import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEditedJiraScenarios,type EditableJiraScenario} from './jira-scenario-edit';
import {deriveJiraInputRequirements} from './jira-input-requirements';
import type {JiraIssueSource} from '../scenarios/scenario-types';
import {buildAutomationId} from '../automations/automation-naming';
const issue:JiraIssueSource={key:'HU-7',summary:'Consulta',description:'',acceptanceCriteria:'AC1 — Consulta\nMostrar el resultado.',labels:[],components:[],status:'',issueType:'Story'};
const original:EditableJiraScenario={scenarioId:'HU-7:jira:1',sourceIssueKey:issue.key,title:'Consulta',steps:['Abrir la aplicación configurada del proyecto','Ingresar usuario en "Usuario"','Validar que se muestre "Resultado"'],expectedResult:'Resultado',acceptanceCriteriaRefs:['AC1.1']};
original.inputRequirements=deriveJiraInputRequirements(original.steps);
test('Jira edited steps receive a revision and uniquely unchanged fields retain keys after insertion',async()=>{
 const patch={title:original.title,steps:[original.steps[0],'Presionar "Consulta"',...original.steps.slice(1)],expectedResult:original.expectedResult};
 const [edited]=await reviewEditedJiraScenarios(issue,[original],original.scenarioId,patch);
 assert.equal(edited.validation.valid,true,JSON.stringify(edited.validation.errors));
 assert.match(edited.scenarioId,/^HU-7:jira:1:edited-[a-f0-9]+$/);
 assert.notEqual(buildAutomationId({externalId:edited.scenarioId,title:edited.title}),buildAutomationId({externalId:original.scenarioId,title:original.title}));
 assert.equal(edited.inputRequirements[0].key,original.inputRequirements![0].key);
 assert.equal(edited.inputRequirements[0].stepIndex,3);
 assert.deepEqual(edited.steps,patch.steps);
 const [again]=await reviewEditedJiraScenarios(issue,[edited],edited.scenarioId,patch);
 assert.equal(again.scenarioId,edited.scenarioId);
 assert.equal(original.steps.length,3);
});
test('full_authentication is dropped on review only when the project has no AuthFlow; step wording never decides',async()=>{
 const withIntent:EditableJiraScenario={...original,authIntent:'full_authentication'};
 const same={title:withIntent.title,steps:withIntent.steps,expectedResult:withIntent.expectedResult};
 const [noFlow]=await reviewEditedJiraScenarios(issue,[withIntent],withIntent.scenarioId,same,undefined,false);
 assert.equal(noFlow.authIntent,undefined);
 const [hasFlow]=await reviewEditedJiraScenarios(issue,[withIntent],withIntent.scenarioId,same,undefined,true);
 assert.equal(hasFlow.authIntent,'full_authentication');
 const [unknown]=await reviewEditedJiraScenarios(issue,[withIntent],withIntent.scenarioId,{...same,steps:[...same.steps,'Presionar "Consulta"']});
 assert.equal(unknown.authIntent,'full_authentication');
});
test('renaming a field never reuses a value key from the old step position',async()=>{
 const [edited]=await reviewEditedJiraScenarios(issue,[original],original.scenarioId,{...original,steps:[original.steps[0],'Ingresar identificación en "Documento"',original.steps[2]]});
 assert.notEqual(edited.inputRequirements[0].key,original.inputRequirements![0].key);
 assert.equal(edited.inputRequirements[0].label,'Documento');
 assert.equal(edited.reviewConfiguration?.uiTargets,undefined);
});

test('conditional diagnostics follow the edited step position in the response',async()=>{
 const source={...issue,description:'El resumen muestra el monto, la comisión cuando aplique.'};
 const patch={title:original.title,steps:[original.steps[0],'Presionar "Consultar"','Validar que se muestre "Comisión" en otra pantalla.','Validar que se muestre "Resultado"'],expectedResult:original.expectedResult};
 const [edited]=await reviewEditedJiraScenarios(source,[original],original.scenarioId,patch);
 assert.ok(edited.validation.issues.some(item=>item.code==='JIRA_CONDITION_STEP_UNSUPPORTED' && item.stepIndex===3 && item.step===patch.steps[2]));
 assert.equal(edited.validation.valid,true);
});
test('unsupported manual steps and coverage gaps keep an edit pending Discovery without rejecting it',async()=>{
 const [edited]=await reviewEditedJiraScenarios(issue,[original],original.scenarioId,{...original,steps:['Hacer todo automáticamente']});
 assert.equal(edited.validation.valid,true);
 assert.ok(edited.validation.warnings.some(warning=>warning.includes('Discovery')));
 assert.equal(edited.executionReadiness,'requires_discovery');
 assert.equal(edited.mcpExecutable,false);
});
test('manual review rejects foreign issue ownership and empty steps',async()=>{
 await assert.rejects(reviewEditedJiraScenarios(issue,[{...original,sourceIssueKey:'OTHER-1'}],original.scenarioId,original),/OWNERSHIP/);
 await assert.rejects(reviewEditedJiraScenarios(issue,[original],original.scenarioId,{...original,steps:['']}),/CONTENT_INVALID/);
 await assert.rejects(reviewEditedJiraScenarios(issue,[{...original,steps:null} as any],original.scenarioId,original),/OWNERSHIP_INVALID/);
});
