"use strict";
/**
 * OpenModule Intent Tests
 *
 * Tests for open_module semantic intent mapping to openModule method.
 * Verifies that snake_case intent maps correctly to camelCase method name.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const page_object_registry_1 = require("../src/automations/page-object-registry");
const pom_ownership_1 = require("../src/types/pom-ownership");
test_1.test.describe("OpenModule Intent Mapping", () => {
    (0, test_1.test)("METHOD_INTENT_NAME_MAP maps open_module to openModule", () => {
        (0, test_1.expect)(pom_ownership_1.METHOD_INTENT_NAME_MAP["open_module"]).toBe("openModule");
    });
    (0, test_1.test)("INTENT_PREFERRED_OWNER assigns open_module to OperationsMenuPage", () => {
        (0, test_1.expect)(pom_ownership_1.INTENT_PREFERRED_OWNER["open_module"]).toBe("OperationsMenuPage");
    });
    (0, test_1.test)("INTENT_CLASS_OWNERSHIP allows open_module in correct pages", () => {
        const { INTENT_CLASS_OWNERSHIP } = require("../src/types/pom-ownership");
        const allowedClasses = INTENT_CLASS_OWNERSHIP["open_module"];
        (0, test_1.expect)(allowedClasses).toBeDefined();
        (0, test_1.expect)(allowedClasses).toContain("OperationsMenuPage");
        (0, test_1.expect)(allowedClasses).toContain("MainMenuPage");
        (0, test_1.expect)(allowedClasses).toContain("HomePage");
        (0, test_1.expect)(allowedClasses).toContain("DashboardPage");
        // ProductListPage should NOT be an owner for open_module
        (0, test_1.expect)(allowedClasses).not.toContain("ProductListPage");
    });
    (0, test_1.test)("findMethodBySemanticIntent finds openModule by intent", () => {
        const registry = {
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
                        }
                    ]
                }
            ],
            componentCandidates: [],
            updatedAt: new Date().toISOString()
        };
        const result = (0, page_object_registry_1.findMethodBySemanticIntent)(registry, "open_module");
        (0, test_1.expect)(result).toBeDefined();
        (0, test_1.expect)(result?.pageObject.className).toBe("OperationsMenuPage");
        (0, test_1.expect)(result?.method.name).toBe("openModule");
        (0, test_1.expect)(result?.method.intent).toBe("open_module");
    });
    (0, test_1.test)("findMethodBySemanticIntent finds openModule by method name fallback", () => {
        // Test case where intent metadata is missing but method name exists
        const registry = {
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
                        }
                    ]
                }
            ],
            componentCandidates: [],
            updatedAt: new Date().toISOString()
        };
        const result = (0, page_object_registry_1.findMethodBySemanticIntent)(registry, "open_module");
        // Should find by method name fallback
        (0, test_1.expect)(result).toBeDefined();
        (0, test_1.expect)(result?.pageObject.className).toBe("HomePage");
        (0, test_1.expect)(result?.method.name).toBe("openModule");
    });
    (0, test_1.test)("open_module is not confused with open_home", () => {
        (0, test_1.expect)(pom_ownership_1.METHOD_INTENT_NAME_MAP["open_home"]).toBe("open");
        (0, test_1.expect)(pom_ownership_1.METHOD_INTENT_NAME_MAP["open_module"]).toBe("openModule");
        (0, test_1.expect)(pom_ownership_1.METHOD_INTENT_NAME_MAP["open_home"]).not.toBe(pom_ownership_1.METHOD_INTENT_NAME_MAP["open_module"]);
    });
    (0, test_1.test)("CLASS_SPECIFIC_METHODS does NOT include openModule for ProductListPage", () => {
        const { CLASS_SPECIFIC_METHODS } = require("../src/types/pom-ownership");
        const productListMethods = CLASS_SPECIFIC_METHODS["ProductListPage"];
        (0, test_1.expect)(productListMethods).toBeDefined();
        const openModuleMethod = productListMethods.find((m) => m.name === "openModule");
        // openModule should NOT be in ProductListPage
        (0, test_1.expect)(openModuleMethod).toBeUndefined();
        // Verify selectProduct is still there
        const selectProductMethod = productListMethods.find((m) => m.name === "selectProduct");
        (0, test_1.expect)(selectProductMethod).toBeDefined();
        (0, test_1.expect)(selectProductMethod.intent).toBe("select_product");
    });
    (0, test_1.test)("CLASS_SPECIFIC_METHODS includes openModule for OperationsMenuPage and MainMenuPage", () => {
        const { CLASS_SPECIFIC_METHODS } = require("../src/types/pom-ownership");
        const operationsMenuMethods = CLASS_SPECIFIC_METHODS["OperationsMenuPage"];
        (0, test_1.expect)(operationsMenuMethods).toBeDefined();
        (0, test_1.expect)(operationsMenuMethods.some((m) => m.name === "openModule")).toBe(true);
        const mainMenuMethods = CLASS_SPECIFIC_METHODS["MainMenuPage"];
        (0, test_1.expect)(mainMenuMethods).toBeDefined();
        (0, test_1.expect)(mainMenuMethods.some((m) => m.name === "openModule")).toBe(true);
    });
    (0, test_1.test)("CLASS_SPECIFIC_METHODS includes openModule for MainMenuPage and OperationsMenuPage", () => {
        const { CLASS_SPECIFIC_METHODS } = require("../src/types/pom-ownership");
        const mainMenuMethods = CLASS_SPECIFIC_METHODS["MainMenuPage"];
        (0, test_1.expect)(mainMenuMethods).toBeDefined();
        (0, test_1.expect)(mainMenuMethods.some((m) => m.name === "openModule")).toBe(true);
        const operationsMenuMethods = CLASS_SPECIFIC_METHODS["OperationsMenuPage"];
        (0, test_1.expect)(operationsMenuMethods).toBeDefined();
        (0, test_1.expect)(operationsMenuMethods.some((m) => m.name === "openModule")).toBe(true);
    });
});
test_1.test.describe("Semantic Intent to Method Name Mapping", () => {
    (0, test_1.test)("all snake_case intents map to camelCase methods", () => {
        const mappings = pom_ownership_1.METHOD_INTENT_NAME_MAP;
        // Verify key mappings
        (0, test_1.expect)(mappings["select_product"]).toBe("selectProduct");
        (0, test_1.expect)(mappings["select_category"]).toBe("selectCategory");
        (0, test_1.expect)(mappings["click_primary_action"]).toBe("clickPrimaryAction");
        (0, test_1.expect)(mappings["submit_form"]).toBe("submit");
        (0, test_1.expect)(mappings["fill_form_field"]).toBe("fillField");
        (0, test_1.expect)(mappings["return_to_list"]).toBe("backToList");
        (0, test_1.expect)(mappings["open_module"]).toBe("openModule");
        (0, test_1.expect)(mappings["open_home"]).toBe("open");
        (0, test_1.expect)(mappings["start_session"]).toBe("start");
    });
    (0, test_1.test)("no snake_case intent maps to itself", () => {
        for (const [intent, methodName] of Object.entries(pom_ownership_1.METHOD_INTENT_NAME_MAP)) {
            (0, test_1.expect)(intent).not.toBe(methodName);
        }
    });
});
