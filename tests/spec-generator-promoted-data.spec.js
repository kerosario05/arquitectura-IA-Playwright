"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const spec_generator_pom_1 = require("../src/automations/spec-generator-pom");
const automation_promotion_types_1 = require("../src/types/automation-promotion.types");
const page_object_registry_1 = require("../src/automations/page-object-registry");
const profile = {
    appSlug: "generic-app",
    source: "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
};
const paths = {
    appDir: "/apps/generic-app",
    configPath: "/apps/generic-app/app.config.json",
    testDataRefsPath: "/apps/generic-app/test-data.refs.json",
    indexPath: "/apps/generic-app/index.json",
    pageObjectsIndexPath: "/apps/generic-app/page-objects.index.json",
    flowsIndexPath: "/apps/generic-app/flows.index.json",
    pagesDir: "/apps/generic-app/pages",
    componentsDir: "/apps/generic-app/components",
    flowsDir: "/apps/generic-app/flows",
    casesDir: "/apps/generic-app/cases",
    caseDir: "/apps/generic-app/cases/case-x",
    plansDir: "/apps/generic-app/plans",
    specsDir: "/apps/generic-app/specs",
    evidenceDir: "/apps/generic-app/evidence",
    runsDir: "/apps/generic-app/runs",
    specPath: "/apps/generic-app/cases/case-x/case.spec.ts"
};
function makeRegistry() {
    const registry = { version: "1.0", appSlug: "generic-app", pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "FormPage",
        className: "FormPage",
        screenSignature: "screen:generic-app-form",
        confidence: 0.9,
        sourcePlanId: "plan-x",
        methods: [{ name: "fillFormField", intent: "fill_form_field", parameters: ["value"] }]
    });
    const poId = r1.registry.pageObjects[0].id;
    (0, page_object_registry_1.markPageObjectActive)(r1.registry, poId);
    (0, page_object_registry_1.markMethodActive)(r1.registry, poId, "fillFormField");
    return r1.registry;
}
(0, test_1.test)("fill con valueKey genera variable y la usa", () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "manual", title: "Generic Fill" },
        requiredData: [{ key: "customer_name", required: true, resolved: true }],
        steps: [{ index: 1, action: "fill", target: { strategy: "label", value: "Customer Name" }, valueKey: "customer_name" }],
        createdAt: new Date().toISOString()
    };
    const result = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(plan, "case-x", profile, paths, makeRegistry(), automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, false);
    (0, test_1.expect)(result.specContent).toContain("const customerName = requirePromotedData(dataContext, 'customer_name'");
    (0, test_1.expect)(result.specContent).toContain("await promotedRuntime.fillPromotedField");
    (0, test_1.expect)(result.specContent).toContain("await formPage.fillFormField(customerName);");
    (0, test_1.expect)(result.specContent).not.toContain("fillFormField('Customer Name')");
});
(0, test_1.test)("misma key repetida deduplica variable", () => {
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "manual", title: "Generic Fill 2" },
        requiredData: [{ key: "customer_name", required: true, resolved: true }],
        steps: [
            { index: 1, action: "fill", target: { strategy: "label", value: "Customer Name" }, valueKey: "customer_name" },
            { index: 2, action: "fill", target: { strategy: "label", value: "Customer Name Confirm" }, valueKey: "customer_name" }
        ],
        createdAt: new Date().toISOString()
    };
    const result = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(plan, "case-y", profile, paths, makeRegistry(), automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, false);
    const declarations = (result.specContent.match(/const customerName = requirePromotedData/g) || []).length;
    (0, test_1.expect)(declarations).toBe(1);
});
(0, test_1.test)("spec promovido usa runtime helpers para click/modal", () => {
    const registry = { version: "1.0", appSlug: "generic-app", pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
    const r1 = (0, page_object_registry_1.registerPageObjectCandidate)(registry, {
        name: "ProductListPage",
        className: "ProductListPage",
        screenSignature: "screen:generic-app-list",
        confidence: 0.9,
        sourcePlanId: "plan-z",
        methods: [{ name: "selectProduct", intent: "select_product", parameters: ["productName"] }]
    });
    const poId = r1.registry.pageObjects[0].id;
    (0, page_object_registry_1.markPageObjectActive)(r1.registry, poId);
    (0, page_object_registry_1.markMethodActive)(r1.registry, poId, "selectProduct");
    const plan = {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "manual", title: "Modal click" },
        requiredData: [],
        steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Sample Product" } }],
        createdAt: new Date().toISOString()
    };
    const result = (0, spec_generator_pom_1.generatePOMSpecFromPlan)(plan, "case-z", profile, paths, r1.registry, automation_promotion_types_1.DEFAULT_PROMOTION_POLICY, false);
    (0, test_1.expect)(result.specContent).toContain("createPromotedSpecRuntime(page)");
    (0, test_1.expect)(result.specContent).toContain("promotedRuntime.clickPromotedTarget");
});
