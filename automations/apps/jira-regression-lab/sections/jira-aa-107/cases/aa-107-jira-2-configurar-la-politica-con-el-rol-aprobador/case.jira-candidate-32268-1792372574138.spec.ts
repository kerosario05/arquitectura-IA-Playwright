import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecFieldValidation, assertJiraSpecRowMatch, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";
import { AuthFlow, setAuthFlowTestData } from "../../../../flows/auth.flow";

test("Configurar la política con el rol Aprobador", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-107";
  const automationId = "aa-107-jira-2-configurar-la-politica-con-el-rol-aprobador";
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

  // 6. Presionar navegación a "Administración".
  await reportJiraSpecStepStart(testInfo, 6);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"⚙ Administración","exact":true}, 2500, "Presionar navegación a \"Administración\".");
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Validar que se muestre "Política de aprobación"
  await reportJiraSpecStepStart(testInfo, 7);
  await assertJiraSpecVisibleText(page, "Política de aprobación", 15000, "Validar que se muestre \"Política de aprobación\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, false, false);

  // 8. Validar que se muestre "Rol de Laura M."
  await reportJiraSpecStepStart(testInfo, 8);
  await assertJiraSpecVisibleText(page, "Rol de Laura M.", 15000, "Validar que se muestre \"Rol de Laura M.\"");
  await reportJiraSpecStepComplete(page, testInfo, 8, false, false);

  // 9. Validar que se muestre "Límite de aprobación"
  await reportJiraSpecStepStart(testInfo, 9);
  await assertJiraSpecVisibleText(page, "Límite de aprobación", 15000, "Validar que se muestre \"Límite de aprobación\"");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Validar que se muestre "Consultar cuentas"
  await reportJiraSpecStepStart(testInfo, 10);
  await assertJiraSpecVisibleText(page, "Consultar cuentas", 15000, "Validar que se muestre \"Consultar cuentas\"");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Validar que se muestre "Crear transferencias"
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "Crear transferencias", 15000, "Validar que se muestre \"Crear transferencias\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. Validar que se muestre "Aprobar pagos"
  await reportJiraSpecStepStart(testInfo, 12);
  await assertJiraSpecVisibleText(page, "Aprobar pagos", 15000, "Validar que se muestre \"Aprobar pagos\"");
  await reportJiraSpecStepComplete(page, testInfo, 12, false, false);

  // 13. Validar que se muestre "Administrar usuarios"
  await reportJiraSpecStepStart(testInfo, 13);
  await assertJiraSpecVisibleText(page, "Administrar usuarios", 15000, "Validar que se muestre \"Administrar usuarios\"");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. select [jira_step_10]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"user-role\"]"}, 2500, "select [jira_step_10]");
  const value14 = await resolveJiraSpecValue("jira_step_10", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target14, value14);
  await reportJiraSpecStepComplete(page, testInfo, 14, true, false);

  // 15. Validar que se muestre "Aprobador"
  await reportJiraSpecStepStart(testInfo, 15);
  await assertJiraSpecVisibleText(page, "Aprobador", 15000, "Validar que se muestre \"Aprobador\"");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. fill [limite_aprobacion]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"approval-limit\"]"}, 2500, "fill [limite_aprobacion]");
  const value16 = await resolveJiraSpecValue("limite_aprobacion", appSlug, sectionSlug, automationId);
  await target16.fill(value16);
  if (await target16.inputValue() !== value16) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. Validar que el control "Ajuste visual" se actualice con el monto ingresado.
  await reportJiraSpecStepStart(testInfo, 17);
  await assertJiraSpecVisibleText(page, "Ajuste visual", 15000, "Validar que el control \"Ajuste visual\" se actualice con el monto ingresado.");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. Presionar "Consultar cuentas"
  await reportJiraSpecStepStart(testInfo, 18);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"checkbox","name":"Consultar cuentas","exact":true}, 2500, "Presionar \"Consultar cuentas\"");
  await reportJiraSpecStepComplete(page, testInfo, 18, true, false);

  // 19. Presionar "Crear transferencias"
  await reportJiraSpecStepStart(testInfo, 19);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"checkbox","name":"Crear transferencias","exact":true}, 2500, "Presionar \"Crear transferencias\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, true, false);

  // 20. select [permiso_aprobar_pagos]
  await reportJiraSpecStepStart(testInfo, 20);
  const target20 = await resolveJiraSpecTarget(page, {"strategy":"role","role":"checkbox","name":"Aprobar pagos","exact":true}, 2500, "select [permiso_aprobar_pagos]");
  const value20 = await resolveJiraSpecValue("permiso_aprobar_pagos", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target20, value20);
  await reportJiraSpecStepComplete(page, testInfo, 20, true, false);

  // 21. select [permiso_administrar_usuarios]
  await reportJiraSpecStepStart(testInfo, 21);
  const target21 = await resolveJiraSpecTarget(page, {"strategy":"role","role":"checkbox","name":"Administrar usuarios","exact":true}, 2500, "select [permiso_administrar_usuarios]");
  const value21 = await resolveJiraSpecValue("permiso_administrar_usuarios", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target21, value21);
  await reportJiraSpecStepComplete(page, testInfo, 21, true, false);

  // 22. Presionar "Guardar política".
  await reportJiraSpecStepStart(testInfo, 22);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Guardar política","exact":true}, 2500, "Presionar \"Guardar política\".");
  await reportJiraSpecStepComplete(page, testInfo, 22, true, false);

  // 23. Validar que se muestre "La política de aprobación se guardó."
  await reportJiraSpecStepStart(testInfo, 23);
  await assertJiraSpecVisibleText(page, "La política de aprobación se guardó.", 15000, "Validar que se muestre \"La política de aprobación se guardó.\"");
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. Validar que la fila de "Laura M." refleje el rol elegido.
  await reportJiraSpecStepStart(testInfo, 24);
  await assertJiraSpecVisibleText(page, "Laura M.", 15000, "Validar que la fila de \"Laura M.\" refleje el rol elegido.");
  await reportJiraSpecStepComplete(page, testInfo, 24, false, true);

});
