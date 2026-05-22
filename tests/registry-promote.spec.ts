import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { buildRegistryPromotionReport, applyRegistryPromotion } from "../src/registry/registry-promoter";
import { loadObjectRegistry } from "../src/registry/object-registry-loader";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { PendingDiscoveredObject } from "../src/types/registry-promotion.types";
import { getTestTempDir, ensureTestTempDir, cleanTestTempDir } from "./helpers/test-temp-dir";

const tmpRoot = getTestTempDir("test-registry-promote");

function makePlan(status: ExecutionPlan["status"] = "validated"): ExecutionPlan {
  return {
    version: "1.0",
    source: "discovery_generated",
    status,
    scenario: {
      source: "testrail",
      externalId: "C20000",
      caseId: 20000,
      title: "Generic discovery case"
    },
    requiredData: [],
    steps: [
      { index: 1, action: "navigate", target: "APP_BASE_URL" },
      { index: 2, action: "click", target: { strategy: "text", value: "Primary CTA", exact: false } },
      { index: 3, action: "assertText", target: { strategy: "text", value: "Visible Result", exact: false }, expected: "Visible Result" }
    ],
    createdAt: new Date().toISOString(),
    notes: ["Validated discovery plan"]
  };
}

function makeObject(overrides: Partial<PendingDiscoveredObject> & Pick<PendingDiscoveredObject, "key" | "name" | "type">): PendingDiscoveredObject {
  return {
    key: overrides.key,
    name: overrides.name,
    type: overrides.type,
    locator: overrides.locator ?? { strategy: "text", value: overrides.name, exact: false },
    aliases: overrides.aliases ?? [overrides.name.toLowerCase()],
    stable: overrides.stable,
    tags: overrides.tags,
    discoveredAt: overrides.discoveredAt ?? new Date().toISOString(),
    sourceStep: overrides.sourceStep ?? 2,
    confidence: overrides.confidence ?? 0.9
  };
}

async function writeDiscoveryArtifacts(targetDir: string, plan: ExecutionPlan, objects: PendingDiscoveredObject[]): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, "discovered-plans.pending.json"), JSON.stringify(plan, null, 2), "utf-8");
  await fs.writeFile(path.join(targetDir, "discovered-objects.pending.json"), JSON.stringify(objects, null, 2), "utf-8");
}

async function writeRegistry(registryPath: string, objects: Array<{ key: string; name: string; type: "button" | "section"; locatorValue: string }>): Promise<void> {
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(
    registryPath,
    JSON.stringify({
      version: "1.0",
      appName: "generic",
      objects: objects.map((object) => ({
        key: object.key,
        name: object.name,
        type: object.type,
        locator: { strategy: "text", value: object.locatorValue, exact: false }
      })),
      createdAt: "",
      updatedAt: ""
    }, null, 2),
    "utf-8"
  );
}

test.beforeEach(async () => {
  await cleanTestTempDir("test-registry-promote").catch(() => {});
  await ensureTestTempDir("test-registry-promote");
});

test("dry-run no escribe cambios", async () => {
  const discoveryDir = path.join(tmpRoot, "discovery");
  const registryPath = path.join(tmpRoot, "registry.json");
  await writeRegistry(registryPath, []);
  await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
    makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button" })
  ]);

  const report = await buildRegistryPromotionReport({
    fromDir: discoveryDir,
    dryRun: true,
    approve: false,
    confidenceThreshold: 0.8,
    promoteObjects: true,
    promotePlan: true,
    promoteAutomation: false,
    includeSections: false,
    excludeGlobalNavigation: true
  }, registryPath);

  const registry = await loadObjectRegistry(registryPath);
  expect(report.registryWritten).toBe(false);
  expect(registry.objects).toHaveLength(0);
});

test("approve escribe cambios estables", async () => {
  const discoveryDir = path.join(tmpRoot, "discovery");
  const registryPath = path.join(tmpRoot, "registry.json");
  await writeRegistry(registryPath, []);
  await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
    makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button" })
  ]);

  const report = await buildRegistryPromotionReport({
    fromDir: discoveryDir,
    dryRun: false,
    approve: true,
    confidenceThreshold: 0.8,
    promoteObjects: true,
    promotePlan: true,
    promoteAutomation: false,
    includeSections: false,
    excludeGlobalNavigation: true
  }, registryPath);
  const applied = await applyRegistryPromotion(report, registryPath);
  const registry = await loadObjectRegistry(registryPath);

  expect(applied.registryWritten).toBe(true);
  expect(registry.objects.some((object) => object.key === "button_primary_cta")).toBe(true);
});

test("rechaza plan no validated", async () => {
  const discoveryDir = path.join(tmpRoot, "discovery");
  const registryPath = path.join(tmpRoot, "registry.json");
  await writeRegistry(registryPath, []);
  await writeDiscoveryArtifacts(discoveryDir, makePlan("needs_discovery"), []);

  await expect(buildRegistryPromotionReport({
    fromDir: discoveryDir,
    dryRun: true,
    approve: false,
    confidenceThreshold: 0.8,
    promoteObjects: true,
    promotePlan: true,
    promoteAutomation: false,
    includeSections: false,
    excludeGlobalNavigation: true
  }, registryPath)).rejects.toThrow(/not eligible|not validated/i);
});

