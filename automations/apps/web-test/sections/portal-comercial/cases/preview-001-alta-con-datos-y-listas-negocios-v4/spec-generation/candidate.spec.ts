import { test } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
  select(options: Parameters<typeof this.runtime.selectPromotedItem>[0]) { return this.runtime.selectPromotedItem(options); }
}

test('Alta con datos y listas Negocios v4', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 220000));
  process.env.APP_SLUG = 'web-test';
  process.env.SECTION_SLUG = 'portal-comercial';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Alta con datos y listas Negocios v4';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const navigationUrl_1 = process.env.APP_BASE_URL;
    if (!navigationUrl_1) throw new Error('APP_BASE_URL is required');
    await page.goto(navigationUrl_1);
    await page.waitForLoadState('domcontentloaded');
    await pageObject.fill({
      stepIndex: 2,
      target: 'role:textbox|Usuario',
      value: String(process.env['PROMOTED_USUARIO'] ?? ''),
      valueKey: 'usuario',
      technicalTargetRefs: ['role:textbox|Usuario', 'css:#usuario', 'id:usuario'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 3,
      target: 'role:textbox|Contraseña',
      value: String(process.env['PROMOTED_CONTRASENA'] ?? ''),
      valueKey: 'contrasena',
      technicalTargetRefs: ['role:textbox|Contraseña', 'css:#clave', 'id:clave'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 4,
      target: 'css:[id="btn-login"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[id="btn-login"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"btn-login\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"id":"btn-login"},"stableDescendants":[],"semanticShape":[],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"login-form"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{\"id\":\"btn-login\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 5,
      target: 'css:[href="#/solicitud/nueva"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/solicitud/nueva"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/solicitud/nueva\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/solicitud/nueva"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"nav"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/solicitud/nueva\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 6,
      target: 'role:textbox|Número de Identificación*',
      value: String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? ''),
      valueKey: 'numero_de_identificacion',
      technicalTargetRefs: ['role:textbox|Número de Identificación*', 'css:#idNumero', 'id:idNumero'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 7,
      target: 'role:textbox|No. Registro Mercantil',
      value: String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? ''),
      valueKey: 'no_registro_mercantil',
      technicalTargetRefs: ['role:textbox|No. Registro Mercantil', 'css:#registroMercantil', 'id:registroMercantil'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 8,
      target: 'role:textbox|Denominación Social*',
      value: String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? ''),
      valueKey: 'denominacion_social',
      technicalTargetRefs: ['role:textbox|Denominación Social*', 'css:#denominacion', 'id:denominacion'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); }
    });
    await pageObject.select({
      stepIndex: 9,
      target: 'text:Tipo Sociedad*',
      valueKey: 'tipo_sociedad_seleccion',
      selectionValue: String(process.env['PROMOTED_TIPO_SOCIEDAD_SELECCION'] ?? ''),
      selectionIndex: 0,
      selectionField: 'Tipo Sociedad*',
      associatedField: 'Siglas',
      technicalTargetRefs: ['text:Tipo Sociedad*'],
      playwrightRecorderEvidence: {"kind":"text","normalizedName":"Sociedad de Responsabilidad Limitada (SRL)","scopeIdentity":{"strategy":"css","value":"select[id=\"tipoSociedad\"]"},"runtimeResolutionRequired":true,"nativeSelection":{"controlIdentity":{"strategy":"id","value":"tipoSociedad"},"scopeIdentity":{"strategy":"css","value":"select[id=\"tipoSociedad\"]"},"fieldLabel":"Tipo Sociedad*","options":[{"value":"","label":"Seleccione…","disabled":false},{"value":"Sociedad de Responsabilidad Limitada (SRL)","label":"Sociedad de Responsabilidad Limitada (SRL)","disabled":false},{"value":"Sociedad Anónima (SA)","label":"Sociedad Anónima (SA)","disabled":false},{"value":"Sociedad Anónima Simplificada (SAS)","label":"Sociedad Anónima Simplificada (SAS)","disabled":false},{"value":"Empresa Individual de Responsabilidad Limitada (EIRL)","label":"Empresa Individual de Responsabilidad Limitada (EIRL)","disabled":false},{"value":"Sociedad Anónima Cerrada (SAC)","label":"Sociedad Anónima Cerrada (SAC)","disabled":false},{"value":"Cooperativa","label":"Cooperativa","disabled":false}],"selectedValue":"Sociedad de Responsabilidad Limitada (SRL)","clickedOption":{"value":"Sociedad de Responsabilidad Limitada (SRL)","label":"Sociedad de Responsabilidad Limitada (SRL)"},"selectionMode":"index","selectedOptionIndex":0},"captureMatchCount":1},
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { throw new Error('Recorded indexed selection requires runtime resolution'); }
    });
    await pageObject.fill({
      stepIndex: 10,
      target: 'role:textbox|Siglas',
      value: String(process.env['PROMOTED_SIGLAS'] ?? ''),
      valueKey: 'siglas',
      technicalTargetRefs: ['role:textbox|Siglas', 'css:#siglas', 'id:siglas'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Siglas')!)!.fill(String(process.env['PROMOTED_SIGLAS'] ?? '')); }
    });
    await pageObject.select({
      stepIndex: 11,
      target: 'text:Nacionalidad',
      valueKey: 'nacionalidad_seleccion',
      selectionValue: String(process.env['PROMOTED_NACIONALIDAD_SELECCION'] ?? ''),
      selectionIndex: 0,
      associatedField: 'Nacionalidad',
      technicalTargetRefs: ['text:Nacionalidad'],
      playwrightRecorderEvidence: {"kind":"text","normalizedName":"Dominicana","scopeIdentity":{"strategy":"css","value":"select[id=\"nacionalidad\"]"},"runtimeResolutionRequired":true,"nativeSelection":{"controlIdentity":{"strategy":"id","value":"nacionalidad"},"scopeIdentity":{"strategy":"css","value":"select[id=\"nacionalidad\"]"},"fieldLabel":"Nacionalidad","options":[{"value":"","label":"Seleccione nacionalidad","disabled":false},{"value":"Dominicana","label":"Dominicana","disabled":false},{"value":"Estadounidense","label":"Estadounidense","disabled":false},{"value":"Española","label":"Española","disabled":false},{"value":"Panameña","label":"Panameña","disabled":false},{"value":"Colombiana","label":"Colombiana","disabled":false},{"value":"Mexicana","label":"Mexicana","disabled":false}],"selectedValue":"Dominicana","clickedOption":{"value":"Dominicana","label":"Dominicana"},"selectionMode":"index","selectedOptionIndex":0},"captureMatchCount":1},
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { throw new Error('Recorded indexed selection requires runtime resolution'); }
    });
    await pageObject.click({
      stepIndex: 12,
      target: 'role:tab|Registro de Datos',
      actionIntent: 'click',
      expectedEffect: 'selection_state_change',
      technicalTargetRefs: ['role:tab|Registro de Datos'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Número de Identificación*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:textbox|No. Registro Mercantil', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:textbox|Denominación Social*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:textbox|Siglas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Siglas')!)!.fill(String(process.env['PROMOTED_SIGLAS'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Registro de Datos')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 13,
      target: 'role:tab|Flujo de Solicitud',
      actionIntent: 'click',
      expectedEffect: 'selection_state_change',
      technicalTargetRefs: ['role:tab|Flujo de Solicitud'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Número de Identificación*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:textbox|No. Registro Mercantil', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:textbox|Denominación Social*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:textbox|Siglas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Siglas')!)!.fill(String(process.env['PROMOTED_SIGLAS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'role:tab|Registro de Datos', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Registro de Datos')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Flujo de Solicitud')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 14,
      target: 'css:[href="#/"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"nav"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Número de Identificación*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:textbox|No. Registro Mercantil', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:textbox|Denominación Social*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:textbox|Siglas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Siglas')!)!.fill(String(process.env['PROMOTED_SIGLAS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'role:tab|Registro de Datos', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Registro de Datos')!)!.click(); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'role:tab|Flujo de Solicitud', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Flujo de Solicitud')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 15,
      target: 'css:[href="#/solicitudes"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/solicitudes"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/solicitudes\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/solicitudes"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"nav"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/solicitudes\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Número de Identificación*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:textbox|No. Registro Mercantil', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:textbox|Denominación Social*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:textbox|Siglas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Siglas')!)!.fill(String(process.env['PROMOTED_SIGLAS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'role:tab|Registro de Datos', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Registro de Datos')!)!.click(); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'role:tab|Flujo de Solicitud', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Flujo de Solicitud')!)!.click(); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'css:[href="#/"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); }
    });
    await pageObject.select({
      stepIndex: 16,
      target: 'text:Borrador',
      valueKey: 'filtrar_por_estado_seleccion',
      selectionValue: String(process.env['PROMOTED_FILTRAR_POR_ESTADO_SELECCION'] ?? ''),
      selectionIndex: 0,
      selectionField: 'Filtrar por estado',
      associatedField: 'Buscar solicitudes',
      technicalTargetRefs: ['text:Borrador'],
      playwrightRecorderEvidence: {"kind":"text","normalizedName":"Borrador","scopeIdentity":{"strategy":"css","value":"select[id=\"sol-estado\"]"},"runtimeResolutionRequired":true,"nativeSelection":{"controlIdentity":{"strategy":"id","value":"sol-estado"},"scopeIdentity":{"strategy":"css","value":"select[id=\"sol-estado\"]"},"fieldLabel":"Filtrar por estado","options":[{"value":"","label":"Todos los estados","disabled":false},{"value":"Borrador","label":"Borrador","disabled":false},{"value":"Verificación PLAFT","label":"Verificación PLAFT","disabled":false},{"value":"En Revisión Legal","label":"En Revisión Legal","disabled":false},{"value":"Devuelta","label":"Devuelta","disabled":false},{"value":"Escalado","label":"Escalado","disabled":false},{"value":"Aprobada","label":"Aprobada","disabled":false},{"value":"Cliente Creado","label":"Cliente Creado","disabled":false},{"value":"Producto Abierto","label":"Producto Abierto","disabled":false},{"value":"Rechazada","label":"Rechazada","disabled":false}],"selectedValue":"Borrador","clickedOption":{"value":"Borrador","label":"Borrador"},"selectionMode":"index","selectedOptionIndex":0},"captureMatchCount":1},
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { throw new Error('Recorded indexed selection requires runtime resolution'); }
    });
    await pageObject.fill({
      stepIndex: 17,
      target: 'role:textbox|Buscar solicitudes',
      value: String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? ''),
      valueKey: 'buscar_solicitudes',
      technicalTargetRefs: ['role:textbox|Buscar solicitudes', 'css:#sol-search', 'id:sol-search'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Buscar solicitudes')!)!.fill(String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 18,
      target: 'css:[href="#/"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"nav"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Número de Identificación*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:textbox|No. Registro Mercantil', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:textbox|Denominación Social*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:textbox|Siglas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Siglas')!)!.fill(String(process.env['PROMOTED_SIGLAS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'role:tab|Registro de Datos', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Registro de Datos')!)!.click(); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'role:tab|Flujo de Solicitud', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Flujo de Solicitud')!)!.click(); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'css:[href="#/"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitudes"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); } }, { stepIndex: 17, actionIntent: 'restore_recorded_context', target: 'role:textbox|Buscar solicitudes', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Buscar solicitudes')!)!.fill(String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 19,
      target: 'css:[href="#/solicitudes"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/solicitudes"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/solicitudes\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/solicitudes"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"nav"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/solicitudes\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Número de Identificación*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:textbox|No. Registro Mercantil', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:textbox|Denominación Social*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:textbox|Siglas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Siglas')!)!.fill(String(process.env['PROMOTED_SIGLAS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'role:tab|Registro de Datos', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Registro de Datos')!)!.click(); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'role:tab|Flujo de Solicitud', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Flujo de Solicitud')!)!.click(); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'css:[href="#/"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitudes"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); } }, { stepIndex: 17, actionIntent: 'restore_recorded_context', target: 'role:textbox|Buscar solicitudes', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Buscar solicitudes')!)!.fill(String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? '')); } }, { stepIndex: 18, actionIntent: 'restore_recorded_context', target: 'css:[href="#/"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 20,
      target: 'role:button|Salir',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Salir'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Número de Identificación*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:textbox|No. Registro Mercantil', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:textbox|Denominación Social*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:textbox|Siglas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Siglas')!)!.fill(String(process.env['PROMOTED_SIGLAS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'role:tab|Registro de Datos', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Registro de Datos')!)!.click(); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'role:tab|Flujo de Solicitud', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:tab|Flujo de Solicitud')!)!.click(); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'css:[href="#/"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitudes"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); } }, { stepIndex: 17, actionIntent: 'restore_recorded_context', target: 'role:textbox|Buscar solicitudes', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Buscar solicitudes')!)!.fill(String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? '')); } }, { stepIndex: 18, actionIntent: 'restore_recorded_context', target: 'css:[href="#/"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); } }, { stepIndex: 19, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitudes"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Salir')!)!.click(); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
