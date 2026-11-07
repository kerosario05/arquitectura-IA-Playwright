import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveFillTarget } from "./target-resolver";

test("fill resolver binds a generic caption to its following field wrapper inside a broad multi-input form", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent(`<form id="form">
      <div><span>Amount</span></div><div><input id="amount" type="text"></div>
      <div><span>Fee</span></div><div><input id="fee" type="text"></div>
      <div><span>Tax</span></div><div><input id="tax" type="text"></div>
    </form>`);
    const result = await resolveFillTarget(page,{elements:[]} as any,"Amount",undefined,{associatedField:"Amount"});
    assert.equal(result.status,"resolved",JSON.stringify(result));
    assert.ok(result.locator);
    await result.locator.fill("42");
    assert.equal(await page.locator("#amount").inputValue(),"42");
    assert.equal(await page.locator("#fee").inputValue(),"");
    assert.equal(await page.locator("#tax").inputValue(),"");
  } finally { await browser.close(); }
});

test("fill resolver accepts a repeated heading and caption only when they identify the same editor", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    for (const field of ["Monto", "Delivery date"]) {
      await page.setContent(`<form id="form">
        <div><span>${field}</span></div>
        <div><span>${field}</span><div><input id="editor" type="text"></div></div>
        <div><span>Other</span><input id="other" type="text"></div>
      </form>`);
      const result = await resolveFillTarget(page,{elements:[]} as any,field,undefined,{associatedField:field});
      assert.equal(result.status,"resolved",JSON.stringify(result));
      assert.ok(result.locator);
      await result.locator.fill("42");
      assert.equal(await page.locator("#editor").inputValue(),"42");
      assert.equal(await page.locator("#other").inputValue(),"");
    }
  } finally { await browser.close(); }
});

test("fill resolver rejects identical captions attached to different editable controls", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent(`<form id="form">
      <div><span>Amount</span><input id="first" type="text"></div>
      <div><span>Amount</span><input id="second" type="text"></div>
    </form>`);
    const result = await resolveFillTarget(page,{elements:[]} as any,"Amount",undefined,{associatedField:"Amount"});
    assert.notEqual(result.status,"resolved");
    assert.equal(result.locator,undefined);
    assert.equal(await page.locator("#first").inputValue(),"");
    assert.equal(await page.locator("#second").inputValue(),"");
  } finally { await browser.close(); }
});

test("fill resolver scopes a stale recorded relation to the unique visible dialog", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent(`<form id="background-form">
      <div><span>Contacto</span></div><div><input id="background-contact" type="text"></div>
    </form>
    <div role="dialog" id="contact-dialog">
      <div><span>Contacto</span></div><div><input id="dialog-contact" type="text"></div>
    </div>`);
    const result = await resolveFillTarget(page,{elements:[]} as any,"Contacto",{
      type:"form", reason:"form_opened", containerLocator:page.locator("body"),
    },{
      associatedField:"Contacto",
      recordedTechnicalTargetRefs:["css:#stale-capture-target"],
    });
    assert.equal(result.status,"resolved",JSON.stringify(result));
    assert.ok(result.locator);
    await result.locator.fill("5551234");
    assert.equal(await page.locator("#dialog-contact").inputValue(),"5551234");
    assert.equal(await page.locator("#background-contact").inputValue(),"");
  } finally { await browser.close(); }
});

test("fill resolver uses one observed editable snapshot owner inside the unique dialog", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent(`<div role="dialog" id="contact-dialog">
      <label for="type">Tipo</label><select id="type"><option>Celular</option></select>
      <span>Contacto</span><input id="contact" placeholder="809-000-0000" type="text">
      <label for="location">Ubicación</label><input id="location" type="text">
    </div>`);
    const snapshot = {elements:[{
      id:"contact-input",tagName:"input",type:"text",visible:true,nearbyText:"Contacto",
      candidateLocators:[{strategy:"placeholder",value:"809-000-0000",exact:false,confidence:0.8}],
    }]} as any;
    const result = await resolveFillTarget(page,snapshot,"Contacto",undefined,{
      associatedField:"Contacto",recordedTechnicalTargetRefs:["css:#stale-capture-target"],
    });
    assert.equal(result.status,"resolved",JSON.stringify(result));
    assert.equal(result.locatorStrategy,"snapshot_nearby_field_owner_in_unique_dialog");
    assert.ok(result.locator);
    await result.locator.fill("5551234");
    assert.equal(await page.locator("#contact").inputValue(),"5551234");
    assert.equal(await page.locator("#location").inputValue(),"");
  } finally { await browser.close(); }
});

test("fill resolver fails closed when snapshot has duplicate exact nearby-field owners", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent(`<div role="dialog" id="contact-dialog">
      <span>Contacto</span><input id="contact-a" placeholder="Phone A" type="text">
      <span>Contacto</span><input id="contact-b" placeholder="Phone B" type="text">
    </div>`);
    const snapshot = {elements:["a","b"].map((id)=>({
      id,tagName:"input",type:"text",visible:true,nearbyText:"Contacto",
      candidateLocators:[{strategy:"placeholder",value:id === "a" ? "Phone A" : "Phone B",exact:true,confidence:0.8}],
    }))} as any;
    const result = await resolveFillTarget(page,snapshot,"Contacto",undefined,{
      associatedField:"Contacto",recordedTechnicalTargetRefs:["css:#stale-capture-target"],
    });
    assert.notEqual(result.status,"resolved");
    assert.equal(result.locator,undefined);
    assert.equal(await page.locator("#contact-a").inputValue(),"");
    assert.equal(await page.locator("#contact-b").inputValue(),"");
  } finally { await browser.close(); }
});

test("fill resolver re-proves the recorded field relation after its captured locator goes stale", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent(`<form><div><span>Contacto</span></div><div><input id="contact" placeholder="809-000-0000"></div></form>`);
    const result = await resolveFillTarget(page,{elements:[]} as any,"Contacto",undefined,{
      associatedField:"Contacto",
      recordedTechnicalTargetRefs:["css:#stale-capture-target"],
    });
    assert.equal(result.status,"resolved",JSON.stringify(result));
    assert.ok(result.locator);
    await result.locator.fill("5551234");
    assert.equal(await page.locator("#contact").inputValue(),"5551234");
  } finally { await browser.close(); }
});
