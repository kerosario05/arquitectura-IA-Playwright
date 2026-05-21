import { test, expect } from "@playwright/test";
import {
  isMethodAutoApprovable,
  isPageObjectAutoApprovable
} from "../src/automations/page-object-approval";
import type { PageObjectMethod, PageObjectEntry } from "../src/types/page-object.types";
import { shouldRunAutoPom, validatePomSpec } from "../src/automations/auto-pom";
import type { PromotionPolicy, POMPromotionStatus } from "../src/types/automation-promotion.types";
import type { AppAutomationPaths } from "../src/automations/app-profile";
import type { PageObjectRegistry } from "../src/types/page-object.types";

function makeMethod(overrides: Partial<PageObjectMethod> = {}): PageObjectMethod {
  return {
    name: "testMethod",
    intent: "open_home",
    parameters: [],
    available: false,
    source: "test",
    sensitive: false,
    confidence: 0.8,
    status: "candidate",
    ...overrides
  };
}

function makePageObject(overrides: Partial<PageObjectEntry> = {}): PageObjectEntry {
  return {
    id: "po_test",
    className: "TestPage",
    filePath: "pages/test.page.ts",
    screenSignature: "screen:test",
    methods: [],
    confidence: 0.8,
    status: "candidate",
    sourcePlanIds: ["test-plan"],
    caseIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function makePolicy(overrides: Partial<PromotionPolicy> = {}): PromotionPolicy {
  return {
    specMode: "page-object",
    requirePageObjects: true,
    allowInlineFallback: false,
    allowInlineDebugMode: true,
    allowCandidateGeneration: true,
    blockPromotionWhenPageObjectMissing: true,
    autoPom: false,
    ...overrides
  };
}

// ==========================================
// A. shouldRunAutoPom tests
// ==========================================

test("shouldRunAutoPom returns false when autoPom=false", () => {
  const policy = makePolicy({ autoPom: false });
  expect(shouldRunAutoPom("needs_page_object", policy)).toBe(false);
});

test("shouldRunAutoPom returns true for needs_page_object", () => {
  const policy = makePolicy({ autoPom: true });
  expect(shouldRunAutoPom("needs_page_object", policy)).toBe(true);
});

test("shouldRunAutoPom returns true for needs_page_method", () => {
  const policy = makePolicy({ autoPom: true });
  expect(shouldRunAutoPom("needs_page_method", policy)).toBe(true);
});

test("shouldRunAutoPom returns true for blocked_missing_pom", () => {
  const policy = makePolicy({ autoPom: true });
  expect(shouldRunAutoPom("blocked_missing_pom", policy)).toBe(true);
});

test("shouldRunAutoPom returns true for page_object_candidate_created", () => {
  const policy = makePolicy({ autoPom: true });
  expect(shouldRunAutoPom("page_object_candidate_created", policy)).toBe(true);
});

test("shouldRunAutoPom returns false for promoted", () => {
  const policy = makePolicy({ autoPom: true });
  expect(shouldRunAutoPom("promoted", policy)).toBe(false);
});

test("shouldRunAutoPom returns false for inline_debug_only", () => {
  const policy = makePolicy({ autoPom: true });
  expect(shouldRunAutoPom("inline_debug_only", policy)).toBe(false);
});

// ==========================================
// B. isMethodAutoApprovable safety tests
// ==========================================

test("approvable method passes all checks", () => {
  const method = makeMethod({ intent: "open_home", confidence: 0.8 });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(true);
});

test("login intent is blocked when blockSensitive=true", () => {
  const method = makeMethod({ intent: "login", confidence: 0.8 });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(false);
  expect(result.reason).toContain("sensitive intent");
});

test("otp intent is blocked", () => {
  const method = makeMethod({ intent: "otp", confidence: 0.8 });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(false);
});

test("submit_form intent is blocked", () => {
  const method = makeMethod({ intent: "submit_form", confidence: 0.8 });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(false);
});

test("confirm_action intent is blocked", () => {
  const method = makeMethod({ intent: "confirm_action", confidence: 0.8 });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(false);
});

test("payment intent is blocked", () => {
  const method = makeMethod({ intent: "payment", confidence: 0.8 });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(false);
});

test("transfer intent is blocked", () => {
  const method = makeMethod({ intent: "transfer", confidence: 0.8 });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(false);
});

test("send intent is blocked", () => {
  const method = makeMethod({ intent: "send", confidence: 0.8 });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(false);
});

test("accept_terms intent is blocked", () => {
  const method = makeMethod({ intent: "accept_terms", confidence: 0.8 });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(false);
});

test("sensitive=true blocks approval", () => {
  const method = makeMethod({ sensitive: true, intent: "open_home", confidence: 0.8 });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(false);
  expect(result.reason).toContain("sensitive=true");
});

test("low confidence blocks approval", () => {
  const method = makeMethod({ confidence: 0.3 });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(false);
  expect(result.reason).toContain("confidence");
});

test("non-candidate status blocks approval", () => {
  const method = makeMethod({ status: "active" });
  const result = isMethodAutoApprovable(method, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvable).toBe(false);
});

test("safe intents are approvable", () => {
  const safeIntents = ["open_home", "start_session", "open_product_information", "select_category", "select_product", "click_primary_action", "expect_loaded"];
  for (const intent of safeIntents) {
    const method = makeMethod({ intent, confidence: 0.8 });
    const result = isMethodAutoApprovable(method, {
      confidenceThreshold: 0.5,
      blockSensitive: true
    });
    expect(result.approvable).toBe(true);
  }
});

// ==========================================
// C. isPageObjectAutoApprovable tests
// ==========================================

test("page object with all safe methods returns approvable", () => {
  const po = makePageObject({
    methods: [
      makeMethod({ name: "start", intent: "start_session" }),
      makeMethod({ name: "openHome", intent: "open_home" })
    ]
  });
  const result = isPageObjectAutoApprovable(po, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvableMethods.length).toBe(2);
  expect(result.blockedMethods.length).toBe(0);
});

test("page object with mixed methods separates approvable/blocked", () => {
  const po = makePageObject({
    methods: [
      makeMethod({ name: "start", intent: "start_session" }),
      makeMethod({ name: "login", intent: "login" }),
      makeMethod({ name: "selectCategory", intent: "select_category" })
    ]
  });
  const result = isPageObjectAutoApprovable(po, {
    confidenceThreshold: 0.5,
    blockSensitive: true
  });
  expect(result.approvableMethods.length).toBe(2);
  expect(result.blockedMethods.length).toBe(1);
  expect(result.blockedMethods[0].method.name).toBe("login");
});

// ==========================================
// D. validatePomSpec tests
// ==========================================

function makeMockAppPaths(specPath: string): AppAutomationPaths {
  return { specPath } as AppAutomationPaths;
}

test("validatePomSpec fails if import points to .candidate.ts", () => {
  const spec = `import { HomePage } from '../../pages/home.page.candidate';`;
  const result = validatePomSpec(spec, undefined, makeMockAppPaths("/test/spec.ts"));
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.includes("candidate"))).toBe(true);
});

