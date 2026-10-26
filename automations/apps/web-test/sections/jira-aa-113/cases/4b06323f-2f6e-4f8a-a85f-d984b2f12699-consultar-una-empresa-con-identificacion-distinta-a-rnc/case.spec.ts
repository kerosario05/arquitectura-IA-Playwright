import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Consultar una empresa con identificación distinta a RNC", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 312000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "4b06323f-2f6e-4f8a-a85f-d984b2f12699-consultar-una-empresa-con-identificacion-distinta-a-rnc";
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");

  // 1. Project entry
  await reportJiraSpecStepStart(testInfo, 1);
  await settleJiraAction(page, () => page.goto(baseUrl, { waitUntil: "domcontentloaded" }), baseUrl);
  await reportJiraSpecStepComplete(page, testInfo, 1, true, false);

  // 2. Abrir la aplicación configurada del proyecto
  await reportJiraSpecStepStart(testInfo, 2);
  await settleJiraAction(page, () => page.goto(baseUrl, { waitUntil: "domcontentloaded" }), baseUrl);
  await reportJiraSpecStepComplete(page, testInfo, 2, true, false);

  // 3. fill [usuario]
  await reportJiraSpecStepStart(testInfo, 3);
  const target3 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [usuario]");
  const value3 = await resolveJiraSpecValue("usuario", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target3.fill(value3));
  if (await target3.inputValue() !== value3) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 3, false, false);

  // 4. fill [contrasena]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [contrasena]");
  const value4 = await resolveJiraSpecValue("contrasena", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target4.fill(value4));
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 4, false, false);

  // 5. Presionar "iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 5);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"btn-login\"]"}, 2500, "Presionar \"iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 5, true, false);

  // 6. Presionar "Solicitudes"
  await reportJiraSpecStepStart(testInfo, 6);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Solicitudes","exact":true}, 2500, "Presionar \"Solicitudes\"");
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Presionar "Nueva solicitud"
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Nueva solicitud","exact":true}, 2500, "Presionar \"Nueva solicitud\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. select [jira_edit_7f52218fd8e65670_7]
  await reportJiraSpecStepStart(testInfo, 8);
  const target8 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"idTipo\"]"}, 2500, "select [jira_edit_7f52218fd8e65670_7]");
  const value8 = await resolveJiraSpecValue("jira_edit_7f52218fd8e65670_7", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => performJiraSpecSelection(target8, value8));
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. Validar que se muestre "País de Origen"
  await reportJiraSpecStepStart(testInfo, 9);
  await assertJiraSpecVisibleText(page, "País de Origen", 15000, "Validar que se muestre \"País de Origen\"");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Validar que se muestre "Registro en País de Origen"
  await reportJiraSpecStepStart(testInfo, 10);
  await assertJiraSpecVisibleText(page, "Registro en País de Origen", 15000, "Validar que se muestre \"Registro en País de Origen\"");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Validar que se muestre "Representante en el País"
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "Representante en el País", 15000, "Validar que se muestre \"Representante en el País\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, true);

});
