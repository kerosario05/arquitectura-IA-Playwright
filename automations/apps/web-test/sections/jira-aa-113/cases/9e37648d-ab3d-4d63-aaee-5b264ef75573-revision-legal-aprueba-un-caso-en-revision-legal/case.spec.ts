import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Revisión Legal aprueba un caso En Revisión Legal", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 252000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "9e37648d-ab3d-4d63-aaee-5b264ef75573-revision-legal-aprueba-un-caso-en-revision-legal";
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

  // 6. Presionar "Bandeja Revisión Legal"
  await reportJiraSpecStepStart(testInfo, 6);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Bandeja Revisión Legal","exact":true}, 2500, "Presionar \"Bandeja Revisión Legal\"");
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Presionar "SOL-2026-0001"
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"css","value":":is(main,[role=\"main\"]) a[href=\"#/solicitud/SOL-2026-0001\"]"}, 2500, "Presionar \"SOL-2026-0001\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. Presionar "Aprobar caso y enviar a Negocios"
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Aprobar caso y enviar a Negocios","exact":true}, 2500, "Presionar \"Aprobar caso y enviar a Negocios\"");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. Presionar "Confirmar aprobación"
  await reportJiraSpecStepStart(testInfo, 9);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Confirmar aprobación","exact":true}, 2500, "Presionar \"Confirmar aprobación\"");
  await reportJiraSpecStepComplete(page, testInfo, 9, true, false);

  // 10. Validar que se muestre "Flujo de Solicitud"
  await reportJiraSpecStepStart(testInfo, 10);
  await assertJiraSpecVisibleText(page, "Flujo de Solicitud", 15000, "Validar que se muestre \"Flujo de Solicitud\"");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Validar que se muestre "Personas relacionadas"
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "Personas relacionadas", 15000, "Validar que se muestre \"Personas relacionadas\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, true);

});
