export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
}

test('Prueba', async ({ page }) => {
  process.env.APP_SLUG = 'kiosko';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Prueba';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) throw new Error('APP_BASE_URL is required');
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');
    await pageObject.fill({
      stepIndex: 1,
      target: 'role:textbox|Nombre de prueba',
      value: String(process.env['PROMOTED_NOMBRE_DE_PRUEBA'] ?? ''),
      valueKey: 'nombre_de_prueba',
      technicalTargetRefs: ['role:textbox|Nombre de prueba'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de prueba')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_PRUEBA'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 2,
      target: 'role:textbox|Correo de prueba',
      value: String(process.env['PROMOTED_CORREO_DE_PRUEBA'] ?? ''),
      valueKey: 'correo_de_prueba',
      technicalTargetRefs: ['role:textbox|Correo de prueba'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Correo de prueba')!)!.fill(String(process.env['PROMOTED_CORREO_DE_PRUEBA'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 3,
      target: 'role:textbox|Contraseña ficticia',
      value: String(process.env['PROMOTED_CONTRASENA_FICTICIA'] ?? ''),
      valueKey: 'contrasena_ficticia',
      technicalTargetRefs: ['role:textbox|Contraseña ficticia'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña ficticia')!)!.fill(String(process.env['PROMOTED_CONTRASENA_FICTICIA'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 4,
      target: 'role:textbox|Notas del recorrido',
      value: String(process.env['PROMOTED_NOTAS_DEL_RECORRIDO'] ?? ''),
      valueKey: 'notas_del_recorrido',
      technicalTargetRefs: ['role:textbox|Notas del recorrido'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Notas del recorrido')!)!.fill(String(process.env['PROMOTED_NOTAS_DEL_RECORRIDO'] ?? '')); }
    });
    await pageObject.press({
      stepIndex: 5,
      target: 'role:textbox|Notas del recorrido',
      key: 'Enter'
    });
    await pageObject.fill({
      stepIndex: 6,
      target: 'role:textbox|Teléfono ficticio',
      value: String(process.env['PROMOTED_TELEFONO_FICTICIO'] ?? ''),
      valueKey: 'telefono_ficticio',
      technicalTargetRefs: ['role:textbox|Teléfono ficticio'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Teléfono ficticio')!)!.fill(String(process.env['PROMOTED_TELEFONO_FICTICIO'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 7,
      target: 'role:textbox|Importe decimal',
      value: String(process.env['PROMOTED_IMPORTE_DECIMAL'] ?? ''),
      valueKey: 'importe_decimal',
      technicalTargetRefs: ['role:textbox|Importe decimal'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Importe decimal')!)!.fill(String(process.env['PROMOTED_IMPORTE_DECIMAL'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 8,
      target: 'role:textbox|Identificador con máscara',
      value: String(process.env['PROMOTED_IDENTIFICADOR_CON_MASCARA'] ?? ''),
      valueKey: 'identificador_con_mascara',
      technicalTargetRefs: ['role:textbox|Identificador con máscara'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Identificador con máscara')!)!.fill(String(process.env['PROMOTED_IDENTIFICADOR_CON_MASCARA'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 9,
      target: 'role:option|Web',
      actionIntent: 'click',
      expectedEffect: 'selection_state_change',
      technicalTargetRefs: ['role:option|Web'],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:option|Web')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 10,
      target: 'role:option|Mobile',
      actionIntent: 'click',
      expectedEffect: 'selection_state_change',
      technicalTargetRefs: ['role:option|Mobile'],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:option|Mobile')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 11,
      target: 'role:option|Sucursal',
      actionIntent: 'click',
      expectedEffect: 'selection_state_change',
      technicalTargetRefs: ['role:option|Sucursal'],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:option|Sucursal')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 11,
      target: 'Sucursal',
      polarity: "positive",
      expectedUrl: 'http://127.0.0.1:8088/QA_Field_Lab.html',
      assertion: async () => { await expect(page).toHaveURL("http://127.0.0.1:8088/QA_Field_Lab.html"); }
    });
    await pageObject.fill({
      stepIndex: 12,
      target: 'role:textbox|Sugerencia nativa',
      value: String(process.env['PROMOTED_SUGERENCIA_NATIVA'] ?? ''),
      valueKey: 'sugerencia_nativa',
      technicalTargetRefs: ['role:textbox|Sugerencia nativa'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Sugerencia nativa')!)!.fill(String(process.env['PROMOTED_SUGERENCIA_NATIVA'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 13,
      target: 'css:#f-fecha_nativa',
      value: String(process.env['PROMOTED_FECHA_NATIVA'] ?? ''),
      valueKey: 'fecha_nativa',
      technicalTargetRefs: ['css:#f-fecha_nativa'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:#f-fecha_nativa')!)!.fill(String(process.env['PROMOTED_FECHA_NATIVA'] ?? '')); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
