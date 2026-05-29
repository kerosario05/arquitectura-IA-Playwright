/**
 * OpenModule Intent Tests
 * 
 * Tests for open_module semantic intent mapping to openModule method.
 * Verifies that snake_case intent maps correctly to camelCase method name.
 */

import { test, expect } from "@playwright/test";
import { findMethodBySemanticIntent } from "../src/automations/page-object-registry";
import { METHOD_INTENT_NAME_MAP, INTENT_PREFERRED_OWNER, INTENT_CLASS_OWNERSHIP } from "../src/types/pom-ownership";
import type { PageObjectRegistry, PageObjectEntry, PageObjectMethod } from "../src/types/page-object.types";

test.describe("OpenModule Intent Mapping", () => {
  test("METHOD_INTENT_NAME_MAP maps open_module to openModule", () => {
    expect(METHOD_INTENT_NAME_MAP["open_module"]).toBe("openModule");
  });

  test("INTENT_PREFERRED_OWNER assigns open_module to OperationsMenuPage", () => {
    expect(INTENT_PREFERRED_OWNER["open_module"]).toBe("OperationsMenuPage");
  });

  test("INTENT_CLASS_OWNERSHIP allows open_module in correct pages", () => {
    const { INTENT_CLASS_OWNERSHIP } = require("../src/types/pom-ownership");
    const allowedClasses = INTENT_CLASS_OWNERSHIP["open_module"];
    expect(allowedClasses).toBeDefined();
    expect(allowedClasses).toContain("OperationsMenuPage");
    expect(allowedClasses).toContain("MainMenuPage");
    expect(allowedClasses).toContain("HomePage");
    expect(allowedClasses).toContain("DashboardPage");
    // ProductListPage should NOT be an owner for open_module
    expect(allowedClasses).not.toContain("ProductListPage");
  });

  test("findMethodBySemanticIntent finds openModule by intent", () => {
    const registry: PageObjectRegistry = {
      version: "1.0",
      appSlug: "test-app",
      pageObjects: [
        {
          id: "po_test_operations",
          className: "OperationsMenuPage",
          filePath: "pages/operations-menu.page.ts",
          screenSignature: "screen:test-operations_menu",
          status: "active",
          confidence: 1.0,
          sourcePlanIds: [],
          caseIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          methods: [
            {
              name: "openModule",
              intent: "open_module",
              parameters: ["moduleName"],
              available: true,
              status: "active",
              sensitive: false,
              confidence: 1.0,
              source: "framework"
            } as PageObjectMethod
          ]
        } as PageObjectEntry
      ],
      componentCandidates: [],
      updatedAt: new Date().toISOString()
    };

    const result = findMethodBySemanticIntent(registry, "open_module");
    
    expect(result).toBeDefined();
    expect(result?.pageObject.className).toBe("OperationsMenuPage");
    expect(result?.method.name).toBe("openModule");
    expect(result?.method.intent).toBe("open_module");
  });

  test("findMethodBySemanticIntent finds openModule by method name fallback", () => {
    // Test case where intent metadata is missing but method name exists
    const registry: PageObjectRegistry = {
      version: "1.0",
      appSlug: "test-app",
      pageObjects: [
        {
          id: "po_test_home",
          className: "HomePage",
          filePath: "pages/home.page.ts",
          screenSignature: "screen:test-home",
          status: "active",
          confidence: 1.0,
          sourcePlanIds: [],
          caseIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          methods: [
            {
              name: "openModule",
              intent: "unknown", // Wrong intent but correct name
              parameters: ["moduleName"],
              available: true,
              status: "active",
              sensitive: false,
              confidence: 1.0,
              source: "manual"
            } as PageObjectMethod
          ]
        } as PageObjectEntry
      ],
      componentCandidates: [],
      updatedAt: new Date().toISOString()
    };

    const result = findMethodBySemanticIntent(registry, "open_module");
    
    // Should find by method name fallback
    expect(result).toBeDefined();
    expect(result?.pageObject.className).toBe("HomePage");
    expect(result?.method.name).toBe("openModule");
  });

  test("open_module is not confused with open_home", () => {
    expect(METHOD_INTENT_NAME_MAP["open_home"]).toBe("open");
    expect(METHOD_INTENT_NAME_MAP["open_module"]).toBe("openModule");
    expect(METHOD_INTENT_NAME_MAP["open_home"]).not.toBe(METHOD_INTENT_NAME_MAP["open_module"]);
  });

  test("CLASS_SPECIFIC_METHODS does NOT include openModule for ProductListPage", () => {
    const { CLASS_SPECIFIC_METHODS } = require("../src/types/pom-ownership");
    const productListMethods = CLASS_SPECIFIC_METHODS["ProductListPage"];
    
    expect(productListMethods).toBeDefined();
    const openModuleMethod = productListMethods.find((m: any) => m.name === "openModule");
    // openModule should NOT be in ProductListPage
    expect(openModuleMethod).toBeUndefined();
    
    // Verify selectProduct is still there
    const selectProductMethod = productListMethods.find((m: any) => m.name === "selectProduct");
    expect(selectProductMethod).toBeDefined();
    expect(selectProductMethod.intent).toBe("select_product");
  });

  test("CLASS_SPECIFIC_METHODS includes openModule for OperationsMenuPage and MainMenuPage", () => {
    const { CLASS_SPECIFIC_METHODS } = require("../src/types/pom-ownership");
    
    const operationsMenuMethods = CLASS_SPECIFIC_METHODS["OperationsMenuPage"];
    expect(operationsMenuMethods).toBeDefined();
    expect(operationsMenuMethods.some((m: any) => m.name === "openModule")).toBe(true);
    
    const mainMenuMethods = CLASS_SPECIFIC_METHODS["MainMenuPage"];
    expect(mainMenuMethods).toBeDefined();
    expect(mainMenuMethods.some((m: any) => m.name === "openModule")).toBe(true);
  });

  test("CLASS_SPECIFIC_METHODS includes openModule for MainMenuPage and OperationsMenuPage", () => {
    const { CLASS_SPECIFIC_METHODS } = require("../src/types/pom-ownership");
    
    const mainMenuMethods = CLASS_SPECIFIC_METHODS["MainMenuPage"];
    expect(mainMenuMethods).toBeDefined();
    expect(mainMenuMethods.some((m: any) => m.name === "openModule")).toBe(true);
    
    const operationsMenuMethods = CLASS_SPECIFIC_METHODS["OperationsMenuPage"];
    expect(operationsMenuMethods).toBeDefined();
    expect(operationsMenuMethods.some((m: any) => m.name === "openModule")).toBe(true);
  });
});

test.describe("Semantic Intent to Method Name Mapping", () => {
  test("all snake_case intents map to camelCase methods", () => {
    const mappings = METHOD_INTENT_NAME_MAP;
    
    // Verify key mappings
    expect(mappings["select_product"]).toBe("selectProduct");
    expect(mappings["select_category"]).toBe("selectCategory");
    expect(mappings["click_primary_action"]).toBe("clickPrimaryAction");
    expect(mappings["submit_form"]).toBe("submit");
    expect(mappings["fill_form_field"]).toBe("fillField");
    expect(mappings["return_to_list"]).toBe("backToList");
    expect(mappings["open_module"]).toBe("openModule");
    expect(mappings["open_home"]).toBe("open");
    expect(mappings["start_session"]).toBe("start");
  });

  test("no snake_case intent maps to itself", () => {
    for (const [intent, methodName] of Object.entries(METHOD_INTENT_NAME_MAP)) {
      expect(intent).not.toBe(methodName);
    }
  });
});
