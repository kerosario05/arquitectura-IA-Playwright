import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { readJiraScreenIdentity, waitForJiraScreenSettled } from "./jira-evidence-capture";

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
    assert.equal(businessProfileIdentity.title, emptyFormIdentity.title, "persisted screen titles stay generic and avoid visible user data");
  } finally {
    await browser.close();
  }
});
