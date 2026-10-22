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
