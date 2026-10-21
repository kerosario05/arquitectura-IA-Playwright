import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";
import { AuthFlow, setAuthFlowTestData } from "../../../../flows/auth.flow";

test("Verificar que el nombre y el alias guardados aparecen en la lista", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-105";
  const automationId = "aa-105-jira-5-verificar-que-el-nombre-y-el-alias-guardados-aparecen-en-la-lista";
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

  // 6. Presionar "Beneficiarios".
  await reportJiraSpecStepStart(testInfo, 6);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"♧ Beneficiarios","exact":true}, 2500, "Presionar \"Beneficiarios\".");
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Validar que la pantalla "Beneficiarios" esté abierta.
  await reportJiraSpecStepStart(testInfo, 7);
  await assertJiraSpecVisibleText(page, "Beneficiarios", 15000, "Validar que la pantalla \"Beneficiarios\" esté abierta.");
  await reportJiraSpecStepComplete(page, testInfo, 7, false, false);

  // 8. Presionar "Añadir beneficiario".
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Añadir beneficiario","exact":true}, 2500, "Presionar \"Añadir beneficiario\".");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. Validar que el formulario "Añadir beneficiario" esté abierto.
  await reportJiraSpecStepStart(testInfo, 9);
  await assertJiraSpecVisibleText(page, "Añadir beneficiario", 15000, "Validar que el formulario \"Añadir beneficiario\" esté abierto.");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Validar que el campo "Nombre del beneficiario" esté visible.
  await reportJiraSpecStepStart(testInfo, 10);
  await assertJiraSpecVisibleText(page, "Nombre del beneficiario", 15000, "Validar que el campo \"Nombre del beneficiario\" esté visible.");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Validar que el campo "Alias" esté visible.
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "Alias", 15000, "Validar que el campo \"Alias\" esté visible.");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. Validar que el campo "Número de cuenta" esté visible.
  await reportJiraSpecStepStart(testInfo, 12);
  await assertJiraSpecVisibleText(page, "Número de cuenta", 15000, "Validar que el campo \"Número de cuenta\" esté visible.");
  await reportJiraSpecStepComplete(page, testInfo, 12, false, false);

  // 13. Validar que el campo "Entidad bancaria" esté visible.
  await reportJiraSpecStepStart(testInfo, 13);
  await assertJiraSpecVisibleText(page, "Entidad bancaria", 15000, "Validar que el campo \"Entidad bancaria\" esté visible.");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. Validar que la opción "Correo electrónico" esté visible.
  await reportJiraSpecStepStart(testInfo, 14);
  await assertJiraSpecVisibleText(page, "Correo electrónico", 15000, "Validar que la opción \"Correo electrónico\" esté visible.");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. Validar que la opción "SMS" esté visible.
  await reportJiraSpecStepStart(testInfo, 15);
  await assertJiraSpecVisibleText(page, "SMS", 15000, "Validar que la opción \"SMS\" esté visible.");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. Validar que la opción "Notificación push" esté visible.
  await reportJiraSpecStepStart(testInfo, 16);
  await assertJiraSpecVisibleText(page, "Notificación push", 15000, "Validar que la opción \"Notificación push\" esté visible.");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. fill [beneficiary_name]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"beneficiary-name\"]"}, 2500, "fill [beneficiary_name]");
  const value17 = await resolveJiraSpecValue("beneficiary_name", appSlug, sectionSlug, automationId);
  await target17.fill(value17);
  if (await target17.inputValue() !== value17) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. fill [beneficiary_alias]
  await reportJiraSpecStepStart(testInfo, 18);
  const target18 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"beneficiary-alias\"]"}, 2500, "fill [beneficiary_alias]");
  const value18 = await resolveJiraSpecValue("beneficiary_alias", appSlug, sectionSlug, automationId);
  await target18.fill(value18);
  if (await target18.inputValue() !== value18) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. fill [beneficiary_account]
  await reportJiraSpecStepStart(testInfo, 19);
  const target19 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"beneficiary-account\"]"}, 2500, "fill [beneficiary_account]");
  const value19 = await resolveJiraSpecValue("beneficiary_account", appSlug, sectionSlug, automationId);
  await target19.fill(value19);
  if (await target19.inputValue() !== value19) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. fill [beneficiary_bank]
  await reportJiraSpecStepStart(testInfo, 20);
  const target20 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"beneficiary-bank\"]"}, 2500, "fill [beneficiary_bank]");
  const value20 = await resolveJiraSpecValue("beneficiary_bank", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target20, value20);
  await reportJiraSpecStepComplete(page, testInfo, 20, true, false);

  // 21. Presionar "Guardar beneficiario".
  await reportJiraSpecStepStart(testInfo, 21);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Guardar beneficiario","exact":true}, 2500, "Presionar \"Guardar beneficiario\".");
  await reportJiraSpecStepComplete(page, testInfo, 21, true, false);

  // 22. Validar que se muestre exactamente "Beneficiario agregado correctamente.".
  await reportJiraSpecStepStart(testInfo, 22);
  await assertJiraSpecVisibleText(page, "Beneficiario agregado correctamente.", 15000, "Validar que se muestre exactamente \"Beneficiario agregado correctamente.\".");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. Validar que el nombre del beneficiario aparezca en la lista "Destinatarios guardados".
  await reportJiraSpecStepStart(testInfo, 23);
  await assertJiraSpecVisibleText(page, "Destinatarios guardados", 15000, "Validar que el nombre del beneficiario aparezca en la lista \"Destinatarios guardados\".");
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. Validar que el alias aparezca en la lista "Destinatarios guardados".
  await reportJiraSpecStepStart(testInfo, 24);
  await assertJiraSpecVisibleText(page, "Destinatarios guardados", 15000, "Validar que el alias aparezca en la lista \"Destinatarios guardados\".");
  await reportJiraSpecStepComplete(page, testInfo, 24, false, true);

});
