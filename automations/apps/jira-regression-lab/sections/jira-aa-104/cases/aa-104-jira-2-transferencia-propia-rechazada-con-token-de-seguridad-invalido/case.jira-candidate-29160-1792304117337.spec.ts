import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecFieldValidation, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Transferencia propia rechazada con token de seguridad inválido", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-104";
  const automationId = "aa-104-jira-2-transferencia-propia-rechazada-con-token-de-seguridad-invalido";
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

  // 6. Abrir la aplicación configurada del proyecto
  await reportJiraSpecStepStart(testInfo, 6);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Presionar "Empresarial"
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"p:visible:text-is(\"Confirma tu identidad para continuar al portal empresarial.\")"}, 2500, "Presionar \"Empresarial\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. Solicitar el código por SMS
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar código por SMS","exact":true}, 2500, "Solicitar el código por SMS");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. fill [codigo_acceso]
  await reportJiraSpecStepStart(testInfo, 9);
  const target9 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-otp\"]"}, 2500, "fill [codigo_acceso]");
  const value9 = await resolveJiraSpecValue("codigo_acceso", appSlug, sectionSlug, automationId);
  await target9.fill(value9);
  if (await target9.inputValue() !== value9) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Presionar "Continuar"
  await reportJiraSpecStepStart(testInfo, 10);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 10, true, false);

  // 11. Presionar "transferencia propia"
  await reportJiraSpecStepStart(testInfo, 11);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Nueva transferencia","exact":true}, 2500, "Presionar \"transferencia propia\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, true, false);

  // 12. Validar que se muestre "Datos de la transferencia"
  await reportJiraSpecStepStart(testInfo, 12);
  await assertJiraSpecVisibleText(page, "Datos de la transferencia", 15000, "Validar que se muestre \"Datos de la transferencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 12, false, false);

  // 13. select [cuenta_origen]
  await reportJiraSpecStepStart(testInfo, 13);
  const target13 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"source-account\"]"}, 2500, "select [cuenta_origen]");
  const value13 = await resolveJiraSpecValue("cuenta_origen", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target13, value13);
  await reportJiraSpecStepComplete(page, testInfo, 13, true, false);

  // 14. select [cuenta_destino_distinta]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"destination-account\"]"}, 2500, "select [cuenta_destino_distinta]");
  const value14 = await resolveJiraSpecValue("cuenta_destino_distinta", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target14, value14);
  await reportJiraSpecStepComplete(page, testInfo, 14, true, false);

  // 15. fill [monto_valido]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transfer-amount\"]"}, 2500, "fill [monto_valido]");
  const value15 = await resolveJiraSpecValue("monto_valido", appSlug, sectionSlug, automationId);
  await target15.fill(value15);
  if (await target15.inputValue() !== value15) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. select [moneda_usd]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transfer-currency\"]"}, 2500, "select [moneda_usd]");
  const value16 = await resolveJiraSpecValue("moneda_usd", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target16, value16);
  await reportJiraSpecStepComplete(page, testInfo, 16, true, false);

  // 17. Presionar "Continuar"
  await reportJiraSpecStepStart(testInfo, 17);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar a la confirmación","exact":true}, 2500, "Presionar \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 17, true, false);

  // 18. Validar que se muestre "Confirma los datos"
  await reportJiraSpecStepStart(testInfo, 18);
  await assertJiraSpecVisibleText(page, "Confirma los datos", 15000, "Validar que se muestre \"Confirma los datos\"");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. Presionar "Continuar"
  await reportJiraSpecStepStart(testInfo, 19);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar a autorización","exact":true}, 2500, "Presionar \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, true, false);

  // 20. Validar que se muestre "Validación de identidad"
  await reportJiraSpecStepStart(testInfo, 20);
  await assertJiraSpecVisibleText(page, "Validación de identidad", 15000, "Validar que se muestre \"Validación de identidad\"");
  await reportJiraSpecStepComplete(page, testInfo, 20, false, false);

  // 21. Solicitar el token por SMS
  await reportJiraSpecStepStart(testInfo, 21);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar token por SMS","exact":true}, 2500, "Solicitar el token por SMS");
  await reportJiraSpecStepComplete(page, testInfo, 21, true, false);

  // 22. fill [token_seguridad_invalido]
  await reportJiraSpecStepStart(testInfo, 22);
  const target22 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transfer-token\"]"}, 2500, "fill [token_seguridad_invalido]");
  const value22 = await resolveJiraSpecValue("token_seguridad_invalido", appSlug, sectionSlug, automationId);
  await target22.fill(value22);
  if (await target22.inputValue() !== value22) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. Presionar "Autorizar transferencia"
  await reportJiraSpecStepStart(testInfo, 23);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Autorizar transferencia","exact":true}, 2500, "Presionar \"Autorizar transferencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 23, true, false);

  // 24. Validar que se muestre "El token de seguridad no es válido"
  await reportJiraSpecStepStart(testInfo, 24);
  await assertJiraSpecVisibleText(page, "El token de seguridad no es válido", 15000, "Validar que se muestre \"El token de seguridad no es válido\"");
  await reportJiraSpecStepComplete(page, testInfo, 24, false, false);

  // 25. Validar que se muestre "La transferencia no se ejecutó"
  await reportJiraSpecStepStart(testInfo, 25);
  await assertJiraSpecVisibleText(page, "La transferencia no se ejecutó", 15000, "Validar que se muestre \"La transferencia no se ejecutó\"");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Validar que se muestre "Validación de identidad"
  await reportJiraSpecStepStart(testInfo, 26);
  await assertJiraSpecVisibleText(page, "Validación de identidad", 15000, "Validar que se muestre \"Validación de identidad\"");
  await reportJiraSpecStepComplete(page, testInfo, 26, false, true);

});
