import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { observeJiraCredentialRejection } from "./jira-assertion-matching";
import { createJiraPlaywrightPort, discoverJiraScenario } from "./jira-semantic-executor";
import { __setJiraDomAssertionResolverForTesting } from "./jira-dom-assertion-ai";

test("credential rejection classification requires a visible password form and visible rejection", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // Custom dialogs may have no ARIA role: this is the shape observed in the failed run.
    await page.setContent('<main><input type="password"><div><p>Usuario o Contraseña inválidos.</p><button>Cerrar</button></div></main>');
    assert.equal(await observeJiraCredentialRejection(page), true);
    await page.setContent('<main><input type="password"><div hidden>Usuario o Contraseña inválidos.</div></main>');
    assert.equal(await observeJiraCredentialRejection(page), false);
    await page.setContent('<main><input type="password" hidden><div>Usuario o Contraseña inválidos.</div></main>');
    assert.equal(await observeJiraCredentialRejection(page), false);
    await page.setContent('<main><h1>Resumen</h1><p>Usuario o Contraseña inválidos.</p></main>');
    assert.equal(await observeJiraCredentialRejection(page), false);
    await page.setContent('<main><input type="password"><nav>Usuario o Contraseña inválidos.</nav><p>Sesión iniciada correctamente</p></main>');
    assert.equal(await observeJiraCredentialRejection(page), false);
  } finally { await browser.close(); }
});

test("Jira Discovery reports rejected authentication while preserving rejection and successful screen oracles", { timeout: 35000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  __setJiraDomAssertionResolverForTesting(async () => ({ supported: false, confidence: 0, evidenceIds: [] }));
  try {
    const page = await browser.newPage();
    await page.setContent('<main><input type="password"><div><p>Usuario o Contraseña inválidos.</p><button>Cerrar</button></div></main>');
    const port = createJiraPlaywrightPort(page, "https://fixture.invalid");
    const rejection = await port.assert("credenciales inválidas", false);
    assert.match(rejection.observedText ?? "", /inválidos/);
    await assert.rejects(discoverJiraScenario({
      scenarioId: "HU-TEST:1", sourceIssueKey: "HU-TEST", title: "Autenticación válida",
      steps: ['Validar que se muestre "pantalla de verificación de usuario"'], expectedResult: "",
    }, { ...port, async navigate() {} }), error => error instanceof Error && error.message === "JIRA_AUTHENTICATION_REJECTED");
    await page.setContent('<main><h1>Verificación de Usuario</h1><p>Seleccione un canal.</p></main>');
    const verified = await port.assert("pantalla de verificación de usuario", false);
    assert.equal(verified.observedText, "Verificación de Usuario");
  } finally {
    __setJiraDomAssertionResolverForTesting(undefined);
    await browser.close();
  }
});
