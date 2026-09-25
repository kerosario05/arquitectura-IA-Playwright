import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { reconcileActivePageObjectMethods } from "./auto-pom";
import { findMethodBySemanticIntent } from "./page-object-registry";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { PageObjectRegistry, PageObjectEntry, PageObjectMethod } from "../types/page-object.types";

/**
 * Proves the standalone reconciliation seam (reconcileActivePageObjectMethods, extracted from
 * autoApproveMethodsInActivePageObjects) works without Auto-POM's proposal/approval machinery,
 * and that running it before buildSpecExecutionContract closes the FIRST_LOSS from jobId
 * 5323ef1e-fe40-4799-9395-4a0590138262: a stale active=true/available=true registry entry
 * (ProductListPage.executeAction, intent=unknown) was never re-verified for the deterministic
 * promotion flow because shouldRunAutoPom(pomStatus="promoted", ...) always short-circuits it.
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "auto-pom-reconciliation-standalone-"));
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

const CLASS_BODY_NO_EXECUTE_ACTION = "export class ProductListPage {\n  constructor(private readonly page: any) {}\n}\n";

test("1/registry active+available but method absent from real source: demoted to available=false, standalone, no proposal/approval invoked", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "productlist", CLASS_BODY_NO_EXECUTE_ACTION);
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [method({ name: "executeAction", intent: "unknown", status: "active", available: true })],
        }),
      ],
    } as any;

    const result = await reconcileActivePageObjectMethods(registry, pagesDir);

    assert.deepEqual(result.reconciledMethods, ["ProductListPage.executeAction()"]);
    assert.equal(registry.pageObjects[0].methods[0].available, false);
    assert.equal(registry.pageObjects[0].methods[0].status, "active", "status is left as-is, never invented");
  });
});

test("2/registry active+available for a method that genuinely exists: stays active+available, standalone", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(
      pagesDir,
      "productlist",
      "export class ProductListPage {\n  constructor(private readonly page: any) {}\n  async selectProduct(productName: string): Promise<void> {}\n}\n",
    );
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [method({ name: "selectProduct", intent: "select_product", status: "active", available: true })],
        }),
      ],
    } as any;

    const result = await reconcileActivePageObjectMethods(registry, pagesDir);

    assert.deepEqual(result.reconciledMethods, []);
    assert.equal(registry.pageObjects[0].methods[0].available, true);
  });
});

test("3/deterministic flow shape: after reconciliation, buildSpecExecutionContract never binds step 3 to the stale ProductListPage.executeAction, and findMethodBySemanticIntent never returns it", async () => {
  await withTempPagesDir(async (pagesDir) => {
    await writeActivePage(pagesDir, "productlist", CLASS_BODY_NO_EXECUTE_ACTION);
    const registry: PageObjectRegistry = {
      pageObjects: [
        pageObject({
          className: "ProductListPage",
          methods: [method({ name: "executeAction", intent: "unknown", status: "active", available: true })],
        }),
      ],
    } as any;

    await reconcileActivePageObjectMethods(registry, pagesDir);
    assert.equal(
      findMethodBySemanticIntent(registry, "unknown" as any),
      undefined,
      "demoted method must never be selected as implementation authority",
    );

    const plan: ExecutionPlan = {
      version: "1.0",
      source: "discovery_generated",
      status: "validated",
      createdAt: new Date().toISOString(),
      scenario: { source: "manual", externalId: "C-RECONCILE-1", title: "Reconciliation before contract build" },
      requiredData: [],
      steps: [
        { index: 1, action: "fill", description: "Ingresar contrasena", target: { strategy: "text", value: "Contrasena" }, valueKey: "contrasena" },
        { index: 2, action: "press", description: "Enter en contrasena", target: { strategy: "text", value: "Enter" } },
      ],
    };
    const sourceScenario = {
      title: "Reconciliation before contract build",
      steps: [
        { index: 1, action: "Ingresar contrasena", technicalTargetRef: "role:textbox|Contrasena" },
        { index: 2, action: "Presionar Enter en Contrasena", technicalTargetRef: "role:textbox|Contrasena" },
      ],
    };

    const contract = buildSpecExecutionContract(plan, sourceScenario as any, {
      appSlug: "portal-comercial",
      sectionSlug: "default-section",
      pageObjectRegistry: registry,
    });
    const pressStep = contract.steps.find((s) => s.operation === "press");
    assert.ok(pressStep, "press step must be present in the contract");
    assert.notEqual(pressStep!.implementation?.kind, "page_object", "must never bind toward the demoted page_object method");
    if (pressStep!.implementation) {
      assert.notEqual((pressStep!.implementation as any).method, "executeAction");
    }
  });
});
