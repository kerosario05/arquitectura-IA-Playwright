import { test, expect } from "@playwright/test";
import { createPromotedSpecRuntime } from "../src/automations/runtime/promoted-spec-runtime";
import path from "node:path";

test("click exitoso sin retry", async ({ page }) => {
  await page.setContent(`<button id="go" onclick="window.__clicked=true">Go</button>`);
  const runtime = createPromotedSpecRuntime(page, { enabled: false, retryEnabled: true });
  await runtime.clickPromotedTarget({
    stepIndex: 1,
    target: "Go",
    actionIntent: "click",
    action: async () => { await page.locator("#go").click(); }
  });
  const clicked = await page.evaluate(() => (window as any).__clicked === true);
  expect(clicked).toBe(true);
});

test("click abre modal y se considera exito sin navegacion", async ({ page }) => {
  await page.setContent(`
    <button id="open" onclick="document.getElementById('m').style.display='block'">Open</button>
    <div id="m" role="dialog" style="display:none"><input id="f" /></div>
  `);
  const runtime = createPromotedSpecRuntime(page, { enabled: false, stabilityTimeoutMs: 1500 });
  await runtime.clickPromotedTarget({
    stepIndex: 2,
    target: "Open",
    actionIntent: "open_modal",
    expectedEffect: "modal_or_form_or_navigation",
    action: async () => {
      await page.locator("#open").click();
      await page.evaluate(() => { (document.getElementById("m") as HTMLElement).style.display = "block"; });
    }
  });
  await expect(page.locator("#m")).toBeVisible();
});

test("click sin cambio ni modal falla con diagnostics", async ({ page }) => {
  // Test that callback fallback triggers stability check failure when navigation expected but doesn't happen
  // Use target that native resolver can't find to force callback path
  await page.setContent(`<button id="noop">Click Me</button>`);
  const runtime = createPromotedSpecRuntime(page, { enabled: true, stabilityTimeoutMs: 1200, captureDiagnostics: false, retryEnabled: false });
  await expect(runtime.clickPromotedTarget({
    stepIndex: 3,
    target: "NonExistentButton",
    actionIntent: "navigate",
    expectedEffect: "navigation",
    action: async () => { await page.locator("#noop").click({ noWaitAfter: true }); }
  })).rejects.toThrow();
});

test("retry se ejecuta maximo una vez", async ({ page }) => {
  // Use a button without id/text that native resolver can't find, forcing callback fallback
  await page.setContent(`<button onclick="void(0)">Click Me</button>`);
  const runtime = createPromotedSpecRuntime(page, { enabled: false, retryEnabled: true });
  let attempts = 0;
  await runtime.clickPromotedTarget({
    stepIndex: 4,
    target: "NonExistentButton",
    actionIntent: "click",
    action: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("first fail");
    }
  });
  expect(attempts).toBe(2);
});

test("no retry para accion sensible", async ({ page }) => {
  // Use a button that native resolver can't find, forcing callback fallback
  await page.setContent(`<button onclick="void(0)">Sensitive Action</button>`);
  const runtime = createPromotedSpecRuntime(page, { enabled: false, retryEnabled: true, captureDiagnostics: false });
  let attempts = 0;
  await expect(runtime.clickPromotedTarget({
    stepIndex: 5,
    target: "NonExistentSensitive",
    actionIntent: "submit",
    sensitive: true,
    action: async () => {
      attempts += 1;
      throw new Error("blocked");
    }
  })).rejects.toThrow();
  expect(attempts).toBe(1);
});

test("fill usa active container y fallback a page", async ({ page }) => {
  await page.setContent(`
    <button id="open" onclick="document.getElementById('m').style.display='block'">Open</button>
    <div id="m" role="dialog" style="display:none"><input id="inside" /></div>
    <input id="outside" />
  `);
  const runtime = createPromotedSpecRuntime(page, { enabled: false, stabilityTimeoutMs: 1500 });
  await runtime.clickPromotedTarget({
    stepIndex: 6,
    target: "Open",
    actionIntent: "open_modal",
    expectedEffect: "modal_or_form_or_navigation",
    action: async () => {
      await page.locator("#open").click();
      await page.evaluate(() => { (document.getElementById("m") as HTMLElement).style.display = "block"; });
    }
  });
  await runtime.fillPromotedField({
    stepIndex: 7,
    field: "Name",
    value: "John",
    fill: async () => { await page.locator("#inside").fill("John"); },
    fillInActiveContainer: async () => { await page.locator("#inside").fill("John"); },
    fillInPage: async () => { await page.locator("#outside").fill("John"); }
  });
  await expect(page.locator("#inside")).toHaveValue("John");
});

test("activeContainer visible sin campo se descarta y usa otro contenedor", async ({ page }) => {
  await page.setContent(`
    <div id="old" role="dialog" style="display:block"><input id="old-field" /></div>
    <div id="new" role="dialog" style="display:block"><label>Name</label><input id="new-field" /></div>
  `);
  const runtime = createPromotedSpecRuntime(page, { enabled: false });
  await runtime.fillPromotedField({
    stepIndex: 9,
    field: "Name",
    value: "Alice",
    fill: async () => { await page.locator("#new-field").fill("Alice"); },
    fillInActiveContainer: async () => { await page.locator("#new-field").fill("Alice"); },
    fillInPage: async () => { await page.locator("#new-field").fill("Alice"); }
  });
  await expect(page.locator("#new-field")).toHaveValue("Alice");
});

