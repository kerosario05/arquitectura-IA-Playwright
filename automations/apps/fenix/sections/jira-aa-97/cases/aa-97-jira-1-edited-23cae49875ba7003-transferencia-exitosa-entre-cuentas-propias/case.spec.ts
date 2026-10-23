import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Transferencia exitosa entre cuentas propias", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "fenix";
  const sectionSlug = "jira-aa-97";
  const automationId = "aa-97-jira-1-edited-23cae49875ba7003-transferencia-exitosa-entre-cuentas-propias";
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

  // 8. Validar que se muestre "verificación de usuario"
  await reportJiraSpecStepStart(testInfo, 8);
  await assertJiraSpecVisibleText(page, "verificación de usuario", 15000, "Validar que se muestre \"verificación de usuario\"");
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

  // 12. Validar que se muestre "resumen de sus productos"
  await reportJiraSpecStepStart(testInfo, 12);
  await assertJiraSpecVisibleText(page, "resumen de sus productos", 15000, "Validar que se muestre \"resumen de sus productos\"");
  await reportJiraSpecStepComplete(page, testInfo, 12, false, false);

  // 13. Presionar "Transferencias"
  await reportJiraSpecStepStart(testInfo, 13);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"Transferencias\")"}, 2500, "Presionar \"Transferencias\"");
  await reportJiraSpecStepComplete(page, testInfo, 13, true, false);

  // 14. Presionar "Cuentas Propias"
  await reportJiraSpecStepStart(testInfo, 14);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"TRANSFERS_INDIVIDUAL\"]"}, 2500, "Presionar \"Cuentas Propias\"");
  await reportJiraSpecStepComplete(page, testInfo, 14, true, false);

  // 15. select [cuenta_origen]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"xpath","value":"(//*[normalize-space(.)='Cuenta Origen' and not(*[normalize-space(.)='Cuenta Origen'])]/following::span[normalize-space(.)='Seleccione una Cuenta'][1])[1]"}, 2500, "select [cuenta_origen]");
  const value15 = await resolveJiraSpecValue("cuenta_origen", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => performJiraSpecSelection(target15, value15));
  await reportJiraSpecStepComplete(page, testInfo, 15, true, false);

  // 16. select [cuenta_destino]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"xpath","value":"(//*[normalize-space(.)='Cuenta Destino' and not(*[normalize-space(.)='Cuenta Destino'])]/following::span[normalize-space(.)='Seleccione una Cuenta'][1])[1]"}, 2500, "select [cuenta_destino]");
  const value16 = await resolveJiraSpecValue("cuenta_destino", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => performJiraSpecSelection(target16, value16));
  await reportJiraSpecStepComplete(page, testInfo, 16, true, false);

  // 17. fill [monto]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transactionDetails_0__AmountPayment\"]"}, 2500, "fill [monto]");
  const value17 = await resolveJiraSpecValue("monto", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target17.fill(value17));
  if (await target17.inputValue() !== value17) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. Presionar "Continuar"
  await reportJiraSpecStepStart(testInfo, 18);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 18, true, false);

  // 19. Validar que se muestre "monto"
  await reportJiraSpecStepStart(testInfo, 19);
  await assertJiraSpecVisibleText(page, "monto", 15000, "Validar que se muestre \"monto\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. Validar que se muestre "comisión"
  await reportJiraSpecStepStart(testInfo, 20);
  await assertJiraSpecVisibleText(page, "comisión", 15000, "Validar que se muestre \"comisión\"");
  await reportJiraSpecStepComplete(page, testInfo, 20, false, false);

  // 21. Validar que se muestre "impuestos"
  await reportJiraSpecStepStart(testInfo, 21);
  await assertJiraSpecVisibleText(page, "impuestos", 15000, "Validar que se muestre \"impuestos\"");
  await reportJiraSpecStepComplete(page, testInfo, 21, false, false);

  // 22. Validar que se muestre "total a debitar"
  await reportJiraSpecStepStart(testInfo, 22);
  await assertJiraSpecVisibleText(page, "total a debitar", 15000, "Validar que se muestre \"total a debitar\"");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. Validar que se muestre "tasa de cambio"
  await reportJiraSpecStepStart(testInfo, 23);
  await assertJiraSpecVisibleText(page, "tasa de cambio", 15000, "Validar que se muestre \"tasa de cambio\"");
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. Presionar "continuar"
  await reportJiraSpecStepStart(testInfo, 24);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"frmContinue\"]"}, 2500, "Presionar \"continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 24, true, false);

  // 25. Validar que se muestre "validación de identidad"
  await reportJiraSpecStepStart(testInfo, 25);
  await assertJiraSpecVisibleText(page, "validación de identidad", 15000, "Validar que se muestre \"validación de identidad\"");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Presionar "SMS"
  await reportJiraSpecStepStart(testInfo, 26);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"SMS\")"}, 2500, "Presionar \"SMS\"");
  await reportJiraSpecStepComplete(page, testInfo, 26, true, false);

  // 27. fill [token_autorizacion]
  await reportJiraSpecStepStart(testInfo, 27);
  const value27 = await resolveJiraSpecValue("token_autorizacion", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => fillJiraSpecSegmentedCode(page, value27, {"strategy":"semantic","value":"segmented_code","metadata":{"originalTarget":"Token","resolvedTargetName":"segmented code input group","resolvedCandidateId":"6","repairType":"jira_segmented_code","validationStatus":"runtime_resolution_required"}}));
  await reportJiraSpecStepComplete(page, testInfo, 27, false, false);

  // 28. Presionar "Autorizar transferencia"
  await reportJiraSpecStepStart(testInfo, 28);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"validate_submit_token\"]"}, 2500, "Presionar \"Autorizar transferencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 28, true, false);

  // 29. Validar que se muestre "comprobante de transacción exitosa"
  await reportJiraSpecStepStart(testInfo, 29);
  await assertJiraSpecVisibleText(page, "comprobante de transacción exitosa", 15000, "Validar que se muestre \"comprobante de transacción exitosa\"");
  await reportJiraSpecStepComplete(page, testInfo, 29, false, false);

  // 30. Validar que se muestre "monto"
  await reportJiraSpecStepStart(testInfo, 30);
  await assertJiraSpecVisibleText(page, "monto", 15000, "Validar que se muestre \"monto\"");
  await reportJiraSpecStepComplete(page, testInfo, 30, false, false);

  // 31. Validar que se muestre "las cuentas involucradas en el comprobante"
  await reportJiraSpecStepStart(testInfo, 31);
  await assertJiraSpecVisibleText(page, "las cuentas involucradas en el comprobante", 15000, "Validar que se muestre \"las cuentas involucradas en el comprobante\"");
  await reportJiraSpecStepComplete(page, testInfo, 31, false, false);

  // 32. Validar que se muestre "la fecha y hora en el comprobante"
  await reportJiraSpecStepStart(testInfo, 32);
  await assertJiraSpecVisibleText(page, "la fecha y hora en el comprobante", 15000, "Validar que se muestre \"la fecha y hora en el comprobante\"");
  await reportJiraSpecStepComplete(page, testInfo, 32, false, false);

  // 33. Validar que se muestre "la referencia de la operación en el comprobante"
  await reportJiraSpecStepStart(testInfo, 33);
  await assertJiraSpecVisibleText(page, "la referencia de la operación en el comprobante", 15000, "Validar que se muestre \"la referencia de la operación en el comprobante\"");
  await reportJiraSpecStepComplete(page, testInfo, 33, false, true);

});
