import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecFieldValidation, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Enviar solicitud personal de préstamo con autorización válida", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-109";
  const automationId = "aa-109-jira-1-enviar-solicitud-personal-de-prestamo-con-autorizacion-valida";
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

  // 11. Validar que se muestre "resumen personal"
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "resumen personal", 15000, "Validar que se muestre \"resumen personal\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. Validar que se muestre "productos"
  await reportJiraSpecStepStart(testInfo, 12);
  await assertJiraSpecVisibleText(page, "productos", 15000, "Validar que se muestre \"productos\"");
  await reportJiraSpecStepComplete(page, testInfo, 12, false, false);

  // 13. Validar que se muestre "saldos"
  await reportJiraSpecStepStart(testInfo, 13);
  await assertJiraSpecVisibleText(page, "saldos", 15000, "Validar que se muestre \"saldos\"");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. Validar que se muestre "movimientos"
  await reportJiraSpecStepStart(testInfo, 14);
  await assertJiraSpecVisibleText(page, "movimientos", 15000, "Validar que se muestre \"movimientos\"");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. Validar que se muestre "pagos"
  await reportJiraSpecStepStart(testInfo, 15);
  await assertJiraSpecVisibleText(page, "pagos", 15000, "Validar que se muestre \"pagos\"");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. Validar que se muestre "transferencias"
  await reportJiraSpecStepStart(testInfo, 16);
  await assertJiraSpecVisibleText(page, "transferencias", 15000, "Validar que se muestre \"transferencias\"");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. Validar que se muestre "solicitudes"
  await reportJiraSpecStepStart(testInfo, 17);
  await assertJiraSpecVisibleText(page, "solicitudes", 15000, "Validar que se muestre \"solicitudes\"");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. Presionar "Solicitar préstamo".
  await reportJiraSpecStepStart(testInfo, 18);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar préstamo","exact":true}, 2500, "Presionar \"Solicitar préstamo\".");
  await reportJiraSpecStepComplete(page, testInfo, 18, true, false);

  // 19. select [tipo_documento]
  await reportJiraSpecStepStart(testInfo, 19);
  const target19 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-document-type\"]"}, 2500, "select [tipo_documento]");
  const value19 = await resolveJiraSpecValue("tipo_documento", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target19, value19);
  await reportJiraSpecStepComplete(page, testInfo, 19, true, false);

  // 20. fill [numero_documento]
  await reportJiraSpecStepStart(testInfo, 20);
  const target20 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-document-number\"]"}, 2500, "fill [numero_documento]");
  const value20 = await resolveJiraSpecValue("numero_documento", appSlug, sectionSlug, automationId);
  await target20.fill(value20);
  if (await target20.inputValue() !== value20) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 20, false, false);

  // 21. fill [nombres]
  await reportJiraSpecStepStart(testInfo, 21);
  const target21 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-first-name\"]"}, 2500, "fill [nombres]");
  const value21 = await resolveJiraSpecValue("nombres", appSlug, sectionSlug, automationId);
  await target21.fill(value21);
  if (await target21.inputValue() !== value21) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 21, false, false);

  // 22. fill [apellidos]
  await reportJiraSpecStepStart(testInfo, 22);
  const target22 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-last-name\"]"}, 2500, "fill [apellidos]");
  const value22 = await resolveJiraSpecValue("apellidos", appSlug, sectionSlug, automationId);
  await target22.fill(value22);
  if (await target22.inputValue() !== value22) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. fill [fecha_nacimiento]
  await reportJiraSpecStepStart(testInfo, 23);
  const target23 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-birth-date\"]"}, 2500, "fill [fecha_nacimiento]");
  const value23 = await resolveJiraSpecValue("fecha_nacimiento", appSlug, sectionSlug, automationId);
  await target23.fill(value23);
  if (await target23.inputValue() !== value23) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. select [estado_civil]
  await reportJiraSpecStepStart(testInfo, 24);
  const target24 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-marital-status\"]"}, 2500, "select [estado_civil]");
  const value24 = await resolveJiraSpecValue("estado_civil", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target24, value24);
  await reportJiraSpecStepComplete(page, testInfo, 24, true, false);

  // 25. fill [personas_dependientes]
  await reportJiraSpecStepStart(testInfo, 25);
  const target25 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-dependents\"]"}, 2500, "fill [personas_dependientes]");
  const value25 = await resolveJiraSpecValue("personas_dependientes", appSlug, sectionSlug, automationId);
  await target25.fill(value25);
  if (await target25.inputValue() !== value25) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 26);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Contacto y domicilio","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 26, true, false);

  // 27. Validar que se muestre "estado de carga"
  await reportJiraSpecStepStart(testInfo, 27);
  await assertJiraSpecVisibleText(page, "estado de carga", 15000, "Validar que se muestre \"estado de carga\"");
  await reportJiraSpecStepComplete(page, testInfo, 27, false, false);

  // 28. Validar que se muestre "Contacto y domicilio"
  await reportJiraSpecStepStart(testInfo, 28);
  await assertJiraSpecVisibleText(page, "Contacto y domicilio", 15000, "Validar que se muestre \"Contacto y domicilio\"");
  await reportJiraSpecStepComplete(page, testInfo, 28, false, false);

  // 29. fill [correo_electronico]
  await reportJiraSpecStepStart(testInfo, 29);
  const target29 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-email\"]"}, 2500, "fill [correo_electronico]");
  const value29 = await resolveJiraSpecValue("correo_electronico", appSlug, sectionSlug, automationId);
  await target29.fill(value29);
  if (await target29.inputValue() !== value29) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 29, false, false);

  // 30. fill [telefono_movil]
  await reportJiraSpecStepStart(testInfo, 30);
  const target30 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-mobile\"]"}, 2500, "fill [telefono_movil]");
  const value30 = await resolveJiraSpecValue("telefono_movil", appSlug, sectionSlug, automationId);
  await target30.fill(value30);
  if (await target30.inputValue() !== value30) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 30, false, false);

  // 31. fill [telefono_alternativo]
  await reportJiraSpecStepStart(testInfo, 31);
  const target31 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-alt-phone\"]"}, 2500, "fill [telefono_alternativo]");
  const value31 = await resolveJiraSpecValue("telefono_alternativo", appSlug, sectionSlug, automationId);
  await target31.fill(value31);
  if (await target31.inputValue() !== value31) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 31, false, false);

  // 32. select [provincia]
  await reportJiraSpecStepStart(testInfo, 32);
  const target32 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-province\"]"}, 2500, "select [provincia]");
  const value32 = await resolveJiraSpecValue("provincia", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target32, value32);
  await reportJiraSpecStepComplete(page, testInfo, 32, true, false);

  // 33. select [municipio]
  await reportJiraSpecStepStart(testInfo, 33);
  const target33 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-city\"]"}, 2500, "select [municipio]");
  const value33 = await resolveJiraSpecValue("municipio", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target33, value33);
  await reportJiraSpecStepComplete(page, testInfo, 33, true, false);

  // 34. fill [sector_barrio]
  await reportJiraSpecStepStart(testInfo, 34);
  const target34 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-neighborhood\"]"}, 2500, "fill [sector_barrio]");
  const value34 = await resolveJiraSpecValue("sector_barrio", appSlug, sectionSlug, automationId);
  await target34.fill(value34);
  if (await target34.inputValue() !== value34) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 34, false, false);

  // 35. fill [direccion_residencial]
  await reportJiraSpecStepStart(testInfo, 35);
  const target35 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-address\"]"}, 2500, "fill [direccion_residencial]");
  const value35 = await resolveJiraSpecValue("direccion_residencial", appSlug, sectionSlug, automationId);
  await target35.fill(value35);
  if (await target35.inputValue() !== value35) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 35, false, false);

  // 36. fill [tiempo_direccion]
  await reportJiraSpecStepStart(testInfo, 36);
  const target36 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-address-years\"]"}, 2500, "fill [tiempo_direccion]");
  const value36 = await resolveJiraSpecValue("tiempo_direccion", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target36, value36);
  await reportJiraSpecStepComplete(page, testInfo, 36, true, false);

  // 37. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 37);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Actividad laboral","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 37, true, false);

  // 38. Validar que se muestre "estado de carga"
  await reportJiraSpecStepStart(testInfo, 38);
  await assertJiraSpecVisibleText(page, "estado de carga", 15000, "Validar que se muestre \"estado de carga\"");
  await reportJiraSpecStepComplete(page, testInfo, 38, false, false);

  // 39. Validar que se muestre "Actividad laboral"
  await reportJiraSpecStepStart(testInfo, 39);
  await assertJiraSpecVisibleText(page, "Actividad laboral", 15000, "Validar que se muestre \"Actividad laboral\"");
  await reportJiraSpecStepComplete(page, testInfo, 39, false, false);

  // 40. select [situacion_laboral]
  await reportJiraSpecStepStart(testInfo, 40);
  const target40 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-employment\"]"}, 2500, "select [situacion_laboral]");
  const value40 = await resolveJiraSpecValue("situacion_laboral", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target40, value40);
  await reportJiraSpecStepComplete(page, testInfo, 40, true, false);

  // 41. fill [empleador_negocio]
  await reportJiraSpecStepStart(testInfo, 41);
  const target41 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-employer\"]"}, 2500, "fill [empleador_negocio]");
  const value41 = await resolveJiraSpecValue("empleador_negocio", appSlug, sectionSlug, automationId);
  await target41.fill(value41);
  if (await target41.inputValue() !== value41) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 41, false, false);

  // 42. fill [cargo_ocupacion]
  await reportJiraSpecStepStart(testInfo, 42);
  const target42 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-occupation\"]"}, 2500, "fill [cargo_ocupacion]");
  const value42 = await resolveJiraSpecValue("cargo_ocupacion", appSlug, sectionSlug, automationId);
  await target42.fill(value42);
  if (await target42.inputValue() !== value42) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 42, false, false);

  // 43. select [sector_economico]
  await reportJiraSpecStepStart(testInfo, 43);
  const target43 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-industry\"]"}, 2500, "select [sector_economico]");
  const value43 = await resolveJiraSpecValue("sector_economico", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target43, value43);
  await reportJiraSpecStepComplete(page, testInfo, 43, true, false);

  // 44. fill [fecha_inicio_laboral]
  await reportJiraSpecStepStart(testInfo, 44);
  const target44 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-start-date\"]"}, 2500, "fill [fecha_inicio_laboral]");
  const value44 = await resolveJiraSpecValue("fecha_inicio_laboral", appSlug, sectionSlug, automationId);
  await target44.fill(value44);
  if (await target44.inputValue() !== value44) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 44, false, false);

  // 45. fill [telefono_laboral]
  await reportJiraSpecStepStart(testInfo, 45);
  const target45 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-work-phone\"]"}, 2500, "fill [telefono_laboral]");
  const value45 = await resolveJiraSpecValue("telefono_laboral", appSlug, sectionSlug, automationId);
  await target45.fill(value45);
  if (await target45.inputValue() !== value45) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 45, false, false);

  // 46. select [tipo_contrato]
  await reportJiraSpecStepStart(testInfo, 46);
  const target46 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-contract\"]"}, 2500, "select [tipo_contrato]");
  const value46 = await resolveJiraSpecValue("tipo_contrato", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target46, value46);
  await reportJiraSpecStepComplete(page, testInfo, 46, true, false);

  // 47. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 47);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Ingresos","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 47, true, false);

  // 48. Validar que se muestre "estado de carga"
  await reportJiraSpecStepStart(testInfo, 48);
  await assertJiraSpecVisibleText(page, "estado de carga", 15000, "Validar que se muestre \"estado de carga\"");
  await reportJiraSpecStepComplete(page, testInfo, 48, false, false);

  // 49. Validar que se muestre "Ingresos"
  await reportJiraSpecStepStart(testInfo, 49);
  await assertJiraSpecVisibleText(page, "Ingresos", 15000, "Validar que se muestre \"Ingresos\"");
  await reportJiraSpecStepComplete(page, testInfo, 49, false, false);

  // 50. fill [ingreso_principal]
  await reportJiraSpecStepStart(testInfo, 50);
  const target50 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income\"]"}, 2500, "fill [ingreso_principal]");
  const value50 = await resolveJiraSpecValue("ingreso_principal", appSlug, sectionSlug, automationId);
  await target50.fill(value50);
  if (await target50.inputValue() !== value50) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 50, false, false);

  // 51. fill [otros_ingresos]
  await reportJiraSpecStepStart(testInfo, 51);
  const target51 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-other-income\"]"}, 2500, "fill [otros_ingresos]");
  const value51 = await resolveJiraSpecValue("otros_ingresos", appSlug, sectionSlug, automationId);
  await target51.fill(value51);
  if (await target51.inputValue() !== value51) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 51, false, false);

  // 52. fill [origen_otros_ingresos]
  await reportJiraSpecStepStart(testInfo, 52);
  const target52 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-source\"]"}, 2500, "fill [origen_otros_ingresos]");
  const value52 = await resolveJiraSpecValue("origen_otros_ingresos", appSlug, sectionSlug, automationId);
  await target52.fill(value52);
  if (await target52.inputValue() !== value52) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 52, false, false);

  // 53. select [tipo_ingreso_fila_1]
  await reportJiraSpecStepStart(testInfo, 53);
  const target53 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-type\"]"}, 2500, "select [tipo_ingreso_fila_1]");
  const value53 = await resolveJiraSpecValue("tipo_ingreso_fila_1", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target53, value53);
  await reportJiraSpecStepComplete(page, testInfo, 53, true, false);

  // 54. fill [importe_ingreso_fila_1]
  await reportJiraSpecStepStart(testInfo, 54);
  const target54 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-amount\"]"}, 2500, "fill [importe_ingreso_fila_1]");
  const value54 = await resolveJiraSpecValue("importe_ingreso_fila_1", appSlug, sectionSlug, automationId);
  await target54.fill(value54);
  if (await target54.inputValue() !== value54) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 54, false, false);

  // 55. select [frecuencia_ingreso_fila_1]
  await reportJiraSpecStepStart(testInfo, 55);
  const target55 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-1-frequency\"]"}, 2500, "select [frecuencia_ingreso_fila_1]");
  const value55 = await resolveJiraSpecValue("frecuencia_ingreso_fila_1", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target55, value55);
  await reportJiraSpecStepComplete(page, testInfo, 55, true, false);

  // 56. Presionar "Agregar ingreso".
  await reportJiraSpecStepStart(testInfo, 56);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Agregar ingreso","exact":true}, 2500, "Presionar \"Agregar ingreso\".");
  await reportJiraSpecStepComplete(page, testInfo, 56, true, false);

  // 57. select [tipo_ingreso_fila_2]
  await reportJiraSpecStepStart(testInfo, 57);
  const target57 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-2-type\"]"}, 2500, "select [tipo_ingreso_fila_2]");
  const value57 = await resolveJiraSpecValue("tipo_ingreso_fila_2", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target57, value57);
  await reportJiraSpecStepComplete(page, testInfo, 57, true, false);

  // 58. fill [importe_ingreso_fila_2]
  await reportJiraSpecStepStart(testInfo, 58);
  const target58 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-2-amount\"]"}, 2500, "fill [importe_ingreso_fila_2]");
  const value58 = await resolveJiraSpecValue("importe_ingreso_fila_2", appSlug, sectionSlug, automationId);
  await target58.fill(value58);
  if (await target58.inputValue() !== value58) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 58, false, false);

  // 59. select [frecuencia_ingreso_fila_2]
  await reportJiraSpecStepStart(testInfo, 59);
  const target59 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-2-frequency\"]"}, 2500, "select [frecuencia_ingreso_fila_2]");
  const value59 = await resolveJiraSpecValue("frecuencia_ingreso_fila_2", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target59, value59);
  await reportJiraSpecStepComplete(page, testInfo, 59, true, false);

  // 60. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 60);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Compromisos","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 60, true, false);

  // 61. Validar que se muestre "estado de carga"
  await reportJiraSpecStepStart(testInfo, 61);
  await assertJiraSpecVisibleText(page, "estado de carga", 15000, "Validar que se muestre \"estado de carga\"");
  await reportJiraSpecStepComplete(page, testInfo, 61, false, false);

  // 62. Validar que se muestre "Compromisos"
  await reportJiraSpecStepStart(testInfo, 62);
  await assertJiraSpecVisibleText(page, "Compromisos", 15000, "Validar que se muestre \"Compromisos\"");
  await reportJiraSpecStepComplete(page, testInfo, 62, false, false);

  // 63. fill [gastos_hogar]
  await reportJiraSpecStepStart(testInfo, 63);
  const target63 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-household-costs\"]"}, 2500, "fill [gastos_hogar]");
  const value63 = await resolveJiraSpecValue("gastos_hogar", appSlug, sectionSlug, automationId);
  await target63.fill(value63);
  if (await target63.inputValue() !== value63) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 63, false, false);

  // 64. fill [cuotas_prestamos]
  await reportJiraSpecStepStart(testInfo, 64);
  const target64 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-existing-debt\"]"}, 2500, "fill [cuotas_prestamos]");
  const value64 = await resolveJiraSpecValue("cuotas_prestamos", appSlug, sectionSlug, automationId);
  await target64.fill(value64);
  if (await target64.inputValue() !== value64) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 64, false, false);

  // 65. fill [gasto_vivienda]
  await reportJiraSpecStepStart(testInfo, 65);
  const target65 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-housing-costs\"]"}, 2500, "fill [gasto_vivienda]");
  const value65 = await resolveJiraSpecValue("gasto_vivienda", appSlug, sectionSlug, automationId);
  await target65.fill(value65);
  if (await target65.inputValue() !== value65) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 65, false, false);

  // 66. select [dia_pago]
  await reportJiraSpecStepStart(testInfo, 66);
  const target66 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-payment-day\"]"}, 2500, "select [dia_pago]");
  const value66 = await resolveJiraSpecValue("dia_pago", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target66, value66);
  await reportJiraSpecStepComplete(page, testInfo, 66, true, false);

  // 67. select [tipo_compromiso_fila_1]
  await reportJiraSpecStepStart(testInfo, 67);
  const target67 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-1-type\"]"}, 2500, "select [tipo_compromiso_fila_1]");
  const value67 = await resolveJiraSpecValue("tipo_compromiso_fila_1", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target67, value67);
  await reportJiraSpecStepComplete(page, testInfo, 67, true, false);

  // 68. fill [importe_compromiso_fila_1]
  await reportJiraSpecStepStart(testInfo, 68);
  const target68 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-1-amount\"]"}, 2500, "fill [importe_compromiso_fila_1]");
  const value68 = await resolveJiraSpecValue("importe_compromiso_fila_1", appSlug, sectionSlug, automationId);
  await target68.fill(value68);
  if (await target68.inputValue() !== value68) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 68, false, false);

  // 69. select [frecuencia_compromiso_fila_1]
  await reportJiraSpecStepStart(testInfo, 69);
  const target69 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-1-frequency\"]"}, 2500, "select [frecuencia_compromiso_fila_1]");
  const value69 = await resolveJiraSpecValue("frecuencia_compromiso_fila_1", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target69, value69);
  await reportJiraSpecStepComplete(page, testInfo, 69, true, false);

  // 70. Presionar "Agregar compromiso".
  await reportJiraSpecStepStart(testInfo, 70);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Agregar compromiso","exact":true}, 2500, "Presionar \"Agregar compromiso\".");
  await reportJiraSpecStepComplete(page, testInfo, 70, true, false);

  // 71. select [tipo_compromiso_fila_2]
  await reportJiraSpecStepStart(testInfo, 71);
  const target71 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-2-type\"]"}, 2500, "select [tipo_compromiso_fila_2]");
  const value71 = await resolveJiraSpecValue("tipo_compromiso_fila_2", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target71, value71);
  await reportJiraSpecStepComplete(page, testInfo, 71, true, false);

  // 72. fill [importe_compromiso_fila_2]
  await reportJiraSpecStepStart(testInfo, 72);
  const target72 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-2-amount\"]"}, 2500, "fill [importe_compromiso_fila_2]");
  const value72 = await resolveJiraSpecValue("importe_compromiso_fila_2", appSlug, sectionSlug, automationId);
  await target72.fill(value72);
  if (await target72.inputValue() !== value72) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 72, false, false);

  // 73. select [frecuencia_compromiso_fila_2]
  await reportJiraSpecStepStart(testInfo, 73);
  const target73 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-commitment-2-frequency\"]"}, 2500, "select [frecuencia_compromiso_fila_2]");
  const value73 = await resolveJiraSpecValue("frecuencia_compromiso_fila_2", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target73, value73);
  await reportJiraSpecStepComplete(page, testInfo, 73, true, false);

  // 74. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 74);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Condiciones del préstamo","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 74, true, false);

  // 75. Validar que se muestre "estado de carga"
  await reportJiraSpecStepStart(testInfo, 75);
  await assertJiraSpecVisibleText(page, "estado de carga", 15000, "Validar que se muestre \"estado de carga\"");
  await reportJiraSpecStepComplete(page, testInfo, 75, false, false);

  // 76. Validar que se muestre "Condiciones"
  await reportJiraSpecStepStart(testInfo, 76);
  await assertJiraSpecVisibleText(page, "Condiciones", 15000, "Validar que se muestre \"Condiciones\"");
  await reportJiraSpecStepComplete(page, testInfo, 76, false, false);

  // 77. fill [monto_solicitado]
  await reportJiraSpecStepStart(testInfo, 77);
  const target77 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-amount\"]"}, 2500, "fill [monto_solicitado]");
  const value77 = await resolveJiraSpecValue("monto_solicitado", appSlug, sectionSlug, automationId);
  await target77.fill(value77);
  if (await target77.inputValue() !== value77) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 77, false, false);

  // 78. select [proposito_prestamo]
  await reportJiraSpecStepStart(testInfo, 78);
  const target78 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-purpose\"]"}, 2500, "select [proposito_prestamo]");
  const value78 = await resolveJiraSpecValue("proposito_prestamo", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target78, value78);
  await reportJiraSpecStepComplete(page, testInfo, 78, true, false);

  // 79. select [plazo_deseado]
  await reportJiraSpecStepStart(testInfo, 79);
  const target79 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-term\"]"}, 2500, "select [plazo_deseado]");
  const value79 = await resolveJiraSpecValue("plazo_deseado", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target79, value79);
  await reportJiraSpecStepComplete(page, testInfo, 79, true, false);

  // 80. select [cuenta_desembolso]
  await reportJiraSpecStepStart(testInfo, 80);
  const target80 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-disbursement-account\"]"}, 2500, "select [cuenta_desembolso]");
  const value80 = await resolveJiraSpecValue("cuenta_desembolso", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target80, value80);
  await reportJiraSpecStepComplete(page, testInfo, 80, true, false);

  // 81. select [frecuencia_pago]
  await reportJiraSpecStepStart(testInfo, 81);
  const target81 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-frequency\"]"}, 2500, "select [frecuencia_pago]");
  const value81 = await resolveJiraSpecValue("frecuencia_pago", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target81, value81);
  await reportJiraSpecStepComplete(page, testInfo, 81, true, false);

  // 82. fill [fecha_desembolso]
  await reportJiraSpecStepStart(testInfo, 82);
  const target82 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-disbursement-date\"]"}, 2500, "fill [fecha_desembolso]");
  const value82 = await resolveJiraSpecValue("fecha_desembolso", appSlug, sectionSlug, automationId);
  await target82.fill(value82);
  if (await target82.inputValue() !== value82) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 82, false, false);

  // 83. select [seguro_vida]
  await reportJiraSpecStepStart(testInfo, 83);
  const target83 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-insurance\"]"}, 2500, "select [seguro_vida]");
  const value83 = await resolveJiraSpecValue("seguro_vida", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target83, value83);
  await reportJiraSpecStepComplete(page, testInfo, 83, true, false);

  // 84. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 84);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Referencias personales","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 84, true, false);

  // 85. Validar que se muestre "estado de carga"
  await reportJiraSpecStepStart(testInfo, 85);
  await assertJiraSpecVisibleText(page, "estado de carga", 15000, "Validar que se muestre \"estado de carga\"");
  await reportJiraSpecStepComplete(page, testInfo, 85, false, false);

  // 86. Validar que se muestre "Referencias"
  await reportJiraSpecStepStart(testInfo, 86);
  await assertJiraSpecVisibleText(page, "Referencias", 15000, "Validar que se muestre \"Referencias\"");
  await reportJiraSpecStepComplete(page, testInfo, 86, false, false);

  // 87. fill [relacion_referencia_1]
  await reportJiraSpecStepStart(testInfo, 87);
  const target87 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref1-relation\"]"}, 2500, "fill [relacion_referencia_1]");
  const value87 = await resolveJiraSpecValue("relacion_referencia_1", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target87, value87);
  await reportJiraSpecStepComplete(page, testInfo, 87, true, false);

  // 88. fill [nombre_referencia_1]
  await reportJiraSpecStepStart(testInfo, 88);
  const target88 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref1-name\"]"}, 2500, "fill [nombre_referencia_1]");
  const value88 = await resolveJiraSpecValue("nombre_referencia_1", appSlug, sectionSlug, automationId);
  await target88.fill(value88);
  if (await target88.inputValue() !== value88) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 88, false, false);

  // 89. fill [telefono_referencia_1]
  await reportJiraSpecStepStart(testInfo, 89);
  const target89 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref1-phone\"]"}, 2500, "fill [telefono_referencia_1]");
  const value89 = await resolveJiraSpecValue("telefono_referencia_1", appSlug, sectionSlug, automationId);
  await target89.fill(value89);
  if (await target89.inputValue() !== value89) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 89, false, false);

  // 90. fill [relacion_referencia_2]
  await reportJiraSpecStepStart(testInfo, 90);
  const target90 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref1-relation\"]"}, 2500, "fill [relacion_referencia_2]");
  const value90 = await resolveJiraSpecValue("relacion_referencia_2", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target90, value90);
  await reportJiraSpecStepComplete(page, testInfo, 90, true, false);

  // 91. fill [nombre_referencia_2]
  await reportJiraSpecStepStart(testInfo, 91);
  const target91 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref2-name\"]"}, 2500, "fill [nombre_referencia_2]");
  const value91 = await resolveJiraSpecValue("nombre_referencia_2", appSlug, sectionSlug, automationId);
  await target91.fill(value91);
  if (await target91.inputValue() !== value91) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 91, false, false);

  // 92. fill [telefono_referencia_2]
  await reportJiraSpecStepStart(testInfo, 92);
  const target92 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-ref2-phone\"]"}, 2500, "fill [telefono_referencia_2]");
  const value92 = await resolveJiraSpecValue("telefono_referencia_2", appSlug, sectionSlug, automationId);
  await target92.fill(value92);
  if (await target92.inputValue() !== value92) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 92, false, false);

  // 93. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 93);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Documentos y declaraciones","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 93, true, false);

  // 94. Validar que se muestre "estado de carga"
  await reportJiraSpecStepStart(testInfo, 94);
  await assertJiraSpecVisibleText(page, "estado de carga", 15000, "Validar que se muestre \"estado de carga\"");
  await reportJiraSpecStepComplete(page, testInfo, 94, false, false);

  // 95. Validar que se muestre "Documentos y declaraciones"
  await reportJiraSpecStepStart(testInfo, 95);
  await assertJiraSpecVisibleText(page, "Documentos y declaraciones", 15000, "Validar que se muestre \"Documentos y declaraciones\"");
  await reportJiraSpecStepComplete(page, testInfo, 95, false, false);

  // 96. select [documento_identidad]
  await reportJiraSpecStepStart(testInfo, 96);
  const target96 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-id-document\"]"}, 2500, "select [documento_identidad]");
  const value96 = await resolveJiraSpecValue("documento_identidad", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target96, value96);
  await reportJiraSpecStepComplete(page, testInfo, 96, true, false);

  // 97. select [comprobante_ingresos]
  await reportJiraSpecStepStart(testInfo, 97);
  const target97 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-income-document\"]"}, 2500, "select [comprobante_ingresos]");
  const value97 = await resolveJiraSpecValue("comprobante_ingresos", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target97, value97);
  await reportJiraSpecStepComplete(page, testInfo, 97, true, false);

  // 98. select [comprobante_domicilio]
  await reportJiraSpecStepStart(testInfo, 98);
  const target98 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-address-document\"]"}, 2500, "select [comprobante_domicilio]");
  const value98 = await resolveJiraSpecValue("comprobante_domicilio", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target98, value98);
  await reportJiraSpecStepComplete(page, testInfo, 98, true, false);

  // 99. select [autorizacion_crediticia]
  await reportJiraSpecStepStart(testInfo, 99);
  const target99 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-credit-consent\"]"}, 2500, "select [autorizacion_crediticia]");
  const value99 = await resolveJiraSpecValue("autorizacion_crediticia", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target99, value99);
  await reportJiraSpecStepComplete(page, testInfo, 99, true, false);

  // 100. select [confirmacion_veracidad]
  await reportJiraSpecStepStart(testInfo, 100);
  const target100 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-accuracy\"]"}, 2500, "select [confirmacion_veracidad]");
  const value100 = await resolveJiraSpecValue("confirmacion_veracidad", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target100, value100);
  await reportJiraSpecStepComplete(page, testInfo, 100, true, false);

  // 101. select [canal_notificacion]
  await reportJiraSpecStepStart(testInfo, 101);
  const target101 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-notification-channel\"]"}, 2500, "select [canal_notificacion]");
  const value101 = await resolveJiraSpecValue("canal_notificacion", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target101, value101);
  await reportJiraSpecStepComplete(page, testInfo, 101, true, false);

  // 102. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 102);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Revisar solicitud","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 102, true, false);

  // 103. Validar que se muestre "estado de carga"
  await reportJiraSpecStepStart(testInfo, 103);
  await assertJiraSpecVisibleText(page, "estado de carga", 15000, "Validar que se muestre \"estado de carga\"");
  await reportJiraSpecStepComplete(page, testInfo, 103, false, false);

  // 104. Validar que se muestre "datos capturados"
  await reportJiraSpecStepStart(testInfo, 104);
  await assertJiraSpecVisibleText(page, "datos capturados", 15000, "Validar que se muestre \"datos capturados\"");
  await reportJiraSpecStepComplete(page, testInfo, 104, false, false);

  // 105. Solicitar el código de autorización.
  await reportJiraSpecStepStart(testInfo, 105);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar código de autorización","exact":true}, 2500, "Solicitar el código de autorización.");
  await reportJiraSpecStepComplete(page, testInfo, 105, true, false);

  // 106. Validar que se muestre "Código de autorización"
  await reportJiraSpecStepStart(testInfo, 106);
  await assertJiraSpecVisibleText(page, "Código de autorización", 15000, "Validar que se muestre \"Código de autorización\"");
  await reportJiraSpecStepComplete(page, testInfo, 106, false, false);

  // 107. fill [codigo_autorizacion]
  await reportJiraSpecStepStart(testInfo, 107);
  const target107 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-authorization-code\"]"}, 2500, "fill [codigo_autorizacion]");
  const value107 = await resolveJiraSpecValue("codigo_autorizacion", appSlug, sectionSlug, automationId);
  await target107.fill(value107);
  if (await target107.inputValue() !== value107) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 107, false, false);

  // 108. Presionar "Enviar".
  await reportJiraSpecStepStart(testInfo, 108);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Enviar solicitud","exact":true}, 2500, "Presionar \"Enviar\".");
  await reportJiraSpecStepComplete(page, testInfo, 108, true, false);

  // 109. Validar que se muestre "Solicitud recibida"
  await reportJiraSpecStepStart(testInfo, 109);
  await assertJiraSpecVisibleText(page, "Solicitud recibida", 15000, "Validar que se muestre \"Solicitud recibida\"");
  await reportJiraSpecStepComplete(page, testInfo, 109, false, false);

  // 110. Validar que se muestre "referencia"
  await reportJiraSpecStepStart(testInfo, 110);
  await assertJiraSpecVisibleText(page, "referencia", 15000, "Validar que se muestre \"referencia\"");
  await reportJiraSpecStepComplete(page, testInfo, 110, false, false);

  // 111. Validar que se muestre "estado en evaluación"
  await reportJiraSpecStepStart(testInfo, 111);
  await assertJiraSpecVisibleText(page, "estado en evaluación", 15000, "Validar que se muestre \"estado en evaluación\"");
  await reportJiraSpecStepComplete(page, testInfo, 111, false, true);

});
