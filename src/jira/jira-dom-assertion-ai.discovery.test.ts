import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createJiraPlaywrightPort } from "./jira-semantic-executor";
import { __setJiraDomAssertionResolverForTesting } from "./jira-dom-assertion-ai";

test("Jira Discovery accepts a semantic assertion only with cited visible DOM evidence", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main><h1>Resumen</h1><section><h2>Cuentas</h2><p>Cuenta Corriente</p><p>Cuenta de Ahorro</p></section></main>");
    __setJiraDomAssertionResolverForTesting(async (intent, evidence) => {
      assert.equal(intent, "resumen consolidado");
      const summaryContext = evidence.find(item => item.text.includes("Resumen")
        && item.text.includes("Cuenta Corriente") && item.text.includes("Cuenta de Ahorro"));
      return summaryContext
        ? { supported: true, confidence: 0.96, evidenceIds: [summaryContext.id] }
        : { supported: false, confidence: 0.99, evidenceIds: [] };
    });
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    const result = await port.assert("resumen consolidado", false);
    assert.ok(result.observedText);
    assert.match(result.observedText, /Resumen.*Cuenta Corriente.*Cuenta de Ahorro/);
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira column assertion accepts a visible header without weakening the date/time value check", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main><table><thead><tr><th>Usuario</th><th>Fecha y hora</th></tr></thead><tbody><tr><td>ana</td><td>16 oct 2026, 09:42</td></tr></tbody></table></main>");
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    const header = await port.assert("Fecha y hora", false, false, true);
    assert.equal(header.observedText, "Fecha y hora");
    await assert.rejects(port.assert("Fecha y hora", false, false, false), /JIRA_ASSERTION_NOT_SATISFIED/);
    await assert.rejects(port.assert("Monto", false, false, true), /JIRA_ASSERTION_NOT_SATISFIED/);
  } finally {
    await browser.close();
  }
});

