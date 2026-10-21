import { test, expect } from "@playwright/test";
import { assertJiraSpecAbsentText, assertJiraSpecAuthGate, assertJiraSpecVisibleText, clickJiraSpecTarget, fillJiraSpecSegmentedCode, navigateJiraSpecRoute, performJiraSpecSelection, resolveJiraSpecAuthTestData, resolveJiraSpecTarget, resolveJiraSpecValue } from "../../../../../../../src/jira/jira-spec-runtime";

test("Consulta exitosa de saldos disponibles tras autenticación empresarial con verificación por SMS", async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 168000));
  const appSlug = "fenix";
  const sectionSlug = "jira-aa-101";
  const automationId = "aa-101-jira-1-consulta-exitosa-de-saldos-disponibles-tras-autenticacion-empresarial-con-verificacion-por-sms";
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("JIRA_SPEC_BASE_URL_MISSING");

  // 1. Project entry
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  // 2. Abrir la aplicación configurada del proyecto
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  // 3. Presionar "perfil empresarial".
  await clickJiraSpecTarget(page, {"strategy":"role","role":"link","name":"Empresarial","exact":true}, 2500, "Presionar \"perfil empresarial\".");

  // 4. fill [rnc]
  const target4 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"Enterprise\"]"}, 2500, "fill [rnc]");
  const value4 = await resolveJiraSpecValue("rnc", appSlug, sectionSlug, automationId);
  await target4.fill(value4);
  if (await target4.inputValue() !== value4) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");

  // 5. fill [usuario]
  const target5 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"UserNameE\"]"}, 2500, "fill [usuario]");
  const value5 = await resolveJiraSpecValue("usuario", appSlug, sectionSlug, automationId);
  await target5.fill(value5);
  if (await target5.inputValue() !== value5) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");

  // 6. fill [contrasena]
  const target6 = await resolveJiraSpecTarget(page, {"strategy":"css","value":"[id=\"PasswordE\"]"}, 2500, "fill [contrasena]");
  const value6 = await resolveJiraSpecValue("contrasena", appSlug, sectionSlug, automationId);
  await target6.fill(value6);
  if (await target6.inputValue() !== value6) throw new Error("JIRA_SPEC_FILL_NOT_CONFIRMED");

  // 7. Presionar "continuar inicio de sesión".
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Iniciar sesión","exact":true}, 2500, "Presionar \"continuar inicio de sesión\".");

  // 8. Solicitar el código por SMS
  await clickJiraSpecTarget(page, {"strategy":"css","value":"div:visible:text-is(\"SMS\")"}, 2500, "Solicitar el código por SMS");

  // 9. fill [codigo_acceso]
  const value9 = await resolveJiraSpecValue("codigo_acceso", appSlug, sectionSlug, automationId);
  await fillJiraSpecSegmentedCode(page, value9, {"strategy":"semantic","value":"segmented_code","metadata":{"originalTarget":"Código de acceso","resolvedTargetName":"segmented code input group","resolvedCandidateId":"6","repairType":"jira_segmented_code","validationStatus":"runtime_resolution_required"}});

  // 10. Presionar "continuar verificación de acceso".
  await clickJiraSpecTarget(page, {"strategy":"role","role":"button","name":"Continuar","exact":true}, 2500, "Presionar \"continuar verificación de acceso\".");

  // 11. Validar que se muestre "resumen de cuentas"
  await assertJiraSpecVisibleText(page, "resumen de cuentas", 15000);

  // 12. Validar "tipo" de cada cuenta presentada.
  await assertJiraSpecVisibleText(page, "tipo", 15000);

  // 13. Validar "saldo disponible" de cada cuenta presentada.
  await assertJiraSpecVisibleText(page, "saldo disponible", 15000);

  // 14. Validar "moneda" de cada cuenta presentada.
  await assertJiraSpecVisibleText(page, "moneda", 15000);

});
