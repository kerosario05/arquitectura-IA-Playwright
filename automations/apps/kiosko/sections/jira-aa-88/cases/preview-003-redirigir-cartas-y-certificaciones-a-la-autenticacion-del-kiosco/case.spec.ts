import { test, expect } from "@playwright/test";
import { assertJiraSpecAuthGate, navigateJiraSpecRoute, performJiraSpecSelection, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Redirigir Cartas y certificaciones a la autenticación del kiosco", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 36000));
  const appSlug = "kiosko";
  const sectionSlug = "jira-aa-88";
  const automationId = "preview-003-redirigir-cartas-y-certificaciones-a-la-autenticacion-del-kiosco";
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");

  // 1. Project entry
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  // 2. Clic en "Cartas y certificaciones".
  const target2 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[aria-label=\"Cartas y certificaciones\"]"});
  await target2.click();

  // 3. Validar que se muestre "pantalla de autenticación del kiosco".
  await assertJiraSpecAuthGate(page);

});
