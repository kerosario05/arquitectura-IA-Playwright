"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const page_object_codegen_1 = require("../src/automations/page-object-codegen");
const page_object_registry_1 = require("../src/automations/page-object-registry");
const pom_ownership_1 = require("../src/types/pom-ownership");
const test_temp_dir_1 = require("./helpers/test-temp-dir");
const tmpDir = (0, test_temp_dir_1.getTestTempDir)("test-pom-ownership");
test_1.test.beforeAll(async () => {
    await (0, test_temp_dir_1.ensureTestTempDir)("test-pom-ownership");
});
test_1.test.afterAll(async () => {
    await (0, test_temp_dir_1.cleanTestTempDir)("test-pom-ownership").catch(() => { });
});
(0, test_1.test)("start_session preferred owner es HomePage", () => {
    (0, test_1.expect)(pom_ownership_1.INTENT_PREFERRED_OWNER["start_session"]).toBe("HomePage");
});
(0, test_1.test)("select_product preferred owner es ProductListPage", () => {
    (0, test_1.expect)(pom_ownership_1.INTENT_PREFERRED_OWNER["select_product"]).toBe("ProductListPage");
});
(0, test_1.test)("expect_loaded preferred owner es ProductDetailPage", () => {
    (0, test_1.expect)(pom_ownership_1.INTENT_PREFERRED_OWNER["expect_loaded"]).toBe("ProductDetailPage");
});
(0, test_1.test)("open_product_information preferred owner es ProductInformationPage", () => {
    (0, test_1.expect)(pom_ownership_1.INTENT_PREFERRED_OWNER["open_product_information"]).toBe("ProductInformationPage");
});
(0, test_1.test)("select_category preferred owner es CategoryPage", () => {
    (0, test_1.expect)(pom_ownership_1.INTENT_PREFERRED_OWNER["select_category"]).toBe("CategoryPage");
});
(0, test_1.test)("start_session solo permite HomePage y LoginPage", () => {
    (0, test_1.expect)(pom_ownership_1.INTENT_CLASS_OWNERSHIP["start_session"]).toContain("HomePage");
    (0, test_1.expect)(pom_ownership_1.INTENT_CLASS_OWNERSHIP["start_session"]).toContain("LoginPage");
    (0, test_1.expect)(pom_ownership_1.INTENT_CLASS_OWNERSHIP["start_session"]).not.toContain("ProductListPage");
});
(0, test_1.test)("select_product solo permite ProductListPage", () => {
    (0, test_1.expect)(pom_ownership_1.INTENT_CLASS_OWNERSHIP["select_product"]).toEqual(["ProductListPage"]);
});
(0, test_1.test)("codegen despues de registry limpio genera 0 ownership warnings", async () => {
    const appSlug = "test-ownership-clean";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "HomePage",
        className: "HomePage",
        screenSignature: `screen:${appSlug}-home`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "start", intent: "start_session" }]
    });
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "ProductList",
        className: "ProductListPage",
        screenSignature: `screen:${appSlug}-productlist`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "selectProduct", intent: "select_product" }]
    });
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "Category",
        className: "CategoryPage",
        screenSignature: `screen:${appSlug}-category`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "selectCategory", intent: "select_category" }]
    });
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "ProductDetail",
        className: "ProductDetailPage",
        screenSignature: `screen:${appSlug}-productdetail`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "expectLoaded", intent: "expect_loaded" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const result = await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        overwriteCandidates: true
    });
    (0, test_1.expect)(result.generated).toBe(4);
    const ownershipWarnings = result.warnings.filter((w) => w.includes("does not belong in") || w.includes("filtered from"));
    (0, test_1.expect)(ownershipWarnings).toHaveLength(0);
});
(0, test_1.test)("codegen con metodo mal ubicado y owner inexistente genera warning fuerte", async () => {
    const appSlug = "test-ownership-missing";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "ProductList",
        className: "ProductListPage",
        screenSignature: `screen:${appSlug}-productlist`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [
            { name: "selectProduct", intent: "select_product" },
            { name: "start", intent: "start_session" }
        ]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const result = await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        overwriteCandidates: true
    });
    (0, test_1.expect)(result.generated).toBe(1);
    const strongWarnings = result.warnings.filter((w) => w.includes("filtered from") && w.includes("no owner candidate"));
    (0, test_1.expect)(strongWarnings.length).toBeGreaterThan(0);
    (0, test_1.expect)(strongWarnings[0]).toContain("HomePage");
});
(0, test_1.test)("no duplica owners al correr dos casos", async () => {
    const appSlug = "test-ownership-nodup";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "Category",
        className: "CategoryPage",
        screenSignature: `screen:${appSlug}-category`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "selectCategory", intent: "select_category" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const result1 = await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        overwriteCandidates: true
    });
    (0, test_1.expect)(result1.generated).toBe(1);
    const result2 = await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        overwriteCandidates: true
    });
    (0, test_1.expect)(result2.generated).toBe(1);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    const files = await promises_1.default.readdir(pagesDir);
    const candidateFiles = files.filter((f) => f.endsWith(".candidate.ts"));
    (0, test_1.expect)(candidateFiles).toHaveLength(1);
    (0, test_1.expect)(candidateFiles).toContain("category.page.candidate.ts");
});