test("validatePomSpec passes with valid POM spec structure", () => {
  const spec = `import { test } from '@playwright/test';
import { HomePage } from '../../pages/home.page';

test('Test', async ({ page }) => {
  const homePage = new HomePage(page);
  await homePage.start();
});`;
  const registry: PageObjectRegistry = {
    version: "1.0",
    appSlug: "default",
    pageObjects: [{
      id: "po_1",
      className: "HomePage",
      filePath: "pages/home.page.ts",
      screenSignature: "screen:default-home",
      methods: [{
        name: "start",
        intent: "start_session",
        parameters: [],
        available: true,
        source: "test",
        sensitive: false,
        confidence: 0.8,
        status: "active"
      }],
      confidence: 0.8,
      status: "active",
      sourcePlanIds: ["test"],
      caseIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    componentCandidates: [],
    updatedAt: new Date().toISOString()
  };
  const result = validatePomSpec(spec, registry, makeMockAppPaths("C:/test/spec.ts"));
  expect(result.valid).toBe(true);
});

test("validatePomSpec fails if method not found in registry", () => {
  const spec = `import { test } from '@playwright/test';
import { HomePage } from '../../pages/home.page';

test('Test', async ({ page }) => {
  const homePage = new HomePage(page);
  await homePage.nonExistentMethod();
});`;
  const registry: PageObjectRegistry = {
    version: "1.0",
    appSlug: "default",
    pageObjects: [{
      id: "po_1",
      className: "HomePage",
      filePath: "pages/home.page.ts",
      screenSignature: "screen:default-home",
      methods: [{
        name: "start",
        intent: "start_session",
        parameters: [],
        available: true,
        source: "test",
        sensitive: false,
        confidence: 0.8,
        status: "active"
      }],
      confidence: 0.8,
      status: "active",
      sourcePlanIds: ["test"],
      caseIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    componentCandidates: [],
    updatedAt: new Date().toISOString()
  };
  const result = validatePomSpec(spec, registry, makeMockAppPaths("C:/test/spec.ts"));
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.includes("nonExistentMethod"))).toBe(true);
});

test("validatePomSpec fails if method is not active/available", () => {
  const spec = `import { test } from '@playwright/test';
import { HomePage } from '../../pages/home.page';

test('Test', async ({ page }) => {
  const homePage = new HomePage(page);
  await homePage.start();
});`;
  const registry: PageObjectRegistry = {
    version: "1.0",
    appSlug: "default",
    pageObjects: [{
      id: "po_1",
      className: "HomePage",
      filePath: "pages/home.page.ts",
      screenSignature: "screen:default-home",
      methods: [{
        name: "start",
        intent: "start_session",
        parameters: [],
        available: false,
        source: "test",
        sensitive: false,
        confidence: 0.8,
        status: "candidate"
      }],
      confidence: 0.8,
      status: "candidate",
      sourcePlanIds: ["test"],
      caseIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }],
    componentCandidates: [],
    updatedAt: new Date().toISOString()
  };
  const result = validatePomSpec(spec, registry, makeMockAppPaths("C:/test/spec.ts"));
  expect(result.valid).toBe(false);
  expect(result.errors.some(e => e.includes("not active/available"))).toBe(true);
});
