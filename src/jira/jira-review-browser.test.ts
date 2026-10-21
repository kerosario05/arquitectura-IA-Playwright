import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createJiraPlaywrightPort,discoverJiraScenario} from './jira-semantic-executor';
import {compileJiraSpec} from './jira-spec-compiler';
import path from 'node:path';

test('Jira reviewed targets are certified against two isolated browser fixtures',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  for(const [appSlug,buttonLabel,resultLabel] of [['fixture-a','Enter','Completed'],['fixture-b','Confirm','Accepted']]) {
   const context=await browser.newContext();
   try {
    const page=await context.newPage();
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<html><body><button id="action" onclick="document.getElementById('result').hidden=false">${buttonLabel}</button><p id="result" hidden>${resultLabel}</p></body></html>`}));
    const progress:Array<[number,string]>=[];
    const result=await discoverJiraScenario({scenarioId:'HU-2:jira:1',sourceIssueKey:'HU-2',title:'Synthetic result',appSlug,
      steps:['Abrir la aplicación configurada del proyecto.','Presionar "Unknown action"','Validar que se muestre "Optional detail"','Validar que se muestre "Unknown result"'],expectedResult:resultLabel,
      unresolvedUiRequirements:[{stepIndex:2,requirement:'Action label'},{stepIndex:3,requirement:'Conditional detail'},{stepIndex:4,requirement:'Result text'}],
      conditionRequirements:[{key:'detail',subject:'Optional detail',sourceClause:'Detail if applicable',stepIndices:[3]}],
      reviewConfiguration:{conditions:{detail:false},uiTargets:{'2':buttonLabel,'4':resultLabel}}},createJiraPlaywrightPort(page,'http://qa-fixture.test/'),{},(index,phase)=>{progress.push([index,phase]);});
    const click=result.plan.steps.find(step=>step.action==='click');
    assert.deepEqual(click?.target,{strategy:'css',value:'[id="action"]'});
    assert.ok(progress.some(([index,phase])=>index===3 && phase==='not_applicable'));
    assert.ok(result.sourceScenario.observableOracles?.some(oracle=>oracle.backed && oracle.target===resultLabel));
    const compiled=compileJiraSpec({plan:result.plan,sourceScenario:result.sourceScenario,appSlug,sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-browser-fixture/case.spec.ts')});
    assert.deepEqual(compiled.unsupported,[]);
    assert.doesNotMatch(compiled.source,/Unknown|Optional detail/);
   } finally {await context.close();}
  }
 } finally {await browser.close();}
});
