import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { promoteExecutionPlan } from "../src/automations/promote-plan";
import { loadAutomationIndex } from "../src/automations/automation-index";
import { loadPageObjectRegistry } from "../src/automations/page-object-registry";
import { loadFlowRegistry } from "../src/automations/flow-registry";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { FullConfig } from "../src/types/env.types";
import { DEFAULT_PROMOTION_POLICY } from "../src/types/automation-promotion.types";
import { getTestTempDir, ensureTestTempDir, cleanTestTempDir } from "./helpers/test-temp-dir";

const tmpDir = getTestTempDir("test-promote");

function makePlan(overrides: {
  externalId?: string;
  caseId?: number;
  title?: string;
  status?: ExecutionPlan["status"];
} = {}): ExecutionPlan {
  const status: ExecutionPlan["status"] = overrides.status ?? "validated";
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

function makeConfig(appProfile = "profile-a", baseUrl = "https://app-a.example.test"): FullConfig {
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

test.beforeAll(async () => {
  await ensureTestTempDir("test-promote");
});

test.afterAll(async () => {
  await cleanTestTempDir("test-promote").catch(() => {});
});

test("promotes validated plan into app package", async () => {
  const plan = makePlan({ externalId: "C99999" });
  const entry = await promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig() }, false);
  const normalizedPlanPath = entry.planPath.replace(/\\/g, "/");
  const normalizedSpecPath = entry.specPath.replace(/\\/g, "/");
  expect(entry.id).toBe("c99999-generic-automation");
  expect(entry.appSlug).toBe("profile-a");
  expect(normalizedPlanPath).toContain("automations/apps/profile-a/cases/c99999-generic-automation/plan.json");
  expect(normalizedSpecPath).toContain("automations/apps/profile-a/cases/c99999-generic-automation/case.spec.ts");
});

test("plans:promote saves app.config.json", async () => {
  const plan = makePlan({ externalId: "C10000" });
  await promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-b", "https://app-b.example.test") }, false);
  const configPath = path.join(tmpDir, "automations/apps/profile-b/app.config.json");
  const content = await fs.readFile(configPath, "utf-8");
  const parsed = JSON.parse(content);
  expect(parsed.appProfile.appSlug).toBe("profile-b");
  expect(parsed.baseUrl).toBe("https://app-b.example.test");
});

test("creates app-specific plan and spec files", async () => {
  const plan = makePlan({ externalId: "C10001" });
  await promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-c") }, false);
  const planPath = path.join(tmpDir, "automations/apps/profile-c/cases/c10001-generic-automation/plan.json");
  const specPath = path.join(tmpDir, "automations/apps/profile-c/cases/c10001-generic-automation/case.spec.ts");
  const casePath = path.join(tmpDir, "automations/apps/profile-c/cases/c10001-generic-automation/case.json");
  const automationPath = path.join(tmpDir, "automations/apps/profile-c/cases/c10001-generic-automation/automation.json");
  await expect(fs.readFile(planPath, "utf-8")).resolves.toContain("\"version\": \"1.0\"");
  await expect(fs.readFile(specPath, "utf-8")).resolves.toContain("loadPromotedAppConfigSync");
  await expect(fs.readFile(casePath, "utf-8")).resolves.toContain("\"externalId\": \"C10001\"");
  await expect(fs.readFile(automationPath, "utf-8")).resolves.toContain("\"id\": \"c10001-generic-automation\"");
});

test("updates per-app index and global index references", async () => {
  const plan = makePlan({ externalId: "C10002" });
  await promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-d") }, false);
  const appIndex = await loadAutomationIndex(path.join(tmpDir, "automations/apps/profile-d/index.json"));
  const globalIndex = await loadAutomationIndex(path.join(tmpDir, "automations/index.json"));
  expect(appIndex.automations.some((a) => a.externalId === "C10002" && a.appSlug === "profile-d")).toBe(true);
  expect(globalIndex.automations.some((a) => a.externalId === "C10002" && a.appSlug === "profile-d")).toBe(true);
});

