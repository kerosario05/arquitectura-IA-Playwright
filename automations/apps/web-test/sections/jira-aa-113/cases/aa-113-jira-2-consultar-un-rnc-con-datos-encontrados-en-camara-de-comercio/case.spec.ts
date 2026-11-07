import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Consultar un RNC con datos encontrados en Cámara de Comercio", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 252000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "aa-113-jira-2-consultar-un-rnc-con-datos-encontrados-en-camara-de-comercio";
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

  // 3. fill [usuario_negocios]
  await reportJiraSpecStepStart(testInfo, 3);
  const target3 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [usuario_negocios]");
  const value3 = await resolveJiraSpecValue("usuario_negocios", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target3.fill(value3));
  if (await target3.inputValue() !== value3) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 3, false, false);

  // 4. fill [contrasena_negocios]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [contrasena_negocios]");
  const value4 = await resolveJiraSpecValue("contrasena_negocios", appSlug, sectionSlug, automationId);
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

  // 8. fill [rnc_camara_comercio]
  await reportJiraSpecStepStart(testInfo, 8);
  const target8 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"idNumero\"]"}, 2500, "fill [rnc_camara_comercio]");
  const value8 = await resolveJiraSpecValue("rnc_camara_comercio", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target8.fill(value8));
  if (await target8.inputValue() !== value8) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 8, false, false);

  // 9. Presionar "consultar el RNC"
  await reportJiraSpecStepStart(testInfo, 9);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Consultar","exact":true}, 2500, "Presionar \"consultar el RNC\"");
  await reportJiraSpecStepComplete(page, testInfo, 9, true, false);

  // 10. Validar que se muestre "Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto."
  await reportJiraSpecStepStart(testInfo, 10);
  await assertJiraSpecVisibleText(page, "Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto.", 15000, "Validar que se muestre \"Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto.\"");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Validar Se muestra el resultado de Cámara de Comercio que indica que se encontraron datos y que fueron autocompletados.
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto.", 15000, "Validar Se muestra el resultado de Cámara de Comercio que indica que se encontraron datos y que fueron autocompletados.");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, true);

});
