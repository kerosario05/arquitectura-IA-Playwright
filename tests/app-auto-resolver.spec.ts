import { test, expect } from "@playwright/test";
import {
  normalizeAppSlug,
  inferAppFromTestRailSection,
  resolveAppForPreview,
  detectKioskoInfoProductos,
  seedKioskoInfoProductosRouteProfile,
  buildEntrySteps,
  ensureFunctionalAppProfile,
} from "../src/automations/app-auto-resolver";
import { loadAutomationIndex } from "../src/automations/automation-index";
import fs from "node:fs/promises";
import path from "node:path";

// ── normalizeAppSlug ──────────────────────────────────────────────

test("normalizeAppSlug: Kiosko → kiosko", () => {
  expect(normalizeAppSlug("Kiosko")).toBe("kiosko");
});

test("normalizeAppSlug: KIOSKO → kiosko", () => {
  expect(normalizeAppSlug("KIOSKO")).toBe("kiosko");
});

test("normalizeAppSlug: Fénix → fenix", () => {
  expect(normalizeAppSlug("Fénix")).toBe("fenix");
});

test("normalizeAppSlug: Banca Móvil → banca-movil", () => {
  expect(normalizeAppSlug("Banca Móvil")).toBe("banca-movil");
});

test("normalizeAppSlug: Detalle_KIOSKO → detalle-kiosko", () => {
  expect(normalizeAppSlug("Detalle_KIOSKO")).toBe("detalle-kiosko");
});

test("normalizeAppSlug: blocks path traversal", () => {
  expect(normalizeAppSlug("foo/../bar")).toBe("foobar");
  expect(normalizeAppSlug("foo\\bar")).toBe("foobar");
  expect(normalizeAppSlug("..")).toBe("");
});

test("normalizeAppSlug: empty input → empty string", () => {
  expect(normalizeAppSlug("")).toBe("");
  expect(normalizeAppSlug("   ")).toBe("");
});

// ── inferAppFromTestRailSection ───────────────────────────────────

test("inferAppFromTestRailSection: Regresion Kiosko → kiosko", () => {
  const result = inferAppFromTestRailSection("Regresion Kiosko");
  expect(result).not.toBeNull();
  expect(result!.appSlug).toBe("kiosko");
  expect(result!.appName).toBe("Kiosko");
  expect(result!.source).toBe("testrail_section");
  expect(result!.confidence).toBe("high");
});

test("inferAppFromTestRailSection: Regresión Kiosko → kiosko", () => {
  const result = inferAppFromTestRailSection("Regresión Kiosko");
  expect(result).not.toBeNull();
  expect(result!.appSlug).toBe("kiosko");
});

test("inferAppFromTestRailSection: Detalle Kiosko → kiosko", () => {
  const result = inferAppFromTestRailSection("Detalle Kiosko");
  expect(result).not.toBeNull();
  expect(result!.appSlug).toBe("kiosko");
});

test("inferAppFromTestRailSection: Detalle_KIOSKO → kiosko", () => {
  const result = inferAppFromTestRailSection("Detalle_KIOSKO");
  expect(result).not.toBeNull();
  expect(result!.appSlug).toBe("kiosko");
  expect(result!.appName).toBe("KIOSKO");
});

test("inferAppFromTestRailSection: Regresion_KIOSKO → kiosko", () => {
  const result = inferAppFromTestRailSection("Regresion_KIOSKO");
  expect(result).not.toBeNull();
  expect(result!.appSlug).toBe("kiosko");
});

test("inferAppFromTestRailSection: Smoke Fenix → fenix", () => {
  const result = inferAppFromTestRailSection("Smoke Fenix");
  expect(result).not.toBeNull();
  expect(result!.appSlug).toBe("fenix");
});

test("inferAppFromTestRailSection: Regresion Banca Movil → banca-movil", () => {
  const result = inferAppFromTestRailSection("Regresion Banca Movil");
  expect(result).not.toBeNull();
  expect(result!.appSlug).toBe("banca-movil");
});

