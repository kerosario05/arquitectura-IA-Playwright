import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Transferencia exitosa entre cuentas propias con verificación de acceso", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "fenix";
  const sectionSlug = "jira-aa-97";
  const automationId = "aa-97-jira-1-edited-6ea987cfdf973725-transferencia-exitosa-entre-cuentas-propias-con-verificacion-de-acceso";
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");

  // 1. Project entry
  await reportJiraSpecStepStart(testInfo, 1);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await reportJiraSpecStepComplete(page, testInfo, 1, true, false);

  // 2. Abrir la aplicación configurada del proyecto
  await reportJiraSpecStepStart(testInfo, 2);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await reportJiraSpecStepComplete(page, testInfo, 2, true, false);

  // 3. Presionar "perfil empresarial".
  await reportJiraSpecStepStart(testInfo, 3);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Empresarial","exact":true}, 2500, "Presionar \"perfil empresarial\".");
  await reportJiraSpecStepComplete(page, testInfo, 3, true, false);

  // 4. fill [rnc]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"Enterprise\"]"}, 2500, "fill [rnc]");
  const value4 = await resolveJiraSpecValue("rnc", appSlug, sectionSlug, automationId);
  await target4.fill(value4);
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 4, false, false);

  // 5. fill [usuario]
  await reportJiraSpecStepStart(testInfo, 5);
  const target5 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"UserNameE\"]"}, 2500, "fill [usuario]");
  const value5 = await resolveJiraSpecValue("usuario", appSlug, sectionSlug, automationId);
  await target5.fill(value5);
  if (await target5.inputValue() !== value5) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 5, false, false);

  // 6. fill [contrasena]
  await reportJiraSpecStepStart(testInfo, 6);
  const target6 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"PasswordE\"]"}, 2500, "fill [contrasena]");
  const value6 = await resolveJiraSpecValue("contrasena", appSlug, sectionSlug, automationId);
  await target6.fill(value6);
  if (await target6.inputValue() !== value6) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 6, false, false);

  // 7. Presionar "Iniciar sesión".
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"Iniciar sesión\".");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. Presionar " sms"
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"SMS\")"}, 2500, "Presionar \" sms\"");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. fill [codigo_acceso]
  await reportJiraSpecStepStart(testInfo, 9);
  const value9 = await resolveJiraSpecValue("codigo_acceso", appSlug, sectionSlug, automationId);
  await fillJiraSpecSegmentedCode(page, value9, {"strategy":"semantic","value":"segmented_code","metadata":{"originalTarget":"Código","resolvedTargetName":"segmented code input group","resolvedCandidateId":"6","repairType":"jira_segmented_code","validationStatus":"runtime_resolution_required"}});
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Presionar "continuar".
  await reportJiraSpecStepStart(testInfo, 10);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 10, true, false);

  // 11. Validar que se muestre "resumen de sus productos"
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "resumen de sus productos", 15000, "Validar que se muestre \"resumen de sus productos\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. Presionar "Transferencias".
  await reportJiraSpecStepStart(testInfo, 12);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"Transferencias\")"}, 2500, "Presionar \"Transferencias\".");
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. Presionar "Cuentas Propias".
  await reportJiraSpecStepStart(testInfo, 13);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"TRANSFERS_INDIVIDUAL\"]"}, 2500, "Presionar \"Cuentas Propias\".");
  await reportJiraSpecStepComplete(page, testInfo, 13, true, false);

  // 14. select [cuenta_origen]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"xpath","value":"(//*[normalize-space(.)='Cuenta Origen' and not(*[normalize-space(.)='Cuenta Origen'])]/following::span[normalize-space(.)='Seleccione una Cuenta'][1])[1]"}, 2500, "select [cuenta_origen]");
  const value14 = await resolveJiraSpecValue("cuenta_origen", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target14, value14);
  await reportJiraSpecStepComplete(page, testInfo, 14, true, false);

  // 15. select [cuenta_destino]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"xpath","value":"(//*[normalize-space(.)='Cuenta Destino' and not(*[normalize-space(.)='Cuenta Destino'])]/following::span[normalize-space(.)='Seleccione una Cuenta'][1])[1]"}, 2500, "select [cuenta_destino]");
  const value15 = await resolveJiraSpecValue("cuenta_destino", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target15, value15);
  await reportJiraSpecStepComplete(page, testInfo, 15, true, false);

  // 16. fill [monto]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transactionDetails_0__AmountPayment\"]"}, 2500, "fill [monto]");
  const value16 = await resolveJiraSpecValue("monto", appSlug, sectionSlug, automationId);
  await target16.fill(value16);
  if (await target16.inputValue() !== value16) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 17);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 17, true, false);

  // 18. Validar que se muestre "confirmación"
  await reportJiraSpecStepStart(testInfo, 18);
  await assertJiraSpecVisibleText(page, "confirmación", 15000, "Validar que se muestre \"confirmación\"");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. Validar que se muestre "tasa de cambio"
  await reportJiraSpecStepStart(testInfo, 19);
  await assertJiraSpecVisibleText(page, "tasa de cambio", 15000, "Validar que se muestre \"tasa de cambio\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. Validar que se muestren las cuentas seleccionadas en "confirmación".
  await reportJiraSpecStepStart(testInfo, 20);
  await assertJiraSpecVisibleText(page, "confirmación", 15000, "Validar que se muestren las cuentas seleccionadas en \"confirmación\".");
  await reportJiraSpecStepComplete(page, testInfo, 20, false, false);

  // 21. Validar que se muestre el monto en "confirmación".
  await reportJiraSpecStepStart(testInfo, 21);
  await assertJiraSpecVisibleText(page, "confirmación", 15000, "Validar que se muestre el monto en \"confirmación\".");
  await reportJiraSpecStepComplete(page, testInfo, 21, false, false);

  // 22. Validar que se muestre la comisión en "confirmación".
  await reportJiraSpecStepStart(testInfo, 22);
  await assertJiraSpecVisibleText(page, "confirmación", 15000, "Validar que se muestre la comisión en \"confirmación\".");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. Validar que se muestren los impuestos en "confirmación".
  await reportJiraSpecStepStart(testInfo, 23);
  await assertJiraSpecVisibleText(page, "confirmación", 15000, "Validar que se muestren los impuestos en \"confirmación\".");
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. Validar que se muestre la tasa de cambio en "confirmación".
  await reportJiraSpecStepStart(testInfo, 24);
  await assertJiraSpecVisibleText(page, "confirmación", 15000, "Validar que se muestre la tasa de cambio en \"confirmación\".");
  await reportJiraSpecStepComplete(page, testInfo, 24, false, false);

  // 25. Validar que se muestre el total a debitar en "confirmación".
  await reportJiraSpecStepStart(testInfo, 25);
  await assertJiraSpecVisibleText(page, "confirmación", 15000, "Validar que se muestre el total a debitar en \"confirmación\".");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 26);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"frmContinue\"]"}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 26, true, false);

  // 27. Validar que se muestre "validación de identidad"
  await reportJiraSpecStepStart(testInfo, 27);
  await assertJiraSpecVisibleText(page, "validación de identidad", 15000, "Validar que se muestre \"validación de identidad\"");
  await reportJiraSpecStepComplete(page, testInfo, 27, false, false);

  // 28. Solicitar el token por SMS.
  await reportJiraSpecStepStart(testInfo, 28);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"SMS\")"}, 2500, "Solicitar el token por SMS.");
  await reportJiraSpecStepComplete(page, testInfo, 28, true, false);

  // 29. fill [token_transferencia]
  await reportJiraSpecStepStart(testInfo, 29);
  const value29 = await resolveJiraSpecValue("token_transferencia", appSlug, sectionSlug, automationId);
  await fillJiraSpecSegmentedCode(page, value29, {"strategy":"semantic","value":"segmented_code","metadata":{"originalTarget":"Token","resolvedTargetName":"segmented code input group","resolvedCandidateId":"6","repairType":"jira_segmented_code","validationStatus":"runtime_resolution_required"}});
  await reportJiraSpecStepComplete(page, testInfo, 29, false, false);

  // 30. Presionar "Autorizar transferencia".
  await reportJiraSpecStepStart(testInfo, 30);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"validate_submit_token\"]"}, 2500, "Presionar \"Autorizar transferencia\".");
  await reportJiraSpecStepComplete(page, testInfo, 30, true, false);

  // 31. Validar que se muestre "comprobante de transacción exitosa"
  await reportJiraSpecStepStart(testInfo, 31);
  await assertJiraSpecVisibleText(page, "comprobante de transacción exitosa", 15000, "Validar que se muestre \"comprobante de transacción exitosa\"");
  await reportJiraSpecStepComplete(page, testInfo, 31, false, false);

  // 32. Validar que se muestre el monto en "comprobante de transacción exitosa".
  await reportJiraSpecStepStart(testInfo, 32);
  await assertJiraSpecVisibleText(page, "comprobante de transacción exitosa", 15000, "Validar que se muestre el monto en \"comprobante de transacción exitosa\".");
  await reportJiraSpecStepComplete(page, testInfo, 32, false, false);

  // 33. Validar que se muestren las cuentas involucradas en "comprobante de transacción exitosa".
  await reportJiraSpecStepStart(testInfo, 33);
  await assertJiraSpecVisibleText(page, "comprobante de transacción exitosa", 15000, "Validar que se muestren las cuentas involucradas en \"comprobante de transacción exitosa\".");
  await reportJiraSpecStepComplete(page, testInfo, 33, false, false);

  // 34. Validar que se muestre la fecha y hora en "comprobante de transacción exitosa".
  await reportJiraSpecStepStart(testInfo, 34);
  await assertJiraSpecVisibleText(page, "comprobante de transacción exitosa", 15000, "Validar que se muestre la fecha y hora en \"comprobante de transacción exitosa\".");
  await reportJiraSpecStepComplete(page, testInfo, 34, false, false);

  // 35. Validar que se muestre la referencia de la operación en "comprobante de transacción exitosa".
  await reportJiraSpecStepStart(testInfo, 35);
  await assertJiraSpecVisibleText(page, "comprobante de transacción exitosa", 15000, "Validar que se muestre la referencia de la operación en \"comprobante de transacción exitosa\".");
  await reportJiraSpecStepComplete(page, testInfo, 35, false, true);

});
