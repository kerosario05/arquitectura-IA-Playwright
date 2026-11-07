import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

/**
 * A dropdown whose own name is only its empty-state prompt ("Seleccione una opción") must carry the
 * label of its field ("Código referente") as associatedField, so three such dropdowns on one form
 * do not collapse into one field name / dataset slot.
 */
const page = `
<div class=form>
  <div id=f1><label>Código referente</label><div id=s1 role=combobox aria-label="Seleccione una opción" tabindex=0><span>Seleccione una opción</span></div></div>
  <div id=f2><label>Destino facilidad</label><div id=s2 role=combobox aria-label="Seleccione una opción" tabindex=0><span>Seleccione una opción</span></div></div>
  <div id=f3><div id=s3 role=combobox aria-label="Seleccione una opción" tabindex=0><span>Seleccione una opción</span></div></div>
  <div id=f4><label>Moneda</label><div id=s4 role=combobox aria-label="Moneda" tabindex=0><span>DOP</span></div></div>
</div>`;

async function capture(selector: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const tab = await (await browser.newContext()).newPage();
    const messages: unknown[] = [];
    await tab.exposeFunction("__qaRecordV2", (message: unknown) => { messages.push(message); });
    await tab.addInitScript(buildCaptureScriptV2Content("test-capture"));
    await tab.route("http://form.test/", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: page }));
    await tab.goto("http://form.test/");
    await tab.locator(selector).click();
    await tab.waitForTimeout(500);
    assert.ok(messages.length > 0, "capture script produced no messages");
    return JSON.stringify(messages);
  } finally {
    await browser.close();
  }
}

test("a prompt-named dropdown carries its field label as associatedField", async () => {
  assert.match(await capture("#s1"), /"associatedField":"Código referente"/);
  assert.match(await capture("#s2"), /"associatedField":"Destino facilidad"/);
});

test("a dropdown with no label never reports the prompt itself as its field", async () => {
  assert.doesNotMatch(await capture("#s3"), /"associatedField":"Seleccione una opción"/);
});

test("a dropdown with a real name keeps no nearby label as associatedField", async () => {
  assert.doesNotMatch(await capture("#s4"), /"associatedField":"Moneda"/);
});
