import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Transferencia exitosa entre cuentas propias con verificación de acceso y token", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "fenix";
  const sectionSlug = "jira-aa-97";
  const automationId = "aa-97-jira-1-edited-360f8ba99f25b34e-transferencia-exitosa-entre-cuentas-propias-con-verificacion-de-acceso-y-token";
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

  // 3. Presionar "perfil empresarial"
  await reportJiraSpecStepStart(testInfo, 3);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Empresarial","exact":true}, 2500, "Presionar \"perfil empresarial\"");
  await reportJiraSpecStepComplete(page, testInfo, 3, true, false);

  // 4. fill [rnc]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"Enterprise\"]"}, 2500, "fill [rnc]");
  const value4 = await resolveJiraSpecValue("rnc", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target4.fill(value4));
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 4, false, false);

  // 5. fill [usuario]
  await reportJiraSpecStepStart(testInfo, 5);
  const target5 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"UserNameE\"]"}, 2500, "fill [usuario]");
  const value5 = await resolveJiraSpecValue("usuario", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target5.fill(value5));
  if (await target5.inputValue() !== value5) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 5, false, false);

  // 6. fill [contrasena]
  await reportJiraSpecStepStart(testInfo, 6);
  const target6 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"PasswordE\"]"}, 2500, "fill [contrasena]");
  const value6 = await resolveJiraSpecValue("contrasena", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target6.fill(value6));
  if (await target6.inputValue() !== value6) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 6, false, false);

  // 7. Presionar "Iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"Iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. Validar que se muestre "la pantalla de verificación de usuario"
  await reportJiraSpecStepStart(testInfo, 8);
  await assertJiraSpecVisibleText(page, "la pantalla de verificación de usuario", 15000, "Validar que se muestre \"la pantalla de verificación de usuario\"");
  await reportJiraSpecStepComplete(page, testInfo, 8, false, false);

  // 9. Presionar "SMS"
  await reportJiraSpecStepStart(testInfo, 9);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"SMS\")"}, 2500, "Presionar \"SMS\"");
  await reportJiraSpecStepComplete(page, testInfo, 9, true, false);

  // 10. fill [codigo_acceso]
  await reportJiraSpecStepStart(testInfo, 10);
  const value10 = await resolveJiraSpecValue("codigo_acceso", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => fillJiraSpecSegmentedCode(page, value10, {"strategy":"semantic","value":"segmented_code","metadata":{"originalTarget":"Código","resolvedTargetName":"segmented code input group","resolvedCandidateId":"6","repairType":"jira_segmented_code","validationStatus":"runtime_resolution_required"}}));
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Presionar "continuar"
  await reportJiraSpecStepStart(testInfo, 11);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, true, false);

  // 12. Presionar "Transferencias"
  await reportJiraSpecStepStart(testInfo, 12);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"Transferencias\")"}, 2500, "Presionar \"Transferencias\"");
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. Presionar "Cuentas Propias"
  await reportJiraSpecStepStart(testInfo, 13);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"TRANSFERS_INDIVIDUAL\"]"}, 2500, "Presionar \"Cuentas Propias\"");
  await reportJiraSpecStepComplete(page, testInfo, 13, true, false);

  // 14. select [cuenta_origen]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"xpath","value":"(//*[normalize-space(.)='Cuenta Origen' and not(*[normalize-space(.)='Cuenta Origen'])]/following::span[normalize-space(.)='Seleccione una Cuenta'][1])[1]"}, 2500, "select [cuenta_origen]");
  const value14 = await resolveJiraSpecValue("cuenta_origen", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => performJiraSpecSelection(target14, value14));
  await reportJiraSpecStepComplete(page, testInfo, 14, true, false);

  // 15. select [cuenta_destino]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"xpath","value":"(//*[normalize-space(.)='Cuenta Destino' and not(*[normalize-space(.)='Cuenta Destino'])]/following::span[normalize-space(.)='Seleccione una Cuenta'][1])[1]"}, 2500, "select [cuenta_destino]");
  const value15 = await resolveJiraSpecValue("cuenta_destino", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => performJiraSpecSelection(target15, value15));
  await reportJiraSpecStepComplete(page, testInfo, 15, true, false);

  // 16. fill [monto]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transactionDetails_0__AmountPayment\"]"}, 2500, "fill [monto]");
  const value16 = await resolveJiraSpecValue("monto", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target16.fill(value16));
  if (await target16.inputValue() !== value16) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. Presionar "Continuar"
  await reportJiraSpecStepStart(testInfo, 17);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 17, true, false);

  // 18. Validar que se muestre "el resumen de confirmación de la transferencia"
  await reportJiraSpecStepStart(testInfo, 18);
  await assertJiraSpecVisibleText(page, "el resumen de confirmación de la transferencia", 15000, "Validar que se muestre \"el resumen de confirmación de la transferencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. Validar que se muestre "tasa de cambio"
  await reportJiraSpecStepStart(testInfo, 19);
  await assertJiraSpecVisibleText(page, "tasa de cambio", 15000, "Validar que se muestre \"tasa de cambio\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. Presionar "continuar"
  await reportJiraSpecStepStart(testInfo, 20);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"frmContinue\"]"}, 2500, "Presionar \"continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 20, true, false);

  // 21. Validar que se muestre "la pantalla de validación de identidad"
  await reportJiraSpecStepStart(testInfo, 21);
  await assertJiraSpecVisibleText(page, "la pantalla de validación de identidad", 15000, "Validar que se muestre \"la pantalla de validación de identidad\"");
  await reportJiraSpecStepComplete(page, testInfo, 21, false, false);

  // 22. Presionar "SMS"
  await reportJiraSpecStepStart(testInfo, 22);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"SMS\")"}, 2500, "Presionar \"SMS\"");
  await reportJiraSpecStepComplete(page, testInfo, 22, true, false);

  // 23. fill [token_autorizacion]
  await reportJiraSpecStepStart(testInfo, 23);
  const value23 = await resolveJiraSpecValue("token_autorizacion", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => fillJiraSpecSegmentedCode(page, value23, {"strategy":"semantic","value":"segmented_code","metadata":{"originalTarget":"Token","resolvedTargetName":"segmented code input group","resolvedCandidateId":"6","repairType":"jira_segmented_code","validationStatus":"runtime_resolution_required"}}));
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. Presionar "Autorizar transferencia"
  await reportJiraSpecStepStart(testInfo, 24);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"validate_submit_token\"]"}, 2500, "Presionar \"Autorizar transferencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 24, true, false);

  // 25. Validar que se muestre "comprobante de transacción exitosa"
  await reportJiraSpecStepStart(testInfo, 25);
  await assertJiraSpecVisibleText(page, "comprobante de transacción exitosa", 15000, "Validar que se muestre \"comprobante de transacción exitosa\"");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, true);

});
