import { test, expect } from "@playwright/test";
import { generatePOMSpecFromPlan } from "../src/automations/spec-generator-pom";
import { DEFAULT_PROMOTION_POLICY } from "../src/types/automation-promotion.types";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { AppAutomationPaths, AppProfile } from "../src/automations/app-profile";
import type { PageObjectRegistry } from "../src/types/page-object.types";
import { registerPageObjectCandidate, markMethodActive, markPageObjectActive } from "../src/automations/page-object-registry";

const profile: AppProfile = {
  appSlug: "generic-app",
  source: "default",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const paths: AppAutomationPaths = {
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

function makeRegistry(): PageObjectRegistry {
  const registry: PageObjectRegistry = { version: "1.0", appSlug: "generic-app", pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
  const r1 = registerPageObjectCandidate(registry, {
    name: "FormPage",
    className: "FormPage",
    screenSignature: "screen:generic-app-form",
    confidence: 0.9,
    sourcePlanId: "plan-x",
    methods: [{ name: "fillFormField", intent: "fill_form_field", parameters: ["value"] }]
  });
  const poId = r1.registry.pageObjects[0].id;
  markPageObjectActive(r1.registry, poId);
  markMethodActive(r1.registry, poId, "fillFormField");
  return r1.registry;
}

test("fill con valueKey genera variable y la usa", () => {
  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "manual", title: "Generic Fill" },
    requiredData: [{ key: "customer_name", required: true, resolved: true }],
    steps: [{ index: 1, action: "fill", target: { strategy: "label", value: "Customer Name" }, valueKey: "customer_name" }],
    createdAt: new Date().toISOString()
  };
  const result = generatePOMSpecFromPlan(plan, "case-x", profile, paths, makeRegistry(), DEFAULT_PROMOTION_POLICY, false);
  expect(result.specContent).toContain("const customerName = requirePromotedData(dataContext, 'customer_name'");
  expect(result.specContent).toContain("await promotedRuntime.fillPromotedField");
  expect(result.specContent).toContain("await formPage.fillFormField(customerName);");
  expect(result.specContent).not.toContain("fillFormField('Customer Name')");
});

test("misma key repetida deduplica variable", () => {
  const plan: ExecutionPlan = {
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
  const result = generatePOMSpecFromPlan(plan, "case-y", profile, paths, makeRegistry(), DEFAULT_PROMOTION_POLICY, false);
  const declarations = (result.specContent.match(/const customerName = requirePromotedData/g) || []).length;
  expect(declarations).toBe(1);
});

test("spec promovido usa runtime helpers para click/modal", () => {
  const registry: PageObjectRegistry = { version: "1.0", appSlug: "generic-app", pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
  const r1 = registerPageObjectCandidate(registry, {
    name: "ProductListPage",
    className: "ProductListPage",
    screenSignature: "screen:generic-app-list",
    confidence: 0.9,
    sourcePlanId: "plan-z",
    methods: [{ name: "selectProduct", intent: "select_product", parameters: ["productName"] }]
  });
  const poId = r1.registry.pageObjects[0].id;
  markPageObjectActive(r1.registry, poId);
  markMethodActive(r1.registry, poId, "selectProduct");

  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "manual", title: "Modal click" },
    requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Sample Product" } }],
    createdAt: new Date().toISOString()
  };
  const result = generatePOMSpecFromPlan(plan, "case-z", profile, paths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  expect(result.specContent).toContain("createPromotedSpecRuntime(page)");
  expect(result.specContent).toContain("promotedRuntime.clickPromotedTarget");
});
