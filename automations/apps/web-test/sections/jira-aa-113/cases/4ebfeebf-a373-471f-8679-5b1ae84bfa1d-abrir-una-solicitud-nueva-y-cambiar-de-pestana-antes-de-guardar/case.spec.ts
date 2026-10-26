import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Abrir una solicitud nueva y cambiar de pestaña antes de guardar", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 252000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "4ebfeebf-a373-471f-8679-5b1ae84bfa1d-abrir-una-solicitud-nueva-y-cambiar-de-pestana-antes-de-guardar";
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

  // 3. fill [jira_edit_1c55373b23f3d8da_2]
  await reportJiraSpecStepStart(testInfo, 3);
  const target3 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [jira_edit_1c55373b23f3d8da_2]");
  const value3 = await resolveJiraSpecValue("jira_edit_1c55373b23f3d8da_2", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target3.fill(value3));
  if (await target3.inputValue() !== value3) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 3, false, false);

  // 4. fill [jira_edit_1c55373b23f3d8da_3]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [jira_edit_1c55373b23f3d8da_3]");
  const value4 = await resolveJiraSpecValue("jira_edit_1c55373b23f3d8da_3", appSlug, sectionSlug, automationId);
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

  // 8. Presionar "Flujo de Solicitud"
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"tab","name":"Flujo de Solicitud","exact":true}, 2500, "Presionar \"Flujo de Solicitud\"");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. Presionar "Registro de Datos"
  await reportJiraSpecStepStart(testInfo, 9);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"tab","name":"Registro de Datos","exact":true}, 2500, "Presionar \"Registro de Datos\"");
  await reportJiraSpecStepComplete(page, testInfo, 9, true, false);

  // 10. Validar que se muestre "Denominación Social"
  await reportJiraSpecStepStart(testInfo, 10);
  await assertJiraSpecVisibleText(page, "Denominación Social", 15000, "Validar que se muestre \"Denominación Social\"");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Validar que se muestre "Número de Identificación"
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "Número de Identificación", 15000, "Validar que se muestre \"Número de Identificación\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, true);

});
