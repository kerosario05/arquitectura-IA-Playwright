import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import type { PageSnapshot } from "../types/page-snapshot.types";
import { buildJiraDomTargetCandidates, chooseJiraDomTarget, __setJiraDomTargetResolverForTesting } from "./jira-dom-target-ai";
import { createJiraPlaywrightPort, selectJiraObservedOption } from "./jira-semantic-executor";

test("DOM candidate catalog keeps only visible durable actions and redacts values", () => {
  const snapshot: PageSnapshot = {
    version: "1.0", url: "https://example.test", title: "fixture", capturedAt: "now", elements: [
      { id: "1", type: "button", role: "button", text: "Cuenta corriente 001234567890", visible: true, actionOwner: true, candidateLocators: [{ strategy: "role", role: "button", name: "Cuenta corriente 001234567890", exact: true, confidence: 1 }], dataHints: [] },
      { id: "2", type: "button", text: "Hidden", visible: false, actionOwner: true, candidateLocators: [{ strategy: "text", value: "Hidden", exact: true, confidence: 1 }], dataHints: [] },
      { id: "3", type: "button", text: "No authority", visible: true, actionOwner: false, candidateLocators: [{ strategy: "text", value: "No authority", exact: true, confidence: 1 }], dataHints: [] },
    ], summary: { totalElements: 3, buttons: 3, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
  };
  const candidates = buildJiraDomTargetCandidates(snapshot);
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].label, /Cuenta corriente/);
  assert.doesNotMatch(candidates[0].label, /001234567890/);
  assert.equal(candidates[0].locator.name, "Cuenta corriente 001234567890", "local locator stays exact but is never sent to provider");
});

