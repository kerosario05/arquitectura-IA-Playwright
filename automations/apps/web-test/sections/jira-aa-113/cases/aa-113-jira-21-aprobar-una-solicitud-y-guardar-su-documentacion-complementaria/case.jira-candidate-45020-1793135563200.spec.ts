import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, attachJiraSpecFile, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";
import { createJiraWorkflowSession } from "../../../../../../../src/jira/jira-workflow-runtime";

test("Aprobar una solicitud y guardar su documentación complementaria", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 576000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "aa-113-jira-21-aprobar-una-solicitud-y-guardar-su-documentacion-complementaria";
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

  // 3. fill [usuario_portal]
  await reportJiraSpecStepStart(testInfo, 3);
  const target3 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [usuario_portal]");
  const value3 = await resolveJiraSpecValue("usuario_portal", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target3.fill(value3));
  if (await target3.inputValue() !== value3) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 3, false, false);

  // 4. fill [contrasena_portal]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [contrasena_portal]");
  const value4 = await resolveJiraSpecValue("contrasena_portal", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target4.fill(value4));
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 4, false, false);

  // 5. Presionar "iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 5);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"btn-login\"]"}, 2500, "Presionar \"iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 5, true, false);

  // 6. Presionar "Solicitudes"
  await reportJiraSpecStepStart(testInfo, 6);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Solicitudes","exact":true}, 2500, "Presionar \"Solicitudes\"");
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Presionar "Nueva solicitud"
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Nueva solicitud","exact":true}, 2500, "Presionar \"Nueva solicitud\"");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. fill [rnc_prospecto]
  await reportJiraSpecStepStart(testInfo, 8);
  const target8 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"idNumero\"]"}, 2500, "fill [rnc_prospecto]");
  const value8 = await resolveJiraSpecValue("rnc_prospecto", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target8.fill(value8));
  if (await target8.inputValue() !== value8) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 8, false, false);

  // 9. Presionar "consultar el RNC"
  await reportJiraSpecStepStart(testInfo, 9);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Consultar","exact":true}, 2500, "Presionar \"consultar el RNC\"");
  await reportJiraSpecStepComplete(page, testInfo, 9, true, false);

  // 10. Validar que se muestre "Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto."
  await reportJiraSpecStepStart(testInfo, 10);
  await assertJiraSpecVisibleText(page, "Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto.", 15000, "Validar que se muestre \"Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto.\"");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Adjuntar el archivo de prueba en "Seleccionar documento"
  await reportJiraSpecStepStart(testInfo, 11);
  const fileRef11 = await resolveJiraSpecValue("jira_step_10", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => attachJiraSpecFile(page, {"strategy":"label","value":"Seleccionar documento","metadata":{"resolvedTargetName":"Seleccionar documento","validationStatus":"observed_file_input"}}, fileRef11, appSlug));
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. Presionar "Cargar documento"
  await reportJiraSpecStepStart(testInfo, 12);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Cargar documento","exact":true}, 2500, "Presionar \"Cargar documento\"");
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. Presionar "guardar como borrador"
  await reportJiraSpecStepStart(testInfo, 13);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Guardar borrador","exact":true}, 2500, "Presionar \"guardar como borrador\"");
  await reportJiraSpecStepComplete(page, testInfo, 13, true, false);

  // 14. Capturar el valor de "Número de solicitud" como "solicitudId"
  await reportJiraSpecStepStart(testInfo, 14);
  await workflow.execute({"kind":"capture","field":"Número de solicitud","variable":"solicitudId"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. Presionar "enviar a Revisión Legal"
  await reportJiraSpecStepStart(testInfo, 15);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Enviar a Debida Diligencia","exact":true}, 2500, "Presionar \"enviar a Revisión Legal\"");
  await reportJiraSpecStepComplete(page, testInfo, 15, true, false);

  // 16. Cambiar a la aplicación "Aprobaciones"
  await reportJiraSpecStepStart(testInfo, 16);
  await workflow.execute({"kind":"application","alias":"Aprobaciones"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 16, false, false);

  // 17. fill [usuario_aprobaciones]
  await reportJiraSpecStepStart(testInfo, 17);
  const target17 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [usuario_aprobaciones]");
  const value17 = await resolveJiraSpecValue("usuario_aprobaciones", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target17.fill(value17));
  if (await target17.inputValue() !== value17) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. fill [contrasena_aprobaciones]
  await reportJiraSpecStepStart(testInfo, 18);
  const target18 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [contrasena_aprobaciones]");
  const value18 = await resolveJiraSpecValue("contrasena_aprobaciones", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target18.fill(value18));
  if (await target18.inputValue() !== value18) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 18, false, false);

  // 19. Presionar "iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 19);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, true, false);

  // 20. Ingresar el valor capturado "solicitudId" en "Buscar solicitud"
  await reportJiraSpecStepStart(testInfo, 20);
  await workflow.execute({"kind":"fillCaptured","field":"Buscar solicitud","variable":"solicitudId"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 20, false, false);

  // 21. Presionar "Aprobar" en la fila del valor capturado "solicitudId" en "Solicitudes pendientes de aprobación"
  await reportJiraSpecStepStart(testInfo, 21);
  await workflow.execute({"kind":"clickCapturedRow","action":"Aprobar","variable":"solicitudId","container":"Solicitudes pendientes de aprobación"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 21, false, false);

  // 22. Presionar "Confirmar aprobación"
  await reportJiraSpecStepStart(testInfo, 22);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"m-ok\"]"}, 2500, "Presionar \"Confirmar aprobación\"");
  await reportJiraSpecStepComplete(page, testInfo, 22, true, false);

  // 23. Validar que se muestre "Solicitud aprobada."
  await reportJiraSpecStepStart(testInfo, 23);
  await assertJiraSpecVisibleText(page, "Solicitud aprobada.", 15000, "Validar que se muestre \"Solicitud aprobada.\"");
  await reportJiraSpecStepComplete(page, testInfo, 23, false, false);

  // 24. Cambiar a la aplicación "principal"
  await reportJiraSpecStepStart(testInfo, 24);
  await workflow.execute({"kind":"application","alias":"principal"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 24, false, false);

  // 25. Validar que se muestre "Aprobada"
  await reportJiraSpecStepStart(testInfo, 25);
  await assertJiraSpecVisibleText(page, "Aprobada", 15000, "Validar que se muestre \"Aprobada\"");
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Adjuntar los documentos requeridos en "Documentación complementaria"
  await reportJiraSpecStepStart(testInfo, 26);
  await workflow.execute({"kind":"documents","container":"Documentación complementaria","optional":false}, await resolveJiraSpecValue("jira_documents_25", appSlug, sectionSlug, automationId));
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 26, false, false);

  // 27. Presionar "Guardar documentación complementaria"
  await reportJiraSpecStepStart(testInfo, 27);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Guardar documentación complementaria","exact":true}, 2500, "Presionar \"Guardar documentación complementaria\"");
  await reportJiraSpecStepComplete(page, testInfo, 27, true, false);

  // 28. Validar que se muestre "Documentación complementaria guardada."
  await reportJiraSpecStepStart(testInfo, 28);
  await assertJiraSpecVisibleText(page, "Documentación complementaria guardada.", 15000, "Validar que se muestre \"Documentación complementaria guardada.\"");
  await reportJiraSpecStepComplete(page, testInfo, 28, false, true);

  } finally { await workflow.close(); } 
});
