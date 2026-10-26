import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Consultar las notificaciones de solicitudes devueltas", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 216000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "ae1719a9-2a16-42b0-8d3c-42638ee10a1e-consultar-las-notificaciones-de-solicitudes-devueltas";
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

  // 3. fill [jira_edit_ecc2f999d9460baa_2]
  await reportJiraSpecStepStart(testInfo, 3);
  const target3 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [jira_edit_ecc2f999d9460baa_2]");
  const value3 = await resolveJiraSpecValue("jira_edit_ecc2f999d9460baa_2", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target3.fill(value3));
  if (await target3.inputValue() !== value3) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 3, false, false);

  // 4. fill [jira_edit_ecc2f999d9460baa_3]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [jira_edit_ecc2f999d9460baa_3]");
  const value4 = await resolveJiraSpecValue("jira_edit_ecc2f999d9460baa_3", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target4.fill(value4));
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 4, false, false);

  // 5. Presionar "iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 5);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"btn-login\"]"}, 2500, "Presionar \"iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 5, true, false);

  // 6. Presionar "Notificaciones"
  await reportJiraSpecStepStart(testInfo, 6);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[aria-label=\"Notificaciones\"]"}, 2500, "Presionar \"Notificaciones\"");
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Validar que se muestre "Solicitudes de prospectos PJ"
  await reportJiraSpecStepStart(testInfo, 7);
  await assertJiraSpecVisibleText(page, "Solicitudes de prospectos PJ", 15000, "Validar que se muestre \"Solicitudes de prospectos PJ\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, false, false);

  // 8. Validar que se muestre "Exportar CSV"
  await reportJiraSpecStepStart(testInfo, 8);
  await assertJiraSpecVisibleText(page, "Exportar CSV", 15000, "Validar que se muestre \"Exportar CSV\"");
  await reportJiraSpecStepComplete(page, testInfo, 8, false, true);

});
