import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { jiraAlertErrorEquivalenceMatches, readVisibleJiraAlertTexts } from "./jira-assertion-matching";

const EXPECTED = "Error de código de autorización";

async function visibleAlerts(html: string): Promise<string[]> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    return await readVisibleJiraAlertTexts(page);
  } finally {
    await browser.close();
  }
}

test("visible role=alert with equivalent invalid message satisfies error assertion", async () => {
  const alerts = await visibleAlerts('<div role="alert">El código de autorización no es válido.</div>');
  assert.ok(alerts.some(text => jiraAlertErrorEquivalenceMatches(text, EXPECTED)));
});

test("same text outside an alert is never read as alert evidence", async () => {
  const alerts = await visibleAlerts("<p>El código de autorización no es válido.</p>");
  assert.deepEqual(alerts, []);
});

test("success alert, missing subject, or generic error do not satisfy", () => {
  assert.equal(jiraAlertErrorEquivalenceMatches("El código de autorización fue validado con éxito.", EXPECTED), false);
  assert.equal(jiraAlertErrorEquivalenceMatches("El código de autorización es correcto.", EXPECTED), false);
  assert.equal(jiraAlertErrorEquivalenceMatches("Ocurrió un error inesperado.", EXPECTED), false);
  assert.equal(jiraAlertErrorEquivalenceMatches("El código no es válido.", EXPECTED), false);
  assert.equal(jiraAlertErrorEquivalenceMatches("Error", "Error"), false);
  assert.equal(jiraAlertErrorEquivalenceMatches("El código de autorización no es válido.", "Código de autorización visible"), false);
});
