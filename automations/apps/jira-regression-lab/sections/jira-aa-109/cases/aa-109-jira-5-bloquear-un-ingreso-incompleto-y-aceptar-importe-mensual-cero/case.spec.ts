import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecFieldValidation, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Bloquear un ingreso incompleto y aceptar importe mensual cero", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-109";
  const automationId = "aa-109-jira-5-bloquear-un-ingreso-incompleto-y-aceptar-importe-mensual-cero";
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

  // 3. Presionar "Personal"
  await reportJiraSpecStepStart(testInfo, 3);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Personal","exact":true}, 2500, "Presionar \"Personal\"");
  await reportJiraSpecStepComplete(page, testInfo, 3, true, false);

  // 4. fill [cedula]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-identity\"]"}, 2500, "fill [cedula]");
  const value4 = await resolveJiraSpecValue("cedula", appSlug, sectionSlug, automationId);
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

  // 7. Hacer clic en "Iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Hacer clic en \"Iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. Hacer clic en "el código por SMS"
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar código por SMS","exact":true}, 2500, "Hacer clic en \"el código por SMS\"");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. fill [codigo_sms]
  await reportJiraSpecStepStart(testInfo, 9);
  const target9 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-otp\"]"}, 2500, "fill [codigo_sms]");
  const value9 = await resolveJiraSpecValue("codigo_sms", appSlug, sectionSlug, automationId);
  await target9.fill(value9);
  if (await target9.inputValue() !== value9) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Hacer clic en "Continuar"
  await reportJiraSpecStepStart(testInfo, 10);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Hacer clic en \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 10, true, false);

  // 11. Validar que se muestre "el resumen personal"
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "el resumen personal", 15000, "Validar que se muestre \"el resumen personal\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. Hacer clic en "Solicitar préstamo"
  await reportJiraSpecStepStart(testInfo, 12);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar préstamo","exact":true}, 2500, "Hacer clic en \"Solicitar préstamo\"");
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. select [tipo_documento]
  await reportJiraSpecStepStart(testInfo, 13);
  const target13 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-document-type\"]"}, 2500, "select [tipo_documento]");
  const value13 = await resolveJiraSpecValue("tipo_documento", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target13, value13);
  await reportJiraSpecStepComplete(page, testInfo, 13, true, false);

  // 14. fill [numero_documento]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-document-number\"]"}, 2500, "fill [numero_documento]");
  const value14 = await resolveJiraSpecValue("numero_documento", appSlug, sectionSlug, automationId);
  await target14.fill(value14);
  if (await target14.inputValue() !== value14) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. fill [nombres]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-first-name\"]"}, 2500, "fill [nombres]");
  const value15 = await resolveJiraSpecValue("nombres", appSlug, sectionSlug, automationId);
  await target15.fill(value15);
  if (await target15.inputValue() !== value15) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. fill [apellidos]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-last-name\"]"}, 2500, "fill [apellidos]");
  const value16 = await resolveJiraSpecValue("apellidos", appSlug, sectionSlug, automationId);
  await target16.fill(value16);
  if (await target16.inputValue() !== value16) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. fill [fecha_nacimiento]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-birth-date\"]"}, 2500, "fill [fecha_nacimiento]");
  const value17 = await resolveJiraSpecValue("fecha_nacimiento", appSlug, sectionSlug, automationId);
  await target17.fill(value17);
  if (await target17.inputValue() !== value17) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. select [estado_civil]
  await reportJiraSpecStepStart(testInfo, 18);
  const target18 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-marital-status\"]"}, 2500, "select [estado_civil]");
  const value18 = await resolveJiraSpecValue("estado_civil", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target18, value18);
  await reportJiraSpecStepComplete(page, testInfo, 18, true, false);

  // 19. fill [personas_dependientes]
  await reportJiraSpecStepStart(testInfo, 19);
  const target19 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-dependents\"]"}, 2500, "fill [personas_dependientes]");
  const value19 = await resolveJiraSpecValue("personas_dependientes", appSlug, sectionSlug, automationId);
  await target19.fill(value19);
  if (await target19.inputValue() !== value19) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. Hacer clic en "Continuar"
  await reportJiraSpecStepStart(testInfo, 20);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Contacto y domicilio","exact":true}, 2500, "Hacer clic en \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 20, true, false);

  // 21. fill [correo_electronico]
  await reportJiraSpecStepStart(testInfo, 21);
  const target21 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-email\"]"}, 2500, "fill [correo_electronico]");
  const value21 = await resolveJiraSpecValue("correo_electronico", appSlug, sectionSlug, automationId);
  await target21.fill(value21);
  if (await target21.inputValue() !== value21) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 21, false, false);

  // 22. fill [telefono_movil]
  await reportJiraSpecStepStart(testInfo, 22);
  const target22 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-mobile\"]"}, 2500, "fill [telefono_movil]");
  const value22 = await resolveJiraSpecValue("telefono_movil", appSlug, sectionSlug, automationId);
  await target22.fill(value22);
  if (await target22.inputValue() !== value22) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. fill [telefono_alternativo]
  await reportJiraSpecStepStart(testInfo, 23);
  const target23 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-alt-phone\"]"}, 2500, "fill [telefono_alternativo]");
  const value23 = await resolveJiraSpecValue("telefono_alternativo", appSlug, sectionSlug, automationId);
  await target23.fill(value23);
  if (await target23.inputValue() !== value23) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. select [provincia]
  await reportJiraSpecStepStart(testInfo, 24);
  const target24 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-province\"]"}, 2500, "select [provincia]");
  const value24 = await resolveJiraSpecValue("provincia", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target24, value24);
  await reportJiraSpecStepComplete(page, testInfo, 24, true, false);

  // 25. select [municipio]
  await reportJiraSpecStepStart(testInfo, 25);
  const target25 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-city\"]"}, 2500, "select [municipio]");
  const value25 = await resolveJiraSpecValue("municipio", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target25, value25);
  await reportJiraSpecStepComplete(page, testInfo, 25, true, false);

  // 26. fill [sector_barrio]
  await reportJiraSpecStepStart(testInfo, 26);
  const target26 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-neighborhood\"]"}, 2500, "fill [sector_barrio]");
  const value26 = await resolveJiraSpecValue("sector_barrio", appSlug, sectionSlug, automationId);
  await target26.fill(value26);
  if (await target26.inputValue() !== value26) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 26, false, false);

  // 27. fill [direccion_residencial]
  await reportJiraSpecStepStart(testInfo, 27);
  const target27 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-address\"]"}, 2500, "fill [direccion_residencial]");
  const value27 = await resolveJiraSpecValue("direccion_residencial", appSlug, sectionSlug, automationId);
  await target27.fill(value27);
  if (await target27.inputValue() !== value27) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 27, false, false);

  // 28. fill [tiempo_direccion]
  await reportJiraSpecStepStart(testInfo, 28);
  const target28 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-address-years\"]"}, 2500, "fill [tiempo_direccion]");
  const value28 = await resolveJiraSpecValue("tiempo_direccion", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target28, value28);
  await reportJiraSpecStepComplete(page, testInfo, 28, true, false);

  // 29. Hacer clic en "Continuar"
  await reportJiraSpecStepStart(testInfo, 29);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Actividad laboral","exact":true}, 2500, "Hacer clic en \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 29, true, false);

  // 30. select [situacion_laboral]
  await reportJiraSpecStepStart(testInfo, 30);
  const target30 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-employment\"]"}, 2500, "select [situacion_laboral]");
  const value30 = await resolveJiraSpecValue("situacion_laboral", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target30, value30);
  await reportJiraSpecStepComplete(page, testInfo, 30, true, false);

  // 31. fill [empleador]
  await reportJiraSpecStepStart(testInfo, 31);
  const target31 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-employer\"]"}, 2500, "fill [empleador]");
  const value31 = await resolveJiraSpecValue("empleador", appSlug, sectionSlug, automationId);
  await target31.fill(value31);
  if (await target31.inputValue() !== value31) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 31, false, false);

  // 32. fill [cargo]
  await reportJiraSpecStepStart(testInfo, 32);
  const target32 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-occupation\"]"}, 2500, "fill [cargo]");
  const value32 = await resolveJiraSpecValue("cargo", appSlug, sectionSlug, automationId);
  await target32.fill(value32);
  if (await target32.inputValue() !== value32) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 32, false, false);

  // 33. select [sector_economico]
  await reportJiraSpecStepStart(testInfo, 33);
  const target33 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-industry\"]"}, 2500, "select [sector_economico]");
  const value33 = await resolveJiraSpecValue("sector_economico", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target33, value33);
  await reportJiraSpecStepComplete(page, testInfo, 33, true, false);

  // 34. fill [fecha_inicio_laboral]
  await reportJiraSpecStepStart(testInfo, 34);
  const target34 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-start-date\"]"}, 2500, "fill [fecha_inicio_laboral]");
  const value34 = await resolveJiraSpecValue("fecha_inicio_laboral", appSlug, sectionSlug, automationId);
  await target34.fill(value34);
  if (await target34.inputValue() !== value34) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 34, false, false);

  // 35. fill [telefono_laboral]
  await reportJiraSpecStepStart(testInfo, 35);
  const target35 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-work-phone\"]"}, 2500, "fill [telefono_laboral]");
  const value35 = await resolveJiraSpecValue("telefono_laboral", appSlug, sectionSlug, automationId);
  await target35.fill(value35);
  if (await target35.inputValue() !== value35) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 35, false, false);

  // 36. select [tipo_contrato]
  await reportJiraSpecStepStart(testInfo, 36);
  const target36 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-contract\"]"}, 2500, "select [tipo_contrato]");
  const value36 = await resolveJiraSpecValue("tipo_contrato", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target36, value36);
  await reportJiraSpecStepComplete(page, testInfo, 36, true, false);

  // 37. Hacer clic en "Continuar"
  await reportJiraSpecStepStart(testInfo, 37);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Ingresos","exact":true}, 2500, "Hacer clic en \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 37, true, false);

  // 38. fill [ingreso_principal]
  await reportJiraSpecStepStart(testInfo, 38);
  const target38 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income\"]"}, 2500, "fill [ingreso_principal]");
  const value38 = await resolveJiraSpecValue("ingreso_principal", appSlug, sectionSlug, automationId);
  await target38.fill(value38);
  if (await target38.inputValue() !== value38) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 38, false, false);

  // 39. fill [otros_ingresos]
  await reportJiraSpecStepStart(testInfo, 39);
  const target39 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-other-income\"]"}, 2500, "fill [otros_ingresos]");
  const value39 = await resolveJiraSpecValue("otros_ingresos", appSlug, sectionSlug, automationId);
  await target39.fill(value39);
  if (await target39.inputValue() !== value39) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 39, false, false);

  // 40. fill [origen_otros_ingresos]
  await reportJiraSpecStepStart(testInfo, 40);
  const target40 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-source\"]"}, 2500, "fill [origen_otros_ingresos]");
  const value40 = await resolveJiraSpecValue("origen_otros_ingresos", appSlug, sectionSlug, automationId);
  await target40.fill(value40);
  if (await target40.inputValue() !== value40) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 40, false, false);

  // 41. select [tipo_ingreso_primero]
  await reportJiraSpecStepStart(testInfo, 41);
  const target41 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-type\"]"}, 2500, "select [tipo_ingreso_primero]");
  const value41 = await resolveJiraSpecValue("tipo_ingreso_primero", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target41, value41);
  await reportJiraSpecStepComplete(page, testInfo, 41, true, false);

  // 42. fill [importe_ingreso_primero]
  await reportJiraSpecStepStart(testInfo, 42);
  const target42 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-amount\"]"}, 2500, "fill [importe_ingreso_primero]");
  const value42 = await resolveJiraSpecValue("importe_ingreso_primero", appSlug, sectionSlug, automationId);
  await target42.fill(value42);
  if (await target42.inputValue() !== value42) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 42, false, false);

  // 43. select [frecuencia_ingreso_primero]
  await reportJiraSpecStepStart(testInfo, 43);
  const target43 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-frequency\"]"}, 2500, "select [frecuencia_ingreso_primero]");
  const value43 = await resolveJiraSpecValue("frecuencia_ingreso_primero", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target43, value43);
  await reportJiraSpecStepComplete(page, testInfo, 43, true, false);

  // 44. Hacer clic en "Agregar ingreso"
  await reportJiraSpecStepStart(testInfo, 44);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Agregar ingreso","exact":true}, 2500, "Hacer clic en \"Agregar ingreso\"");
  await reportJiraSpecStepComplete(page, testInfo, 44, true, false);

  // 45. select [tipo_ingreso_agregado]
  await reportJiraSpecStepStart(testInfo, 45);
  const target45 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-2-type\"]"}, 2500, "select [tipo_ingreso_agregado]");
  const value45 = await resolveJiraSpecValue("tipo_ingreso_agregado", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target45, value45);
  await reportJiraSpecStepComplete(page, testInfo, 45, true, false);

  // 46. select [frecuencia_ingreso_agregado]
  await reportJiraSpecStepStart(testInfo, 46);
  const target46 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-2-frequency\"]"}, 2500, "select [frecuencia_ingreso_agregado]");
  const value46 = await resolveJiraSpecValue("frecuencia_ingreso_agregado", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target46, value46);
  await reportJiraSpecStepComplete(page, testInfo, 46, true, false);

  // 47. Hacer clic en "Continuar"
  await reportJiraSpecStepStart(testInfo, 47);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Compromisos","exact":true}, 2500, "Hacer clic en \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 47, true, false);

  // 48. Validar que se mantenga activa la sección "Ingresos"
  await reportJiraSpecStepStart(testInfo, 48);
  await assertJiraSpecVisibleText(page, "Ingresos", 15000, "Validar que se mantenga activa la sección \"Ingresos\"");
  await reportJiraSpecStepComplete(page, testInfo, 48, false, false);

  // 49. Validar que el campo "Importe mensual" muestre un error de validación
  await reportJiraSpecStepStart(testInfo, 49);
  await assertJiraSpecFieldValidation(page, "Importe mensual", 15000);
  await reportJiraSpecStepComplete(page, testInfo, 49, false, false);

  // 50. fill [importe_ingreso_agregado_cero]
  await reportJiraSpecStepStart(testInfo, 50);
  const target50 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-2-amount\"]"}, 2500, "fill [importe_ingreso_agregado_cero]");
  const value50 = await resolveJiraSpecValue("importe_ingreso_agregado_cero", appSlug, sectionSlug, automationId);
  await target50.fill(value50);
  if (await target50.inputValue() !== value50) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 50, false, false);

  // 51. Hacer clic en "Continuar"
  await reportJiraSpecStepStart(testInfo, 51);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Compromisos","exact":true}, 2500, "Hacer clic en \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 51, true, false);

  // 52. Validar que se muestre la sección "Compromisos"
  await reportJiraSpecStepStart(testInfo, 52);
  await assertJiraSpecVisibleText(page, "Compromisos", 15000, "Validar que se muestre la sección \"Compromisos\"");
  await reportJiraSpecStepComplete(page, testInfo, 52, false, true);

});
