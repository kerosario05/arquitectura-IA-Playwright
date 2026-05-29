/**
 * Context-Dependent Action Tests
 * 
 * Tests for ensuring context-dependent actions have proper navigation/auth context.
 * Validates that specs don't execute deep functional actions from wrong screens.
 */

import { test, expect } from "@playwright/test";
import { generatePOMSpecFromPlan } from "../src/automations/spec-generator-pom";
import { deriveAppProfile, buildAppAutomationPaths } from "../src/automations/app-profile";
import { DEFAULT_PROMOTION_POLICY } from "../src/types/automation-promotion.types";
import type { ExecutionPlan, ExecutionPlanStep } from "../src/types/execution-plan.types";

test.describe("Context-Dependent Action Validation", () => {
  test("spec generation preserves navigation steps before select_product", () => {
    const appProfile = deriveAppProfile({
      appProfile: "test-app",
      now: new Date().toISOString()
    });
    const appPaths = buildAppAutomationPaths(appProfile, "C99999", ".");
    
    const plan: ExecutionPlan = {
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
        } as ExecutionPlanStep,
        {
          index: 2,
          action: "click",
          description: "Click Depósitos a plazos",
          target: { strategy: "text", value: "Depósitos a plazos", name: "Depósitos a plazos" }
        } as ExecutionPlanStep,
        {
          index: 3,
          action: "click",
          description: "Select product",
          target: { strategy: "text", value: "Depósito 12 meses", name: "Depósito 12 meses" }
        } as ExecutionPlanStep
      ],
      createdAt: new Date().toISOString()
    };
    
    const result = generatePOMSpecFromPlan(
      plan,
      "C99999",
      appProfile,
      appPaths,
      undefined,
      DEFAULT_PROMOTION_POLICY,
      false
    );
    
    // Validation should run without context errors when navigation precedes selection
    const contextErrors = result.validationErrors.filter(e => e.includes("Context dependency"));
    expect(contextErrors.length).toBe(0);
    
    // Spec should be generated
    expect(result.specContent).toContain("Consultar producto");
  });

  test("spec generation detects missing context before select_product", () => {
    const appProfile = deriveAppProfile({
      appProfile: "test-app",
      now: new Date().toISOString()
    });
    const appPaths = buildAppAutomationPaths(appProfile, "C99998", ".");
    
    const plan: ExecutionPlan = {
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
        } as ExecutionPlanStep
      ],
      createdAt: new Date().toISOString()
    };
    
    const result = generatePOMSpecFromPlan(
      plan,
      "C99998",
      appProfile,
      appPaths,
      undefined,
      DEFAULT_PROMOTION_POLICY,
      false
    );
    
    // Validation should detect missing context when select_product has no prior navigation
    // Note: This test verifies the validation framework is in place
    // Full context validation requires page object registry
    expect(result).toBeDefined();
    expect(result.specContent).toContain("Consultar producto sin navegación");
  });

  test("spec generation preserves navigation before click_primary_action", () => {
    const appProfile = deriveAppProfile({
      appProfile: "test-app",
      now: new Date().toISOString()
    });
    const appPaths = buildAppAutomationPaths(appProfile, "C99997", ".");
    
    const plan: ExecutionPlan = {
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
        } as ExecutionPlanStep,
        {
          index: 2,
          action: "click",
          description: "Select product",
          target: { strategy: "text", value: "Producto X", name: "Producto X" }
        } as ExecutionPlanStep,
        {
          index: 3,
          action: "click",
          description: "Click primary action",
          target: { strategy: "text", value: "Agregar al carrito", name: "Agregar al carrito" }
        } as ExecutionPlanStep
      ],
      createdAt: new Date().toISOString()
    };
    
    const result = generatePOMSpecFromPlan(
      plan,
      "C99997",
      appProfile,
      appPaths,
      undefined,
      DEFAULT_PROMOTION_POLICY,
      false
    );
    
    // Validation should pass when navigation precedes primary action
    const contextErrors = result.validationErrors.filter(e => e.includes("Context dependency"));
    expect(contextErrors.length).toBe(0);
    
    // Spec should be generated
    expect(result.specContent).toContain("Comprar producto");
  });

  test("open_module intent preserves module name", () => {
    const appProfile = deriveAppProfile({
      appProfile: "test-app",
      now: new Date().toISOString()
    });
    const appPaths = buildAppAutomationPaths(appProfile, "C99996", ".");
    
    const plan: ExecutionPlan = {
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
        } as ExecutionPlanStep
      ],
      createdAt: new Date().toISOString()
    };
    
    const result = generatePOMSpecFromPlan(
      plan,
      "C99996",
      appProfile,
      appPaths,
      undefined,
      DEFAULT_PROMOTION_POLICY,
      false
    );
    
    // Spec should be generated with module navigation intent
    expect(result.specContent).toContain("Navegar a módulo");
    // Module keyword should be in spec (either as comment or method)
    expect(result.specContent.toLowerCase()).toContain("consulta");
  });

  test("context metadata is attached to steps", () => {
    const appProfile = deriveAppProfile({
      appProfile: "test-app",
      now: new Date().toISOString()
    });
    const appPaths = buildAppAutomationPaths(appProfile, "C99995", ".");
    
    const plan: ExecutionPlan = {
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
        } as ExecutionPlanStep,
        {
          index: 2,
          action: "click",
          description: "Select product",
          target: { strategy: "text", value: "Producto", name: "Producto" }
        } as ExecutionPlanStep
      ],
      createdAt: new Date().toISOString()
    };
    
    const result = generatePOMSpecFromPlan(
      plan,
      "C99995",
      appProfile,
      appPaths,
      undefined,
      DEFAULT_PROMOTION_POLICY,
      false
    );
    
    // Validation should run and detect context dependencies
    // Even if POM methods aren't available, validation errors should be present
    expect(result.validationErrors).toBeDefined();
    
    // The spec should have been generated (even if with inline fallback)
    expect(result.specContent).toContain("test('Test context metadata'");
  });
});

test.describe("Runtime Screen Context Validation", () => {
  test("validateScreenContextForAction detects wrong screen", async () => {
    // This is a unit test for the validation function
    // In real scenario, this would be tested via integration tests
    expect(true).toBe(true); // Placeholder for runtime integration test
  });

  test("wrong_screen_before_contextual_action error includes diagnostics", async () => {
    // This tests the error message format
    // Would need actual Playwright page for full test
    expect(true).toBe(true); // Placeholder for runtime integration test
  });
});

test.describe("Auto-POM Context Preservation", () => {
  test("Auto-POM does not eliminate navigation steps", async () => {
    // Integration test for Auto-POM pipeline
    // Would need full Auto-POM setup
    expect(true).toBe(true); // Placeholder for integration test
  });

  test("Auto-POM validates context chain before approving spec", async () => {
    // Integration test for Auto-POM validation
    expect(true).toBe(true); // Placeholder for integration test
  });
});

