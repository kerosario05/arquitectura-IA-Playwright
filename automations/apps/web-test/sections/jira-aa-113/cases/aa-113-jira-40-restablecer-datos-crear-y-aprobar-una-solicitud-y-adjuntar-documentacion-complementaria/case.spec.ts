import { test, expect } from "@playwright/test";
import { settleJiraAction, assertJiraSpecAbsentText, assertJiraSpecHeaderText, awaitJiraSpecPostLoginTransition, assertJiraSpecAuthGate, assertJiraSpecDownloadContent, assertJiraSpecFieldValidation, assertJiraSpecFieldEnabled, assertJiraSpecFieldEmpty, assertJiraSpecRowMatch, assertJiraSpecTableBoundDownload, assertJiraSpecVisibleText, attachJiraSpecFile, clickJiraSpecTarget, completeJiraSpecAccessCodeGate, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";
import { createJiraWorkflowSession } from "../../../../../../../src/jira/jira-workflow-runtime";

test("Restablecer datos, crear y aprobar una solicitud y adjuntar documentación complementaria", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 600000));
  const appSlug = "web-test";
  const sectionSlug = "jira-aa-113";
  const automationId = "aa-113-jira-40-restablecer-datos-crear-y-aprobar-una-solicitud-y-adjuntar-documentacion-complementaria";
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

  // 6. fill [usuario_negocios_ac22]
  await reportJiraSpecStepStart(testInfo, 6);
  const target6 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [usuario_negocios_ac22]");
  const value6 = await resolveJiraSpecValue("usuario_negocios_ac22", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target6.fill(value6));
  if (await target6.inputValue() !== value6) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 6, false, false);

  // 7. fill [contrasena_negocios_ac22]
  await reportJiraSpecStepStart(testInfo, 7);
  const target7 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [contrasena_negocios_ac22]");
  const value7 = await resolveJiraSpecValue("contrasena_negocios_ac22", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target7.fill(value7));
  if (await target7.inputValue() !== value7) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 7, false, false);

  // 8. Presionar "iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 8);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"btn-login\"]"}, 2500, "Presionar \"iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 8, true, false);

  // 9. Presionar "Solicitudes"
  await reportJiraSpecStepStart(testInfo, 9);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Solicitudes","exact":true}, 2500, "Presionar \"Solicitudes\"");
  await reportJiraSpecStepComplete(page, testInfo, 9, true, false);

  // 10. Presionar "Nueva solicitud"
  await reportJiraSpecStepStart(testInfo, 10);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Nueva solicitud","exact":true}, 2500, "Presionar \"Nueva solicitud\"");
  await reportJiraSpecStepComplete(page, testInfo, 10, true, false);

  // 11. fill [rnc_camara_comercio_ac22]
  await reportJiraSpecStepStart(testInfo, 11);
  const target11 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"idNumero\"]"}, 2500, "fill [rnc_camara_comercio_ac22]");
  const value11 = await resolveJiraSpecValue("rnc_camara_comercio_ac22", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target11.fill(value11));
  if (await target11.inputValue() !== value11) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. Presionar "consultar el RNC"
  await reportJiraSpecStepStart(testInfo, 12);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Consultar","exact":true}, 2500, "Presionar \"consultar el RNC\"");
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. Validar que se muestre "Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto."
  await reportJiraSpecStepStart(testInfo, 13);
  await assertJiraSpecVisibleText(page, "Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto.", 15000, "Validar que se muestre \"Datos de Cámara de Comercio Registro encontrado. Datos autocompletados; se creará como Nuevo Prospecto.\"");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. Adjuntar el archivo de prueba en "Seleccionar documento"
  await reportJiraSpecStepStart(testInfo, 14);
  const fileRef14 = await resolveJiraSpecValue("jira_step_13", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => attachJiraSpecFile(page, {"strategy":"label","value":"Seleccionar documento","metadata":{"resolvedTargetName":"Seleccionar documento","validationStatus":"observed_file_input"}}, fileRef14, appSlug));
  await reportJiraSpecStepComplete(page, testInfo, 14, false, false);

  // 15. Presionar "Cargar documento"
  await reportJiraSpecStepStart(testInfo, 15);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Cargar documento","exact":true}, 2500, "Presionar \"Cargar documento\"");
  await reportJiraSpecStepComplete(page, testInfo, 15, true, false);

  // 16. Presionar "Guardar como borrador"
  await reportJiraSpecStepStart(testInfo, 16);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Guardar borrador","exact":true}, 2500, "Presionar \"Guardar como borrador\"");
  await reportJiraSpecStepComplete(page, testInfo, 16, true, false);

  // 17. Capturar el valor de "Número de solicitud" como "solicitudId"
  await reportJiraSpecStepStart(testInfo, 17);
  await workflow.execute({"kind":"capture","field":"Número de solicitud","variable":"solicitudId"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 17, false, false);

  // 18. Presionar "Enviar a Revisión Legal"
  await reportJiraSpecStepStart(testInfo, 18);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Enviar a Debida Diligencia","exact":true}, 2500, "Presionar \"Enviar a Revisión Legal\"");
  await reportJiraSpecStepComplete(page, testInfo, 18, true, false);

  // 19. Validar que se muestre "Solicitud enviada a Revisión Legal."
  await reportJiraSpecStepStart(testInfo, 19);
  await assertJiraSpecVisibleText(page, "Solicitud enviada a Revisión Legal.", 15000, "Validar que se muestre \"Solicitud enviada a Revisión Legal.\"");
  await reportJiraSpecStepComplete(page, testInfo, 19, false, false);

  // 20. Cambiar a la aplicación "Aprobaciones"
  await reportJiraSpecStepStart(testInfo, 20);
  await workflow.execute({"kind":"application","alias":"Aprobaciones"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 20, false, false);

  // 21. fill [usuario_aprobaciones_ac22]
  await reportJiraSpecStepStart(testInfo, 21);
  const target21 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"usuario\"]"}, 2500, "fill [usuario_aprobaciones_ac22]");
  const value21 = await resolveJiraSpecValue("usuario_aprobaciones_ac22", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target21.fill(value21));
  if (await target21.inputValue() !== value21) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 21, false, false);

  // 22. fill [contrasena_aprobaciones_ac22]
  await reportJiraSpecStepStart(testInfo, 22);
  const target22 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"clave\"]"}, 2500, "fill [contrasena_aprobaciones_ac22]");
  const value22 = await resolveJiraSpecValue("contrasena_aprobaciones_ac22", appSlug, sectionSlug, automationId);
  await settleJiraAction(page, () => target22.fill(value22));
  if (await target22.inputValue() !== value22) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 22, false, false);

  // 23. Presionar "iniciar sesión"
  await reportJiraSpecStepStart(testInfo, 23);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"iniciar sesión\"");
  await reportJiraSpecStepComplete(page, testInfo, 23, true, false);

  // 24. Ingresar el valor capturado "solicitudId" en "Buscar solicitud"
  await reportJiraSpecStepStart(testInfo, 24);
  await workflow.execute({"kind":"fillCaptured","field":"Buscar solicitud","variable":"solicitudId"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 24, false, false);

  // 25. Presionar "Aprobar" en la fila del valor capturado "solicitudId" en "Solicitudes pendientes de aprobación"
  await reportJiraSpecStepStart(testInfo, 25);
  await workflow.execute({"kind":"clickCapturedRow","action":"Aprobar","variable":"solicitudId","container":"Solicitudes pendientes de aprobación"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 25, false, false);

  // 26. Presionar "Confirmar aprobación"
  await reportJiraSpecStepStart(testInfo, 26);
  await clickJiraSpecTarget(page, {"strategy":"css","value":"[id=\"m-ok\"]"}, 2500, "Presionar \"Confirmar aprobación\"");
  await reportJiraSpecStepComplete(page, testInfo, 26, true, false);

  // 27. Validar que se muestre "Solicitud aprobada."
  await reportJiraSpecStepStart(testInfo, 27);
  await assertJiraSpecVisibleText(page, "Solicitud aprobada.", 15000, "Validar que se muestre \"Solicitud aprobada.\"");
  await reportJiraSpecStepComplete(page, testInfo, 27, false, false);

  // 28. Cambiar a la aplicación "principal"
  await reportJiraSpecStepStart(testInfo, 28);
  await workflow.execute({"kind":"application","alias":"principal"}, undefined);
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 28, false, false);

  // 29. Validar que se muestre "Aprobada"
  await reportJiraSpecStepStart(testInfo, 29);
  await assertJiraSpecVisibleText(page, "Aprobada", 15000, "Validar que se muestre \"Aprobada\"");
  await reportJiraSpecStepComplete(page, testInfo, 29, false, false);

  // 30. Adjuntar los documentos requeridos en "Documentación complementaria"
  await reportJiraSpecStepStart(testInfo, 30);
  await workflow.execute({"kind":"documents","container":"Documentación complementaria","optional":false}, await resolveJiraSpecValue("jira_documents_29", appSlug, sectionSlug, automationId));
  page = workflow.page; baseUrl = workflow.baseUrl;
  await reportJiraSpecStepComplete(page, testInfo, 30, false, false);

  // 31. Presionar "Guardar documentación complementaria"
  await reportJiraSpecStepStart(testInfo, 31);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Guardar documentación complementaria","exact":true}, 2500, "Presionar \"Guardar documentación complementaria\"");
  await reportJiraSpecStepComplete(page, testInfo, 31, true, false);

  // 32. Validar que se muestre "Documentación complementaria guardada."
  await reportJiraSpecStepStart(testInfo, 32);
  await assertJiraSpecVisibleText(page, "Documentación complementaria guardada.", 15000, "Validar que se muestre \"Documentación complementaria guardada.\"");
  await reportJiraSpecStepComplete(page, testInfo, 32, false, false);

  // 33. Validar Se muestran los resultados de restablecimiento, consulta de Cámara de Comercio, envío a Revisión Legal, aprobación y guardado de documentación complementaria. La solicitud capturada se aprueba en Aprobaciones y en el portal principal se muestra "Aprobada" antes de guardar la documentación complementaria.
  await reportJiraSpecStepStart(testInfo, 33);
  await assertJiraSpecVisibleText(page, "Aprobada", 15000, "Validar Se muestran los resultados de restablecimiento, consulta de Cámara de Comercio, envío a Revisión Legal, aprobación y guardado de documentación complementaria. La solicitud capturada se aprueba en Aprobaciones y en el portal principal se muestra \"Aprobada\" antes de guardar la documentación complementaria.");
  await reportJiraSpecStepComplete(page, testInfo, 33, false, true);

  } finally { await workflow.close(); } 
});