test("rechaza objeto bajo confidence threshold", async () => {
  const discoveryDir = path.join(tmpRoot, "discovery");
  const registryPath = path.join(tmpRoot, "registry.json");
  await writeRegistry(registryPath, []);
  await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
    makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button", confidence: 0.5 })
  ]);

  const report = await buildRegistryPromotionReport({
    fromDir: discoveryDir,
    dryRun: true,
    approve: false,
    confidenceThreshold: 0.8,
    promoteObjects: true,
    promotePlan: true,
    promoteAutomation: false,
    includeSections: false,
    excludeGlobalNavigation: true
  }, registryPath);

  expect(report.objectsToPromote).toHaveLength(0);
  expect(report.objectsSkipped[0].reason).toContain("Below confidence threshold");
});

test("deduplica objetos repetidos", async () => {
  const discoveryDir = path.join(tmpRoot, "discovery");
  const registryPath = path.join(tmpRoot, "registry.json");
  await writeRegistry(registryPath, []);
  await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
    makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button", confidence: 0.8 }),
    makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button", confidence: 0.95 })
  ]);

  const report = await buildRegistryPromotionReport({
    fromDir: discoveryDir,
    dryRun: true,
    approve: false,
    confidenceThreshold: 0.75,
    promoteObjects: true,
    promotePlan: true,
    promoteAutomation: false,
    includeSections: false,
    excludeGlobalNavigation: true
  }, registryPath);

  expect(report.objectsToPromote).toHaveLength(1);
  expect(report.duplicatesMerged.length).toBeGreaterThan(0);
});

test("detecta conflicto mismo key locator diferente", async () => {
  const discoveryDir = path.join(tmpRoot, "discovery");
  const registryPath = path.join(tmpRoot, "registry.json");
  await writeRegistry(registryPath, []);
  await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
    makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button", locator: { strategy: "text", value: "Primary CTA", exact: false } }),
    makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button", locator: { strategy: "text", value: "Primary CTA Updated", exact: false } })
  ]);

  const report = await buildRegistryPromotionReport({
    fromDir: discoveryDir,
    dryRun: true,
    approve: false,
    confidenceThreshold: 0.75,
    promoteObjects: true,
    promotePlan: true,
    promoteAutomation: false,
    includeSections: false,
    excludeGlobalNavigation: true
  }, registryPath);

  expect(report.conflicts.length).toBe(1);
});

test("filtra sections informativas por defecto", async () => {
  const discoveryDir = path.join(tmpRoot, "discovery");
  const registryPath = path.join(tmpRoot, "registry.json");
  await writeRegistry(registryPath, []);
  await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
    makeObject({ key: "section_welcome", name: "Welcome", type: "section" })
  ]);

  const report = await buildRegistryPromotionReport({
    fromDir: discoveryDir,
    dryRun: true,
    approve: false,
    confidenceThreshold: 0.75,
    promoteObjects: true,
    promotePlan: true,
    promoteAutomation: false,
    includeSections: false,
    excludeGlobalNavigation: true
  }, registryPath);

  expect(report.objectsToPromote).toHaveLength(0);
  expect(report.objectsSkipped[0].reason).toContain("Informational/section");
});

test("promueve accionables usados por plan", async () => {
  const discoveryDir = path.join(tmpRoot, "discovery");
  const registryPath = path.join(tmpRoot, "registry.json");
  await writeRegistry(registryPath, []);
  await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
    makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button" }),
    makeObject({ key: "button_secondary_cta", name: "Secondary CTA", type: "button" })
  ]);

  const report = await buildRegistryPromotionReport({
    fromDir: discoveryDir,
    dryRun: true,
    approve: false,
    confidenceThreshold: 0.75,
    promoteObjects: true,
    promotePlan: true,
    promoteAutomation: false,
    includeSections: false,
    excludeGlobalNavigation: true
  }, registryPath);

  expect(report.objectsToPromote.map((object) => object.key)).toEqual(["button_primary_cta"]);
});

test("no promueve global navigation por defecto", async () => {
  const discoveryDir = path.join(tmpRoot, "discovery");
  const registryPath = path.join(tmpRoot, "registry.json");
  await writeRegistry(registryPath, []);
  await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
    makeObject({ key: "button_volver", name: "Volver", type: "button" })
  ]);

  const report = await buildRegistryPromotionReport({
    fromDir: discoveryDir,
    dryRun: true,
    approve: false,
    confidenceThreshold: 0.75,
    promoteObjects: true,
    promotePlan: true,
    promoteAutomation: false,
    includeSections: false,
    excludeGlobalNavigation: true
  }, registryPath);

  expect(report.objectsToPromote).toHaveLength(0);
  expect(report.objectsSkipped[0].reason).toContain("global/navigation");
});

test("registry inspect path reflects promoted objects after apply", async () => {
  const discoveryDir = path.join(tmpRoot, "discovery");
  const registryPath = path.join(tmpRoot, "registry.json");
  await writeRegistry(registryPath, []);
  await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
    makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button" })
  ]);

  const report = await buildRegistryPromotionReport({
    fromDir: discoveryDir,
    dryRun: false,
    approve: true,
    confidenceThreshold: 0.75,
    promoteObjects: true,
    promotePlan: true,
    promoteAutomation: false,
    includeSections: false,
    excludeGlobalNavigation: true
  }, registryPath);
  await applyRegistryPromotion(report, registryPath);
  const registry = await loadObjectRegistry(registryPath);

  expect(registry.objects.length).toBe(1);
});
