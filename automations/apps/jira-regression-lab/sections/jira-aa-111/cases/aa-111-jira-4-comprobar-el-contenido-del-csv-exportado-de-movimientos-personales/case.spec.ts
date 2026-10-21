import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecRowMatch, assertJiraSpecVisibleText, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Comprobar el contenido del CSV exportado de movimientos personales", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-111";
  const automationId = "aa-111-jira-4-comprobar-el-contenido-del-csv-exportado-de-movimientos-personales";
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

  // 4. Presionar "Iniciar sesión".
  await reportJiraSpecStepStart(testInfo, 4);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"Iniciar sesión\".");
  await reportJiraSpecStepComplete(page, testInfo, 4, true, false);

  // 5. fill [cedula]
  await reportJiraSpecStepStart(testInfo, 5);
  const target5 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-identity\"]"}, 2500, "fill [cedula]");
  const value5 = await resolveJiraSpecValue("cedula", appSlug, sectionSlug, automationId);
  await target5.fill(value5);
  if (await target5.inputValue() !== value5) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 5, false, false);

  // 6. fill [usuario]
  await reportJiraSpecStepStart(testInfo, 6);
  const target6 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-user\"]"}, 2500, "fill [usuario]");
  const value6 = await resolveJiraSpecValue("usuario", appSlug, sectionSlug, automationId);
  await target6.fill(value6);
  if (await target6.inputValue() !== value6) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 6, false, false);

  // 7. fill [contrasena]
  await reportJiraSpecStepStart(testInfo, 7);
  const target7 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-password\"]"}, 2500, "fill [contrasena]");
  const value7 = await resolveJiraSpecValue("contrasena", appSlug, sectionSlug, automationId);
  await target7.fill(value7);
  if (await target7.inputValue() !== value7) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 7, false, false);

  // 8. Presionar "Iniciar sesión".
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"Iniciar sesión\".");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. Solicitar el código por SMS.
  await reportJiraSpecStepStart(testInfo, 9);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Solicitar código por SMS","exact":true}, 2500, "Solicitar el código por SMS.");
  await reportJiraSpecStepComplete(page, testInfo, 9, true, false);

  // 10. fill [codigo_acceso]
  await reportJiraSpecStepStart(testInfo, 10);
  const target10 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-otp\"]"}, 2500, "fill [codigo_acceso]");
  const value10 = await resolveJiraSpecValue("codigo_acceso", appSlug, sectionSlug, automationId);
  await target10.fill(value10);
  if (await target10.inputValue() !== value10) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 11);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 11, true, false);

  // 12. Validar que se muestre "Resumen personal"
  await reportJiraSpecStepStart(testInfo, 12);
  await assertJiraSpecVisibleText(page, "Resumen personal", 15000, "Validar que se muestre \"Resumen personal\"");
  await reportJiraSpecStepComplete(page, testInfo, 12, false, false);

  // 13. Presionar "Movimientos".
  await reportJiraSpecStepStart(testInfo, 13);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"▤ Movimientos","exact":true}, 2500, "Presionar \"Movimientos\".");
  await reportJiraSpecStepComplete(page, testInfo, 13, true, false);

  // 14. Validar que se muestre "Cargando información segura"
  await reportJiraSpecStepStart(testInfo, 14);
  await assertJiraSpecVisibleText(page, "Cargando información segura", 15000, "Validar que se muestre \"Cargando información segura\"");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. Validar que se muestre "tabla de movimientos personales"
  await reportJiraSpecStepStart(testInfo, 15);
  await assertJiraSpecVisibleText(page, "tabla de movimientos personales", 15000, "Validar que se muestre \"tabla de movimientos personales\"");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. select [cuenta]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"statement-account\"]"}, 2500, "select [cuenta]");
  const value16 = await resolveJiraSpecValue("cuenta", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target16, value16);
  await reportJiraSpecStepComplete(page, testInfo, 16, true, false);

  // 17. fill [desde]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"date-from\"]"}, 2500, "fill [desde]");
  const value17 = await resolveJiraSpecValue("desde", appSlug, sectionSlug, automationId);
  await target17.fill(value17);
  if (await target17.inputValue() !== value17) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. fill [hasta]
  await reportJiraSpecStepStart(testInfo, 18);
  const target18 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"date-to\"]"}, 2500, "fill [hasta]");
  const value18 = await resolveJiraSpecValue("hasta", appSlug, sectionSlug, automationId);
  await target18.fill(value18);
  if (await target18.inputValue() !== value18) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. select [estado]
  await reportJiraSpecStepStart(testInfo, 19);
  const target19 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"statement-status\"]"}, 2500, "select [estado]");
  const value19 = await resolveJiraSpecValue("estado", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target19, value19);
  await reportJiraSpecStepComplete(page, testInfo, 19, true, false);

  // 20. select [tipo_movimiento]
  await reportJiraSpecStepStart(testInfo, 20);
  const target20 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"movement-type\"]"}, 2500, "select [tipo_movimiento]");
  const value20 = await resolveJiraSpecValue("tipo_movimiento", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target20, value20);
  await reportJiraSpecStepComplete(page, testInfo, 20, true, false);

  // 21. fill [monto_minimo]
  await reportJiraSpecStepStart(testInfo, 21);
  const target21 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"min-amount\"]"}, 2500, "fill [monto_minimo]");
  const value21 = await resolveJiraSpecValue("monto_minimo", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target21, value21);
  await reportJiraSpecStepComplete(page, testInfo, 21, true, false);

  // 22. Validar que el deslizador "Deslizador de monto mínimo" y el valor numérico de "Monto mínimo" estén sincronizados.
  await reportJiraSpecStepStart(testInfo, 22);
  await assertJiraSpecVisibleText(page, "Deslizador de monto mínimo", 15000, "Validar que el deslizador \"Deslizador de monto mínimo\" y el valor numérico de \"Monto mínimo\" estén sincronizados.");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. Presionar "Aplicar filtros".
  await reportJiraSpecStepStart(testInfo, 23);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Aplicar filtros","exact":true}, 2500, "Presionar \"Aplicar filtros\".");
  await reportJiraSpecStepComplete(page, testInfo, 23, true, false);

  // 24. Validar que se muestre "2026"
  await reportJiraSpecStepStart(testInfo, 24);
  await assertJiraSpecVisibleText(page, "2026", 15000, "Validar que se muestre \"2026\"");
  await reportJiraSpecStepComplete(page, testInfo, 24, false, false);

  // 25. Validar que se muestre "propia"
  await reportJiraSpecStepStart(testInfo, 25);
  await assertJiraSpecVisibleText(page, "propia", 15000, "Validar que se muestre \"propia\"");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Validar que se muestre "TRX-800124"
  await reportJiraSpecStepStart(testInfo, 26);
  await assertJiraSpecVisibleText(page, "TRX-800124", 15000, "Validar que se muestre \"TRX-800124\"");
  await reportJiraSpecStepComplete(page, testInfo, 26, false, false);

  // 27. Validar que se muestre "RD$2"
  await reportJiraSpecStepStart(testInfo, 27);
  await assertJiraSpecVisibleText(page, "RD$2", 15000, "Validar que se muestre \"RD$2\"");
  await reportJiraSpecStepComplete(page, testInfo, 27, false, false);

  // 28. Validar que se muestre "500.00"
  await reportJiraSpecStepStart(testInfo, 28);
  await assertJiraSpecVisibleText(page, "500.00", 15000, "Validar que se muestre \"500.00\"");
  await reportJiraSpecStepComplete(page, testInfo, 28, false, false);

  // 29. Validar que se muestre "Completada"
  await reportJiraSpecStepStart(testInfo, 29);
  await assertJiraSpecVisibleText(page, "Completada", 15000, "Validar que se muestre \"Completada\"");
  await reportJiraSpecStepComplete(page, testInfo, 29, false, false);

  // 30. Validar que se muestre "1 resultados"
  await reportJiraSpecStepStart(testInfo, 30);
  await assertJiraSpecVisibleText(page, "1 resultados", 15000, "Validar que se muestre \"1 resultados\"");
  await reportJiraSpecStepComplete(page, testInfo, 30, false, false);

  // 31. Validar que se muestre "1–1 de 1 movimientos"
  await reportJiraSpecStepStart(testInfo, 31);
  await assertJiraSpecVisibleText(page, "1–1 de 1 movimientos", 15000, "Validar que se muestre \"1–1 de 1 movimientos\"");
  await reportJiraSpecStepComplete(page, testInfo, 31, false, false);

  // 32. Presionar "Exportar CSV".
  await reportJiraSpecStepStart(testInfo, 32);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Exportar CSV","exact":true}, 2500, "Presionar \"Exportar CSV\".");
  await reportJiraSpecStepComplete(page, testInfo, 32, true, false);

  // 33. Validar que se muestre "1 movimientos exportados en CSV: estado-de-cuenta-regression-lab.csv"
  await reportJiraSpecStepStart(testInfo, 33);
  await assertJiraSpecVisibleText(page, "1 movimientos exportados en CSV: estado-de-cuenta-regression-lab.csv", 15000, "Validar que se muestre \"1 movimientos exportados en CSV: estado-de-cuenta-regression-lab.csv\"");
  await reportJiraSpecStepComplete(page, testInfo, 33, false, false);

  // 34. Validar que el archivo descargado "estado-de-cuenta-regression-lab.csv" incluya los encabezados Fecha, Descripción, Referencia, Monto y Estado, y la fila visible: 10 oct 2026, Transferencia propia, TRX-800124, − RD$2,500.00, Completada.
  await reportJiraSpecStepStart(testInfo, 34);
  await assertJiraSpecDownloadContent(page, {"filename":"estado-de-cuenta-regression-lab.csv","headers":["Fecha","Descripción","Referencia","Monto","Estado"],"row":["10 oct 2026","Transferencia propia","TRX-800124","− RD$2,500.00","Completada"],"tokens":[]}, 15000);
  await reportJiraSpecStepComplete(page, testInfo, 34, false, true);

});
