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
const test_temp_dir_1 = require("./helpers/test-temp-dir");
const tmpDir = (0, test_temp_dir_1.getTestTempDir)("test-page-object-codegen");
test_1.test.beforeAll(async () => {
    await (0, test_temp_dir_1.ensureTestTempDir)("test-page-object-codegen");
});
test_1.test.afterAll(async () => {
    await (0, test_temp_dir_1.cleanTestTempDir)("test-page-object-codegen").catch(() => { });
});
function makeCandidateEntry(overrides) {
    const now = new Date().toISOString();
    return {
        id: `po_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        className: overrides.className,
        filePath: `pages/${overrides.className.replace(/Page$/, "").toLowerCase()}.page.ts`,
        screenSignature: `screen:test-${overrides.className.toLowerCase()}`,
        methods: overrides.methods ?? [],
        confidence: overrides.confidence ?? 0.5,
        status: overrides.status ?? "candidate",
        sourcePlanIds: overrides.sourcePlanIds ?? ["test-plan-1"],
        caseIds: overrides.caseIds ?? [],
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now
    };
}
(0, test_1.test)("sanitizeClassName produces valid class names", () => {
    (0, test_1.expect)((0, page_object_codegen_1.sanitizeClassName)("CategoryPage")).toBe("CategoryPage");
    (0, test_1.expect)((0, page_object_codegen_1.sanitizeClassName)("Product List Page")).toBe("ProductListPage");
    (0, test_1.expect)((0, page_object_codegen_1.sanitizeClassName)("")).toBe("GenericPage");
    (0, test_1.expect)((0, page_object_codegen_1.sanitizeClassName)("123")).toBe("123");
});
(0, test_1.test)("sanitizeMethodName produces valid method names", () => {
    (0, test_1.expect)((0, page_object_codegen_1.sanitizeMethodName)("selectCategory")).toBe("selectCategory");
    (0, test_1.expect)((0, page_object_codegen_1.sanitizeMethodName)("Select Category")).toBe("selectCategory");
    (0, test_1.expect)((0, page_object_codegen_1.sanitizeMethodName)("")).toBe("executeAction");
});
(0, test_1.test)("buildPageObjectClassSource generates valid TypeScript for CategoryPage", () => {
    const candidate = makeCandidateEntry({
        className: "CategoryPage",
        methods: [
            {
                name: "selectCategory",
                intent: "select_category",
                parameters: ["categoryName"],
                available: false,
                source: "test",
                sensitive: false,
                confidence: 0.5,
                status: "candidate"
            }
        ]
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).toContain("import { Page, expect } from '@playwright/test';");
    (0, test_1.expect)(source).toContain("export class CategoryPage");
    (0, test_1.expect)(source).toContain("constructor(private readonly page: Page)");
    (0, test_1.expect)(source).toContain("async selectCategory(categoryName: string): Promise<void>");
    (0, test_1.expect)(source).toContain("categoryName");
    (0, test_1.expect)(source).not.toContain("Tarjetas");
    (0, test_1.expect)(source).not.toContain("Visa");
});
(0, test_1.test)("buildPageObjectClassSource generates ProductListPage with selectProduct", () => {
    const candidate = makeCandidateEntry({
        className: "ProductListPage",
        methods: [
            {
                name: "selectProduct",
                intent: "select_product",
                parameters: ["productName"],
                available: false,
                source: "test",
                sensitive: false,
                confidence: 0.5,
                status: "candidate"
            }
        ]
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).toContain("export class ProductListPage");
    (0, test_1.expect)(source).toContain("async selectProduct(productName: string): Promise<void>");
    (0, test_1.expect)(source).not.toContain("Visa Gold");
    (0, test_1.expect)(source).not.toContain("Tarjeta de Credito");
});
(0, test_1.test)("buildPageObjectClassSource does not hardcode case-specific values", () => {
    const candidate = makeCandidateEntry({
        className: "CategoryPage",
        methods: [
            {
                name: "selectCategory",
                intent: "select_category",
                parameters: ["categoryName"],
                available: false,
                source: "test",
                sensitive: false,
                confidence: 0.5,
                status: "candidate"
            }
        ]
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).not.toContain("Tarjetas");
    (0, test_1.expect)(source).not.toContain("Prestamos");
    (0, test_1.expect)(source).not.toContain("Cuentas");
    (0, test_1.expect)(source).not.toContain("Visa");
});
(0, test_1.test)("genera CategoryPage candidate file con selectCategory(categoryName)", async () => {
    const appSlug = "test-codegen-category";
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
    const result = await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        overwriteCandidates: true
    });
    (0, test_1.expect)(result.generated).toBe(1);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    const candidateFile = node_path_1.default.join(pagesDir, "category.page.candidate.ts");
    await (0, test_1.expect)(promises_1.default.access(candidateFile)).resolves.toBeUndefined();
    const content = await promises_1.default.readFile(candidateFile, "utf-8");
    (0, test_1.expect)(content).toContain("export class CategoryPage");
    (0, test_1.expect)(content).toContain("async selectCategory(categoryName: string): Promise<void>");
    (0, test_1.expect)(content).not.toContain("Tarjetas");
});
(0, test_1.test)("genera ProductListPage candidate file con selectProduct(productName)", async () => {
    const appSlug = "test-codegen-product";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "ProductList",
        className: "ProductListPage",
        screenSignature: `screen:${appSlug}-productlist`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "selectProduct", intent: "select_product" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const result = await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        overwriteCandidates: true
    });
    (0, test_1.expect)(result.generated).toBe(1);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    const candidateFile = node_path_1.default.join(pagesDir, "productlist.page.candidate.ts");
    await (0, test_1.expect)(promises_1.default.access(candidateFile)).resolves.toBeUndefined();
    const content = await promises_1.default.readFile(candidateFile, "utf-8");
    (0, test_1.expect)(content).toContain("export class ProductListPage");
    (0, test_1.expect)(content).toContain("async selectProduct(productName: string): Promise<void>");
});
(0, test_1.test)("no sobrescribe .candidate.ts sin --overwrite-candidates", async () => {
    const appSlug = "test-codegen-nodup";
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
        overwriteCandidates: false
    });
    (0, test_1.expect)(result2.skipped).toBe(1);
    (0, test_1.expect)(result2.generated).toBe(0);
});
(0, test_1.test)("dry-run no escribe archivos", async () => {
    const appSlug = "test-codegen-dryrun";
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
    const result = await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        dryRun: true,
        overwriteCandidates: true
    });
    (0, test_1.expect)(result.generated).toBe(0);
    (0, test_1.expect)(result.skipped).toBe(1);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    const candidateFile = node_path_1.default.join(pagesDir, "category.page.candidate.ts");
    await (0, test_1.expect)(promises_1.default.access(candidateFile)).rejects.toThrow();
});
(0, test_1.test)("actualiza metadata de registry tras generar", async () => {
    const appSlug = "test-codegen-metadata";
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
    await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        overwriteCandidates: true
    });
    const updatedRegistry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug }, tmpDir);
    const categoryPO = updatedRegistry.pageObjects.find((po) => po.className === "CategoryPage");
    (0, test_1.expect)(categoryPO).toBeDefined();
    const codegenMeta = categoryPO.codegenMetadata;
    (0, test_1.expect)(codegenMeta).toBeDefined();
    (0, test_1.expect)(codegenMeta.generatedBy).toBe("page-object-codegen");
    (0, test_1.expect)(codegenMeta.generatedAt).toBeDefined();
    (0, test_1.expect)(codegenMeta.candidateFilePath).toContain("category.page.candidate.ts");
});
(0, test_1.test)("genera TypeScript valido", async () => {
    const appSlug = "test-codegen-valid";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "HomePage",
        className: "HomePage",
        screenSignature: `screen:${appSlug}-home`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [
            { name: "start", intent: "start_session" },
            { name: "open", intent: "open_home" }
        ]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        overwriteCandidates: true
    });
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    const candidateFile = node_path_1.default.join(pagesDir, "home.page.candidate.ts");
    const content = await promises_1.default.readFile(candidateFile, "utf-8");
    (0, test_1.expect)(content).toContain("import { Page, expect } from '@playwright/test';");
    (0, test_1.expect)(content).toContain("export class HomePage");
    (0, test_1.expect)(content).toContain("constructor(private readonly page: Page)");
    (0, test_1.expect)(content).toContain("async start(): Promise<void>");
    (0, test_1.expect)(content).toContain("async open(): Promise<void>");
    (0, test_1.expect)(content).not.toContain("any");
    (0, test_1.expect)(content).not.toContain("eval(");
});
(0, test_1.test)("solo genera candidate especifico con --only", async () => {
    const appSlug = "test-codegen-only";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "Category",
        className: "CategoryPage",
        screenSignature: `screen:${appSlug}-category`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "selectCategory", intent: "select_category" }]
    });
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "ProductList",
        className: "ProductListPage",
        screenSignature: `screen:${appSlug}-productlist`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [{ name: "selectProduct", intent: "select_product" }]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const result = await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        onlyClassName: "CategoryPage",
        overwriteCandidates: true
    });
    (0, test_1.expect)(result.generated).toBe(1);
    (0, test_1.expect)(result.files.some((f) => f.className === "CategoryPage")).toBe(true);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    const categoryFile = node_path_1.default.join(pagesDir, "category.page.candidate.ts");
    const productListFile = node_path_1.default.join(pagesDir, "productlist.page.candidate.ts");
    await (0, test_1.expect)(promises_1.default.access(categoryFile)).resolves.toBeUndefined();
    await (0, test_1.expect)(promises_1.default.access(productListFile)).rejects.toThrow();
});
(0, test_1.test)("metodo sin template genera TODO comentado", () => {
    const candidate = makeCandidateEntry({
        className: "CustomPage",
        methods: [
            {
                name: "customAction",
                intent: "unknown_intent",
                parameters: [],
                available: false,
                source: "test",
                sensitive: false,
                confidence: 0.5,
                status: "candidate"
            }
        ]
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).toContain("// TODO: Implement customAction");
    (0, test_1.expect)(source).toContain("throw new Error('Not implemented: customAction');");
});
(0, test_1.test)("ProductDetailPage nunca genera selectProduct", () => {
    const candidate = makeCandidateEntry({
        className: "ProductDetailPage",
        methods: [
            {
                name: "selectProduct",
                intent: "select_product",
                parameters: ["productName"],
                available: false,
                source: "test",
                sensitive: false,
                confidence: 0.5,
                status: "candidate"
            }
        ]
    });
    const { source, warnings } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).not.toContain("selectProduct");
    (0, test_1.expect)(warnings.some((w) => w.includes("select_product") && w.includes("ProductDetailPage"))).toBe(true);
});
(0, test_1.test)("ProductDetailPage genera expectLoaded cuando intent expect_loaded existe", () => {
    const candidate = makeCandidateEntry({
        className: "ProductDetailPage",
        methods: [
            {
                name: "expectLoaded",
                intent: "expect_loaded",
                parameters: [],
                available: false,
                source: "test",
                sensitive: false,
                confidence: 0.5,
                status: "candidate"
            }
        ]
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).toContain("async expectLoaded(): Promise<void>");
    (0, test_1.expect)(source).toContain("expect(");
});
(0, test_1.test)("ProductListPage nunca genera start", () => {
    const candidate = makeCandidateEntry({
        className: "ProductListPage",
        methods: [
            {
                name: "start",
                intent: "start_session",
                parameters: [],
                available: false,
                source: "test",
                sensitive: false,
                confidence: 0.5,
                status: "candidate"
            }
        ]
    });
    const { source, warnings } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).not.toContain("async start()");
    (0, test_1.expect)(warnings.some((w) => w.includes("start_session") && w.includes("ProductListPage"))).toBe(true);
});
(0, test_1.test)("HomePage genera start", () => {
    const candidate = makeCandidateEntry({
        className: "HomePage",
        methods: [
            {
                name: "start",
                intent: "start_session",
                parameters: [],
                available: false,
                source: "test",
                sensitive: false,
                confidence: 0.5,
                status: "candidate"
            }
        ]
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).toContain("async start(): Promise<void>");
});
(0, test_1.test)("select_product siempre genera ProductListPage.selectProduct(productName)", () => {
    const candidate = makeCandidateEntry({
        className: "ProductListPage",
        methods: [
            {
                name: "selectProduct",
                intent: "select_product",
                parameters: ["productName"],
                available: false,
                source: "test",
                sensitive: false,
                confidence: 0.5,
                status: "candidate"
            }
        ]
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).toContain("export class ProductListPage");
    (0, test_1.expect)(source).toContain("async selectProduct(productName: string): Promise<void>");
});
(0, test_1.test)("start_session siempre genera HomePage.start()", () => {
    const candidate = makeCandidateEntry({
        className: "HomePage",
        methods: [
            {
                name: "start",
                intent: "start_session",
                parameters: [],
                available: false,
                source: "test",
                sensitive: false,
                confidence: 0.5,
                status: "candidate"
            }
        ]
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).toContain("export class HomePage");
    (0, test_1.expect)(source).toContain("async start(): Promise<void>");
});
(0, test_1.test)("category select sigue generando CategoryPage.selectCategory(categoryName)", () => {
    const candidate = makeCandidateEntry({
        className: "CategoryPage",
        methods: [
            {
                name: "selectCategory",
                intent: "select_category",
                parameters: ["categoryName"],
                available: false,
                source: "test",
                sensitive: false,
                confidence: 0.5,
                status: "candidate"
            }
        ]
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).toContain("export class CategoryPage");
    (0, test_1.expect)(source).toContain("async selectCategory(categoryName: string): Promise<void>");
});
(0, test_1.test)("ProductDetailPage sin methods genera expectLoaded por defecto", () => {
    const candidate = makeCandidateEntry({
        className: "ProductDetailPage",
        methods: []
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).toContain("async expectLoaded(): Promise<void>");
});
(0, test_1.test)("ProductListPage sin methods genera selectProduct por defecto", () => {
    const candidate = makeCandidateEntry({
        className: "ProductListPage",
        methods: []
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).toContain("async selectProduct(productName: string): Promise<void>");
});
(0, test_1.test)("HomePage sin methods genera start por defecto", () => {
    const candidate = makeCandidateEntry({
        className: "HomePage",
        methods: []
    });
    const { source } = (0, page_object_codegen_1.buildPageObjectClassSource)(candidate);
    (0, test_1.expect)(source).toContain("async start(): Promise<void>");
});
(0, test_1.test)("genera ProductDetailPage con expectLoaded y no selectProduct", async () => {
    const appSlug = "test-codegen-detail";
    const registry = await (0, page_object_registry_1.ensurePageObjectRegistry)({ appSlug }, tmpDir);
    (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "ProductDetail",
        className: "ProductDetailPage",
        screenSignature: `screen:${appSlug}-productdetail`,
        confidence: 0.5,
        sourcePlanId: "test-plan-1",
        methods: [
            { name: "expectLoaded", intent: "expect_loaded" },
            { name: "selectProduct", intent: "select_product" }
        ]
    });
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const result = await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        overwriteCandidates: true
    });
    (0, test_1.expect)(result.generated).toBe(1);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    const candidateFile = node_path_1.default.join(pagesDir, "productdetail.page.candidate.ts");
    const content = await promises_1.default.readFile(candidateFile, "utf-8");
    (0, test_1.expect)(content).toContain("export class ProductDetailPage");
    (0, test_1.expect)(content).toContain("async expectLoaded(): Promise<void>");
    (0, test_1.expect)(content).not.toContain("selectProduct");
    (0, test_1.expect)(result.warnings.some((w) => w.includes("select_product"))).toBe(true);
});
(0, test_1.test)("genera HomePage con start y ProductListPage con selectProduct", async () => {
    const appSlug = "test-codegen-multi";
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
    await (0, page_object_registry_1.savePageObjectRegistry)(registry, { appSlug }, tmpDir);
    const result = await (0, page_object_codegen_1.generatePageObjectCandidateFiles)({
        appSlug,
        outputRoot: tmpDir,
        overwriteCandidates: true
    });
    (0, test_1.expect)(result.generated).toBe(2);
    const pagesDir = node_path_1.default.join(tmpDir, "automations", "apps", appSlug, "pages");
    const homeFile = node_path_1.default.join(pagesDir, "home.page.candidate.ts");
    const productListFile = node_path_1.default.join(pagesDir, "productlist.page.candidate.ts");
    const homeContent = await promises_1.default.readFile(homeFile, "utf-8");
    (0, test_1.expect)(homeContent).toContain("async start(): Promise<void>");
    (0, test_1.expect)(homeContent).not.toContain("selectProduct");
    const productListContent = await promises_1.default.readFile(productListFile, "utf-8");
    (0, test_1.expect)(productListContent).toContain("async selectProduct(productName: string): Promise<void>");
    (0, test_1.expect)(productListContent).not.toContain("async start()");
});
