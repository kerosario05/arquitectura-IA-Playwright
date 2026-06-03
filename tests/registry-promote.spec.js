"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const registry_promoter_1 = require("../src/registry/registry-promoter");
const object_registry_loader_1 = require("../src/registry/object-registry-loader");
const test_temp_dir_1 = require("./helpers/test-temp-dir");
const tmpRoot = (0, test_temp_dir_1.getTestTempDir)("test-registry-promote");
function makePlan(status = "validated") {
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
function makeObject(overrides) {
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
async function writeDiscoveryArtifacts(targetDir, plan, objects) {
    await promises_1.default.mkdir(targetDir, { recursive: true });
    await promises_1.default.writeFile(node_path_1.default.join(targetDir, "discovered-plans.pending.json"), JSON.stringify(plan, null, 2), "utf-8");
    await promises_1.default.writeFile(node_path_1.default.join(targetDir, "discovered-objects.pending.json"), JSON.stringify(objects, null, 2), "utf-8");
}
async function writeRegistry(registryPath, objects) {
    await promises_1.default.mkdir(node_path_1.default.dirname(registryPath), { recursive: true });
    await promises_1.default.writeFile(registryPath, JSON.stringify({
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
    }, null, 2), "utf-8");
}
test_1.test.beforeEach(async () => {
    await (0, test_temp_dir_1.cleanTestTempDir)("test-registry-promote").catch(() => { });
    await (0, test_temp_dir_1.ensureTestTempDir)("test-registry-promote");
});
(0, test_1.test)("dry-run no escribe cambios", async () => {
    const discoveryDir = node_path_1.default.join(tmpRoot, "discovery");
    const registryPath = node_path_1.default.join(tmpRoot, "registry.json");
    await writeRegistry(registryPath, []);
    await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
        makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button" })
    ]);
    const report = await (0, registry_promoter_1.buildRegistryPromotionReport)({
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
    const registry = await (0, object_registry_loader_1.loadObjectRegistry)(registryPath);
    (0, test_1.expect)(report.registryWritten).toBe(false);
    (0, test_1.expect)(registry.objects).toHaveLength(0);
});
(0, test_1.test)("approve escribe cambios estables", async () => {
    const discoveryDir = node_path_1.default.join(tmpRoot, "discovery");
    const registryPath = node_path_1.default.join(tmpRoot, "registry.json");
    await writeRegistry(registryPath, []);
    await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
        makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button" })
    ]);
    const report = await (0, registry_promoter_1.buildRegistryPromotionReport)({
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
    const applied = await (0, registry_promoter_1.applyRegistryPromotion)(report, registryPath);
    const registry = await (0, object_registry_loader_1.loadObjectRegistry)(registryPath);
    (0, test_1.expect)(applied.registryWritten).toBe(true);
    (0, test_1.expect)(registry.objects.some((object) => object.key === "button_primary_cta")).toBe(true);
});
(0, test_1.test)("rechaza plan no validated", async () => {
    const discoveryDir = node_path_1.default.join(tmpRoot, "discovery");
    const registryPath = node_path_1.default.join(tmpRoot, "registry.json");
    await writeRegistry(registryPath, []);
    await writeDiscoveryArtifacts(discoveryDir, makePlan("needs_discovery"), []);
    await (0, test_1.expect)((0, registry_promoter_1.buildRegistryPromotionReport)({
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
(0, test_1.test)("rechaza objeto bajo confidence threshold", async () => {
    const discoveryDir = node_path_1.default.join(tmpRoot, "discovery");
    const registryPath = node_path_1.default.join(tmpRoot, "registry.json");
    await writeRegistry(registryPath, []);
    await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
        makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button", confidence: 0.5 })
    ]);
    const report = await (0, registry_promoter_1.buildRegistryPromotionReport)({
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
    (0, test_1.expect)(report.objectsToPromote).toHaveLength(0);
    (0, test_1.expect)(report.objectsSkipped[0].reason).toContain("Below confidence threshold");
});
(0, test_1.test)("deduplica objetos repetidos", async () => {
    const discoveryDir = node_path_1.default.join(tmpRoot, "discovery");
    const registryPath = node_path_1.default.join(tmpRoot, "registry.json");
    await writeRegistry(registryPath, []);
    await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
        makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button", confidence: 0.8 }),
        makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button", confidence: 0.95 })
    ]);
    const report = await (0, registry_promoter_1.buildRegistryPromotionReport)({
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
    (0, test_1.expect)(report.objectsToPromote).toHaveLength(1);
    (0, test_1.expect)(report.duplicatesMerged.length).toBeGreaterThan(0);
});
(0, test_1.test)("detecta conflicto mismo key locator diferente", async () => {
    const discoveryDir = node_path_1.default.join(tmpRoot, "discovery");
    const registryPath = node_path_1.default.join(tmpRoot, "registry.json");
    await writeRegistry(registryPath, []);
    await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
        makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button", locator: { strategy: "text", value: "Primary CTA", exact: false } }),
        makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button", locator: { strategy: "text", value: "Primary CTA Updated", exact: false } })
    ]);
    const report = await (0, registry_promoter_1.buildRegistryPromotionReport)({
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
    (0, test_1.expect)(report.conflicts.length).toBe(1);
});
(0, test_1.test)("filtra sections informativas por defecto", async () => {
    const discoveryDir = node_path_1.default.join(tmpRoot, "discovery");
    const registryPath = node_path_1.default.join(tmpRoot, "registry.json");
    await writeRegistry(registryPath, []);
    await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
        makeObject({ key: "section_welcome", name: "Welcome", type: "section" })
    ]);
    const report = await (0, registry_promoter_1.buildRegistryPromotionReport)({
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
    (0, test_1.expect)(report.objectsToPromote).toHaveLength(0);
    (0, test_1.expect)(report.objectsSkipped[0].reason).toContain("Informational/section");
});
(0, test_1.test)("promueve accionables usados por plan", async () => {
    const discoveryDir = node_path_1.default.join(tmpRoot, "discovery");
    const registryPath = node_path_1.default.join(tmpRoot, "registry.json");
    await writeRegistry(registryPath, []);
    await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
        makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button" }),
        makeObject({ key: "button_secondary_cta", name: "Secondary CTA", type: "button" })
    ]);
    const report = await (0, registry_promoter_1.buildRegistryPromotionReport)({
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
    (0, test_1.expect)(report.objectsToPromote.map((object) => object.key)).toEqual(["button_primary_cta"]);
});
(0, test_1.test)("no promueve global navigation por defecto", async () => {
    const discoveryDir = node_path_1.default.join(tmpRoot, "discovery");
    const registryPath = node_path_1.default.join(tmpRoot, "registry.json");
    await writeRegistry(registryPath, []);
    await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
        makeObject({ key: "button_volver", name: "Volver", type: "button" })
    ]);
    const report = await (0, registry_promoter_1.buildRegistryPromotionReport)({
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
    (0, test_1.expect)(report.objectsToPromote).toHaveLength(0);
    (0, test_1.expect)(report.objectsSkipped[0].reason).toContain("global/navigation");
});
(0, test_1.test)("registry inspect path reflects promoted objects after apply", async () => {
    const discoveryDir = node_path_1.default.join(tmpRoot, "discovery");
    const registryPath = node_path_1.default.join(tmpRoot, "registry.json");
    await writeRegistry(registryPath, []);
    await writeDiscoveryArtifacts(discoveryDir, makePlan(), [
        makeObject({ key: "button_primary_cta", name: "Primary CTA", type: "button" })
    ]);
    const report = await (0, registry_promoter_1.buildRegistryPromotionReport)({
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
    await (0, registry_promoter_1.applyRegistryPromotion)(report, registryPath);
    const registry = await (0, object_registry_loader_1.loadObjectRegistry)(registryPath);
    (0, test_1.expect)(registry.objects.length).toBe(1);
});
