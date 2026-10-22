import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget } from "./target-resolver";
import { applyPromotedNativeSelection } from "../automations/runtime/promoted-spec-runtime";

test("Discovery and promoted native selects share category choice and explicit override", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    for (const field of ["Funding Source", "Delivery Method"]) {
      await page.setContent(`<label for="native">${field}</label><select id="native"><option disabled value="bad">Standard / 100000</option><option value="b">Standard / 100002</option><option value="a">Standard / 100001</option></select>`);
      const result = await resolveActionTarget(page, {elements:[]} as any, field, {actionType:"action_select",selectionValue:"Standard"});
      assert.equal(result.selectionApplied, true);
      assert.equal(await page.locator('#native').inputValue(), 'a');
      assert.equal(await applyPromotedNativeSelection(page.locator('#native'), '100002'), true);
      assert.equal(await page.locator('#native').inputValue(), 'b');
      assert.equal(await applyPromotedNativeSelection(page.locator('#native'), '999999'), false);
      assert.equal(await page.locator('#native').inputValue(), 'b');
    }
  } finally { await browser.close(); }
});

test("native multi-select verifies the requested set and excludes disabled optgroups", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<select multiple><option value="a">Red</option><option value="b">Blue</option><optgroup disabled><option value="c">Green</option></optgroup></select>');
    assert.equal(await applyPromotedNativeSelection(page.locator('select'), ['Red', 'Blue']), true);
    assert.deepEqual(await page.locator('option:checked').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)), ['a','b']);
    assert.equal(await applyPromotedNativeSelection(page.locator('select'), ['Green']), false);
  } finally { await browser.close(); }
});

for (const variant of ['aria', 'search', 'virtual'] as const) {
  test(`${variant} list uses the same policy and verifies owner readback`, async () => {
    const browser = await chromium.launch({headless:true});
    try {
      const page = await browser.newPage();
      await page.setContent(`<button role="combobox" aria-label="Method" aria-controls="choices" aria-expanded="false" onclick="document.querySelector('#choices').hidden=false;this.setAttribute('aria-expanded','true')">Choose</button>
        <div role="listbox" id="choices" hidden style="height:80px;overflow-y:auto">
        ${variant === 'search' ? '<input type="search" aria-label="Find"><div id="items"></div>' : `<div id="items"><div role="option" data-value="first">${variant === 'virtual' ? 'Initial / 100001' : 'Standard / 700002'}</div>${variant === 'aria' ? '<div role="option" data-value="second">Standard / 700001</div>' : ''}</div>`}
        ${variant === 'virtual' ? '<div style="height:800px"></div>' : ''}</div>
        <script>
          document.querySelector('#choices').onclick = event => { const option=event.target.closest('[role="option"]'); if(!option)return; const owner=document.querySelector('[role="combobox"]'); owner.textContent=option.textContent;owner.setAttribute('aria-expanded','false');document.querySelector('#choices').hidden=true; };
          ${variant === 'search' ? `document.querySelector('input').oninput=()=>setTimeout(()=>document.querySelector('#items').innerHTML='<div role="option" data-value="chosen">Requested / 700002</div>',40);` : ''}
          ${variant === 'virtual' ? `document.querySelector('#choices').onscroll=()=>document.querySelector('#items').innerHTML='<div role="option" data-value="chosen">Requested / 700002</div>';` : ''}
        </script>`);
      const result = await resolveActionTarget(page, {elements:[]} as any, 'Method', {actionType:'action_select',selectionValue:variant === 'aria' ? 'Standard' : '700002'});
      assert.equal(result.selectionApplied, true, JSON.stringify({status:result.status, diagnostics:result.selectionDiagnostics}));
      assert.match(await page.getByRole('combobox').innerText(), variant === 'aria' ? /700001/ : /700002/);
    } finally {await browser.close();}
  });
}

