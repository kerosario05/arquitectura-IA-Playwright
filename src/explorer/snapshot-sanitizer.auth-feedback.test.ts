import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { scanCurrentPage } from "./page-scanner";
import { sanitizeSnapshotText } from "./snapshot-sanitizer";
import { resolveFeedbackMessageAssertion } from "../discovery/feedback-message-resolver";

test("scanner preserves credential rejection meaning while removing sensitive values", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <div class="error-message">Usuario o Contraseña inválidos.</div>
        <div class="page-content">Contenido ordinario</div>
        <div class="notice">Contraseña: PrivatePass123!</div>
      </main>
    `);

    const snapshot = await scanCurrentPage(page);
    const result = resolveFeedbackMessageAssertion(snapshot, "Validar que se muestre problema de credenciales");

    assert.equal(sanitizeSnapshotText("Usuario o Contraseña inválidos."), "Credenciales inválidas");
    assert.equal(snapshot.elements.some((element) => element.text === "Credenciales inválidas"), true);
    assert.equal(snapshot.elements.some((element) => element.className === "page-content"), false);
    assert.equal(result.passed, true);
    assert.equal(result.capturedMessage?.text, "Credenciales inválidas");
    assert.equal(JSON.stringify(snapshot).includes("PrivatePass123!"), false);
  } finally {
    await browser.close();
  }
});
