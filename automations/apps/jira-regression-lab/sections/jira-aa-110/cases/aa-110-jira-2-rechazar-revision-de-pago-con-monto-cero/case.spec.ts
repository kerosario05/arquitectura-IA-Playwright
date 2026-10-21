import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Rechazar revisión de pago con monto cero", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 576000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-110";
  const automationId = "aa-110-jira-2-rechazar-revision-de-pago-con-monto-cero";
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");

  // 1. Project entry
  await reportJiraSpecStepStart(testInfo, 1);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await reportJiraSpecStepComplete(page, testInfo, 1, true, false);

  // 2. Abrir la aplicación configurada del proyecto
  await reportJiraSpecStepStart(testInfo, 2);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await reportJiraSpecStepComplete(page, testInfo, 2, true, false);

  // 3. Presionar "Empresarial".
  await reportJiraSpecStepStart(testInfo, 3);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Empresarial","exact":true}, 2500, "Presionar \"Empresarial\".");
  await reportJiraSpecStepComplete(page, testInfo, 3, true, false);

  // 4. fill [rnc]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-rnc\"]"}, 2500, "fill [rnc]");
  const value4 = await resolveJiraSpecValue("rnc", appSlug, sectionSlug, automationId);
  await target4.fill(value4);
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 4, false, false);

  // 5. fill [usuario]
  await reportJiraSpecStepStart(testInfo, 5);
  const target5 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-user\"]"}, 2500, "fill [usuario]");
  const value5 = await resolveJiraSpecValue("usuario", appSlug, sectionSlug, automationId);
  await target5.fill(value5);
  if (await target5.inputValue() !== value5) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 5, false, false);

  // 6. fill [contrasena]
  await reportJiraSpecStepStart(testInfo, 6);
  const target6 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-password\"]"}, 2500, "fill [contrasena]");
  const value6 = await resolveJiraSpecValue("contrasena", appSlug, sectionSlug, automationId);
  await target6.fill(value6);
  if (await target6.inputValue() !== value6) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 6, false, false);

  // 7. Presionar "Iniciar sesión".
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"Iniciar sesión\".");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. Solicitar el código por SMS.
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar código por SMS","exact":true}, 2500, "Solicitar el código por SMS.");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. fill [codigo_acceso_sms]
  await reportJiraSpecStepStart(testInfo, 9);
  const target9 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-otp\"]"}, 2500, "fill [codigo_acceso_sms]");
  const value9 = await resolveJiraSpecValue("codigo_acceso_sms", appSlug, sectionSlug, automationId);
  await target9.fill(value9);
  if (await target9.inputValue() !== value9) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 10);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 10, true, false);

  // 11. Validar que se muestre "Resumen de productos"
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "Resumen de productos", 15000, "Validar que se muestre \"Resumen de productos\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. Presionar "Pagos".
  await reportJiraSpecStepStart(testInfo, 12);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"▣ Pagos","exact":true}, 2500, "Presionar \"Pagos\".");
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. Validar que se muestre "Cargando información segura"
  await reportJiraSpecStepStart(testInfo, 13);
  await assertJiraSpecVisibleText(page, "Cargando información segura", 15000, "Validar que se muestre \"Cargando información segura\"");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. Validar que se muestre "Nuevo pago"
  await reportJiraSpecStepStart(testInfo, 14);
  await assertJiraSpecVisibleText(page, "Nuevo pago", 15000, "Validar que se muestre \"Nuevo pago\"");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. select [proveedor]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"provider\"]"}, 2500, "select [proveedor]");
  const value15 = await resolveJiraSpecValue("proveedor", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target15, value15);
  await reportJiraSpecStepComplete(page, testInfo, 15, true, false);

  // 16. fill [numero_contrato]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"contract-number\"]"}, 2500, "fill [numero_contrato]");
  const value16 = await resolveJiraSpecValue("numero_contrato", appSlug, sectionSlug, automationId);
  await target16.fill(value16);
  if (await target16.inputValue() !== value16) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. select [cuenta_debitar]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"payment-account\"]"}, 2500, "select [cuenta_debitar]");
  const value17 = await resolveJiraSpecValue("cuenta_debitar", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target17, value17);
  await reportJiraSpecStepComplete(page, testInfo, 17, true, false);

  // 18. fill [monto_cero]
  await reportJiraSpecStepStart(testInfo, 18);
  const target18 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"payment-amount\"]"}, 2500, "fill [monto_cero]");
  const value18 = await resolveJiraSpecValue("monto_cero", appSlug, sectionSlug, automationId);
  await target18.fill(value18);
  if (await target18.inputValue() !== value18) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. fill [fecha_pago]
  await reportJiraSpecStepStart(testInfo, 19);
  const target19 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"payment-date\"]"}, 2500, "fill [fecha_pago]");
  const value19 = await resolveJiraSpecValue("fecha_pago", appSlug, sectionSlug, automationId);
  await target19.fill(value19);
  if (await target19.inputValue() !== value19) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. select [frecuencia]
  await reportJiraSpecStepStart(testInfo, 20);
  const target20 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"payment-frequency\"]"}, 2500, "select [frecuencia]");
  const value20 = await resolveJiraSpecValue("frecuencia", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target20, value20);
  await reportJiraSpecStepComplete(page, testInfo, 20, true, false);

  // 21. Presionar "Revisar pago".
  await reportJiraSpecStepStart(testInfo, 21);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Revisar pago","exact":true}, 2500, "Presionar \"Revisar pago\".");
  await reportJiraSpecStepComplete(page, testInfo, 21, true, false);

  // 22. Validar que se muestre "El monto debe ser mayor que cero"
  await reportJiraSpecStepStart(testInfo, 22);
  await assertJiraSpecVisibleText(page, "El monto debe ser mayor que cero", 15000, "Validar que se muestre \"El monto debe ser mayor que cero\"");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. Validar que no se muestre "Confirmación de pago"
  await reportJiraSpecStepStart(testInfo, 23);
  await assertJiraSpecAbsentText(page, "Confirmación de pago");
  await reportJiraSpecStepComplete(page, testInfo, 23, false, true);

});
