import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadPageObjectRegistry,
  savePageObjectRegistry,
  findPageObjectByScreenSignature,
  findMethodForIntent,
  findReusableMethod,
  registerPageObjectCandidate,
  registerMethodCandidate,
  markPageObjectActive,
  markMethodActive,
  registerComponentCandidate
} from "../src/automations/page-object-registry";
import type { PageObjectRegistry } from "../src/types/page-object.types";

function emptyReg(): PageObjectRegistry {
  return { version: "1.0", appSlug: "test", pageObjects: [], componentCandidates: [], updatedAt: new Date().toISOString() };
}

test("createEmptyRegistry produces empty registry", () => {
  const reg = emptyReg();
  expect(reg.version).toBe("1.0");
  expect(reg.appSlug).toBe("test");
  expect(reg.pageObjects).toHaveLength(0);
  expect(reg.componentCandidates).toHaveLength(0);
});

test("registerPageObjectCandidate adds new entry", () => {
  const reg = emptyReg();
  const { registry, created } = registerPageObjectCandidate(reg, {
    name: "LoginPage",
    className: "LoginPage",
    screenSignature: "signature:login",
    confidence: 0.9,
    sourcePlanId: "plan_1"
  });
  expect(created).toBe(true);
  expect(registry.pageObjects).toHaveLength(1);
  expect(registry.pageObjects[0].className).toBe("LoginPage");
  expect(registry.pageObjects[0].screenSignature).toBe("signature:login");
});

test("registerPageObjectCandidate does not duplicate same signature", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "LoginPage", className: "LoginPage", screenSignature: "sig1", confidence: 0.9, sourcePlanId: "plan_1"
  });
  expect(r1.created).toBe(true);
  const r2 = registerPageObjectCandidate(r1.registry, {
    name: "LoginPage", className: "LoginPage", screenSignature: "sig1", confidence: 0.9, sourcePlanId: "plan_2"
  });
  expect(r2.created).toBe(false);
  expect(r2.registry.pageObjects).toHaveLength(1);
});

test("registerPageObjectCandidate adds sourcePlanId to existing", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "LoginPage", className: "LoginPage", screenSignature: "sig1", confidence: 0.9, sourcePlanId: "plan_1"
  });
  const r2 = registerPageObjectCandidate(r1.registry, {
    name: "LoginPage", className: "LoginPage", screenSignature: "sig1", confidence: 0.9, sourcePlanId: "plan_2"
  });
  expect(r2.registry.pageObjects[0].sourcePlanIds).toContain("plan_1");
  expect(r2.registry.pageObjects[0].sourcePlanIds).toContain("plan_2");
});

test("findPageObjectByScreenSignature finds active PO", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1"
  });
  markPageObjectActive(r1.registry, r1.registry.pageObjects[0].id);
  const found = findPageObjectByScreenSignature(r1.registry, "sig:menu");
  expect(found).toBeDefined();
  expect(found!.className).toBe("MenuPage");
});

test("findPageObjectByScreenSignature ignores candidates", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1"
  });
  const found = findPageObjectByScreenSignature(r1.registry, "sig:menu");
  expect(found).toBeUndefined();
});

test("registerMethodCandidate adds method to PO", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "selectOption", intent: "click" }]
  });
  const poId = r1.registry.pageObjects[0].id;
  const r2 = registerMethodCandidate(r1.registry, poId, {
    name: "openMenu", intent: "navigate", sourceActionId: "action_1"
  });
  expect(r2.created).toBe(true);
  expect(r2.registry.pageObjects[0].methods).toHaveLength(2);
});

test("registerMethodCandidate does not duplicate intent", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "selectOption", intent: "click" }]
  });
  const poId = r1.registry.pageObjects[0].id;
  const r2 = registerMethodCandidate(r1.registry, poId, {
    name: "clickOption", intent: "click", sourceActionId: "action_2"
  });
  expect(r2.created).toBe(false);
});

test("findMethodForIntent returns available method", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "selectOption", intent: "click" }]
  });
  const po = r1.registry.pageObjects[0];
  markMethodActive(r1.registry, po.id, "selectOption");
  const found = findMethodForIntent(po, "click");
  expect(found).toBeDefined();
  expect(found!.name).toBe("selectOption");
});

test("findMethodForIntent returns undefined for candidate method", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "selectOption", intent: "click" }]
  });
  const po = r1.registry.pageObjects[0];
  const found = findMethodForIntent(po, "click");
  expect(found).toBeUndefined();
});

test("markMethodActive sets status to active and available true", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1",
    methods: [{ name: "selectOption", intent: "click" }]
  });
  const po = r1.registry.pageObjects[0];
  const ok = markMethodActive(r1.registry, po.id, "selectOption");
  expect(ok).toBe(true);
  expect(po.methods[0].available).toBe(true);
  expect(po.methods[0].status).toBe("active");
});

test("markPageObjectActive does nothing if already active", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "MenuPage", className: "MenuPage", screenSignature: "sig:menu", confidence: 0.8, sourcePlanId: "plan_1"
  });
  const poId = r1.registry.pageObjects[0].id;
  markPageObjectActive(r1.registry, poId);
  const again = markPageObjectActive(r1.registry, poId);
  expect(again).toBe(false);
});

test("findReusableMethod finds method by intent across active POs", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "LoginPage", className: "LoginPage", screenSignature: "sig:login", confidence: 0.9, sourcePlanId: "plan_1",
    methods: [{ name: "login", intent: "login" }]
  });
  const poId = r1.registry.pageObjects[0].id;
  markPageObjectActive(r1.registry, poId);
  markMethodActive(r1.registry, poId, "login");

  const found = findReusableMethod(r1.registry, "login");
  expect(found).toBeDefined();
  expect(found!.method.name).toBe("login");
});

