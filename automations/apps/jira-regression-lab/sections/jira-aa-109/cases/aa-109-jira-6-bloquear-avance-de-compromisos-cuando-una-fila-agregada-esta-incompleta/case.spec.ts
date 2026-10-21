import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecFieldValidation, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Bloquear avance de compromisos cuando una fila agregada está incompleta", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-109";
  const automationId = "aa-109-jira-6-bloquear-avance-de-compromisos-cuando-una-fila-agregada-esta-incompleta";
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

  // 11. Hacer clic en "Solicitar préstamo"
  await reportJiraSpecStepStart(testInfo, 11);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar préstamo","exact":true}, 2500, "Hacer clic en \"Solicitar préstamo\"");
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

  // 19. Hacer clic en "Continuar"
  await reportJiraSpecStepStart(testInfo, 19);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Contacto y domicilio","exact":true}, 2500, "Hacer clic en \"Continuar\"");
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

  // 28. Hacer clic en "Continuar"
  await reportJiraSpecStepStart(testInfo, 28);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Actividad laboral","exact":true}, 2500, "Hacer clic en \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 28, true, false);

  // 29. select [situacion_laboral]
  await reportJiraSpecStepStart(testInfo, 29);
  const target29 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-employment\"]"}, 2500, "select [situacion_laboral]");
  const value29 = await resolveJiraSpecValue("situacion_laboral", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target29, value29);
  await reportJiraSpecStepComplete(page, testInfo, 29, true, false);

  // 30. fill [empleador]
  await reportJiraSpecStepStart(testInfo, 30);
  const target30 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-employer\"]"}, 2500, "fill [empleador]");
  const value30 = await resolveJiraSpecValue("empleador", appSlug, sectionSlug, automationId);
  await target30.fill(value30);
  if (await target30.inputValue() !== value30) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 30, false, false);

  // 31. fill [cargo]
  await reportJiraSpecStepStart(testInfo, 31);
  const target31 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-occupation\"]"}, 2500, "fill [cargo]");
  const value31 = await resolveJiraSpecValue("cargo", appSlug, sectionSlug, automationId);
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

  // 36. Hacer clic en "Continuar"
  await reportJiraSpecStepStart(testInfo, 36);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Ingresos","exact":true}, 2500, "Hacer clic en \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 36, true, false);

  // 37. fill [ingreso_principal]
  await reportJiraSpecStepStart(testInfo, 37);
  const target37 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income\"]"}, 2500, "fill [ingreso_principal]");
  const value37 = await resolveJiraSpecValue("ingreso_principal", appSlug, sectionSlug, automationId);
  await target37.fill(value37);
  if (await target37.inputValue() !== value37) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 37, false, false);

  // 38. fill [otros_ingresos]
  await reportJiraSpecStepStart(testInfo, 38);
  const target38 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-other-income\"]"}, 2500, "fill [otros_ingresos]");
  const value38 = await resolveJiraSpecValue("otros_ingresos", appSlug, sectionSlug, automationId);
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

  // 40. select [tipo_ingreso]
  await reportJiraSpecStepStart(testInfo, 40);
  const target40 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-type\"]"}, 2500, "select [tipo_ingreso]");
  const value40 = await resolveJiraSpecValue("tipo_ingreso", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target40, value40);
  await reportJiraSpecStepComplete(page, testInfo, 40, true, false);

  // 41. fill [importe_ingreso]
  await reportJiraSpecStepStart(testInfo, 41);
  const target41 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-amount\"]"}, 2500, "fill [importe_ingreso]");
  const value41 = await resolveJiraSpecValue("importe_ingreso", appSlug, sectionSlug, automationId);
  await target41.fill(value41);
  if (await target41.inputValue() !== value41) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 41, false, false);

  // 42. select [frecuencia_ingreso]
  await reportJiraSpecStepStart(testInfo, 42);
  const target42 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-frequency\"]"}, 2500, "select [frecuencia_ingreso]");
  const value42 = await resolveJiraSpecValue("frecuencia_ingreso", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target42, value42);
  await reportJiraSpecStepComplete(page, testInfo, 42, true, false);

  // 43. Hacer clic en "Continuar"
  await reportJiraSpecStepStart(testInfo, 43);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Compromisos","exact":true}, 2500, "Hacer clic en \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 43, true, false);

  // 44. fill [gastos_hogar]
  await reportJiraSpecStepStart(testInfo, 44);
  const target44 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-household-costs\"]"}, 2500, "fill [gastos_hogar]");
  const value44 = await resolveJiraSpecValue("gastos_hogar", appSlug, sectionSlug, automationId);
  await target44.fill(value44);
  if (await target44.inputValue() !== value44) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 44, false, false);

  // 45. fill [cuotas_prestamos]
  await reportJiraSpecStepStart(testInfo, 45);
  const target45 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-existing-debt\"]"}, 2500, "fill [cuotas_prestamos]");
  const value45 = await resolveJiraSpecValue("cuotas_prestamos", appSlug, sectionSlug, automationId);
  await target45.fill(value45);
  if (await target45.inputValue() !== value45) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 45, false, false);

  // 46. fill [gasto_vivienda]
  await reportJiraSpecStepStart(testInfo, 46);
  const target46 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-housing-costs\"]"}, 2500, "fill [gasto_vivienda]");
  const value46 = await resolveJiraSpecValue("gasto_vivienda", appSlug, sectionSlug, automationId);
  await target46.fill(value46);
  if (await target46.inputValue() !== value46) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 46, false, false);

  // 47. select [dia_pago]
  await reportJiraSpecStepStart(testInfo, 47);
  const target47 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-payment-day\"]"}, 2500, "select [dia_pago]");
  const value47 = await resolveJiraSpecValue("dia_pago", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target47, value47);
  await reportJiraSpecStepComplete(page, testInfo, 47, true, false);

  // 48. select [tipo_compromiso_primero]
  await reportJiraSpecStepStart(testInfo, 48);
  const target48 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-1-type\"]"}, 2500, "select [tipo_compromiso_primero]");
  const value48 = await resolveJiraSpecValue("tipo_compromiso_primero", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target48, value48);
  await reportJiraSpecStepComplete(page, testInfo, 48, true, false);

  // 49. fill [importe_compromiso_primero]
  await reportJiraSpecStepStart(testInfo, 49);
  const target49 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-1-amount\"]"}, 2500, "fill [importe_compromiso_primero]");
  const value49 = await resolveJiraSpecValue("importe_compromiso_primero", appSlug, sectionSlug, automationId);
  await target49.fill(value49);
  if (await target49.inputValue() !== value49) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 49, false, false);

  // 50. select [frecuencia_compromiso_primero]
  await reportJiraSpecStepStart(testInfo, 50);
  const target50 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-1-frequency\"]"}, 2500, "select [frecuencia_compromiso_primero]");
  const value50 = await resolveJiraSpecValue("frecuencia_compromiso_primero", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target50, value50);
  await reportJiraSpecStepComplete(page, testInfo, 50, true, false);

  // 51. Hacer clic en "Agregar compromiso"
  await reportJiraSpecStepStart(testInfo, 51);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Agregar compromiso","exact":true}, 2500, "Hacer clic en \"Agregar compromiso\"");
  await reportJiraSpecStepComplete(page, testInfo, 51, true, false);

  // 52. select [tipo_compromiso_agregado]
  await reportJiraSpecStepStart(testInfo, 52);
  const target52 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-2-type\"]"}, 2500, "select [tipo_compromiso_agregado]");
  const value52 = await resolveJiraSpecValue("tipo_compromiso_agregado", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target52, value52);
  await reportJiraSpecStepComplete(page, testInfo, 52, true, false);

  // 53. select [frecuencia_compromiso_agregado]
  await reportJiraSpecStepStart(testInfo, 53);
  const target53 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-2-frequency\"]"}, 2500, "select [frecuencia_compromiso_agregado]");
  const value53 = await resolveJiraSpecValue("frecuencia_compromiso_agregado", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target53, value53);
  await reportJiraSpecStepComplete(page, testInfo, 53, true, false);

  // 54. Hacer clic en "Continuar"
  await reportJiraSpecStepStart(testInfo, 54);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Condiciones del préstamo","exact":true}, 2500, "Hacer clic en \"Continuar\"");
  await reportJiraSpecStepComplete(page, testInfo, 54, true, false);

  // 55. Validar que se mantenga activa la sección "Compromisos"
  await reportJiraSpecStepStart(testInfo, 55);
  await assertJiraSpecVisibleText(page, "Compromisos", 15000, "Validar que se mantenga activa la sección \"Compromisos\"");
  await reportJiraSpecStepComplete(page, testInfo, 55, false, false);

  // 56. Validar que el campo "Importe" muestre un error de validación
  await reportJiraSpecStepStart(testInfo, 56);
  await assertJiraSpecFieldValidation(page, "Importe", 15000);
  await reportJiraSpecStepComplete(page, testInfo, 56, false, true);

});
