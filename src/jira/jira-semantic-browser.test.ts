import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { createJiraPlaywrightPort, discoverJiraScenario } from "./jira-semantic-executor";
import { __setJiraDomTargetResolverForTesting } from "./jira-dom-target-ai";
import { compileJiraSpec } from "./jira-spec-compiler";
import { promoteJiraSpec } from "./jira-spec-promotion";
import { observeJiraFieldValidation } from "./jira-field-validation";
import { __setJiraDomAssertionResolverForTesting } from "./jira-dom-assertion-ai";
import { assertJiraSpecVisibleText } from "./jira-spec-runtime";
import { config } from "../config/env";
import type { ExecutionPlan } from "../types/execution-plan.types";

test("two isolated web profiles discover actual controls; compiled gate spec executes on local fixture", { timeout: 180000 }, async () => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    const name = req.url === "/b" ? "Continuar" : "Solicitar";
    res.end(`<html><body><label for="reference">Referencia</label><input id="reference"><label for="currency">Moneda</label><select id="currency"><option>DOP</option><option>USD</option></select><button id="request" onclick="document.getElementById('gate').hidden=false">${name}</button><form id="gate" hidden><h1>Iniciar sesión</h1><label for="user">Usuario</label><input id="user"><label for="pwd">Contraseña</label><input id="pwd" type="password"><button>Acceder</button></form></body></html>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const root = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const dir = await fs.mkdtemp(path.resolve(".artifacts/jira-web-fixture-"));
  const promotionProfile = `jira-fixture-${path.basename(dir).split('-').at(-1)!.toLowerCase()}`;
  const globalIndexPath = path.resolve("automations/index.json");
  const globalIndexBefore = await fs.readFile(globalIndexPath, "utf8").catch(() => undefined);
  try {
    for (const [profile, target] of [["a", "Solicitar"], ["b", "Continuar"]]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const discovered = await discoverJiraScenario({ scenarioId: `JIRA-${profile}`, sourceIssueKey: "AA-88", title: `Gate ${profile}`, steps: ['Ingresar "synthetic-value" en "Referencia"', 'Seleccionar "USD" en "Moneda"', `Presionar "${target}"`, "Validar pantalla de autenticación para iniciar sesión"], expectedResult: "" }, createJiraPlaywrightPort(page, `${root}/${profile}`));
        assert.equal(page.url(), `${root}/${profile}`);
        assert.equal(discovered.plan.steps[3].target && (discovered.plan.steps[3].target as { value: string }).value, '[id="request"]');
        const file = path.join(dir, "case.spec.ts");
        const compiled = compileJiraSpec({ plan: discovered.plan, sourceScenario: discovered.sourceScenario,
          appSlug: promotionProfile, sectionSlug: "jira-aa-88", automationId: "fixture", specPath: file });
        assert.deepEqual(compiled.unsupported, []);
        assert.doesNotMatch(compiled.source, /promoted-spec-runtime|promoteExecutionPlan|deterministic-spec-compiler|spec-generation-hybrid/);
        await fs.writeFile(file, compiled.source);
        const configPath = path.join(dir, "playwright.config.ts");
        await fs.writeFile(configPath, `export default { testDir: ${JSON.stringify(dir)}, timeout: 20000, workers: 1, use: { headless: true } };`);
        const { stdout } = await promisify(execFile)(process.execPath, [require.resolve("@playwright/test/cli"), "test", "--config", configPath], {
          cwd: process.cwd(), timeout: 45000, env: { ...process.env, APP_BASE_URL: `${root}/${profile}`, HEADLESS: "true", EVIDENCE_PER_SCENARIO_DOCX: "false",
            EVIDENCE_APP_SLUG: "jira-fixture", EVIDENCE_SECTION_SLUG: "synthetic", EVIDENCE_RUN_ID: path.basename(dir), EVIDENCE_SCENARIO_ID: `jira-${profile}`,
            JIRA_SPEC_RUNTIME_VALUES_JSON: JSON.stringify({ jira_step_1: "synthetic-value", jira_step_2: "USD" }) }, maxBuffer: 1024 * 1024,
        });
        assert.match(stdout, /1 passed/);
        if (profile === "a") {
          const entry = await promoteJiraSpec({ plan: discovered.plan, sourceScenario: discovered.sourceScenario,
            appSlug: promotionProfile, baseUrl: `${root}/${profile}`,
            fullConfig: { ...config, app: { ...config.app, appProfile: promotionProfile, baseUrl: `${root}/${profile}`,
              username: undefined, password: undefined, testData: {}, rawTestData: {}, testDataAliases: {}, extraLoginFields: {} } },
            runtimeValues: { jira_step_1: "synthetic-value", jira_step_2: "USD" }, sectionSlug: "jira-aa-88", overwrite: false });
          assert.equal(entry.status, "active");
          assert.equal(entry.specVerificationStatus, "passed");
          assert.match(await fs.readFile(entry.specPath, "utf8"), /resolveJiraSpecValue/);
        }
      } finally { await context.close(); }
    }
  } finally {
    await browser.close(); server.close(); await once(server, "close");
    await fs.rm(path.resolve("automations/apps", promotionProfile), { recursive: true, force: true });
    if (globalIndexBefore === undefined) await fs.rm(globalIndexPath, { force: true });
    else await fs.writeFile(globalIndexPath, globalIndexBefore, "utf8");
    // Keep synthetic artifacts for inspection outside the official spec collection.
  }
});

test("Jira selection repairs an incomplete repeated-row label from an observed select", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><table><tbody><tr><td><label for="income-frequency-1">Frecuencia de ingreso fila 1</label><select id="income-frequency-1"><option value="">Selecciona una frecuencia</option><option value="Monthly">Mensual</option></select></td></tr></tbody></table></main>`);
    let observedIntent = "";
    __setJiraDomTargetResolverForTesting(async (intent, candidates) => {
      observedIntent = intent;
      const candidate = candidates.find(item => (item.role === "combobox" || item.tagName === "select") && /Frecuencia de ingreso fila 1/i.test(item.label));
      return candidate ? { candidateId: candidate.id, confidence: 0.95 } : undefined;
    });
    const port = createJiraPlaywrightPort(page, "http://127.0.0.1/");
    await port.act({ index: 1, action: "select", description: "Seleccionar frecuencia en fila 1" } as never,
      "Frecuencia de la fila 1", "Mensual", "Seleccionar frecuencia de la fila 1");
    // An explicit "fila 1" resolves deterministically in-row before the AI chooser; when the chooser
    // does run, its intent is "<semanticContext>. Target: <target>" (never the bare target).
    if (observedIntent) assert.equal(observedIntent, "Seleccionar frecuencia de la fila 1. Target: Frecuencia de la fila 1");
    assert.equal(await page.locator("#income-frequency-1").inputValue(), "Monthly");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira repeated-row targets fill and select the requested dynamic table row", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><table><thead><tr><th>Concepto</th><th>Importe mensual</th><th>Frecuencia</th></tr></thead><tbody>
      <tr><td>Ingreso 1</td><td><input id="amount-1" aria-label="Importe fila 1"></td><td><select id="frequency-1" aria-label="Frecuencia fila 1"><option value="">Seleccione frecuencia</option><option value="monthly">Mensual</option></select></td></tr>
      <tr><td>Ingreso 2</td><td><input id="amount-2" aria-label="Importe fila 2"></td><td><select id="frequency-2" aria-label="Frecuencia fila 2"><option value="">Seleccione frecuencia</option><option value="monthly">Mensual</option></select></td></tr>
    </tbody></table></main>`);
    const port = createJiraPlaywrightPort(page, "http://127.0.0.1/");
    await port.act({ index: 1, action: "fill", description: "fill [income-row-2]" } as never,
      "Importe mensual de la fila 2", "500", "Ingresar importe mensual en fila 2");
    assert.equal(await page.locator("#amount-1").inputValue(), "");
    assert.equal(await page.locator("#amount-2").inputValue(), "500");
    await port.act({ index: 2, action: "select", description: "select [frequency-row-2]" } as never,
      "Frecuencia de la fila 2", "Mensual", "Seleccionar frecuencia en fila 2");
    assert.equal(await page.locator("#frequency-1").inputValue(), "");
    assert.equal(await page.locator("#frequency-2").inputValue(), "monthly");
  } finally {
    await browser.close();
  }
});

test("Jira row/column select binds the unlabeled control in its column cell, waits for async options and keeps the option value", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><table><thead><tr><th>CONCEPTO</th><th>IMPORTE MENSUAL (RD$)</th><th>FRECUENCIA</th></tr></thead><tbody>
      <tr><td><select id="kind-1"><option value="">Selecciona un concepto</option><option value="k1">Salario</option></select></td>
      <td><input id="amount-1"></td>
      <td><select id="freq-1"><option value="">Selecciona una frecuencia</option></select></td></tr></tbody></table>
      <script>setTimeout(() => document.getElementById("freq-1").insertAdjacentHTML("beforeend", '<option value="MTH">Mensual</option><option value="WK">Semanal</option>'), 1200);</script></main>`);
    const port = createJiraPlaywrightPort(page, "http://127.0.0.1/");
    await port.act({ index: 1, action: "select", description: "select [frequency-row-1]" } as never,
      "Frecuencia de la fila 1", "Semanal", "Seleccionar frecuencia en Frecuencia de la fila 1");
    assert.equal(await page.locator("#freq-1").inputValue(), "WK");
    assert.equal(await page.locator("#kind-1").inputValue(), "");
  } finally {
    await browser.close();
  }
});

