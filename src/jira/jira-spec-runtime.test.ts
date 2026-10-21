import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import type { TestInfo } from "@playwright/test";
import { assertJiraSpecVisibleText, awaitJiraSpecPostLoginTransition, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, isJiraAuthenticatedShell, JIRA_NO_SHELL_EVIDENCE, jiraAccessCodeGatePageDriver, mergeJiraAuthTestData, resolveJiraAccessCodeOtp, type JiraAccessCodeGateDriver, type JiraAccessCodeGateEvidence, type JiraAuthenticatedShellEvidence, performJiraSpecSelection, reportJiraSpecStepComplete, resolveJiraSpecTarget, resolveJiraSpecValue } from "./jira-spec-runtime";
import { __setJiraDomTargetResolverForTesting } from "./jira-dom-target-ai";
import { __setJiraDomAssertionResolverForTesting } from "./jira-dom-assertion-ai";
import { compileJiraSpec } from "./jira-spec-compiler";
import type { ExecutionPlan } from "../types/execution-plan.types";

test("Jira reuse evidence defers capture while an ARIA loading overlay is visible and never force-captures an unsettled final step", async () => {
  const browser = await chromium.launch({ headless: true });
  const previousContext = process.env.JIRA_REUSE_EVIDENCE_CONTEXT;
  process.env.JIRA_REUSE_EVIDENCE_CONTEXT = "{}";
  try {
    const page = await browser.newPage();
    await page.setContent("<main><h1>Transfer form</h1><button>Continue</button></main>");
    const screenshotOptions: Array<{ fullPage?: boolean }> = [];
    const originalScreenshot = page.screenshot.bind(page);
    Object.defineProperty(page, "screenshot", {
      configurable: true,
      value: async (options?: { fullPage?: boolean }) => {
        screenshotOptions.push(options ?? {});
        return originalScreenshot(options);
      },
    });
    const attachmentNames: string[] = [];
    const metas: Array<{ stepIndex: number; status: string; screenIdentity?: unknown; screenshot?: boolean }> = [];
    const testInfo = {
      attach: async (name: string, options: { body: Buffer | string }) => {
        attachmentNames.push(name);
        if (name.endsWith("-meta")) metas.push(JSON.parse(String(options.body)));
      },
    } as unknown as TestInfo;
    const shots = () => attachmentNames.filter(name => /^jira-step-\d{3}$/.test(name));
    const showLoading = () => page.evaluate(() => document.body.insertAdjacentHTML(
      "beforeend", '<div id="busy" role="status" aria-label="Estado de carga">Cargando</div>'));
    const hideLoading = () => page.evaluate(() => document.getElementById("busy")?.remove());

    await reportJiraSpecStepComplete(page, testInfo, 1, true);
    assert.deepEqual(shots(), ["jira-step-001"]);

    // Pending capture is not attached while the ARIA loading overlay is visible.
    await page.locator("h1").evaluate(element => { element.textContent = "Transfer confirmation"; });
    await showLoading();
    await reportJiraSpecStepComplete(page, testInfo, 2, true);
    assert.deepEqual(shots(), ["jira-step-001"]);
    const loadingMeta = metas.find(meta => meta.stepIndex === 2);
    assert.equal(loadingMeta?.status, "passed", "passed metadata is still reported while loading");
    assert.equal(loadingMeta?.screenIdentity, undefined, "no identity is read from a loading screen");

    // After overlay removal the next settled report attaches the stable screen under the original pending step.
    await hideLoading();
    await reportJiraSpecStepComplete(page, testInfo, 3, false);
    assert.deepEqual(shots(), ["jira-step-001", "jira-step-002"]);
    assert.ok(metas.some(meta => meta.stepIndex === 2 && meta.screenshot === true));
    assert.ok(metas.some(meta => meta.stepIndex === 3 && meta.status === "passed"));

    // Final step does not force a capture while loading; prior screenshots stay intact.
    await showLoading();
    await reportJiraSpecStepComplete(page, testInfo, 4, false, true);
    assert.deepEqual(shots(), ["jira-step-001", "jira-step-002"]);

    // Settled final step always recaptures, even on an already-captured screen id.
    await hideLoading();
    await reportJiraSpecStepComplete(page, testInfo, 5, false, true);
    assert.deepEqual(shots(), ["jira-step-001", "jira-step-002", "jira-step-005"]);
    assert.deepEqual(screenshotOptions.map(options => options.fullPage), [true, true, true]);
  } finally {
    if (previousContext === undefined) delete process.env.JIRA_REUSE_EVIDENCE_CONTEXT;
    else process.env.JIRA_REUSE_EVIDENCE_CONTEXT = previousContext;
    await browser.close();
  }
});

test("Jira reuse evidence recaptures the final step when the screen identity is unchanged but the DOM mutated", async () => {
  const browser = await chromium.launch({ headless: true });
  const previousContext = process.env.JIRA_REUSE_EVIDENCE_CONTEXT;
  process.env.JIRA_REUSE_EVIDENCE_CONTEXT = "{}";
  try {
    const page = await browser.newPage();
    await page.setContent("<title>Admin</title><main><h1>Admin</h1><input id=v value=initial></main>");
    const shots: Buffer[] = [];
    const attached: string[] = [];
    const testInfo = {
      attach: async (name: string, options: { body: Buffer }) => { if (/^jira-step-\d{3}$/.test(name)) { attached.push(name); shots.push(options.body); } },
    } as unknown as TestInfo;

    await reportJiraSpecStepComplete(page, testInfo, 1, true);
    await page.locator("#v").evaluate(element => { (element as HTMLInputElement).value = "a much longer modified policy value"; element.style.width = "600px"; });
    await reportJiraSpecStepComplete(page, testInfo, 2, false, true);

    assert.deepEqual(attached, ["jira-step-001", "jira-step-002"]);
    assert.notDeepEqual(shots[0], shots[1]);
  } finally {
    if (previousContext === undefined) delete process.env.JIRA_REUSE_EVIDENCE_CONTEXT;
    else process.env.JIRA_REUSE_EVIDENCE_CONTEXT = previousContext;
    await browser.close();
  }
});

test("Jira promoted spec reads only its exact TestRail case runtime context", async () => {
  const appSlug = `jira-runtime-fixture-${process.pid}-${Date.now()}`;
  const secondAppSlug = `${appSlug}-secondary`;
  const appRoot = path.resolve("automations", "apps", appSlug);
  const secondAppRoot = path.resolve("automations", "apps", secondAppSlug);
  const contextPath = path.join(os.tmpdir(), `jira-runtime-context-${process.pid}-${Date.now()}.json`);
  const previousContextPath = process.env.DISCOVERY_RUNTIME_CONTEXT;
  const automationId = "synthetic-jira-case";
  try {
    await fs.mkdir(appRoot, { recursive: true });
    await fs.writeFile(path.join(appRoot, "index.json"), JSON.stringify({
      version: "1.0",
      updatedAt: new Date(0).toISOString(),
      automations: [{
        id: automationId,
        caseId: 90071,
        appSlug,
        title: "Synthetic case",
        planPath: "plan.json",
        specPath: "case.spec.ts",
        status: "active",
        source: "discovery",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }],
    }), "utf8");
    await fs.mkdir(secondAppRoot, { recursive: true });
    await fs.writeFile(path.join(secondAppRoot, "index.json"), JSON.stringify({
      version: "1.0",
      updatedAt: new Date(0).toISOString(),
      automations: [{
        id: automationId,
        caseId: 90072,
        appSlug: secondAppSlug,
        title: "Synthetic second-project case",
        planPath: "plan.json",
        specPath: "case.spec.ts",
        status: "active",
        source: "discovery",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }],
    }), "utf8");
    await fs.writeFile(contextPath, JSON.stringify({
      "90070": [{ key: "rnc", value: "wrong-case-value", source: "manual_runtime", sensitive: true }],
      "90071": [{ key: "RNC", value: "synthetic-case-value", source: "manual_runtime", sensitive: true }],
      "90072": [{ key: "rnc", value: "second-project-value", source: "manual_runtime", sensitive: true }],
    }), "utf8");
    process.env.DISCOVERY_RUNTIME_CONTEXT = contextPath;
    const value = await resolveJiraSpecValue("rnc", appSlug, "jira-synthetic", automationId);
    assert.equal(value, "synthetic-case-value");
    assert.equal(await resolveJiraSpecValue("rnc", secondAppSlug, "jira-synthetic", automationId), "second-project-value");
  } finally {
    if (previousContextPath === undefined) delete process.env.DISCOVERY_RUNTIME_CONTEXT;
    else process.env.DISCOVERY_RUNTIME_CONTEXT = previousContextPath;
    await fs.rm(contextPath, { force: true });
    await fs.rm(appRoot, { recursive: true, force: true });
    await fs.rm(secondAppRoot, { recursive: true, force: true });
  }
});

