/**
 * SectionSlug Tests
 * 
 * Tests for sectionSlug normalization and section-based spec organization.
 */

import { test, expect } from "@playwright/test";
import { normalizeSectionSlug, resolveSectionProfile, buildAppAutomationPaths, deriveAppProfile } from "../src/automations/app-profile";
import type { SectionProfile } from "../src/automations/app-profile";

test.describe("SectionSlug Normalization", () => {
  test("normalizes section names with accents", () => {
    expect(normalizeSectionSlug("API Tests")).toBe("api-tests");
    expect(normalizeSectionSlug("Arquitectura automatización")).toBe("arquitectura-automatizacion");
    expect(normalizeSectionSlug("REGRESIÓN-KIOSKO")).toBe("regresion-kiosko");
  });

  test("normalizes section names with spaces", () => {
    expect(normalizeSectionSlug("API Tests")).toBe("api-tests");
    expect(normalizeSectionSlug("Regression Tests")).toBe("regression-tests");
    expect(normalizeSectionSlug("Smoke Test Suite")).toBe("smoke-test-suite");
  });

  test("normalizes section names with uppercase", () => {
    expect(normalizeSectionSlug("REGRESION-KIOSKO")).toBe("regresion-kiosko");
    expect(normalizeSectionSlug("Kiosko")).toBe("kiosko");
    expect(normalizeSectionSlug("API")).toBe("api");
  });

  test("blocks path traversal", () => {
    expect(normalizeSectionSlug("../etc")).toBe("etc");
    expect(normalizeSectionSlug("foo/../../bar")).toBe("foo-bar");
    expect(normalizeSectionSlug("..\\..\\etc")).toBe("etc");
  });

  test("blocks slash characters", () => {
    expect(normalizeSectionSlug("foo/bar")).toBe("foo-bar");
    expect(normalizeSectionSlug("foo\\bar")).toBe("foo-bar");
  });

  test("limits to [a-z0-9-]", () => {
    expect(normalizeSectionSlug("API_Tests!@#")).toBe("api-tests");
    expect(normalizeSectionSlug("Test-123")).toBe("test-123");
    expect(normalizeSectionSlug("Special $%^")).toBe("special");
  });

  test("returns default-section for empty input", () => {
    expect(normalizeSectionSlug("")).toBe("default-section");
    expect(normalizeSectionSlug(undefined)).toBe("default-section");
    expect(normalizeSectionSlug("   ")).toBe("default-section");
  });
});

test.describe("SectionProfile Resolution", () => {
  test("resolves from CLI sectionSlug", async () => {
    const result = await resolveSectionProfile({
      cliSectionSlug: "api-tests"
    });
    
    expect(result.sectionProfile.sectionSlug).toBe("api-tests");
    expect(result.sectionProfile.source).toBe("cli");
  });

  test("resolves from test case sectionId and sectionName", async () => {
    const result = await resolveSectionProfile({
      testCaseSectionId: 123,
      testCaseSectionName: "API Tests"
    });
    
    expect(result.sectionProfile.sectionSlug).toBe("api-tests");
    expect(result.sectionProfile.source).toBe("testrail_case");
    expect(result.sectionProfile.sectionId).toBe(123);
    expect(result.sectionProfile.sectionName).toBe("API Tests");
  });

  test("resolves from env sectionId", async () => {
    const result = await resolveSectionProfile({
      envSectionId: 456
    });
    
    expect(result.sectionProfile.sectionSlug).toBe("section-456");
    expect(result.sectionProfile.source).toBe("env");
    expect(result.sectionProfile.sectionId).toBe(456);
  });

  test("falls back to default-section", async () => {
    const result = await resolveSectionProfile({});
    
    expect(result.sectionProfile.sectionSlug).toBe("default-section");
    expect(result.sectionProfile.source).toBe("default");
  });
});

