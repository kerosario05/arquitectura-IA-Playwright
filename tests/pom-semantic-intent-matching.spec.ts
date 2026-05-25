import { test, expect } from "@playwright/test";
import { generatePOMSpecFromPlan } from "../src/automations/spec-generator-pom";
import { DEFAULT_PROMOTION_POLICY } from "../src/types/automation-promotion.types";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { AppProfile, AppAutomationPaths } from "../src/automations/app-profile";
import type { PageObjectRegistry } from "../src/types/page-object.types";
import { registerPageObjectCandidate, markPageObjectActive, markMethodActive } from "../src/automations/page-object-registry";
import { deriveMethodIntentFromStep, deriveMethodIntentFromStepWithContext, deriveExpectedOwnerForStep } from "../src/automations/pom-classification";

const mockProfile: AppProfile = {
  appSlug: "test",
  source: "default",
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

function makeRegistry(): PageObjectRegistry {
  return { version: "1.0", appSlug: "test", pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
}

test("step click 'Iniciar' deriva start_session y encuentra HomePage.start", () => {
  const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Iniciar" } };
  const intent = deriveMethodIntentFromStep(step as any);
  expect(intent).toBe("start_session");

  const owner = deriveExpectedOwnerForStep(step as any);
  expect(owner).toBe("HomePage");
});

test("step click 'Información de productos' deriva open_product_information", () => {
  const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Información de productos" } };
  const intent = deriveMethodIntentFromStep(step as any);
  expect(intent).toBe("open_product_information");

  const owner = deriveExpectedOwnerForStep(step as any);
  expect(owner).toBe("ProductInformationPage");
});

test("step click 'tarjetas' deriva select_category y encuentra CategoryPage.selectCategory", () => {
  const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } };
  const intent = deriveMethodIntentFromStep(step as any);
  expect(intent).toBe("select_category");

  const owner = deriveExpectedOwnerForStep(step as any);
  expect(owner).toBe("CategoryPage");
});

test("step click 'tarjeta de credito visa gold' deriva select_product y encuentra ProductListPage.selectProduct", () => {
  const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjeta de credito visa gold" } };
  const intent = deriveMethodIntentFromStep(step as any);
  expect(intent).toBe("select_product");

  const owner = deriveExpectedOwnerForStep(step as any);
  expect(owner).toBe("ProductListPage");
});

test("step click 'la primera tarjeta visible del listado de productos' deriva intent first-visible y owner ProductListPage", () => {
  const step = { index: 1, action: "click", target: { strategy: "text", value: "la primera tarjeta visible del listado de productos" } };
  const intent = deriveMethodIntentFromStep(step as any);
  expect(intent).toBe("select_first_visible_card");

  const owner = deriveExpectedOwnerForStep(step as any);
  expect(owner).toBe("ProductListPage");
});

test("spec generator produce method calls con parámetros", () => {
  const reg = makeRegistry();
  const r1 = registerPageObjectCandidate(reg, {
    name: "CategoryPage", className: "CategoryPage", screenSignature: "sig:category", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "selectCategory", intent: "select_category", parameters: ["categoryName"] }]
  });
  markPageObjectActive(r1.registry, r1.registry.pageObjects[0].id);
  markMethodActive(r1.registry, r1.registry.pageObjects[0].id, "selectCategory");

  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, title: "Test" },
    requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } }],
    createdAt: new Date().toISOString()
  };

  const result = generatePOMSpecFromPlan(plan, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  expect(result.pomStatus).toBe("promoted");
  expect(result.specContent).toContain("await categoryPage.selectCategory('tarjetas');");
});