test("Jira row-scoped select fails closed instead of using a control from another row", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><table><thead><tr><th>Concepto</th><th>Frecuencia</th></tr></thead><tbody>
      <tr><td>Ingreso 1</td><td>sin control</td></tr>
      <tr><td>Ingreso 2</td><td><select id="freq-2" aria-label="Frecuencia"><option value="">Selecciona una frecuencia</option><option value="MTH">Mensual</option></select></td></tr>
    </tbody></table></main>`);
    // Worst case: the DOM chooser proposes the row-2 select; the row gate must reject it.
    __setJiraDomTargetResolverForTesting(async (_intent, candidates) => ({ candidateId: candidates[0].id, confidence: 0.9 }));
    const port = createJiraPlaywrightPort(page, "http://127.0.0.1/");
    await assert.rejects(() => port.act({ index: 1, action: "select", description: "select [frequency-row-1]" } as never,
      "Frecuencia de la fila 1", "Mensual", "Seleccionar frecuencia en Frecuencia de la fila 1"), /JIRA_TARGET_/);
    assert.equal(await page.locator("#freq-2").inputValue(), "");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});

test("login selector group: selected and unselected choice are recognised, ordinary button is not", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // Choice group is a sibling of the credential <form>, inside the shared panel.
    await page.setContent(`<main><section><div class="toggle"><button type="button" class="active">Personas</button><button type="button">Empresas</button></div>
      <form><input aria-label="Usuario"><input type="password" aria-label="Contraseña">
      <div><button type="button">Solicitar código por SMS</button></div><button type="submit">Ingresar</button></form></section></main>`);
    const port = createJiraPlaywrightPort(page, "http://127.0.0.1/");
    assert.equal(await port.isLoginSelectorOption!("Personas"), true);
    assert.equal(await port.isLoginSelectorOption!("Empresas"), true);
    assert.equal(await port.isLoginSelectorOption!("Solicitar código por SMS"), false);
  } finally {
    await browser.close();
  }
});

test("Jira can verify an explicitly requested navigation entry without treating sidebar text as page content", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<aside><nav><a href="/transfers">Transferencias</a></nav></aside><main><h1>Resumen personal</h1></main>`);
    const port = createJiraPlaywrightPort(page, "http://127.0.0.1/");
    assert.deepEqual(await port.assert("transferencias", false), { observedText: "Transferencias" });
    await assert.rejects(port.assert("Solicitudes", false), /JIRA_ASSERTION_NOT_SATISFIED/);
  } finally {
    await browser.close();
  }
});

test("Jira result-count indicator accepts a compact visible badge inside main and rejects a bare heading or count prose", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const port = createJiraPlaywrightPort(page, "http://127.0.0.1/");
    await page.setContent(`<header>Banco</header><main><h1>Resultados</h1><span class="badge">1 resultados</span></main>`);
    assert.deepEqual(await port.assert("el indicador de cantidad de resultados", false), { observedText: "1 resultados" });

    await page.setContent(`<header>Banco</header><main><h1>Resultados</h1><p>Se encontró 1 resultados para su búsqueda</p></main>`);
    await assert.rejects(port.assert("el indicador de cantidad de resultados", false), /JIRA_ASSERTION_NOT_SATISFIED/);
  } finally {
    await browser.close();
  }
});

test("Jira leading notification descriptor is satisfied by a role=status message with the substantive content and still fails on mismatch", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const port = createJiraPlaywrightPort(page, "http://127.0.0.1/");
    const expected = "aviso 1 movimientos exportados en CSV: estado-de-cuenta-regression-lab.csv";
    await page.setContent(`<main><h1>Exportar</h1><div role="status">1 movimientos exportados en CSV: estado-de-cuenta-regression-lab.csv</div></main>`);
    await assert.doesNotReject(port.assert(expected, false));

    await page.setContent(`<main><h1>Exportar</h1><div role="status">2 movimientos exportados en CSV: otro-archivo.csv</div></main>`);
    await assert.rejects(port.assert(expected, false), /JIRA_ASSERTION_NOT_SATISFIED/);
  } finally {
    await browser.close();
  }
});

