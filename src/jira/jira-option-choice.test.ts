import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { chooseJiraMatchingOption } from "./jira-option-choice";
import { createJiraPlaywrightPort, resolveJiraNativeOption, selectJiraObservedOption } from "./jira-semantic-executor";
import { performJiraSpecSelection } from "./jira-spec-runtime";

test("any matching option is stable across reordering and preserves explicit criteria", () => {
  const options = [{value:"a-1001",label:"Cuenta Corriente USD"}, {value:"b-1002",label:"Cuenta Corriente EUR"}];
  const selected = resolveJiraNativeOption(options, "Cuenta Corriente");
  assert.ok(options.includes(selected!));
  assert.deepEqual(resolveJiraNativeOption([...options].reverse(), "Cuenta Corriente"), selected);
  assert.deepEqual(resolveJiraNativeOption(options, "Cuenta Corriente USD"), options[0]);
  assert.deepEqual(resolveJiraNativeOption(options, "b-1002"), options[1]);
  assert.equal(resolveJiraNativeOption(options, "Cuenta Corriente GBP"), undefined);
  assert.equal(chooseJiraMatchingOption([], item => String(item), "anything"), undefined);
});

test('text option ranking preserves durable identity when balances change',()=>{
 const options=(balance:number)=>[{id:'account-a',key:`span:cuenta corrientes / 700000001 / rd$${balance}.00`},{id:'account-b',key:'span:cuenta corrientes / 700000002 / rd$99,555.00'}];
 const expected=chooseJiraMatchingOption(options(1000),option=>option.key,'Cuenta Corriente')?.id;
 for(const balance of [10,605,99555,827490,828095]) assert.equal(chooseJiraMatchingOption(options(balance).reverse(),option=>option.key,'Cuenta Corriente')?.id,expected);
 assert.equal(chooseJiraMatchingOption([{key:'span:Producto €10.00'},{key:'span:Producto €20.00'}],option=>option.key,'Producto'),undefined);
});

test('Discovery and spec keep the same text-only option after its balance changes', {timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const [label,currency] of [['Cuenta Corrientes','RD$'],['Producto estándar','€']]) {
   const page=await browser.newPage();
   const html=(balance:string)=>`<button id="field" aria-controls="choices" onclick="document.getElementById('choices').hidden=false">Seleccione una opción</button><div id="choices" hidden><span tabindex="0" onclick="window.picked='a';document.getElementById('field').innerText=this.innerText;this.parentElement.hidden=true">${label} / 700000001 / ${currency}${balance}</span><span tabindex="0" onclick="window.picked='b';document.getElementById('field').innerText=this.innerText;this.parentElement.hidden=true">${label} / 700000002 / ${currency}99,555.00</span></div>`;
   await page.setContent(html('828,095.77'));
   await selectJiraObservedOption(page,page.locator('#field'),label);
   const discovery=await page.evaluate(()=>Reflect.get(window,'picked'));
   await page.setContent(html('827,490.77'));
   await performJiraSpecSelection(page.locator('#field'),label);
   assert.equal(await page.evaluate(()=>Reflect.get(window,'picked')),discovery);
   await page.close();
  }
 }finally{await browser.close();}
});

test("Discovery and spec select any matching custom option in the field's popup across projects", {timeout:60000}, async () => {
  const browser = await chromium.launch({headless:true});
  try {
    for (const label of ["Cuenta Corrientes", "Producto estándar"]) {
      const page = await browser.newPage();
      const identicalLabels = label === "Producto estándar";
      const html = `<button type="button" id="field" aria-controls="choices" onclick="document.getElementById('choices').hidden=false">Seleccione una opción</button>
        <div id="choices" role="listbox" hidden>
          <button id="a" role="option" onclick="window.picked=this.id;document.getElementById('field').innerText=this.innerText;this.parentElement.hidden=true">${identicalLabels ? label : `${label} A`}</button>
          <button id="b" role="option" onclick="window.picked=this.id;document.getElementById('field').innerText=this.innerText;this.parentElement.hidden=true">${identicalLabels ? label : `${label} B`}</button>
          <button role="option" disabled>${label} unavailable</button>
        </div>
        <div role="listbox"><button role="option" onclick="window.wrongField=true">${label} unrelated</button></div>`;
      await page.setContent(html);
      await selectJiraObservedOption(page, page.locator("#field"), label);
      const chosen = await page.locator("#field").innerText();
      assert.ok((identicalLabels ? [label] : [`${label} A`, `${label} B`]).includes(chosen));
      const picked = await page.evaluate(() => Reflect.get(window,"picked"));
      assert.ok(["a", "b"].includes(picked));
      assert.equal(await page.evaluate(() => Reflect.get(window,"wrongField")), undefined);
      await page.setContent(html);
      await performJiraSpecSelection(page.locator("#field"), label);
      assert.equal(await page.locator("#field").innerText(), chosen);
      assert.equal(await page.evaluate(() => Reflect.get(window,"picked")), picked);
      assert.equal(await page.evaluate(() => Reflect.get(window,"wrongField")), undefined);
      await page.close();
    }
  } finally {await browser.close();}
});

test("native specs choose by observed value even when option labels repeat", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    const options = [{value:"one",label:"Same product"},{value:"two",label:"Same product"}];
    await page.setContent('<select id="field"><option value="blocked" disabled>Same product</option><option value="one">Same product</option><option value="two">Same product</option><option value="other">Other product</option></select>');
    const expected = resolveJiraNativeOption(options,"Same product");
    await performJiraSpecSelection(page.locator("#field"),"Same product");
    assert.equal(await page.locator("#field").inputValue(),expected?.value);
  } finally {await browser.close();}
});

test("Jira destination selection never clicks a previously selected neighboring field while its own popup loads", {timeout:60000}, async () => {
 const browser=await chromium.launch({headless:true});
 try {
  for(const label of ['Cuenta Corriente','Producto estándar']) {
   const page=await browser.newPage();
   await page.setContent(`<main><section><h2>Origen</h2><button type="button" id="origin" onclick="window.wrongField=true">${label} / 700000001</button></section>
    <section><h2>Destino</h2><button type="button" id="destination" onclick="setTimeout(()=>document.getElementById('choices').hidden=false,500)">Seleccione una opción</button></section>
    <div id="choices" hidden><span tabindex="0" id="destination-option" onclick="document.getElementById('destination').innerText=this.innerText;this.parentElement.hidden=true">${label} / 700000002</span></div></main>`);
   const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
   await port.act({index:1,action:'select',description:'Seleccionar un producto en "Destino"'},'Destino',label);
   assert.match(await page.locator('#destination').innerText(),/700000002/);
   assert.equal(await page.evaluate(()=>Reflect.get(window,'wrongField')),undefined);
   assert.match(await page.locator('#origin').innerText(),/700000001/);
   await page.close();
  }
 } finally {await browser.close();}
});
