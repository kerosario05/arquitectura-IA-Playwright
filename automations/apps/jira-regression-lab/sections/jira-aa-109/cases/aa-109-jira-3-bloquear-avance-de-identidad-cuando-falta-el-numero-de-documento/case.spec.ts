import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecFieldValidation, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Bloquear avance de identidad cuando falta el número de documento", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 360000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-109";
  const automationId = "aa-109-jira-3-bloquear-avance-de-identidad-cuando-falta-el-numero-de-documento";
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

  // 13. fill [nombres]
  await reportJiraSpecStepStart(testInfo, 13);
  const target13 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-first-name\"]"}, 2500, "fill [nombres]");
  const value13 = await resolveJiraSpecValue("nombres", appSlug, sectionSlug, automationId);
  await target13.fill(value13);
  if (await target13.inputValue() !== value13) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. fill [apellidos]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-last-name\"]"}, 2500, "fill [apellidos]");
  const value14 = await resolveJiraSpecValue("apellidos", appSlug, sectionSlug, automationId);
  await target14.fill(value14);
  if (await target14.inputValue() !== value14) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. fill [fecha_nacimiento]
  await reportJiraSpecStepStart(testInfo, 15);
  const target15 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-birth-date\"]"}, 2500, "fill [fecha_nacimiento]");
  const value15 = await resolveJiraSpecValue("fecha_nacimiento", appSlug, sectionSlug, automationId);
  await target15.fill(value15);
  if (await target15.inputValue() !== value15) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. select [estado_civil]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-marital-status\"]"}, 2500, "select [estado_civil]");
  const value16 = await resolveJiraSpecValue("estado_civil", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target16, value16);
  await reportJiraSpecStepComplete(page, testInfo, 16, true, false);

  // 17. fill [dependientes]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"loan-dependents\"]"}, 2500, "fill [dependientes]");
  const value17 = await resolveJiraSpecValue("dependientes", appSlug, sectionSlug, automationId);
  await target17.fill(value17);
  if (await target17.inputValue() !== value17) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. Presionar "Continuar".
  await reportJiraSpecStepStart(testInfo, 18);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Avanzar a Contacto y domicilio","exact":true}, 2500, "Presionar \"Continuar\".");
  await reportJiraSpecStepComplete(page, testInfo, 18, true, false);

  // 19. Validar que se muestre "Identidad y perfil"
  await reportJiraSpecStepStart(testInfo, 19);
  await assertJiraSpecVisibleText(page, "Identidad y perfil", 15000, "Validar que se muestre \"Identidad y perfil\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. Validar que el campo "Número de documento" muestre un error de validación.
  await reportJiraSpecStepStart(testInfo, 20);
  await assertJiraSpecFieldValidation(page, "Número de documento", 15000);
  await reportJiraSpecStepComplete(page, testInfo, 20, false, true);

});
