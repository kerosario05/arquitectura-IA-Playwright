import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Validar y guardar el Registro de Datos como borrador", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 360000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "075ae4cf-f567-4986-8eb0-f1f7e6f38bb2-validar-y-guardar-el-registro-de-datos-como-borrador";
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

  // 8. fill [jira_edit_c5710b11404d5ec2_7]
  await reportJiraSpecStepStart(testInfo, 8);
  const target8 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"idNumero\"]"}, 2500, "fill [jira_edit_c5710b11404d5ec2_7]");
  const value8 = await resolveJiraSpecValue("jira_edit_c5710b11404d5ec2_7", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target8.fill(value8));
  if (await target8.inputValue() !== value8) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 8, false, false);

  // 9. Presionar "Consultar"
  await reportJiraSpecStepStart(testInfo, 9);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Consultar","exact":true}, 2500, "Presionar \"Consultar\"");
  await reportJiraSpecStepComplete(page, testInfo, 9, true, false);

  // 10. fill [jira_edit_c5710b11404d5ec2_9]
  await reportJiraSpecStepStart(testInfo, 10);
  const target10 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"denominacion\"]"}, 2500, "fill [jira_edit_c5710b11404d5ec2_9]");
  const value10 = await resolveJiraSpecValue("jira_edit_c5710b11404d5ec2_9", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target10.fill(value10));
  if (await target10.inputValue() !== value10) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. select [jira_edit_c5710b11404d5ec2_10]
  await reportJiraSpecStepStart(testInfo, 11);
  const target11 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"tipoSociedad\"]"}, 2500, "select [jira_edit_c5710b11404d5ec2_10]");
  const value11 = await resolveJiraSpecValue("jira_edit_c5710b11404d5ec2_10", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => performJiraSpecSelection(target11, value11));
  await reportJiraSpecStepComplete(page, testInfo, 11, true, false);

  // 12. fill [jira_edit_c5710b11404d5ec2_11]
  await reportJiraSpecStepStart(testInfo, 12);
  const target12 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"fechaConstitucion\"]"}, 2500, "fill [jira_edit_c5710b11404d5ec2_11]");
  const value12 = await resolveJiraSpecValue("jira_edit_c5710b11404d5ec2_11", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target12.fill(value12));
  if (await target12.inputValue() !== value12) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 12, false, false);

  // 13. fill [jira_edit_c5710b11404d5ec2_12]
  await reportJiraSpecStepStart(testInfo, 13);
  const target13 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"calle\"]"}, 2500, "fill [jira_edit_c5710b11404d5ec2_12]");
  const value13 = await resolveJiraSpecValue("jira_edit_c5710b11404d5ec2_12", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target13.fill(value13));
  if (await target13.inputValue() !== value13) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. fill [jira_edit_c5710b11404d5ec2_13]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"municipio\"]"}, 2500, "fill [jira_edit_c5710b11404d5ec2_13]");
  const value14 = await resolveJiraSpecValue("jira_edit_c5710b11404d5ec2_13", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target14.fill(value14));
  if (await target14.inputValue() !== value14) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. fill [jira_edit_c5710b11404d5ec2_14]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"telefono1\"]"}, 2500, "fill [jira_edit_c5710b11404d5ec2_14]");
  const value15 = await resolveJiraSpecValue("jira_edit_c5710b11404d5ec2_14", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target15.fill(value15));
  if (await target15.inputValue() !== value15) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. fill [jira_edit_c5710b11404d5ec2_15]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"email\"]"}, 2500, "fill [jira_edit_c5710b11404d5ec2_15]");
  const value16 = await resolveJiraSpecValue("jira_edit_c5710b11404d5ec2_15", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target16.fill(value16));
  if (await target16.inputValue() !== value16) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. select [jira_edit_c5710b11404d5ec2_16]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"actividad\"]"}, 2500, "select [jira_edit_c5710b11404d5ec2_16]");
  const value17 = await resolveJiraSpecValue("jira_edit_c5710b11404d5ec2_16", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => performJiraSpecSelection(target17, value17));
  await reportJiraSpecStepComplete(page, testInfo, 17, true, false);

  // 18. Presionar "Guardar borrador"
  await reportJiraSpecStepStart(testInfo, 18);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Guardar borrador","exact":true}, 2500, "Presionar \"Guardar borrador\"");
  await reportJiraSpecStepComplete(page, testInfo, 18, true, false);

  // 19. Validar que se muestre "Flujo de Solicitud"
  await reportJiraSpecStepStart(testInfo, 19);
  await assertJiraSpecVisibleText(page, "Flujo de Solicitud", 15000, "Validar que se muestre \"Flujo de Solicitud\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. Validar que se muestre "Personas relacionadas"
  await reportJiraSpecStepStart(testInfo, 20);
  await assertJiraSpecVisibleText(page, "Personas relacionadas", 15000, "Validar que se muestre \"Personas relacionadas\"");
  await reportJiraSpecStepComplete(page, testInfo, 20, false, true);

});
