import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { captureJiraEvidenceScreenshot, jiraScreenTitleFromObservedIdentity, readJiraScreenIdentity, waitForJiraScreenSettled } from "./jira-evidence-capture";

test("Jira screen titles prefer an observed heading and use SPA routes before the generic fallback", () => {
  assert.equal(jiraScreenTitleFromObservedIdentity(" Transferencias ", "/"), "Transferencias");
  assert.equal(jiraScreenTitleFromObservedIdentity(undefined, "/transferencias/cuentas-propias?tab=1"), "Pantalla cuentas propias");
  assert.equal(jiraScreenTitleFromObservedIdentity(undefined, "/"), "Pantalla principal");
});

test("Jira screen identity reads the hash route when a SPA has no visible heading", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("http://jira-evidence.test/**", route => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<main><button>Continuar</button></main>",
    }));
    await page.goto("http://jira-evidence.test/#/transferencias/cuentas-propias");

    const identity = await readJiraScreenIdentity(page);
    assert.equal(new URL(page.url()).pathname, "/", "hash-routed pages keep the same browser pathname");
    assert.equal(identity?.title, "Pantalla cuentas propias");
  } finally {
    await browser.close();
  }
});

test("Jira evidence capture waits for loading indicators and saves the settled screen", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>@keyframes rotate { to { transform: rotate(360deg); } } .spinner { width: 24px; height: 24px; animation: rotate .2s linear infinite; }</style>
      <main><div class="spinner" role="progressbar" aria-label="Cargando"></div><div id="result"></div></main>
    `);
    await assert.rejects(
      captureJiraEvidenceScreenshot(page, { settleTimeoutMs: 250, settleQuietMs: 50 }),
      /JIRA_EVIDENCE_(?:LOADER_STILL_VISIBLE|SCREEN_NOT_SETTLED)/,
    );

    await page.evaluate(() => setTimeout(() => {
      document.querySelector(".spinner")?.remove();
      document.querySelector("#result")!.innerHTML = "<h1>Datos listos</h1><table><tr><td>Solicitud 101</td></tr></table>";
    }, 150));
    const screenshot = await captureJiraEvidenceScreenshot(page, { settleTimeoutMs: 3000, settleQuietMs: 80 });
    assert.ok(screenshot.byteLength > 0);
    assert.equal(await waitForJiraScreenSettled(page, 500), true);
  } finally {
    await browser.close();
  }
});

test("Jira stable-screen wait rejects a transient loading overlay and accepts the loaded screen", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<main><h1>Auditoría</h1><div role="status" aria-label="Estado de carga">Cargando</div></main>');
    assert.equal(await waitForJiraScreenSettled(page, 300), false, "persistent loading overlay is not settled evidence");

    await page.evaluate(() => setTimeout(() => document.querySelector('[role="status"]')!.remove(), 200));
    assert.equal(await waitForJiraScreenSettled(page, 5000), true, "overlay removal settles the screen");

    await page.setContent('<main aria-busy="true"><table><tr><td>fila</td></tr></table></main>');
    assert.equal(await waitForJiraScreenSettled(page, 300), false, "aria-busy region is not settled");
    await page.locator("main").evaluate(element => element.removeAttribute("aria-busy"));
    assert.equal(await waitForJiraScreenSettled(page, 300), true, "loaded table is settled");
  } finally {
    await browser.close();
  }
});

test("Jira screen identity ignores field values but changes when visible screen structure changes", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <nav><button role="tab" aria-selected="true">Personal</button><button role="tab" aria-selected="false">Empresarial</button></nav>
      <main><h1>Inicio de sesión</h1><form><label for="user">Usuario</label><input id="user" />
      <label for="password">Contraseña</label><input id="password" type="password" /></form><button>Iniciar sesión</button></main>
    `);

    const emptyFormIdentity = await readJiraScreenIdentity(page);
    await page.locator("#user").fill("synthetic-user");
    await page.locator("#password").fill("synthetic-password");
    const filledFormIdentity = await readJiraScreenIdentity(page);
    assert.ok(emptyFormIdentity);
    assert.deepEqual(filledFormIdentity, emptyFormIdentity, "input contents do not split one screen into separate visits");
    assert.doesNotMatch(JSON.stringify(filledFormIdentity), /synthetic-user|synthetic-password/);

    await page.locator('[role="tab"]').nth(0).evaluate(element => element.setAttribute("aria-selected", "false"));
    await page.locator('[role="tab"]').nth(1).evaluate(element => element.setAttribute("aria-selected", "true"));
    await page.locator("main").evaluate(element => {
      element.querySelector("form")!.innerHTML = '<label for="rnc">RNC</label><input id="rnc" />'
        + '<label for="user">Usuario</label><input id="user" />'
        + '<label for="password">Contraseña</label><input id="password" type="password" />';
    });
    const businessProfileIdentity = await readJiraScreenIdentity(page);
    assert.ok(businessProfileIdentity);
    assert.notEqual(businessProfileIdentity.id, emptyFormIdentity.id, "profile/tab and field structure distinguish the business login screen");
    assert.equal(emptyFormIdentity.title, "Inicio de sesión", "screen title comes from the visible page heading");
    assert.equal(businessProfileIdentity.title, "Inicio de sesión", "a profile tab switch keeps the same screen heading");
  } finally {
    await browser.close();
  }
});