test("field-validation assertions require an invalid control plus its associated error across profiles", { timeout: 90000 }, async () => {
  const server = createServer((req, res) => {
    const profile = req.url === "/b" ? "b" : "a";
    const label = profile === "a" ? "Importe de ingreso fila 2" : "Teléfono de contacto";
    const error = profile === "a"
      ? `<p id="field-error" role="alert" hidden></p><input id="field" aria-describedby="field-error" required>`
      : `<input id="field" aria-label="${label}" required><p id="field-error" role="alert" hidden></p>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<main><h1>Solicitud</h1><form novalidate><label for="field">${label}</label>${error}<button type="submit">Continuar</button></form><script>document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();const field=document.querySelector('#field');field.setAttribute('aria-invalid','true');const error=document.querySelector('#field-error');error.textContent='Campo incompleto: ${label}.';error.hidden=false;});</script></main>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const root = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const tempDir = await fs.mkdtemp(path.resolve(".artifacts/jira-field-validation-"));
  const previousAppBaseUrl = process.env.APP_BASE_URL;
  const previousValues = process.env.JIRA_SPEC_RUNTIME_VALUES_JSON;
  try {
    for (const profile of ["a", "b"] as const) {
      const label = profile === "a" ? "Importe de ingreso fila 2" : "Teléfono de contacto";
      const page = await browser.newPage();
      try {
        await page.goto(`${root}/${profile}`);
        const absentBefore = await observeJiraFieldValidation(page, label);
        assert.equal(absentBefore, undefined, "a visible label alone must not satisfy field validation");
        await page.getByRole("button", { name: "Continuar" }).click();
        assert.equal((await observeJiraFieldValidation(page, label))?.associatedError, true, "fixture exposes linked field error after submit");
        await page.goto(`${root}/${profile}`);
        const discovered = await discoverJiraScenario({ scenarioId: `FIELD-${profile}`, sourceIssueKey: `HU-${profile}`, title: `Invalid ${label}`,
          appSlug: `field-profile-${profile}`, steps: ["Abrir la aplicación configurada del proyecto", 'Presionar "Continuar"',
            `Validar que el campo "${label}" muestre un error de validación`], expectedResult: `El campo "${label}" muestra un error de validación.` },
          createJiraPlaywrightPort(page, `${root}/${profile}`));
        const oracle = discovered.sourceScenario.observableOracles?.find(item => item.type === "field_validation");
        assert.equal(oracle?.backed, true);
        assert.equal(oracle?.target, label);
        assert.equal((await observeJiraFieldValidation(page, label))?.associatedError, true);
        const specPath = path.join(tempDir, `case-${profile}.spec.ts`);
        const compiled = compileJiraSpec({ plan: discovered.plan, sourceScenario: discovered.sourceScenario, appSlug: `field-profile-${profile}`,
          sectionSlug: "field-validation", automationId: `fixture-${profile}`, specPath });
        assert.deepEqual(compiled.unsupported, []);
        assert.match(compiled.source, /assertJiraSpecFieldValidation\(page/);
        await fs.writeFile(specPath, compiled.source);
      } finally { await page.close(); }
    }
    const configPath = path.join(tempDir, "playwright.config.ts");
    await fs.writeFile(configPath, `export default { testDir: ${JSON.stringify(tempDir)}, timeout: 20000, workers: 1, use: { headless: true } };`);
    process.env.JIRA_SPEC_RUNTIME_VALUES_JSON = "{}";
    for (const profile of ["a", "b"] as const) {
      const { stdout } = await promisify(execFile)(process.execPath, [require.resolve("@playwright/test/cli"), "test", "--config", configPath, `case-${profile}.spec.ts`], {
        cwd: process.cwd(), timeout: 45000, env: { ...process.env, APP_BASE_URL: `${root}/${profile}`, HEADLESS: "true", EVIDENCE_PER_SCENARIO_DOCX: "false",
          EVIDENCE_APP_SLUG: `field-validation-${profile}`, EVIDENCE_SECTION_SLUG: "fixture", EVIDENCE_RUN_ID: path.basename(tempDir) }, maxBuffer: 1024 * 1024,
      });
      assert.match(stdout, /1 passed/);
    }
  } finally {
    if (previousAppBaseUrl === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = previousAppBaseUrl;
    if (previousValues === undefined) delete process.env.JIRA_SPEC_RUNTIME_VALUES_JSON; else process.env.JIRA_SPEC_RUNTIME_VALUES_JSON = previousValues;
    await browser.close(); server.close(); await once(server, "close");
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("field-validation resolves a table column header to the single invalid row corroborated by a named error and fails closed otherwise", { timeout: 60000 }, async () => {
  const table = (invalid: number[], alert: string) => `<main><table><thead><tr><th>Fuente</th><th>Importe mensual (RD$)</th></tr></thead><tbody>${[1, 2].map((row) =>
    `<tr><td>Fila ${row}</td><td><input aria-label="Importe de ingreso fila ${row}" ${invalid.includes(row) ? 'aria-invalid="true"' : ""}></td></tr>`).join("")}</tbody></table>${alert}</main>`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const observe = async (html: string) => { await page.setContent(html); return await observeJiraFieldValidation(page, "Importe mensual"); };
    const named = await observe(table([2], '<p role="alert">Campo incompleto: Importe de ingreso fila 2.</p>'));
    assert.equal(named?.associatedError, true);
    assert.equal(named?.fieldLabel, "Importe de ingreso fila 2");
    assert.equal(await observe(table([2], '<p role="alert">Campo incompleto: Importe de ingreso fila 1.</p>')), undefined, "alert naming another row cannot satisfy");
    assert.equal(await observe(table([1, 2], '<p role="alert">Campo incompleto: Importe de ingreso fila 2.</p>')), undefined, "several invalid rows fail closed");
    assert.equal(await observe(table([2], '<p role="alert">Campo incompleto.</p>')), undefined, "generic alert cannot satisfy");
    assert.equal(await observe(table([], '<p role="alert">Campo incompleto: Importe de ingreso fila 2.</p>')), undefined, "header alone cannot satisfy");
    await page.close();
  } finally { await browser.close(); }
});

test("field-validation uses the table column when a broad target matches several row controls", { timeout: 60000 }, async () => {
  const table = (invalid: number[], alert: string) => `<main><table><thead><tr><th>Concepto</th><th>Importe mensual (RD$)</th></tr></thead><tbody>${[1, 2].map((row) =>
    `<tr><td>Fila ${row}</td><td><input aria-label="Importe de compromiso fila ${row}" ${invalid.includes(row) ? 'aria-invalid="true"' : ""}></td></tr>`).join("")}</tbody></table>${alert}</main>`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const observe = async (html: string) => { await page.setContent(html); return await observeJiraFieldValidation(page, "Importe"); };
    const named = await observe(table([2], '<p role="alert">Campo incompleto: Importe de compromiso fila 2.</p>'));
    assert.equal(named?.associatedError, true);
    assert.equal(named?.fieldLabel, "Importe de compromiso fila 2");
    assert.equal(await observe(table([1, 2], '<p role="alert">Campo incompleto: Importe de compromiso fila 2.</p>')), undefined, "both invalid is ambiguous");
    assert.equal(await observe(table([2], '<p role="alert">Campo incompleto.</p>')), undefined, "generic alert cannot satisfy");
    await page.close();
  } finally { await browser.close(); }
});

test("same-origin declared route and visible precondition execute against the browser",{ timeout: 30000 }, async () => {
  const server = createServer((req, res) => {
    const page = req.url === "/requests";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(page
      ? '<html><body><h1>Portal de solicitudes</h1><button>Nueva solicitud</button></body></html>'
      : '<html><body><p>Portal de solicitudes</p><a href="/requests">Ir a solicitudes</a></body></html>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const root = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const discovered = await discoverJiraScenario({ scenarioId: "JIRA-ROUTE", sourceIssueKey: "AA-88", title: "Open requests",
      preconditions: ['Está visible "Portal de solicitudes"'], steps: ["Navegar a la página /requests", 'Presionar "Nueva solicitud"'], expectedResult: "" },
      createJiraPlaywrightPort(page, root));
    assert.equal(page.url(), `${root}/requests`);
    assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "assertVisible", "navigate", "click"]);
    assert.deepEqual(discovered.plan.steps[3].target, { strategy: "role", role: "button", name: "Nueva solicitud", exact: true });
  } finally { await browser.close(); server.close(); await once(server, "close"); }
});

test("Jira waits for screen content instead of accepting a loading-page breadcrumb", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body>
      <main><header><div class="breadcrumb">Confirmación de pago</div></header>
        <section id="content"><div role="status">Cargando información segura</div></section></main>
      <script>setTimeout(() => { document.querySelector('#content').innerHTML = '<h1>Confirmación de pago</h1><button id="confirm">Confirmar pago</button>'; }, 400)</script>
    </body></html>`);
    const port = createJiraPlaywrightPort(page, "http://jira-loading-fixture.local");
    const startedAt = Date.now();
    const observation = await port.assert("Confirmación de pago", false, false);
    assert.ok(Date.now() - startedAt >= 300, "assertion should wait for the main screen after its breadcrumb appears");
    assert.equal(observation.observedText, "Confirmación de pago");
    await page.locator("#confirm").evaluate(element => element.addEventListener("click", () => { document.body.dataset.confirmed = "yes"; }));
    await port.act({ index: 1, action: "click", description: "Confirmar" } as never, "Confirmar pago");
    assert.equal(await page.locator("body").getAttribute("data-confirmed"), "yes");
  } finally {
    await browser.close();
  }
});