test("AI target choice is bounded to observed candidates and requires confidence", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let calls = 0;
    __setJiraDomTargetResolverForTesting(async (_intent, candidates) => { calls += 1; return { candidateId: candidates[0].id, confidence: 0.9 }; });
    const snapshot: PageSnapshot = {
      version: "1.0", url: "https://example.test", title: "fixture", capturedAt: "now", elements: [
        { id: "1", type: "button", role: "button", text: "Cuenta de ahorros", visible: true, actionOwner: true, candidateLocators: [{ strategy: "role", role: "button", name: "Cuenta de ahorros", exact: true, confidence: 1 }], dataHints: [] },
      ], summary: { totalElements: 1, buttons: 1, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    };
    const candidate = await chooseJiraDomTarget(page, "Cuenta de ahorro personales", snapshot);
    assert.equal(candidate?.label, "Cuenta de ahorros");
    assert.equal((await chooseJiraDomTarget(page, "Cuenta de ahorro personales", snapshot))?.id, candidate?.id);
    assert.equal(calls, 1, "same-page decision is cached");
    __setJiraDomTargetResolverForTesting(async () => ({ candidateId: "invented", confidence: 1 }));
    const secondPage = await browser.newPage();
    assert.equal(await chooseJiraDomTarget(secondPage, "invented control", snapshot), undefined);
    __setJiraDomTargetResolverForTesting(async () => ({ candidateId: "observed", confidence: 0.5 }));
    const thirdPage = await browser.newPage();
    assert.equal(await chooseJiraDomTarget(thirdPage, "low confidence", snapshot), undefined);
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("one page supports many distinct AI assists and caches repeats", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let calls = 0;
    __setJiraDomTargetResolverForTesting(async (_intent, candidates) => { calls += 1; return { candidateId: candidates[0].id, confidence: 0.9 }; });
    const snapshot: PageSnapshot = {
      version: "1.0", url: "https://example.test", title: "fixture", capturedAt: "now", elements: [
        { id: "1", type: "button", role: "button", text: "Campo", visible: true, actionOwner: true, candidateLocators: [{ strategy: "role", role: "button", name: "Campo", exact: true, confidence: 1 }], dataHints: [] },
      ], summary: { totalElements: 1, buttons: 1, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    };
    for (let round = 0; round < 2; round += 1) {
      for (let i = 1; i <= 8; i += 1) assert.equal((await chooseJiraDomTarget(page, `intent ${i}`, snapshot))?.label, "Campo");
    }
    assert.equal(calls, 8, "8 distinct intents each assisted once; repeats hit cache");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira spec runtime can recover a semantic mismatch only through an observed unique action", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main><button aria-label='Cuenta de ahorros'>Cuenta de ahorros</button></main>");
    __setJiraDomTargetResolverForTesting(async (_intent, candidates) => ({ candidateId: candidates[0].id, confidence: 0.9 }));
    const { resolveJiraSpecTarget } = await import("./jira-spec-runtime");
    const locator = await resolveJiraSpecTarget(page, { strategy: "text", value: "Cuenta de ahorro personales", exact: true }, 50);
    assert.equal(await locator.getAttribute("aria-label"), "Cuenta de ahorros");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira list selection can reconcile a semantic value against observed options", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><button type="button" id="account" role="combobox" aria-label="Cuenta de destino">Seleccione una Cuenta</button></main>
      <script>document.querySelector('#account').addEventListener('click',()=>{document.querySelector('main').insertAdjacentHTML('beforeend','<div role="listbox"><div role="option" tabindex="0">Cuenta de ahorros</div></div>');document.querySelector('[role=option]').addEventListener('click',()=>{document.querySelector('#account').innerText='Cuenta de ahorros';document.querySelector('[role=listbox]').remove()})});</script>`);
    __setJiraDomTargetResolverForTesting(async (intent, candidates) => {
      assert.equal(intent, "Cuenta de ahorro personales");
      const option = candidates.find(candidate => /Cuenta de ahorros/.test(candidate.label));
      return option ? { candidateId: option.id, confidence: 0.95 } : undefined;
    });
    const field = page.getByRole("combobox", { name: "Cuenta de destino" });
    await selectJiraObservedOption(page, field, "Cuenta de ahorro personales");
    assert.match(await field.innerText(), /Cuenta de ahorros/);
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

type Els = PageSnapshot["elements"];
const textbox = (id: string, name: string): Els[number] => ({ id, type: "input", role: "textbox", tagName: "input", inputType: "text", ariaLabel: name, visible: true, actionOwner: true, candidateLocators: [{ strategy: "role", role: "textbox", name, exact: true, confidence: 1 }], dataHints: [] });
const smsButton: Els[number] = { id: "b", type: "button", role: "button", tagName: "button", text: "Solicitar código por SMS", visible: true, actionOwner: true, candidateLocators: [{ strategy: "role", role: "button", name: "Solicitar código por SMS", exact: true, confidence: 1 }], dataHints: [] };
const fixture = (elements: Els): PageSnapshot => ({ version: "1.0", url: "https://example.test", title: "fixture", capturedAt: "now", elements,
  summary: { totalElements: elements.length, buttons: 1, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 } });

test("fill choice offers only observed editable controls, never the SMS request button", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const seen: string[][] = [];
    __setJiraDomTargetResolverForTesting(async (_intent, candidates) => { seen.push(candidates.map(c => c.label)); return { candidateId: candidates[0].id, confidence: 0.9 }; });
    const chosen = await chooseJiraDomTarget(await browser.newPage(), "Código SMS", fixture([smsButton, textbox("i", "Código de acceso")]), "editable");
    assert.equal(chosen?.label, "Código de acceso");
    assert.deepEqual(seen, [["Código de acceso"]]);
    // Button-only page: nothing editable observed, provider is never asked.
    seen.length = 0;
    assert.equal(await chooseJiraDomTarget(await browser.newPage(), "Código SMS", fixture([smsButton]), "editable"), undefined);
    assert.deepEqual(seen, []);
    // Ambiguity: two textboxes, provider abstains, fail closed.
    __setJiraDomTargetResolverForTesting(async () => undefined);
    assert.equal(await chooseJiraDomTarget(await browser.newPage(), "Código SMS",
      fixture([smsButton, textbox("i", "Código de acceso"), textbox("j", "Código de verificación")]), "editable"), undefined);
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test('Jira explicit login continuation admits observed sign-in controls while generic continuation stays closed',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const [target,label] of [['continuar inicio de sesión','Iniciar sesión'],['continue sign in','Sign in']]) {
   const page=await browser.newPage();
   await page.setContent(`<main><label>Usuario<input></label><label>Contraseña<input type="password"></label><button onclick="window.signedIn=true">${label}</button><button onclick="window.wrong=true">Regístrate</button><button onclick="window.wrong=true">Cerrar sesión</button></main>`);
   __setJiraDomTargetResolverForTesting(async(_intent,candidates)=>{
    assert.ok(candidates.every(candidate=>candidate.label===label));
    return candidates.length===1?{candidateId:candidates[0].id,confidence:1}:undefined;
   });
   const port=createJiraPlaywrightPort(page,'https://example.test');
   await assert.rejects(port.act({index:1,action:'click',description:'Continuar'},'Continuar'));
   await port.act({index:1,action:'click',description:target},target);
   assert.equal(await page.evaluate(()=>(window as any).signedIn),true);
   assert.equal(await page.evaluate(()=>(window as any).wrong),undefined);
   await page.close();
  }
 }finally{__setJiraDomTargetResolverForTesting(undefined);await browser.close();}
});

test('Jira continue intent cannot click logout or unrelated authorization navigation',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<main><h1>Resumen</h1><button onclick="window.wrong=true">Cerrar Sesión</button><button onclick="window.wrong=true">Autorizaciones a Terceros</button></main>');
  __setJiraDomTargetResolverForTesting(async(_intent,candidates)=>candidates.length?{candidateId:candidates[0].id,confidence:1}:undefined);
  const port=createJiraPlaywrightPort(page,'https://example.test');
  await assert.rejects(port.act({index:1,action:'click',target:{strategy:'text',value:'continuar el inicio de sesión'},description:'Continuar el inicio de sesión'},'continuar el inicio de sesión'));
  assert.equal(await page.evaluate(()=>(window as any).wrong),undefined);
  await page.setContent('<main><button onclick="window.forward=true">Continuar</button></main>');
  await port.act({index:1,action:'click',target:{strategy:'text',value:'continuar verificación de acceso'},description:'Continuar verificación de acceso'},'continuar verificación de acceso');
  assert.equal(await page.evaluate(()=>(window as any).forward),true);
 }finally{__setJiraDomTargetResolverForTesting(undefined);await browser.close();}
});

test("Jira discovery fallback clicks only an AI-selected observed action", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main><button type='button' aria-label='Cuenta corriente' onclick='window.clicked = true'>Cuenta corriente</button></main>");
    let receivedIntent = "";
    __setJiraDomTargetResolverForTesting(async (intent, candidates) => {
      receivedIntent = intent;
      const match = candidates.find(candidate => /Cuenta corriente/.test(candidate.label));
      return match ? { candidateId: match.id, confidence: 0.95 } : undefined;
    });
    const result = await createJiraPlaywrightPort(page, "https://example.test").act(
      { index: 1, action: "click", target: { strategy: "text", value: "Abrir mis productos financieros" }, description: "Abrir mis productos financieros" },
      "Abrir mis productos financieros",
    );
    assert.equal(receivedIntent, "Abrir mis productos financieros. Target: Abrir mis productos financieros");
    assert.equal(await page.evaluate(() => (window as unknown as { clicked?: boolean }).clicked), true);
    assert.equal(result.strategy, "css", "the chosen action is re-certified by Jira's existing durable-target contract");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});
