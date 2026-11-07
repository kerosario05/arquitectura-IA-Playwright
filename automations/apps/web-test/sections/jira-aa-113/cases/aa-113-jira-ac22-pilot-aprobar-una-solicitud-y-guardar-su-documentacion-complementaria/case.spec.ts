import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, attachJiraSpecFile, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";
import { createJiraWorkflowSession } from "../../../../../../../src/jira/jira-workflow-runtime";

test("Aprobar una solicitud y guardar su documentación complementaria", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "aa-113-jira-ac22-pilot-aprobar-una-solicitud-y-guardar-su-documentacion-complementaria";
  let baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");
  const workflow = await createJiraWorkflowSession(page, appSlug);
  try {

  // 1. Project entry
  await reportJiraSpecStepStart(testInfo, 1);
  await settleJiraAction(page, () => page.goto(baseUrl, { waitUntil: "domcontentloaded" }), baseUrl);
  await reportJiraSpecStepComplete(page, testInfo, 1, true, false);

  // 2. Abrir la aplicación configurada del proyecto
  await reportJiraSpecStepStart(testInfo, 2);
  await settleJiraAction(page, () => page.goto(baseUrl, { waitUntil: "domcontentloaded" }), baseUrl);
  await reportJiraSpecStepComplete(page, testInfo, 2, true, false);

  // 3. Presionar "Datos de demostración"
  await reportJiraSpecStepStart(testInfo, 3);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Datos de demostración","exact":true}, 2500, "Presionar \"Datos de demostración\"");
  await reportJiraSpecStepComplete(page, testInfo, 3, true, false);

  // 4. Presionar "Restablecer datos de demostración"
  await reportJiraSpecStepStart(testInfo, 4);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Restablecer datos de demostración","exact":true}, 2500, "Presionar \"Restablecer datos de demostración\"");
  await reportJiraSpecStepComplete(page, testInfo, 4, true, false);

  // 5. Validar que se muestre "Datos de demostración restablecidos."
  await reportJiraSpecStepStart(testInfo, 5);
  await assertJiraSpecVisibleText(page, "Datos de demostración restablecidos.", 15000, "Validar que se muestre \"Datos de demostración restablecidos.\"");
  await reportJiraSpecStepComplete(page, testInfo, 5, false, false);

  // 6. Presionar "Datos de demostración"
  await reportJiraSpecStepStart(testInfo, 6);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Datos de demostración","exact":true}, 2500, "Presionar \"Datos de demostración\"");
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Presionar "Restablecer datos de demostración"
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Restablecer datos de demostración","exact":true}, 2500, "Presionar \"Restablecer datos de demostración\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. Validar que se muestre "Datos de demostración restablecidos."
  await reportJiraSpecStepStart(testInfo, 8);
  await assertJiraSpecVisibleText(page, "Datos de demostración restablecidos.", 15000, "Validar que se muestre \"Datos de demostración restablecidos.\"");
  await reportJiraSpecStepComplete(page, testInfo, 8, false, false);

  // 9. fill [usuario_portal]
  await reportJiraSpecStepStart(testInfo, 9);
  const target9 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [usuario_portal]");
  const value9 = await resolveJiraSpecValue("usuario_portal", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target9.fill(value9));
  if (await target9.inputValue() !== value9) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. fill [contrasena_portal]
  await reportJiraSpecStepStart(testInfo, 10);
  const target10 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [contrasena_portal]");
  const value10 = await resolveJiraSpecValue("contrasena_portal", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target10.fill(value10));
  if (await target10.inputValue() !== value10) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Presionar "iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 11);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"btn-login\"]"}, 2500, "Presionar \"iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 11, true, false);

  // 12. Presionar "Solicitudes"
  await reportJiraSpecStepStart(testInfo, 12);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Solicitudes","exact":true}, 2500, "Presionar \"Solicitudes\"");
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. Presionar "Nueva solicitud"
  await reportJiraSpecStepStart(testInfo, 13);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Nueva solicitud","exact":true}, 2500, "Presionar \"Nueva solicitud\"");
  await reportJiraSpecStepComplete(page, testInfo, 13, true, false);

  // 14. fill [rnc_prospecto]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"idNumero\"]"}, 2500, "fill [rnc_prospecto]");
  const value14 = await resolveJiraSpecValue("rnc_prospecto", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target14.fill(value14));
  if (await target14.inputValue() !== value14) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. Presionar "consultar el RNC"
  await reportJiraSpecStepStart(testInfo, 15);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Consultar","exact":true}, 2500, "Presionar \"consultar el RNC\"");
  await reportJiraSpecStepComplete(page, testInfo, 15, true, false);

  // 16. Validar que se muestre "Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto."
  await reportJiraSpecStepStart(testInfo, 16);
  await assertJiraSpecVisibleText(page, "Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto.", 15000, "Validar que se muestre \"Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto.\"");
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. Adjuntar el archivo de prueba en "Seleccionar documento"
  await reportJiraSpecStepStart(testInfo, 17);
  const fileRef17 = await resolveJiraSpecValue("jira_step_10", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => attachJiraSpecFile(page, {"strategy":"label","value":"Seleccionar documento","metadata":{"resolvedTargetName":"Seleccionar documento","validationStatus":"observed_file_input"}}, fileRef17, appSlug));
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. Presionar "Cargar documento"
  await reportJiraSpecStepStart(testInfo, 18);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Cargar documento","exact":true}, 2500, "Presionar \"Cargar documento\"");
  await reportJiraSpecStepComplete(page, testInfo, 18, true, false);

  // 19. Presionar "guardar como borrador"
  await reportJiraSpecStepStart(testInfo, 19);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Guardar borrador","exact":true}, 2500, "Presionar \"guardar como borrador\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, true, false);

  // 20. Capturar el valor de "Número de solicitud" como "solicitudId"
  await reportJiraSpecStepStart(testInfo, 20);
  await workflow.execute({"kind":"capture","field":"Número de solicitud","variable":"solicitudId"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 20, false, false);

  // 21. Presionar "enviar a Revisión Legal"
  await reportJiraSpecStepStart(testInfo, 21);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Enviar a Debida Diligencia","exact":true}, 2500, "Presionar \"enviar a Revisión Legal\"");
  await reportJiraSpecStepComplete(page, testInfo, 21, true, false);

  // 22. Validar que se muestre "Solicitud enviada a Revisión Legal."
  await reportJiraSpecStepStart(testInfo, 22);
  await assertJiraSpecVisibleText(page, "Solicitud enviada a Revisión Legal.", 15000, "Validar que se muestre \"Solicitud enviada a Revisión Legal.\"");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. Cambiar a la aplicación "Aprobaciones"
  await reportJiraSpecStepStart(testInfo, 23);
  await workflow.execute({"kind":"application","alias":"Aprobaciones"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. fill [usuario_aprobaciones]
  await reportJiraSpecStepStart(testInfo, 24);
  const target24 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [usuario_aprobaciones]");
  const value24 = await resolveJiraSpecValue("usuario_aprobaciones", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target24.fill(value24));
  if (await target24.inputValue() !== value24) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 24, false, false);

  // 25. fill [contrasena_aprobaciones]
  await reportJiraSpecStepStart(testInfo, 25);
  const target25 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [contrasena_aprobaciones]");
  const value25 = await resolveJiraSpecValue("contrasena_aprobaciones", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target25.fill(value25));
  if (await target25.inputValue() !== value25) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Presionar "iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 26);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 26, true, false);

  // 27. Ingresar el valor capturado "solicitudId" en "Buscar solicitud"
  await reportJiraSpecStepStart(testInfo, 27);
  await workflow.execute({"kind":"fillCaptured","field":"Buscar solicitud","variable":"solicitudId"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 27, false, false);

  // 28. Presionar "Aprobar" en la fila del valor capturado "solicitudId" en "Solicitudes pendientes de aprobación"
  await reportJiraSpecStepStart(testInfo, 28);
  await workflow.execute({"kind":"clickCapturedRow","action":"Aprobar","variable":"solicitudId","container":"Solicitudes pendientes de aprobación"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 28, false, false);

  // 29. Presionar "Confirmar aprobación"
  await reportJiraSpecStepStart(testInfo, 29);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"m-ok\"]"}, 2500, "Presionar \"Confirmar aprobación\"");
  await reportJiraSpecStepComplete(page, testInfo, 29, true, false);

  // 30. Validar que se muestre "Solicitud aprobada."
  await reportJiraSpecStepStart(testInfo, 30);
  await assertJiraSpecVisibleText(page, "Solicitud aprobada.", 15000, "Validar que se muestre \"Solicitud aprobada.\"");
  await reportJiraSpecStepComplete(page, testInfo, 30, false, false);

  // 31. Cambiar a la aplicación "principal"
  await reportJiraSpecStepStart(testInfo, 31);
  await workflow.execute({"kind":"application","alias":"principal"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 31, false, false);

  // 32. Validar que se muestre "Aprobada"
  await reportJiraSpecStepStart(testInfo, 32);
  await assertJiraSpecVisibleText(page, "Aprobada", 15000, "Validar que se muestre \"Aprobada\"");
  await reportJiraSpecStepComplete(page, testInfo, 32, false, false);

  // 33. Adjuntar los documentos requeridos en "Documentación complementaria"
  await reportJiraSpecStepStart(testInfo, 33);
  await workflow.execute({"kind":"documents","container":"Documentación complementaria","optional":false}, await resolveJiraSpecValue("jira_documents_25", appSlug, sectionSlug, automationId));
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 33, false, false);

  // 34. Presionar "Guardar documentación complementaria"
  await reportJiraSpecStepStart(testInfo, 34);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Guardar documentación complementaria","exact":true}, 2500, "Presionar \"Guardar documentación complementaria\"");
  await reportJiraSpecStepComplete(page, testInfo, 34, true, false);

  // 35. Validar que se muestre "Documentación complementaria guardada."
  await reportJiraSpecStepStart(testInfo, 35);
  await assertJiraSpecVisibleText(page, "Documentación complementaria guardada.", 15000, "Validar que se muestre \"Documentación complementaria guardada.\"");
  await reportJiraSpecStepComplete(page, testInfo, 35, false, true);

  } finally { await workflow.close(); } 
});
