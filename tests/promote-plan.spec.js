"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const promote_plan_1 = require("../src/automations/promote-plan");
const automation_index_1 = require("../src/automations/automation-index");
const page_object_registry_1 = require("../src/automations/page-object-registry");
const flow_registry_1 = require("../src/automations/flow-registry");
const automation_promotion_types_1 = require("../src/types/automation-promotion.types");
const test_temp_dir_1 = require("./helpers/test-temp-dir");
const tmpDir = (0, test_temp_dir_1.getTestTempDir)("test-promote");
function makePlan(overrides = {}) {
    const status = overrides.status ?? "validated";
    return {
        version: "1.0",
        source: "manual",
        status,
        scenario: {
            source: "testrail",
            externalId: overrides.externalId,
            caseId: overrides.caseId,
            title: overrides.title ?? "Generic automation"
        },
        requiredData: [],
        steps: [
            {
                index: 1,
                action: "navigate",
                target: "APP_BASE_URL"
            }
        ],
        createdAt: new Date().toISOString()
    };
}
function makeConfig(appProfile = "profile-a", baseUrl = "https://app-a.example.test") {
    return {
        app: {
            name: "Generic App",
            appProfile,
            baseUrl,
            loginMode: "password",
            username: "user-a",
            password: "pass-a",
            testData: { key1: "value1" },
            testDataAliases: { key1: ["alias1"] },
            missingInputBehavior: "fail"
        },
        execution: {
            browser: "chromium",
            headless: true,
            evidenceDir: ".artifacts/evidence",
            defaultTimeoutMs: 30000
        },
        integrations: {}
    };
}
test_1.test.beforeAll(async () => {
    await (0, test_temp_dir_1.ensureTestTempDir)("test-promote");
});
test_1.test.afterAll(async () => {
    await (0, test_temp_dir_1.cleanTestTempDir)("test-promote").catch(() => { });
});
(0, test_1.test)("promotes validated plan into app package", async () => {
    const plan = makePlan({ externalId: "C99999" });
    const entry = await (0, promote_plan_1.promoteExecutionPlan)({ plan, outputRoot: tmpDir, fullConfig: makeConfig() }, false);
    const normalizedPlanPath = entry.planPath.replace(/\\/g, "/");
    const normalizedSpecPath = entry.specPath.replace(/\\/g, "/");
    (0, test_1.expect)(entry.id).toBe("c99999-generic-automation");
    (0, test_1.expect)(entry.appSlug).toBe("profile-a");
    (0, test_1.expect)(normalizedPlanPath).toContain("automations/apps/profile-a/cases/c99999-generic-automation/plan.json");
    (0, test_1.expect)(normalizedSpecPath).toContain("automations/apps/profile-a/cases/c99999-generic-automation/case.spec.ts");
});
(0, test_1.test)("plans:promote saves app.config.json", async () => {
    const plan = makePlan({ externalId: "C10000" });
    await (0, promote_plan_1.promoteExecutionPlan)({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-b", "https://app-b.example.test") }, false);
    const configPath = node_path_1.default.join(tmpDir, "automations/apps/profile-b/app.config.json");
    const content = await promises_1.default.readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);
    (0, test_1.expect)(parsed.appProfile.appSlug).toBe("profile-b");
    (0, test_1.expect)(parsed.baseUrl).toBe("https://app-b.example.test");
});
(0, test_1.test)("creates app-specific plan and spec files", async () => {
    const plan = makePlan({ externalId: "C10001" });
    await (0, promote_plan_1.promoteExecutionPlan)({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-c") }, false);
    const planPath = node_path_1.default.join(tmpDir, "automations/apps/profile-c/cases/c10001-generic-automation/plan.json");
    const specPath = node_path_1.default.join(tmpDir, "automations/apps/profile-c/cases/c10001-generic-automation/case.spec.ts");
    const casePath = node_path_1.default.join(tmpDir, "automations/apps/profile-c/cases/c10001-generic-automation/case.json");
    const automationPath = node_path_1.default.join(tmpDir, "automations/apps/profile-c/cases/c10001-generic-automation/automation.json");
    await (0, test_1.expect)(promises_1.default.readFile(planPath, "utf-8")).resolves.toContain("\"version\": \"1.0\"");
    await (0, test_1.expect)(promises_1.default.readFile(specPath, "utf-8")).resolves.toContain("loadPromotedAppConfigSync");
    await (0, test_1.expect)(promises_1.default.readFile(casePath, "utf-8")).resolves.toContain("\"externalId\": \"C10001\"");
    await (0, test_1.expect)(promises_1.default.readFile(automationPath, "utf-8")).resolves.toContain("\"id\": \"c10001-generic-automation\"");
});
(0, test_1.test)("updates per-app index and global index references", async () => {
    const plan = makePlan({ externalId: "C10002" });
    await (0, promote_plan_1.promoteExecutionPlan)({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-d") }, false);
    const appIndex = await (0, automation_index_1.loadAutomationIndex)(node_path_1.default.join(tmpDir, "automations/apps/profile-d/index.json"));
    const globalIndex = await (0, automation_index_1.loadAutomationIndex)(node_path_1.default.join(tmpDir, "automations/index.json"));
    (0, test_1.expect)(appIndex.automations.some((a) => a.externalId === "C10002" && a.appSlug === "profile-d")).toBe(true);
    (0, test_1.expect)(globalIndex.automations.some((a) => a.externalId === "C10002" && a.appSlug === "profile-d")).toBe(true);
});
(0, test_1.test)("rejects non-promotable status", async () => {
    const plan = makePlan({ status: "needs_discovery" });
    await (0, test_1.expect)((0, promote_plan_1.promoteExecutionPlan)({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-e") }, false)).rejects.toThrow(/not eligible/i);
});
(0, test_1.test)("automation existing + overwrite=false throws error", async () => {
    const plan = makePlan({ externalId: "C20001", title: "Overwrite test false" });
    await (0, promote_plan_1.promoteExecutionPlan)({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-ow-false") }, false);
    await (0, test_1.expect)((0, promote_plan_1.promoteExecutionPlan)({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-ow-false") }, false)).rejects.toThrow(/already exists.*Use --overwrite/i);
});
(0, test_1.test)("automation existing + overwrite=true replaces plan and spec", async () => {
    const plan1 = makePlan({ externalId: "C20002", title: "Overwrite test" });
    const entry1 = await (0, promote_plan_1.promoteExecutionPlan)({ plan: plan1, outputRoot: tmpDir, fullConfig: makeConfig("profile-ow-true") }, false);
    const caseDir = node_path_1.default.dirname(entry1.planPath);
    const planPath = node_path_1.default.join(caseDir, "plan.json");
    const specPath = node_path_1.default.join(caseDir, "case.spec.ts");
    const planContent1 = await promises_1.default.readFile(planPath, "utf-8");
    (0, test_1.expect)(planContent1).toContain("\"externalId\": \"C20002\"");
    const plan2 = makePlan({ externalId: "C20002", title: "Overwrite test", status: "validated" });
    const plan2WithNote = { ...plan2, notes: ["updated by overwrite test"] };
    const entry2 = await (0, promote_plan_1.promoteExecutionPlan)({ plan: plan2WithNote, outputRoot: tmpDir, overwrite: true, fullConfig: makeConfig("profile-ow-true") }, false);
    const planContent2 = await promises_1.default.readFile(planPath, "utf-8");
    (0, test_1.expect)(planContent2).toContain("updated by overwrite test");
    const specContent = await promises_1.default.readFile(specPath, "utf-8");
    (0, test_1.expect)(specContent).toContain("loadPromotedAppConfigSync");
    (0, test_1.expect)(entry2.metadata?.overwritten).toBe(true);
    (0, test_1.expect)(entry2.metadata?.previousAutomationPath).toContain("plan.json");
});
(0, test_1.test)("overwrite=true records previousStatus in metadata", async () => {
    const plan1 = makePlan({ externalId: "C20003", title: "Overwrite status test" });
    await (0, promote_plan_1.promoteExecutionPlan)({ plan: plan1, outputRoot: tmpDir, fullConfig: makeConfig("profile-ow-status") }, false);
    const plan2 = { ...makePlan({ externalId: "C20003", title: "Overwrite status test" }), notes: ["v2 update"] };
    const entry = await (0, promote_plan_1.promoteExecutionPlan)({ plan: plan2, outputRoot: tmpDir, overwrite: true, fullConfig: makeConfig("profile-ow-status") }, false);
    (0, test_1.expect)(entry.metadata?.overwritten).toBe(true);
    (0, test_1.expect)(entry.metadata?.previousStatus).toBe("active");
});
(0, test_1.test)("overwrite=true does not throw when automation does not exist yet", async () => {
    const plan = makePlan({ externalId: "C20004", title: "New automation" });
    const entry = await (0, promote_plan_1.promoteExecutionPlan)({ plan, outputRoot: tmpDir, overwrite: true, fullConfig: makeConfig("profile-ow-new") }, false);
    (0, test_1.expect)(entry.id).toBe("c20004-new-automation");
    (0, test_1.expect)(entry.metadata?.overwritten).toBeUndefined();
});
(0, test_1.test)("overwrite=true with inlineDebugMode sets pomStatus inline_debug_only", async () => {
    const plan1 = makePlan({ externalId: "C20005", title: "Inline debug overwrite" });
    await (0, promote_plan_1.promoteExecutionPlan)({ plan: plan1, outputRoot: tmpDir, fullConfig: makeConfig("profile-ow-inline"), inlineDebugMode: true }, false);
    const plan2 = { ...makePlan({ externalId: "C20005", title: "Inline debug overwrite" }), notes: ["v2 update"] };
    const entry = await (0, promote_plan_1.promoteExecutionPlan)({ plan: plan2, outputRoot: tmpDir, overwrite: true, fullConfig: makeConfig("profile-ow-inline"), inlineDebugMode: true }, false);
    (0, test_1.expect)(entry.pomStatus).toBe("inline_debug_only");
    (0, test_1.expect)(entry.metadata?.overwritten).toBe(true);
});
(0, test_1.test)("needs_page_object creates page-objects.index.json", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C30001", caseId: 30001, title: "POM missing page object test" },
        requiredData: [],
        steps: [
            { index: 1, action: "navigate", target: "APP_BASE_URL" },
            { index: 2, action: "click", description: "Click on Iniciar", target: { strategy: "text", value: "Iniciar" } },
            { index: 3, action: "click", description: "Click on tarjetas", target: { strategy: "text", value: "tarjetas" } }
        ],
        createdAt: new Date().toISOString()
    };
    const entry = await (0, promote_plan_1.promoteExecutionPlan)({
        plan,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-needs-po"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    (0, test_1.expect)(entry.pomStatus).toBe("needs_page_object");
    const registryPath = node_path_1.default.join(tmpDir, "automations/apps/profile-pom-needs-po/page-objects.index.json");
    await (0, test_1.expect)(promises_1.default.access(registryPath)).resolves.toBeUndefined();
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-needs-po" }, tmpDir);
    (0, test_1.expect)(registry.pageObjects.length).toBeGreaterThan(0);
    (0, test_1.expect)(registry.pageObjects[0].status).toBe("candidate");
    const classNames = registry.pageObjects.map((po) => po.className);
    (0, test_1.expect)(classNames).not.toContain("PomMissingPageObjectTestPage");
    (0, test_1.expect)(classNames.some((c) => c === "HomePage" || c === "CategoryPage" || c === "ProductListPage")).toBe(true);
});
(0, test_1.test)("needs_page_object generates generic reusable Page Objects not case-specific", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C37844", caseId: 37844, title: "Visualizar detalle de tarjeta Visa Gold" },
        requiredData: [],
        steps: [
            { index: 1, action: "navigate", target: "APP_BASE_URL" },
            { index: 2, action: "click", target: { strategy: "text", value: "Iniciar" } },
            { index: 3, action: "click", target: { strategy: "text", value: "Información de productos" } },
            { index: 4, action: "click", target: { strategy: "text", value: "tarjetas" } },
            { index: 5, action: "click", target: { strategy: "text", value: "Tarjeta de Credito Visa Gold" } }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-generic"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-generic" }, tmpDir);
    const classNames = registry.pageObjects.map((po) => po.className);
    (0, test_1.expect)(classNames).not.toContain("VisualizarDetalleDeTarjetaVisaGoldPage");
    (0, test_1.expect)(classNames).not.toContain("GenericPage");
    const allMethodNames = registry.pageObjects.flatMap((po) => po.methods.map((m) => m.name));
    (0, test_1.expect)(allMethodNames).not.toContain("clickTarjetaDeCreditoVisaGold");
    (0, test_1.expect)(allMethodNames).not.toContain("clickInformacinDeProductos");
    (0, test_1.expect)(classNames.some((c) => c === "HomePage")).toBe(true);
    (0, test_1.expect)(classNames.some((c) => c === "CategoryPage")).toBe(true);
    (0, test_1.expect)(classNames.some((c) => c === "ProductListPage")).toBe(true);
    const homePO = registry.pageObjects.find((po) => po.className === "HomePage");
    (0, test_1.expect)(homePO).toBeDefined();
    (0, test_1.expect)(homePO.methods.some((m) => m.intent === "start_session")).toBe(true);
    (0, test_1.expect)(homePO.methods.some((m) => m.name === "start")).toBe(true);
    const categoryPO = registry.pageObjects.find((po) => po.className === "CategoryPage");
    (0, test_1.expect)(categoryPO).toBeDefined();
    (0, test_1.expect)(categoryPO.methods.some((m) => m.intent === "select_category")).toBe(true);
    const productListPO = registry.pageObjects.find((po) => po.className === "ProductListPage");
    (0, test_1.expect)(productListPO).toBeDefined();
    (0, test_1.expect)(productListPO.methods.some((m) => m.intent === "select_product")).toBe(true);
    const productListMethodNames = productListPO.methods.map((m) => m.name);
    (0, test_1.expect)(productListMethodNames).not.toContain("start");
    (0, test_1.expect)(productListMethodNames).not.toContain("startSession");
    const productDetailPO = registry.pageObjects.find((po) => po.className === "ProductDetailPage");
    if (productDetailPO) {
        const detailMethodNames = productDetailPO.methods.map((m) => m.name);
        (0, test_1.expect)(detailMethodNames).not.toContain("selectProduct");
        (0, test_1.expect)(detailMethodNames).not.toContain("select_product");
    }
});
(0, test_1.test)("Iniciar genera HomePage.start no ProductListPage.start", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C30010", caseId: 30010, title: "Start session test" },
        requiredData: [],
        steps: [
            { index: 1, action: "click", target: { strategy: "text", value: "Iniciar" } }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-start"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-start" }, tmpDir);
    const homePO = registry.pageObjects.find((po) => po.className === "HomePage");
    (0, test_1.expect)(homePO).toBeDefined();
    (0, test_1.expect)(homePO.methods.some((m) => m.name === "start")).toBe(true);
    (0, test_1.expect)(homePO.methods.some((m) => m.intent === "start_session")).toBe(true);
    const productListPO = registry.pageObjects.find((po) => po.className === "ProductListPage");
    if (productListPO) {
        (0, test_1.expect)(productListPO.methods.some((m) => m.name === "start")).toBe(false);
    }
});
(0, test_1.test)("Informacion de productos genera openProductInformation no ProductListPage method", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C30011", caseId: 30011, title: "Product info test" },
        requiredData: [],
        steps: [
            { index: 1, action: "click", target: { strategy: "text", value: "Información de productos" } }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-prodinfo"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-prodinfo" }, tmpDir);
    const productInfoPO = registry.pageObjects.find((po) => po.className === "ProductInformationPage");
    (0, test_1.expect)(productInfoPO).toBeDefined();
    const hasOpenProductInfo = productInfoPO.methods.some((m) => m.name === "openProductInformation" || m.intent === "open_product_information");
    (0, test_1.expect)(hasOpenProductInfo).toBe(true);
    const allMethodNames = registry.pageObjects.flatMap((po) => po.methods.map((m) => m.name));
    (0, test_1.expect)(allMethodNames).not.toContain("selectProduct");
});
(0, test_1.test)("ProductDetailPage no contiene selectProduct", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C30012", caseId: 30012, title: "Detail view test" },
        requiredData: [],
        steps: [
            { index: 1, action: "click", target: { strategy: "text", value: "detalle de producto" } },
            { index: 2, action: "assertVisible", target: { strategy: "text", value: "Product Details" } }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-detail"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-detail" }, tmpDir);
    const allMethods = registry.pageObjects.flatMap((po) => po.methods);
    const selectProductMethods = allMethods.filter((m) => m.intent === "select_product" || m.name === "selectProduct");
    (0, test_1.expect)(selectProductMethods.length).toBe(0);
    const detailPO = registry.pageObjects.find((po) => po.className === "ProductDetailPage");
    if (detailPO) {
        const detailIntents = detailPO.methods.map((m) => m.intent);
        (0, test_1.expect)(detailIntents).not.toContain("select_product");
    }
});
(0, test_1.test)("click tarjetas generates selectCategory not clickTarjetas", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C30006", caseId: 30006, title: "Category selection test" },
        requiredData: [],
        steps: [
            { index: 1, action: "click", target: { strategy: "text", value: "tarjetas" } }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-category"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-category" }, tmpDir);
    const categoryPO = registry.pageObjects.find((po) => po.className === "CategoryPage");
    (0, test_1.expect)(categoryPO).toBeDefined();
    (0, test_1.expect)(categoryPO.methods.some((m) => m.name === "selectCategory")).toBe(true);
    (0, test_1.expect)(categoryPO.methods.some((m) => m.name === "clickTarjetas")).toBe(false);
});
(0, test_1.test)("click producto generates selectProduct not clickProducto", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C30007", caseId: 30007, title: "Product selection test" },
        requiredData: [],
        steps: [
            { index: 1, action: "click", target: { strategy: "text", value: "tarjeta de credito visa gold" } }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-product"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-product" }, tmpDir);
    const productListPO = registry.pageObjects.find((po) => po.className === "ProductListPage");
    (0, test_1.expect)(productListPO).toBeDefined();
    (0, test_1.expect)(productListPO.methods.some((m) => m.name === "selectProduct")).toBe(true);
    (0, test_1.expect)(productListPO.methods.some((m) => m.name === "clickTarjetaDeCreditoVisaGold")).toBe(false);
});
(0, test_1.test)("navigate APP_BASE_URL no genera navigatenavigateAPPBASEURL", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C30008", caseId: 30008, title: "Navigate test" },
        requiredData: [],
        steps: [
            { index: 1, action: "navigate", target: "APP_BASE_URL" },
            { index: 2, action: "click", target: { strategy: "text", value: "Iniciar" } }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-navigate"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-navigate" }, tmpDir);
    const allMethodNames = registry.pageObjects.flatMap((po) => po.methods.map((m) => m.name));
    (0, test_1.expect)(allMethodNames).not.toContain("navigatenavigateAPPBASEURL");
    (0, test_1.expect)(allMethodNames).not.toContain("navigateNavigateAppBaseUrl");
    (0, test_1.expect)(allMethodNames).not.toContain("openHome");
    const flowReg = await (0, flow_registry_1.loadFlowRegistry)({ appSlug: "profile-pom-navigate" }, tmpDir);
    (0, test_1.expect)(flowReg.flows.length).toBeGreaterThan(0);
    const flowMethodNames = flowReg.flows[0].steps.map((s) => s.methodName);
    (0, test_1.expect)(flowMethodNames).toContain("open");
});
(0, test_1.test)("login generates LoginPage candidate not loginlogin inside product PO", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C30009", caseId: 30009, title: "Login test" },
        requiredData: [],
        steps: [
            { index: 1, action: "navigate", target: "APP_BASE_URL" },
            { index: 2, action: "login", target: { strategy: "text", value: "Login" } },
            { index: 3, action: "click", target: { strategy: "text", value: "tarjetas" } }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-login"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-login" }, tmpDir);
    const allMethodNames = registry.pageObjects.flatMap((po) => po.methods.map((m) => m.name));
    (0, test_1.expect)(allMethodNames).not.toContain("loginlogin");
    const categoryPO = registry.pageObjects.find((po) => po.className === "CategoryPage");
    (0, test_1.expect)(categoryPO).toBeDefined();
    const categoryMethodNames = categoryPO.methods.map((m) => m.name);
    (0, test_1.expect)(categoryMethodNames).not.toContain("loginlogin");
    (0, test_1.expect)(categoryMethodNames).not.toContain("start");
});
(0, test_1.test)("login modal promotion registers HomePage and LoginPage candidates with dedicated methods", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C37927", caseId: 37927, title: "Validar inicio de sesion con credenciales validas" },
        requiredData: [
            { key: "usuario_valido", required: true, resolved: true, source: "env" },
            { key: "contrasena_valida", required: true, resolved: true, source: "env" }
        ],
        steps: [
            { index: 1, action: "navigate", target: "APP_BASE_URL" },
            { index: 2, action: "click", target: { strategy: "text", value: "Log in" } },
            { index: 3, action: "assertText", target: { strategy: "text", value: "Username" }, expected: "Username" },
            { index: 4, action: "fill", target: { strategy: "text", value: "Username" }, valueKey: "usuario_valido" },
            { index: 5, action: "fill", target: { strategy: "text", value: "Password" }, valueKey: "contrasena_valida" },
            { index: 6, action: "click", target: { strategy: "text", value: "Log in" } }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-login-modal"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-login-modal" }, tmpDir);
    const homePO = registry.pageObjects.find((po) => po.className === "HomePage");
    const loginPO = registry.pageObjects.find((po) => po.className === "LoginPage");
    (0, test_1.expect)(homePO).toBeDefined();
    (0, test_1.expect)(homePO.methods.some((m) => m.intent === "open_login_modal")).toBe(true);
    (0, test_1.expect)(loginPO).toBeDefined();
    (0, test_1.expect)(loginPO.methods.some((m) => m.intent === "expect_login_form")).toBe(true);
    (0, test_1.expect)(loginPO.methods.some((m) => m.intent === "fill_username")).toBe(true);
    (0, test_1.expect)(loginPO.methods.some((m) => m.intent === "fill_password")).toBe(true);
    (0, test_1.expect)(loginPO.methods.some((m) => m.intent === "submit_login")).toBe(true);
});
(0, test_1.test)("C37844 y C37845 comparten candidates genericos", async () => {
    const plan1 = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C37844", caseId: 37844, title: "Visualizar detalle Visa Gold" },
        requiredData: [],
        steps: [
            { index: 1, action: "click", target: { strategy: "text", value: "tarjetas" } },
            { index: 2, action: "click", target: { strategy: "text", value: "Visa Gold" } }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan: plan1,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-shared"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry1 = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-shared" }, tmpDir);
    const poCount1 = registry1.pageObjects.length;
    const plan2 = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C37845", caseId: 37845, title: "Visualizar detalle Visa Platinum" },
        requiredData: [],
        steps: [
            { index: 1, action: "click", target: { strategy: "text", value: "tarjetas" } },
            { index: 2, action: "click", target: { strategy: "text", value: "Visa Platinum" } }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan: plan2,
        outputRoot: tmpDir,
        overwrite: true,
        fullConfig: makeConfig("profile-pom-shared"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry2 = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-shared" }, tmpDir);
    (0, test_1.expect)(registry2.pageObjects.length).toBe(poCount1);
    const categoryPO = registry2.pageObjects.find((po) => po.className === "CategoryPage");
    (0, test_1.expect)(categoryPO).toBeDefined();
    (0, test_1.expect)(categoryPO.methods.filter((m) => m.intent === "select_category").length).toBe(1);
    const productListPO = registry2.pageObjects.find((po) => po.className === "ProductListPage");
    (0, test_1.expect)(productListPO).toBeDefined();
    (0, test_1.expect)(productListPO.methods.filter((m) => m.intent === "select_product").length).toBe(1);
});
(0, test_1.test)("segmented_route_recovery parent_category genera selectCategory", async () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", externalId: "C30005", caseId: 30005, title: "POM recovery metadata test" },
        requiredData: [],
        steps: [
            {
                index: 1,
                action: "click",
                description: "Click recovered target",
                target: { strategy: "text", value: "Tarjetas" },
                recoveryStatus: "recovered",
                recoveredBy: "segmented_route_recovery",
                recoveryMetadata: {
                    selectedCandidateId: "btn-123",
                    selectedCandidateText: "Tarjetas",
                    semanticRelation: "parent_category",
                    score: 0.85,
                    segmentIndex: 0,
                    transitionDetected: true,
                    executedAction: "click",
                    rationale: "Recovered via segmented route recovery"
                }
            }
        ],
        createdAt: new Date().toISOString()
    };
    await (0, promote_plan_1.promoteExecutionPlan)({
        plan,
        outputRoot: tmpDir,
        fullConfig: makeConfig("profile-pom-recovery"),
        promotionPolicy: automation_promotion_types_1.DEFAULT_PROMOTION_POLICY
    }, false);
    const registry = await (0, page_object_registry_1.loadPageObjectRegistry)({ appSlug: "profile-pom-recovery" }, tmpDir);
    (0, test_1.expect)(registry.pageObjects.length).toBeGreaterThan(0);
    const candidatePO = registry.pageObjects.find((po) => po.status === "candidate");
    (0, test_1.expect)(candidatePO).toBeDefined();
    (0, test_1.expect)(candidatePO.methods.length).toBeGreaterThan(0);
    (0, test_1.expect)(candidatePO.className).toBe("CategoryPage");
    (0, test_1.expect)(candidatePO.methods[0].intent).toBe("select_category");
    (0, test_1.expect)(candidatePO.methods[0].name).toBe("selectCategory");
    (0, test_1.expect)(candidatePO.methods[0].parameters).toContain("categoryName");
});