async function withSyntheticProfile(profile: Record<string, unknown>, run: (appSlug: string) => Promise<void>): Promise<void> {
  const appSlug = `jira-alias-fixture-${process.pid}-${Date.now()}`;
  const appRoot = path.resolve("automations", "apps", appSlug);
  try {
    await fs.mkdir(appRoot, { recursive: true });
    await fs.writeFile(path.join(appRoot, "app.config.json"), JSON.stringify(profile), "utf8");
    await run(appSlug);
  } finally {
    await fs.rm(appRoot, { recursive: true, force: true });
  }
}

test("Jira spec value resolves a requested name declared as an alias of a different canonical key", async () => {
  await withSyntheticProfile({
    testData: { canonical_secret: "synthetic-value" },
    testDataAliases: { canonical_secret: ["alias_one", "alias_two"] },
  }, async appSlug => {
    assert.equal(await resolveJiraSpecValue("alias_two", appSlug, "s", "missing-case"), "synthetic-value");
    assert.equal(await resolveJiraSpecValue("undeclared_name", appSlug, "s", "missing-case").catch(e => (e as Error).message), "JIRA_SPEC_REQUIRED_DATA_MISSING");
  });
});

test("Jira spec value alias matches tokens ignoring accents, separators and connector words", async () => {
  await withSyntheticProfile({
    testData: { "group.access_code": "synthetic-value" },
    testDataAliases: { "group.access_code": ["código de acceso", "sms code"] },
  }, async appSlug => {
    assert.equal(await resolveJiraSpecValue("codigo_acceso", appSlug, "s", "missing-case"), "synthetic-value");
    assert.equal(await resolveJiraSpecValue("code of sms", appSlug, "s", "missing-case").catch(e => (e as Error).message), "JIRA_SPEC_REQUIRED_DATA_MISSING");
  });
});

test("Jira spec value alias fails closed when compatible entries disagree but accepts agreeing ones", async () => {
  await withSyntheticProfile({
    testData: { key_a: "value-a", key_b: "value-b", key_c: "value-a", key_d: "value-a" },
    testDataAliases: { semantic_split: ["key_a", "key_b"], semantic_same: ["key_c", "key_d"] },
  }, async appSlug => {
    await assert.rejects(resolveJiraSpecValue("semantic_split", appSlug, "s", "missing-case"), /JIRA_SPEC_REQUIRED_DATA_AMBIGUOUS/);
    assert.equal(await resolveJiraSpecValue("semantic_same", appSlug, "s", "missing-case"), "value-a");
  });
});

test("Jira spec target resolution waits for an asynchronously rendered page assertion", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><button onclick="setTimeout(() => document.querySelector(\'main\').insertAdjacentHTML(\'beforeend\', \'<h1>Verificación de Usuario</h1>\'), 200)">Iniciar sesión</button></main>');
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    const target = await resolveJiraSpecTarget(page, { strategy: "text", value: "verificación de usuario", exact: true });
    await assert.doesNotReject(() => target.waitFor({ state: "visible" }));
  } finally {
    await browser.close();
  }
});

test("Jira spec target recovers a stale text CSS locator through one visible actionable owner", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><button type="button" onclick="this.dataset.selected=\'true\'"><span>SMS</span></button></main>');
    const target = await resolveJiraSpecTarget(page, {
      strategy: "css", value: 'div:visible:text-is("SMS")',
    }, 50, "Solicitar el código por SMS");
    await target.click();
    assert.equal(await page.getByRole("button", { name: "SMS", exact: true }).getAttribute("data-selected"), "true");
  } finally {
    await browser.close();
  }
});

test("Jira spec SMS action clicks the unique visible text control observed by Discovery", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><h1>Verificación de Usuario</h1><div class="token-media" data-type="SMS" onclick="this.classList.add(\'active\')">SMS</div><input aria-label="Código de seguridad 1"><input aria-label="Código de seguridad 2"><input aria-label="Código de seguridad 3"><input aria-label="Código de seguridad 4"><input aria-label="Código de seguridad 5"><input aria-label="Código de seguridad 6"></main>');
    await clickJiraSpecTarget(page, { strategy: "css", value: 'div:visible:text-is("SMS")' }, 50, "Solicitar el código por SMS");
    assert.equal(await page.locator(".token-media").getAttribute("class"), "token-media active");
  } finally {
    await browser.close();
  }
});

test("Jira spec resolves an SMS label inside nested actionable wrappers to the nearest control", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><div class="channel-list" style="cursor:pointer" onclick="this.dataset.parentClicked=\'true\'"><div class="token-media" style="cursor:pointer" onclick="this.classList.add(\'active\')"><span>SMS</span></div></div></main>');
    await clickJiraSpecTarget(page, { strategy: "css", value: 'div:visible:text-is("SMS")' }, 50, "Solicitar el código por SMS");
    assert.equal(await page.locator(".token-media").getAttribute("class"), "token-media active");
  } finally {
    await browser.close();
  }
});

test("Jira spec scopes a duplicate SMS label to the visible code-entry group", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><section class="verification"><div class="channel" onclick="this.classList.add(\'active\')"><span>SMS</span></div><div class="fields"><input><input><input><input><input><input></div></section><footer>SMS</footer></main>');
    await clickJiraSpecTarget(page, { strategy: "css", value: 'div:visible:text-is("SMS")' }, 50, "Solicitar el código por SMS");
    assert.equal(await page.locator(".channel").getAttribute("class"), "channel active");
  } finally {
    await browser.close();
  }
});

test("Jira spec waits for the SMS channel rendered after the login transition", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><button onclick="setTimeout(() => document.querySelector(\'main\').insertAdjacentHTML(\'beforeend\', \'<section><div class=\\\'token-media\\\' onclick=\\\'this.classList.add(&amp;quot;active&amp;quot;)\\\'>SMS</div><input><input><input><input><input><input></section>\'), 150)">Iniciar sesión</button></main>');
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await clickJiraSpecTarget(page, { strategy: "css", value: 'div:visible:text-is("SMS")' }, 1000, "Solicitar el código por SMS");
    assert.equal(await page.locator(".token-media").getAttribute("class"), "token-media active");
  } finally {
    await browser.close();
  }
});

test("Jira spec target still abstains when stale text CSS locator has multiple actionable owners", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><button>SMS</button><button>SMS</button></main>');
    await assert.rejects(resolveJiraSpecTarget(page, {
      strategy: "css", value: 'div:visible:text-is("SMS")',
    }, 50, "Solicitar el código por SMS"), /JIRA_SPEC_TARGET_NOT_UNIQUE/);
  } finally {
    await browser.close();
  }
});