test.describe("App Automation Paths with Section", () => {
  test("builds paths with sectionSlug", () => {
    const appProfile = deriveAppProfile({
      appProfile: "arquitectura-automatizacion",
      now: new Date().toISOString()
    });
    
    const paths = buildAppAutomationPaths(appProfile, "C38230", ".", "api-tests");
    
    expect(paths.casesDir.replace(/\\/g, "/")).toContain("sections/api-tests/cases");
    expect(paths.specsDir.replace(/\\/g, "/")).toContain("sections/api-tests/specs");
    expect(paths.evidenceDir.replace(/\\/g, "/")).toContain("sections/api-tests/evidence");
    expect(paths.runsDir.replace(/\\/g, "/")).toContain("sections/api-tests/runs");
    expect(paths.caseDir?.replace(/\\/g, "/")).toContain("sections/api-tests/cases/C38230");
    expect(paths.specPath?.replace(/\\/g, "/")).toContain("sections/api-tests/cases/C38230/case.spec.ts");
    
    // Pages, flows, components should still be at app level
    expect(paths.pagesDir).not.toContain("sections");
    expect(paths.flowsDir).not.toContain("sections");
    expect(paths.componentsDir).not.toContain("sections");
  });

  test("builds paths without sectionSlug (backward compatibility)", () => {
    const appProfile = deriveAppProfile({
      appProfile: "arquitectura-automatizacion",
      now: new Date().toISOString()
    });
    
    const paths = buildAppAutomationPaths(appProfile, "C38230", ".", undefined);
    
    expect(paths.casesDir.replace(/\\/g, "/")).toContain("cases");
    expect(paths.casesDir).not.toContain("sections");
    expect(paths.specsDir.replace(/\\/g, "/")).toContain("specs");
    expect(paths.specsDir).not.toContain("sections");
  });

  test("builds paths with default-section uses root folders", () => {
    const appProfile = deriveAppProfile({
      appProfile: "arquitectura-automatizacion",
      now: new Date().toISOString()
    });
    
    const paths = buildAppAutomationPaths(appProfile, "C38230", ".", "default-section");
    
    expect(paths.casesDir.replace(/\\/g, "/")).toContain("cases");
    expect(paths.casesDir).not.toContain("sections");
  });

  test("two sections of same appSlug share POM paths", () => {
    const appProfile = deriveAppProfile({
      appProfile: "arquitectura-automatizacion",
      now: new Date().toISOString()
    });
    
    const pathsApi = buildAppAutomationPaths(appProfile, "C38230", ".", "api-tests");
    const pathsRegression = buildAppAutomationPaths(appProfile, "C38231", ".", "regression-kiosko");
    
    // Pages, flows, components should be the same
    expect(pathsApi.pagesDir).toBe(pathsRegression.pagesDir);
    expect(pathsApi.flowsDir).toBe(pathsRegression.flowsDir);
    expect(pathsApi.componentsDir).toBe(pathsRegression.componentsDir);
    
    // Cases, specs, evidence should be different
    expect(pathsApi.casesDir).not.toBe(pathsRegression.casesDir);
    expect(pathsApi.specsDir).not.toBe(pathsRegression.specsDir);
  });

  test("two appSlug do not mix paths", () => {
    const appProfile1 = deriveAppProfile({
      appProfile: "arquitectura-automatizacion",
      now: new Date().toISOString()
    });
    
    const appProfile2 = deriveAppProfile({
      appProfile: "other-app",
      now: new Date().toISOString()
    });
    
    const paths1 = buildAppAutomationPaths(appProfile1, "C38230", ".", "api-tests");
    const paths2 = buildAppAutomationPaths(appProfile2, "C38230", ".", "api-tests");
    
    // Nothing should be the same
    expect(paths1.appDir).not.toBe(paths2.appDir);
    expect(paths1.casesDir).not.toBe(paths2.casesDir);
    expect(paths1.pagesDir).not.toBe(paths2.pagesDir);
  });
});

test.describe("TestRail Case Section Integration", () => {
  test("normalizer preserves section_id from raw case", () => {
    const { normalizeTestRailCase } = require("../src/testrail/testrail-normalizer");
    
    const rawCase = {
      id: 38257,
      title: "Consulta de balance",
      section_id: 789,
      custom_steps: "1. Ingresar al sistema\n2. Navegar a balance",
      custom_expected: "Se muestra el balance"
    };
    
    const scenario = normalizeTestRailCase(rawCase);
    
    expect(scenario.caseId).toBe(38257);
    expect(scenario.sectionId).toBe(789);
    expect(scenario.raw?.section_id).toBe(789);
  });

  test("scenario includes sectionId and sectionName after normalization", () => {
    const { normalizeTestRailCase } = require("../src/testrail/testrail-normalizer");
    
    const rawCase = {
      id: 38258,
      title: "Transferencia entre cuentas",
      section_id: 790,
      custom_steps: "1. Seleccionar cuenta origen\n2. Seleccionar cuenta destino",
      custom_expected: "Transferencia exitosa"
    };
    
    const scenario = normalizeTestRailCase(rawCase);
    
    expect(scenario.sectionId).toBe(790);
    expect(scenario.raw?.section_id).toBe(790);
  });
});
