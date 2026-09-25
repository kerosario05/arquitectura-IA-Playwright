import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { autoApproveMethodsInActivePageObjects } from "./auto-pom";
import { findMethodBySemanticIntent } from "./page-object-registry";
import type { PageObjectRegistry, PageObjectEntry, PageObjectMethod } from "../types/page-object.types";

/**
 * FIRST_LOSS (jobId cb26fb19-d676-4d19-b19d-70613cd9a009): a method got flagged
 * `status="active" available=true` in the registry by POLICY approval alone, before any
 * verification that it physically exists in the real Page Object source. `ProductListPage.
 * executeAction` (intent="unknown", no known stub template) was marked active/available this
 * way, and the real `productlist.page.ts` never received the method -- `TypeError:
 * productListPage.executeAction is not a function` at runtime, even though the registry claimed
 * it was safe, executable authority.
 *
 * Fixed generically (no app/POM/method/intent hardcode): activation now happens only AFTER
 * re-reading the resulting active file and confirming the method name is really present.
 */

function method(overrides: Partial<PageObjectMethod> & Pick<PageObjectMethod, "name" | "intent">): PageObjectMethod {
  return {
    parameters: [],
    available: false,
    source: "",
    sensitive: false,
    confidence: 1,
    status: "candidate",
    ...overrides,
  };
}

function pageObject(overrides: Partial<PageObjectEntry> & Pick<PageObjectEntry, "className" | "methods">): PageObjectEntry {
  return {
    id: "po_1",
    filePath: "",
    screenSignature: "screen:synthetic-app-product_list",
    confidence: 1,
    status: "active",
    sourcePlanIds: [],
    caseIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function withTempPagesDir(fn: (pagesDir: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-pom-method-authority-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeActivePage(pagesDir: string, baseFileName: string, source: string): Promise<string> {
  const activePath = path.join(pagesDir, `${baseFileName}.page.ts`);
  await fs.writeFile(activePath, source, "utf-8");
  return activePath;
}

const CLASS_BODY = "export class ProductListPage {\n  constructor(private readonly page: any) {}\n}\n";

test("1/unknownIntentNeverActivatedWithoutSourceProof. a method with no known stub template (intent=unknown) is never marked active/available even though it passes confidence/sensitivity policy -- reproduces ProductListPage.executeAction exactly", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "productlist", CLASS_BODY);
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [method({ name: "executeAction", intent: "unknown" })],
        }),
      ],
    } as any;

    const result = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });

    assert.equal(result.approvedMethodCount, 0);
    assert.deepEqual(result.autoApprovedMethods, []);
    assert.ok(result.blockedAutoApprovals.some((e) => e.includes("ProductListPage.executeAction()") && e.includes("method_not_present_in_source_after_sync")));
    const method0 = registry.pageObjects[0].methods[0];
    assert.equal(method0.available, false, "must never be flagged available without physical proof");
    assert.equal(method0.status, "candidate", "reuses the existing candidate status, never a fabricated new one");
  });
});

test("2/knownStubTemplateActivatesAndVerifies. a method with a known stub template is written into the real file AND verified before activation", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "productlist", CLASS_BODY);
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [method({ name: "selectFirstVisibleCard", intent: "select_first_visible_card" })],
        }),
      ],
    } as any;

    const result = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });

    assert.equal(result.approvedMethodCount, 1);
    assert.deepEqual(result.autoApprovedMethods, ["ProductListPage.selectFirstVisibleCard()"]);
    const method0 = registry.pageObjects[0].methods[0];
    assert.equal(method0.available, true);
    assert.equal(method0.status, "active");
    const finalSource = await fs.readFile(path.join(pagesDir, "productlist.page.ts"), "utf-8");
    assert.match(finalSource, /async selectFirstVisibleCard\(\)/, "the stub must actually be written to the real file, not just claimed in the registry");
  });
});

test("3/mixedProposalsPartiallyApproved. one known-stub method activates while a sibling unknown-intent method for the SAME page object stays blocked", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "productlist", CLASS_BODY);
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [
            method({ name: "selectFirstVisibleCard", intent: "select_first_visible_card" }),
            method({ name: "executeAction", intent: "unknown" }),
          ],
        }),
      ],
    } as any;

    const result = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });

    assert.equal(result.approvedMethodCount, 1);
    assert.deepEqual(result.autoApprovedMethods, ["ProductListPage.selectFirstVisibleCard()"]);
    assert.ok(result.blockedAutoApprovals.some((e) => e.includes("executeAction")));
    assert.equal(registry.pageObjects[0].methods[0].available, true);
    assert.equal(registry.pageObjects[0].methods[1].available, false);
  });
});

test("4/alreadyActiveMethodUnaffected. an already active/available method whose source is genuinely present is never regressed", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "productlist", "export class ProductListPage {\n  constructor(private readonly page: any) {}\n  async selectProduct(productName: string): Promise<void> {}\n}\n");
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [method({ name: "selectProduct", intent: "select_product", status: "active", available: true })],
        }),
      ],
    } as any;

    const result = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });

    assert.equal(result.approvedMethodCount, 0);
    assert.deepEqual(result.autoApprovedMethods, []);
    assert.deepEqual(result.reconciledMethods, []);
    assert.deepEqual(result.blockedAutoApprovals, []);
    assert.equal(registry.pageObjects[0].methods[0].available, true, "no regression");
  });
});

