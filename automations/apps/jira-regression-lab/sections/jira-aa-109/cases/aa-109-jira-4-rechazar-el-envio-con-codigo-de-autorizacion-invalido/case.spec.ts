import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecFieldValidation, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Rechazar el envío con código de autorización inválido", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-109";
  const automationId = "aa-109-jira-4-rechazar-el-envio-con-codigo-de-autorizacion-invalido";
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

  // 3. Presionar "Personal".
  await reportJiraSpecStepStart(testInfo, 3);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Personal","exact":true}, 2500, "Presionar \"Personal\".");
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

  // 7. Presionar "Iniciar sesión".
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"Iniciar sesión\".");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. Solicitar el código por SMS.
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar código por SMS","exact":true}, 2500, "Solicitar el código por SMS.");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. fill [codigo_sms]
  await reportJiraSpecStepStart(testInfo, 9);
  const target9 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-otp\"]"}, 2500, "fill [codigo_sms]");
  const value9 = await resolveJiraSpecValue("codigo_sms", appSlug, sectionSlug, automationId);
  await target9.fill(value9);
  if (await target9.inputValue() !== value9) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 10);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 10, true, false);

  // 11. Presionar "Solicitar préstamo".
  await reportJiraSpecStepStart(testInfo, 11);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar préstamo","exact":true}, 2500, "Presionar \"Solicitar préstamo\".");
  await reportJiraSpecStepComplete(page, testInfo, 11, true, false);

  // 12. select [tipo_documento]
  await reportJiraSpecStepStart(testInfo, 12);
  const target12 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-document-type\"]"}, 2500, "select [tipo_documento]");
  const value12 = await resolveJiraSpecValue("tipo_documento", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target12, value12);
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. fill [numero_documento]
  await reportJiraSpecStepStart(testInfo, 13);
  const target13 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-document-number\"]"}, 2500, "fill [numero_documento]");
  const value13 = await resolveJiraSpecValue("numero_documento", appSlug, sectionSlug, automationId);
  await target13.fill(value13);
  if (await target13.inputValue() !== value13) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. fill [nombres]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-first-name\"]"}, 2500, "fill [nombres]");
  const value14 = await resolveJiraSpecValue("nombres", appSlug, sectionSlug, automationId);
  await target14.fill(value14);
  if (await target14.inputValue() !== value14) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. fill [apellidos]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-last-name\"]"}, 2500, "fill [apellidos]");
  const value15 = await resolveJiraSpecValue("apellidos", appSlug, sectionSlug, automationId);
  await target15.fill(value15);
  if (await target15.inputValue() !== value15) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. fill [fecha_nacimiento]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-birth-date\"]"}, 2500, "fill [fecha_nacimiento]");
  const value16 = await resolveJiraSpecValue("fecha_nacimiento", appSlug, sectionSlug, automationId);
  await target16.fill(value16);
  if (await target16.inputValue() !== value16) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. select [estado_civil]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-marital-status\"]"}, 2500, "select [estado_civil]");
  const value17 = await resolveJiraSpecValue("estado_civil", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target17, value17);
  await reportJiraSpecStepComplete(page, testInfo, 17, true, false);

  // 18. fill [personas_dependientes]
  await reportJiraSpecStepStart(testInfo, 18);
  const target18 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-dependents\"]"}, 2500, "fill [personas_dependientes]");
  const value18 = await resolveJiraSpecValue("personas_dependientes", appSlug, sectionSlug, automationId);
  await target18.fill(value18);
  if (await target18.inputValue() !== value18) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 19);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Contacto y domicilio","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 19, true, false);

  // 20. fill [correo_electronico]
  await reportJiraSpecStepStart(testInfo, 20);
  const target20 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-email\"]"}, 2500, "fill [correo_electronico]");
  const value20 = await resolveJiraSpecValue("correo_electronico", appSlug, sectionSlug, automationId);
  await target20.fill(value20);
  if (await target20.inputValue() !== value20) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 20, false, false);

  // 21. fill [telefono_movil]
  await reportJiraSpecStepStart(testInfo, 21);
  const target21 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-mobile\"]"}, 2500, "fill [telefono_movil]");
  const value21 = await resolveJiraSpecValue("telefono_movil", appSlug, sectionSlug, automationId);
  await target21.fill(value21);
  if (await target21.inputValue() !== value21) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 21, false, false);

  // 22. fill [telefono_alternativo]
  await reportJiraSpecStepStart(testInfo, 22);
  const target22 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-alt-phone\"]"}, 2500, "fill [telefono_alternativo]");
  const value22 = await resolveJiraSpecValue("telefono_alternativo", appSlug, sectionSlug, automationId);
  await target22.fill(value22);
  if (await target22.inputValue() !== value22) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. select [provincia]
  await reportJiraSpecStepStart(testInfo, 23);
  const target23 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-province\"]"}, 2500, "select [provincia]");
  const value23 = await resolveJiraSpecValue("provincia", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target23, value23);
  await reportJiraSpecStepComplete(page, testInfo, 23, true, false);

  // 24. select [municipio]
  await reportJiraSpecStepStart(testInfo, 24);
  const target24 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-city\"]"}, 2500, "select [municipio]");
  const value24 = await resolveJiraSpecValue("municipio", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target24, value24);
  await reportJiraSpecStepComplete(page, testInfo, 24, true, false);

  // 25. fill [sector_barrio]
  await reportJiraSpecStepStart(testInfo, 25);
  const target25 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-neighborhood\"]"}, 2500, "fill [sector_barrio]");
  const value25 = await resolveJiraSpecValue("sector_barrio", appSlug, sectionSlug, automationId);
  await target25.fill(value25);
  if (await target25.inputValue() !== value25) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. fill [direccion_residencial]
  await reportJiraSpecStepStart(testInfo, 26);
  const target26 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-address\"]"}, 2500, "fill [direccion_residencial]");
  const value26 = await resolveJiraSpecValue("direccion_residencial", appSlug, sectionSlug, automationId);
  await target26.fill(value26);
  if (await target26.inputValue() !== value26) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 26, false, false);

  // 27. fill [tiempo_direccion]
  await reportJiraSpecStepStart(testInfo, 27);
  const target27 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-address-years\"]"}, 2500, "fill [tiempo_direccion]");
  const value27 = await resolveJiraSpecValue("tiempo_direccion", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target27, value27);
  await reportJiraSpecStepComplete(page, testInfo, 27, true, false);

  // 28. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 28);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Actividad laboral","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 28, true, false);

  // 29. select [situacion_laboral]
  await reportJiraSpecStepStart(testInfo, 29);
  const target29 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-employment\"]"}, 2500, "select [situacion_laboral]");
  const value29 = await resolveJiraSpecValue("situacion_laboral", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target29, value29);
  await reportJiraSpecStepComplete(page, testInfo, 29, true, false);

  // 30. fill [empleador_negocio]
  await reportJiraSpecStepStart(testInfo, 30);
  const target30 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-employer\"]"}, 2500, "fill [empleador_negocio]");
  const value30 = await resolveJiraSpecValue("empleador_negocio", appSlug, sectionSlug, automationId);
  await target30.fill(value30);
  if (await target30.inputValue() !== value30) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 30, false, false);

  // 31. fill [cargo_ocupacion]
  await reportJiraSpecStepStart(testInfo, 31);
  const target31 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-occupation\"]"}, 2500, "fill [cargo_ocupacion]");
  const value31 = await resolveJiraSpecValue("cargo_ocupacion", appSlug, sectionSlug, automationId);
  await target31.fill(value31);
  if (await target31.inputValue() !== value31) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 31, false, false);

  // 32. select [sector_economico]
  await reportJiraSpecStepStart(testInfo, 32);
  const target32 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-industry\"]"}, 2500, "select [sector_economico]");
  const value32 = await resolveJiraSpecValue("sector_economico", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target32, value32);
  await reportJiraSpecStepComplete(page, testInfo, 32, true, false);

  // 33. fill [fecha_inicio_laboral]
  await reportJiraSpecStepStart(testInfo, 33);
  const target33 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-start-date\"]"}, 2500, "fill [fecha_inicio_laboral]");
  const value33 = await resolveJiraSpecValue("fecha_inicio_laboral", appSlug, sectionSlug, automationId);
  await target33.fill(value33);
  if (await target33.inputValue() !== value33) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 33, false, false);

  // 34. fill [telefono_laboral]
  await reportJiraSpecStepStart(testInfo, 34);
  const target34 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-work-phone\"]"}, 2500, "fill [telefono_laboral]");
  const value34 = await resolveJiraSpecValue("telefono_laboral", appSlug, sectionSlug, automationId);
  await target34.fill(value34);
  if (await target34.inputValue() !== value34) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 34, false, false);

  // 35. select [tipo_contrato]
  await reportJiraSpecStepStart(testInfo, 35);
  const target35 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-contract\"]"}, 2500, "select [tipo_contrato]");
  const value35 = await resolveJiraSpecValue("tipo_contrato", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target35, value35);
  await reportJiraSpecStepComplete(page, testInfo, 35, true, false);

  // 36. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 36);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Ingresos","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 36, true, false);

  // 37. fill [ingreso_mensual_principal]
  await reportJiraSpecStepStart(testInfo, 37);
  const target37 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income\"]"}, 2500, "fill [ingreso_mensual_principal]");
  const value37 = await resolveJiraSpecValue("ingreso_mensual_principal", appSlug, sectionSlug, automationId);
  await target37.fill(value37);
  if (await target37.inputValue() !== value37) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 37, false, false);

  // 38. fill [otros_ingresos_mensuales]
  await reportJiraSpecStepStart(testInfo, 38);
  const target38 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-other-income\"]"}, 2500, "fill [otros_ingresos_mensuales]");
  const value38 = await resolveJiraSpecValue("otros_ingresos_mensuales", appSlug, sectionSlug, automationId);
  await target38.fill(value38);
  if (await target38.inputValue() !== value38) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 38, false, false);

  // 39. fill [origen_otros_ingresos]
  await reportJiraSpecStepStart(testInfo, 39);
  const target39 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-source\"]"}, 2500, "fill [origen_otros_ingresos]");
  const value39 = await resolveJiraSpecValue("origen_otros_ingresos", appSlug, sectionSlug, automationId);
  await target39.fill(value39);
  if (await target39.inputValue() !== value39) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 39, false, false);

  // 40. select [tipo_ingreso_1]
  await reportJiraSpecStepStart(testInfo, 40);
  const target40 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-type\"]"}, 2500, "select [tipo_ingreso_1]");
  const value40 = await resolveJiraSpecValue("tipo_ingreso_1", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target40, value40);
  await reportJiraSpecStepComplete(page, testInfo, 40, true, false);

  // 41. fill [importe_mensual_ingreso_1]
  await reportJiraSpecStepStart(testInfo, 41);
  const target41 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-amount\"]"}, 2500, "fill [importe_mensual_ingreso_1]");
  const value41 = await resolveJiraSpecValue("importe_mensual_ingreso_1", appSlug, sectionSlug, automationId);
  await target41.fill(value41);
  if (await target41.inputValue() !== value41) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 41, false, false);

  // 42. select [frecuencia_ingreso_1]
  await reportJiraSpecStepStart(testInfo, 42);
  const target42 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-frequency\"]"}, 2500, "select [frecuencia_ingreso_1]");
  const value42 = await resolveJiraSpecValue("frecuencia_ingreso_1", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target42, value42);
  await reportJiraSpecStepComplete(page, testInfo, 42, true, false);

  // 43. Presionar "Agregar ingreso".
  await reportJiraSpecStepStart(testInfo, 43);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Agregar ingreso","exact":true}, 2500, "Presionar \"Agregar ingreso\".");
  await reportJiraSpecStepComplete(page, testInfo, 43, true, false);

  // 44. select [tipo_ingreso_2]
  await reportJiraSpecStepStart(testInfo, 44);
  const target44 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-2-type\"]"}, 2500, "select [tipo_ingreso_2]");
  const value44 = await resolveJiraSpecValue("tipo_ingreso_2", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target44, value44);
  await reportJiraSpecStepComplete(page, testInfo, 44, true, false);

  // 45. fill [importe_mensual_ingreso_2]
  await reportJiraSpecStepStart(testInfo, 45);
  const target45 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-2-amount\"]"}, 2500, "fill [importe_mensual_ingreso_2]");
  const value45 = await resolveJiraSpecValue("importe_mensual_ingreso_2", appSlug, sectionSlug, automationId);
  await target45.fill(value45);
  if (await target45.inputValue() !== value45) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 45, false, false);

  // 46. select [frecuencia_ingreso_2]
  await reportJiraSpecStepStart(testInfo, 46);
  const target46 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-2-frequency\"]"}, 2500, "select [frecuencia_ingreso_2]");
  const value46 = await resolveJiraSpecValue("frecuencia_ingreso_2", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target46, value46);
  await reportJiraSpecStepComplete(page, testInfo, 46, true, false);

  // 47. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 47);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Compromisos","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 47, true, false);

  // 48. fill [gastos_mensuales_hogar]
  await reportJiraSpecStepStart(testInfo, 48);
  const target48 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-household-costs\"]"}, 2500, "fill [gastos_mensuales_hogar]");
  const value48 = await resolveJiraSpecValue("gastos_mensuales_hogar", appSlug, sectionSlug, automationId);
  await target48.fill(value48);
  if (await target48.inputValue() !== value48) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 48, false, false);

  // 49. fill [cuotas_prestamos_vigentes]
  await reportJiraSpecStepStart(testInfo, 49);
  const target49 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-existing-debt\"]"}, 2500, "fill [cuotas_prestamos_vigentes]");
  const value49 = await resolveJiraSpecValue("cuotas_prestamos_vigentes", appSlug, sectionSlug, automationId);
  await target49.fill(value49);
  if (await target49.inputValue() !== value49) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 49, false, false);

  // 50. fill [gasto_mensual_vivienda]
  await reportJiraSpecStepStart(testInfo, 50);
  const target50 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-housing-costs\"]"}, 2500, "fill [gasto_mensual_vivienda]");
  const value50 = await resolveJiraSpecValue("gasto_mensual_vivienda", appSlug, sectionSlug, automationId);
  await target50.fill(value50);
  if (await target50.inputValue() !== value50) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 50, false, false);

  // 51. select [dia_preferido_pago]
  await reportJiraSpecStepStart(testInfo, 51);
  const target51 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-payment-day\"]"}, 2500, "select [dia_preferido_pago]");
  const value51 = await resolveJiraSpecValue("dia_preferido_pago", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target51, value51);
  await reportJiraSpecStepComplete(page, testInfo, 51, true, false);

  // 52. select [tipo_compromiso_1]
  await reportJiraSpecStepStart(testInfo, 52);
  const target52 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-1-type\"]"}, 2500, "select [tipo_compromiso_1]");
  const value52 = await resolveJiraSpecValue("tipo_compromiso_1", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target52, value52);
  await reportJiraSpecStepComplete(page, testInfo, 52, true, false);

  // 53. fill [importe_compromiso_1]
  await reportJiraSpecStepStart(testInfo, 53);
  const target53 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-1-amount\"]"}, 2500, "fill [importe_compromiso_1]");
  const value53 = await resolveJiraSpecValue("importe_compromiso_1", appSlug, sectionSlug, automationId);
  await target53.fill(value53);
  if (await target53.inputValue() !== value53) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 53, false, false);

  // 54. select [frecuencia_compromiso_1]
  await reportJiraSpecStepStart(testInfo, 54);
  const target54 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-1-frequency\"]"}, 2500, "select [frecuencia_compromiso_1]");
  const value54 = await resolveJiraSpecValue("frecuencia_compromiso_1", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target54, value54);
  await reportJiraSpecStepComplete(page, testInfo, 54, true, false);

  // 55. Presionar "Agregar compromiso".
  await reportJiraSpecStepStart(testInfo, 55);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Agregar compromiso","exact":true}, 2500, "Presionar \"Agregar compromiso\".");
  await reportJiraSpecStepComplete(page, testInfo, 55, true, false);

  // 56. select [tipo_compromiso_2]
  await reportJiraSpecStepStart(testInfo, 56);
  const target56 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-2-type\"]"}, 2500, "select [tipo_compromiso_2]");
  const value56 = await resolveJiraSpecValue("tipo_compromiso_2", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target56, value56);
  await reportJiraSpecStepComplete(page, testInfo, 56, true, false);

  // 57. fill [importe_compromiso_2]
  await reportJiraSpecStepStart(testInfo, 57);
  const target57 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-2-amount\"]"}, 2500, "fill [importe_compromiso_2]");
  const value57 = await resolveJiraSpecValue("importe_compromiso_2", appSlug, sectionSlug, automationId);
  await target57.fill(value57);
  if (await target57.inputValue() !== value57) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 57, false, false);

  // 58. select [frecuencia_compromiso_2]
  await reportJiraSpecStepStart(testInfo, 58);
  const target58 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-2-frequency\"]"}, 2500, "select [frecuencia_compromiso_2]");
  const value58 = await resolveJiraSpecValue("frecuencia_compromiso_2", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target58, value58);
  await reportJiraSpecStepComplete(page, testInfo, 58, true, false);

  // 59. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 59);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Condiciones del préstamo","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 59, true, false);

  // 60. fill [monto_solicitado]
  await reportJiraSpecStepStart(testInfo, 60);
  const target60 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-amount\"]"}, 2500, "fill [monto_solicitado]");
  const value60 = await resolveJiraSpecValue("monto_solicitado", appSlug, sectionSlug, automationId);
  await target60.fill(value60);
  if (await target60.inputValue() !== value60) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 60, false, false);

  // 61. select [proposito_prestamo]
  await reportJiraSpecStepStart(testInfo, 61);
  const target61 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-purpose\"]"}, 2500, "select [proposito_prestamo]");
  const value61 = await resolveJiraSpecValue("proposito_prestamo", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target61, value61);
  await reportJiraSpecStepComplete(page, testInfo, 61, true, false);

  // 62. select [plazo_deseado]
  await reportJiraSpecStepStart(testInfo, 62);
  const target62 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-term\"]"}, 2500, "select [plazo_deseado]");
  const value62 = await resolveJiraSpecValue("plazo_deseado", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target62, value62);
  await reportJiraSpecStepComplete(page, testInfo, 62, true, false);

  // 63. select [cuenta_desembolso]
  await reportJiraSpecStepStart(testInfo, 63);
  const target63 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-disbursement-account\"]"}, 2500, "select [cuenta_desembolso]");
  const value63 = await resolveJiraSpecValue("cuenta_desembolso", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target63, value63);
  await reportJiraSpecStepComplete(page, testInfo, 63, true, false);

  // 64. select [frecuencia_pago]
  await reportJiraSpecStepStart(testInfo, 64);
  const target64 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-frequency\"]"}, 2500, "select [frecuencia_pago]");
  const value64 = await resolveJiraSpecValue("frecuencia_pago", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target64, value64);
  await reportJiraSpecStepComplete(page, testInfo, 64, true, false);

  // 65. fill [fecha_ideal_desembolso]
  await reportJiraSpecStepStart(testInfo, 65);
  const target65 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-disbursement-date\"]"}, 2500, "fill [fecha_ideal_desembolso]");
  const value65 = await resolveJiraSpecValue("fecha_ideal_desembolso", appSlug, sectionSlug, automationId);
  await target65.fill(value65);
  if (await target65.inputValue() !== value65) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 65, false, false);

  // 66. select [seguro_vida]
  await reportJiraSpecStepStart(testInfo, 66);
  const target66 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-insurance\"]"}, 2500, "select [seguro_vida]");
  const value66 = await resolveJiraSpecValue("seguro_vida", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target66, value66);
  await reportJiraSpecStepComplete(page, testInfo, 66, true, false);

  // 67. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 67);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Referencias personales","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 67, true, false);

  // 68. select [relacion_referencia_1]
  await reportJiraSpecStepStart(testInfo, 68);
  const target68 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref1-relation\"]"}, 2500, "select [relacion_referencia_1]");
  const value68 = await resolveJiraSpecValue("relacion_referencia_1", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target68, value68);
  await reportJiraSpecStepComplete(page, testInfo, 68, true, false);

  // 69. fill [nombre_referencia_1]
  await reportJiraSpecStepStart(testInfo, 69);
  const target69 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref1-name\"]"}, 2500, "fill [nombre_referencia_1]");
  const value69 = await resolveJiraSpecValue("nombre_referencia_1", appSlug, sectionSlug, automationId);
  await target69.fill(value69);
  if (await target69.inputValue() !== value69) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 69, false, false);

  // 70. fill [telefono_referencia_1]
  await reportJiraSpecStepStart(testInfo, 70);
  const target70 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref1-phone\"]"}, 2500, "fill [telefono_referencia_1]");
  const value70 = await resolveJiraSpecValue("telefono_referencia_1", appSlug, sectionSlug, automationId);
  await target70.fill(value70);
  if (await target70.inputValue() !== value70) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 70, false, false);

  // 71. select [relacion_referencia_2]
  await reportJiraSpecStepStart(testInfo, 71);
  const target71 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref2-relation\"]"}, 2500, "select [relacion_referencia_2]");
  const value71 = await resolveJiraSpecValue("relacion_referencia_2", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target71, value71);
  await reportJiraSpecStepComplete(page, testInfo, 71, true, false);

  // 72. fill [nombre_referencia_2]
  await reportJiraSpecStepStart(testInfo, 72);
  const target72 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref2-name\"]"}, 2500, "fill [nombre_referencia_2]");
  const value72 = await resolveJiraSpecValue("nombre_referencia_2", appSlug, sectionSlug, automationId);
  await target72.fill(value72);
  if (await target72.inputValue() !== value72) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 72, false, false);

  // 73. fill [telefono_referencia_2]
  await reportJiraSpecStepStart(testInfo, 73);
  const target73 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref2-phone\"]"}, 2500, "fill [telefono_referencia_2]");
  const value73 = await resolveJiraSpecValue("telefono_referencia_2", appSlug, sectionSlug, automationId);
  await target73.fill(value73);
  if (await target73.inputValue() !== value73) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 73, false, false);

  // 74. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 74);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Documentos y declaraciones","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 74, true, false);

  // 75. select [documento_identidad]
  await reportJiraSpecStepStart(testInfo, 75);
  const target75 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-id-document\"]"}, 2500, "select [documento_identidad]");
  const value75 = await resolveJiraSpecValue("documento_identidad", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target75, value75);
  await reportJiraSpecStepComplete(page, testInfo, 75, true, false);

  // 76. select [comprobante_ingresos]
  await reportJiraSpecStepStart(testInfo, 76);
  const target76 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-document\"]"}, 2500, "select [comprobante_ingresos]");
  const value76 = await resolveJiraSpecValue("comprobante_ingresos", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target76, value76);
  await reportJiraSpecStepComplete(page, testInfo, 76, true, false);

  // 77. select [comprobante_domicilio]
  await reportJiraSpecStepStart(testInfo, 77);
  const target77 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-address-document\"]"}, 2500, "select [comprobante_domicilio]");
  const value77 = await resolveJiraSpecValue("comprobante_domicilio", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target77, value77);
  await reportJiraSpecStepComplete(page, testInfo, 77, true, false);

  // 78. select [autorizacion_consulta_crediticia]
  await reportJiraSpecStepStart(testInfo, 78);
  const target78 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-credit-consent\"]"}, 2500, "select [autorizacion_consulta_crediticia]");
  const value78 = await resolveJiraSpecValue("autorizacion_consulta_crediticia", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target78, value78);
  await reportJiraSpecStepComplete(page, testInfo, 78, true, false);

  // 79. select [confirmacion_veracidad]
  await reportJiraSpecStepStart(testInfo, 79);
  const target79 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-accuracy\"]"}, 2500, "select [confirmacion_veracidad]");
  const value79 = await resolveJiraSpecValue("confirmacion_veracidad", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target79, value79);
  await reportJiraSpecStepComplete(page, testInfo, 79, true, false);

  // 80. select [canal_notificacion]
  await reportJiraSpecStepStart(testInfo, 80);
  const target80 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-notification-channel\"]"}, 2500, "select [canal_notificacion]");
  const value80 = await resolveJiraSpecValue("canal_notificacion", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target80, value80);
  await reportJiraSpecStepComplete(page, testInfo, 80, true, false);

  // 81. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 81);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Revisar solicitud","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 81, true, false);

  // 82. Validar que se muestre "datos capturados"
  await reportJiraSpecStepStart(testInfo, 82);
  await assertJiraSpecVisibleText(page, "datos capturados", 15000, "Validar que se muestre \"datos capturados\"");
  await reportJiraSpecStepComplete(page, testInfo, 82, false, false);

  // 83. Solicitar el código de autorización.
  await reportJiraSpecStepStart(testInfo, 83);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar código de autorización","exact":true}, 2500, "Solicitar el código de autorización.");
  await reportJiraSpecStepComplete(page, testInfo, 83, true, false);

  // 84. Validar que se muestre "Código de autorización"
  await reportJiraSpecStepStart(testInfo, 84);
  await assertJiraSpecVisibleText(page, "Código de autorización", 15000, "Validar que se muestre \"Código de autorización\"");
  await reportJiraSpecStepComplete(page, testInfo, 84, false, false);

  // 85. fill [codigo_autorizacion_invalido]
  await reportJiraSpecStepStart(testInfo, 85);
  const target85 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-authorization-code\"]"}, 2500, "fill [codigo_autorizacion_invalido]");
  const value85 = await resolveJiraSpecValue("codigo_autorizacion_invalido", appSlug, sectionSlug, automationId);
  await target85.fill(value85);
  if (await target85.inputValue() !== value85) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 85, false, false);

  // 86. Presionar "Enviar".
  await reportJiraSpecStepStart(testInfo, 86);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Enviar solicitud","exact":true}, 2500, "Presionar \"Enviar\".");
  await reportJiraSpecStepComplete(page, testInfo, 86, true, false);

  // 87. Validar que se muestre "error de código de autorización"
  await reportJiraSpecStepStart(testInfo, 87);
  await assertJiraSpecVisibleText(page, "error de código de autorización", 15000, "Validar que se muestre \"error de código de autorización\"");
  await reportJiraSpecStepComplete(page, testInfo, 87, false, true);

});