test("Jira spec treats a visible SMS label as already selected only inside an OTP gate", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><h1>Verificación de Usuario</h1><p>Seleccione el canal SMS y digite el código de seguridad. Reenviar código en 30 segundos.</p><input aria-label="Código 1"><input aria-label="Código 2"><input aria-label="Código 3"><input aria-label="Código 4"><input aria-label="Código 5"><input aria-label="Código 6"></main>');
    await clickJiraSpecTarget(page, { strategy: "css", value: 'div:visible:text-is("SMS")' }, 50, "Solicitar el código por SMS");

    await page.setContent('<main><h1>Resumen de cuentas</h1></main>');
    await assert.rejects(clickJiraSpecTarget(page, { strategy: "css", value: 'div:visible:text-is("SMS")' }, 50, "Solicitar el código por SMS"), /JIRA_SPEC_TARGET_NOT_UNIQUE/);
  } finally {
    await browser.close();
  }
});

test("Jira spec does not assume the SMS channel is selected just because an OTP gate is visible", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><h1>Verificación de Usuario</h1><p>Seleccione el canal SMS y digite el código de seguridad</p><input aria-label="Código 1"><input aria-label="Código 2"><input aria-label="Código 3"><input aria-label="Código 4"><input aria-label="Código 5"><input aria-label="Código 6"></main>');
    await assert.rejects(
      clickJiraSpecTarget(page, { strategy: "css", value: 'div:visible:text-is("SMS")' }, 50, "Solicitar el código por SMS"),
      /JIRA_SPEC_TARGET_NOT_UNIQUE/,
    );
  } finally {
    await browser.close();
  }
});

test("Jira semantic assertion accepts duplicate page text but ignores navigation-only text", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<nav><a>Resumen</a></nav><main><h1>Resumen</h1></main>');
    await assertJiraSpecVisibleText(page, "resumen", 500);

    await page.setContent('<nav><a>Cuenta de origen identificable</a></nav><main><h1>Cuenta Origen</h1></main>');
    await assertJiraSpecVisibleText(page, "cuenta de origen identificable", 500);

    await page.setContent('<nav><a>Resumen</a></nav><main><h1>Otra pantalla</h1></main>');
    await assert.rejects(assertJiraSpecVisibleText(page, "Resumen", 200));
  } finally {
    await browser.close();
  }
});

test("Jira semantic assertion ignores a leading channel word in the expected text but still requires the substantive content", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><div role="status">3 registros procesados: resumen.csv</div></main>');
    await assertJiraSpecVisibleText(page, "aviso 3 registros procesados: resumen.csv", 500);

    await page.setContent('<main><div role="status">2 registros rechazados: otro.csv</div></main>');
    await assert.rejects(assertJiraSpecVisibleText(page, "aviso 3 registros procesados: resumen.csv", 200));
  } finally {
    await browser.close();
  }
});

test("Jira spec accepts a loading label seen during the preceding click but never other vanished text", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const html = '<main><button id="go" onclick="const s=document.createElement(\'div\');s.setAttribute(\'role\',\'status\');s.textContent=\'Cargando información segura\';document.body.append(s);setTimeout(()=>s.remove(),0);document.querySelector(\'h1\').textContent=\'Estados de cuenta\'">Ir</button><h1>Inicio</h1></main>';
    const click = () => clickJiraSpecTarget(page, { strategy: "css", value: "#go" }, 500);

    await page.setContent(html);
    await click();
    await assertJiraSpecVisibleText(page, "Cargando información segura", 200);

    // Consumed once: the same vanished label no longer passes.
    await assert.rejects(assertJiraSpecVisibleText(page, "Cargando información segura", 200));

    // Non-loading text that vanished (or never rendered) still fails closed.
    await page.setContent(html);
    await click();
    await assert.rejects(assertJiraSpecVisibleText(page, "Tabla de movimientos", 200));

    // A different loading label that was never observed fails closed.
    await page.setContent(html);
    await click();
    await assert.rejects(assertJiraSpecVisibleText(page, "Procesando pago", 200));

    // No preceding click, no capture.
    await assert.rejects(assertJiraSpecVisibleText(page, "Cargando información segura", 200));
  } finally {
    await browser.close();
  }
});

test("Jira explicit quoted text may match exactly one navigation item, never duplicates or incidental text", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const intent = 'Validar texto visible "transferencias"';
    await page.setContent('<aside><button>Transferencias</button><button>Pagos</button></aside><main><h1>Otra pantalla</h1></main>');
    await assertJiraSpecVisibleText(page, "transferencias", 500, intent);

    await page.setContent('<aside><button>Transferencias</button></aside><nav><a>Transferencias</a></nav><main><h1>Otra pantalla</h1></main>');
    await assert.rejects(assertJiraSpecVisibleText(page, "transferencias", 200, intent));

    await page.setContent('<div role="menu"><span>Mis transferencias recientes</span></div><main><h1>Otra pantalla</h1></main>');
    await assert.rejects(assertJiraSpecVisibleText(page, "transferencias", 200, intent));
    await assert.rejects(assertJiraSpecVisibleText(page, "transferencias", 200));
  } finally {
    await browser.close();
  }
});

test("Jira spec forwards the full step intent when an assertion describes a visible entity property", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><h1>Resumen</h1><section><h2>Cuentas</h2><article><strong>Cuenta Corriente</strong><span>RD$100.00</span></article><article><strong>Cuenta de Ahorro</strong><span>US$20.00</span></article></section></main>');
    __setJiraDomAssertionResolverForTesting(async (intent, evidence) => {
      assert.equal(intent, 'Validar "tipo" de cada cuenta presentada.');
      const summaryContext = evidence.find(item => item.text.includes("Resumen")
        && item.text.includes("Cuenta Corriente") && item.text.includes("Cuenta de Ahorro"));
      return summaryContext
        ? { supported: true, confidence: 0.96, evidenceIds: [summaryContext.id] }
        : { supported: false, confidence: 0.99, evidenceIds: [] };
    });
    await assertJiraSpecVisibleText(page, "tipo", 100, 'Validar "tipo" de cada cuenta presentada.');
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira semantic assertion reads visible body text when the app does not expose a main landmark", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<nav><a>Inicio</a></nav><main aria-hidden="true">Otra pantalla</main><div><h1>Verificación de Usuario</h1></div>');
    await assertJiraSpecVisibleText(page, "verificación de usuario", 500);
  } finally {
    await browser.close();
  }
});

test("promoted Jira spec recognizes an equivalent visible credential rejection message", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div role="alertdialog"><p>Usuario o Contraseña inválidos.</p><button>Cerrar</button></div>');
    await assertJiraSpecVisibleText(page, "mensaje de credenciales no válidas", 500);
  } finally {
    await browser.close();
  }
});

test("Jira transaction-reference assertion accepts a visible reference label with its value", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<nav><a>Histórico de Transferencias</a></nav><section><h2>Comprobante</h2><div class="row"><span># Referencia:</span><span>AB123456</span></div></section>');
    await assertJiraSpecVisibleText(page, "referencia de la operación", 500);

    await page.setContent('<section><h2>Comprobante</h2><div class="row"><span># Referencia:</span></div></section>');
    await assert.rejects(assertJiraSpecVisibleText(page, "referencia de la operación", 100));
  } finally {
    await browser.close();
  }
});

