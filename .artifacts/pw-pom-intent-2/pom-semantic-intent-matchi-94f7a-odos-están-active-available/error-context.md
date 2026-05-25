# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pom-semantic-intent-matching.spec.ts >> POM promotion de C37844-style plan pasa cuando métodos están active/available
- Location: tests\pom-semantic-intent-matching.spec.ts:102:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "promoted"
Received: "needs_page_method"
```

# Test source

```ts
  45  |   expect(intent).toBe("start_session");
  46  | 
  47  |   const owner = deriveExpectedOwnerForStep(step as any);
  48  |   expect(owner).toBe("HomePage");
  49  | });
  50  | 
  51  | test("step click 'Información de productos' deriva open_product_information", () => {
  52  |   const step = { index: 1, action: "click", target: { strategy: "role", value: "button", name: "Información de productos" } };
  53  |   const intent = deriveMethodIntentFromStep(step as any);
  54  |   expect(intent).toBe("open_product_information");
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
> 145 |   expect(result.pomStatus).toBe("promoted");
      |                            ^ Error: expect(received).toBe(expected) // Object.is equality
  146 |   expect(result.missingMethods).toHaveLength(0);
  147 |   expect(result.usedPageObjects).toContain("HomePage");
  148 |   expect(result.usedPageObjects).toContain("ProductInformationPage");
  149 |   expect(result.usedPageObjects).toContain("CategoryPage");
  150 |   expect(result.usedPageObjects).toContain("ProductListPage");
  151 | 
  152 |   expect(result.specContent).toContain("await homePage.start();");
  153 |   expect(result.specContent).toContain("await productInformationPage.openProductInformation();");
  154 |   expect(result.specContent).toContain("await categoryPage.selectCategory('tarjetas');");
  155 |   expect(result.specContent).toContain("await productListPage.selectProduct('tarjeta de credito visa gold');");
  156 | });
  157 | 
  158 | test("needs_page_method diagnostics incluye derivedIntent y expectedOwner", () => {
  159 |   const reg = makeRegistry();
  160 |   const r1 = registerPageObjectCandidate(reg, {
  161 |     name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.8, sourcePlanId: "plan_1",
  162 |     methods: [{ name: "open", intent: "open_home" }]
  163 |   });
  164 |   markPageObjectActive(r1.registry, r1.registry.pageObjects[0].id);
  165 |   markMethodActive(r1.registry, r1.registry.pageObjects[0].id, "open");
  166 | 
  167 |   const plan: ExecutionPlan = {
  168 |     version: "1.0",
  169 |     source: "discovery_generated",
  170 |     status: "validated",
  171 |     scenario: { source: "testrail", caseId: 1, title: "Test" },
  172 |     requiredData: [],
  173 |     steps: [{ index: 1, action: "click", target: { strategy: "role", value: "button", name: "tarjetas" } }],
  174 |     createdAt: new Date().toISOString()
  175 |   };
  176 | 
  177 |   const result = generatePOMSpecFromPlan(plan, "test-001", mockProfile, mockPaths, r1.registry, DEFAULT_PROMOTION_POLICY, false);
  178 |   expect(result.pomStatus).toBe("needs_page_method");
  179 |   expect(result.missingMethods.length).toBeGreaterThan(0);
  180 | 
  181 |   const diagnostic = result.missingMethods[0];
  182 |   expect(diagnostic).toContain("derivedIntent=");
  183 |   expect(diagnostic).toContain("select_category");
  184 |   expect(diagnostic).toContain("expectedOwner=");
  185 |   expect(diagnostic).toContain("CategoryPage");
  186 | });
  187 | 
  188 | test("login modal steps derive dedicated login intents", () => {
  189 |   const steps = [
  190 |     { index: 1, action: "click", target: { strategy: "text", value: "Log in", exact: false } },
  191 |     { index: 2, action: "assertText", target: { strategy: "text", value: "Username", exact: false } },
  192 |     { index: 3, action: "fill", target: { strategy: "text", value: "Username", exact: false }, valueKey: "usuario_valido" },
  193 |     { index: 4, action: "fill", target: { strategy: "text", value: "Password", exact: false }, valueKey: "contrasena_valida" },
  194 |     { index: 5, action: "click", target: { strategy: "text", value: "Log in", exact: false } }
  195 |   ] as any[];
  196 | 
  197 |   expect(deriveMethodIntentFromStepWithContext(steps[0], steps as any)).toBe("open_login_modal");
  198 |   expect(deriveExpectedOwnerForStep(steps[0], steps as any)).toBe("HomePage");
  199 | 
  200 |   expect(deriveMethodIntentFromStep(steps[1] as any)).toBe("expect_login_form");
  201 |   expect(deriveExpectedOwnerForStep(steps[1] as any)).toBe("LoginPage");
  202 | 
  203 |   expect(deriveMethodIntentFromStep(steps[2] as any)).toBe("fill_username");
  204 |   expect(deriveExpectedOwnerForStep(steps[2] as any)).toBe("LoginPage");
  205 | 
  206 |   expect(deriveMethodIntentFromStep(steps[3] as any)).toBe("fill_password");
  207 |   expect(deriveExpectedOwnerForStep(steps[3] as any)).toBe("LoginPage");
  208 | 
  209 |   expect(deriveMethodIntentFromStepWithContext(steps[4], steps as any)).toBe("submit_login");
  210 |   expect(deriveExpectedOwnerForStep(steps[4], steps as any)).toBe("LoginPage");
  211 | });
  212 | 
```