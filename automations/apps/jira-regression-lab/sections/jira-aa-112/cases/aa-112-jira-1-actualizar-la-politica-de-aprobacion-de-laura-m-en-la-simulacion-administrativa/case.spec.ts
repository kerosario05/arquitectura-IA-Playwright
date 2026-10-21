import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Actualizar la política de aprobación de Laura M. en la simulación administrativa", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-112";
  const automationId = "aa-112-jira-1-actualizar-la-politica-de-aprobacion-de-laura-m-en-la-simulacion-administrativa";
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

  // 9. fill [codigo_acceso]
  await reportJiraSpecStepStart(testInfo, 9);
  const target9 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-otp\"]"}, 2500, "fill [codigo_acceso]");
  const value9 = await resolveJiraSpecValue("codigo_acceso", appSlug, sectionSlug, automationId);
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

  // 12. Presionar "Administración".
  await reportJiraSpecStepStart(testInfo, 12);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"⚙ Administración","exact":true}, 2500, "Presionar \"Administración\".");
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. Validar que se muestre "Usuario"
  await reportJiraSpecStepStart(testInfo, 13);
  await assertJiraSpecVisibleText(page, "Usuario", 15000, "Validar que se muestre \"Usuario\"");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. Validar que se muestre "Rol"
  await reportJiraSpecStepStart(testInfo, 14);
  await assertJiraSpecVisibleText(page, "Rol", 15000, "Validar que se muestre \"Rol\"");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. Validar que se muestre "Estado"
  await reportJiraSpecStepStart(testInfo, 15);
  await assertJiraSpecVisibleText(page, "Estado", 15000, "Validar que se muestre \"Estado\"");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. Validar que se muestre "Último acceso"
  await reportJiraSpecStepStart(testInfo, 16);
  await assertJiraSpecVisibleText(page, "Último acceso", 15000, "Validar que se muestre \"Último acceso\"");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. Validar que se muestre "4 activos"
  await reportJiraSpecStepStart(testInfo, 17);
  await assertJiraSpecVisibleText(page, "4 activos", 15000, "Validar que se muestre \"4 activos\"");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. Validar que se muestre "Laura M."
  await reportJiraSpecStepStart(testInfo, 18);
  await assertJiraSpecVisibleText(page, "Laura M.", 15000, "Validar que se muestre \"Laura M.\"");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. Validar que se muestre "Rol de Laura M."
  await reportJiraSpecStepStart(testInfo, 19);
  await assertJiraSpecVisibleText(page, "Rol de Laura M.", 15000, "Validar que se muestre \"Rol de Laura M.\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. select [jira_step_19]
  await reportJiraSpecStepStart(testInfo, 20);
  const target20 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"user-role\"]"}, 2500, "select [jira_step_19]");
  const value20 = await resolveJiraSpecValue("jira_step_19", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target20, value20);
  await reportJiraSpecStepComplete(page, testInfo, 20, true, false);

  // 21. fill [limite_aprobacion]
  await reportJiraSpecStepStart(testInfo, 21);
  const target21 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"approval-limit\"]"}, 2500, "fill [limite_aprobacion]");
  const value21 = await resolveJiraSpecValue("limite_aprobacion", appSlug, sectionSlug, automationId);
  await target21.fill(value21);
  if (await target21.inputValue() !== value21) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 21, false, false);

  // 22. Validar que se muestre "RD$25,000"
  await reportJiraSpecStepStart(testInfo, 22);
  await assertJiraSpecVisibleText(page, "RD$25,000", 15000, "Validar que se muestre \"RD$25,000\"");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. select [ajuste_visual]
  await reportJiraSpecStepStart(testInfo, 23);
  const target23 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"approval-limit-slider\"]"}, 2500, "select [ajuste_visual]");
  const value23 = await resolveJiraSpecValue("ajuste_visual", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target23, value23);
  await reportJiraSpecStepComplete(page, testInfo, 23, true, false);

  // 24. Validar que se muestre "30000"
  await reportJiraSpecStepStart(testInfo, 24);
  await assertJiraSpecVisibleText(page, "30000", 15000, "Validar que se muestre \"30000\"");
  await reportJiraSpecStepComplete(page, testInfo, 24, false, false);

  // 25. Validar que se muestre "RD$5,000 a RD$100,000"
  await reportJiraSpecStepStart(testInfo, 25);
  await assertJiraSpecVisibleText(page, "RD$5,000 a RD$100,000", 15000, "Validar que se muestre \"RD$5,000 a RD$100,000\"");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Validar que se muestre "incrementos de RD$5,000"
  await reportJiraSpecStepStart(testInfo, 26);
  await assertJiraSpecVisibleText(page, "incrementos de RD$5,000", 15000, "Validar que se muestre \"incrementos de RD$5,000\"");
  await reportJiraSpecStepComplete(page, testInfo, 26, false, false);

  // 27. Presionar "Consultar cuentas".
  await reportJiraSpecStepStart(testInfo, 27);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"checkbox","name":"Consultar cuentas","exact":true}, 2500, "Presionar \"Consultar cuentas\".");
  await reportJiraSpecStepComplete(page, testInfo, 27, true, false);

  // 28. Presionar "Aprobar pagos".
  await reportJiraSpecStepStart(testInfo, 28);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"checkbox","name":"Aprobar pagos","exact":true}, 2500, "Presionar \"Aprobar pagos\".");
  await reportJiraSpecStepComplete(page, testInfo, 28, true, false);

  // 29. Validar que se muestre "Consultar cuentas"
  await reportJiraSpecStepStart(testInfo, 29);
  await assertJiraSpecVisibleText(page, "Consultar cuentas", 15000, "Validar que se muestre \"Consultar cuentas\"");
  await reportJiraSpecStepComplete(page, testInfo, 29, false, false);

  // 30. Validar que se muestre "Aprobar pagos"
  await reportJiraSpecStepStart(testInfo, 30);
  await assertJiraSpecVisibleText(page, "Aprobar pagos", 15000, "Validar que se muestre \"Aprobar pagos\"");
  await reportJiraSpecStepComplete(page, testInfo, 30, false, false);

  // 31. Presionar "Crear transferencias".
  await reportJiraSpecStepStart(testInfo, 31);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"checkbox","name":"Crear transferencias","exact":true}, 2500, "Presionar \"Crear transferencias\".");
  await reportJiraSpecStepComplete(page, testInfo, 31, true, false);

  // 32. Presionar "Administrar usuarios".
  await reportJiraSpecStepStart(testInfo, 32);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"checkbox","name":"Administrar usuarios","exact":true}, 2500, "Presionar \"Administrar usuarios\".");
  await reportJiraSpecStepComplete(page, testInfo, 32, true, false);

  // 33. Validar que se muestre "Crear transferencias"
  await reportJiraSpecStepStart(testInfo, 33);
  await assertJiraSpecVisibleText(page, "Crear transferencias", 15000, "Validar que se muestre \"Crear transferencias\"");
  await reportJiraSpecStepComplete(page, testInfo, 33, false, false);

  // 34. Validar que se muestre "Administrar usuarios"
  await reportJiraSpecStepStart(testInfo, 34);
  await assertJiraSpecVisibleText(page, "Administrar usuarios", 15000, "Validar que se muestre \"Administrar usuarios\"");
  await reportJiraSpecStepComplete(page, testInfo, 34, false, false);

  // 35. Presionar "Guardar política".
  await reportJiraSpecStepStart(testInfo, 35);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Guardar política","exact":true}, 2500, "Presionar \"Guardar política\".");
  await reportJiraSpecStepComplete(page, testInfo, 35, true, false);

  // 36. Validar que se muestre "La política de aprobación se guardó"
  await reportJiraSpecStepStart(testInfo, 36);
  await assertJiraSpecVisibleText(page, "La política de aprobación se guardó", 15000, "Validar que se muestre \"La política de aprobación se guardó\"");
  await reportJiraSpecStepComplete(page, testInfo, 36, false, false);

  // 37. Validar que se muestre "Aprobador"
  await reportJiraSpecStepStart(testInfo, 37);
  await assertJiraSpecVisibleText(page, "Aprobador", 15000, "Validar que se muestre \"Aprobador\"");
  await reportJiraSpecStepComplete(page, testInfo, 37, false, false);

  // 38. Validar que se muestre "30000"
  await reportJiraSpecStepStart(testInfo, 38);
  await assertJiraSpecVisibleText(page, "30000", 15000, "Validar que se muestre \"30000\"");
  await reportJiraSpecStepComplete(page, testInfo, 38, false, false);

  // 39. Validar que se muestre "Consultar cuentas"
  await reportJiraSpecStepStart(testInfo, 39);
  await assertJiraSpecVisibleText(page, "Consultar cuentas", 15000, "Validar que se muestre \"Consultar cuentas\"");
  await reportJiraSpecStepComplete(page, testInfo, 39, false, false);

  // 40. Validar que se muestre "Aprobar pagos"
  await reportJiraSpecStepStart(testInfo, 40);
  await assertJiraSpecVisibleText(page, "Aprobar pagos", 15000, "Validar que se muestre \"Aprobar pagos\"");
  await reportJiraSpecStepComplete(page, testInfo, 40, false, false);

  // 41. Presionar "Regla de doble aprobación".
  await reportJiraSpecStepStart(testInfo, 41);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"summary:visible:text-is(\"Regla de doble aprobación\")"}, 2500, "Presionar \"Regla de doble aprobación\".");
  await reportJiraSpecStepComplete(page, testInfo, 41, true, false);

  // 42. Validar que se muestre "Operaciones por encima del límite requieren aprobación de un usuario distinto"
  await reportJiraSpecStepStart(testInfo, 42);
  await assertJiraSpecVisibleText(page, "Operaciones por encima del límite requieren aprobación de un usuario distinto", 15000, "Validar que se muestre \"Operaciones por encima del límite requieren aprobación de un usuario distinto\"");
  await reportJiraSpecStepComplete(page, testInfo, 42, false, true);

});
