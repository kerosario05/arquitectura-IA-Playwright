"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const spec_generator_pom_1 = require("../src/automations/spec-generator-pom");
const automation_promotion_types_1 = require("../src/types/automation-promotion.types");
const page_object_registry_1 = require("../src/automations/page-object-registry");
const pom_classification_1 = require("../src/automations/pom-classification");
const mockProfile = {
    appSlug: "test",
    source: "default",
    name: "Test",
    baseUrl: "https://test.com",
    baseUrlHash: "abc123",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
};
const mockPaths = {
    appDir: "/apps/test",
    configPath: "/apps/test/app.config.json",
    testDataRefsPath: "/apps/test/test-data.refs.json",
    indexPath: "/apps/test/index.json",
    pageObjectsIndexPath: "/apps/test/page-objects.index.json",
    flowsIndexPath: "/apps/test/flows.index.json",
    pagesDir: "/apps/test/pages",
    componentsDir: "/apps/test/components",
    flowsDir: "/apps/test/flows",
    casesDir: "/apps/test/cases",
    plansDir: "/apps/test/plans",
    specsDir: "/apps/test/specs",
    evidenceDir: "/apps/test/evidence",
    runsDir: "/apps/test/runs",
    specPath: "/apps/test/cases/test-001/spec.ts"
};
function makeRegistry() {
    return { version: "1.0", appSlug: "test", pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
}
(0, test_1.test)("step click 'Iniciar' deriva start_session y encuentra HomePage.start", () => {
    const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Iniciar" } };
    const intent = (0, pom_classification_1.deriveMethodIntentFromStep)(step);
    (0, test_1.expect)(intent).toBe("start_session");
    const owner = (0, pom_classification_1.deriveExpectedOwnerForStep)(step);
    (0, test_1.expect)(owner).toBe("HomePage");
});
(0, test_1.test)("step click 'Información de productos' deriva open_product_information", () => {
    const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Información de productos" } };
    const intent = (0, pom_classification_1.deriveMethodIntentFromStep)(step);
    (0, test_1.expect)(intent).toBe("open_product_information");
    const owner = (0, pom_classification_1.deriveExpectedOwnerForStep)(step);
    (0, test_1.expect)(owner).toBe("ProductInformationPage");
});
(0, test_1.test)("step click 'tarjetas' deriva select_category y encuentra CategoryPage.selectCategory", () => {
    const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } };
    const intent = (0, pom_classification_1.deriveMethodIntentFromStep)(step);
    (0, test_1.expect)(intent).toBe("select_category");
    const owner = (0, pom_classification_1.deriveExpectedOwnerForStep)(step);
    (0, test_1.expect)(owner).toBe("CategoryPage");
});
(0, test_1.test)("step click 'tarjeta de credito visa gold' deriva select_product y encuentra ProductListPage.selectProduct", () => {
    const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjeta de credito visa gold" } };
    const intent = (0, pom_classification_1.deriveMethodIntentFromStep)(step);
    (0, test_1.expect)(intent).toBe("select_product");
    const owner = (0, pom_classification_1.deriveExpectedOwnerForStep)(step);
    (0, test_1.expect)(owner).toBe("ProductListPage");
});
(0, test_1.test)("step click 'la primera tarjeta visible del listado de productos' deriva intent first-visible y owner ProductListPage", () => {
    const step = { index: 1, action: "click", target: { strategy: "text", value: "la primera tarjeta visible del listado de productos" } };
    const intent = (0, pom_classification_1.deriveMethodIntentFromStep)(step);
    (0, test_1.expect)(intent).toBe("select_first_visible_card");
    const owner = (0, pom_classification_1.deriveExpectedOwnerForStep)(step);
    (0, test_1.expect)(owner).toBe("ProductListPage");
});
(0, test_1.test)("spec generator produce method calls con parámetros", () => {
    const reg = makeRegistry();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "CategoryPage", className: "CategoryPage", screenSignature: "sig:category", confidence: 0.8, sourcePlanId: "plan_1",
        methods: [{ name: "selectCategory", intent: "select_category", parameters: ["categoryName"] }]
    });
    (0, page_object_registry_1.markPageObjectActive)(r1.registry, r1.registry.pageObjects[0].id);
    (0, page_object_registry_1.markMethodActive)(r1.registry, r1.registry.pageObjects[0].id, "selectCategory");
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", caseId: 1, title: "Test" },
        requiredData: [],
        steps: [{ index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } }],
        createdAt: new Date().toISOString()
    };
    const result = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(plan, "test-001", mockProfile, mockPaths, r1.registry, automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, false);
    (0, test_1.expect)(result.pomStatus).toBe("promoted");
    (0, test_1.expect)(result.specContent).toContain("await categoryPage.selectCategory('tarjetas');");
});
(0, test_1.test)("POM promotion de C37844-style plan pasa cuando métodos están active/available", () => {
    const reg = makeRegistry();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.8, sourcePlanId: "plan_1",
        methods: [{ name: "start", intent: "start_session" }]
    });
    const r2 = (0, page_object_registry_1.registerPageObjectCandidate)(r1.registry, {
        name: "ProductInformationPage", className: "ProductInformationPage", screenSignature: "sig:productinfo", confidence: 0.8, sourcePlanId: "plan_1",
        methods: [{ name: "openProductInformation", intent: "open_product_information" }]
    });
    const r3 = (0, page_object_registry_1.registerPageObjectCandidate)(r2.registry, {
        name: "CategoryPage", className: "CategoryPage", screenSignature: "sig:category", confidence: 0.8, sourcePlanId: "plan_1",
        methods: [{ name: "selectCategory", intent: "select_category", parameters: ["categoryName"] }]
    });
    const r4 = (0, page_object_registry_1.registerPageObjectCandidate)(r3.registry, {
        name: "ProductListPage", className: "ProductListPage", screenSignature: "sig:productlist", confidence: 0.8, sourcePlanId: "plan_1",
        methods: [{ name: "selectProduct", intent: "select_product", parameters: ["productName"] }]
    });
    for (const po of r4.registry.pageObjects) {
        (0, page_object_registry_1.markPageObjectActive)(r4.registry, po.id);
        for (const method of po.methods) {
            (0, page_object_registry_1.markMethodActive)(r4.registry, po.id, method.name);
        }
    }
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", caseId: 37844, title: "Visualizar detalle de Tarjeta Visa Gold" },
        requiredData: [],
        steps: [
            { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Iniciar" } },
            { index: 2, action: "click", target: { strategy: "role", value: "button", name: "Información de productos" } },
            { index: 3, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } },
            { index: 4, action: "click", target: { strategy: "role", value: "button", name: "tarjeta de credito visa gold" } }
        ],
        createdAt: new Date().toISOString()
    };
    const result = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(plan, "test-001", mockProfile, mockPaths, r4.registry, automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, false);
    (0, test_1.expect)(result.pomStatus).toBe("promoted");
    (0, test_1.expect)(result.missingMethods).toHaveLength(0);
    (0, test_1.expect)(result.usedPageObjects).toContain("HomePage");
    (0, test_1.expect)(result.usedPageObjects).toContain("ProductInformationPage");
    (0, test_1.expect)(result.usedPageObjects).toContain("CategoryPage");
    (0, test_1.expect)(result.usedPageObjects).toContain("ProductListPage");
    (0, test_1.expect)(result.specContent).toContain("await homePage.start();");
    (0, test_1.expect)(result.specContent).toContain("await productInformationPage.openProductInformation();");
    (0, test_1.expect)(result.specContent).toContain("await categoryPage.selectCategory('tarjetas');");
    (0, test_1.expect)(result.specContent).toContain("await productListPage.selectProduct('tarjeta de credito visa gold');");
});
(0, test_1.test)("needs_page_method diagnostics incluye derivedIntent y expectedOwner", () => {
    const reg = makeRegistry();
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(reg, {
        name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.8, sourcePlanId: "plan_1",
        methods: [{ name: "open", intent: "open_home" }]
    });
    (0, page_object_registry_1.markPageObjectActive)(r1.registry, r1.registry.pageObjects[0].id);
    (0, page_object_registry_1.markMethodActive)(r1.registry, r1.registry.pageObjects[0].id, "open");
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "testrail", caseId: 1, title: "Test" },
        requiredData: [],
        steps: [{ index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } }],
        createdAt: new Date().toISOString()
    };
    const result = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(plan, "test-001", mockProfile, mockPaths, r1.registry, automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, false);
    (0, test_1.expect)(result.pomStatus).toBe("needs_page_method");
    (0, test_1.expect)(result.missingMethods.length).toBeGreaterThan(0);
    const diagnostic = result.missingMethods[0];
    (0, test_1.expect)(diagnostic).toContain("derivedIntent=");
    (0, test_1.expect)(diagnostic).toContain("select_category");
    (0, test_1.expect)(diagnostic).toContain("expectedOwner=");
    (0, test_1.expect)(diagnostic).toContain("CategoryPage");
});
(0, test_1.test)("login modal steps derive dedicated login intents", () => {
    const steps = [
        { index: 1, action: "click", target: { strategy: "text", value: "Log in", exact: false } },
        { index: 2, action: "assertText", target: { strategy: "text", value: "Username", exact: false } },
        { index: 3, action: "fill", target: { strategy: "text", value: "Username", exact: false }, valueKey: "usuario_valido" },
        { index: 4, action: "fill", target: { strategy: "text", value: "Password", exact: false }, valueKey: "contrasena_valida" },
        { index: 5, action: "click", target: { strategy: "text", value: "Log in", exact: false } }
    ];
    (0, test_1.expect)((0, pom_classification_1.deriveMethodIntentFromStepWithContext)(steps[0], steps)).toBe("open_login_modal");
    (0, test_1.expect)((0, pom_classification_1.deriveExpectedOwnerForStep)(steps[0], steps)).toBe("HomePage");
    (0, test_1.expect)((0, pom_classification_1.deriveMethodIntentFromStep)(steps[1])).toBe("expect_login_form");
    (0, test_1.expect)((0, pom_classification_1.deriveExpectedOwnerForStep)(steps[1])).toBe("LoginPage");
    (0, test_1.expect)((0, pom_classification_1.deriveMethodIntentFromStep)(steps[2])).toBe("fill_username");
    (0, test_1.expect)((0, pom_classification_1.deriveExpectedOwnerForStep)(steps[2])).toBe("LoginPage");
    (0, test_1.expect)((0, pom_classification_1.deriveMethodIntentFromStep)(steps[3])).toBe("fill_password");
    (0, test_1.expect)((0, pom_classification_1.deriveExpectedOwnerForStep)(steps[3])).toBe("LoginPage");
    (0, test_1.expect)((0, pom_classification_1.deriveMethodIntentFromStepWithContext)(steps[4], steps)).toBe("submit_login");
    (0, test_1.expect)((0, pom_classification_1.deriveExpectedOwnerForStep)(steps[4], steps)).toBe("LoginPage");
});