test("Jira follows the live combobox when scenario prose says enter, without changing native text fills", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body>
      <label for="contract">Tipo de contrato</label>
      <select id="contract"><option value="fixed">Indefinido</option><option value="temporary">Temporal</option></select>
      <label for="income-type">ingreso tipo 1</label>
      <select id="income-type"><option value="salary">Salario</option><option value="bonus">Bonificación</option></select>
      <label for="employer">Nombre del empleador</label><input id="employer" />
    </body></html>`);
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    const selectionStep = { index: 1, action: "fill", description: "Ingresar tipo de contrato" } as never;
    await port.act(selectionStep, "Tipo de contrato", "Temporal", "Ingresar tipo de contrato en Tipo de contrato");
    assert.equal((selectionStep as { action: string }).action, "select");
    assert.equal(await page.locator("#contract").inputValue(), "temporary");

    const tableSelectStep = { index: 2, action: "fill", description: "Ingresar tipo de ingreso" } as never;
    await port.act(tableSelectStep, "Tipo", "Salario", "Ingresar tipo de ingreso en Tipo");
    assert.equal((tableSelectStep as { action: string }).action, "select");
    assert.equal(await page.locator("#income-type").inputValue(), "salary");

    const textStep = { index: 3, action: "fill", description: "Ingresar nombre del empleador" } as never;
    await port.act(textStep, "Nombre del empleador", "Empresa ficticia", "Ingresar nombre del empleador en Nombre del empleador");
    assert.equal((textStep as { action: string }).action, "fill");
    assert.equal(await page.locator("#employer").inputValue(), "Empresa ficticia");
  } finally {
    await browser.close();
  }
});

test("Jira Discovery resolves a labelled range control and confirms the requested numeric value", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <label for="approval-limit-slider">Ajuste visual: <output id="limit-output">RD$25,000</output></label>
      <input id="approval-limit-slider" type="range" min="5000" max="100000" step="5000" value="25000" aria-label="Ajuste visual">
      <script>document.querySelector('#approval-limit-slider').addEventListener('input', event => { document.querySelector('#limit-output').textContent = 'RD$' + Number(event.target.value).toLocaleString('en-US'); });</script>
    </main>`);
    const step = { index: 1, action: "fill", description: 'Ingresar "RD$30,000" en "Ajuste visual".' } as never;
    await createJiraPlaywrightPort(page, "https://fixture.invalid").act(step, "Ajuste visual", "RD$30,000");
    assert.equal((step as { action: string }).action, "select", "the live slider role should correct a prose fill action");
    assert.equal(await page.locator("#approval-limit-slider").inputValue(), "30000");
    assert.equal(await page.locator("#limit-output").innerText(), "RD$30,000");
    const numericObservation = await createJiraPlaywrightPort(page, "https://fixture.invalid").assert("30000", false);
    assert.match(numericObservation.observedText ?? "", /30000/);
    const rangePort = createJiraPlaywrightPort(page, "https://fixture.invalid");
    await assert.doesNotReject(rangePort.assert("RD$5,000 a RD$100,000", false));
    await assert.doesNotReject(rangePort.assert("incrementos de RD$5,000", false));
  } finally {
    await browser.close();
  }
});

