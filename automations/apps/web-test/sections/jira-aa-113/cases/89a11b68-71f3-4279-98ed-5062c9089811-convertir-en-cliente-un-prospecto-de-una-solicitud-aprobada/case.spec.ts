import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Convertir en cliente un prospecto de una solicitud aprobada", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 240000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "89a11b68-71f3-4279-98ed-5062c9089811-convertir-en-cliente-un-prospecto-de-una-solicitud-aprobada";
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

  // 3. fill [jira_edit_6cf84e195c8806c3_2]
  await reportJiraSpecStepStart(testInfo, 3);
  const target3 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [jira_edit_6cf84e195c8806c3_2]");
  const value3 = await resolveJiraSpecValue("jira_edit_6cf84e195c8806c3_2", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target3.fill(value3));
  if (await target3.inputValue() !== value3) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 3, false, false);

  // 4. fill [jira_edit_6cf84e195c8806c3_3]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [jira_edit_6cf84e195c8806c3_3]");
  const value4 = await resolveJiraSpecValue("jira_edit_6cf84e195c8806c3_3", appSlug, sectionSlug, automationId);
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

  // 7. Presionar "SOL-2026-0003"
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"css","value":":is(main,[role=\"main\"]) a[href=\"#/solicitud/SOL-2026-0003\"]"}, 2500, "Presionar \"SOL-2026-0003\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. Presionar "Convertir prospecto a cliente"
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Convertir prospecto a cliente","exact":true}, 2500, "Presionar \"Convertir prospecto a cliente\"");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. Validar que se muestre "Flujo de Solicitud"
  await reportJiraSpecStepStart(testInfo, 9);
  await assertJiraSpecVisibleText(page, "Flujo de Solicitud", 15000, "Validar que se muestre \"Flujo de Solicitud\"");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Validar que se muestre "Personas relacionadas"
  await reportJiraSpecStepStart(testInfo, 10);
  await assertJiraSpecVisibleText(page, "Personas relacionadas", 15000, "Validar que se muestre \"Personas relacionadas\"");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, true);

});
