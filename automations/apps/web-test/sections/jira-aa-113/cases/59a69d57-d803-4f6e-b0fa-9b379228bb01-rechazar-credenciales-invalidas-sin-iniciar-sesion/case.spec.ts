import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Rechazar credenciales inválidas sin iniciar sesión", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 204000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "59a69d57-d803-4f6e-b0fa-9b379228bb01-rechazar-credenciales-invalidas-sin-iniciar-sesion";
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

  // 3. fill [jira_edit_1ea7d7cba7a496e1_2]
  await reportJiraSpecStepStart(testInfo, 3);
  const target3 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [jira_edit_1ea7d7cba7a496e1_2]");
  const value3 = await resolveJiraSpecValue("jira_edit_1ea7d7cba7a496e1_2", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target3.fill(value3));
  if (await target3.inputValue() !== value3) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 3, false, false);

  // 4. fill [jira_edit_1ea7d7cba7a496e1_3]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [jira_edit_1ea7d7cba7a496e1_3]");
  const value4 = await resolveJiraSpecValue("jira_edit_1ea7d7cba7a496e1_3", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target4.fill(value4));
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 4, false, false);

  // 5. Presionar "iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 5);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"btn-login\"]"}, 2500, "Presionar \"iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 5, true, false);

  // 6. Validar que se muestre "Usuario"
  await reportJiraSpecStepStart(testInfo, 6);
  await assertJiraSpecVisibleText(page, "Usuario", 15000, "Validar que se muestre \"Usuario\"");
  await reportJiraSpecStepComplete(page, testInfo, 6, false, false);

  // 7. Validar que se muestre "Iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 7);
  await assertJiraSpecVisibleText(page, "Iniciar sesión", 15000, "Validar que se muestre \"Iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, false, true);

});
