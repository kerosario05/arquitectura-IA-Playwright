"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
test_1.test.describe('Runtime Context Loss Detection', () => {
    (0, test_1.test)('detectHomeResetOrInactivity function exists', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('detectHomeResetOrInactivity');
    });
    (0, test_1.test)('detects inactivity messages', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('volviendo al inicio');
        (0, test_1.expect)(content).toContain('inactividad');
        (0, test_1.expect)(content).toContain('por inactividad');
    });
    (0, test_1.test)('safeReplayContext method exists in PromotedSpecRuntime', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('safeReplayContext');
    });
    (0, test_1.test)('isSafeActionToReplay function exists', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('isSafeActionToReplay');
    });
    (0, test_1.test)('SAFE_ACTIONS includes navigation actions', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('start_session');
        (0, test_1.expect)(content).toContain('open_module');
        (0, test_1.expect)(content).toContain('select_product');
    });
    (0, test_1.test)('UNSAFE_ACTIONS includes sensitive actions', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('submit_form');
        (0, test_1.expect)(content).toContain('confirm_action');
        (0, test_1.expect)(content).toContain('payment');
        (0, test_1.expect)(content).toContain('transfer');
    });
});
test_1.test.describe('Return to List Alias Resolution', () => {
    (0, test_1.test)('return_to_list alias resolution exists', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('return_to_list');
        (0, test_1.expect)(content).toContain('Volver');
    });
    (0, test_1.test)('returnToListAliases includes common phrases', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('volver al listado');
        (0, test_1.expect)(content).toContain('regresar al listado');
        (0, test_1.expect)(content).toContain('back to list');
    });
    (0, test_1.test)('ProductDetailPage.backToList method exists', () => {
        const pomPath = path.join(__dirname, '../automations/apps/arquitectura-automatizacion/pages/productdetail.page.ts');
        const content = fs.readFileSync(pomPath, 'utf-8');
        (0, test_1.expect)(content).toContain('backToList');
    });
    (0, test_1.test)('backToList tries Volver button first', () => {
        const pomPath = path.join(__dirname, '../automations/apps/arquitectura-automatizacion/pages/productdetail.page.ts');
        const content = fs.readFileSync(pomPath, 'utf-8');
        (0, test_1.expect)(content).toContain("name: 'Volver'");
    });
    (0, test_1.test)('backToList has Atrás fallback', () => {
        const pomPath = path.join(__dirname, '../automations/apps/arquitectura-automatizacion/pages/productdetail.page.ts');
        const content = fs.readFileSync(pomPath, 'utf-8');
        (0, test_1.expect)(content).toContain('atrás');
        (0, test_1.expect)(content).toContain('atras');
    });
});
test_1.test.describe('Detail Page Verification Before Primary Action', () => {
    (0, test_1.test)('validateScreenContextForAction handles DetailPage', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('DetailPage');
        (0, test_1.expect)(content).toContain('click_primary_action');
    });
    (0, test_1.test)('detects list page vs detail page', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('isOnListPage');
        (0, test_1.expect)(content).toContain('producto');
        (0, test_1.expect)(content).toContain('detalle');
    });
    (0, test_1.test)('error includes lastSelectionStep diagnostics', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('lastSelectionStep');
        (0, test_1.expect)(content).toContain('wrong_screen_before_primary_action');
    });
});
test_1.test.describe('Context Replay Integration', () => {
    (0, test_1.test)('clickPromotedTarget accepts previousSteps parameter', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        (0, test_1.expect)(content).toContain('previousSteps');
        (0, test_1.expect)(content).toContain('SafeReplayStep');
    });
    (0, test_1.test)('home reset detection before validation', () => {
        const runtimePath = path.join(__dirname, '../src/automations/runtime/promoted-spec-runtime.ts');
        const content = fs.readFileSync(runtimePath, 'utf-8');
        // Check that detectHomeResetOrInactivity is called before validateScreenContextForAction
        const detectIndex = content.indexOf('detectHomeResetOrInactivity');
        const validateIndex = content.indexOf('validateScreenContextForAction');
        (0, test_1.expect)(detectIndex).toBeGreaterThan(0);
        (0, test_1.expect)(validateIndex).toBeGreaterThan(0);
        // In clickPromotedTarget, detect should come before validate
        const clickMethodStart = content.indexOf('async clickPromotedTarget');
        const detectInClick = content.indexOf('detectHomeResetOrInactivity', clickMethodStart);
        const validateInClick = content.indexOf('validateScreenContextForAction', clickMethodStart);
        (0, test_1.expect)(detectInClick).toBeGreaterThan(clickMethodStart);
        (0, test_1.expect)(validateInClick).toBeGreaterThan(detectInClick);
    });
});
