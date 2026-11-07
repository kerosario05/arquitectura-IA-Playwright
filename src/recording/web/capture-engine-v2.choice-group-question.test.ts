import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

/**
 * Repeated yes/no choice controls share one accessible name ("No" x N), so the control's own name
 * cannot say which question was answered. The real V2 capture script must therefore transport the
 * question text that precedes the group as the control's associatedField. Named buttons must keep
 * carrying none (regression guard for the "Depurar" / "Salir" class of nearby-label leaks).
 */
const page = `
<div id=q1><span>¿Posee otras identificaciones o nacionalidades?</span>
  <div role=group><div role=radio aria-label="Sí" tabindex=0><span>Sí</span></div><div role=radio aria-label="No" tabindex=0><span>No</span></div></div></div>
<div id=q2><p>¿Es usted un Asociado Cercano de una PEP?</p>
  <div role=group><div role=radio aria-label="Sí" tabindex=0><span>Sí</span></div><div role=radio aria-label="No" tabindex=0><span>No</span></div></div></div>
<div id=q4><p>¿Declara bajo juramento que ${"la información suministrada es veraz y completa ".repeat(6)}?</p>
  <div role=group><div role=radio aria-label="Sí" tabindex=0><span>Sí</span></div><div role=radio aria-label="No" tabindex=0><span>No</span></div></div></div>
<div id=q3><span>Nombre</span><button id=go aria-label="Aceptar">Aceptar</button><button aria-label="Aceptar">Aceptar</button></div>`;

async function captureClick(selector: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const tab = await context.newPage();
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

test("a repeated yes/no radio carries the question that precedes its group", async () => {
  const q1 = await captureClick("#q1 [aria-label=No]");
  assert.match(q1, /"associatedField":"¿Posee otras identificaciones o nacionalidades\?"/);
  const q2 = await captureClick("#q2 [aria-label=No]");
  assert.match(q2, /"associatedField":"¿Es usted un Asociado Cercano de una PEP\?"/);
});

test("a click on the text inside a repeated yes/no radio keeps the choice as its name, not the group question", async () => {
  const q1 = await captureClick("#q1 [aria-label=No] span");
  assert.doesNotMatch(q1, /"promotedTitle":true/);
  assert.doesNotMatch(q1, /"accessibleName":"¿Posee otras identificaciones o nacionalidades\?"/);
  assert.match(q1, /"accessibleName":"No"/);
});

test("a question longer than the cap is kept as its leading words", async () => {
  const q4 = await captureClick("#q4 [aria-label=No]");
  assert.match(q4, /"associatedField":"¿Declara bajo juramento que la información suministrada/);
});

test("a repeated named button does not receive a nearby label as associatedField", async () => {
  const messages = await captureClick("#go");
  assert.doesNotMatch(messages, /"associatedField":"Nombre"/);
});
