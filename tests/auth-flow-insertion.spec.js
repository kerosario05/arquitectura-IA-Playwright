"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe('AuthFlow Insertion Metadata', () => {
    (0, test_1.test)('ExecutionPlan metadata includes authFlowRequired when AuthGate detected', () => {
        const plan = {
            version: '1.0',
            source: 'discovery_generated',
            status: 'validated',
            scenario: {
                source: 'testrail',
                caseId: 38257,
                title: 'Consulta de balance'
            },
            requiredData: [],
            steps: [
                { index: 0, action: 'navigate', target: 'APP_BASE_URL' },
                { index: 1, action: 'click', description: 'start_session' },
                { index: 2, action: 'click', description: 'open_module Transacciones y servicios' },
                { index: 3, action: 'click', description: 'open_module Consulta de balance' }
            ],
            createdAt: new Date().toISOString(),
            metadata: {
                authFlowRequired: true,
                authFlowInsertionAfterStepIndex: 2,
                authFlowAlias: 'defaultClient',
                authFlowLanding: 'transactions_menu',
                authGateDetectedDuringDiscovery: true
            }
        };
        (0, test_1.expect)(plan.metadata?.authFlowRequired).toBe(true);
        (0, test_1.expect)(plan.metadata?.authFlowInsertionAfterStepIndex).toBe(2);
        (0, test_1.expect)(plan.metadata?.authGateDetectedDuringDiscovery).toBe(true);
    });
    (0, test_1.test)('ExecutionPlan metadata is undefined when no AuthGate detected', () => {
        const plan = {
            version: '1.0',
            source: 'discovery_generated',
            status: 'validated',
            scenario: {
                source: 'testrail',
                caseId: 12345,
                title: 'Public case'
            },
            requiredData: [],
            steps: [
                { index: 0, action: 'navigate', target: 'APP_BASE_URL' },
                { index: 1, action: 'click', description: 'start_session' }
            ],
            createdAt: new Date().toISOString()
        };
        (0, test_1.expect)(plan.metadata).toBeUndefined();
    });
});
test_1.test.describe('AuthFlow Promotion Gate Validation', () => {
    (0, test_1.test)('promotion-gate detects missing AuthFlow in spec when required by plan metadata', () => {
        const { evaluatePromotionGate } = require('../src/automations/promotion-gate');
        const plan = {
            version: '1.0',
            source: 'discovery_generated',
            status: 'validated',
            scenario: {
                source: 'testrail',
                caseId: 38257,
                title: 'Consulta de balance'
            },
            requiredData: [],
            steps: [],
            createdAt: new Date().toISOString(),
            metadata: {
                authFlowRequired: true,
                authFlowInsertionAfterStepIndex: 2,
                authGateDetectedDuringDiscovery: true
            }
        };
        const discoveryResult = {
            status: 'discovered_passed',
            caseId: 38257,
            caseTitle: 'Consulta de balance',
            discoveredAt: new Date().toISOString(),
            steps: [],
            discoveredObjects: [],
            failedReason: undefined
        };
        // Spec without AuthFlow
        const specWithoutAuthFlow = `
      import { test } from '@playwright/test';
      test('Consulta de balance', async ({ page }) => {
        await page.goto('/');
        await homePage.start();
        await operationsMenuPage.openModule('Transacciones y servicios');
        await operationsMenuPage.openModule('Consulta de balance');
      });
    `;
        const result = evaluatePromotionGate({
            discoveryResult,
            candidatePlan: plan,
            specContent: specWithoutAuthFlow,
            promotionPolicy: {
                specMode: 'page-object',
                requirePageObjects: false,
                allowInlineFallback: true
            }
        });
        // Should be blocked due to missing AuthFlow
        (0, test_1.expect)(result.allowed).toBe(false);
        (0, test_1.expect)(result.reasons.some((r) => r.includes('AuthFlow'))).toBe(true);
    });
    (0, test_1.test)('promotion-gate allows spec with AuthFlow when required by plan metadata', () => {
        const { evaluatePromotionGate } = require('../src/automations/promotion-gate');
        const plan = {
            version: '1.0',
            source: 'discovery_generated',
            status: 'validated',
            scenario: {
                source: 'testrail',
                caseId: 38257,
                title: 'Consulta de balance'
            },
            requiredData: [],
            steps: [],
            createdAt: new Date().toISOString(),
            metadata: {
                authFlowRequired: true,
                authFlowInsertionAfterStepIndex: 2,
                authGateDetectedDuringDiscovery: true
            }
        };
        const discoveryResult = {
            status: 'discovered_passed',
            caseId: 38257,
            caseTitle: 'Consulta de balance',
            discoveredAt: new Date().toISOString(),
            steps: [],
            discoveredObjects: [],
            failedReason: undefined
        };
        // Spec with AuthFlow
        const specWithAuthFlow = `
      import { test } from '@playwright/test';
      import { AuthFlow } from '../../../../flows/auth.flow';
      
      test('Consulta de balance', async ({ page }) => {
        const authFlow = new AuthFlow(page);
        
        await page.goto('/');
        await homePage.start();
        await operationsMenuPage.openModule('Transacciones y servicios');
        await authFlow.ensureAuthenticated({
          alias: 'defaultClient',
          landing: 'transactions_menu'
        });
        await operationsMenuPage.openModule('Consulta de balance');
      });
    `;
        const result = evaluatePromotionGate({
            discoveryResult,
            candidatePlan: plan,
            specContent: specWithAuthFlow,
            promotionPolicy: {
                specMode: 'page-object',
                requirePageObjects: false,
                allowInlineFallback: true
            }
        });
        // Should NOT have AuthFlow-related blocking reasons
        const authFlowReasons = result.reasons.filter((r) => r.includes('AuthFlow'));
        (0, test_1.expect)(authFlowReasons.length).toBe(0);
    });
    (0, test_1.test)('promotion-gate does not require AuthFlow when plan metadata is absent', () => {
        const { evaluatePromotionGate } = require('../src/automations/promotion-gate');
        const plan = {
            version: '1.0',
            source: 'discovery_generated',
            status: 'validated',
            scenario: {
                source: 'testrail',
                caseId: 12345,
                title: 'Public case'
            },
            requiredData: [],
            steps: [],
            createdAt: new Date().toISOString()
            // No metadata - AuthFlow not required
        };
        const discoveryResult = {
            status: 'discovered_passed',
            caseId: 12345,
            caseTitle: 'Public case',
            discoveredAt: new Date().toISOString(),
            steps: [],
            discoveredObjects: [],
            failedReason: undefined
        };
        const specWithoutAuthFlow = `
      import { test } from '@playwright/test';
      test('Public case', async ({ page }) => {
        await page.goto('/');
        await homePage.start();
      });
    `;
        const result = evaluatePromotionGate({
            discoveryResult,
            candidatePlan: plan,
            specContent: specWithoutAuthFlow,
            promotionPolicy: {
                specMode: 'page-object',
                requirePageObjects: false,
                allowInlineFallback: true
            }
        });
        // Should NOT have AuthFlow-related blocking reasons
        const authFlowReasons = result.reasons.filter((r) => r.includes('AuthFlow'));
        (0, test_1.expect)(authFlowReasons.length).toBe(0);
    });
});