test("Jira semantic assertion retries when its content read overlaps a document navigation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://jira-spec.test/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/destination") {
        await route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: "<main><h1>Verificación de Usuario</h1></main>",
        });
        return;
      }
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<main><button onclick="setTimeout(() => location.assign('/destination'), 0)">Continuar</button></main>`,
      });
    });
    await page.goto("http://jira-spec.test/start");
    await page.getByRole("button", { name: "Continuar" }).click({ noWaitAfter: true });
    await assertJiraSpecVisibleText(page, "Verificación de Usuario", 3_000);
  } finally {
    await browser.close();
  }
});

test("Jira spec assertion accepts a semantic equivalent only when cited visible DOM supports it", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main><h2>Cuenta Origen</h2><p>Cuenta Corriente</p><h2>Cuenta Destino</h2><p>Cuenta de Ahorro</p></main>");
    __setJiraDomAssertionResolverForTesting(async (intent, evidence) => {
      assert.equal(intent, "cuentas seleccionadas");
      const matches = evidence.filter(item => /Cuenta Origen|Cuenta Destino/.test(item.text));
      assert.equal(matches.length >= 2, true);
      return { supported: true, confidence: 0.95, evidenceIds: matches.slice(0, 2).map(item => item.id) };
    });
    await assertJiraSpecVisibleText(page, "cuentas seleccionadas", 200);
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira spec treats separately labeled origin and destination as the accounts involved", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <h1>Comprobante</h1><p>Transacción Exitosa</p>
      <section><h2>Cuenta Origen</h2><p>Cuenta Corriente</p></section>
      <section><h2>Cuenta Destino</h2><p>Cuenta de Ahorro</p></section>
    </main>`);
    await assertJiraSpecVisibleText(page, "cuentas involucradas", 500);
  } finally {
    await browser.close();
  }
});

test("Jira spec accepts separately labeled origin and destination as selected accounts", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <h1>Confirmación</h1>
      <section><h2>Cuenta Origen</h2><p>Cuenta Corriente</p></section>
      <section><h2>Cuenta Destino</h2><p>Cuenta de Ahorro</p></section>
    </main>`);
    await assertJiraSpecVisibleText(page, "cuentas seleccionadas", 500);
  } finally {
    await browser.close();
  }
});

test("Jira spec does not infer the accounts involved when one account role is absent", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><h2>Cuenta Origen</h2><p>Cuenta Corriente</p></main>`);
    await assert.rejects(assertJiraSpecVisibleText(page, "cuentas involucradas", 100));
  } finally {
    await browser.close();
  }
});

test("Jira spec assertion fallback abstains on low confidence or uncited evidence", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main><h2>Cuenta Origen</h2><p>Cuenta Corriente</p><h2>Cuenta Destino</h2></main>");
    __setJiraDomAssertionResolverForTesting(async (_intent, evidence) => ({
      supported: true, confidence: 0.5, evidenceIds: [evidence[0].id],
    }));
    await assert.rejects(assertJiraSpecVisibleText(page, "transferencia completada", 100));
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira spec selection waits for a visible custom option without an ARIA option role", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <button type="button" id="account" onclick="setTimeout(() => { const option=document.createElement('div'); option.id='account-option'; option.style.cursor='pointer'; option.textContent='Cuenta Corrientes / 00123456'; option.onclick=()=>{document.getElementById('account').textContent=option.textContent; document.getElementById('options').remove()}; document.getElementById('options').append(option); }, 150)">Seleccione una Cuenta</button>
      <div id="options"></div>
    </main>`);
    await performJiraSpecSelection(page.locator("#account"), "Cuenta Corriente");
    assert.match(await page.locator("#account").innerText(), /Cuenta Corrientes/);
  } finally {
    await browser.close();
  }
});

test("Jira spec selection confirms through observed page content when a custom trigger is replaced", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><section id="account-area">
      <div id="trigger" onclick="setTimeout(() => { const option=document.createElement('div'); option.id='account-option'; option.style.cursor='pointer'; option.textContent='Cuenta de Ahorro / 00987654'; option.onclick=()=>{document.getElementById('account-area').innerHTML='<div class=selected>Cuenta de Ahorro / 00987654</div>'}; document.getElementById('options').append(option); }, 100)">Seleccione una Cuenta</div>
      <div id="options"></div>
    </section></main>`);
    await performJiraSpecSelection(page.locator("#trigger"), "Cuenta de Ahorro");
    assert.match(await page.locator("#account-area").innerText(), /Cuenta de Ahorro/);
    assert.equal(await page.locator("#trigger").count(), 0, "the app replaced the selected custom trigger");
  } finally {
    await browser.close();
  }
});

test("Jira spec target waits briefly then resolves a semantically equivalent observed control", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main><button aria-label='Cuenta de ahorros'>Cuenta de ahorros</button></main>");
    const { __setJiraDomTargetResolverForTesting } = await import("./jira-dom-target-ai");
    __setJiraDomTargetResolverForTesting(async (_intent, candidates) => ({ candidateId: candidates[0].id, confidence: 0.9 }));
    const target = await resolveJiraSpecTarget(page, { strategy: "text", value: "Cuenta de ahorro personales", exact: true }, 50);
    assert.equal(await target.isVisible(), true);
    __setJiraDomTargetResolverForTesting(undefined);
  } finally {
    await browser.close();
  }
});

test("Jira generated-spec fallback receives the semantic step description when a technical selector is stale", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main><button type='button'>Autorizar transferencia</button></main>");
    let receivedIntent = "";
    __setJiraDomTargetResolverForTesting(async (intent, candidates) => {
      receivedIntent = intent;
      const match = candidates.find(candidate => candidate.label === "Autorizar transferencia");
      return match ? { candidateId: match.id, confidence: 0.95 } : undefined;
    });
    const locator = await resolveJiraSpecTarget(page, { strategy: "css", value: "#stale-discovery-id" }, 50, 'Presionar "Autorizar transferencia"');
    assert.equal(receivedIntent, 'Presionar "Autorizar transferencia"');
    assert.equal(await locator.innerText(), "Autorizar transferencia");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira spec list selection reconciles a semantic value with the visible option and verifies it", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><button type="button" id="account" aria-label="Cuenta">Seleccione una cuenta</button></main>
      <script>document.querySelector('#account').addEventListener('click',()=>{document.querySelector('main').insertAdjacentHTML('beforeend','<div role="listbox"><div role="option" tabindex="0">Cuenta de ahorros</div></div>');document.querySelector('[role=option]').addEventListener('click',()=>{document.querySelector('#account').innerText='Cuenta de ahorros';document.querySelector('[role=listbox]').remove()})});</script>`);
    __setJiraDomTargetResolverForTesting(async (_intent, candidates) => {
      const match = candidates.find(candidate => /Cuenta de ahorros/.test(candidate.label));
      return match ? { candidateId: match.id, confidence: 0.95 } : undefined;
    });
    const field = page.getByRole("button", { name: "Cuenta" });
    await performJiraSpecSelection(field, "Cuenta de ahorro personales");
    assert.match(await field.innerText(), /Cuenta de ahorros/);
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira spec list selection treats Spanish singular, plural, and article variants as the same observed account", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><button type="button" id="account" aria-label="Cuenta de destino">Seleccione una Cuenta</button>
      <div id="options"></div></main>
      <script>document.querySelector('#account').addEventListener('click',()=>{document.querySelector('#options').innerHTML='<div id="option" role="option" tabindex="0">Cuenta de Ahorro / 00123456</div>';document.querySelector('#option').addEventListener('click',()=>{document.querySelector('#account').innerText='Cuenta de Ahorro / 00123456';document.querySelector('#options').remove()})});</script>`);
    await performJiraSpecSelection(page.getByRole("button", { name: "Cuenta de destino" }), "Cuenta Ahorros");
    assert.match(await page.getByRole("button").innerText(), /Cuenta de Ahorro/);
  } finally {
    await browser.close();
  }
});

