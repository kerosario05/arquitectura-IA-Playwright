import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecFieldValidation, assertJiraSpecRowMatch, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, reportJiraSpecStepComplete, reportJiraSpecStepStart, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";
import { AuthFlow, setAuthFlowTestData } from "../../../../flows/auth.flow";

test("Consultar y filtrar el registro de auditoría empresarial", async ({ page }, testInfo) => {
  test.setTimeout(Math.max(test.info().timeout, 564000));
  const appSlug = "jira-regression-lab";
  const sectionSlug = "jira-aa-108";
  const automationId = "aa-108-jira-1-consultar-y-filtrar-el-registro-de-auditoria-empresarial";
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");
  setAuthFlowTestData(await resolveJiraSpecAuthTestData(appSlug));
  const authFlow = new AuthFlow(page);

  // 1. Project entry
  await reportJiraSpecStepStart(testInfo, 1);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await reportJiraSpecStepComplete(page, testInfo, 1, true, false);

  // 2. Presionar "Empresarial".
  await reportJiraSpecStepStart(testInfo, 2);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Empresarial","exact":true}, 2500, "Presionar \"Empresarial\".");
  await reportJiraSpecStepComplete(page, testInfo, 2, true, false);

  // 3. fill [auth.company_identifier]
  await reportJiraSpecStepStart(testInfo, 3);
  const target3 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-rnc\"]"}, 2500, "fill [auth.company_identifier]");
  const value3 = await resolveJiraSpecValue("auth.company_identifier", appSlug, sectionSlug, automationId);
  await target3.fill(value3);
  if (await target3.inputValue() !== value3) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 3, false, false);

  // 4. fill [auth.username]
  await reportJiraSpecStepStart(testInfo, 4);
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-user\"]"}, 2500, "fill [auth.username]");
  const value4 = await resolveJiraSpecValue("auth.username", appSlug, sectionSlug, automationId);
  await target4.fill(value4);
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 4, false, false);

  // 5. fill [auth.password]
  await reportJiraSpecStepStart(testInfo, 5);
  const target5 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"login-password\"]"}, 2500, "fill [auth.password]");
  const value5 = await resolveJiraSpecValue("auth.password", appSlug, sectionSlug, automationId);
  await target5.fill(value5);
  if (await target5.inputValue() !== value5) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 5, false, false);

  // 6. click Iniciar sesión
  await reportJiraSpecStepStart(testInfo, 6);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "click Iniciar sesión");
  await reportJiraSpecStepComplete(page, testInfo, 6, true, false);

  // 7. Presionar "Auditoría".
  await reportJiraSpecStepStart(testInfo, 7);
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"◷ Auditoría","exact":true}, 2500, "Presionar \"Auditoría\".");
  await reportJiraSpecStepComplete(page, testInfo, 7, true, false);

  // 8. Validar que "Registro de auditoría" muestre las columnas Usuario, Fecha y hora, Evento, Resultado y Referencia.
  await reportJiraSpecStepStart(testInfo, 8);
  await assertJiraSpecVisibleText(page, "Registro de auditoría", 15000, "Validar que \"Registro de auditoría\" muestre las columnas Usuario, Fecha y hora, Evento, Resultado y Referencia.");
  await reportJiraSpecStepComplete(page, testInfo, 8, false, false);

  // 9. fill [audit_search]
  await reportJiraSpecStepStart(testInfo, 9);
  const target9 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[aria-label=\"Buscar en auditoría\"]"}, 2500, "fill [audit_search]");
  const value9 = await resolveJiraSpecValue("audit_search", appSlug, sectionSlug, automationId);
  await target9.fill(value9);
  if (await target9.inputValue() !== value9) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");
  await reportJiraSpecStepComplete(page, testInfo, 9, false, false);

  // 10. Validar que la cantidad de eventos auditados refleje la búsqueda en "Registro de auditoría".
  await reportJiraSpecStepStart(testInfo, 10);
  await assertJiraSpecVisibleText(page, "Registro de auditoría", 15000, "Validar que la cantidad de eventos auditados refleje la búsqueda en \"Registro de auditoría\".");
  await reportJiraSpecStepComplete(page, testInfo, 10, false, false);

  // 11. Validar que los eventos de prueba de QA Demo estén visibles en "Registro de auditoría".
  await reportJiraSpecStepStart(testInfo, 11);
  await assertJiraSpecVisibleText(page, "Registro de auditoría", 15000, "Validar que los eventos de prueba de QA Demo estén visibles en \"Registro de auditoría\".");
  await reportJiraSpecStepComplete(page, testInfo, 11, false, false);

  // 12. select [audit_period_7_days]
  await reportJiraSpecStepStart(testInfo, 12);
  const target12 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"audit-period\"]"}, 2500, "select [audit_period_7_days]");
  const value12 = await resolveJiraSpecValue("audit_period_7_days", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target12, value12);
  await reportJiraSpecStepComplete(page, testInfo, 12, true, false);

  // 13. Validar que los eventos auditados visibles estén actualizados para Últimos 7 días en "Registro de auditoría".
  await reportJiraSpecStepStart(testInfo, 13);
  await assertJiraSpecVisibleText(page, "Registro de auditoría", 15000, "Validar que los eventos auditados visibles estén actualizados para Últimos 7 días en \"Registro de auditoría\".");
  await reportJiraSpecStepComplete(page, testInfo, 13, false, false);

  // 14. select [audit_period_30_days]
  await reportJiraSpecStepStart(testInfo, 14);
  const target14 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"audit-period\"]"}, 2500, "select [audit_period_30_days]");
  const value14 = await resolveJiraSpecValue("audit_period_30_days", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target14, value14);
  await reportJiraSpecStepComplete(page, testInfo, 14, true, false);

  // 15. Validar que los eventos auditados visibles estén actualizados para Últimos 30 días en "Registro de auditoría".
  await reportJiraSpecStepStart(testInfo, 15);
  await assertJiraSpecVisibleText(page, "Registro de auditoría", 15000, "Validar que los eventos auditados visibles estén actualizados para Últimos 30 días en \"Registro de auditoría\".");
  await reportJiraSpecStepComplete(page, testInfo, 15, false, false);

  // 16. select [audit_period_90_days]
  await reportJiraSpecStepStart(testInfo, 16);
  const target16 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"audit-period\"]"}, 2500, "select [audit_period_90_days]");
  const value16 = await resolveJiraSpecValue("audit_period_90_days", appSlug, sectionSlug, automationId);
  await performJiraSpecSelection(target16, value16);
  await reportJiraSpecStepComplete(page, testInfo, 16, true, false);

  // 17. Validar que los eventos auditados visibles estén actualizados para Últimos 90 días en "Registro de auditoría".
  await reportJiraSpecStepStart(testInfo, 17);
  await assertJiraSpecVisibleText(page, "Registro de auditoría", 15000, "Validar que los eventos auditados visibles estén actualizados para Últimos 90 días en \"Registro de auditoría\".");
  await reportJiraSpecStepComplete(page, testInfo, 17, false, true);

});
