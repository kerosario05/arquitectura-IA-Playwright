import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createJiraPlaywrightPort,discoverJiraScenario} from './jira-semantic-executor';
import {compileJiraSpec} from './jira-spec-compiler';
import path from 'node:path';

test('field identity survives DOM insertion between observed-label resolution and action across profiles',async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    for(const [profile,label,type,placeholder] of [['access','Contraseña','password','Ingrese su contraseña'],['inventory','Referencia','text','Ingrese referencia']]){
      const page=await browser.newPage();
      await page.setContent(`<main><div><label>Usuario</label><input name="user" value="unchanged"></div><div><label>${label}</label><input type="${type}" placeholder="${placeholder}"></div></main>`);
      const original=page.locator.bind(page);
      let changed=false;
      // Deterministically inject the same DOM shift that an SPA render can cause
      // immediately after the field snapshot, before certification and fill.
      page.locator=((selector:string,options?:Parameters<typeof page.locator>[1])=>{
        const locator=original(selector,options);
        if(selector!=='body *')return locator;
        return new Proxy(locator,{get(target,property){
          if(property==='evaluateAll')return async(...args:unknown[])=>{
            const result=await Reflect.apply(target.evaluateAll,target,args);
            if(!changed&&result?.tag==='input'&&result?.labelText===label){
              changed=true;
              await page.evaluate(()=>document.body.prepend(document.createElement('aside')));
            }
            return result;
          };
          const value=Reflect.get(target,property);
          return typeof value==='function'?value.bind(target):value;
        }});
      }) as typeof page.locator;
      const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
      const scenario={scenarioId:`${profile}:1`,sourceIssueKey:'IDENTITY-1',title:'Stable input',steps:[`Ingresar dato en "${label}"`,'Validar que se muestre "Completado"'],expectedResult:'Completado'};
      await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<h1>Completado</h1>'));
      const discovered=await discoverJiraScenario(scenario,{...port,async navigate(){}},{jira_step_1:'synthetic-value'});
      assert.equal(changed,true);
      assert.equal(await page.getByPlaceholder(placeholder).inputValue(),'synthetic-value');
      assert.equal(await page.locator('[name="user"]').inputValue(),'unchanged');
      assert.deepEqual(compileJiraSpec({plan:discovered.plan,sourceScenario:discovered.sourceScenario,appSlug:profile,sectionSlug:'jira',automationId:'identity-fixture',specPath:path.resolve('.artifacts/tmp/identity-fixture/case.spec.ts')}).unsupported,[]);
      await page.close();
    }
  } finally {await browser.close();}
});