test("Jira select instruction fills a unique labelled text input; ordinary select/fill and ambiguity stay strict", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <label for="sector">Sector o barrio</label><input id="sector" type="text">
      <label for="country">País</label><select id="country"><option value="do">República Dominicana</option><option value="us">Estados Unidos</option></select>
      <label for="city">Ciudad</label><input id="city" type="text">
    </main>`);
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");

    const mismatch = { index: 1, action: "select", description: 'Seleccionar "Centro" en "Sector o barrio".' } as never;
    await port.act(mismatch, "Sector o barrio", "Centro");
    assert.equal((mismatch as { action: string }).action, "fill");
    assert.equal(await page.locator("#sector").inputValue(), "Centro");

    const ordinarySelect = { index: 2, action: "select", description: 'Seleccionar "Estados Unidos" en "País".' } as never;
    await port.act(ordinarySelect, "País", "Estados Unidos");
    assert.equal((ordinarySelect as { action: string }).action, "select");
    assert.equal(await page.locator("#country").inputValue(), "us");

    const fillOnSelect = { index: 3, action: "fill", description: 'Ingresar "República Dominicana" en "País".' } as never;
    await port.act(fillOnSelect, "País", "República Dominicana");
    assert.equal((fillOnSelect as { action: string }).action, "select");
    assert.equal(await page.locator("#country").inputValue(), "do");

    const ordinaryFill = { index: 4, action: "fill", description: 'Ingresar "Santo Domingo" en "Ciudad".' } as never;
    await port.act(ordinaryFill, "Ciudad", "Santo Domingo");
    assert.equal(await page.locator("#city").inputValue(), "Santo Domingo");

    await page.evaluate(() => { document.body.insertAdjacentHTML("beforeend", '<input type="text" aria-label="Sector o barrio" id="sector2">'); });
    const ambiguous = { index: 5, action: "select", description: 'Seleccionar "Norte" en "Sector o barrio".' } as never;
    await assert.rejects(port.act(ambiguous, "Sector o barrio", "Norte"));
    assert.equal(await page.locator("#sector").inputValue(), "Centro");
    assert.equal(await page.locator("#sector2").inputValue(), "");
  } finally {
    await browser.close();
  }
});

test("Jira action resolves an exact permission checkbox instead of a partial navigation label",{ timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<nav><a href="#accounts">Cuentas</a></nav><main>
      <form><label><input type="checkbox" name="permission" value="accounts">Consultar cuentas</label></form>
    </main>`);
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    await port.act({ index: 1, action: "click", description: 'Presionar "Consultar cuentas".' } as never, "Consultar cuentas");
    assert.equal(await page.getByRole("checkbox", { name: "Consultar cuentas", exact: true }).isChecked(), true);
    assert.equal(page.url(), "about:blank", "the partial navigation target must not be activated");
  } finally {
    await browser.close();
  }
});

test("Jira compiled promoted spec executes a range selection and verifies the resulting page", { timeout: 60000 }, async () => {
  const server = createServer((req, res) => {
    if (req.url === "/health") { res.writeHead(200); res.end("ok"); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<main>
      <label for="approval-limit-slider">Ajuste visual: <output id="limit-output">RD$25,000</output></label>
      <input id="approval-limit-slider" type="range" min="5000" max="100000" step="5000" value="25000" aria-label="Ajuste visual">
      <script>document.querySelector('#approval-limit-slider').addEventListener('input', event => { document.querySelector('#limit-output').textContent = 'RD$' + Number(event.target.value).toLocaleString('en-US'); });</script>
    </main>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const dir = await fs.mkdtemp(path.resolve(".artifacts/jira-range-spec-"));
  try {
    const page = await browser.newPage();
    await page.goto(baseUrl);
    const rangeTarget = await createJiraPlaywrightPort(page, baseUrl).act(
      { index: 2, action: "select", description: 'Seleccionar "RD$30,000" en "Ajuste visual".' } as never,
      "Ajuste visual", "RD$30,000",
    );
    const plan: ExecutionPlan = {
      version: "1.0", source: "discovery_generated", status: "validated", scenario: { source: "jira", title: "Range selection" },
      requiredData: [], createdAt: new Date(0).toISOString(),
      steps: [
        { index: 1, action: "navigate", target: "APP_BASE_URL", description: "Abrir la aplicación configurada del proyecto" },
        { index: 2, action: "select", target: rangeTarget, valueKey: "adjustment", description: 'Seleccionar "RD$30,000" en "Ajuste visual".' },
        { index: 3, action: "assertVisible", target: { strategy: "text", value: "30000", exact: true }, description: 'Validar que se muestre "30000"' },
        { index: 4, action: "assertVisible", target: { strategy: "text", value: "RD$5,000 a RD$100,000", exact: true }, description: 'Validar que se muestre "RD$5,000 a RD$100,000"' },
        { index: 5, action: "assertVisible", target: { strategy: "text", value: "incrementos de RD$5,000", exact: true }, description: 'Validar que se muestre "incrementos de RD$5,000"' },
      ],
    };
    const specPath = path.join(dir, "range.spec.ts");
    const compiled = compileJiraSpec({ plan, sourceScenario: {}, appSlug: "synthetic-range", sectionSlug: "jira", automationId: "range", specPath });
    assert.deepEqual(compiled.unsupported, []);
    await fs.writeFile(specPath, compiled.source, "utf8");
    const configPath = path.join(dir, "playwright.config.ts");
    await fs.writeFile(configPath, `export default { testDir: ${JSON.stringify(dir)}, timeout: 30000, workers: 1, use: { headless: true } };`, "utf8");
    const { stdout } = await promisify(execFile)(process.execPath, [require.resolve("@playwright/test/cli"), "test", "--config", configPath], {
      cwd: process.cwd(), timeout: 45000, maxBuffer: 1024 * 1024,
      env: { ...process.env, APP_BASE_URL: baseUrl, HEADLESS: "true", EVIDENCE_PER_SCENARIO_DOCX: "false",
        JIRA_SPEC_RUNTIME_VALUES_JSON: JSON.stringify({ adjustment: "RD$30,000" }) },
    });
    assert.match(stdout, /1 passed/);
  } finally {
    await browser.close(); server.close(); await once(server, "close");
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Jira confirms a transient loading state captured immediately after the action", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body><button id="continue">Continuar</button><div id="view"></div></body></html>`);
    await page.locator("#continue").evaluate(button => button.addEventListener("click", () => {
      const view = document.querySelector("#view");
      if (!view) return;
      window.setTimeout(() => {
        view.innerHTML = '<div role="status" aria-label="Estado de carga">Cargando información</div>';
        window.setTimeout(() => { view.innerHTML = "<h1>Ingresos</h1>"; }, 30);
      }, 0);
    }));
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    await port.act({ index: 1, action: "click", description: "Continuar" } as never, "Continuar");
    await page.waitForTimeout(100);
    assert.equal(await page.getByText("Ingresos", { exact: true }).isVisible(), true);
    const observation = await port.assert("Estado de carga", false);
    assert.equal(observation.observedText, "Estado de carga Cargando información");
  } finally {
    await browser.close();
  }
});

test("Jira fails a missing loading observation without waiting for the generic click deadline", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><body><button id="continue">Continuar</button><h1>Ingresos</h1></body></html>`);
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    await port.act({ index: 1, action: "click", description: "Continuar" } as never, "Continuar");
    await assert.rejects(port.assert("Estado de carga", false), /JIRA_ASSERTION_NOT_SATISFIED/);
  } finally {
    await browser.close();
  }
});

test("waits for a post-submit target through a delayed DOM transition without polling the AI", { timeout: 45000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<html><body><button onclick="document.getElementById('state').textContent='Procesando';setTimeout(()=>{document.getElementById('state').innerHTML='<button>Solicitar código SMS</button>'},12500)">Enviar</button><div id="state"></div></body></html>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const discovered = await discoverJiraScenario({ scenarioId: "JIRA-DELAYED-TARGET", sourceIssueKey: "AA-88",
      title: "Delayed post-submit control", steps: ['Presionar "Enviar"', 'Presionar "Solicitar código SMS"'], expectedResult: "" },
      createJiraPlaywrightPort(page, `http://127.0.0.1:${address.port}`));
    assert.equal(discovered.plan.steps.filter(step => step.action === "click").length, 2);
    assert.match(await page.locator("body").innerText(), /Solicitar código SMS/);
  } finally {
    await browser.close(); server.close(); await once(server, "close");
  }
});

test("resolves a custom SMS action owner after a screen change", { timeout: 30000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<html><body><h1>Inicio de sesión</h1><button id="send">Enviar</button><button>Continuar</button><span id="sms" style="cursor:pointer" onclick="document.getElementById('state').textContent='Código solicitado'" hidden>SMS</span><div id="state"></div><script>document.getElementById('send').addEventListener('click',()=>setTimeout(()=>{document.querySelector('h1').textContent='Verificación de Usuario';document.getElementById('sms').hidden=false},100))</script></body></html>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const port = createJiraPlaywrightPort(page, `http://127.0.0.1:${address.port}`);
    await port.navigate();
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    await page.getByText("SMS", { exact: true }).waitFor({ state: "visible", timeout: 3000 });
    await port.act({ action: "click" } as never, "Solicitar el código por SMS");
    assert.match(await page.locator("#state").innerText(), /Código solicitado/);
  } finally {
    await browser.close(); server.closeAllConnections(); server.close(); await once(server, "close");
  }
});

