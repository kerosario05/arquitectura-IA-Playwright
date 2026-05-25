# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pom-semantic-intent-matching.spec.ts >> step click 'Información de productos' deriva open_product_information
- Location: tests\pom-semantic-intent-matching.spec.ts:51:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "open_product_information"
Received: "click_primary_action"
```

# Test source

```ts
  1   | import { test, expect } from "@playwright/test";
  2   | import { generatePOMSpecFromPlan } from "../src/automations/spec-generator-pom";
  3   | import { DEFAULT_PROMOTION_POLICY } from "../src/types/automation-promotion.types";
  4   | import type { ExecutionPlan } from "../src/types/execution-plan.types";
  5   | import type { AppProfile, AppAutomationPaths } from "../src/automations/app-profile";
  6   | import type { PageObjectRegistry } from "../src/types/page-object.types";
  7   | import { registerPageObjectCandidate, markPageObjectActive, markMethodActive } from "../src/automations/page-object-registry";
  8   | import { deriveMethodIntentFromStep, deriveMethodIntentFromStepWithContext, deriveExpectedOwnerForStep } from "../src/automations/pom-classification";
  9   | 
  10  | const mockProfile: AppProfile = {
  11  |   appSlug: "test",
  12  |   source: "default",
  13  |   name: "Test",
  14  |   baseUrl: "https://test.com",
  15  |   baseUrlHash: "abc123",
  16  |   createdAt: new Date().toISOString(),
  17  |   updatedAt: new Date().toISOString()
  18  | };
  19  | 
  20  | const mockPaths: AppAutomationPaths = {
  21  |   appDir: "/apps/test",
  22  |   configPath: "/apps/test/app.config.json",
  23  |   testDataRefsPath: "/apps/test/test-data.refs.json",
  24  |   indexPath: "/apps/test/index.json",
  25  |   pageObjectsIndexPath: "/apps/test/page-objects.index.json",
  26  |   flowsIndexPath: "/apps/test/flows.index.json",
  27  |   pagesDir: "/apps/test/pages",
  28  |   componentsDir: "/apps/test/components",
  29  |   flowsDir: "/apps/test/flows",
  30  |   casesDir: "/apps/test/cases",
  31  |   plansDir: "/apps/test/plans",
  32  |   specsDir: "/apps/test/specs",
  33  |   evidenceDir: "/apps/test/evidence",
  34  |   runsDir: "/apps/test/runs",
  35  |   specPath: "/apps/test/cases/test-001/spec.ts"
  36  | };
  37  | 
  38  | function makeRegistry(): PageObjectRegistry {
  39  |   return { version: "1.0", appSlug: "test", pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
  40  | }
  41  | 
  42  | test("step click 'Iniciar' deriva start_session y encuentra HomePage.start", () => {
  43  |   const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Iniciar" } };
  44  |   const intent = deriveMethodIntentFromStep(step as any);
  45  |   expect(intent).toBe("start_session");
  46  | 
  47  |   const owner = deriveExpectedOwnerForStep(step as any);
  48  |   expect(owner).toBe("HomePage");
  49  | });
  50  | 
  51  | test("step click 'Información de productos' deriva open_product_information", () => {
  52  |   const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Información de productos" } };
  53  |   const intent = deriveMethodIntentFromStep(step as any);
> 54  |   expect(intent).toBe("open_product_information");
      |                  ^ Error: expect(received).toBe(expected) // Object.is equality
  55  | 
  56  |   const owner = deriveExpectedOwnerForStep(step as any);
  57  |   expect(owner).toBe("ProductInformationPage");
  58  | });
  59  | 
  60  | test("step click 'tarjetas' deriva select_category y encuentra CategoryPage.selectCategory", () => {
  61  |   const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } };
  62  |   const intent = deriveMethodIntentFromStep(step as any);
  63  |   expect(intent).toBe("select_category");
  64  | 
  65  |   const owner = deriveExpectedOwnerForStep(step as any);
  66  |   expect(owner).toBe("CategoryPage");
  67  | });
  68  | 
  69  | test("step click 'tarjeta de credito visa gold' deriva select_product y encuentra ProductListPage.selectProduct", () => {
  70  |   const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjeta de credito visa gold" } };
  71  |   const intent = deriveMethodIntentFromStep(step as any);
  72  |   expect(intent).toBe("select_product");
  73  | 
  74  |   const owner = deriveExpectedOwnerForStep(step as any);
  75  |   expect(owner).toBe("ProductListPage");
  76  | });
  77  | 
  78  | test("spec generator produce method calls con parámetros", () => {
  79  |   const reg = makeRegistry();
  80  |   const r1 = registerPageObjectCandidate(reg, {
  81  |     name: "CategoryPage", className: "CategoryPage", screenSignature: "sig:category", confidence: 0.8, sourcePlanId: "plan_1",
  82  |     methods: [{ name: "selectCategory", intent: "select_category", parameters: ["categoryName"] }]
  83  |   });
  84  |   markPageObjectActive(r1.registry, r1.registry.pageObjects[0].id);
  85  |   markMethodActive(r1.registry, r1.registry.pageObjects[0].id, "selectCategory");
  86  | 
  87  |   const plan: ExecutionPlan = {
  88  |     version: "1.0",
  89  |     source: "discovery_generated",
  90  |     status: "validated",
  91  |     scenario: { source: "testrail", caseId: 1, title: "Test" },
  92  |     requiredData: [],
  93  |     steps: [{ index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } }],
  94  |     createdAt: new Date().toISOString()
  95  |   };
  96  | 
  97  |   const result = generatePOMSpecFromPlan(plan, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  98  |   expect(result.pomStatus).toBe("promoted");
  99  |   expect(result.specContent).toContain("await categoryPage.selectCategory('tarjetas');");
  100 | });
  101 | 
  102 | test("POM promotion de C37844-style plan pasa cuando métodos están active/available", () => {
  103 |   const reg = makeRegistry();
  104 | 
  105 |   const r1 = registerPageObjectCandidate(reg, {
  106 |     name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.8, sourcePlanId: "plan_1",
  107 |     methods: [{ name: "start", intent: "start_session" }]
  108 |   });
  109 |   const r2 = registerPageObjectCandidate(r1.registry, {
  110 |     name: "ProductInformationPage", className: "ProductInformationPage", screenSignature: "sig:productinfo", confidence: 0.8, sourcePlanId: "plan_1",
  111 |     methods: [{ name: "openProductInformation", intent: "open_product_information" }]
  112 |   });
  113 |   const r3 = registerPageObjectCandidate(r2.registry, {
  114 |     name: "CategoryPage", className: "CategoryPage", screenSignature: "sig:category", confidence: 0.8, sourcePlanId: "plan_1",
  115 |     methods: [{ name: "selectCategory", intent: "select_category", parameters: ["categoryName"] }]
  116 |   });
  117 |   const r4 = registerPageObjectCandidate(r3.registry, {
  118 |     name: "ProductListPage", className: "ProductListPage", screenSignature: "sig:productlist", confidence: 0.8, sourcePlanId: "plan_1",
  119 |     methods: [{ name: "selectProduct", intent: "select_product", parameters: ["productName"] }]
  120 |   });
  121 | 
  122 |   for (const po of r4.registry.pageObjects) {
  123 |     markPageObjectActive(r4.registry, po.id);
  124 |     for (const method of po.methods) {
  125 |       markMethodActive(r4.registry, po.id, method.name);
  126 |     }
  127 |   }
  128 | 
  129 |   const plan: ExecutionPlan = {
  130 |     version: "1.0",
  131 |     source: "discovery_generated",
  132 |     status: "validated",
  133 |     scenario: { source: "testrail", caseId: 37844, title: "Visualizar detalle de Tarjeta Visa Gold" },
  134 |     requiredData: [],
  135 |     steps: [
  136 |       { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Iniciar" } },
  137 |       { index: 2, action: "click", target: { strategy: "role", value: "button", name: "Información de productos" } },
  138 |       { index: 3, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } },
  139 |       { index: 4, action: "click", target: { strategy: "role", value: "button", name: "tarjeta de credito visa gold" } }
  140 |     ],
  141 |     createdAt: new Date().toISOString()
  142 |   };
  143 | 
  144 |   const result = generatePOMSpecFromPlan(plan, "test-001", mockProfile, mockPaths, r4.registry, DEFAULT_PROMOTION_POLICY, false);
  145 |   expect(result.pomStatus).toBe("promoted");
  146 |   expect(result.missingMethods).toHaveLength(0);
  147 |   expect(result.usedPageObjects).toContain("HomePage");
  148 |   expect(result.usedPageObjects).toContain("ProductInformationPage");
  149 |   expect(result.usedPageObjects).toContain("CategoryPage");
  150 |   expect(result.usedPageObjects).toContain("ProductListPage");
  151 | 
  152 |   expect(result.specContent).toContain("await homePage.start();");
  153 |   expect(result.specContent).toContain("await productInformationPage.openProductInformation();");
  154 |   expect(result.specContent).toContain("await categoryPage.selectCategory('tarjetas');");
```