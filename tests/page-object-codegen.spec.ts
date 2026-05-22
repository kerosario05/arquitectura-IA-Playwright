import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { generatePageObjectCandidateFiles, buildPageObjectClassSource, sanitizeClassName, sanitizeMethodName } from "../src/automations/page-object-codegen";
import { loadPageObjectRegistry, savePageObjectRegistry, ensurePageObjectRegistry, registerPageObjectCandidate } from "../src/automations/page-object-registry";
import type { PageObjectEntry } from "../src/types/page-object.types";
import { getTestTempDir, ensureTestTempDir, cleanTestTempDir } from "./helpers/test-temp-dir";

const tmpDir = getTestTempDir("test-page-object-codegen");

test.beforeAll(async () => {
  await ensureTestTempDir("test-page-object-codegen");
});

test.afterAll(async () => {
  await cleanTestTempDir("test-page-object-codegen").catch(() => {});
});

function makeCandidateEntry(overrides: Partial<PageObjectEntry> & { className: string }): PageObjectEntry {
  const now = new Date().toISOString();
  return {
    id: `po_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    className: overrides.className,
    filePath: `pages/${overrides.className.replace(/Page$/, "").toLowerCase()}.page.ts`,
    screenSignature: `screen:test-${overrides.className.toLowerCase()}`,
    methods: overrides.methods ?? [],
    confidence: overrides.confidence ?? 0.5,
    status: overrides.status ?? "candidate",
    sourcePlanIds: overrides.sourcePlanIds ?? ["test-plan-1"],
    caseIds: overrides.caseIds ?? [],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now
  };
}

test("sanitizeClassName produces valid class names", () => {
  expect(sanitizeClassName("CategoryPage")).toBe("CategoryPage");
  expect(sanitizeClassName("Product List Page")).toBe("ProductListPage");
  expect(sanitizeClassName("")).toBe("GenericPage");
  expect(sanitizeClassName("123")).toBe("123");
});

test("sanitizeMethodName produces valid method names", () => {
  expect(sanitizeMethodName("selectCategory")).toBe("selectCategory");
  expect(sanitizeMethodName("Select Category")).toBe("selectCategory");
  expect(sanitizeMethodName("")).toBe("executeAction");
});

test("buildPageObjectClassSource generates valid TypeScript for CategoryPage", () => {
  const candidate = makeCandidateEntry({
    className: "CategoryPage",
    methods: [
      {
        name: "selectCategory",
        intent: "select_category",
        parameters: ["categoryName"],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.5,
        status: "candidate"
      }
    ]
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).toContain("import { Page, expect } from '@playwright/test';");
  expect(source).toContain("export class CategoryPage");
  expect(source).toContain("constructor(private readonly page: Page)");
  expect(source).toContain("async selectCategory(categoryName: string): Promise<void>");
  expect(source).toContain("categoryName");
  expect(source).not.toContain("Tarjetas");
  expect(source).not.toContain("Visa");
});

test("buildPageObjectClassSource generates ProductListPage with selectProduct", () => {
  const candidate = makeCandidateEntry({
    className: "ProductListPage",
    methods: [
      {
        name: "selectProduct",
        intent: "select_product",
        parameters: ["productName"],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.5,
        status: "candidate"
      }
    ]
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).toContain("export class ProductListPage");
  expect(source).toContain("async selectProduct(productName: string): Promise<void>");
  expect(source).not.toContain("Visa Gold");
  expect(source).not.toContain("Tarjeta de Credito");
});

test("buildPageObjectClassSource does not hardcode case-specific values", () => {
  const candidate = makeCandidateEntry({
    className: "CategoryPage",
    methods: [
      {
        name: "selectCategory",
        intent: "select_category",
        parameters: ["categoryName"],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.5,
        status: "candidate"
      }
    ]
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).not.toContain("Tarjetas");
  expect(source).not.toContain("Prestamos");
  expect(source).not.toContain("Cuentas");
  expect(source).not.toContain("Visa");
});

test("genera CategoryPage candidate file con selectCategory(categoryName)", async () => {
  const appSlug = "test-codegen-category";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "Category",
    className: "CategoryPage",
    screenSignature: `screen:${appSlug}-category`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "selectCategory", intent: "select_category" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const result = await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    overwriteCandidates: true
  });

  expect(result.generated).toBe(1);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  const candidateFile = path.join(pagesDir, "category.page.candidate.ts");
  await expect(fs.access(candidateFile)).resolves.toBeUndefined();

  const content = await fs.readFile(candidateFile, "utf-8");
  expect(content).toContain("export class CategoryPage");
  expect(content).toContain("async selectCategory(categoryName: string): Promise<void>");
  expect(content).not.toContain("Tarjetas");
});

test("genera ProductListPage candidate file con selectProduct(productName)", async () => {
  const appSlug = "test-codegen-product";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "ProductList",
    className: "ProductListPage",
    screenSignature: `screen:${appSlug}-productlist`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "selectProduct", intent: "select_product" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const result = await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    overwriteCandidates: true
  });

  expect(result.generated).toBe(1);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  const candidateFile = path.join(pagesDir, "productlist.page.candidate.ts");
  await expect(fs.access(candidateFile)).resolves.toBeUndefined();

  const content = await fs.readFile(candidateFile, "utf-8");
  expect(content).toContain("export class ProductListPage");
  expect(content).toContain("async selectProduct(productName: string): Promise<void>");
});

test("no sobrescribe .candidate.ts sin --overwrite-candidates", async () => {
  const appSlug = "test-codegen-nodup";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "Category",
    className: "CategoryPage",
    screenSignature: `screen:${appSlug}-category`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "selectCategory", intent: "select_category" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const result1 = await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    overwriteCandidates: true
  });
  expect(result1.generated).toBe(1);

  const result2 = await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    overwriteCandidates: false
  });
  expect(result2.skipped).toBe(1);
  expect(result2.generated).toBe(0);
});

test("dry-run no escribe archivos", async () => {
  const appSlug = "test-codegen-dryrun";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "Category",
    className: "CategoryPage",
    screenSignature: `screen:${appSlug}-category`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "selectCategory", intent: "select_category" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const result = await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    dryRun: true,
    overwriteCandidates: true
  });

  expect(result.generated).toBe(0);
  expect(result.skipped).toBe(1);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  const candidateFile = path.join(pagesDir, "category.page.candidate.ts");
  await expect(fs.access(candidateFile)).rejects.toThrow();
});

test("actualiza metadata de registry tras generar", async () => {
  const appSlug = "test-codegen-metadata";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "Category",
    className: "CategoryPage",
    screenSignature: `screen:${appSlug}-category`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "selectCategory", intent: "select_category" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    overwriteCandidates: true
  });

  const updatedRegistry = await loadPageObjectRegistry({ appSlug } as any, tmpDir);
  const categoryPO = updatedRegistry.pageObjects.find((po) => po.className === "CategoryPage");
  expect(categoryPO).toBeDefined();

  const codegenMeta = (categoryPO as any).codegenMetadata;
  expect(codegenMeta).toBeDefined();
  expect(codegenMeta.generatedBy).toBe("page-object-codegen");
  expect(codegenMeta.generatedAt).toBeDefined();
  expect(codegenMeta.candidateFilePath).toContain("category.page.candidate.ts");
});

test("genera TypeScript valido", async () => {
  const appSlug = "test-codegen-valid";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "HomePage",
    className: "HomePage",
    screenSignature: `screen:${appSlug}-home`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [
      { name: "start", intent: "start_session" },
      { name: "open", intent: "open_home" }
    ]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    overwriteCandidates: true
  });

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  const candidateFile = path.join(pagesDir, "home.page.candidate.ts");
  const content = await fs.readFile(candidateFile, "utf-8");

  expect(content).toContain("import { Page, expect } from '@playwright/test';");
  expect(content).toContain("export class HomePage");
  expect(content).toContain("constructor(private readonly page: Page)");
  expect(content).toContain("async start(): Promise<void>");
  expect(content).toContain("async open(): Promise<void>");

  expect(content).not.toContain("any");
  expect(content).not.toContain("eval(");
});

test("solo genera candidate especifico con --only", async () => {
  const appSlug = "test-codegen-only";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "Category",
    className: "CategoryPage",
    screenSignature: `screen:${appSlug}-category`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "selectCategory", intent: "select_category" }]
  });

  registerPageObjectCandidate(registry, {
    name: "ProductList",
    className: "ProductListPage",
    screenSignature: `screen:${appSlug}-productlist`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "selectProduct", intent: "select_product" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const result = await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    onlyClassName: "CategoryPage",
    overwriteCandidates: true
  });

  expect(result.generated).toBe(1);
  expect(result.files.some((f) => f.className === "CategoryPage")).toBe(true);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  const categoryFile = path.join(pagesDir, "category.page.candidate.ts");
  const productListFile = path.join(pagesDir, "productlist.page.candidate.ts");

  await expect(fs.access(categoryFile)).resolves.toBeUndefined();
  await expect(fs.access(productListFile)).rejects.toThrow();
});

test("metodo sin template genera TODO comentado", () => {
  const candidate = makeCandidateEntry({
    className: "CustomPage",
    methods: [
      {
        name: "customAction",
        intent: "unknown_intent",
        parameters: [],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.5,
        status: "candidate"
      }
    ]
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).toContain("// TODO: Implement customAction");
  expect(source).toContain("throw new Error('Not implemented: customAction');");
});

test("ProductDetailPage nunca genera selectProduct", () => {
  const candidate = makeCandidateEntry({
    className: "ProductDetailPage",
    methods: [
      {
        name: "selectProduct",
        intent: "select_product",
        parameters: ["productName"],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.5,
        status: "candidate"
      }
    ]
  });

  const { source, warnings } = buildPageObjectClassSource(candidate);

  expect(source).not.toContain("selectProduct");
  expect(warnings.some((w) => w.includes("select_product") && w.includes("ProductDetailPage"))).toBe(true);
});

test("ProductDetailPage genera expectLoaded cuando intent expect_loaded existe", () => {
  const candidate = makeCandidateEntry({
    className: "ProductDetailPage",
    methods: [
      {
        name: "expectLoaded",
        intent: "expect_loaded",
        parameters: [],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.5,
        status: "candidate"
      }
    ]
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).toContain("async expectLoaded(): Promise<void>");
  expect(source).toContain("expect(");
});

test("ProductListPage nunca genera start", () => {
  const candidate = makeCandidateEntry({
    className: "ProductListPage",
    methods: [
      {
        name: "start",
        intent: "start_session",
        parameters: [],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.5,
        status: "candidate"
      }
    ]
  });

  const { source, warnings } = buildPageObjectClassSource(candidate);

  expect(source).not.toContain("async start()");
  expect(warnings.some((w) => w.includes("start_session") && w.includes("ProductListPage"))).toBe(true);
});

test("HomePage genera start", () => {
  const candidate = makeCandidateEntry({
    className: "HomePage",
    methods: [
      {
        name: "start",
        intent: "start_session",
        parameters: [],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.5,
        status: "candidate"
      }
    ]
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).toContain("async start(): Promise<void>");
});

test("select_product siempre genera ProductListPage.selectProduct(productName)", () => {
  const candidate = makeCandidateEntry({
    className: "ProductListPage",
    methods: [
      {
        name: "selectProduct",
        intent: "select_product",
        parameters: ["productName"],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.5,
        status: "candidate"
      }
    ]
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).toContain("export class ProductListPage");
  expect(source).toContain("async selectProduct(productName: string): Promise<void>");
});

test("start_session siempre genera HomePage.start()", () => {
  const candidate = makeCandidateEntry({
    className: "HomePage",
    methods: [
      {
        name: "start",
        intent: "start_session",
        parameters: [],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.5,
        status: "candidate"
      }
    ]
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).toContain("export class HomePage");
  expect(source).toContain("async start(): Promise<void>");
});

test("category select sigue generando CategoryPage.selectCategory(categoryName)", () => {
  const candidate = makeCandidateEntry({
    className: "CategoryPage",
    methods: [
      {
        name: "selectCategory",
        intent: "select_category",
        parameters: ["categoryName"],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.5,
        status: "candidate"
      }
    ]
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).toContain("export class CategoryPage");
  expect(source).toContain("async selectCategory(categoryName: string): Promise<void>");
});

test("ProductDetailPage sin methods genera expectLoaded por defecto", () => {
  const candidate = makeCandidateEntry({
    className: "ProductDetailPage",
    methods: []
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).toContain("async expectLoaded(): Promise<void>");
});

test("ProductListPage sin methods genera selectProduct por defecto", () => {
  const candidate = makeCandidateEntry({
    className: "ProductListPage",
    methods: []
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).toContain("async selectProduct(productName: string): Promise<void>");
});

test("HomePage sin methods genera start por defecto", () => {
  const candidate = makeCandidateEntry({
    className: "HomePage",
    methods: []
  });

  const { source } = buildPageObjectClassSource(candidate);

  expect(source).toContain("async start(): Promise<void>");
});

test("genera ProductDetailPage con expectLoaded y no selectProduct", async () => {
  const appSlug = "test-codegen-detail";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "ProductDetail",
    className: "ProductDetailPage",
    screenSignature: `screen:${appSlug}-productdetail`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [
      { name: "expectLoaded", intent: "expect_loaded" },
      { name: "selectProduct", intent: "select_product" }
    ]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const result = await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    overwriteCandidates: true
  });

  expect(result.generated).toBe(1);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  const candidateFile = path.join(pagesDir, "productdetail.page.candidate.ts");
  const content = await fs.readFile(candidateFile, "utf-8");

  expect(content).toContain("export class ProductDetailPage");
  expect(content).toContain("async expectLoaded(): Promise<void>");
  expect(content).not.toContain("selectProduct");
  expect(result.warnings.some((w) => w.includes("select_product"))).toBe(true);
});

test("genera HomePage con start y ProductListPage con selectProduct", async () => {
  const appSlug = "test-codegen-multi";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "HomePage",
    className: "HomePage",
    screenSignature: `screen:${appSlug}-home`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "start", intent: "start_session" }]
  });

  registerPageObjectCandidate(registry, {
    name: "ProductList",
    className: "ProductListPage",
    screenSignature: `screen:${appSlug}-productlist`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "selectProduct", intent: "select_product" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const result = await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    overwriteCandidates: true
  });

  expect(result.generated).toBe(2);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  const homeFile = path.join(pagesDir, "home.page.candidate.ts");
  const productListFile = path.join(pagesDir, "productlist.page.candidate.ts");

  const homeContent = await fs.readFile(homeFile, "utf-8");
  expect(homeContent).toContain("async start(): Promise<void>");
  expect(homeContent).not.toContain("selectProduct");

  const productListContent = await fs.readFile(productListFile, "utf-8");
  expect(productListContent).toContain("async selectProduct(productName: string): Promise<void>");
  expect(productListContent).not.toContain("async start()");
});