test("Jira fill waits briefly for a field disabled during an asynchronous challenge to become editable", { timeout: 30000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<html><body><button onclick="const field=document.getElementById(\'code\');field.disabled=true;setTimeout(()=>field.disabled=false,350)">SMS</button><label for="code">Código de acceso</label><input id="code"></body></html>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const root = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const discovered = await discoverJiraScenario({ scenarioId: "HU-OTP", sourceIssueKey: "HU-OTP", title: "Submit an asynchronous access code",
      steps: ['Presionar "SMS".', 'Ingresar código sintético en "Código de acceso"'], expectedResult: "",
      inputRequirements: [{ key: "access_code", label: "Código de acceso", stepIndex: 2, operation: "fill", required: true, editable: true, sensitive: true, controlType: "password", source: "jira_step" }] },
      createJiraPlaywrightPort(page, root), { access_code: "synthetic-code" });
    assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "click", "fill"]);
    assert.equal(await page.locator("#code").inputValue(), "synthetic-code");
  } finally { await browser.close(); server.close(); await once(server, "close"); }
});

test("Jira fill resolves a unique editable textbox by shared label token and fails closed when several match", { timeout: 30000 }, async () => {
  const html = (fields: string) => `<html><body><h1>Verificación</h1>${fields}<button>Solicitar código por SMS</button><button>Continuar</button></body></html>`;
  const single = html('<label for="code">Código de acceso</label><input id="code">');
  const several = html('<label for="a">Código de acceso</label><input id="a"><label for="b">Código alterno</label><input id="b">');
  let body = single;
  const server = createServer((_req, res) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(body); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const root = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const scenario = { scenarioId: "HU-SEMANTIC-FILL", sourceIssueKey: "HU-SEMANTIC-FILL", title: "Fill an aliased code field",
    steps: ['Ingresar código sintético en "Código SMS"'], expectedResult: "",
    inputRequirements: [{ key: "sms_code", label: "Código SMS", stepIndex: 1, operation: "fill" as const, required: true, editable: true, sensitive: true, controlType: "text" as const, source: "jira_step" as const }] };
  try {
    const page = await browser.newPage();
    const discovered = await discoverJiraScenario(scenario, createJiraPlaywrightPort(page, root), { sms_code: "synthetic-code" });
    assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "fill"]);
    assert.equal(await page.locator("#code").inputValue(), "synthetic-code");

    // No id/name/testid: only the observed label text is durable identity, never DOM position.
    body = html('<label>Código de acceso <input></label>');
    const labelPage = await browser.newPage();
    const labelled = await discoverJiraScenario(scenario, createJiraPlaywrightPort(labelPage, root), { sms_code: "synthetic-code" });
    assert.equal(await labelPage.getByLabel("Código de acceso", { exact: true }).inputValue(), "synthetic-code");
    assert.doesNotMatch(JSON.stringify(labelled.plan), /nth|body \*/);

    body = several;
    const ambiguousPage = await browser.newPage();
    await assert.rejects(discoverJiraScenario(scenario, createJiraPlaywrightPort(ambiguousPage, root), { sms_code: "synthetic-code" }));
    assert.equal(await ambiguousPage.locator("#a").inputValue(), "");
    assert.equal(await ambiguousPage.locator("#b").inputValue(), "");
  } finally { await browser.close(); server.close(); await once(server, "close"); }
});

