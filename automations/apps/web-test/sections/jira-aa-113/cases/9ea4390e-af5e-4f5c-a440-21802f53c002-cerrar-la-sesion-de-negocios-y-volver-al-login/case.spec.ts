import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Cerrar la sesión de Negocios y volver al login", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 216000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "9ea4390e-af5e-4f5c-a440-21802f53c002-cerrar-la-sesion-de-negocios-y-volver-al-login";
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

  // 3. fill [jira_edit_318a34b22573bfa2_2]
  await reportJiraSpecStepStart(testInfo, 3);
  const target3 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [jira_edit_318a34b22573bfa2_2]");
  const value3 = await resolveJiraSpecValue("jira_edit_318a34b22573bfa2_2", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target3.fill(value3));
  if (await target3.inputValue() !== value3) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 3, false, false);

  // 4. fill [jira_edit_318a34b22573bfa2_3]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [jira_edit_318a34b22573bfa2_3]");
  const value4 = await resolveJiraSpecValue("jira_edit_318a34b22573bfa2_3", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target4.fill(value4));
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 4, false, false);

  // 5. Presionar "iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 5);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"btn-login\"]"}, 2500, "Presionar \"iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 5, true, false);

  // 6. Presionar "Salir"
  await reportJiraSpecStepStart(testInfo, 6);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Salir","exact":true}, 2500, "Presionar \"Salir\"");
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Validar que se muestre "Usuario"
  await reportJiraSpecStepStart(testInfo, 7);
  await assertJiraSpecVisibleText(page, "Usuario", 15000, "Validar que se muestre \"Usuario\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, false, false);

  // 8. Validar que se muestre "Iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 8);
  await assertJiraSpecVisibleText(page, "Iniciar sesión", 15000, "Validar que se muestre \"Iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 8, false, true);

});