test("ARIA multi-select retains previous choices and repeating an explicit choice does not unselect it", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent(`<button role="combobox" aria-label="Colors" aria-controls="colors" onclick="document.querySelector('#colors').hidden=false">Colors</button><div role="listbox" id="colors" aria-multiselectable="true" hidden><div role="option" aria-selected="false" onclick="this.setAttribute('aria-selected',this.getAttribute('aria-selected')==='true'?'false':'true')">Red</div><div role="option" aria-selected="false" onclick="this.setAttribute('aria-selected',this.getAttribute('aria-selected')==='true'?'false':'true')">Blue</div></div>`);
    for (const value of ['Red','Blue','Red']) {
      const result = await resolveActionTarget(page, {elements:[]} as any, 'Colors', {actionType:'action_select',selectionValue:value});
      assert.equal(result.selectionApplied, true, JSON.stringify(result.selectionDiagnostics));
    }
    assert.equal(await page.locator('[role="option"][aria-selected="true"]').count(),2);
  } finally {await browser.close();}
});

test("regular plural category passes native, promoted and ARIA adapter readback", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<label for="s">Method</label><select id="s"><option value="">Choose</option><option value="a">Delivery Method / 700001</option></select>');
    const native = await resolveActionTarget(page,{elements:[]} as any,'Method',{actionType:'action_select',selectionValue:'Delivery Methods'});
    assert.equal(native.selectionApplied,true,JSON.stringify(native.selectionDiagnostics));
    await page.locator('select').selectOption('');
    assert.equal(await applyPromotedNativeSelection(page.locator('select'),'Delivery Methods'),true);
    await page.setContent(`<button role="combobox" aria-label="Method" aria-controls="options" onclick="document.querySelector('#options').hidden=false">Choose</button><div role="listbox" id="options" hidden><div role="option" onclick="document.querySelector('button').textContent=this.textContent;this.parentElement.hidden=true">Delivery Method / 700001</div></div>`);
    const aria = await resolveActionTarget(page,{elements:[]} as any,'Method',{actionType:'action_select',selectionValue:'Delivery Methods'});
    assert.equal(aria.selectionApplied,true,JSON.stringify(aria.selectionDiagnostics));
  } finally {await browser.close();}
});

test("significant words use one policy through native, promoted, ARIA and custom selectors", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    for (const [field,label,requests] of [
      ['Funding Source','Cuenta de Ahorro / 300001',['ahorros','cuenta de ahorros','cuenta ahorros']],
      ['Delivery Method','Método de entrega / 700001',['metodos entrega','entrega de metodos']]
    ] as const) {
      for (const request of requests) {
        await page.setContent(`<label for="native">${field}</label><select id="native"><option value="">Choose</option><option value="a">${label}</option></select>`);
        const native = await resolveActionTarget(page,{elements:[]} as any,field,{actionType:'action_select',selectionValue:request});
        assert.equal(native.selectionApplied,true,`${request}: native`);
        await page.locator('select').selectOption('');
        assert.equal(await applyPromotedNativeSelection(page.locator('select'),request),true,`${request}: promoted`);
        for (const aria of [false,true]) {
          await page.setContent(aria
            ? `<button role="combobox" aria-label="${field}" aria-controls="choices" onclick="document.querySelector('#choices').hidden=false">Choose</button><div role="listbox" id="choices" hidden><div role="option" onclick="document.querySelector('button').textContent=this.textContent;this.parentElement.hidden=true">${label}</div></div>`
            : `<main><span>${field}</span><div tabindex="0" id="owner" onclick="document.querySelector('aside').hidden=false">Choose an option</div></main><aside hidden><div onclick="document.querySelector('#owner').textContent=this.textContent;this.parentElement.hidden=true">${label}</div></aside>`);
          const result = await resolveActionTarget(page,{elements:[]} as any,field,{actionType:'action_select',selectionValue:request});
          assert.equal(result.selectionApplied,true,`${request}: ${aria?'ARIA':'custom'} ${JSON.stringify(result.selectionDiagnostics)}`);
          assert.equal(await page.locator(aria?'button':'#owner').innerText(),label);
        }
      }
    }
  } finally {await browser.close();}
});