test("Jira spec AI option fallback resolves a shorter roleless label from live DOM candidates", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><button type="button" id="account" aria-label="Cuenta de destino">Seleccione una cuenta</button>
      <div id="options"></div></main>
      <script>document.querySelector('#account').addEventListener('click',()=>{document.querySelector('#options').innerHTML='<div id="option" style="cursor:pointer">Cuenta de ahorros</div>';document.querySelector('#option').addEventListener('click',()=>{document.querySelector('#account').innerText='Cuenta de ahorros';document.querySelector('#options').remove()})});</script>`);
    let sawObservedOption = false;
    __setJiraDomTargetResolverForTesting(async (intent, candidates) => {
      assert.equal(intent, "Cuenta de ahorro personales");
      const match = candidates.find(candidate => /Cuenta de ahorros/i.test(candidate.label));
      sawObservedOption = Boolean(match);
      return match ? { candidateId: match.id, confidence: 0.95 } : undefined;
    });
    await performJiraSpecSelection(page.getByRole("button", { name: "Cuenta de destino" }), "Cuenta de ahorro personales");
    assert.equal(sawObservedOption, true, "AI decision must use the currently observed roleless DOM option");
    assert.equal(await page.getByRole("button").innerText(), "Cuenta de ahorros");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira spec native select maps only a unique observed option", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><label for="account">Cuenta</label><select id="account"><option value="">Seleccione</option><option value="savings">Cuenta de ahorros</option></select></main>');
    __setJiraDomTargetResolverForTesting(async (_intent, candidates) => {
      const match = candidates.find(candidate => /Cuenta de ahorros/.test(candidate.label));
      return match ? { candidateId: match.id, confidence: 0.95 } : undefined;
    });
    const field = page.getByLabel("Cuenta");
    await performJiraSpecSelection(field, "Cuenta de ahorro personales");
    assert.equal(await field.inputValue(), "savings");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira spec native select resolves a separator-insensitive value uniquely and fails closed on duplicates", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    __setJiraDomTargetResolverForTesting(async () => undefined);
    await page.setContent('<main><select id="freq"><option value="">Seleccione</option><option value="monthly">Mensual</option><option value="biweekly">Quincenal</option></select>'
      + '<select id="dup"><option value="">Seleccione</option><option value="a-b">Uno</option><option value="a_b">Dos</option></select></main>');
    await performJiraSpecSelection(page.locator("#freq"), "Bi-Weekly");
    assert.equal(await page.locator("#freq").inputValue(), "biweekly");
    await assert.rejects(performJiraSpecSelection(page.locator("#dup"), "AB"), /JIRA_SPEC_SELECTION_NOT_UNIQUE/);
    assert.equal(await page.locator("#dup").inputValue(), "");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira spec native select accepts a unique normalized prefix and fails closed on ambiguous or missing prefixes", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    __setJiraDomTargetResolverForTesting(async () => undefined);
    await page.setContent('<main><select id="yn"><option value="">Seleccione</option><option value="si">Sí</option><option value="no">No</option></select>'
      + '<select id="amb"><option value="">Seleccione</option><option value="a1">Alpha</option><option value="a2">Alto</option></select></main>');
    await performJiraSpecSelection(page.locator("#yn"), "S");
    assert.equal(await page.locator("#yn").inputValue(), "si");
    await assert.rejects(performJiraSpecSelection(page.locator("#amb"), "Al"), /JIRA_SPEC_SELECTION_NOT_UNIQUE/);
    assert.equal(await page.locator("#amb").inputValue(), "");
    await assert.rejects(performJiraSpecSelection(page.locator("#yn"), "Z"), /JIRA_SPEC_SELECTION_NOT_UNIQUE/);
    assert.equal(await page.locator("#yn").inputValue(), "si");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira promoted selection updates an observed range control and rejects out-of-range values", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <label for="range">Ajuste visual: <output id="range-output">RD$25,000</output></label>
      <input id="range" type="range" min="5000" max="100000" step="5000" value="25000" aria-label="Ajuste visual">
      <script>document.querySelector('#range').addEventListener('input', event => { document.querySelector('#range-output').textContent = 'RD$' + Number(event.target.value).toLocaleString('en-US'); });</script>
    </main>`);
    const field = page.getByRole("slider", { name: "Ajuste visual" });
    await performJiraSpecSelection(field, "RD$30,000");
    assert.equal(await field.inputValue(), "30000");
    assert.equal(await page.locator("#range-output").innerText(), "RD$30,000");
    await assert.rejects(performJiraSpecSelection(field, "RD$32,000"), /JIRA_RANGE_VALUE_INVALID/);
    assert.equal(await field.inputValue(), "30000", "invalid values must not change the control");
  } finally {
    await browser.close();
  }
});

