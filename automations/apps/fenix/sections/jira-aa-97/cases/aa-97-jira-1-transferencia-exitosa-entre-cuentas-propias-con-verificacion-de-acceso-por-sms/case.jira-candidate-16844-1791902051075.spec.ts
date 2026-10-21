import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecVisibleText, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Transferencia exitosa entre cuentas propias con verificación de acceso por SMS", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 432000));
  const appSlug = "fenix";
  const sectionSlug = "jira-aa-97";
  const automationId = "aa-97-jira-1-transferencia-exitosa-entre-cuentas-propias-con-verificacion-de-acceso-por-sms";
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");

  // 1. Project entry
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  // 2. Abrir la aplicación configurada del proyecto
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  // 3. Presionar "perfil empresarial"
  const target3 = await resolveJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Empresarial","exact":true}, 2500, "Presionar \"perfil empresarial\"");
  await target3.click();

  // 4. fill [rnc]
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"Enterprise\"]"}, 2500, "fill [rnc]");
  const value4 = await resolveJiraSpecValue("rnc", appSlug, sectionSlug, automationId);
  await target4.fill(value4);
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");

  // 5. fill [usuario]
  const target5 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"UserNameE\"]"}, 2500, "fill [usuario]");
  const value5 = await resolveJiraSpecValue("usuario", appSlug, sectionSlug, automationId);
  await target5.fill(value5);
  if (await target5.inputValue() !== value5) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");

  // 6. fill [contrasena]
  const target6 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"PasswordE\"]"}, 2500, "fill [contrasena]");
  const value6 = await resolveJiraSpecValue("contrasena", appSlug, sectionSlug, automationId);
  await target6.fill(value6);
  if (await target6.inputValue() !== value6) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");

  // 7. Presionar "continuar inicio de sesión"
  const target7 = await resolveJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"continuar inicio de sesión\"");
  await target7.click();

  // 8. Validar que se muestre "verificación de usuario"
  await assertJiraSpecVisibleText(page, "verificación de usuario", 15000);

  // 9. Presionar "Solicitar el código por SMS"
  const target9 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"SMS\")"}, 2500, "Presionar \"Solicitar el código por SMS\"");
  await target9.click();

  // 10. fill [jira_step_9]
  const value10 = await resolveJiraSpecValue("jira_step_9", appSlug, sectionSlug, automationId);
  await fillJiraSpecSegmentedCode(page, value10, {"strategy":"semantic","value":"segmented_code","metadata":{"originalTarget":"Código de acceso","resolvedTargetName":"segmented code input group","resolvedCandidateId":"6","repairType":"jira_segmented_code","validationStatus":"runtime_resolution_required"}});

  // 11. Presionar "continuar verificación de acceso"
  const target11 = await resolveJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"continuar verificación de acceso\"");
  await target11.click();

  // 12. Validar que se muestre "Resumen"
  await assertJiraSpecVisibleText(page, "Resumen", 15000);

  // 13. Presionar "Transferencias"
  const target13 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"Transferencias\")"}, 2500, "Presionar \"Transferencias\"");
  await target13.click();

  // 14. Presionar "Cuentas Propias"
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"TRANSFERS_INDIVIDUAL\"]"}, 2500, "Presionar \"Cuentas Propias\"");
  await target14.click();

  // 15. Validar que se muestre "cuenta de origen identificable"
  await assertJiraSpecVisibleText(page, "cuenta de origen identificable", 15000);

  // 16. Validar que se muestre "cuenta de destino identificable"
  await assertJiraSpecVisibleText(page, "cuenta de destino identificable", 15000);

  // 17. select [jira_step_16]
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"xpath","value":"(//*[normalize-space(.)='Cuenta Origen' and not(*[normalize-space(.)='Cuenta Origen'])]/following::span[normalize-space(.)='Seleccione una Cuenta'][1])[1]"}, 2500, "select [jira_step_16]");
  const value17 = await resolveJiraSpecValue("jira_step_16", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target17, value17);

  // 18. select [jira_step_17]
  const target18 = await resolveJiraSpecTarget(page, {"strategy":"xpath","value":"(//*[normalize-space(.)='Cuenta Destino' and not(*[normalize-space(.)='Cuenta Destino'])]/following::span[normalize-space(.)='Seleccione una Cuenta'][1])[1]"}, 2500, "select [jira_step_17]");
  const value18 = await resolveJiraSpecValue("jira_step_17", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target18, value18);

  // 19. fill [jira_step_18]
  const target19 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"transactionDetails_0__AmountPayment\"]"}, 2500, "fill [jira_step_18]");
  const value19 = await resolveJiraSpecValue("jira_step_18", appSlug, sectionSlug, automationId);
  await target19.fill(value19);
  if (await target19.inputValue() !== value19) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");

  // 20. Presionar "continuar transferencia"
  const target20 = await resolveJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"continuar transferencia\"");
  await target20.click();

  // 21. Validar que se muestre "cuentas seleccionadas"
  await assertJiraSpecVisibleText(page, "cuentas seleccionadas", 15000);

  // 22. Validar que se muestre "monto"
  await assertJiraSpecVisibleText(page, "monto", 15000);

  // 23. Validar que se muestre "comisión"
  await assertJiraSpecVisibleText(page, "comisión", 15000);

  // 24. Validar que se muestre "impuestos"
  await assertJiraSpecVisibleText(page, "impuestos", 15000);

  // 25. Validar que se muestre "tasa de cambio"
  await assertJiraSpecVisibleText(page, "tasa de cambio", 15000);

  // 26. Validar que se muestre "total a debitar"
  await assertJiraSpecVisibleText(page, "total a debitar", 15000);

  // 27. Presionar "continuar autorización"
  const target27 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"frmContinue\"]"}, 2500, "Presionar \"continuar autorización\"");
  await target27.click();

  // 28. Validar que se muestre "validación de identidad"
  await assertJiraSpecVisibleText(page, "validación de identidad", 15000);

  // 29. Presionar "Solicitar el token por SMS"
  const target29 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"SMS\")"}, 2500, "Presionar \"Solicitar el token por SMS\"");
  await target29.click();

  // 30. fill [token_transferencia]
  const value30 = await resolveJiraSpecValue("token_transferencia", appSlug, sectionSlug, automationId);
  await fillJiraSpecSegmentedCode(page, value30, {"strategy":"semantic","value":"segmented_code","metadata":{"originalTarget":"Token de seguridad","resolvedTargetName":"segmented code input group","resolvedCandidateId":"6","repairType":"jira_segmented_code","validationStatus":"runtime_resolution_required"}});

  // 31. Presionar "autorizar transferencia"
  const target31 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"validate_submit_token\"]"}, 2500, "Presionar \"autorizar transferencia\"");
  await target31.click();

  // 32. Validar que se muestre "comprobante de transacción exitosa"
  await assertJiraSpecVisibleText(page, "comprobante de transacción exitosa", 15000);

  // 33. Validar que se muestre "monto"
  await assertJiraSpecVisibleText(page, "monto", 15000);

  // 34. Validar que se muestre "cuentas involucradas"
  await assertJiraSpecVisibleText(page, "cuentas involucradas", 15000);

  // 35. Validar que se muestre "fecha y hora"
  await assertJiraSpecVisibleText(page, "fecha y hora", 15000);

  // 36. Validar que se muestre "referencia de la operación"
  await assertJiraSpecVisibleText(page, "referencia de la operación", 15000);

});
