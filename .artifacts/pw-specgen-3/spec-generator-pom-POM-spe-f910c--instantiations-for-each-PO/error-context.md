# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: spec-generator-pom.spec.ts >> POM spec generates imports and instantiations for each PO
- Location: tests\spec-generator-pom.spec.ts:88:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "promoted"
Received: "page_object_candidate_created"
```

# Test source

```ts
  13  |   baseUrl: "https://test.com",
  14  |   baseUrlHash: "abc123",
  15  |   createdAt: new Date().toISOString(),
  16  |   updatedAt: new Date().toISOString()
  17  | };
  18  | 
  19  | const mockPaths: AppAutomationPaths = {
  20  |   appDir: "/apps/test",
  21  |   configPath: "/apps/test/app.config.json",
  22  |   testDataRefsPath: "/apps/test/test-data.refs.json",
  23  |   indexPath: "/apps/test/index.json",
  24  |   pageObjectsIndexPath: "/apps/test/page-objects.index.json",
  25  |   flowsIndexPath: "/apps/test/flows.index.json",
  26  |   pagesDir: "/apps/test/pages",
  27  |   componentsDir: "/apps/test/components",
  28  |   flowsDir: "/apps/test/flows",
  29  |   casesDir: "/apps/test/cases",
  30  |   plansDir: "/apps/test/plans",
  31  |   specsDir: "/apps/test/specs",
  32  |   evidenceDir: "/apps/test/evidence",
  33  |   runsDir: "/apps/test/runs",
  34  |   specPath: "/apps/test/cases/test-001/spec.ts"
  35  | };
  36  | 
  37  | const mockPlan: ExecutionPlan = {
  38  |   version: "1.0",
  39  |   source: "discovery_generated",
  40  |   status: "validated",
  41  |   scenario: { source: "testrail", caseId: 1, title: "Test Case" },
  42  |   requiredData: [],
  43  |   steps: [
  44  |     { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Login" } },
  45  |     { index: 2, action: "fill", target: { strategy: "text", value: "username" }, value: "testuser" }
  46  |   ],
  47  |   createdAt: new Date().toISOString()
  48  | };
  49  | 
  50  | function makeRegistry(): PageObjectRegistry {
  51  |   return { version: "1.0", appSlug: "test", pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
  52  | }
  53  | 
  54  | test("POM spec without registry returns needs_page_object", () => {
  55  |   const result = generatePOMSpecFromPlan(mockPlan, "test-001", mockProfile, mockPaths, undefined, DEFAULT_PROMOTION_POLICY, false);
  56  |   expect(result.pomStatus).toBe("needs_page_object");
  57  |   expect(result.usedPageObjects).toHaveLength(0);
  58  | });
  59  | 
  60  | test("POM spec with active PO and method uses POM call", () => {
  61  |   const reg = makeRegistry();
  62  |   const r1 = registerPageObjectCandidate(reg, {
  63  |     name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.9, sourcePlanId: "plan_1",
  64  |     methods: [{ name: "start", intent: "start_session" }]
  65  |   });
  66  |   const poId = r1.registry.pageObjects[0].id;
  67  |   markPageObjectActive(r1.registry, poId);
  68  |   markMethodActive(r1.registry, poId, "start");
  69  | 
  70  |   const singleStepPlan: ExecutionPlan = {
  71  |     ...mockPlan,
  72  |     steps: [{ index: 1, action: "click", target: { strategy: "role", value: "button", name: "Iniciar" } }]
  73  |   };
  74  |   const result = generatePOMSpecFromPlan(singleStepPlan, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  75  |   expect(result.pomStatus).toBe("promoted");
  76  |   expect(result.usedPageObjects).toContain("HomePage");
  77  |   expect(result.specContent).toContain("import { HomePage } from");
  78  |   expect(result.specContent).toContain("const homePage = new HomePage(page);");
  79  |   expect(result.specContent).toContain("await homePage.start();");
  80  | });
  81  | 
  82  | test("POM spec with inline debug mode marks inline_debug_only", () => {
  83  |   const result = generatePOMSpecFromPlan(mockPlan, "test-001", mockProfile, mockPaths, undefined, DEFAULT_PROMOTION_POLICY, true);
  84  |   expect(result.pomStatus).toBe("inline_debug_only");
  85  |   expect(result.specContent).toContain("[INLINE DEBUG]");
  86  | });
  87  | 
  88  | test("POM spec generates imports and instantiations for each PO", () => {
  89  |   const reg = makeRegistry();
  90  |   const r1 = registerPageObjectCandidate(reg, {
  91  |     name: "CategoryPage", className: "CategoryPage", screenSignature: "sig:category", confidence: 0.8, sourcePlanId: "plan_1",
  92  |     methods: [{ name: "selectCategory", intent: "select_category", parameters: ["categoryName"] }]
  93  |   });
  94  |   const r1b = registerPageObjectCandidate(r1.registry, {
  95  |     name: "LoginPage", className: "LoginPage", screenSignature: "sig:login", confidence: 0.8, sourcePlanId: "plan_1",
  96  |     methods: [{ name: "fillUsername", intent: "fill_username", parameters: ["value"] }]
  97  |   });
  98  |   const r2 = r1b.registry;
  99  |   markPageObjectActive(r2, r2.pageObjects[0].id);
  100 |   markMethodActive(r2, r2.pageObjects[0].id, "selectCategory");
  101 |   markPageObjectActive(r2, r2.pageObjects[1].id);
  102 |   markMethodActive(r2, r2.pageObjects[1].id, "fillField");
  103 | 
  104 |   const planWithSemanticSteps: ExecutionPlan = {
  105 |     ...mockPlan,
  106 |     steps: [
  107 |       { index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } },
  108 |       { index: 2, action: "fill", target: { strategy: "text", value: "username" }, value: "testuser" }
  109 |     ]
  110 |   };
  111 | 
  112 |   const result = generatePOMSpecFromPlan(planWithSemanticSteps, "test-001", mockProfile, mockPaths, r2, DEFAULT_PROMOTION_POLICY, false);
> 113 |   expect(result.pomStatus).toBe("promoted");
      |                            ^ Error: expect(received).toBe(expected) // Object.is equality
  114 |   expect(result.specContent).toContain("import { CategoryPage } from");
  115 |   expect(result.specContent).toContain("import { LoginPage } from");
  116 |   expect(result.specContent).toContain("const categoryPage = new CategoryPage(page);");
  117 |   expect(result.specContent).toContain("const loginPage = new LoginPage(page);");
  118 | });
  119 | 
  120 | test("POM spec avoids duplicate imports", () => {
  121 |   const reg = makeRegistry();
  122 |   const r1 = registerPageObjectCandidate(reg, {
  123 |     name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.8, sourcePlanId: "plan_1",
  124 |     methods: [
  125 |       { name: "start", intent: "start_session" },
  126 |       { name: "open", intent: "open_home" }
  127 |     ]
  128 |   });
  129 |   const poId = r1.registry.pageObjects[0].id;
  130 |   markPageObjectActive(r1.registry, poId);
  131 |   markMethodActive(r1.registry, poId, "start");
  132 |   markMethodActive(r1.registry, poId, "open");
  133 | 
  134 |   const planWithTwoActions: ExecutionPlan = {
  135 |     ...mockPlan,
  136 |     steps: [
  137 |       { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Iniciar" } },
  138 |       { index: 2, action: "navigate", target: { strategy: "text", value: "home" } }
  139 |     ]
  140 |   };
  141 |   const result = generatePOMSpecFromPlan(planWithTwoActions, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  142 |   const importCount = (result.specContent.match(/import { HomePage } from/g) || []).length;
  143 |   expect(importCount).toBe(1);
  144 | });
  145 | 
  146 | test("POM spec without method returns needs_page_method", () => {
  147 |   const reg = makeRegistry();
  148 |   const r1 = registerPageObjectCandidate(reg, {
  149 |     name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.9, sourcePlanId: "plan_1",
  150 |     methods: [{ name: "open", intent: "open_home" }]
  151 |   });
  152 |   markPageObjectActive(r1.registry, r1.registry.pageObjects[0].id);
  153 |   markMethodActive(r1.registry, r1.registry.pageObjects[0].id, "open");
  154 | 
  155 |   const result = generatePOMSpecFromPlan(mockPlan, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  156 |   expect(result.pomStatus).toBe("needs_page_method");
  157 |   expect(result.missingMethods.length).toBeGreaterThan(0);
  158 | });
  159 | 
  160 | test("POM spec with candidate generation creates candidate entries", () => {
  161 |   const reg = makeRegistry();
  162 |   const r1 = registerPageObjectCandidate(reg, {
  163 |     name: "CategoryPage", className: "CategoryPage", screenSignature: "sig:category", confidence: 0.6, sourcePlanId: "plan_1",
  164 |     methods: [{ name: "selectCategory", intent: "select_category", parameters: ["categoryName"] }]
  165 |   });
  166 | 
  167 |   const planWithCategoryStep: ExecutionPlan = {
  168 |     ...mockPlan,
  169 |     steps: [{ index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } }]
  170 |   };
  171 | 
  172 |   const result = generatePOMSpecFromPlan(planWithCategoryStep, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  173 |   expect(result.generatedCandidates).toBe(1);
  174 |   expect(result.specContent).toContain("// candidate method");
  175 | });
  176 | 
  177 | test("POM spec contains test title from plan", () => {
  178 |   const result = generatePOMSpecFromPlan(mockPlan, "test-001", mockProfile, mockPaths, undefined, DEFAULT_PROMOTION_POLICY, false);
  179 |   expect(result.specContent).toContain(mockPlan.scenario.title);
  180 | });
  181 | 
  182 | // --- C37869 scenario tests ---
  183 | 
  184 | const contaminatedDescription = "clic en iniciarclic en transacciones y servicioclic en Cédula de identidad dominicanaclic en continuar  Acceder al módulo \"Generar cartas\".Seleccionar \"Carta de referencia\".Seleccionar el producto \"cuenta de ahorros\".clic en continuarSeleccionar A quien pueda interesarclic en continuarValidar que se muestre la vista previa de la carta.";
  185 | 
  186 | test("C37869: contaminated description does not cause all steps to derive start_session", () => {
  187 |   const reg = makeRegistry();
  188 | 
  189 |   const r1 = registerPageObjectCandidate(reg, {
  190 |     name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.9, sourcePlanId: "plan_1",
  191 |     methods: [
  192 |       { name: "start", intent: "start_session" },
  193 |       { name: "open", intent: "open_home" }
  194 |     ]
  195 |   });
  196 |   markPageObjectActive(r1.registry, r1.registry.pageObjects[0].id);
  197 |   markMethodActive(r1.registry, r1.registry.pageObjects[0].id, "start");
  198 |   markMethodActive(r1.registry, r1.registry.pageObjects[0].id, "open");
  199 | 
  200 |   // Register ProductListPage with selectProduct method
  201 |   const r2 = registerPageObjectCandidate(r1.registry, {
  202 |     name: "ProductListPage", className: "ProductListPage", screenSignature: "sig:products", confidence: 0.9, sourcePlanId: "plan_1",
  203 |     methods: [
  204 |       { name: "selectProduct", intent: "select_product", parameters: ["productName"] },
  205 |       { name: "openModule", intent: "open_home", parameters: ["moduleName"] }
  206 |     ]
  207 |   });
  208 |   markPageObjectActive(r2.registry, r2.registry.pageObjects[1].id);
  209 |   markMethodActive(r2.registry, r2.registry.pageObjects[1].id, "selectProduct");
  210 |   markMethodActive(r2.registry, r2.registry.pageObjects[1].id, "openModule");
  211 | 
  212 |   const plan: ExecutionPlan = {
  213 |     version: "1.0",
```