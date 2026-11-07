import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from '@playwright/test';
import {resolveActionTarget} from './target-resolver';
const snapshot:any={version:'1.0',url:'http://localhost/',title:'fixture',capturedAt:new Date(0).toISOString(),elements:[],summary:{totalElements:0,buttons:0,links:0,inputs:0,selects:0,tables:0,dialogs:0,headings:0}};
for(const field of ['Identificación','Cuenta'])test(`field-scoped click returns its existing certificate for ${field}`,async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent(`<main><div><label>${field}</label><input/><button data-testid="lookup" onclick="window.clicked=true">+</button></div><button>Other action</button></main>`);
    const result=await resolveActionTarget(page,snapshot,'Missing recorded button',{actionType:'action_click',recordingActionType:'click',associatedField:field,recordedTechnicalTargetRefs:['role:button']});
    assert.equal(result.status,'resolved');assert.ok(result.certifiedTechnicalTarget,'resolved owner must retain its certificate');
    await result.locator!.click();assert.equal(await page.evaluate(()=>Boolean((window as any).clicked)),true);
  }finally{await browser.close();}
});

test('an exact target never borrows the certificate of a different field owner',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent('<main><div><label>Identificación</label><input/><button data-testid="lookup" onclick="window.lookup=true">+</button></div><button id="direct" onclick="window.direct=true">Direct</button></main>');
    const result=await resolveActionTarget(page,snapshot,'Direct',{actionType:'action_click',recordingActionType:'click',associatedField:'Identificación',recordedTechnicalTargetRefs:['css:#direct']});
    assert.equal(result.status,'resolved');assert.equal(result.certifiedTechnicalTarget,undefined);
    await result.locator!.click();assert.equal(await page.evaluate(()=>Boolean((window as any).direct)),true);assert.equal(await page.evaluate(()=>Boolean((window as any).lookup)),false);
  }finally{await browser.close();}
});

test('an exact target retains the certificate only when the accepted field owner is that same node',async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent('<main><div><label>Identificación</label><input/><button id="direct" data-testid="lookup" onclick="window.direct=true">Lookup</button></div><button>Other action</button></main>');
    const result=await resolveActionTarget(page,snapshot,'Lookup',{actionType:'action_click',recordingActionType:'click',associatedField:'Identificación',recordedTechnicalTargetRefs:['css:#direct']});
    assert.equal(result.status,'resolved');assert.ok(result.certifiedTechnicalTarget);assert.equal(await result.locator!.evaluate(node=>node.id),'direct');
    await result.locator!.click();assert.equal(await page.evaluate(()=>Boolean((window as any).direct)),true);
  }finally{await browser.close();}
});
