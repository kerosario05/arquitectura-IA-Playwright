import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Programar, revisar, editar y confirmar un pago de servicio", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-110";
  const automationId = "aa-110-jira-1-programar-revisar-editar-y-confirmar-un-pago-de-servicio";
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

  // 3. Presionar "Empresarial".
  await reportJiraSpecStepStart(testInfo, 3);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Empresarial","exact":true}, 2500, "Presionar \"Empresarial\".");
  await reportJiraSpecStepComplete(page, testInfo, 3, true, false);

  // 4. fill [rnc]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-rnc\"]"}, 2500, "fill [rnc]");
  const value4 = await resolveJiraSpecValue("rnc", appSlug, sectionSlug, automationId);
  await target4.fill(value4);
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 4, false, false);

  // 5. fill [usuario]
  await reportJiraSpecStepStart(testInfo, 5);
  const target5 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-user\"]"}, 2500, "fill [usuario]");
  const value5 = await resolveJiraSpecValue("usuario", appSlug, sectionSlug, automationId);
  await target5.fill(value5);
  if (await target5.inputValue() !== value5) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 5, false, false);

  // 6. fill [contrasena]
  await reportJiraSpecStepStart(testInfo, 6);
  const target6 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-password\"]"}, 2500, "fill [contrasena]");
  const value6 = await resolveJiraSpecValue("contrasena", appSlug, sectionSlug, automationId);
  await target6.fill(value6);
  if (await target6.inputValue() !== value6) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 6, false, false);

  // 7. Presionar "Iniciar sesión".
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"Iniciar sesión\".");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. Solicitar el código por SMS.
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar código por SMS","exact":true}, 2500, "Solicitar el código por SMS.");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. fill [codigo_acceso_sms]
  await reportJiraSpecStepStart(testInfo, 9);
  const target9 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-otp\"]"}, 2500, "fill [codigo_acceso_sms]");
  const value9 = await resolveJiraSpecValue("codigo_acceso_sms", appSlug, sectionSlug, automationId);
  await target9.fill(value9);
  if (await target9.inputValue() !== value9) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 10);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 10, true, false);

  // 11. Validar que se muestre "Resumen de productos"
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "Resumen de productos", 15000, "Validar que se muestre \"Resumen de productos\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. Presionar "Pagos".
  await reportJiraSpecStepStart(testInfo, 12);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"▣ Pagos","exact":true}, 2500, "Presionar \"Pagos\".");
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. Validar que se muestre "Cargando información segura"
  await reportJiraSpecStepStart(testInfo, 13);
  await assertJiraSpecVisibleText(page, "Cargando información segura", 15000, "Validar que se muestre \"Cargando información segura\"");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. Validar que se muestre "Nuevo pago"
  await reportJiraSpecStepStart(testInfo, 14);
  await assertJiraSpecVisibleText(page, "Nuevo pago", 15000, "Validar que se muestre \"Nuevo pago\"");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. select [proveedor]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"provider\"]"}, 2500, "select [proveedor]");
  const value15 = await resolveJiraSpecValue("proveedor", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target15, value15);
  await reportJiraSpecStepComplete(page, testInfo, 15, true, false);

  // 16. fill [numero_contrato]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"contract-number\"]"}, 2500, "fill [numero_contrato]");
  const value16 = await resolveJiraSpecValue("numero_contrato", appSlug, sectionSlug, automationId);
  await target16.fill(value16);
  if (await target16.inputValue() !== value16) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. select [cuenta_debitar]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"payment-account\"]"}, 2500, "select [cuenta_debitar]");
  const value17 = await resolveJiraSpecValue("cuenta_debitar", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target17, value17);
  await reportJiraSpecStepComplete(page, testInfo, 17, true, false);

  // 18. fill [monto]
  await reportJiraSpecStepStart(testInfo, 18);
  const target18 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"payment-amount\"]"}, 2500, "fill [monto]");
  const value18 = await resolveJiraSpecValue("monto", appSlug, sectionSlug, automationId);
  await target18.fill(value18);
  if (await target18.inputValue() !== value18) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. fill [fecha_pago]
  await reportJiraSpecStepStart(testInfo, 19);
  const target19 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"payment-date\"]"}, 2500, "fill [fecha_pago]");
  const value19 = await resolveJiraSpecValue("fecha_pago", appSlug, sectionSlug, automationId);
  await target19.fill(value19);
  if (await target19.inputValue() !== value19) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. select [frecuencia]
  await reportJiraSpecStepStart(testInfo, 20);
  const target20 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"payment-frequency\"]"}, 2500, "select [frecuencia]");
  const value20 = await resolveJiraSpecValue("frecuencia", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target20, value20);
  await reportJiraSpecStepComplete(page, testInfo, 20, true, false);

  // 21. Presionar "Correo electrónico".
  await reportJiraSpecStepStart(testInfo, 21);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"label:visible:text-is(\"Correo electrónico\")"}, 2500, "Presionar \"Correo electrónico\".");
  await reportJiraSpecStepComplete(page, testInfo, 21, true, false);

  // 22. Presionar "SMS".
  await reportJiraSpecStepStart(testInfo, 22);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"label:visible:text-is(\"SMS\")"}, 2500, "Presionar \"SMS\".");
  await reportJiraSpecStepComplete(page, testInfo, 22, true, false);

  // 23. Presionar "Push".
  await reportJiraSpecStepStart(testInfo, 23);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"label:visible:text-is(\"Push\")"}, 2500, "Presionar \"Push\".");
  await reportJiraSpecStepComplete(page, testInfo, 23, true, false);

  // 24. Presionar "Revisar pago".
  await reportJiraSpecStepStart(testInfo, 24);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Revisar pago","exact":true}, 2500, "Presionar \"Revisar pago\".");
  await reportJiraSpecStepComplete(page, testInfo, 24, true, false);

  // 25. Validar que se muestre "Confirmación de pago"
  await reportJiraSpecStepStart(testInfo, 25);
  await assertJiraSpecVisibleText(page, "Confirmación de pago", 15000, "Validar que se muestre \"Confirmación de pago\"");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Validar que se muestre "Proveedor"
  await reportJiraSpecStepStart(testInfo, 26);
  await assertJiraSpecVisibleText(page, "Proveedor", 15000, "Validar que se muestre \"Proveedor\"");
  await reportJiraSpecStepComplete(page, testInfo, 26, false, false);

  // 27. Validar que se muestre "Contrato"
  await reportJiraSpecStepStart(testInfo, 27);
  await assertJiraSpecVisibleText(page, "Contrato", 15000, "Validar que se muestre \"Contrato\"");
  await reportJiraSpecStepComplete(page, testInfo, 27, false, false);

  // 28. Validar que se muestre "Cuenta a debitar"
  await reportJiraSpecStepStart(testInfo, 28);
  await assertJiraSpecVisibleText(page, "Cuenta a debitar", 15000, "Validar que se muestre \"Cuenta a debitar\"");
  await reportJiraSpecStepComplete(page, testInfo, 28, false, false);

  // 29. Validar que se muestre "Monto"
  await reportJiraSpecStepStart(testInfo, 29);
  await assertJiraSpecVisibleText(page, "Monto", 15000, "Validar que se muestre \"Monto\"");
  await reportJiraSpecStepComplete(page, testInfo, 29, false, false);

  // 30. Validar que se muestre "Fecha"
  await reportJiraSpecStepStart(testInfo, 30);
  await assertJiraSpecVisibleText(page, "Fecha", 15000, "Validar que se muestre \"Fecha\"");
  await reportJiraSpecStepComplete(page, testInfo, 30, false, false);

  // 31. Validar que se muestre "Frecuencia"
  await reportJiraSpecStepStart(testInfo, 31);
  await assertJiraSpecVisibleText(page, "Frecuencia", 15000, "Validar que se muestre \"Frecuencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 31, false, false);

  // 32. Validar que se muestre "Avisar al completar"
  await reportJiraSpecStepStart(testInfo, 32);
  await assertJiraSpecVisibleText(page, "Avisar al completar", 15000, "Validar que se muestre \"Avisar al completar\"");
  await reportJiraSpecStepComplete(page, testInfo, 32, false, false);

  // 33. Validar que se muestre "Correo electrónico"
  await reportJiraSpecStepStart(testInfo, 33);
  await assertJiraSpecVisibleText(page, "Correo electrónico", 15000, "Validar que se muestre \"Correo electrónico\"");
  await reportJiraSpecStepComplete(page, testInfo, 33, false, false);

  // 34. Validar que se muestre "SMS"
  await reportJiraSpecStepStart(testInfo, 34);
  await assertJiraSpecVisibleText(page, "SMS", 15000, "Validar que se muestre \"SMS\"");
  await reportJiraSpecStepComplete(page, testInfo, 34, false, false);

  // 35. Validar que se muestre "Push"
  await reportJiraSpecStepStart(testInfo, 35);
  await assertJiraSpecVisibleText(page, "Push", 15000, "Validar que se muestre \"Push\"");
  await reportJiraSpecStepComplete(page, testInfo, 35, false, false);

  // 36. Presionar "Editar".
  await reportJiraSpecStepStart(testInfo, 36);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Editar","exact":true}, 2500, "Presionar \"Editar\".");
  await reportJiraSpecStepComplete(page, testInfo, 36, true, false);

  // 37. Validar que se muestre "Nuevo pago"
  await reportJiraSpecStepStart(testInfo, 37);
  await assertJiraSpecVisibleText(page, "Nuevo pago", 15000, "Validar que se muestre \"Nuevo pago\"");
  await reportJiraSpecStepComplete(page, testInfo, 37, false, false);

  // 38. Validar que se muestre "Proveedor"
  await reportJiraSpecStepStart(testInfo, 38);
  await assertJiraSpecVisibleText(page, "Proveedor", 15000, "Validar que se muestre \"Proveedor\"");
  await reportJiraSpecStepComplete(page, testInfo, 38, false, false);

  // 39. Validar que se muestre "Número de contrato"
  await reportJiraSpecStepStart(testInfo, 39);
  await assertJiraSpecVisibleText(page, "Número de contrato", 15000, "Validar que se muestre \"Número de contrato\"");
  await reportJiraSpecStepComplete(page, testInfo, 39, false, false);

  // 40. Validar que se muestre "Cuenta a debitar"
  await reportJiraSpecStepStart(testInfo, 40);
  await assertJiraSpecVisibleText(page, "Cuenta a debitar", 15000, "Validar que se muestre \"Cuenta a debitar\"");
  await reportJiraSpecStepComplete(page, testInfo, 40, false, false);

  // 41. Validar que se muestre "Monto"
  await reportJiraSpecStepStart(testInfo, 41);
  await assertJiraSpecVisibleText(page, "Monto", 15000, "Validar que se muestre \"Monto\"");
  await reportJiraSpecStepComplete(page, testInfo, 41, false, false);

  // 42. Validar que se muestre "Fecha de pago"
  await reportJiraSpecStepStart(testInfo, 42);
  await assertJiraSpecVisibleText(page, "Fecha de pago", 15000, "Validar que se muestre \"Fecha de pago\"");
  await reportJiraSpecStepComplete(page, testInfo, 42, false, false);

  // 43. Validar que se muestre "Frecuencia"
  await reportJiraSpecStepStart(testInfo, 43);
  await assertJiraSpecVisibleText(page, "Frecuencia", 15000, "Validar que se muestre \"Frecuencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 43, false, false);

  // 44. Validar que se muestre "Correo electrónico"
  await reportJiraSpecStepStart(testInfo, 44);
  await assertJiraSpecVisibleText(page, "Correo electrónico", 15000, "Validar que se muestre \"Correo electrónico\"");
  await reportJiraSpecStepComplete(page, testInfo, 44, false, false);

  // 45. Validar que se muestre "SMS"
  await reportJiraSpecStepStart(testInfo, 45);
  await assertJiraSpecVisibleText(page, "SMS", 15000, "Validar que se muestre \"SMS\"");
  await reportJiraSpecStepComplete(page, testInfo, 45, false, false);

  // 46. Validar que se muestre "Push"
  await reportJiraSpecStepStart(testInfo, 46);
  await assertJiraSpecVisibleText(page, "Push", 15000, "Validar que se muestre \"Push\"");
  await reportJiraSpecStepComplete(page, testInfo, 46, false, false);

  // 47. Presionar "Revisar pago".
  await reportJiraSpecStepStart(testInfo, 47);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Revisar pago","exact":true}, 2500, "Presionar \"Revisar pago\".");
  await reportJiraSpecStepComplete(page, testInfo, 47, true, false);

  // 48. Validar que se muestre "Confirmación de pago"
  await reportJiraSpecStepStart(testInfo, 48);
  await assertJiraSpecVisibleText(page, "Confirmación de pago", 15000, "Validar que se muestre \"Confirmación de pago\"");
  await reportJiraSpecStepComplete(page, testInfo, 48, false, false);

  // 49. Presionar "Confirmar pago".
  await reportJiraSpecStepStart(testInfo, 49);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Confirmar pago","exact":true}, 2500, "Presionar \"Confirmar pago\".");
  await reportJiraSpecStepComplete(page, testInfo, 49, true, false);

  // 50. Validar que se muestre "Pago de prueba completado correctamente"
  await reportJiraSpecStepStart(testInfo, 50);
  await assertJiraSpecVisibleText(page, "Pago de prueba completado correctamente", 15000, "Validar que se muestre \"Pago de prueba completado correctamente\"");
  await reportJiraSpecStepComplete(page, testInfo, 50, false, true);

});