test("inferAppFromTestRailSection: Detalle Banca Móvil → banca-movil", () => {
  const result = inferAppFromTestRailSection("Detalle Banca Móvil");
  expect(result).not.toBeNull();
  expect(result!.appSlug).toBe("banca-movil");
});

test("inferAppFromTestRailSection: empty → null", () => {
  expect(inferAppFromTestRailSection("")).toBeNull();
  expect(inferAppFromTestRailSection("   ")).toBeNull();
});

// ── resolveAppForPreview ──────────────────────────────────────────

test("resolveAppForPreview: explicit targetAppSlug wins", () => {
  const result = resolveAppForPreview({
    targetAppSlug: "kiosko",
    testrailSectionName: "Regresion Fenix",
    requestAppSlug: "arquitectura-automatizacion",
  });
  expect(result.appSlug).toBe("kiosko");
  expect(result.source).toBe("explicit");
  expect(result.confidence).toBe("high");
});

test("resolveAppForPreview: testrail_section when no explicit", () => {
  const result = resolveAppForPreview({
    testrailSectionName: "Detalle_KIOSKO",
    requestAppSlug: "arquitectura-automatizacion",
  });
  expect(result.appSlug).toBe("kiosko");
  expect(result.source).toBe("testrail_section");
  expect(result.confidence).toBe("high");
});

test("resolveAppForPreview: fallback to request appSlug", () => {
  const result = resolveAppForPreview({
    requestAppSlug: "arquitectura-automatizacion",
  });
  expect(result.appSlug).toBe("arquitectura-automatizacion");
  expect(result.source).toBe("fallback");
});

test("resolveAppForPreview: last fallback is default", () => {
  const result = resolveAppForPreview({});
  expect(result.appSlug).toBe("default");
  expect(result.source).toBe("fallback");
});

// ── detectKioskoInfoProductos ─────────────────────────────────────

test("detectKioskoInfoProductos: detects from jiraSummary", () => {
  expect(
    detectKioskoInfoProductos({
      targetAppSlug: "kiosko",
      jiraSummary: "Visualizar información de productos en kiosko",
    }),
  ).toBe(true);
});

test("detectKioskoInfoProductos: detects from jiraDescription", () => {
  expect(
    detectKioskoInfoProductos({
      targetAppSlug: "kiosko",
      jiraDescription: "El usuario debe poder navegar por la información de productos.",
    }),
  ).toBe(true);
});

test("detectKioskoInfoProductos: detects from scenarioTitles", () => {
  expect(
    detectKioskoInfoProductos({
      targetAppSlug: "kiosko",
      scenarioTitles: [
        "Visualizar categorías de información de productos",
        "Ver detalle de tarjeta de crédito",
      ],
    }),
  ).toBe(true);
});

test("detectKioskoInfoProductos: detects from testrailSectionName", () => {
  expect(
    detectKioskoInfoProductos({
      targetAppSlug: "kiosko",
      testrailSectionName: "Información de productos",
    }),
  ).toBe(true);
});

test("detectKioskoInfoProductos: returns false for non-kiosko", () => {
  expect(
    detectKioskoInfoProductos({
      targetAppSlug: "fenix",
      jiraSummary: "Información de productos",
    }),
  ).toBe(false);
});

test("detectKioskoInfoProductos: returns false when no productos keyword", () => {
  expect(
    detectKioskoInfoProductos({
      targetAppSlug: "kiosko",
      jiraSummary: "Consulta de balance",
      jiraDescription: "Ver depósitos a plazo",
    }),
  ).toBe(false);
});

test("detectKioskoInfoProductos: handles accents normalization", () => {
  expect(
    detectKioskoInfoProductos({
      targetAppSlug: "kiosko",
      jiraSummary: "Informacion de productos",
    }),
  ).toBe(true);
});