test("Jira Discovery rejects an AI assertion with evidence IDs outside the visible DOM", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main><h1>Resumen</h1><p>Cuenta Corriente</p></main>");
    __setJiraDomAssertionResolverForTesting(async () => ({
      supported: true,
      confidence: 1,
      evidenceIds: ["not-visible-evidence"],
    }));
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    await assert.rejects(port.assert("estado completo", false), /JIRA_ASSERTION_NOT_SATISFIED/);
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira semantic assertions cannot use a breadcrumb as proof while the destination content is loading", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><header><div class="crumb">Northstar / Confirmación de pago</div></header>
      <section id="content"><div role="status">Cargando información segura…</div></section></main>`);
    let semanticCalls = 0;
    __setJiraDomAssertionResolverForTesting(async (_intent, evidence) => {
      semanticCalls += 1;
      assert.equal(evidence.some(item => item.text.includes("Northstar / Confirmación de pago")), false);
      return { supported: false, confidence: 0.99, evidenceIds: [] };
    });
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    const pending = port.assert("Confirmación de pago", false);
    await page.waitForTimeout(160);
    await page.locator("#content").evaluate(element => {
      element.innerHTML = "<h1>Confirmación de pago</h1><button>Confirmar pago</button>";
    });
    const result = await pending;
    assert.match(result.observedText ?? "", /Confirmación de pago/);
    assert.equal(semanticCalls, 1, "semantic fallback should run only against the loading-state snapshot");
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira assertion evidence preserves credential rejection wording while masking literal values", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><input aria-label="Contraseña" value="qa-secret-value"><div role="alert">Usuario o Contraseña inválidos. Código 1059.</div></main>`);
    __setJiraDomAssertionResolverForTesting(async (intent, evidence) => {
      assert.equal(intent, "problema de credenciales");
      const message = evidence.find(item => item.text.includes("Contraseña inválidos"));
      assert.ok(message, "negative credential wording remains available to the semantic decision");
      assert.doesNotMatch(evidence.map(item => item.text).join(" "), /qa-secret-value/);
      return message ? { supported: true, confidence: 0.96, evidenceIds: [message.id] } : undefined;
    });
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    const result = await port.assert("problema de credenciales", false);
    assert.match(result.observedText ?? "", /Contraseña inválidos/);
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira assertion evidence keeps descriptive keyword phrases but redacts delimited values", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><div role="alert">El código de autorización no es válido.</div><p>Token de seguridad no válido</p><p>Código: ab-xyz</p><p>Código de autorización: ab-xyz</p><p>token abcdef</p><p>Contraseña qwerty</p><p>password qwerty</p><p>código ab12</p></main>`);
    __setJiraDomAssertionResolverForTesting(async (_intent, evidence) => {
      const message = evidence.find(item => item.text.includes("El código de autorización no es válido"));
      assert.ok(message, "descriptive phrase must not be mis-redacted");
      const all = evidence.map(item => item.text).join(" ");
      assert.match(all, /Token de seguridad no válido/);
      assert.doesNotMatch(all, /ab-xyz|abcdef|qwerty|ab12/);
      return { supported: true, confidence: 0.96, evidenceIds: [message.id] };
    });
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    const result = await port.assert("error de código de autorización", false);
    assert.match(result.observedText ?? "", /no es válido/);
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira Discovery matches a generic credential-rejection assertion to an explicit invalid-user/password message", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main><div role='alert'>Usuario o Contraseña inválidos. Código 1059.</div></main>");
    __setJiraDomAssertionResolverForTesting(undefined);
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    const result = await port.assert("problema de credenciales", false);
    assert.match(result.observedText ?? "", /Usuario o Contraseña inválidos/);
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira assertion evidence exposes a visible table caption and headers, and omits hidden tables", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><table><caption>Movimientos de la cuenta</caption><thead><tr><th>Fecha</th><th>Monto</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table>
      <div style="display:none"><table><caption>Tabla oculta</caption><tr><th>Secreto</th></tr></table></div></main>`);
    __setJiraDomAssertionResolverForTesting(async (_intent, evidence) => {
      assert.equal(evidence.some(item => item.text.includes("Tabla oculta") || item.text.includes("Secreto")), false);
      const table = evidence.find(item => item.text.startsWith("Visible table")
        && item.text.includes("Movimientos de la cuenta") && item.text.includes("Fecha | Monto"));
      return table ? { supported: true, confidence: 0.96, evidenceIds: [table.id] } : { supported: false, confidence: 0.99, evidenceIds: [] };
    });
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    const result = await port.assert("tabla de movimientos visible", false);
    assert.match(result.observedText ?? "", /Movimientos de la cuenta.*Fecha \| Monto/);

    await page.setContent(`<main><div style="display:none"><table><caption>Movimientos</caption><tr><th>Fecha</th></tr></table></div><p>Sin datos</p></main>`);
    __setJiraDomAssertionResolverForTesting(async (_intent, evidence) => {
      assert.equal(evidence.some(item => item.text.startsWith("Visible table")), false);
      return { supported: false, confidence: 0.99, evidenceIds: [] };
    });
    await assert.rejects(port.assert("tabla de movimientos visible", false), /JIRA_ASSERTION_NOT_SATISFIED/);
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira table presence is resolved structurally, fail-closed for other subject, hidden, ambiguous, and row claims", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    // The stub rejects everything: acceptance below must come from the structural path alone.
    __setJiraDomAssertionResolverForTesting(async () => ({ supported: false, confidence: 0.99, evidenceIds: [] }));
    const table = (caption: string) => `<table><caption>${caption}</caption><thead><tr><th>Fecha</th><th>Monto</th></tr></thead></table>`;

    // Qualifier backed by the visible selector in the table's own card.
    await page.setContent(`<main><section><label for="acc">Cuenta</label><select id="acc"><option>Cuenta Empresarial</option><option selected>Cuenta Corriente Personal</option></select>${table("Movimientos de la cuenta seleccionada")}</section></main>`);
    const ok = await port.assert("la tabla de movimientos personales esté visible", false);
    assert.match(ok.observedText ?? "", /Movimientos de la cuenta seleccionada/);

    // Qualifier only in an unselected option, or in a hidden select: fail-closed.
    await page.setContent(`<main><section><label for="acc">Cuenta</label><select id="acc"><option selected>Cuenta Empresarial</option><option>Cuenta Corriente Personal</option></select>${table("Movimientos de la cuenta seleccionada")}</section></main>`);
    await assert.rejects(port.assert("la tabla de movimientos personales esté visible", false), /JIRA_ASSERTION_NOT_SATISFIED/);
    await page.setContent(`<main><section><label for="acc">Cuenta</label><select id="acc" style="display:none"><option selected>Cuenta Corriente Personal</option></select>${table("Movimientos de la cuenta seleccionada")}</section></main>`);
    await assert.rejects(port.assert("la tabla de movimientos personales esté visible", false), /JIRA_ASSERTION_NOT_SATISFIED/);

    // Same qualifier without nearby evidence: fail-closed (AI stub rejects).
    await page.setContent(`<main>${table("Movimientos de la cuenta seleccionada")}</main>`);
    await assert.rejects(port.assert("la tabla de movimientos personales esté visible", false), /JIRA_ASSERTION_NOT_SATISFIED/);

    // Qualifier only in a row cell or a hidden element does not count.
    await page.setContent(`<main><section><span style="display:none">Cuenta Personal</span><table><caption>Movimientos de la cuenta</caption><tr><th>Tipo</th></tr><tr><td>Personal</td></tr></table></section></main>`);
    await assert.rejects(port.assert("la tabla de movimientos personales esté visible", false), /JIRA_ASSERTION_NOT_SATISFIED/);

    // Contradicting qualifier (caption or card context).
    await page.setContent(`<main>${table("Movimientos recientes")}</main>`);
    await assert.rejects(port.assert("la tabla de movimientos pendientes esté visible", false), /JIRA_ASSERTION_NOT_SATISFIED/);
    await page.setContent(`<main><section><span>Cuenta Empresarial</span>${table("Movimientos de la cuenta")}</section></main>`);
    await assert.rejects(port.assert("la tabla de movimientos personales esté visible", false), /JIRA_ASSERTION_NOT_SATISFIED/);

    // Matching qualifier in caption is accepted.
    await page.setContent(`<main>${table("Movimientos recientes")}</main>`);
    await port.assert("la tabla de movimientos recientes esté visible", false);

    await page.setContent(`<main>${table("Transferencias programadas")}</main>`);
    await assert.rejects(port.assert("la tabla de movimientos personales esté visible", false), /JIRA_ASSERTION_NOT_SATISFIED/);

    await page.setContent(`<main><div style="display:none">${table("Movimientos de la cuenta")}</div><p>Sin datos</p></main>`);
    await assert.rejects(port.assert("la tabla de movimientos personales esté visible", false), /JIRA_ASSERTION_NOT_SATISFIED/);

    await page.setContent(`<main>${table("Movimientos recientes")}${table("Movimientos pendientes")}</main>`);
    await assert.rejects(port.assert("la tabla de movimientos esté visible", false), /JIRA_ASSERTION_NOT_SATISFIED/);

    await page.setContent(`<main>${table("Movimientos de la cuenta")}</main>`);
    await assert.rejects(port.assert("la tabla de movimientos muestre filas", false), /JIRA_ASSERTION_NOT_SATISFIED/);
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira table assertion re-evaluates after a spinner turns into the table, without AI calls", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    let aiCalls = 0;
    __setJiraDomAssertionResolverForTesting(async () => { aiCalls += 1; return { supported: false, confidence: 0.99, evidenceIds: [] }; });
    const intent = "la tabla de movimientos personales esté visible";
    const table = `<section><select aria-label="Cuenta"><option selected>Cuenta Corriente Personal</option></select><table><caption>Movimientos de la cuenta seleccionada</caption><thead><tr><th>Fecha</th><th>Monto</th></tr></thead></table></section>`;
    await page.setContent(`<main><div id="view"><p>Cargando información segura</p></div></main>`);
    // Observable DOM transition from spinner to table happens while the assertion polls.
    await page.evaluate(html => { setTimeout(() => { document.getElementById("view")!.innerHTML = html; }, 800); }, table);
    const accepted = await port.assert(intent, false);
    assert.match(accepted.observedText ?? "", /Movimientos de la cuenta seleccionada/);
    assert.equal(aiCalls, 0, "no AI call during the whole spinner -> table assertion");
    await port.assert(intent, false);
    assert.equal(aiCalls, 0, "no AI call once the table is visible");

    // Absent table never reaches the AI from the re-evaluation path.
    await page.setContent(`<main><p>Cargando información segura</p></main>`);
    aiCalls = 0;
    for (let i = 0; i < 3; i += 1) {
      const { resolveJiraDomAssertion } = await import("./jira-dom-assertion-ai");
      assert.equal((await resolveJiraDomAssertion(page, intent, { skipAiWhenNoTable: true })).supported, false);
    }
    assert.equal(aiCalls, 0);

    // Contradicting qualifier stays rejected without AI.
    await page.setContent(`<main><section><span>Cuenta Empresarial</span><table><caption>Movimientos de la cuenta</caption><thead><tr><th>Fecha</th></tr></thead></table></section></main>`);
    const { resolveJiraDomAssertion } = await import("./jira-dom-assertion-ai");
    assert.equal((await resolveJiraDomAssertion(page, intent, { skipAiWhenNoTable: true })).supported, false);
    assert.equal(aiCalls, 0);
    await assert.rejects(port.assert(intent, false), /JIRA_ASSERTION_NOT_SATISFIED/);
    assert.equal(aiCalls, 0, "contradiction rejected through the port without AI");
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});

test("Jira Discovery accepts a per-entity property assertion only when each visible entity shows its type", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<main><h1>Resumen</h1><section><h2>Cuentas</h2><article><strong>Cuenta Corriente</strong><span>RD$149,910.44</span></article><article><strong>Cuenta de Ahorro</strong><span>US$1,700.71</span></article></section></main>");
    __setJiraDomAssertionResolverForTesting(async (intent, evidence) => {
      assert.equal(intent, "tipo de cada cuenta presentada");
      const summaryContext = evidence.find(item => item.text.includes("Resumen")
        && item.text.includes("Cuenta Corriente") && item.text.includes("Cuenta de Ahorro"));
      return summaryContext
        ? { supported: true, confidence: 0.96, evidenceIds: [summaryContext.id] }
        : { supported: false, confidence: 0.99, evidenceIds: [] };
    });
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    const result = await port.assert("tipo de cada cuenta presentada", false);
    assert.match(result.observedText ?? "", /Cuenta Corriente.*Cuenta de Ahorro/);
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});
