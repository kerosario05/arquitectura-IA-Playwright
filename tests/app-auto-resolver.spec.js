"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const app_auto_resolver_1 = require("../src/automations/app-auto-resolver");
const automation_index_1 = require("../src/automations/automation-index");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
// ── normalizeAppSlug ──────────────────────────────────────────────
(0, test_1.test)("normalizeAppSlug: Kiosko → kiosko", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.normalizeAppSlug)("Kiosko")).toBe("kiosko");
});
(0, test_1.test)("normalizeAppSlug: KIOSKO → kiosko", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.normalizeAppSlug)("KIOSKO")).toBe("kiosko");
});
(0, test_1.test)("normalizeAppSlug: Fénix → fenix", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.normalizeAppSlug)("Fénix")).toBe("fenix");
});
(0, test_1.test)("normalizeAppSlug: Banca Móvil → banca-movil", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.normalizeAppSlug)("Banca Móvil")).toBe("banca-movil");
});
(0, test_1.test)("normalizeAppSlug: Detalle_KIOSKO → detalle-kiosko", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.normalizeAppSlug)("Detalle_KIOSKO")).toBe("detalle-kiosko");
});
(0, test_1.test)("normalizeAppSlug: blocks path traversal", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.normalizeAppSlug)("foo/../bar")).toBe("foobar");
    (0, test_1.expect)((0, app_auto_resolver_1.normalizeAppSlug)("foo\\bar")).toBe("foobar");
    (0, test_1.expect)((0, app_auto_resolver_1.normalizeAppSlug)("..")).toBe("");
});
(0, test_1.test)("normalizeAppSlug: empty input → empty string", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.normalizeAppSlug)("")).toBe("");
    (0, test_1.expect)((0, app_auto_resolver_1.normalizeAppSlug)("   ")).toBe("");
});
// ── inferAppFromTestRailSection ───────────────────────────────────
(0, test_1.test)("inferAppFromTestRailSection: Regresion Kiosko → kiosko", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Regresion Kiosko");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("kiosko");
    (0, test_1.expect)(result.appName).toBe("Kiosko");
    (0, test_1.expect)(result.source).toBe("testrail_section");
    (0, test_1.expect)(result.confidence).toBe("high");
});
(0, test_1.test)("inferAppFromTestRailSection: Regresión Kiosko → kiosko", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Regresión Kiosko");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("kiosko");
});
(0, test_1.test)("inferAppFromTestRailSection: Detalle Kiosko → kiosko", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Detalle Kiosko");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("kiosko");
});
(0, test_1.test)("inferAppFromTestRailSection: Detalle_KIOSKO → kiosko", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Detalle_KIOSKO");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("kiosko");
    (0, test_1.expect)(result.appName).toBe("KIOSKO");
});
(0, test_1.test)("inferAppFromTestRailSection: Regresion_KIOSKO → kiosko", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Regresion_KIOSKO");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("kiosko");
});
(0, test_1.test)("inferAppFromTestRailSection: Smoke Fenix → fenix", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Smoke Fenix");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("fenix");
});
(0, test_1.test)("inferAppFromTestRailSection: Regresion Banca Movil → banca-movil", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Regresion Banca Movil");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("banca-movil");
});
(0, test_1.test)("inferAppFromTestRailSection: Detalle Banca Móvil → banca-movil", () => {
    const result = (0, app_auto_resolver_1.inferAppFromTestRailSection)("Detalle Banca Móvil");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result.appSlug).toBe("banca-movil");
});
(0, test_1.test)("inferAppFromTestRailSection: empty → null", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.inferAppFromTestRailSection)("")).toBeNull();
    (0, test_1.expect)((0, app_auto_resolver_1.inferAppFromTestRailSection)("   ")).toBeNull();
});
// ── resolveAppForPreview ──────────────────────────────────────────
(0, test_1.test)("resolveAppForPreview: explicit targetAppSlug wins", () => {
    const result = (0, app_auto_resolver_1.resolveAppForPreview)({
        targetAppSlug: "kiosko",
        testrailSectionName: "Regresion Fenix",
        requestAppSlug: "arquitectura-automatizacion",
    });
    (0, test_1.expect)(result.appSlug).toBe("kiosko");
    (0, test_1.expect)(result.source).toBe("explicit");
    (0, test_1.expect)(result.confidence).toBe("high");
});
(0, test_1.test)("resolveAppForPreview: testrail_section when no explicit", () => {
    const result = (0, app_auto_resolver_1.resolveAppForPreview)({
        testrailSectionName: "Detalle_KIOSKO",
        requestAppSlug: "arquitectura-automatizacion",
    });
    (0, test_1.expect)(result.appSlug).toBe("kiosko");
    (0, test_1.expect)(result.source).toBe("testrail_section");
    (0, test_1.expect)(result.confidence).toBe("high");
});
(0, test_1.test)("resolveAppForPreview: fallback to request appSlug", () => {
    const result = (0, app_auto_resolver_1.resolveAppForPreview)({
        requestAppSlug: "arquitectura-automatizacion",
    });
    (0, test_1.expect)(result.appSlug).toBe("arquitectura-automatizacion");
    (0, test_1.expect)(result.source).toBe("fallback");
});
(0, test_1.test)("resolveAppForPreview: last fallback is default", () => {
    const result = (0, app_auto_resolver_1.resolveAppForPreview)({});
    (0, test_1.expect)(result.appSlug).toBe("default");
    (0, test_1.expect)(result.source).toBe("fallback");
});
// ── detectKioskoInfoProductos ─────────────────────────────────────
(0, test_1.test)("detectKioskoInfoProductos: detects from jiraSummary", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.detectKioskoInfoProductos)({
        targetAppSlug: "kiosko",
        jiraSummary: "Visualizar información de productos en kiosko",
    })).toBe(true);
});
(0, test_1.test)("detectKioskoInfoProductos: detects from jiraDescription", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.detectKioskoInfoProductos)({
        targetAppSlug: "kiosko",
        jiraDescription: "El usuario debe poder navegar por la información de productos.",
    })).toBe(true);
});
(0, test_1.test)("detectKioskoInfoProductos: detects from scenarioTitles", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.detectKioskoInfoProductos)({
        targetAppSlug: "kiosko",
        scenarioTitles: [
            "Visualizar categorías de información de productos",
            "Ver detalle de tarjeta de crédito",
        ],
    })).toBe(true);
});
(0, test_1.test)("detectKioskoInfoProductos: detects from testrailSectionName", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.detectKioskoInfoProductos)({
        targetAppSlug: "kiosko",
        testrailSectionName: "Información de productos",
    })).toBe(true);
});
(0, test_1.test)("detectKioskoInfoProductos: returns false for non-kiosko", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.detectKioskoInfoProductos)({
        targetAppSlug: "fenix",
        jiraSummary: "Información de productos",
    })).toBe(false);
});
(0, test_1.test)("detectKioskoInfoProductos: returns false when no productos keyword", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.detectKioskoInfoProductos)({
        targetAppSlug: "kiosko",
        jiraSummary: "Consulta de balance",
        jiraDescription: "Ver depósitos a plazo",
    })).toBe(false);
});
(0, test_1.test)("detectKioskoInfoProductos: handles accents normalization", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.detectKioskoInfoProductos)({
        targetAppSlug: "kiosko",
        jiraSummary: "Informacion de productos",
    })).toBe(true);
});
// ── seedKioskoInfoProductosRouteProfile ───────────────────────────
(0, test_1.test)("seedKioskoInfoProductosRouteProfile: has correct entry", () => {
    const rp = (0, app_auto_resolver_1.seedKioskoInfoProductosRouteProfile)();
    (0, test_1.expect)(rp.name).toBe("informacion_productos");
    (0, test_1.expect)(rp.entry).toHaveLength(2);
    (0, test_1.expect)(rp.entry[0].visibleLabel).toBe("Iniciar");
    (0, test_1.expect)(rp.entry[1].visibleLabel).toBe("Información de productos");
});
(0, test_1.test)("seedKioskoInfoProductosRouteProfile: has aliases", () => {
    const rp = (0, app_auto_resolver_1.seedKioskoInfoProductosRouteProfile)();
    (0, test_1.expect)(rp.aliases).toHaveProperty("tarjetas_credito");
    (0, test_1.expect)(rp.aliases).toHaveProperty("depositos_plazo");
    (0, test_1.expect)(rp.aliases).toHaveProperty("cuentas_efectivo");
    (0, test_1.expect)(rp.aliases).toHaveProperty("prestamos");
});
(0, test_1.test)("seedKioskoInfoProductosRouteProfile: has visibleControls", () => {
    const rp = (0, app_auto_resolver_1.seedKioskoInfoProductosRouteProfile)();
    (0, test_1.expect)(rp.visibleControls).toContain("Iniciar");
    (0, test_1.expect)(rp.visibleControls).toContain("Información de productos");
    (0, test_1.expect)(rp.visibleControls).toContain("Tarjetas de crédito");
    (0, test_1.expect)(rp.visibleControls).toContain("Depósitos a Plazo");
    (0, test_1.expect)(rp.visibleControls).toContain("Préstamos");
});
// ── buildEntrySteps ───────────────────────────────────────────────
(0, test_1.test)("buildEntrySteps: extracts visibleLabels from entry", () => {
    const rp = (0, app_auto_resolver_1.seedKioskoInfoProductosRouteProfile)();
    const steps = (0, app_auto_resolver_1.buildEntrySteps)(rp);
    (0, test_1.expect)(steps).toEqual(["Iniciar", "Información de productos"]);
});
(0, test_1.test)("buildEntrySteps: returns empty for null", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.buildEntrySteps)(null)).toEqual([]);
});
(0, test_1.test)("buildEntrySteps: returns empty for missing entry", () => {
    (0, test_1.expect)((0, app_auto_resolver_1.buildEntrySteps)({ name: "test" })).toEqual([]);
});
test_1.test.describe("ensureFunctionalAppProfile index bootstrap", () => {
    const appSlug = "preview-index-test";
    const appDir = node_path_1.default.join(process.cwd(), "automations", "apps", appSlug);
    test_1.test.afterEach(async () => {
        await promises_1.default.rm(appDir, { recursive: true, force: true });
    });
    (0, test_1.test)("creates versioned automation/page-object/flow indexes", async () => {
        await (0, app_auto_resolver_1.ensureFunctionalAppProfile)({
            appSlug,
            appName: "Preview Index Test",
            source: "explicit",
        });
        const automationIndex = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(appDir, "index.json"), "utf-8"));
        const pageObjectIndex = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(appDir, "page-objects.index.json"), "utf-8"));
        const flowIndex = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(appDir, "flows.index.json"), "utf-8"));
        (0, test_1.expect)(automationIndex.version).toBe("1.0");
        (0, test_1.expect)(Array.isArray(automationIndex.automations)).toBe(true);
        (0, test_1.expect)(pageObjectIndex.version).toBe("1.0");
        (0, test_1.expect)(Array.isArray(pageObjectIndex.pageObjects)).toBe(true);
        (0, test_1.expect)(Array.isArray(pageObjectIndex.componentCandidates)).toBe(true);
        (0, test_1.expect)(flowIndex.version).toBe("1.0");
        (0, test_1.expect)(Array.isArray(flowIndex.flows)).toBe(true);
    });
    (0, test_1.test)("loadAutomationIndex migrates legacy bootstrap index without throwing", async () => {
        await promises_1.default.mkdir(appDir, { recursive: true });
        const indexPath = node_path_1.default.join(appDir, "index.json");
        await promises_1.default.writeFile(indexPath, JSON.stringify({
            appSlug,
            name: "Legacy Preview App",
            createdAt: new Date().toISOString(),
            entries: [],
        }, null, 2), "utf-8");
        const loaded = await (0, automation_index_1.loadAutomationIndex)(indexPath);
        (0, test_1.expect)(loaded.version).toBe("1.0");
        (0, test_1.expect)(loaded.automations).toEqual([]);
    });
});