// ── seedKioskoInfoProductosRouteProfile ───────────────────────────

test("seedKioskoInfoProductosRouteProfile: has correct entry", () => {
  const rp = seedKioskoInfoProductosRouteProfile();
  expect(rp.name).toBe("informacion_productos");
  expect(rp.entry).toHaveLength(2);
  expect((rp.entry as any[])[0].visibleLabel).toBe("Iniciar");
  expect((rp.entry as any[])[1].visibleLabel).toBe("Información de productos");
});

test("seedKioskoInfoProductosRouteProfile: has aliases", () => {
  const rp = seedKioskoInfoProductosRouteProfile();
  expect(rp.aliases).toHaveProperty("tarjetas_credito");
  expect(rp.aliases).toHaveProperty("depositos_plazo");
  expect(rp.aliases).toHaveProperty("cuentas_efectivo");
  expect(rp.aliases).toHaveProperty("prestamos");
});

test("seedKioskoInfoProductosRouteProfile: has visibleControls", () => {
  const rp = seedKioskoInfoProductosRouteProfile();
  expect(rp.visibleControls).toContain("Iniciar");
  expect(rp.visibleControls).toContain("Información de productos");
  expect(rp.visibleControls).toContain("Tarjetas de crédito");
  expect(rp.visibleControls).toContain("Depósitos a Plazo");
  expect(rp.visibleControls).toContain("Préstamos");
});

// ── buildEntrySteps ───────────────────────────────────────────────

test("buildEntrySteps: extracts visibleLabels from entry", () => {
  const rp = seedKioskoInfoProductosRouteProfile();
  const steps = buildEntrySteps(rp);
  expect(steps).toEqual(["Iniciar", "Información de productos"]);
});

test("buildEntrySteps: returns empty for null", () => {
  expect(buildEntrySteps(null)).toEqual([]);
});

test("buildEntrySteps: returns empty for missing entry", () => {
  expect(buildEntrySteps({ name: "test" })).toEqual([]);
});

test.describe("ensureFunctionalAppProfile index bootstrap", () => {
  const appSlug = "preview-index-test";
  const appDir = path.join(process.cwd(), "automations", "apps", appSlug);

  test.afterEach(async () => {
    await fs.rm(appDir, { recursive: true, force: true });
  });

  test("creates versioned automation/page-object/flow indexes", async () => {
    await ensureFunctionalAppProfile({
      appSlug,
      appName: "Preview Index Test",
      source: "explicit",
    });

    const automationIndex = JSON.parse(await fs.readFile(path.join(appDir, "index.json"), "utf-8"));
    const pageObjectIndex = JSON.parse(await fs.readFile(path.join(appDir, "page-objects.index.json"), "utf-8"));
    const flowIndex = JSON.parse(await fs.readFile(path.join(appDir, "flows.index.json"), "utf-8"));

    expect(automationIndex.version).toBe("1.0");
    expect(Array.isArray(automationIndex.automations)).toBe(true);
    expect(pageObjectIndex.version).toBe("1.0");
    expect(Array.isArray(pageObjectIndex.pageObjects)).toBe(true);
    expect(Array.isArray(pageObjectIndex.componentCandidates)).toBe(true);
    expect(flowIndex.version).toBe("1.0");
    expect(Array.isArray(flowIndex.flows)).toBe(true);
  });

  test("loadAutomationIndex migrates legacy bootstrap index without throwing", async () => {
    await fs.mkdir(appDir, { recursive: true });
    const indexPath = path.join(appDir, "index.json");
    await fs.writeFile(indexPath, JSON.stringify({
      appSlug,
      name: "Legacy Preview App",
      createdAt: new Date().toISOString(),
      entries: [],
    }, null, 2), "utf-8");

    const loaded = await loadAutomationIndex(indexPath);
    expect(loaded.version).toBe("1.0");
    expect(loaded.automations).toEqual([]);
  });
});
