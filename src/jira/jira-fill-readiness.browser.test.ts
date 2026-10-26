import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createJiraPlaywrightPort } from './jira-semantic-executor';
import { __setJiraDomTargetResolverForTesting } from './jira-dom-target-ai';

test('Jira waits for the requested field after client-side loading across unrelated profiles',async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    for(const [origin,label] of [['https://fixture-access.test','Usuario'],['https://fixture-orders.test','Referencia']]){
      const page=await browser.newPage();
      await page.route(`${origin}/**`,route=>route.fulfill({contentType:'text/html',body:'<div role="progressbar">Preparing application</div>'}));
      const port=createJiraPlaywrightPort(page,origin);
      await port.navigate();
      // The fixture app hydrates after a client-side task, without an HTTP
      // request for network settlement to await. The action must observe it.
      await page.evaluate(name=>{
        window.setTimeout(()=>{document.body.innerHTML=`<label>${name}<input id="ready-field"></label>`;},1500);
      },label);
      let finished=false;
      const action=port.act({index:1,action:'fill'},label,'synthetic-input').then(result=>{finished=true;return result;});
      // The test awaits the field/action signal; it does not sleep to let the
      // application catch up before invoking the action.
      assert.equal(await page.getByRole('progressbar').count(),1);
      assert.equal(finished,false);
      await action;
      assert.equal(await page.locator('#ready-field').inputValue(),'synthetic-input');
      await page.close();
    }
  } finally {await browser.close();}
});

test('loading wait does not fill an unrelated visible control while the requested field is absent',async()=>{
  __setJiraDomTargetResolverForTesting(async()=>undefined);
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.route('https://fixture-ambiguous.test/**',route=>route.fulfill({contentType:'text/html',body:'<label>Otro dato<input id="other"></label><div role="progressbar">Preparing</div>'}));
    const port=createJiraPlaywrightPort(page,'https://fixture-ambiguous.test');
    await port.navigate();
    await page.evaluate(()=>{window.setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<label>Referencia<input id="requested"></label>');},1500);});
    await port.act({index:1,action:'fill'},'Referencia','synthetic-input');
    assert.equal(await page.locator('#other').inputValue(),'');
    assert.equal(await page.locator('#requested').inputValue(),'synthetic-input');
    await page.close();
  } finally {__setJiraDomTargetResolverForTesting(undefined);await browser.close();}
});