test("Jira promoted selection checks, unchecks and is idempotent for native and ARIA checkboxes without popup resolution", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    __setJiraDomTargetResolverForTesting(async () => { throw new Error("popup resolver must not run for checkboxes"); });
    await page.setContent(`<main>
      <input id="native" type="checkbox" aria-label="Crear">
      <input id="on" type="checkbox" aria-label="Ver" checked>
      <div id="aria" role="checkbox" tabindex="0" aria-checked="false" aria-label="Editar" style="display:inline-block;width:16px;height:16px"></div>
      <script>
        window.clicks = 0;
        document.addEventListener('click', () => { window.clicks += 1; });
        document.querySelector('#aria').addEventListener('click', e => {
          e.currentTarget.setAttribute('aria-checked', String(e.currentTarget.getAttribute('aria-checked') !== 'true'));
        });
      </script>
    </main>`);
    const native = page.locator("#native");
    await performJiraSpecSelection(native, "true");
    assert.equal(await native.isChecked(), true);
    await performJiraSpecSelection(native, "true");
    assert.equal(await page.evaluate(() => (window as unknown as { clicks: number }).clicks), 1, "already-checked must not click again");
    await performJiraSpecSelection(page.locator("#on"), "false");
    assert.equal(await page.locator("#on").isChecked(), false);
    await performJiraSpecSelection(page.locator("#on"), "false");
    const aria = page.getByRole("checkbox", { name: "Editar" });
    await performJiraSpecSelection(aria, "true");
    assert.equal(await aria.isChecked(), true);
    await assert.rejects(performJiraSpecSelection(native, "maybe"), /JIRA_CHECKBOX_VALUE_INVALID/);
    assert.equal(await native.isChecked(), true, "invalid value must not change the control");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira compiler transports a slider selection to the shared promoted runtime helper", () => {
  const plan: ExecutionPlan = {
    version: "1.0", source: "discovery_generated", status: "validated", scenario: { source: "jira", title: "Range selection" },
    requiredData: [], createdAt: new Date(0).toISOString(),
    steps: [{ index: 1, action: "select", target: { strategy: "role", role: "slider", name: "Ajuste visual", exact: false },
      description: 'Seleccionar "RD$30,000" en "Ajuste visual".', valueKey: "adjustment" }],
  };
  const compiled = compileJiraSpec({ plan, sourceScenario: {}, appSlug: "synthetic", sectionSlug: "jira", automationId: "range", specPath: "fixture/range.spec.ts" });
  assert.deepEqual(compiled.unsupported, []);
  assert.match(compiled.source, /performJiraSpecSelection\(/);
  assert.match(compiled.source, /resolveJiraSpecValue\("adjustment"/);
});

test("Jira compiler emits semantic content assertions instead of unique action locators", () => {
  const plan: ExecutionPlan = {
    version: "1.0", source: "discovery_generated", status: "validated",
    scenario: { source: "jira", title: "Summary assertion" }, requiredData: [],
    steps: [{ index: 1, action: "assertVisible", target: { strategy: "text", value: "Resumen", exact: true }, description: 'Validar que se muestre "Resumen"' }],
    createdAt: new Date(0).toISOString(),
  };
  const compiled = compileJiraSpec({ plan, sourceScenario: {}, appSlug: "fixture", sectionSlug: "jira", automationId: "case", specPath: "fixture/case.spec.ts" });
  assert.deepEqual(compiled.unsupported, []);
  assert.match(compiled.source, /assertJiraSpecVisibleText\(page, "Resumen"/);
  assert.doesNotMatch(compiled.source, /const target1 = await resolveJiraSpecTarget/);
});

test("Jira compiler replays AuthFlow (OTP gate) once, right after the recorded login click and before business steps", () => {
  const plan: ExecutionPlan = {
    version: "1.0", source: "discovery_generated", status: "validated",
    scenario: { source: "jira", title: "Login then OTP" }, requiredData: [],
    steps: [
      { index: 1, action: "navigate", target: "APP_BASE_URL" },
      { index: 2, action: "fill", valueKey: "auth.username", target: { strategy: "css", value: "#user" }, description: "fill [auth.username]" },
      { index: 3, action: "click", target: { strategy: "role", role: "button", name: "Iniciar sesión", exact: true }, description: "click Iniciar sesión" },
      { index: 4, action: "click", target: { strategy: "role", role: "button", name: "Auditoría", exact: true }, description: 'Presionar "Auditoría".' },
    ],
    createdAt: new Date(0).toISOString(),
  };
  const compile = (auth: { required: boolean; insertionAfterStepIndex?: number }) => compileJiraSpec({ plan, sourceScenario: { auth }, appSlug: "fixture", sectionSlug: "jira", automationId: "case", specPath: "fixture/case.spec.ts" });
  const compiled = compile({ required: true, insertionAfterStepIndex: 3 });
  assert.deepEqual(compiled.unsupported, []);
  assert.equal(compiled.source.match(/authFlow\.ensureAuthenticated\(/g)?.length, 1);
  assert.match(compiled.source, /JIRA_SPEC_AUTH_FLOW_FAILED/);
  const at = compiled.source.indexOf("authFlow.ensureAuthenticated(");
  assert.ok(compiled.source.indexOf("Iniciar sesión") < at && at < compiled.source.indexOf("Auditoría"));
  // Classic login submit: transition wait precedes AuthFlow, exactly once.
  assert.equal(compiled.source.match(/awaitJiraSpecPostLoginTransition\(page\)/g)?.length, 1);
  assert.ok(compiled.source.indexOf("clickJiraSpecTarget") < compiled.source.indexOf("awaitJiraSpecPostLoginTransition(page)") && compiled.source.indexOf("awaitJiraSpecPostLoginTransition(page)") < at);
  // Neighbors: no auth -> no call; navigate insertion still works; an insertion step absent from the plan fails closed.
  assert.doesNotMatch(compile({ required: false }).source, /ensureAuthenticated/);
  const afterNavigate = compile({ required: true, insertionAfterStepIndex: 1 });
  assert.ok(afterNavigate.source.indexOf("page.goto") < afterNavigate.source.indexOf("authFlow.ensureAuthenticated("));
  // Non-classic path (navigate insertion): AuthFlow unchanged, no transition wait.
  assert.doesNotMatch(afterNavigate.source, /awaitJiraSpecPostLoginTransition\(page\)/);
  assert.deepEqual(compile({ required: true, insertionAfterStepIndex: 99 }).unsupported, ["auth_flow_insertion_step_not_emitted:99"]);
  assert.deepEqual(compile({ required: true }).unsupported, ["auth_flow_insertion_point_missing"]);
});

test("Jira post-login transition waits through the classic form until OTP appears", async () => {
  const stages = ["credentials", "credentials", "unknown", "otp"];
  let calls = 0;
  await awaitJiraSpecPostLoginTransition({} as never, 5_000, async () => ({ stage: stages[Math.min(calls++, stages.length - 1)] }));
  assert.equal(calls, 4);
});

test("Jira post-login transition fails closed when the classic login form stays visible", async () => {
  await assert.rejects(
    awaitJiraSpecPostLoginTransition({} as never, 300, async () => ({ stage: "credentials" })),
    /JIRA_SPEC_AUTH_TRANSITION_FAILED.*credentials likely rejected/,
  );
});

test("Jira post-login transition accepts an authenticated landing immediately", async () => {
  let calls = 0;
  await awaitJiraSpecPostLoginTransition({} as never, 300, async () => { calls++; return { stage: "authenticated_landing" }; });
  assert.equal(calls, 1);
});

const ACCESS_CODE_HTML = (extra = "", disabled = "") =>
  `<main><h1>Verificación de acceso</h1><button>Solicitar código por SMS</button><label>Código de acceso<input type="text"></label><button ${disabled}>Continuar</button>${extra}</main>`;

test("Jira access-code gate: transition routes it apart from standard stages; AuthFlow neighbor stays standard", async () => {
  assert.equal(await awaitJiraSpecPostLoginTransition({} as never, 300, async () => ({ stage: "access_code_gate" })), "access_code_gate");
  assert.equal(await awaitJiraSpecPostLoginTransition({} as never, 300, async () => ({ stage: "otp" })), "standard");
  assert.equal(await awaitJiraSpecPostLoginTransition({} as never, 300, async () => ({ stage: "authenticated_landing" })), "standard");
});

test("Jira access-code gate: page driver detects visible evidence (and absence) from DOM", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(ACCESS_CODE_HTML());
    assert.deepEqual(await jiraAccessCodeGatePageDriver(page).evidence(), { fields: 1, continueControls: 1, enabledContinueControls: 1 });
    await page.setContent(ACCESS_CODE_HTML("", "disabled"));
    assert.equal((await jiraAccessCodeGatePageDriver(page).evidence()).enabledContinueControls, 0);
    await page.setContent(ACCESS_CODE_HTML('<label>Código de acceso<input type="text"></label>'));
    assert.equal((await jiraAccessCodeGatePageDriver(page).evidence()).fields, 2);
    await page.setContent("<main><h1>Inicio</h1><button>Continuar</button></main>");
    assert.equal((await jiraAccessCodeGatePageDriver(page).evidence()).fields, 0);
  } finally { await browser.close(); }
});

const SHELL_OK: JiraAuthenticatedShellEvidence = { authFields: 0, authAlerts: 0, mainRegions: 1, navControls: 5, mainTextLength: 120, mainOperables: 4 };

test("Jira authenticated shell: requires nav + substantial main, no login fields or auth alerts (pure)", () => {
  assert.equal(isJiraAuthenticatedShell(SHELL_OK), true);
  for (const bad of [
    JIRA_NO_SHELL_EVIDENCE,
    { ...SHELL_OK, authFields: 1 },
    { ...SHELL_OK, authAlerts: 1 },
    { ...SHELL_OK, mainRegions: 0 },
    { ...SHELL_OK, navControls: 0 },
    { ...SHELL_OK, mainTextLength: 5 },
    { ...SHELL_OK, mainOperables: 0 },
  ]) assert.equal(isJiraAuthenticatedShell(bad), false);
});

test("Jira authenticated shell: page driver reads structural DOM evidence", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const shell = async (_html: string) => isJiraAuthenticatedShell(await jiraAccessCodeGatePageDriver(page).shell());
    const app = (main: string, extra = "") => `<nav><a href="#a">Inicio</a><a href="#b">Cuentas</a></nav>${extra}<main>${main}</main>`;
    const mainText = "Consulte aquí el detalle de sus productos activos.";
    await page.setContent(app(`<h1>Resumen de productos</h1><p>${mainText}</p><button>Ver detalle</button>`));
    // Exact structural data (a swallowed evaluate error would yield JIRA_NO_SHELL_EVIDENCE).
    assert.deepEqual(await jiraAccessCodeGatePageDriver(page).shell(), {
      authFields: 0, authAlerts: 0, mainRegions: 1, navControls: 2,
      mainTextLength: "Resumen de productos".length + 1 + mainText.length + 1 + "Ver detalle".length, mainOperables: 2,
    });
    assert.equal(await shell(""), true);
    // Real-shell-like markup: header, aside nav with buttons, role=main, hidden login form ignored.
    await page.setContent(`<header><h2>Banco</h2></header><aside><button>Productos</button><a href="#t">Transferencias</a></aside>
      <div role="main"><h1>Bienvenido</h1><p>Seleccione una opción del menú para continuar con su gestión.</p><a href="#x">Ver más</a></div>
      <form style="display:none"><input type="password"></form>`);
    assert.deepEqual(await jiraAccessCodeGatePageDriver(page).shell(), {
      authFields: 0, authAlerts: 0, mainRegions: 1, navControls: 2,
      mainTextLength: "Bienvenido Seleccione una opción del menú para continuar con su gestión. Ver más".length, mainOperables: 2,
    });
    assert.equal(await shell(""), true);
    await page.setContent("<body></body>");
    assert.equal(await shell(""), false);
    await page.setContent(app("<h1>Error</h1>", '<div role="alert">Código inválido</div>'));
    assert.equal(await shell(""), false);
    await page.setContent(app('<h1>Ingreso</h1><p>Ingrese sus datos para continuar con la sesión.</p><label>Contraseña<input type="password"></label><button>Entrar</button>'));
    assert.equal(await shell(""), false);
    await page.setContent(app('<h1>Resumen de productos</h1><p>Consulte aquí el detalle de sus productos activos.</p><label>Código de acceso<input type="text"></label>'));
    assert.equal(await shell(""), false);
    await page.setContent('<main><h1>Resumen de productos</h1><p>Contenido sin navegación lateral visible alguna.</p><button>Ok</button></main>');
    assert.equal(await shell(""), false);
  } finally { await browser.close(); }
});