test("Jira discovers and compiles a generic unlabelled segmented access-code group across app profiles", { timeout: 60000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<html><body><h1>Verificación</h1><div id="challenge-group">'
      + Array.from({ length: 6 }, () => '<input type="text" name="challenge[]" maxlength="1" inputmode="numeric">').join("")
      + '</div><button type="submit">Continuar</button></body></html>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const root = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  const dir = await fs.mkdtemp(path.resolve(".artifacts/tmp/jira-segmented-code-"));
  try {
    for (const appSlug of ["fenix", "portal-empresarial"]) {
      for (const targetLabel of ["Código", "Token"]) {
        const page = await browser.newPage();
        const discovered = await discoverJiraScenario({
          scenarioId: `HU-SEGMENTED-CODE:${appSlug}:${targetLabel}`, sourceIssueKey: "HU-SEGMENTED-CODE", title: "Verify a segmented access code", appSlug,
          steps: [`Ingresar código sintético en "${targetLabel}"`], expectedResult: "",
          inputRequirements: [{ key: "access_code", label: targetLabel, stepIndex: 1, operation: "fill", required: true, editable: true, sensitive: true, controlType: "text", source: "jira_step" }],
        }, createJiraPlaywrightPort(page, root), { access_code: "123456" });
        const step = discovered.plan.steps.find(item => item.action === "fill");
        assert.ok(step?.target && typeof step.target === "object");
        assert.equal(step.target.strategy, "semantic");
        assert.equal(step.target.metadata?.repairType, "jira_segmented_code");
        assert.equal(step.resolutionState, "runtime_resolution_required");

        const compiled = compileJiraSpec({ plan: discovered.plan, sourceScenario: discovered.sourceScenario,
          appSlug, sectionSlug: "jira", automationId: "fixture", specPath: path.join(dir, `${appSlug}-${targetLabel}.spec.ts`) });
        assert.deepEqual(compiled.unsupported, []);
        assert.match(compiled.source, /fillJiraSpecSegmentedCode\(page, value\d+,/);
        assert.doesNotMatch(compiled.source, /123456/);

        const runtime = await import("./jira-spec-runtime");
        await runtime.fillJiraSpecSegmentedCode(page, "654321", step.target);
        assert.deepEqual(await page.locator('input[maxlength="1"]').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)), ["6", "5", "4", "3", "2", "1"]);
        await page.close();
      }
    }
  } finally {
    await browser.close(); server.close(); await once(server, "close");
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Jira resolves a unique generic Continue CTA from a longer user-purpose description", { timeout: 30000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<html><body><button onclick="document.body.dataset.continued='yes'">Continuar</button></body></html>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const root = `http://127.0.0.1:${address.port}`;
    const discovered = await discoverJiraScenario({ scenarioId: "HU-CONTINUE", sourceIssueKey: "HU-CONTINUE",
      title: "Continue after verification", steps: ['Presionar "continuar con la verificación de acceso"'], expectedResult: "" },
      createJiraPlaywrightPort(page, root));
    assert.equal(await page.locator("body").getAttribute("data-continued"), "yes");
    assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "click"]);
  } finally { await browser.close(); server.close(); await once(server, "close"); }
});

test("Jira resolves a generic Continue CTA when a verification step omits the word 'con'", { timeout: 30000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<html><body><button onclick="document.body.dataset.continued='yes'">Continuar</button></body></html>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const root = `http://127.0.0.1:${address.port}`;
    await discoverJiraScenario({ scenarioId: "HU-CONTINUE-VERIFICATION", sourceIssueKey: "HU-CONTINUE-VERIFICATION",
      title: "Continue after access verification", steps: ['Presionar "continuar verificación de acceso"'], expectedResult: "" },
      createJiraPlaywrightPort(page, root));
    assert.equal(await page.locator("body").getAttribute("data-continued"), "yes");
  } finally { await browser.close(); server.close(); await once(server, "close"); }
});

test("Jira maps an authorization action to one Continue CTA immediately after a token fill", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><label>Token de seguridad<input aria-label="Token de seguridad"></label><button onclick="document.body.dataset.authorized=\'yes\'">Continuar</button></main>');
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    await port.act({ index: 1, action: "fill", description: "fill [token_transferencia]" }, "Token de seguridad", "123456");
    await port.act({ index: 2, action: "click", description: "Presionar autorizar transferencia" }, "autorizar transferencia");
    assert.equal(await page.locator("body").getAttribute("data-authorized"), "yes");
  } finally { await browser.close(); }
});

test("Jira navigation uses exact accessible actions and does not treat sidebar labels as destination evidence", { timeout: 30000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<html><body><aside><div style="cursor:pointer" onclick="document.getElementById(\'subnav\').hidden=false">Transferencias</div><div id="subnav" hidden><a href="#" onclick="setTimeout(()=>document.querySelector(\'section\').innerHTML=\'<h1>Transferencias a Mis Cuentas</h1>\',800);return false">Cuentas Propias</a></div></aside><section><h1>Resumen</h1></section></body></html>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const root = `http://127.0.0.1:${address.port}`;
    const discovered = await discoverJiraScenario({ scenarioId: "HU-NAV", sourceIssueKey: "HU-NAV", title: "Open own accounts",
      steps: ['Presionar "Transferencias"', 'Presionar "Cuentas Propias"', 'Validar que se muestre "pantalla de transferencias"'], expectedResult: "" },
      createJiraPlaywrightPort(page, root));
    assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "click", "click", "assertVisible"]);
    assert.equal(await page.getByRole("heading", { name: "Transferencias a Mis Cuentas", exact: true }).count(), 1);

    await page.goto(root);
    await assert.rejects(() => createJiraPlaywrightPort(page, root).assert("Transferencias", false), /JIRA_ASSERTION_NOT_SATISFIED/);
  } finally { await browser.close(); server.close(); await once(server, "close"); }
});

test("direct product destination waits for its async page content instead of selecting an unnamed list item", { timeout: 30000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<html><body><button onclick="document.getElementById(\'state\').textContent=\'Cargando\';setTimeout(()=>document.getElementById(\'state\').outerHTML=\'<h1>Información de productos</h1>\',350)">Explora nuestros productos</button><p id="state"></p></body></html>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const root = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const discovered = await discoverJiraScenario({ scenarioId: "JIRA-PRODUCTS", sourceIssueKey: "AA-88",
      title: "Open products directly", steps: ['Clic en "Explora nuestros productos".', 'Validar que se muestre "Información de productos".'],
      expectedResult: "Explora nuestros productos dirige directamente a Información de productos." }, createJiraPlaywrightPort(page, root));
    assert.deepEqual(discovered.plan.steps.map(step => step.action), ["navigate", "click", "assertVisible"]);
    assert.match(await page.locator("body").innerText(), /Información de productos/);
  } finally { await browser.close(); server.close(); await once(server, "close"); }
});

test("Jira assertion matches equivalent Spanish headings that omit grammatical de", { timeout: 30000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<html><body><main><h2>Cuenta Destino</h2><p>Cuenta de Ahorro</p></main></body></html>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    const result = await createJiraPlaywrightPort(page, page.url()).assert("cuenta de destino", false);
    assert.match(result.observedText ?? "", /Cuenta Destino/);
  } finally { await browser.close(); server.close(); await once(server, "close"); }
});