test("5/candidatePageObjectSkipped. a page object still status=candidate (not yet an active class) is never touched by this method-level activation", async () => {
  await withTempPagesDir(async (pagesDir) => {
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "SomeCandidatePage",
          status: "candidate",
          methods: [method({ name: "anyMethod", intent: "unknown" })],
        }),
      ],
    } as any;

    const result = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });
    assert.equal(result.approvedMethodCount, 0);
    assert.equal(registry.pageObjects[0].methods[0].available, false);
  });
});

test("6/genericAcrossAnyClassOrIntent. the same rule applies to a completely different class/method/intent name -- nothing hardcoded to ProductListPage/executeAction", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "checkout", "export class CheckoutPage {\n  constructor(private readonly page: any) {}\n}\n");
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "CheckoutPage",
          screenSignature: "screen:synthetic-app-checkout",
          methods: [method({ name: "confirmPurchase", intent: "some_future_intent" })],
        }),
      ],
    } as any;

    const result = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });
    assert.equal(result.approvedMethodCount, 0);
    assert.ok(result.blockedAutoApprovals.some((e) => e.includes("CheckoutPage.confirmPurchase()")));
  });
});

/**
 * Reconciliation pass tests (jobId cb26fb19-d676-4d19-b19d-70613cd9a009, follow-up REVIEW): the
 * proposal-only fix above never re-evaluates an entry ALREADY `status="active" available=true` --
 * an entry corrupted before this fix existed stayed executable authority forever. These tests
 * cover the reconciliation sweep added for already-active/available methods.
 */

test("7/preexistingCorruptEntryDemoted. a preexisting active=true/available=true method absent from source becomes available=false after the pipeline runs -- reproduces the real ProductListPage.executeAction registry state exactly", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "productlist", CLASS_BODY);
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [method({ name: "executeAction", intent: "unknown", status: "active", available: true })],
        }),
      ],
    } as any;

    const result = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });

    assert.deepEqual(result.reconciledMethods, ["ProductListPage.executeAction()"]);
    assert.equal(registry.pageObjects[0].methods[0].available, false, "must become available=false after the pipeline runs");
  });
});

test("8/genuinelyPresentPreexistingMethodStaysExecutable. a preexisting active=true/available=true method whose source genuinely exists remains executable after reconciliation", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "productlist", "export class ProductListPage {\n  constructor(private readonly page: any) {}\n  async selectProduct(productName: string): Promise<void> {}\n}\n");
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [method({ name: "selectProduct", intent: "select_product", status: "active", available: true })],
        }),
      ],
    } as any;

    const result = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });

    assert.deepEqual(result.reconciledMethods, []);
    assert.equal(registry.pageObjects[0].methods[0].available, true);
  });
});

test("9/mixedValidAndInvalidPreexistingMethods. only the absent preexisting method is invalidated; the genuinely present one is untouched", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "productlist", "export class ProductListPage {\n  constructor(private readonly page: any) {}\n  async selectProduct(productName: string): Promise<void> {}\n}\n");
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [
            method({ name: "selectProduct", intent: "select_product", status: "active", available: true }),
            method({ name: "executeAction", intent: "unknown", status: "active", available: true }),
          ],
        }),
      ],
    } as any;

    const result = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });

    assert.deepEqual(result.reconciledMethods, ["ProductListPage.executeAction()"]);
    assert.equal(registry.pageObjects[0].methods[0].available, true, "genuinely present method untouched");
    assert.equal(registry.pageObjects[0].methods[1].available, false, "absent method invalidated");
  });
});

test("10/genericReconciliationNotHardcoded. reconciliation applies identically to a synthetic non-Portal-Comercial class/method", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "checkout", "export class CheckoutPage {\n  constructor(private readonly page: any) {}\n}\n");
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "CheckoutPage",
          screenSignature: "screen:synthetic-app-checkout",
          methods: [method({ name: "confirmPurchase", intent: "some_future_intent", status: "active", available: true })],
        }),
      ],
    } as any;

    const result = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });
    assert.deepEqual(result.reconciledMethods, ["CheckoutPage.confirmPurchase()"]);
    assert.equal(registry.pageObjects[0].methods[0].available, false);
  });
});

test("11/idempotentAcrossTwoRuns. running the pipeline twice on the same registry produces the same final state -- second run reconciles nothing new", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "productlist", CLASS_BODY);
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [method({ name: "executeAction", intent: "unknown", status: "active", available: true })],
        }),
      ],
    } as any;

    const first = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });
    assert.deepEqual(first.reconciledMethods, ["ProductListPage.executeAction()"]);
    assert.equal(registry.pageObjects[0].methods[0].available, false);

    const second = await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });
    assert.deepEqual(second.reconciledMethods, [], "already-reconciled (available=false) methods are not swept again");
    assert.equal(registry.pageObjects[0].methods[0].available, false, "state stable across repeated runs");
  });
});

test("12/consumerIntegrationFindMethodBySemanticIntentNeverReturnsMissingMethod. after reconciliation, findMethodBySemanticIntent never returns the demoted method as executable authority", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "productlist", CLASS_BODY);
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [method({ name: "selectProduct", intent: "select_product", status: "active", available: true })],
        }),
      ],
    } as any;

    await autoApproveMethodsInActivePageObjects(registry, pagesDir, { confidenceThreshold: 0.5, blockSensitive: true });
    assert.equal(registry.pageObjects[0].methods[0].available, false, "precondition: reconciliation demoted the method (source is genuinely empty)");

    const found = findMethodBySemanticIntent(registry, "select_product" as any);
    assert.equal(found, undefined, "a demoted method must never be selected as executable authority by a real consumer");
  });
});
