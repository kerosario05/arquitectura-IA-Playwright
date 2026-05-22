import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { generatePageObjectCandidateFiles } from "../src/automations/page-object-codegen";
import { ensurePageObjectRegistry, savePageObjectRegistry, registerPageObjectCandidate } from "../src/automations/page-object-registry";
import { INTENT_PREFERRED_OWNER, INTENT_CLASS_OWNERSHIP } from "../src/types/pom-ownership";
import { getTestTempDir, ensureTestTempDir, cleanTestTempDir } from "./helpers/test-temp-dir";

const tmpDir = getTestTempDir("test-pom-ownership");

test.beforeAll(async () => {
  await ensureTestTempDir("test-pom-ownership");
});

test.afterAll(async () => {
  await cleanTestTempDir("test-pom-ownership").catch(() => {});
});

test("start_session preferred owner es HomePage", () => {
  expect(INTENT_PREFERRED_OWNER["start_session"]).toBe("HomePage");
});

test("select_product preferred owner es ProductListPage", () => {
  expect(INTENT_PREFERRED_OWNER["select_product"]).toBe("ProductListPage");
});

test("expect_loaded preferred owner es ProductDetailPage", () => {
  expect(INTENT_PREFERRED_OWNER["expect_loaded"]).toBe("ProductDetailPage");
});

test("open_product_information preferred owner es ProductInformationPage", () => {
  expect(INTENT_PREFERRED_OWNER["open_product_information"]).toBe("ProductInformationPage");
});

test("select_category preferred owner es CategoryPage", () => {
  expect(INTENT_PREFERRED_OWNER["select_category"]).toBe("CategoryPage");
});

test("start_session solo permite HomePage y LoginPage", () => {
  expect(INTENT_CLASS_OWNERSHIP["start_session"]).toContain("HomePage");
  expect(INTENT_CLASS_OWNERSHIP["start_session"]).toContain("LoginPage");
  expect(INTENT_CLASS_OWNERSHIP["start_session"]).not.toContain("ProductListPage");
});

test("select_product solo permite ProductListPage", () => {
  expect(INTENT_CLASS_OWNERSHIP["select_product"]).toEqual(["ProductListPage"]);
});

test("codegen despues de registry limpio genera 0 ownership warnings", async () => {
  const appSlug = "test-ownership-clean";
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

  registerPageObjectCandidate(registry, {
    name: "Category",
    className: "CategoryPage",
    screenSignature: `screen:${appSlug}-category`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "selectCategory", intent: "select_category" }]
  });

  registerPageObjectCandidate(registry, {
    name: "ProductDetail",
    className: "ProductDetailPage",
    screenSignature: `screen:${appSlug}-productdetail`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "expectLoaded", intent: "expect_loaded" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const result = await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    overwriteCandidates: true
  });

  expect(result.generated).toBe(4);
  const ownershipWarnings = result.warnings.filter((w) =>
    w.includes("does not belong in") || w.includes("filtered from")
  );
  expect(ownershipWarnings).toHaveLength(0);
});

test("codegen con metodo mal ubicado y owner inexistente genera warning fuerte", async () => {
  const appSlug = "test-ownership-missing";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "ProductList",
    className: "ProductListPage",
    screenSignature: `screen:${appSlug}-productlist`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [
      { name: "selectProduct", intent: "select_product" },
      { name: "start", intent: "start_session" }
    ]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const result = await generatePageObjectCandidateFiles({
    appSlug,
    outputRoot: tmpDir,
    overwriteCandidates: true
  });

  expect(result.generated).toBe(1);
  const strongWarnings = result.warnings.filter((w) =>
    w.includes("filtered from") && w.includes("no owner candidate")
  );
  expect(strongWarnings.length).toBeGreaterThan(0);
  expect(strongWarnings[0]).toContain("HomePage");
});

test("no duplica owners al correr dos casos", async () => {
  const appSlug = "test-ownership-nodup";
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
    overwriteCandidates: true
  });

  expect(result2.generated).toBe(1);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  const files = await fs.readdir(pagesDir);
  const candidateFiles = files.filter((f) => f.endsWith(".candidate.ts"));
  expect(candidateFiles).toHaveLength(1);
  expect(candidateFiles).toContain("category.page.candidate.ts");
});