test("Jira recognizes a rejected credential message phrased as 'user or password invalid'", { timeout: 30000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<html><body><div role="alertdialog"><p>Usuario o Contraseña inválidos.</p><button>Cerrar</button></div></body></html>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    const result = await createJiraPlaywrightPort(page, page.url()).assert("mensaje de credenciales no válidas", false);
    assert.match(result.observedText ?? "", /Usuario o Contraseña inválidos/);
  } finally { await browser.close(); server.close(); await once(server, "close"); }
});

test("Jira scoped prose assertions reach real DOM labels across two profiles without semantic AI", { timeout: 30000 }, async () => {
  const fixtures = [
    {path: "/a", context: "la confirmación", subjects: ["total a debitar", "comisión"], html: '<h1>Confirmación</h1><section style="margin-top:900px"><p>Total a <span>Debitar</span></p><p>RD$605.00</p><p>Comisión</p><p>RD$0.00</p></section>'},
    {path: "/b", context: "la ficha", subjects: ["nombre completo", "estado de autorización"], html: '<h1>Ficha</h1><p>Nombre completo</p><p>Persona ficticia</p><p>Estado de autorización</p><p>Pendiente</p>'},
  ];
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<main>${fixtures.find(fixture => fixture.path === req.url)?.html ?? ""}</main>`);
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  let semanticCalls = 0;
  try {
    __setJiraDomAssertionResolverForTesting(async () => { semanticCalls++; return undefined; });
    for (const fixture of fixtures) {
      const page = await browser.newPage();
      const root = `http://127.0.0.1:${address.port}${fixture.path}`;
      const result = await discoverJiraScenario({scenarioId: `fixture${fixture.path}`, sourceIssueKey: "HU-FIXTURE", title: "Read displayed details",
        steps: ["Abrir la aplicación configurada del proyecto", `Validar que ${fixture.context} esté visible.`, ...fixture.subjects.map(subject => `Validar que ${fixture.context} muestre el ${subject}.`)], expectedResult: ""}, createJiraPlaywrightPort(page, root));
      const assertions = result.plan.steps.filter(step => step.action === "assertVisible");
      assert.deepEqual(assertions.map(step => (step.target as {value: string}).value), [fixture.context.replace(/^(?:el|la) /, ""), ...fixture.subjects]);
      const compiled = compileJiraSpec({plan: result.plan, sourceScenario: result.sourceScenario, appSlug: `fixture-${fixture.path.slice(1)}`, sectionSlug: "assertions", automationId: "fixture", specPath: path.resolve(".artifacts/tmp/jira-assertion-fixture.spec.ts")});
      assert.deepEqual(compiled.unsupported, []);
      for (const step of assertions) {
        const subject = (step.target as {value: string}).value;
        assert.ok(compiled.source.includes(JSON.stringify(subject)));
        await assertJiraSpecVisibleText(page, subject, 300, step.description);
      }
      await page.close();
    }
    assert.equal(semanticCalls, 0, "literal observed labels must not consume semantic fallback budget");
  } finally { __setJiraDomAssertionResolverForTesting(undefined); await browser.close(); server.close(); await once(server, "close"); }
});

test("Jira visibility does not equate a pending action with its completed state", { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><p>Solicitud a firmar</p></main>');
    await assert.rejects(createJiraPlaywrightPort(page, "https://fixture.invalid").assert("solicitud firmada", false), /JIRA_ASSERTION_NOT_SATISFIED/);
  } finally { await browser.close(); }
});

test("Jira assertion can observe visible case content outside a mis-scoped main landmark", { timeout: 30000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<html><body><main><p>Resumen</p></main><section><p>Confirmación: Cuenta Destino</p></section></body></html>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    const result = await createJiraPlaywrightPort(page, page.url()).assert("cuenta de destino", false);
    assert.match(result.observedText ?? "", /Cuenta Destino/);
  } finally { await browser.close(); server.close(); await once(server, "close"); }
});

test("selected account assertion searches case content outside a mis-scoped main landmark", { timeout: 30000 }, async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<html><body><main><label for="destination">Cuenta de destino</label><select id="destination" aria-label="Cuenta de destino"><option>Seleccione</option><option value="Cuenta Ahorros">Cuenta de Ahorro</option></select></main></body></html>');
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}`);
    const port = createJiraPlaywrightPort(page, page.url());
    await port.act({ index: 1, action: "select", description: "Seleccionar cuenta de destino" }, "Cuenta de destino", "Cuenta Ahorros");
    await page.locator("main").evaluate(element => { element.innerHTML = "<p>Resumen</p>"; document.body.insertAdjacentHTML("beforeend", "<section><p>Confirmación: Cuenta de Ahorro</p></section>"); });
    const result = await port.assert("cuenta de destino", false);
    assert.match(result.observedText ?? "", /Cuenta de Ahorro/);
  } finally { await browser.close(); server.close(); await once(server, "close"); }
});

test("select with a semantically different UI label resolves only to a unique observed select", { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>
      <button type="button">Notification history</button>
      <label for="ch">Channel to receive updates</label>
      <select id="ch"><option value="">Choose</option><option value="mail">Mail</option><option value="sms">Text message</option></select>
      <label for="un">Unrelated currency</label><input id="un" type="text" disabled>
    </main>`);
    const seen: string[][] = [];
    __setJiraDomTargetResolverForTesting(async (_intent, candidates) => {
      seen.push(candidates.map(candidate => candidate.tagName ?? ""));
      // Stands in for the AI: abstains unless exactly one candidate is plausible.
      return candidates.length === 1 ? { candidateId: candidates[0].id, confidence: 0.95 } : undefined;
    });
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    await port.act({ index: 1, action: "select", description: "Select option in notification channel" } as never, "Notification channel", "Text message");
    assert.equal(await page.locator("#ch").inputValue(), "sms");
    assert.deepEqual(seen[0], ["select"], "chooser only sees observed selection controls, not buttons or disabled inputs");

    await page.locator("#ch").selectOption("");
    await page.locator("main").evaluate(element => {
      element.insertAdjacentHTML("beforeend", '<label for="ch2">Channel for alerts</label><select id="ch2"><option value="a">A</option><option value="b">B</option></select>');
    });
    await assert.rejects(port.act({ index: 2, action: "select", description: "Select option in notification channel" } as never, "Notification channel", "Mail"));
    assert.equal(await page.locator("#ch").inputValue(), "", "ambiguity fails closed without touching any control");
    assert.equal(await page.locator("#ch2").inputValue(), "a");
  } finally {
    __setJiraDomTargetResolverForTesting(undefined);
    await browser.close();
  }
});