function fakeGate(opts: { evidence?: JiraAccessCodeGateEvidence; typed?: (code: string) => string; transitions?: boolean; stage?: string; shell?: JiraAuthenticatedShellEvidence } = {}) {
  const calls: string[] = [];
  let clicked = false;
  const ready = opts.evidence ?? { fields: 1, continueControls: 1, enabledContinueControls: 1 };
  const driver: JiraAccessCodeGateDriver = {
    evidence: async () => (clicked && opts.transitions !== false ? { fields: 0, continueControls: 0, enabledContinueControls: 0 } : ready),
    fill: async code => { calls.push("fill"); calls.push(`typed:${code}`); },
    readBack: async () => { calls.push("readBack"); return (opts.typed ?? (c => c))(calls.find(c => c.startsWith("typed:"))!.slice(6)); },
    clickContinue: async () => { calls.push("click"); clicked = true; },
    shell: async () => opts.shell ?? JIRA_NO_SHELL_EVIDENCE,
    stage: async () => opts.stage ?? "authenticated_landing",
  };
  return { driver, calls };
}

test("Jira access-code gate: completes with the configured code, verifying readback before continue and a real transition", async () => {
  const data = { clients: { defaultClient: { otp: "123456" } } };
  const { driver, calls } = fakeGate();
  await completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 500, driver);
  assert.deepEqual(calls.filter(c => !c.startsWith("typed:")), ["fill", "readBack", "click"]);
  assert.equal(calls.find(c => c.startsWith("typed:")), "typed:123456");
  // Alias falls back to OTP_SECRET like AuthFlow; nothing configured -> undefined.
  const previous = process.env.OTP_SECRET;
  try {
    process.env.OTP_SECRET = "654321";
    assert.equal(resolveJiraAccessCodeOtp({}, "other"), "654321");
    delete process.env.OTP_SECRET;
    assert.equal(resolveJiraAccessCodeOtp({ clients: { defaultClient: { otp: " " } } }, "defaultClient"), undefined);
  } finally { if (previous === undefined) delete process.env.OTP_SECRET; else process.env.OTP_SECRET = previous; }
});

test("Jira access-code resolution: profile value beats OTP_SECRET, client alias beats profile, conflicts fail closed without leaking", () => {
  const previous = process.env.OTP_SECRET;
  try {
    process.env.OTP_SECRET = "env-secret";
    assert.equal(resolveJiraAccessCodeOtp({ auth: { access_code: "111111" } }, "x"), "111111");
    assert.equal(resolveJiraAccessCodeOtp({ "auth.access_code": "222222", access_code: "222222" }, "x"), "222222");
    assert.equal(resolveJiraAccessCodeOtp({ codigo_acceso: "333333" }, "x"), "333333");
    assert.equal(resolveJiraAccessCodeOtp({ access_code: "111111", clients: { c: { otp: "444444" } } }, "c"), "444444");
    assert.equal(resolveJiraAccessCodeOtp({}, "x"), "env-secret");
    assert.throws(
      () => resolveJiraAccessCodeOtp({ access_code: "555555", otp: "666666" }, "x"),
      (error: Error) => /JIRA_SPEC_ACCESS_CODE_AMBIGUOUS/.test(error.message) && !/555555|666666|env-secret/.test(error.message),
    );
  } finally { if (previous === undefined) delete process.env.OTP_SECRET; else process.env.OTP_SECRET = previous; }
});

test("Jira auth test data merge: profile defaults fill gaps, env explicit values win, clients merge per property, no values leak", () => {
  const previous = process.env.OTP_SECRET;
  try {
    process.env.OTP_SECRET = "env-secret";
    const profile = { "auth.access_code": "111111", clients: { c: { identificationNumber: "p-id", otp: "222222" } } };
    // env has user but no otp -> profile access code (not OTP_SECRET) reaches the resolver, env extras kept.
    const noOtp = mergeJiraAuthTestData({ "auth.access_code": "111111" }, { clients: { c: { identificationNumber: "e-id" } }, extra: { a: 1 } });
    assert.equal(resolveJiraAccessCodeOtp(noOtp, "c"), "111111");
    assert.deepEqual(noOtp.extra, { a: 1 });
    assert.equal((noOtp.clients as any).c.identificationNumber, "e-id");
    // env client otp wins over profile client otp; profile-only client properties survive.
    const explicit = mergeJiraAuthTestData(profile, { clients: { c: { otp: "333333" } } });
    assert.equal(resolveJiraAccessCodeOtp(explicit, "c"), "333333");
    assert.equal((explicit.clients as any).c.identificationNumber, "p-id");
    assert.equal(mergeJiraAuthTestData(profile, { "auth.access_code": "444444" })["auth.access_code"], "444444");
    // inputs not mutated
    assert.equal((profile.clients.c as any).otp, "222222");
    // conflicting spellings across sources stay fail-closed without leaking values
    const conflict = mergeJiraAuthTestData({ "auth.access_code": "555555" }, { access_code: "666666" });
    assert.throws(
      () => resolveJiraAccessCodeOtp(conflict, "x"),
      (error: Error) => /JIRA_SPEC_ACCESS_CODE_AMBIGUOUS/.test(error.message) && !/555555|666666|env-secret/.test(error.message),
    );
  } finally { if (previous === undefined) delete process.env.OTP_SECRET; else process.env.OTP_SECRET = previous; }
});

