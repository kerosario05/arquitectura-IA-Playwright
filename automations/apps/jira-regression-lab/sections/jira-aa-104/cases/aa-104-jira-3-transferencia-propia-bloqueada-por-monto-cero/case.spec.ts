import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecFieldValidation, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Transferencia propia bloqueada por monto cero", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 396000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-104";
  const automationId = "aa-104-jira-3-transferencia-propia-bloqueada-por-monto-cero";
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");

  // 1. Project entry
  await reportJiraSpecStepStart(testInfo, 1);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await reportJiraSpecStepComplete(page, testInfo, 1, true, false);

  // 2. fill [auth.company_identifier]
  await reportJiraSpecStepStart(testInfo, 2);
  const target2 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-rnc\"]"}, 2500, "fill [auth.company_identifier]");
  const value2 = await resolveJiraSpecValue("auth.company_identifier", appSlug, sectionSlug, automationId);
  await target2.fill(value2);
  if (await target2.inputValue() !== value2) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 2, false, false);

  // 3. fill [auth.username]
  await reportJiraSpecStepStart(testInfo, 3);
  const target3 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-user\"]"}, 2500, "fill [auth.username]");
  const value3 = await resolveJiraSpecValue("auth.username", appSlug, sectionSlug, automationId);
  await target3.fill(value3);
  if (await target3.inputValue() !== value3) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 3, false, false);

  // 4. fill [auth.password]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-password\"]"}, 2500, "fill [auth.password]");
  const value4 = await resolveJiraSpecValue("auth.password", appSlug, sectionSlug, automationId);
  await target4.fill(value4);
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 4, false, false);

  // 5. click Iniciar sesión
  await reportJiraSpecStepStart(testInfo, 5);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "click Iniciar sesión");
  await reportJiraSpecStepComplete(page, testInfo, 5, true, false);

  // 6. Presionar "Empresarial"
  await reportJiraSpecStepStart(testInfo, 6);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"p:visible:text-is(\"Confirma tu identidad para continuar al portal empresarial.\")"}, 2500, "Presionar \"Empresarial\"");
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Solicitar el código por SMS
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar código por SMS","exact":true}, 2500, "Solicitar el código por SMS");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. fill [codigo_acceso]
  await reportJiraSpecStepStart(testInfo, 8);
  const target8 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-otp\"]"}, 2500, "fill [codigo_acceso]");
  const value8 = await resolveJiraSpecValue("codigo_acceso", appSlug, sectionSlug, automationId);
  await target8.fill(value8);
  if (await target8.inputValue() !== value8) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 8, false, false);

  // 9. Presionar "Continuar"
  await reportJiraSpecStepStart(testInfo, 9);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 9, true, false);

  // 10. Presionar "transferencia propia"
  await reportJiraSpecStepStart(testInfo, 10);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Nueva transferencia","exact":true}, 2500, "Presionar \"transferencia propia\"");
  await reportJiraSpecStepComplete(page, testInfo, 10, true, false);

  // 11. Validar que se muestre "Datos de la transferencia"
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "Datos de la transferencia", 15000, "Validar que se muestre \"Datos de la transferencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. select [cuenta_origen]
  await reportJiraSpecStepStart(testInfo, 12);
  const target12 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"source-account\"]"}, 2500, "select [cuenta_origen]");
  const value12 = await resolveJiraSpecValue("cuenta_origen", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target12, value12);
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. select [cuenta_destino_distinta]
  await reportJiraSpecStepStart(testInfo, 13);
  const target13 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"destination-account\"]"}, 2500, "select [cuenta_destino_distinta]");
  const value13 = await resolveJiraSpecValue("cuenta_destino_distinta", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target13, value13);
  await reportJiraSpecStepComplete(page, testInfo, 13, true, false);

  // 14. fill [monto_cero]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transfer-amount\"]"}, 2500, "fill [monto_cero]");
  const value14 = await resolveJiraSpecValue("monto_cero", appSlug, sectionSlug, automationId);
  await target14.fill(value14);
  if (await target14.inputValue() !== value14) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. select [moneda_usd]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transfer-currency\"]"}, 2500, "select [moneda_usd]");
  const value15 = await resolveJiraSpecValue("moneda_usd", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target15, value15);
  await reportJiraSpecStepComplete(page, testInfo, 15, true, false);

  // 16. Presionar "Continuar"
  await reportJiraSpecStepStart(testInfo, 16);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar a la confirmación","exact":true}, 2500, "Presionar \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 16, true, false);

  // 17. Validar que se muestre "Datos de la transferencia"
  await reportJiraSpecStepStart(testInfo, 17);
  await assertJiraSpecVisibleText(page, "Datos de la transferencia", 15000, "Validar que se muestre \"Datos de la transferencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. Validar que se muestre "Ingresa un monto mayor que cero"
  await reportJiraSpecStepStart(testInfo, 18);
  await assertJiraSpecVisibleText(page, "Ingresa un monto mayor que cero", 15000, "Validar que se muestre \"Ingresa un monto mayor que cero\"");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, true);

});
