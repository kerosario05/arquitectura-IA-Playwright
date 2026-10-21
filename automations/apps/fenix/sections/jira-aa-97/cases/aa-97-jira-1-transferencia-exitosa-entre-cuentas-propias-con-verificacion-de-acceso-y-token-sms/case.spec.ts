import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Transferencia exitosa entre cuentas propias con verificación de acceso y token SMS", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "fenix";
  const sectionSlug = "jira-aa-97";
  const automationId = "aa-97-jira-1-transferencia-exitosa-entre-cuentas-propias-con-verificacion-de-acceso-y-token-sms";
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");

  // 1. Project entry
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  // 2. Abrir la aplicación configurada del proyecto
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  // 3. Presionar "perfil empresarial"
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Empresarial","exact":true}, 2500, "Presionar \"perfil empresarial\"");

  // 4. fill [rnc_valido]
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"Enterprise\"]"}, 2500, "fill [rnc_valido]");
  const value4 = await resolveJiraSpecValue("rnc_valido", appSlug, sectionSlug, automationId);
  await target4.fill(value4);
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");

  // 5. fill [usuario_valido]
  const target5 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"UserNameE\"]"}, 2500, "fill [usuario_valido]");
  const value5 = await resolveJiraSpecValue("usuario_valido", appSlug, sectionSlug, automationId);
  await target5.fill(value5);
  if (await target5.inputValue() !== value5) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");

  // 6. fill [contrasena_valida]
  const target6 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"PasswordE\"]"}, 2500, "fill [contrasena_valida]");
  const value6 = await resolveJiraSpecValue("contrasena_valida", appSlug, sectionSlug, automationId);
  await target6.fill(value6);
  if (await target6.inputValue() !== value6) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");

  // 7. Presionar "continuar inicio de sesión"
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"continuar inicio de sesión\"");

  // 8. Validar que se muestre "verificación de usuario"
  await assertJiraSpecVisibleText(page, "verificación de usuario", 15000, "Validar que se muestre \"verificación de usuario\"");

  // 9. Solicitar el código por SMS
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"SMS\")"}, 2500, "Solicitar el código por SMS");

  // 10. fill [codigo_acceso_valido]
  const value10 = await resolveJiraSpecValue("codigo_acceso_valido", appSlug, sectionSlug, automationId);
  await fillJiraSpecSegmentedCode(page, value10, {"strategy":"semantic","value":"segmented_code","metadata":{"originalTarget":"Código","resolvedTargetName":"segmented code input group","resolvedCandidateId":"6","repairType":"jira_segmented_code","validationStatus":"runtime_resolution_required"}});

  // 11. Presionar "continuar inicio de sesión"
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"continuar inicio de sesión\"");

  // 12. Validar que se muestre "resumen de productos"
  await assertJiraSpecVisibleText(page, "resumen de productos", 15000, "Validar que se muestre \"resumen de productos\"");

  // 13. Presionar "Transferencias"
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"Transferencias\")"}, 2500, "Presionar \"Transferencias\"");

  // 14. Presionar "Cuentas Propias"
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"TRANSFERS_INDIVIDUAL\"]"}, 2500, "Presionar \"Cuentas Propias\"");

  // 15. Validar que se muestre "cuenta de origen"
  await assertJiraSpecVisibleText(page, "cuenta de origen", 15000, "Validar que se muestre \"cuenta de origen\"");

  // 16. Validar que se muestre "cuenta de destino"
  await assertJiraSpecVisibleText(page, "cuenta de destino", 15000, "Validar que se muestre \"cuenta de destino\"");

  // 17. select [cuenta_origen]
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"xpath","value":"(//*[normalize-space(.)='Cuenta Origen' and not(*[normalize-space(.)='Cuenta Origen'])]/following::span[normalize-space(.)='Seleccione una Cuenta'][1])[1]"}, 2500, "select [cuenta_origen]");
  const value17 = await resolveJiraSpecValue("cuenta_origen", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target17, value17);

  // 18. select [cuenta_destino]
  const target18 = await resolveJiraSpecTarget(page, {"strategy":"xpath","value":"(//*[normalize-space(.)='Cuenta Destino' and not(*[normalize-space(.)='Cuenta Destino'])]/following::span[normalize-space(.)='Seleccione una Cuenta'][1])[1]"}, 2500, "select [cuenta_destino]");
  const value18 = await resolveJiraSpecValue("cuenta_destino", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target18, value18);

  // 19. fill [monto_transferencia]
  const target19 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transactionDetails_0__AmountPayment\"]"}, 2500, "fill [monto_transferencia]");
  const value19 = await resolveJiraSpecValue("monto_transferencia", appSlug, sectionSlug, automationId);
  await target19.fill(value19);
  if (await target19.inputValue() !== value19) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");

  // 20. Presionar "Continuar"
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"Continuar\"");

  // 21. Validar que se muestre "cuentas seleccionadas"
  await assertJiraSpecVisibleText(page, "cuentas seleccionadas", 15000, "Validar que se muestre \"cuentas seleccionadas\"");

  // 22. Validar que se muestre "monto"
  await assertJiraSpecVisibleText(page, "monto", 15000, "Validar que se muestre \"monto\"");

  // 23. Validar que se muestre "comisión"
  await assertJiraSpecVisibleText(page, "comisión", 15000, "Validar que se muestre \"comisión\"");

  // 24. Validar que se muestre "impuestos"
  await assertJiraSpecVisibleText(page, "impuestos", 15000, "Validar que se muestre \"impuestos\"");

  // 25. Validar que se muestre "tasa de cambio"
  await assertJiraSpecVisibleText(page, "tasa de cambio", 15000, "Validar que se muestre \"tasa de cambio\"");

  // 26. Validar que se muestre "total a debitar"
  await assertJiraSpecVisibleText(page, "total a debitar", 15000, "Validar que se muestre \"total a debitar\"");

  // 27. Presionar "Continuar"
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"frmContinue\"]"}, 2500, "Presionar \"Continuar\"");

  // 28. Validar que se muestre "validación de identidad"
  await assertJiraSpecVisibleText(page, "validación de identidad", 15000, "Validar que se muestre \"validación de identidad\"");

  // 29. Solicitar el token por SMS
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"SMS\")"}, 2500, "Solicitar el token por SMS");

  // 30. fill [token_transferencia_valido]
  const value30 = await resolveJiraSpecValue("token_transferencia_valido", appSlug, sectionSlug, automationId);
  await fillJiraSpecSegmentedCode(page, value30, {"strategy":"semantic","value":"segmented_code","metadata":{"originalTarget":"Token","resolvedTargetName":"segmented code input group","resolvedCandidateId":"6","repairType":"jira_segmented_code","validationStatus":"runtime_resolution_required"}});

  // 31. Presionar "Autorizar transferencia"
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"validate_submit_token\"]"}, 2500, "Presionar \"Autorizar transferencia\"");

  // 32. Validar que se muestre "comprobante de transacción exitosa"
  await assertJiraSpecVisibleText(page, "comprobante de transacción exitosa", 15000, "Validar que se muestre \"comprobante de transacción exitosa\"");

  // 33. Validar que se muestre "monto"
  await assertJiraSpecVisibleText(page, "monto", 15000, "Validar que se muestre \"monto\"");

  // 34. Validar que se muestre "cuentas involucradas"
  await assertJiraSpecVisibleText(page, "cuentas involucradas", 15000, "Validar que se muestre \"cuentas involucradas\"");

  // 35. Validar que se muestre "fecha y hora"
  await assertJiraSpecVisibleText(page, "fecha y hora", 15000, "Validar que se muestre \"fecha y hora\"");

  // 36. Validar que se muestre "referencia de la operación"
  await assertJiraSpecVisibleText(page, "referencia de la operación", 15000, "Validar que se muestre \"referencia de la operación\"");

});
