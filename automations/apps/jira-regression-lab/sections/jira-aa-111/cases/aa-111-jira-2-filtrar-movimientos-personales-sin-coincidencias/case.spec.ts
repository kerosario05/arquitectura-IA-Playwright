import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecRowMatch, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Filtrar movimientos personales sin coincidencias", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 588000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-111";
  const automationId = "aa-111-jira-2-filtrar-movimientos-personales-sin-coincidencias";
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

  // 3. Presionar "Personal".
  await reportJiraSpecStepStart(testInfo, 3);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Personal","exact":true}, 2500, "Presionar \"Personal\".");
  await reportJiraSpecStepComplete(page, testInfo, 3, true, false);

  // 4. Presionar "Iniciar sesión".
  await reportJiraSpecStepStart(testInfo, 4);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"Iniciar sesión\".");
  await reportJiraSpecStepComplete(page, testInfo, 4, true, false);

  // 5. fill [cedula]
  await reportJiraSpecStepStart(testInfo, 5);
  const target5 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-identity\"]"}, 2500, "fill [cedula]");
  const value5 = await resolveJiraSpecValue("cedula", appSlug, sectionSlug, automationId);
  await target5.fill(value5);
  if (await target5.inputValue() !== value5) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 5, false, false);

  // 6. fill [usuario]
  await reportJiraSpecStepStart(testInfo, 6);
  const target6 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-user\"]"}, 2500, "fill [usuario]");
  const value6 = await resolveJiraSpecValue("usuario", appSlug, sectionSlug, automationId);
  await target6.fill(value6);
  if (await target6.inputValue() !== value6) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 6, false, false);

  // 7. fill [contrasena]
  await reportJiraSpecStepStart(testInfo, 7);
  const target7 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-password\"]"}, 2500, "fill [contrasena]");
  const value7 = await resolveJiraSpecValue("contrasena", appSlug, sectionSlug, automationId);
  await target7.fill(value7);
  if (await target7.inputValue() !== value7) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 7, false, false);

  // 8. Presionar "Iniciar sesión".
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"Iniciar sesión\".");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. Solicitar el código por SMS.
  await reportJiraSpecStepStart(testInfo, 9);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar código por SMS","exact":true}, 2500, "Solicitar el código por SMS.");
  await reportJiraSpecStepComplete(page, testInfo, 9, true, false);

  // 10. fill [codigo_acceso]
  await reportJiraSpecStepStart(testInfo, 10);
  const target10 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-otp\"]"}, 2500, "fill [codigo_acceso]");
  const value10 = await resolveJiraSpecValue("codigo_acceso", appSlug, sectionSlug, automationId);
  await target10.fill(value10);
  if (await target10.inputValue() !== value10) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 11);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 11, true, false);

  // 12. Validar que se muestre "Resumen personal"
  await reportJiraSpecStepStart(testInfo, 12);
  await assertJiraSpecVisibleText(page, "Resumen personal", 15000, "Validar que se muestre \"Resumen personal\"");
  await reportJiraSpecStepComplete(page, testInfo, 12, false, false);

  // 13. Presionar "Movimientos".
  await reportJiraSpecStepStart(testInfo, 13);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"▤ Movimientos","exact":true}, 2500, "Presionar \"Movimientos\".");
  await reportJiraSpecStepComplete(page, testInfo, 13, true, false);

  // 14. Validar que se muestre "Cargando información segura"
  await reportJiraSpecStepStart(testInfo, 14);
  await assertJiraSpecVisibleText(page, "Cargando información segura", 15000, "Validar que se muestre \"Cargando información segura\"");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. Validar que se muestre "tabla de movimientos personales"
  await reportJiraSpecStepStart(testInfo, 15);
  await assertJiraSpecVisibleText(page, "tabla de movimientos personales", 15000, "Validar que se muestre \"tabla de movimientos personales\"");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. select [cuenta]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"statement-account\"]"}, 2500, "select [cuenta]");
  const value16 = await resolveJiraSpecValue("cuenta", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target16, value16);
  await reportJiraSpecStepComplete(page, testInfo, 16, true, false);

  // 17. fill [desde]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"date-from\"]"}, 2500, "fill [desde]");
  const value17 = await resolveJiraSpecValue("desde", appSlug, sectionSlug, automationId);
  await target17.fill(value17);
  if (await target17.inputValue() !== value17) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. fill [hasta]
  await reportJiraSpecStepStart(testInfo, 18);
  const target18 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"date-to\"]"}, 2500, "fill [hasta]");
  const value18 = await resolveJiraSpecValue("hasta", appSlug, sectionSlug, automationId);
  await target18.fill(value18);
  if (await target18.inputValue() !== value18) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. select [estado]
  await reportJiraSpecStepStart(testInfo, 19);
  const target19 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"statement-status\"]"}, 2500, "select [estado]");
  const value19 = await resolveJiraSpecValue("estado", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target19, value19);
  await reportJiraSpecStepComplete(page, testInfo, 19, true, false);

  // 20. select [tipo_movimiento]
  await reportJiraSpecStepStart(testInfo, 20);
  const target20 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"movement-type\"]"}, 2500, "select [tipo_movimiento]");
  const value20 = await resolveJiraSpecValue("tipo_movimiento", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target20, value20);
  await reportJiraSpecStepComplete(page, testInfo, 20, true, false);

  // 21. fill [monto_minimo]
  await reportJiraSpecStepStart(testInfo, 21);
  const target21 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"min-amount\"]"}, 2500, "fill [monto_minimo]");
  const value21 = await resolveJiraSpecValue("monto_minimo", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target21, value21);
  await reportJiraSpecStepComplete(page, testInfo, 21, true, false);

  // 22. Presionar "Aplicar filtros".
  await reportJiraSpecStepStart(testInfo, 22);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Aplicar filtros","exact":true}, 2500, "Presionar \"Aplicar filtros\".");
  await reportJiraSpecStepComplete(page, testInfo, 22, true, false);

  // 23. Validar que se muestre "0 resultados"
  await reportJiraSpecStepStart(testInfo, 23);
  await assertJiraSpecVisibleText(page, "0 resultados", 15000, "Validar que se muestre \"0 resultados\"");
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. Validar que se muestre "0 de 0 movimientos"
  await reportJiraSpecStepStart(testInfo, 24);
  await assertJiraSpecVisibleText(page, "0 de 0 movimientos", 15000, "Validar que se muestre \"0 de 0 movimientos\"");
  await reportJiraSpecStepComplete(page, testInfo, 24, false, true);

});
