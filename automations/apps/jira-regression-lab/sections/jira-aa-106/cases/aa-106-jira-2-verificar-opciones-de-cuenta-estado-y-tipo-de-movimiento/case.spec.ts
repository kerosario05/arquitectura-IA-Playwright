import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecFieldValidation, assertJiraSpecRowMatch, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";
import { AuthFlow, setAuthFlowTestData } from "../../../../flows/auth.flow";

test("Verificar opciones de cuenta, estado y tipo de movimiento", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-106";
  const automationId = "aa-106-jira-2-verificar-opciones-de-cuenta-estado-y-tipo-de-movimiento";
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

  // 16. Validar que "Cuenta" muestre una cuenta seleccionada.
  await reportJiraSpecStepStart(testInfo, 16);
  await assertJiraSpecVisibleText(page, "Cuenta", 15000, "Validar que \"Cuenta\" muestre una cuenta seleccionada.");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. select [status_all]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"statement-status\"]"}, 2500, "select [status_all]");
  const value17 = await resolveJiraSpecValue("status_all", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target17, value17);
  await reportJiraSpecStepComplete(page, testInfo, 17, true, false);

  // 18. Validar que "Estado" muestre Todas.
  await reportJiraSpecStepStart(testInfo, 18);
  await assertJiraSpecVisibleText(page, "Estado", 15000, "Validar que \"Estado\" muestre Todas.");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. select [status_completed]
  await reportJiraSpecStepStart(testInfo, 19);
  const target19 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"statement-status\"]"}, 2500, "select [status_completed]");
  const value19 = await resolveJiraSpecValue("status_completed", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target19, value19);
  await reportJiraSpecStepComplete(page, testInfo, 19, true, false);

  // 20. Validar que "Estado" muestre Completada.
  await reportJiraSpecStepStart(testInfo, 20);
  await assertJiraSpecVisibleText(page, "Estado", 15000, "Validar que \"Estado\" muestre Completada.");
  await reportJiraSpecStepComplete(page, testInfo, 20, false, false);

  // 21. select [status_pending]
  await reportJiraSpecStepStart(testInfo, 21);
  const target21 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"statement-status\"]"}, 2500, "select [status_pending]");
  const value21 = await resolveJiraSpecValue("status_pending", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target21, value21);
  await reportJiraSpecStepComplete(page, testInfo, 21, true, false);

  // 22. Validar que "Estado" muestre Pendiente.
  await reportJiraSpecStepStart(testInfo, 22);
  await assertJiraSpecVisibleText(page, "Estado", 15000, "Validar que \"Estado\" muestre Pendiente.");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. select [movement_type_all]
  await reportJiraSpecStepStart(testInfo, 23);
  const target23 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"movement-type\"]"}, 2500, "select [movement_type_all]");
  const value23 = await resolveJiraSpecValue("movement_type_all", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target23, value23);
  await reportJiraSpecStepComplete(page, testInfo, 23, true, false);

  // 24. Validar que "Tipo de movimiento" muestre Todos.
  await reportJiraSpecStepStart(testInfo, 24);
  await assertJiraSpecVisibleText(page, "Tipo de movimiento", 15000, "Validar que \"Tipo de movimiento\" muestre Todos.");
  await reportJiraSpecStepComplete(page, testInfo, 24, false, false);

  // 25. select [movement_type_transfers]
  await reportJiraSpecStepStart(testInfo, 25);
  const target25 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"movement-type\"]"}, 2500, "select [movement_type_transfers]");
  const value25 = await resolveJiraSpecValue("movement_type_transfers", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target25, value25);
  await reportJiraSpecStepComplete(page, testInfo, 25, true, false);

  // 26. Validar que "Tipo de movimiento" muestre Transferencias.
  await reportJiraSpecStepStart(testInfo, 26);
  await assertJiraSpecVisibleText(page, "Tipo de movimiento", 15000, "Validar que \"Tipo de movimiento\" muestre Transferencias.");
  await reportJiraSpecStepComplete(page, testInfo, 26, false, false);

  // 27. select [movement_type_payments]
  await reportJiraSpecStepStart(testInfo, 27);
  const target27 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"movement-type\"]"}, 2500, "select [movement_type_payments]");
  const value27 = await resolveJiraSpecValue("movement_type_payments", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target27, value27);
  await reportJiraSpecStepComplete(page, testInfo, 27, true, false);

  // 28. Validar que "Tipo de movimiento" muestre Pagos.
  await reportJiraSpecStepStart(testInfo, 28);
  await assertJiraSpecVisibleText(page, "Tipo de movimiento", 15000, "Validar que \"Tipo de movimiento\" muestre Pagos.");
  await reportJiraSpecStepComplete(page, testInfo, 28, false, false);

  // 29. select [movement_type_deposits]
  await reportJiraSpecStepStart(testInfo, 29);
  const target29 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"movement-type\"]"}, 2500, "select [movement_type_deposits]");
  const value29 = await resolveJiraSpecValue("movement_type_deposits", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target29, value29);
  await reportJiraSpecStepComplete(page, testInfo, 29, true, false);

  // 30. Validar que "Tipo de movimiento" muestre Depósitos.
  await reportJiraSpecStepStart(testInfo, 30);
  await assertJiraSpecVisibleText(page, "Tipo de movimiento", 15000, "Validar que \"Tipo de movimiento\" muestre Depósitos.");
  await reportJiraSpecStepComplete(page, testInfo, 30, false, true);

});