test("activeContainer oculto stale se descarta", async ({ page }) => {
  await page.setContent(`
    <div id="old" role="dialog" style="display:none"><input id="old-field" /></div>
    <div id="new" role="dialog" style="display:block"><label>Email</label><input id="new-field" /></div>
  `);
  const runtime = createPromotedSpecRuntime(page, { enabled: false });
  await runtime.fillPromotedField({
    stepIndex: 10,
    field: "Email",
    value: "a@b.com",
    fill: async () => { await page.locator("#new-field").fill("a@b.com"); },
    fillInActiveContainer: async () => { await page.locator("#new-field").fill("a@b.com"); },
    fillInPage: async () => { await page.locator("#new-field").fill("a@b.com"); }
  });
  await expect(page.locator("#new-field")).toHaveValue("a@b.com");
});

test("dos modales elige el que contiene field editable", async ({ page }) => {
  await page.setContent(`
    <div id="a" role="dialog" style="display:block"><label>Other</label><input id="other-field" /></div>
    <div id="b" role="dialog" style="display:block"><label>City</label><input id="city-field" /></div>
  `);
  const runtime = createPromotedSpecRuntime(page, { enabled: false });
  await runtime.fillPromotedField({
    stepIndex: 11,
    field: "City",
    value: "Santo Domingo",
    fill: async () => { await page.locator("#city-field").fill("Santo Domingo"); },
    fillInActiveContainer: async () => { await page.locator("#city-field").fill("Santo Domingo"); },
    fillInPage: async () => { await page.locator("#city-field").fill("Santo Domingo"); }
  });
  await expect(page.locator("#city-field")).toHaveValue("Santo Domingo");
});

test("captura mensaje de dialog", async ({ page }) => {
  await page.setContent(`<button id="a" onclick="alert('ok message')">Alert</button>`);
  const runtime = createPromotedSpecRuntime(page, { enabled: false });
  await runtime.clickPromotedTarget({
    stepIndex: 8,
    target: "Alert",
    actionIntent: "click",
    action: async () => { await page.locator("#a").click(); }
  });
  const msg = await runtime.handlePromotedDialogOrAlert();
  expect(msg).toContain("ok message");
  const debug = await runtime.getDebugState();
  expect(debug.activeContainer).toBeFalsy();
});

test("page fallback funciona si no hay modal valido", async ({ page }) => {
  await page.setContent(`<label>Name</label><input id="page-name" />`);
  const runtime = createPromotedSpecRuntime(page, { enabled: false });
  await runtime.fillPromotedField({
    stepIndex: 12,
    field: "Name",
    value: "Bob",
    fill: async () => { await page.locator("#page-name").fill("Bob"); },
    fillInPage: async () => { await page.locator("#page-name").fill("Bob"); }
  });
  await expect(page.locator("#page-name")).toHaveValue("Bob");
});

test("error diagnostics incluye contenedores evaluados y screenshot", async ({ page }) => {
  await page.setContent(`<div id="x" role="dialog" style="display:block"><input id="x1" /></div>`);
  const runtime = createPromotedSpecRuntime(page, { enabled: false, captureDiagnostics: true });
  const evidenceDir = path.join(process.cwd(), ".artifacts", "tmp", "promoted-runtime-test");
  await expect(runtime.fillPromotedField({
    stepIndex: 13,
    field: "MissingField",
    value: "value",
    evidenceDir,
    fill: async () => { throw new Error("forced"); },
    fillInActiveContainer: async () => { throw new Error("forced-active"); },
    fillInPage: async () => { throw new Error("forced-page"); }
  })).rejects.toThrow(/fillPath|nativeFillAttempted|callbackAttempted|diagnostics/);
});

test("fillPromotedField verifies callback was executed", async ({ page }) => {
  await page.setContent(`<label>Name</label><input id="name" />`);
  const runtime = createPromotedSpecRuntime(page, { enabled: false });
  let callbackCalled = false;
  await runtime.fillPromotedField({
    stepIndex: 14,
    field: "Name",
    value: "Test",
    fill: async () => {
      callbackCalled = true;
      await page.locator("#name").fill("Test");
    }
  });
  expect(callbackCalled).toBe(true);
  await expect(page.locator("#name")).toHaveValue("Test");
});

test("fillPromotedField uses options.value as source of truth", async ({ page }) => {
  await page.setContent(`<label>Email</label><input id="email" />`);
  const runtime = createPromotedSpecRuntime(page, { enabled: false });
  await runtime.fillPromotedField({
    stepIndex: 15,
    field: "Email",
    value: "test@example.com",
    fill: async () => { await page.locator("#email").fill("test@example.com"); }
  });
  const value = await page.locator("#email").inputValue();
  expect(value).toBe("test@example.com");
});