test("POM promotion de C37844-style plan pasa cuando métodos están active/available", () => {
  const reg = makeRegistry();

  const r1 = registerPageObjectCandidate(reg, {
    name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "start", intent: "start_session" }]
  });
  const r2 = registerPageObjectCandidate(r1.registry, {
    name: "ProductInformationPage", className: "ProductInformationPage", screenSignature: "sig:productinfo", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "openProductInformation", intent: "open_product_information" }]
  });
  const r3 = registerPageObjectCandidate(r2.registry, {
    name: "CategoryPage", className: "CategoryPage", screenSignature: "sig:category", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "selectCategory", intent: "select_category", parameters: ["categoryName"] }]
  });
  const r4 = registerPageObjectCandidate(r3.registry, {
    name: "ProductListPage", className: "ProductListPage", screenSignature: "sig:productlist", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "selectProduct", intent: "select_product", parameters: ["productName"] }]
  });

  for (const po of r4.registry.pageObjects) {
    markPageObjectActive(r4.registry, po.id);
    for (const method of po.methods) {
      markMethodActive(r4.registry, po.id, method.name);
    }
  }

  const plan: ExecutionPlan = {
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

  const result = generatePOMSpecFromPlan(plan, "test-001", mockProfile, mockPaths, r4.registry, DEFAULT_PROMOTION_POLICY, false);
  expect(result.pomStatus).toBe("promoted");
  expect(result.missingMethods).toHaveLength(0);
  expect(result.usedPageObjects).toContain("HomePage");
  expect(result.usedPageObjects).toContain("ProductInformationPage");
  expect(result.usedPageObjects).toContain("CategoryPage");
  expect(result.usedPageObjects).toContain("ProductListPage");

  expect(result.specContent).toContain("await homePage.start();");
  expect(result.specContent).toContain("await productInformationPage.openProductInformation();");
  expect(result.specContent).toContain("await categoryPage.selectCategory('tarjetas');");
  expect(result.specContent).toContain("await productListPage.selectProduct('tarjeta de credito visa gold');");
});

test("needs_page_method diagnostics incluye derivedIntent y expectedOwner", () => {
  const reg = makeRegistry();
  const r1 = registerPageObjectCandidate(reg, {
    name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "open", intent: "open_home" }]
  });
  markPageObjectActive(r1.registry, r1.registry.pageObjects[0].id);
  markMethodActive(r1.registry, r1.registry.pageObjects[0].id, "open");

  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 1, title: "Test" },
    requiredData: [],
    steps: [{ index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } }],
    createdAt: new Date().toISOString()
  };

  const result = generatePOMSpecFromPlan(plan, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  expect(result.pomStatus).toBe("needs_page_method");
  expect(result.missingMethods.length).toBeGreaterThan(0);

  const diagnostic = result.missingMethods[0];
  expect(diagnostic).toContain("derivedIntent=");
  expect(diagnostic).toContain("select_category");
  expect(diagnostic).toContain("expectedOwner=");
  expect(diagnostic).toContain("CategoryPage");
});

test("login modal steps derive dedicated login intents", () => {
  const steps = [
    { index: 1, action: "click", target: { strategy: "text", value: "Log in", exact: false } },
    { index: 2, action: "assertText", target: { strategy: "text", value: "Username", exact: false } },
    { index: 3, action: "fill", target: { strategy: "text", value: "Username", exact: false }, valueKey: "usuario_valido" },
    { index: 4, action: "fill", target: { strategy: "text", value: "Password", exact: false }, valueKey: "contrasena_valida" },
    { index: 5, action: "click", target: { strategy: "text", value: "Log in", exact: false } }
  ] as any[];

  expect(deriveMethodIntentFromStepWithContext(steps[0], steps as any)).toBe("open_login_modal");
  expect(deriveExpectedOwnerForStep(steps[0], steps as any)).toBe("HomePage");

  expect(deriveMethodIntentFromStep(steps[1] as any)).toBe("expect_login_form");
  expect(deriveExpectedOwnerForStep(steps[1] as any)).toBe("LoginPage");

  expect(deriveMethodIntentFromStep(steps[2] as any)).toBe("fill_username");
  expect(deriveExpectedOwnerForStep(steps[2] as any)).toBe("LoginPage");

  expect(deriveMethodIntentFromStep(steps[3] as any)).toBe("fill_password");
  expect(deriveExpectedOwnerForStep(steps[3] as any)).toBe("LoginPage");

  expect(deriveMethodIntentFromStepWithContext(steps[4], steps as any)).toBe("submit_login");
  expect(deriveExpectedOwnerForStep(steps[4], steps as any)).toBe("LoginPage");
});
