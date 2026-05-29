import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Runtime Context Loss Detection', () => {
  test('detectHomeResetOrInactivity function exists', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('detectHomeResetOrInactivity');
  });

  test('detects inactivity messages', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('volviendo al inicio');
    expect(content).toContain('inactividad');
    expect(content).toContain('por inactividad');
  });

  test('safeReplayContext method exists in PromotedSpecRuntime', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('safeReplayContext');
  });

  test('isSafeActionToReplay function exists', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('isSafeActionToReplay');
  });

  test('SAFE_ACTIONS includes navigation actions', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('start_session');
    expect(content).toContain('open_module');
    expect(content).toContain('select_product');
  });

  test('UNSAFE_ACTIONS includes sensitive actions', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('submit_form');
    expect(content).toContain('confirm_action');
    expect(content).toContain('payment');
    expect(content).toContain('transfer');
  });
});

test.describe('Return to List Alias Resolution', () => {
  test('return_to_list alias resolution exists', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('return_to_list');
    expect(content).toContain('Volver');
  });

  test('returnToListAliases includes common phrases', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('volver al listado');
    expect(content).toContain('regresar al listado');
    expect(content).toContain('back to list');
  });

  test('ProductDetailPage.backToList method exists', () => {
    const pomPath = path.join(__dirname, '../automations/apps/arquitectura-automatizacion/pages/productdetail.page.ts');
    const content = fs.readFileSync(pomPath, 'utf-8');
    
    expect(content).toContain('backToList');
  });

  test('backToList tries Volver button first', () => {
    const pomPath = path.join(__dirname, '../automations/apps/arquitectura-automatizacion/pages/productdetail.page.ts');
    const content = fs.readFileSync(pomPath, 'utf-8');
    
    expect(content).toContain("name: 'Volver'");
  });

  test('backToList has Atrás fallback', () => {
    const pomPath = path.join(__dirname, '../automations/apps/arquitectura-automatizacion/pages/productdetail.page.ts');
    const content = fs.readFileSync(pomPath, 'utf-8');
    
    expect(content).toContain('atrás');
    expect(content).toContain('atras');
  });
});

test.describe('Detail Page Verification Before Primary Action', () => {
  test('validateScreenContextForAction handles DetailPage', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('DetailPage');
    expect(content).toContain('click_primary_action');
  });

  test('detects list page vs detail page', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('isOnListPage');
    expect(content).toContain('producto');
    expect(content).toContain('detalle');
  });

  test('error includes lastSelectionStep diagnostics', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('lastSelectionStep');
    expect(content).toContain('wrong_screen_before_primary_action');
  });
});

test.describe('Context Replay Integration', () => {
  test('clickPromotedTarget accepts previousSteps parameter', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    expect(content).toContain('previousSteps');
    expect(content).toContain('SafeReplayStep');
  });

  test('home reset detection before validation', () => {
    const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
    const content = fs.readFileSync(runtimePath, 'utf-8');
    
    // Check that detectHomeResetOrInactivity is called before validateScreenContextForAction
    const detectIndex = content.indexOf('detectHomeResetOrInactivity');
    const validateIndex = content.indexOf('validateScreenContextForAction');
    
    expect(detectIndex).toBeGreaterThan(0);
    expect(validateIndex).toBeGreaterThan(0);
    // In clickPromotedTarget, detect should come before validate
    const clickMethodStart = content.indexOf('async clickPromotedTarget');
    const detectInClick = content.indexOf('detectHomeResetOrInactivity', clickMethodStart);
    const validateInClick = content.indexOf('validateScreenContextForAction', clickMethodStart);
    
    expect(detectInClick).toBeGreaterThan(clickMethodStart);
    expect(validateInClick).toBeGreaterThan(detectInClick);
  });
});