test("rejects non-promotable status", async () => {
  const plan = makePlan({ status: "needs_discovery" });
  await expect(promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-e") }, false)).rejects.toThrow(/not eligible/i);
});

test("automation existing + overwrite=false throws error", async () => {
  const plan = makePlan({ externalId: "C20001", title: "Overwrite test false" });
  await promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-ow-false") }, false);

  await expect(
    promoteExecutionPlan({ plan, outputRoot: tmpDir, fullConfig: makeConfig("profile-ow-false") }, false)
  ).rejects.toThrow(/already exists.*Use --overwrite/i);
});

test("automation existing + overwrite=true replaces plan and spec", async () => {
  const plan1 = makePlan({ externalId: "C20002", title: "Overwrite test" });
  const entry1 = await promoteExecutionPlan({ plan: plan1, outputRoot: tmpDir, fullConfig: makeConfig("profile-ow-true") }, false);

  const caseDir = path.dirname(entry1.planPath);
  const planPath = path.join(caseDir, "plan.json");
  const specPath = path.join(caseDir, "case.spec.ts");

  const planContent1 = await fs.readFile(planPath, "utf-8");
  expect(planContent1).toContain("\"externalId\": \"C20002\"");

  const plan2 = makePlan({ externalId: "C20002", title: "Overwrite test", status: "validated" });
  const plan2WithNote = { ...plan2, notes: ["updated by overwrite test"] } as ExecutionPlan;
  const entry2 = await promoteExecutionPlan({ plan: plan2WithNote, outputRoot: tmpDir, overwrite: true, fullConfig: makeConfig("profile-ow-true") }, false);

  const planContent2 = await fs.readFile(planPath, "utf-8");
  expect(planContent2).toContain("updated by overwrite test");

  const specContent = await fs.readFile(specPath, "utf-8");
  expect(specContent).toContain("loadPromotedAppConfigSync");

  expect(entry2.metadata?.overwritten).toBe(true);
  expect(entry2.metadata?.previousAutomationPath).toContain("plan.json");
});

test("overwrite=true records previousStatus in metadata", async () => {
  const plan1 = makePlan({ externalId: "C20003", title: "Overwrite status test" });
  await promoteExecutionPlan({ plan: plan1, outputRoot: tmpDir, fullConfig: makeConfig("profile-ow-status") }, false);

  const plan2 = { ...makePlan({ externalId: "C20003", title: "Overwrite status test" }), notes: ["v2 update"] } as ExecutionPlan;
  const entry = await promoteExecutionPlan({ plan: plan2, outputRoot: tmpDir, overwrite: true, fullConfig: makeConfig("profile-ow-status") }, false);

  expect(entry.metadata?.overwritten).toBe(true);
  expect(entry.metadata?.previousStatus).toBe("active");
});

test("overwrite=true does not throw when automation does not exist yet", async () => {
  const plan = makePlan({ externalId: "C20004", title: "New automation" });
  const entry = await promoteExecutionPlan({ plan, outputRoot: tmpDir, overwrite: true, fullConfig: makeConfig("profile-ow-new") }, false);

  expect(entry.id).toBe("c20004-new-automation");
  expect(entry.metadata?.overwritten).toBeUndefined();
});

test("overwrite=true with inlineDebugMode sets pomStatus inline_debug_only", async () => {
  const plan1 = makePlan({ externalId: "C20005", title: "Inline debug overwrite" });
  await promoteExecutionPlan({ plan: plan1, outputRoot: tmpDir, fullConfig: makeConfig("profile-ow-inline"), inlineDebugMode: true }, false);

  const plan2 = { ...makePlan({ externalId: "C20005", title: "Inline debug overwrite" }), notes: ["v2 update"] } as ExecutionPlan;
  const entry = await promoteExecutionPlan({ plan: plan2, outputRoot: tmpDir, overwrite: true, fullConfig: makeConfig("profile-ow-inline"), inlineDebugMode: true }, false);

  expect(entry.pomStatus).toBe("inline_debug_only");
  expect(entry.metadata?.overwritten).toBe(true);
});

test("needs_page_object creates page-objects.index.json", async () => {
  const plan: ExecutionPlan = {
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
  const entry = await promoteExecutionPlan({
    plan,
    outputRoot: tmpDir,
    fullConfig: makeConfig("profile-pom-needs-po"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  expect(entry.pomStatus).toBe("needs_page_object");

  const registryPath = path.join(tmpDir, "automations/apps/profile-pom-needs-po/page-objects.index.json");
  await expect(fs.access(registryPath)).resolves.toBeUndefined();

  const registry = await loadPageObjectRegistry({ appSlug: "profile-pom-needs-po" } as any, tmpDir);
  expect(registry.pageObjects.length).toBeGreaterThan(0);
  expect(registry.pageObjects[0].status).toBe("candidate");

  const classNames = registry.pageObjects.map((po) => po.className);
  expect(classNames).not.toContain("PomMissingPageObjectTestPage");
  expect(classNames.some((c) => c === "HomePage" || c === "CategoryPage" || c === "ProductListPage")).toBe(true);
});

test("needs_page_object generates generic reusable Page Objects not case-specific", async () => {
  const plan: ExecutionPlan = {
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

  await promoteExecutionPlan({
    plan,
    outputRoot: tmpDir,
    fullConfig: makeConfig("profile-pom-generic"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  const registry = await loadPageObjectRegistry({ appSlug: "profile-pom-generic" } as any, tmpDir);
  const classNames = registry.pageObjects.map((po) => po.className);

  expect(classNames).not.toContain("VisualizarDetalleDeTarjetaVisaGoldPage");
  expect(classNames).not.toContain("GenericPage");

  const allMethodNames = registry.pageObjects.flatMap((po) => po.methods.map((m) => m.name));
  expect(allMethodNames).not.toContain("clickTarjetaDeCreditoVisaGold");
  expect(allMethodNames).not.toContain("clickInformacinDeProductos");

  expect(classNames.some((c) => c === "HomePage")).toBe(true);
  expect(classNames.some((c) => c === "CategoryPage")).toBe(true);
  expect(classNames.some((c) => c === "ProductListPage")).toBe(true);

  const homePO = registry.pageObjects.find((po) => po.className === "HomePage");
  expect(homePO).toBeDefined();
  expect(homePO!.methods.some((m) => m.intent === "start_session")).toBe(true);
  expect(homePO!.methods.some((m) => m.name === "start")).toBe(true);

  const categoryPO = registry.pageObjects.find((po) => po.className === "CategoryPage");
  expect(categoryPO).toBeDefined();
  expect(categoryPO!.methods.some((m) => m.intent === "select_category")).toBe(true);

  const productListPO = registry.pageObjects.find((po) => po.className === "ProductListPage");
  expect(productListPO).toBeDefined();
  expect(productListPO!.methods.some((m) => m.intent === "select_product")).toBe(true);

  const productListMethodNames = productListPO!.methods.map((m) => m.name);
  expect(productListMethodNames).not.toContain("start");
  expect(productListMethodNames).not.toContain("startSession");

  const productDetailPO = registry.pageObjects.find((po) => po.className === "ProductDetailPage");
  if (productDetailPO) {
    const detailMethodNames = productDetailPO.methods.map((m) => m.name);
    expect(detailMethodNames).not.toContain("selectProduct");
    expect(detailMethodNames).not.toContain("select_product");
  }
});

test("Iniciar genera HomePage.start no ProductListPage.start", async () => {
  const plan: ExecutionPlan = {
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

  await promoteExecutionPlan({
    plan,
    outputRoot: tmpDir,
    fullConfig: makeConfig("profile-pom-start"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  const registry = await loadPageObjectRegistry({ appSlug: "profile-pom-start" } as any, tmpDir);
  const homePO = registry.pageObjects.find((po) => po.className === "HomePage");
  expect(homePO).toBeDefined();
  expect(homePO!.methods.some((m) => m.name === "start")).toBe(true);
  expect(homePO!.methods.some((m) => m.intent === "start_session")).toBe(true);

  const productListPO = registry.pageObjects.find((po) => po.className === "ProductListPage");
  if (productListPO) {
    expect(productListPO.methods.some((m) => m.name === "start")).toBe(false);
  }
});

test("Informacion de productos genera openProductInformation no ProductListPage method", async () => {
  const plan: ExecutionPlan = {
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

  await promoteExecutionPlan({
    plan,
    outputRoot: tmpDir,
    fullConfig: makeConfig("profile-pom-prodinfo"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  const registry = await loadPageObjectRegistry({ appSlug: "profile-pom-prodinfo" } as any, tmpDir);

  const productInfoPO = registry.pageObjects.find((po) => po.className === "ProductInformationPage");
  expect(productInfoPO).toBeDefined();

  const hasOpenProductInfo = productInfoPO!.methods.some((m) =>
    m.name === "openProductInformation" || m.intent === "open_product_information"
  );
  expect(hasOpenProductInfo).toBe(true);

  const allMethodNames = registry.pageObjects.flatMap((po) => po.methods.map((m) => m.name));
  expect(allMethodNames).not.toContain("selectProduct");
});

test("ProductDetailPage no contiene selectProduct", async () => {
  const plan: ExecutionPlan = {
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

  await promoteExecutionPlan({
    plan,
    outputRoot: tmpDir,
    fullConfig: makeConfig("profile-pom-detail"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  const registry = await loadPageObjectRegistry({ appSlug: "profile-pom-detail" } as any, tmpDir);

  const allMethods = registry.pageObjects.flatMap((po) => po.methods);
  const selectProductMethods = allMethods.filter((m) => m.intent === "select_product" || m.name === "selectProduct");
  expect(selectProductMethods.length).toBe(0);

  const detailPO = registry.pageObjects.find((po) => po.className === "ProductDetailPage");
  if (detailPO) {
    const detailIntents = detailPO.methods.map((m) => m.intent);
    expect(detailIntents).not.toContain("select_product");
  }
});

test("click tarjetas generates selectCategory not clickTarjetas", async () => {
  const plan: ExecutionPlan = {
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

  await promoteExecutionPlan({
    plan,
    outputRoot: tmpDir,
    fullConfig: makeConfig("profile-pom-category"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  const registry = await loadPageObjectRegistry({ appSlug: "profile-pom-category" } as any, tmpDir);
  const categoryPO = registry.pageObjects.find((po) => po.className === "CategoryPage");
  expect(categoryPO).toBeDefined();
  expect(categoryPO!.methods.some((m) => m.name === "selectCategory")).toBe(true);
  expect(categoryPO!.methods.some((m) => m.name === "clickTarjetas")).toBe(false);
});

test("click producto generates selectProduct not clickProducto", async () => {
  const plan: ExecutionPlan = {
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

  await promoteExecutionPlan({
    plan,
    outputRoot: tmpDir,
    fullConfig: makeConfig("profile-pom-product"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  const registry = await loadPageObjectRegistry({ appSlug: "profile-pom-product" } as any, tmpDir);
  const productListPO = registry.pageObjects.find((po) => po.className === "ProductListPage");
  expect(productListPO).toBeDefined();
  expect(productListPO!.methods.some((m) => m.name === "selectProduct")).toBe(true);
  expect(productListPO!.methods.some((m) => m.name === "clickTarjetaDeCreditoVisaGold")).toBe(false);
});

test("navigate APP_BASE_URL no genera navigatenavigateAPPBASEURL", async () => {
  const plan: ExecutionPlan = {
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

  await promoteExecutionPlan({
    plan,
    outputRoot: tmpDir,
    fullConfig: makeConfig("profile-pom-navigate"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  const registry = await loadPageObjectRegistry({ appSlug: "profile-pom-navigate" } as any, tmpDir);

  const allMethodNames = registry.pageObjects.flatMap((po) => po.methods.map((m) => m.name));
  expect(allMethodNames).not.toContain("navigatenavigateAPPBASEURL");
  expect(allMethodNames).not.toContain("navigateNavigateAppBaseUrl");
  expect(allMethodNames).not.toContain("openHome");

  const flowReg = await loadFlowRegistry({ appSlug: "profile-pom-navigate" } as any, tmpDir);
  expect(flowReg.flows.length).toBeGreaterThan(0);
  const flowMethodNames = flowReg.flows[0].steps.map((s) => s.methodName);
  expect(flowMethodNames).toContain("open");
});

test("login generates LoginPage candidate not loginlogin inside product PO", async () => {
  const plan: ExecutionPlan = {
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

  await promoteExecutionPlan({
    plan,
    outputRoot: tmpDir,
    fullConfig: makeConfig("profile-pom-login"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  const registry = await loadPageObjectRegistry({ appSlug: "profile-pom-login" } as any, tmpDir);
  const allMethodNames = registry.pageObjects.flatMap((po) => po.methods.map((m) => m.name));

  expect(allMethodNames).not.toContain("loginlogin");

  const categoryPO = registry.pageObjects.find((po) => po.className === "CategoryPage");
  expect(categoryPO).toBeDefined();
  const categoryMethodNames = categoryPO!.methods.map((m) => m.name);
  expect(categoryMethodNames).not.toContain("loginlogin");
  expect(categoryMethodNames).not.toContain("start");
});

test("C37844 y C37845 comparten candidates genericos", async () => {
  const plan1: ExecutionPlan = {
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

  await promoteExecutionPlan({
    plan: plan1,
    outputRoot: tmpDir,
    fullConfig: makeConfig("profile-pom-shared"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  const registry1 = await loadPageObjectRegistry({ appSlug: "profile-pom-shared" } as any, tmpDir);
  const poCount1 = registry1.pageObjects.length;

  const plan2: ExecutionPlan = {
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

  await promoteExecutionPlan({
    plan: plan2,
    outputRoot: tmpDir,
    overwrite: true,
    fullConfig: makeConfig("profile-pom-shared"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  const registry2 = await loadPageObjectRegistry({ appSlug: "profile-pom-shared" } as any, tmpDir);

  expect(registry2.pageObjects.length).toBe(poCount1);

  const categoryPO = registry2.pageObjects.find((po) => po.className === "CategoryPage");
  expect(categoryPO).toBeDefined();
  expect(categoryPO!.methods.filter((m) => m.intent === "select_category").length).toBe(1);

  const productListPO = registry2.pageObjects.find((po) => po.className === "ProductListPage");
  expect(productListPO).toBeDefined();
  expect(productListPO!.methods.filter((m) => m.intent === "select_product").length).toBe(1);
});

test("segmented_route_recovery parent_category genera selectCategory", async () => {
  const plan: ExecutionPlan = {
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
      } as any
    ],
    createdAt: new Date().toISOString()
  };

  await promoteExecutionPlan({
    plan,
    outputRoot: tmpDir,
    fullConfig: makeConfig("profile-pom-recovery"),
    promotionPolicy: DEFAULT_PROMOTION_POLICY
  }, false);

  const registry = await loadPageObjectRegistry({ appSlug: "profile-pom-recovery" } as any, tmpDir);
  expect(registry.pageObjects.length).toBeGreaterThan(0);
  const candidatePO = registry.pageObjects.find((po) => po.status === "candidate");
  expect(candidatePO).toBeDefined();
  expect(candidatePO!.methods.length).toBeGreaterThan(0);

  expect(candidatePO!.className).toBe("CategoryPage");
  expect(candidatePO!.methods[0].intent).toBe("select_category");
  expect(candidatePO!.methods[0].name).toBe("selectCategory");
  expect(candidatePO!.methods[0].parameters).toContain("categoryName");
});