test("findReusableMethod with screenSignature filters correctly", () => {
  const reg = emptyReg();
  const r1 = registerPageObjectCandidate(reg, {
    name: "LoginPage", className: "LoginPage", screenSignature: "sig:login", confidence: 0.9, sourcePlanId: "plan_1",
    methods: [{ name: "login", intent: "login" }]
  });
  const r2 = registerPageObjectCandidate(r1.registry, {
    name: "HomePage", className: "HomePage", screenSignature: "sig:home", confidence: 0.9, sourcePlanId: "plan_2",
    methods: [{ name: "login", intent: "login" }]
  });
  markPageObjectActive(r2.registry, r2.registry.pageObjects[0].id);
  markMethodActive(r2.registry, r2.registry.pageObjects[0].id, "login");
  markPageObjectActive(r2.registry, r2.registry.pageObjects[1].id);
  markMethodActive(r2.registry, r2.registry.pageObjects[1].id, "login");

  const found = findReusableMethod(r2.registry, "login", "sig:home");
  expect(found).toBeDefined();
  expect(found!.pageObject.className).toBe("HomePage");
});

test("registerComponentCandidate adds new component", () => {
  const reg = emptyReg();
  const { registry, created } = registerComponentCandidate(reg, {
    name: "DatePicker", className: "DatePickerComponent", componentSignature: "sig:datepicker", confidence: 0.75
  });
  expect(created).toBe(true);
  expect(registry.componentCandidates).toHaveLength(1);
});

test("registerComponentCandidate does not duplicate", () => {
  const reg = emptyReg();
  const r1 = registerComponentCandidate(reg, {
    name: "DatePicker", className: "DatePickerComponent", componentSignature: "sig:datepicker", confidence: 0.75
  });
  const r2 = registerComponentCandidate(r1.registry, {
    name: "DatePicker", className: "DatePickerComponent", componentSignature: "sig:datepicker", confidence: 0.8
  });
  expect(r2.created).toBe(false);
});

test("loadPageObjectRegistry initializes empty registry when file is missing", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "po-reg-missing-"));
  const registry = await loadPageObjectRegistry({ appSlug: "isolated-app" } as any, tmpDir);
  expect(registry.appSlug).toBe("isolated-app");
  expect(registry.pageObjects).toHaveLength(0);
});

test("savePageObjectRegistry writes valid JSON atomically", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "po-reg-atomic-"));
  const registry = emptyReg();
  registry.appSlug = "atomic-app";
  registerPageObjectCandidate(registry, {
    name: "HomePage",
    className: "HomePage",
    screenSignature: "sig:home",
    confidence: 0.9,
    sourcePlanId: "plan_1"
  });

  await savePageObjectRegistry(registry, { appSlug: "atomic-app" } as any, tmpDir);
  const registryPath = path.join(tmpDir, "automations", "apps", "atomic-app", "page-objects.index.json");
  const raw = await fs.readFile(registryPath, "utf-8");
  expect(() => JSON.parse(raw)).not.toThrow();
});

test("loadPageObjectRegistry retries transient read errors", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "po-reg-retry-"));
  const registry = emptyReg();
  registry.appSlug = "retry-app";
  await savePageObjectRegistry(registry, { appSlug: "retry-app" } as any, tmpDir);

  const originalReadFile = (fs as any).readFile;
  let attempts = 0;
  (fs as any).readFile = async (...args: any[]) => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("busy") as NodeJS.ErrnoException;
      error.code = "EBUSY";
      throw error;
    }
    return originalReadFile.apply(fs, args);
  };

  try {
    const loaded = await loadPageObjectRegistry({ appSlug: "retry-app" } as any, tmpDir);
    expect(loaded.appSlug).toBe("retry-app");
    expect(attempts).toBeGreaterThan(1);
  } finally {
    (fs as any).readFile = originalReadFile;
  }
});

test("loadPageObjectRegistry reports invalid JSON clearly", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "po-reg-invalid-"));
  const registryPath = path.join(tmpDir, "automations", "apps", "broken-app", "page-objects.index.json");
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, "{ invalid json", "utf-8");

  await expect(
    loadPageObjectRegistry({ appSlug: "broken-app" } as any, tmpDir)
  ).rejects.toThrow(/Invalid JSON in page object registry/);
});

test("loadPageObjectRegistry keeps app isolation by appSlug", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "po-reg-apps-"));
  const left = emptyReg();
  left.appSlug = "app-left";
  const right = emptyReg();
  right.appSlug = "app-right";
  registerPageObjectCandidate(left, {
    name: "LeftPage",
    className: "LeftPage",
    screenSignature: "sig:left",
    confidence: 0.8,
    sourcePlanId: "plan_left"
  });
  registerPageObjectCandidate(right, {
    name: "RightPage",
    className: "RightPage",
    screenSignature: "sig:right",
    confidence: 0.8,
    sourcePlanId: "plan_right"
  });

  await savePageObjectRegistry(left, { appSlug: "app-left" } as any, tmpDir);
  await savePageObjectRegistry(right, { appSlug: "app-right" } as any, tmpDir);

  const loadedLeft = await loadPageObjectRegistry({ appSlug: "app-left" } as any, tmpDir);
  const loadedRight = await loadPageObjectRegistry({ appSlug: "app-right" } as any, tmpDir);
  expect(loadedLeft.pageObjects[0].className).toBe("LeftPage");
  expect(loadedRight.pageObjects[0].className).toBe("RightPage");
});
