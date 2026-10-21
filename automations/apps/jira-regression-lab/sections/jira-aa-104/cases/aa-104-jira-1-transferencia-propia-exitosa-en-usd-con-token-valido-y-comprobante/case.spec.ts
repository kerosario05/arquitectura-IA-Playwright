import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecFieldValidation, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Transferencia propia exitosa en USD con token válido y comprobante", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-104";
  const automationId = "aa-104-jira-1-transferencia-propia-exitosa-en-usd-con-token-valido-y-comprobante";
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

  // 14. fill [monto_valido]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transfer-amount\"]"}, 2500, "fill [monto_valido]");
  const value14 = await resolveJiraSpecValue("monto_valido", appSlug, sectionSlug, automationId);
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

  // 17. Validar que se muestre "Confirma los datos"
  await reportJiraSpecStepStart(testInfo, 17);
  await assertJiraSpecVisibleText(page, "Confirma los datos", 15000, "Validar que se muestre \"Confirma los datos\"");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. Validar que se muestre "Cuenta de origen"
  await reportJiraSpecStepStart(testInfo, 18);
  await assertJiraSpecVisibleText(page, "Cuenta de origen", 15000, "Validar que se muestre \"Cuenta de origen\"");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. Validar que se muestre "Cuenta de destino"
  await reportJiraSpecStepStart(testInfo, 19);
  await assertJiraSpecVisibleText(page, "Cuenta de destino", 15000, "Validar que se muestre \"Cuenta de destino\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. Validar que se muestre "Monto a transferir"
  await reportJiraSpecStepStart(testInfo, 20);
  await assertJiraSpecVisibleText(page, "Monto a transferir", 15000, "Validar que se muestre \"Monto a transferir\"");
  await reportJiraSpecStepComplete(page, testInfo, 20, false, false);

  // 21. Validar que se muestre "Comisión"
  await reportJiraSpecStepStart(testInfo, 21);
  await assertJiraSpecVisibleText(page, "Comisión", 15000, "Validar que se muestre \"Comisión\"");
  await reportJiraSpecStepComplete(page, testInfo, 21, false, false);

  // 22. Validar que se muestre "Impuestos"
  await reportJiraSpecStepStart(testInfo, 22);
  await assertJiraSpecVisibleText(page, "Impuestos", 15000, "Validar que se muestre \"Impuestos\"");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. Validar que se muestre "Tasa de cambio"
  await reportJiraSpecStepStart(testInfo, 23);
  await assertJiraSpecVisibleText(page, "Tasa de cambio", 15000, "Validar que se muestre \"Tasa de cambio\"");
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. Validar que se muestre "Total a debitar"
  await reportJiraSpecStepStart(testInfo, 24);
  await assertJiraSpecVisibleText(page, "Total a debitar", 15000, "Validar que se muestre \"Total a debitar\"");
  await reportJiraSpecStepComplete(page, testInfo, 24, false, false);

  // 25. Validar que se muestre "RD$60.50 / US$1.00"
  await reportJiraSpecStepStart(testInfo, 25);
  await assertJiraSpecVisibleText(page, "RD$60.50 / US$1.00", 15000, "Validar que se muestre \"RD$60.50 / US$1.00\"");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Presionar "Continuar"
  await reportJiraSpecStepStart(testInfo, 26);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar a autorización","exact":true}, 2500, "Presionar \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 26, true, false);

  // 27. Validar que se muestre "Validación de identidad"
  await reportJiraSpecStepStart(testInfo, 27);
  await assertJiraSpecVisibleText(page, "Validación de identidad", 15000, "Validar que se muestre \"Validación de identidad\"");
  await reportJiraSpecStepComplete(page, testInfo, 27, false, false);

  // 28. Validar que se muestre "Token de seguridad"
  await reportJiraSpecStepStart(testInfo, 28);
  await assertJiraSpecVisibleText(page, "Token de seguridad", 15000, "Validar que se muestre \"Token de seguridad\"");
  await reportJiraSpecStepComplete(page, testInfo, 28, false, false);

  // 29. Solicitar el token por SMS
  await reportJiraSpecStepStart(testInfo, 29);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar token por SMS","exact":true}, 2500, "Solicitar el token por SMS");
  await reportJiraSpecStepComplete(page, testInfo, 29, true, false);

  // 30. fill [token_seguridad_valido]
  await reportJiraSpecStepStart(testInfo, 30);
  const target30 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transfer-token\"]"}, 2500, "fill [token_seguridad_valido]");
  const value30 = await resolveJiraSpecValue("token_seguridad_valido", appSlug, sectionSlug, automationId);
  await target30.fill(value30);
  if (await target30.inputValue() !== value30) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 30, false, false);

  // 31. Presionar "Autorizar transferencia"
  await reportJiraSpecStepStart(testInfo, 31);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Autorizar transferencia","exact":true}, 2500, "Presionar \"Autorizar transferencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 31, true, false);

  // 32. Validar que se muestre "Comprobante de transferencia"
  await reportJiraSpecStepStart(testInfo, 32);
  await assertJiraSpecVisibleText(page, "Comprobante de transferencia", 15000, "Validar que se muestre \"Comprobante de transferencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 32, false, false);

  // 33. Validar que se muestre "Transacción exitosa"
  await reportJiraSpecStepStart(testInfo, 33);
  await assertJiraSpecVisibleText(page, "Transacción exitosa", 15000, "Validar que se muestre \"Transacción exitosa\"");
  await reportJiraSpecStepComplete(page, testInfo, 33, false, false);

  // 34. Validar que se muestre "Monto"
  await reportJiraSpecStepStart(testInfo, 34);
  await assertJiraSpecVisibleText(page, "Monto", 15000, "Validar que se muestre \"Monto\"");
  await reportJiraSpecStepComplete(page, testInfo, 34, false, false);

  // 35. Validar que se muestre "Cuenta de origen"
  await reportJiraSpecStepStart(testInfo, 35);
  await assertJiraSpecVisibleText(page, "Cuenta de origen", 15000, "Validar que se muestre \"Cuenta de origen\"");
  await reportJiraSpecStepComplete(page, testInfo, 35, false, false);

  // 36. Validar que se muestre "Cuenta de destino"
  await reportJiraSpecStepStart(testInfo, 36);
  await assertJiraSpecVisibleText(page, "Cuenta de destino", 15000, "Validar que se muestre \"Cuenta de destino\"");
  await reportJiraSpecStepComplete(page, testInfo, 36, false, false);

  // 37. Validar que se muestre "fecha y hora"
  await reportJiraSpecStepStart(testInfo, 37);
  await assertJiraSpecVisibleText(page, "fecha y hora", 15000, "Validar que se muestre \"fecha y hora\"");
  await reportJiraSpecStepComplete(page, testInfo, 37, false, false);

  // 38. Validar que se muestre "Referencia"
  await reportJiraSpecStepStart(testInfo, 38);
  await assertJiraSpecVisibleText(page, "Referencia", 15000, "Validar que se muestre \"Referencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 38, false, true);

});