test("Jira access-code gate: fails closed without otp, on missing/ambiguous evidence, bad readback, rejected code, or no transition", async () => {
  const data = { clients: { defaultClient: { otp: "123456" } } };
  const previous = process.env.OTP_SECRET;
  delete process.env.OTP_SECRET;
  try {
    const missing = fakeGate();
    await assert.rejects(completeJiraSpecAccessCodeGate({} as never, {}, "defaultClient", 300, missing.driver), /JIRA_SPEC_ACCESS_CODE_OTP_MISSING/);
    assert.deepEqual(missing.calls, []);
  } finally { if (previous !== undefined) process.env.OTP_SECRET = previous; }
  for (const evidence of [
    { fields: 0, continueControls: 1, enabledContinueControls: 1 },
    { fields: 2, continueControls: 1, enabledContinueControls: 1 },
    { fields: 1, continueControls: 0, enabledContinueControls: 0 },
    { fields: 1, continueControls: 2, enabledContinueControls: 2 },
  ]) {
    const gate = fakeGate({ evidence });
    await assert.rejects(completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 300, gate.driver), /JIRA_SPEC_ACCESS_CODE_GATE_NOT_ACTIONABLE/);
    assert.deepEqual(gate.calls, []);
  }
  const disabled = fakeGate({ evidence: { fields: 1, continueControls: 1, enabledContinueControls: 0 } });
  await assert.rejects(completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 300, disabled.driver), /JIRA_SPEC_ACCESS_CODE_CONTINUE_DISABLED/);
  assert.ok(!disabled.calls.includes("click"));
  const mismatch = fakeGate({ typed: () => "000000" });
  await assert.rejects(completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 300, mismatch.driver), /JIRA_SPEC_ACCESS_CODE_READBACK_MISMATCH/);
  assert.ok(!mismatch.calls.includes("click"));
  const rejected = fakeGate({ transitions: false });
  await assert.rejects(completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 300, rejected.driver), /JIRA_SPEC_ACCESS_CODE_REJECTED/);
  const backToLogin = fakeGate({ stage: "credentials" });
  await assert.rejects(completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 300, backToLogin.driver), /JIRA_SPEC_ACCESS_CODE_NO_TRANSITION/);
  const arbitraryPage = fakeGate({ stage: "unknown" });
  await assert.rejects(completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 300, arbitraryPage.driver), /JIRA_SPEC_ACCESS_CODE_NO_TRANSITION/);
  // Unknown stage: only a positive authenticated shell counts; known credentials stage is never rescued by shell evidence.
  const shellUnknown = fakeGate({ stage: "unknown", shell: SHELL_OK });
  await completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 300, shellUnknown.driver);
  for (const shell of [JIRA_NO_SHELL_EVIDENCE, { ...SHELL_OK, authAlerts: 1 }, { ...SHELL_OK, authFields: 1 }, { ...SHELL_OK, navControls: 0 }]) {
    const bad = fakeGate({ stage: "unknown", shell });
    await assert.rejects(completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 300, bad.driver), /JIRA_SPEC_ACCESS_CODE_NO_TRANSITION/);
  }
  const credentialsWithShell = fakeGate({ stage: "credentials", shell: SHELL_OK });
  await assert.rejects(completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 300, credentialsWithShell.driver), /JIRA_SPEC_ACCESS_CODE_NO_TRANSITION/);
  for (const stage of ["otp", "pin", "token", "authenticated_landing"]) {
    await completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 300, fakeGate({ stage }).driver);
  }
  // Error text never leaks the configured code.
  await assert.rejects(completeJiraSpecAccessCodeGate({} as never, data, "defaultClient", 300, mismatch.driver), (error: Error) => !error.message.includes("123456"));
});

test("Jira compiler routes a classic-login gate to access-code completion or AuthFlow, still emitting AuthFlow exactly once", () => {
  const plan: ExecutionPlan = {
    version: "1.0", source: "discovery_generated", status: "validated",
    scenario: { source: "jira", title: "Login then access code" }, requiredData: [],
    steps: [
      { index: 1, action: "navigate", target: "APP_BASE_URL" },
      { index: 2, action: "fill", valueKey: "auth.username", target: { strategy: "css", value: "#user" }, description: "fill [auth.username]" },
      { index: 3, action: "click", target: { strategy: "role", role: "button", name: "Iniciar sesión", exact: true }, description: "click Iniciar sesión" },
    ],
    createdAt: new Date(0).toISOString(),
  };
  const source = compileJiraSpec({ plan, sourceScenario: { auth: { required: true, insertionAfterStepIndex: 3, flowAlias: "alias1" } }, appSlug: "fixture", sectionSlug: "jira", automationId: "case", specPath: "fixture/case.spec.ts" }).source;
  assert.match(source, /const authTestData = await resolveJiraSpecAuthTestData\(appSlug\)/);
  assert.match(source, /postLoginGate === "access_code_gate"[\s\S]*completeJiraSpecAccessCodeGate\(page, authTestData, "alias1"\)[\s\S]*else \{[\s\S]*authFlow\.ensureAuthenticated\(\{ alias: "alias1" \}\)/);
  assert.equal(source.match(/authFlow\.ensureAuthenticated\(/g)?.length, 1);
  // Non-classic insertion: no access-code branch.
  const nav = compileJiraSpec({ plan, sourceScenario: { auth: { required: true, insertionAfterStepIndex: 1 } }, appSlug: "fixture", sectionSlug: "jira", automationId: "case", specPath: "fixture/case.spec.ts" }).source;
  assert.doesNotMatch(nav, /completeJiraSpecAccessCodeGate\(page/);
});

test("Jira compiler preserves the complete semantic step for assertions", () => {
  const description = 'Validar "tipo" de cada cuenta presentada.';
  const plan: ExecutionPlan = {
    version: "1.0", source: "discovery_generated", status: "validated",
    scenario: { source: "jira", title: "Account property assertion" }, requiredData: [],
    steps: [{ index: 1, action: "assertVisible", target: { strategy: "text", value: "tipo", exact: true }, description }],
    createdAt: new Date(0).toISOString(),
  };
  const compiled = compileJiraSpec({ plan, sourceScenario: {}, appSlug: "fixture", sectionSlug: "jira", automationId: "case", specPath: "fixture/case.spec.ts" });
  assert.deepEqual(compiled.unsupported, []);
  assert.ok(compiled.source.includes(`assertJiraSpecVisibleText(page, "tipo", 15000, ${JSON.stringify(description)})`));
});

test("Jira compiler gives assertion-heavy specs the same timeout budget used by promotion", () => {
  const plan: ExecutionPlan = {
    version: "1.0", source: "discovery_generated", status: "validated",
    scenario: { source: "jira", title: "Assertion timeout budget" }, requiredData: [],
    steps: Array.from({ length: 14 }, (_, index) => index < 4
      ? { index: index + 1, action: "assertVisible" as const, target: { strategy: "text" as const, value: `Visible ${index + 1}` } }
      : { index: index + 1, action: "click" as const, target: { strategy: "text" as const, value: `Action ${index + 1}` } }),
    createdAt: new Date(0).toISOString(),
  };
  const compiled = compileJiraSpec({ plan, sourceScenario: {}, appSlug: "fixture", sectionSlug: "jira", automationId: "case", specPath: "fixture/case.spec.ts" });
  assert.deepEqual(compiled.unsupported, []);
  assert.match(compiled.source, /test\.setTimeout\(Math\.max\(test\.info\(\)\.timeout, 408000\)\)/);
});

test("Jira compiler honors the timeout explicitly resolved by promotion", () => {
  const plan: ExecutionPlan = {
    version: "1.0", source: "discovery_generated", status: "validated",
    scenario: { source: "jira", title: "Explicit timeout budget" }, requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Continue" } }],
    createdAt: new Date(0).toISOString(),
  };
  const compiled = compileJiraSpec({ plan, sourceScenario: {}, appSlug: "fixture", sectionSlug: "jira", automationId: "case", specPath: "fixture/case.spec.ts", verificationTimeoutMs: 240_000 });
  assert.match(compiled.source, /test\.setTimeout\(Math\.max\(test\.info\(\)\.timeout, 240000\)\)/);
});

test("Jira compiler carries step semantics alongside a technical locator for runtime recovery", () => {
  const plan: ExecutionPlan = {
    version: "1.0", source: "discovery_generated", status: "validated",
    scenario: { source: "jira", title: "Semantic target fallback" }, requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "css", value: "#discovery-id" }, description: 'Presionar "Autorizar transferencia"' }],
    createdAt: new Date(0).toISOString(),
  };
  const compiled = compileJiraSpec({ plan, sourceScenario: {}, appSlug: "fixture", sectionSlug: "jira", automationId: "case", specPath: "fixture/case.spec.ts" });
  assert.deepEqual(compiled.unsupported, []);
  assert.ok(compiled.source.includes('clickJiraSpecTarget(page, {"strategy":"css","value":"#discovery-id"}, 2500, "Presionar \\\"Autorizar transferencia\\\"")'));
});
