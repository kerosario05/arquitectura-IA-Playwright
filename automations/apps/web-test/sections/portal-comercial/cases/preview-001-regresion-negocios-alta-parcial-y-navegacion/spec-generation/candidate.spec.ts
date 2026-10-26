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

test('Regresion Negocios alta parcial y navegacion', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 172000));
  process.env.APP_SLUG = 'web-test';
  process.env.SECTION_SLUG = 'portal-comercial';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Regresion Negocios alta parcial y navegacion';
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
      target: 'css:[href="#/solicitudes"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/solicitudes"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/solicitudes\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/solicitudes"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"nav"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/solicitudes\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 6,
      target: 'role:textbox|Buscar solicitudes',
      value: String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? ''),
      valueKey: 'buscar_solicitudes',
      technicalTargetRefs: ['role:textbox|Buscar solicitudes', 'css:#sol-search', 'id:sol-search'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Buscar solicitudes')!)!.fill(String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 7,
      target: 'css:[href="#/solicitud/nueva"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/solicitud/nueva"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/solicitud/nueva\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/solicitud/nueva"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"nav"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/solicitud/nueva\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitudes"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Buscar solicitudes', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Buscar solicitudes')!)!.fill(String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 8,
      target: 'role:textbox|Número de Identificación*',
      value: String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? ''),
      valueKey: 'numero_de_identificacion',
      technicalTargetRefs: ['role:textbox|Número de Identificación*', 'css:#idNumero', 'id:idNumero'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 9,
      target: 'role:textbox|No. Registro Mercantil',
      value: String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? ''),
      valueKey: 'no_registro_mercantil',
      technicalTargetRefs: ['role:textbox|No. Registro Mercantil', 'css:#registroMercantil', 'id:registroMercantil'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 10,
      target: 'role:textbox|Denominación Social*',
      value: String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? ''),
      valueKey: 'denominacion_social',
      technicalTargetRefs: ['role:textbox|Denominación Social*', 'css:#denominacion', 'id:denominacion'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 11,
      target: 'css:[href="#/"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"nav"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitudes"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Buscar solicitudes', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Buscar solicitudes')!)!.fill(String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:textbox|Número de Identificación*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'role:textbox|No. Registro Mercantil', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:textbox|Denominación Social*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 12,
      target: 'css:[href="#/solicitudes"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/solicitudes"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/solicitudes\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/solicitudes"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"nav"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/solicitudes\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitudes"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Buscar solicitudes', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Buscar solicitudes')!)!.fill(String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:textbox|Número de Identificación*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'role:textbox|No. Registro Mercantil', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:textbox|Denominación Social*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'css:[href="#/"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 13,
      target: 'css:[href="#/"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"nav"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitudes"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Buscar solicitudes', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Buscar solicitudes')!)!.fill(String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:textbox|Número de Identificación*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'role:textbox|No. Registro Mercantil', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:textbox|Denominación Social*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'css:[href="#/"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitudes"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 14,
      target: 'role:button|Salir',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Salir'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitudes"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Buscar solicitudes', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Buscar solicitudes')!)!.fill(String(process.env['PROMOTED_BUSCAR_SOLICITUDES'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:textbox|Número de Identificación*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Número de Identificación*')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'role:textbox|No. Registro Mercantil', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|No. Registro Mercantil')!)!.fill(String(process.env['PROMOTED_NO_REGISTRO_MERCANTIL'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:textbox|Denominación Social*', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Denominación Social*')!)!.fill(String(process.env['PROMOTED_DENOMINACION_SOCIAL'] ?? '')); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'css:[href="#/"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitudes"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitudes"]')!)!.click(); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'css:[href="#/"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Salir')!)!.click(); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
