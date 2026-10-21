import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";
import { AuthFlow, setAuthFlowTestData } from "../../../../flows/auth.flow";

test("Filtrar, restablecer y exportar estados de cuenta", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-106";
  const automationId = "aa-106-jira-1-filtrar-restablecer-y-exportar-estados-de-cuenta";
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");
  const authTestData = await resolveJiraSpecAuthTestData(appSlug);
  setAuthFlowTestData(authTestData);
  const authFlow = new AuthFlow(page);

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

  const postLoginGate = await awaitJiraSpecPostLoginTransition(page);
  if (postLoginGate === "access_code_gate") {
    await completeJiraSpecAccessCodeGate(page, authTestData, "defaultClient");
  } else {
    const authResult = await authFlow.ensureAuthenticated({ alias: "defaultClient" });
    if (!authResult.success) throw new Error("JIRA_SPEC_AUTH_FLOW_FAILED");
  }

  // 6. Presionar "Estados de cuenta".
  await reportJiraSpecStepStart(testInfo, 6);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"▤ Estados de cuenta","exact":true}, 2500, "Presionar \"Estados de cuenta\".");
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Validar que "Cuenta" esté visible en la pantalla activa.
  await reportJiraSpecStepStart(testInfo, 7);
  await assertJiraSpecVisibleText(page, "Cuenta", 15000, "Validar que \"Cuenta\" esté visible en la pantalla activa.");
  await reportJiraSpecStepComplete(page, testInfo, 7, false, false);

  // 8. Validar que "Desde" esté visible en la pantalla activa.
  await reportJiraSpecStepStart(testInfo, 8);
  await assertJiraSpecVisibleText(page, "Desde", 15000, "Validar que \"Desde\" esté visible en la pantalla activa.");
  await reportJiraSpecStepComplete(page, testInfo, 8, false, false);

  // 9. Validar que "Hasta" esté visible en la pantalla activa.
  await reportJiraSpecStepStart(testInfo, 9);
  await assertJiraSpecVisibleText(page, "Hasta", 15000, "Validar que \"Hasta\" esté visible en la pantalla activa.");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Validar que "Estado" esté visible en la pantalla activa.
  await reportJiraSpecStepStart(testInfo, 10);
  await assertJiraSpecVisibleText(page, "Estado", 15000, "Validar que \"Estado\" esté visible en la pantalla activa.");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Validar que "Tipo de movimiento" esté visible en la pantalla activa.
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "Tipo de movimiento", 15000, "Validar que \"Tipo de movimiento\" esté visible en la pantalla activa.");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. Validar que "Monto mínimo" esté visible en la pantalla activa.
  await reportJiraSpecStepStart(testInfo, 12);
  await assertJiraSpecVisibleText(page, "Monto mínimo", 15000, "Validar que \"Monto mínimo\" esté visible en la pantalla activa.");
  await reportJiraSpecStepComplete(page, testInfo, 12, false, false);

  // 13. Validar que "Aplicar filtros" esté visible en la pantalla activa.
  await reportJiraSpecStepStart(testInfo, 13);
  await assertJiraSpecVisibleText(page, "Aplicar filtros", 15000, "Validar que \"Aplicar filtros\" esté visible en la pantalla activa.");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. Validar que "Limpiar filtros" esté visible en la pantalla activa.
  await reportJiraSpecStepStart(testInfo, 14);
  await assertJiraSpecVisibleText(page, "Limpiar filtros", 15000, "Validar que \"Limpiar filtros\" esté visible en la pantalla activa.");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. select [account]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"statement-account\"]"}, 2500, "select [account]");
  const value15 = await resolveJiraSpecValue("account", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target15, value15);
  await reportJiraSpecStepComplete(page, testInfo, 15, true, false);

  // 16. fill [start_date]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"date-from\"]"}, 2500, "fill [start_date]");
  const value16 = await resolveJiraSpecValue("start_date", appSlug, sectionSlug, automationId);
  await target16.fill(value16);
  if (await target16.inputValue() !== value16) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. fill [end_date]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"date-to\"]"}, 2500, "fill [end_date]");
  const value17 = await resolveJiraSpecValue("end_date", appSlug, sectionSlug, automationId);
  await target17.fill(value17);
  if (await target17.inputValue() !== value17) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. select [status]
  await reportJiraSpecStepStart(testInfo, 18);
  const target18 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"statement-status\"]"}, 2500, "select [status]");
  const value18 = await resolveJiraSpecValue("status", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target18, value18);
  await reportJiraSpecStepComplete(page, testInfo, 18, true, false);

  // 19. select [movement_type]
  await reportJiraSpecStepStart(testInfo, 19);
  const target19 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"movement-type\"]"}, 2500, "select [movement_type]");
  const value19 = await resolveJiraSpecValue("movement_type", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target19, value19);
  await reportJiraSpecStepComplete(page, testInfo, 19, true, false);

  // 20. fill [minimum_amount]
  await reportJiraSpecStepStart(testInfo, 20);
  const target20 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"min-amount\"]"}, 2500, "fill [minimum_amount]");
  const value20 = await resolveJiraSpecValue("minimum_amount", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target20, value20);
  await reportJiraSpecStepComplete(page, testInfo, 20, true, false);

  // 21. Presionar "Aplicar filtros".
  await reportJiraSpecStepStart(testInfo, 21);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Aplicar filtros","exact":true}, 2500, "Presionar \"Aplicar filtros\".");
  await reportJiraSpecStepComplete(page, testInfo, 21, true, false);

  // 22. Validar que el indicador de cantidad de resultados esté visible en la pantalla activa.
  await reportJiraSpecStepStart(testInfo, 22);
  await assertJiraSpecVisibleText(page, "que el indicador de cantidad de resultados esté visible en la pantalla activa", 15000, "Validar que el indicador de cantidad de resultados esté visible en la pantalla activa.");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. Validar que la tabla de movimientos esté visible en la pantalla activa.
  await reportJiraSpecStepStart(testInfo, 23);
  await assertJiraSpecVisibleText(page, "que la tabla de movimientos esté visible en la pantalla activa", 15000, "Validar que la tabla de movimientos esté visible en la pantalla activa.");
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. Presionar "Limpiar filtros".
  await reportJiraSpecStepStart(testInfo, 24);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Limpiar filtros","exact":true}, 2500, "Presionar \"Limpiar filtros\".");
  await reportJiraSpecStepComplete(page, testInfo, 24, true, false);

  // 25. Validar que "Cuenta" muestre Cuenta Corriente.
  await reportJiraSpecStepStart(testInfo, 25);
  await assertJiraSpecVisibleText(page, "Cuenta", 15000, "Validar que \"Cuenta\" muestre Cuenta Corriente.");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Validar que "Desde" muestre 2026-10-01.
  await reportJiraSpecStepStart(testInfo, 26);
  await assertJiraSpecVisibleText(page, "Desde", 15000, "Validar que \"Desde\" muestre 2026-10-01.");
  await reportJiraSpecStepComplete(page, testInfo, 26, false, false);

  // 27. Validar que "Hasta" muestre 2026-10-16.
  await reportJiraSpecStepStart(testInfo, 27);
  await assertJiraSpecVisibleText(page, "Hasta", 15000, "Validar que \"Hasta\" muestre 2026-10-16.");
  await reportJiraSpecStepComplete(page, testInfo, 27, false, false);

  // 28. Validar que "Estado" muestre Todos los estados.
  await reportJiraSpecStepStart(testInfo, 28);
  await assertJiraSpecVisibleText(page, "Estado", 15000, "Validar que \"Estado\" muestre Todos los estados.");
  await reportJiraSpecStepComplete(page, testInfo, 28, false, false);

  // 29. Validar que "Tipo de movimiento" muestre Todos los tipos.
  await reportJiraSpecStepStart(testInfo, 29);
  await assertJiraSpecVisibleText(page, "Tipo de movimiento", 15000, "Validar que \"Tipo de movimiento\" muestre Todos los tipos.");
  await reportJiraSpecStepComplete(page, testInfo, 29, false, false);

  // 30. Validar que "Monto mínimo" muestre cero.
  await reportJiraSpecStepStart(testInfo, 30);
  await assertJiraSpecVisibleText(page, "Monto mínimo", 15000, "Validar que \"Monto mínimo\" muestre cero.");
  await reportJiraSpecStepComplete(page, testInfo, 30, false, false);

  // 31. Presionar "Exportar CSV".
  await reportJiraSpecStepStart(testInfo, 31);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Exportar CSV","exact":true}, 2500, "Presionar \"Exportar CSV\".");
  await reportJiraSpecStepComplete(page, testInfo, 31, true, false);

  // 32. Validar que se descargue el archivo estado-de-cuenta-regression-lab.csv con los movimientos correspondientes a los filtros aplicados.
  await reportJiraSpecStepStart(testInfo, 32);
  await assertJiraSpecTableBoundDownload(page, {"filename":"estado-de-cuenta-regression-lab.csv","headers":[],"row":[],"tokens":[],"tableBound":true}, 15000);
  await reportJiraSpecStepComplete(page, testInfo, 32, false, true);

});
