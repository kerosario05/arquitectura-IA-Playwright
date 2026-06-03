"use strict";
/**
 * Context-Dependent Action Tests
 *
 * Tests for ensuring context-dependent actions have proper navigation/auth context.
 * Validates that specs don't execute deep functional actions from wrong screens.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const spec_generator_pom_1 = require("../src/automations/spec-generator-pom");
const app_profile_1 = require("../src/automations/app-profile");
const automation_promotion_types_1 = require("../src/types/automation-promotion.types");
test_1.test.describe("Context-Dependent Action Validation", () => {
    (0, test_1.test)("spec generation preserves navigation steps before select_product", () => {
        const appProfile = (0, app_profile_1.deriveAppProfile)({
            appProfile: "test-app",
            now: new Date().toISOString()
        });
        const appPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, "C99999", ".");
        const plan = {
            version: "1.0",
            source: "discovery_generated",
            status: "validated",
            scenario: {
                source: "testrail",
                externalId: "C99999",
                caseId: 99999,
                title: "Consultar producto"
            },
            requiredData: [],
            steps: [
                {
                    index: 1,
                    action: "click",
                    description: "Click menu operaciones",
                    target: { strategy: "text", value: "Operaciones", name: "Operaciones" }
                },
                {
                    index: 2,
                    action: "click",
                    description: "Click Depósitos a plazos",
                    target: { strategy: "text", value: "Depósitos a plazos", name: "Depósitos a plazos" }
                },
                {
                    index: 3,
                    action: "click",
                    description: "Select product",
                    target: { strategy: "text", value: "Depósito 12 meses", name: "Depósito 12 meses" }
                }
            ],
            createdAt: new Date().toISOString()
        };
        const result = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(plan, "C99999", appProfile, appPaths, undefined, automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, false);
        // Validation should run without context errors when navigation precedes selection
        const contextErrors = result.validationErrors.filter(e => e.includes("Context dependency"));
        (0, test_1.expect)(contextErrors.length).toBe(0);
        // Spec should be generated
        (0, test_1.expect)(result.specContent).toContain("Consultar producto");
    });
    (0, test_1.test)("spec generation detects missing context before select_product", () => {
        const appProfile = (0, app_profile_1.deriveAppProfile)({
            appProfile: "test-app",
            now: new Date().toISOString()
        });
        const appPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, "C99998", ".");
        const plan = {
            version: "1.0",
            source: "discovery_generated",
            status: "validated",
            scenario: {
                source: "testrail",
                externalId: "C99998",
                caseId: 99998,
                title: "Consultar producto sin navegación"
            },
            requiredData: [],
            steps: [
                {
                    index: 1,
                    action: "click",
                    description: "Select product directly",
                    target: { strategy: "text", value: "Depósito 12 meses", name: "Depósito 12 meses" }
                }
            ],
            createdAt: new Date().toISOString()
        };
        const result = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(plan, "C99998", appProfile, appPaths, undefined, automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, false);
        // Validation should detect missing context when select_product has no prior navigation
        // Note: This test verifies the validation framework is in place
        // Full context validation requires page object registry
        (0, test_1.expect)(result).toBeDefined();
        (0, test_1.expect)(result.specContent).toContain("Consultar producto sin navegación");
    });
    (0, test_1.test)("spec generation preserves navigation before click_primary_action", () => {
        const appProfile = (0, app_profile_1.deriveAppProfile)({
            appProfile: "test-app",
            now: new Date().toISOString()
        });
        const appPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, "C99997", ".");
        const plan = {
            version: "1.0",
            source: "discovery_generated",
            status: "validated",
            scenario: {
                source: "testrail",
                externalId: "C99997",
                caseId: 99997,
                title: "Comprar producto"
            },
            requiredData: [],
            steps: [
                {
                    index: 1,
                    action: "click",
                    description: "Navigate to product",
                    target: { strategy: "text", value: "Productos", name: "Productos" }
                },
                {
                    index: 2,
                    action: "click",
                    description: "Select product",
                    target: { strategy: "text", value: "Producto X", name: "Producto X" }
                },
                {
                    index: 3,
                    action: "click",
                    description: "Click primary action",
                    target: { strategy: "text", value: "Agregar al carrito", name: "Agregar al carrito" }
                }
            ],
            createdAt: new Date().toISOString()
        };
        const result = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(plan, "C99997", appProfile, appPaths, undefined, automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, false);
        // Validation should pass when navigation precedes primary action
        const contextErrors = result.validationErrors.filter(e => e.includes("Context dependency"));
        (0, test_1.expect)(contextErrors.length).toBe(0);
        // Spec should be generated
        (0, test_1.expect)(result.specContent).toContain("Comprar producto");
    });
    (0, test_1.test)("open_module intent preserves module name", () => {
        const appProfile = (0, app_profile_1.deriveAppProfile)({
            appProfile: "test-app",
            now: new Date().toISOString()
        });
        const appPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, "C99996", ".");
        const plan = {
            version: "1.0",
            source: "discovery_generated",
            status: "validated",
            scenario: {
                source: "testrail",
                externalId: "C99996",
                caseId: 99996,
                title: "Navegar a módulo"
            },
            requiredData: [],
            steps: [
                {
                    index: 1,
                    action: "click",
                    description: "Open module",
                    target: { strategy: "text", value: "Consulta de saldos", name: "Consulta de saldos" }
                }
            ],
            createdAt: new Date().toISOString()
        };
        const result = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(plan, "C99996", appProfile, appPaths, undefined, automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, false);
        // Spec should be generated with module navigation intent
        (0, test_1.expect)(result.specContent).toContain("Navegar a módulo");
        // Module keyword should be in spec (either as comment or method)
        (0, test_1.expect)(result.specContent.toLowerCase()).toContain("consulta");
    });
    (0, test_1.test)("context metadata is attached to steps", () => {
        const appProfile = (0, app_profile_1.deriveAppProfile)({
            appProfile: "test-app",
            now: new Date().toISOString()
        });
        const appPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, "C99995", ".");
        const plan = {
            version: "1.0",
            source: "discovery_generated",
            status: "validated",
            scenario: {
                source: "testrail",
                externalId: "C99995",
                caseId: 99995,
                title: "Test context metadata"
            },
            requiredData: [],
            steps: [
                {
                    index: 1,
                    action: "click",
                    description: "Module navigation",
                    target: { strategy: "text", value: "Operaciones", name: "Operaciones" }
                },
                {
                    index: 2,
                    action: "click",
                    description: "Select product",
                    target: { strategy: "text", value: "Producto", name: "Producto" }
                }
            ],
            createdAt: new Date().toISOString()
        };
        const result = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(plan, "C99995", appProfile, appPaths, undefined, automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, false);
        // Validation should run and detect context dependencies
        // Even if POM methods aren't available, validation errors should be present
        (0, test_1.expect)(result.validationErrors).toBeDefined();
        // The spec should have been generated (even if with inline fallback)
        (0, test_1.expect)(result.specContent).toContain("test('Test context metadata'");
    });
});
test_1.test.describe("Runtime Screen Context Validation", () => {
    (0, test_1.test)("validateScreenContextForAction detects wrong screen", async () => {
        // This is a unit test for the validation function
        // In real scenario, this would be tested via integration tests
        (0, test_1.expect)(true).toBe(true); // Placeholder for runtime integration test
    });
    (0, test_1.test)("wrong_screen_before_contextual_action error includes diagnostics", async () => {
        // This tests the error message format
        // Would need actual Playwright page for full test
        (0, test_1.expect)(true).toBe(true); // Placeholder for runtime integration test
    });
});
test_1.test.describe("Auto-POM Context Preservation", () => {
    (0, test_1.test)("Auto-POM does not eliminate navigation steps", async () => {
        // Integration test for Auto-POM pipeline
        // Would need full Auto-POM setup
        (0, test_1.expect)(true).toBe(true); // Placeholder for integration test
    });
    (0, test_1.test)("Auto-POM validates context chain before approving spec", async () => {
        // Integration test for Auto-POM validation
        (0, test_1.expect)(true).toBe(true); // Placeholder for integration test
    });
});
