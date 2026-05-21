import { test, expect } from "@playwright/test";
import { generatePOMSpecFromPlan } from "../src/automations/spec-generator-pom";
import { DEFAULT_PROMOTION_POLICY } from "../src/types/automation-promotion.types";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { AppProfile, AppAutomationPaths } from "../src/automations/app-profile";
import type { PageObjectRegistry } from "../src/types/page-object.types";
import { registerPageObjectCandidate, markPageObjectActive, markMethodActive } from "../src/automations/page-object-registry";

const mockProfile: AppProfile = {
  appSlug: "test",
  name: "Test",
  baseUrl: "https://test.com",
  baseUrlHash: "abc123",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const mockPaths: AppAutomationPaths = {
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

const mockPlan: ExecutionPlan = {
  version: "1.0",
  source: "discovery_generated",
  status: "validated",
  scenario: { source: "testrail", caseId: 1, title: "Test Case" },
  requiredData: [],
  steps: [
    { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Login" } },
    { index: 2, action: "fill", target: { strategy: "text", value: "username" }, value: "testuser" }
  ],
  createdAt: new Date().toISOString()
};

function makeRegistry(): PageObjectRegistry {
  return { version: "1.0", appSlug: "test", pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
}

test("POM spec without registry returns needs_page_object", () => {
  const result = generatePOMSpecFromPlan(mockPlan, "test-001", mockProfile, mockPaths, undefined, DEFAULT_PROMOTION_POLICY, false);
  expect(result.pomStatus).toBe("needs_page_object");
  expect(result.usedPageObjects).toHaveLength(0);
});

test("POM spec with active PO and method uses POM call", () => {
  const reg = makeRegistry();
  const r1 = registerPageObjectCandidate(reg, {
    name: "LoginPage", className: "LoginPage", screenSignature: "sig:login", confidence: 0.9, sourcePlanId: "plan_1",
    methods: [{ name: "clickLogin", intent: "click" }]
  });
  const poId = r1.registry.pageObjects[0].id;
  markPageObjectActive(r1.registry, poId);
  markMethodActive(r1.registry, poId, "clickLogin");

  // Single-step plan that matches the registered method
  const singleStepPlan: ExecutionPlan = {
    ...mockPlan,
    steps: [{ index: 1, action: "click", target: { strategy: "role", value: "button", name: "Login" } }]
  };
  const result = generatePOMSpecFromPlan(singleStepPlan, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  expect(result.pomStatus).toBe("promoted");
  expect(result.usedPageObjects).toContain("LoginPage");
  expect(result.specContent).toContain("import { LoginPage } from");
  expect(result.specContent).toContain("const loginPage = new LoginPage(page);");
  expect(result.specContent).toContain("await loginPage.clickLogin();");
});

test("POM spec with inline debug mode marks inline_debug_only", () => {
  const result = generatePOMSpecFromPlan(mockPlan, "test-001", mockProfile, mockPaths, undefined, DEFAULT_PROMOTION_POLICY, true);
  expect(result.pomStatus).toBe("inline_debug_only");
  expect(result.specContent).toContain("[INLINE DEBUG]");
});

test("POM spec generates imports and instantiations for each PO", () => {
  const reg = makeRegistry();
  const r1 = registerPageObjectCandidate(reg, {
    name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "selectOption", intent: "click" }]
  });
  const r1b = registerPageObjectCandidate(r1.registry, {
    name: "FormPage", className: "FormPage", screenSignature: "sig:form", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "fillField", intent: "fill" }]
  });
  const r2 = r1b.registry;
  markPageObjectActive(r2, r2.pageObjects[0].id);
  markMethodActive(r2, r2.pageObjects[0].id, "selectOption");
  markPageObjectActive(r2, r2.pageObjects[1].id);
  markMethodActive(r2, r2.pageObjects[1].id, "fillField");

  const result = generatePOMSpecFromPlan(mockPlan, "test-001", mockProfile, mockPaths, r2, DEFAULT_PROMOTION_POLICY, false);
  expect(result.pomStatus).toBe("promoted");
  expect(result.specContent).toContain("import { MenuPage } from");
  expect(result.specContent).toContain("import { FormPage } from");
  expect(result.specContent).toContain("const menuPage = new MenuPage(page);");
  expect(result.specContent).toContain("const formPage = new FormPage(page);");
});

test("POM spec avoids duplicate imports", () => {
  const reg = makeRegistry();
  const r1 = registerPageObjectCandidate(reg, {
    name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [
      { name: "selectOption", intent: "click" },
      { name: "navigateTo", intent: "navigate" }
    ]
  });
  const poId = r1.registry.pageObjects[0].id;
  markPageObjectActive(r1.registry, poId);
  markMethodActive(r1.registry, poId, "selectOption");
  markMethodActive(r1.registry, poId, "navigateTo");

  const planWithTwoActions: ExecutionPlan = {
    ...mockPlan,
    steps: [
      { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Login" } },
      { index: 2, action: "navigate", target: { strategy: "text", value: "home" } }
    ]
  };
  const result = generatePOMSpecFromPlan(planWithTwoActions, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  const importCount = (result.specContent.match(/import { MenuPage } from/g) || []).length;
  expect(importCount).toBe(1);
});

test("POM spec without method returns needs_page_method", () => {
  const reg = makeRegistry();
  const r1 = registerPageObjectCandidate(reg, {
    name: "LoginPage", className: "LoginPage", screenSignature: "sig:login", confidence: 0.9, sourcePlanId: "plan_1",
    methods: [{ name: "doOther", intent: "select" }]
  });
  markPageObjectActive(r1.registry, r1.registry.pageObjects[0].id);
  markMethodActive(r1.registry, r1.registry.pageObjects[0].id, "doOther");

  const result = generatePOMSpecFromPlan(mockPlan, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  expect(result.pomStatus).toBe("needs_page_method");
  expect(result.missingMethods.length).toBeGreaterThan(0);
});

test("POM spec with candidate generation creates candidate entries", () => {
  const reg = makeRegistry();
  const r1 = registerPageObjectCandidate(reg, {
    name: "GenericPage", className: "GenericPage", screenSignature: "sig:generic", confidence: 0.6, sourcePlanId: "plan_1",
    methods: [{ name: "candidateClick", intent: "click" }]
  });

  const result = generatePOMSpecFromPlan(mockPlan, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  expect(result.generatedCandidates).toBe(1);
  expect(result.specContent).toContain("// candidate method");
});

test("POM spec contains test title from plan", () => {
  const result = generatePOMSpecFromPlan(mockPlan, "test-001", mockProfile, mockPaths, undefined, DEFAULT_PROMOTION_POLICY, false);
  expect(result.specContent).toContain(mockPlan.scenario.title);
});
