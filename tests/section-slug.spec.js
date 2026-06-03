"use strict";
/**
 * SectionSlug Tests
 *
 * Tests for sectionSlug normalization and section-based spec organization.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const app_profile_1 = require("../src/automations/app-profile");
test_1.test.describe("SectionSlug Normalization", () => {
    (0, test_1.test)("normalizes section names with accents", () => {
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("API Tests")).toBe("api-tests");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("Arquitectura automatización")).toBe("arquitectura-automatizacion");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("REGRESIÓN-KIOSKO")).toBe("regresion-kiosko");
    });
    (0, test_1.test)("normalizes section names with spaces", () => {
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("API Tests")).toBe("api-tests");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("Regression Tests")).toBe("regression-tests");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("Smoke Test Suite")).toBe("smoke-test-suite");
    });
    (0, test_1.test)("normalizes section names with uppercase", () => {
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("REGRESION-KIOSKO")).toBe("regresion-kiosko");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("Kiosko")).toBe("kiosko");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("API")).toBe("api");
    });
    (0, test_1.test)("blocks path traversal", () => {
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("../etc")).toBe("etc");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("foo/../../bar")).toBe("foo-bar");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("..\\..\\etc")).toBe("etc");
    });
    (0, test_1.test)("blocks slash characters", () => {
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("foo/bar")).toBe("foo-bar");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("foo\\bar")).toBe("foo-bar");
    });
    (0, test_1.test)("limits to [a-z0-9-]", () => {
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("API_Tests!@#")).toBe("api-tests");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("Test-123")).toBe("test-123");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("Special $%^")).toBe("special");
    });
    (0, test_1.test)("returns default-section for empty input", () => {
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("")).toBe("default-section");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)(undefined)).toBe("default-section");
        (0, test_1.expect)((0, app_profile_1.normalizeSectionSlug)("   ")).toBe("default-section");
    });
});
test_1.test.describe("SectionProfile Resolution", () => {
    (0, test_1.test)("resolves from CLI sectionSlug", async () => {
        const result = await (0, app_profile_1.resolveSectionProfile)({
            cliSectionSlug: "api-tests"
        });
        (0, test_1.expect)(result.sectionProfile.sectionSlug).toBe("api-tests");
        (0, test_1.expect)(result.sectionProfile.source).toBe("cli");
    });
    (0, test_1.test)("resolves from test case sectionId and sectionName", async () => {
        const result = await (0, app_profile_1.resolveSectionProfile)({
            testCaseSectionId: 123,
            testCaseSectionName: "API Tests"
        });
        (0, test_1.expect)(result.sectionProfile.sectionSlug).toBe("api-tests");
        (0, test_1.expect)(result.sectionProfile.source).toBe("testrail_case");
        (0, test_1.expect)(result.sectionProfile.sectionId).toBe(123);
        (0, test_1.expect)(result.sectionProfile.sectionName).toBe("API Tests");
    });
    (0, test_1.test)("resolves from env sectionId", async () => {
        const result = await (0, app_profile_1.resolveSectionProfile)({
            envSectionId: 456
        });
        (0, test_1.expect)(result.sectionProfile.sectionSlug).toBe("section-456");
        (0, test_1.expect)(result.sectionProfile.source).toBe("env");
        (0, test_1.expect)(result.sectionProfile.sectionId).toBe(456);
    });
    (0, test_1.test)("falls back to default-section", async () => {
        const result = await (0, app_profile_1.resolveSectionProfile)({});
        (0, test_1.expect)(result.sectionProfile.sectionSlug).toBe("default-section");
        (0, test_1.expect)(result.sectionProfile.source).toBe("default");
    });
});
test_1.test.describe("App Automation Paths with Section", () => {
    (0, test_1.test)("builds paths with sectionSlug", () => {
        const appProfile = (0, app_profile_1.deriveAppProfile)({
            appProfile: "arquitectura-automatizacion",
            now: new Date().toISOString()
        });
        const paths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, "C38230", ".", "api-tests");
        (0, test_1.expect)(paths.casesDir.replace(/\\/g, "/")).toContain("sections/api-tests/cases");
        (0, test_1.expect)(paths.specsDir.replace(/\\/g, "/")).toContain("sections/api-tests/specs");
        (0, test_1.expect)(paths.evidenceDir.replace(/\\/g, "/")).toContain("sections/api-tests/evidence");
        (0, test_1.expect)(paths.runsDir.replace(/\\/g, "/")).toContain("sections/api-tests/runs");
        (0, test_1.expect)(paths.caseDir?.replace(/\\/g, "/")).toContain("sections/api-tests/cases/C38230");
        (0, test_1.expect)(paths.specPath?.replace(/\\/g, "/")).toContain("sections/api-tests/cases/C38230/case.spec.ts");
        // Pages, flows, components should still be at app level
        (0, test_1.expect)(paths.pagesDir).not.toContain("sections");
        (0, test_1.expect)(paths.flowsDir).not.toContain("sections");
        (0, test_1.expect)(paths.componentsDir).not.toContain("sections");
    });
    (0, test_1.test)("builds paths without sectionSlug (backward compatibility)", () => {
        const appProfile = (0, app_profile_1.deriveAppProfile)({
            appProfile: "arquitectura-automatizacion",
            now: new Date().toISOString()
        });
        const paths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, "C38230", ".", undefined);
        (0, test_1.expect)(paths.casesDir.replace(/\\/g, "/")).toContain("cases");
        (0, test_1.expect)(paths.casesDir).not.toContain("sections");
        (0, test_1.expect)(paths.specsDir.replace(/\\/g, "/")).toContain("specs");
        (0, test_1.expect)(paths.specsDir).not.toContain("sections");
    });
    (0, test_1.test)("builds paths with default-section uses root folders", () => {
        const appProfile = (0, app_profile_1.deriveAppProfile)({
            appProfile: "arquitectura-automatizacion",
            now: new Date().toISOString()
        });
        const paths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, "C38230", ".", "default-section");
        (0, test_1.expect)(paths.casesDir.replace(/\\/g, "/")).toContain("cases");
        (0, test_1.expect)(paths.casesDir).not.toContain("sections");
    });
    (0, test_1.test)("two sections of same appSlug share POM paths", () => {
        const appProfile = (0, app_profile_1.deriveAppProfile)({
            appProfile: "arquitectura-automatizacion",
            now: new Date().toISOString()
        });
        const pathsApi = (0, app_profile_1.buildAppAutomationPaths)(appProfile, "C38230", ".", "api-tests");
        const pathsRegression = (0, app_profile_1.buildAppAutomationPaths)(appProfile, "C38231", ".", "regression-kiosko");
        // Pages, flows, components should be the same
        (0, test_1.expect)(pathsApi.pagesDir).toBe(pathsRegression.pagesDir);
        (0, test_1.expect)(pathsApi.flowsDir).toBe(pathsRegression.flowsDir);
        (0, test_1.expect)(pathsApi.componentsDir).toBe(pathsRegression.componentsDir);
        // Cases, specs, evidence should be different
        (0, test_1.expect)(pathsApi.casesDir).not.toBe(pathsRegression.casesDir);
        (0, test_1.expect)(pathsApi.specsDir).not.toBe(pathsRegression.specsDir);
    });
    (0, test_1.test)("two appSlug do not mix paths", () => {
        const appProfile1 = (0, app_profile_1.deriveAppProfile)({
            appProfile: "arquitectura-automatizacion",
            now: new Date().toISOString()
        });
        const appProfile2 = (0, app_profile_1.deriveAppProfile)({
            appProfile: "other-app",
            now: new Date().toISOString()
        });
        const paths1 = (0, app_profile_1.buildAppAutomationPaths)(appProfile1, "C38230", ".", "api-tests");
        const paths2 = (0, app_profile_1.buildAppAutomationPaths)(appProfile2, "C38230", ".", "api-tests");
        // Nothing should be the same
        (0, test_1.expect)(paths1.appDir).not.toBe(paths2.appDir);
        (0, test_1.expect)(paths1.casesDir).not.toBe(paths2.casesDir);
        (0, test_1.expect)(paths1.pagesDir).not.toBe(paths2.pagesDir);
    });
});
test_1.test.describe("TestRail Case Section Integration", () => {
    (0, test_1.test)("normalizer preserves section_id from raw case", () => {
        const { normalizeTestRailCase } = require("../src/testrail/testrail-normalizer");
        const rawCase = {
            id: 38257,
            title: "Consulta de balance",
            section_id: 789,
            custom_steps: "1. Ingresar al sistema\n2. Navegar a balance",
            custom_expected: "Se muestra el balance"
        };
        const scenario = normalizeTestRailCase(rawCase);
        (0, test_1.expect)(scenario.caseId).toBe(38257);
        (0, test_1.expect)(scenario.sectionId).toBe(789);
        (0, test_1.expect)(scenario.raw?.section_id).toBe(789);
    });
    (0, test_1.test)("scenario includes sectionId and sectionName after normalization", () => {
        const { normalizeTestRailCase } = require("../src/testrail/testrail-normalizer");
        const rawCase = {
            id: 38258,
            title: "Transferencia entre cuentas",
            section_id: 790,
            custom_steps: "1. Seleccionar cuenta origen\n2. Seleccionar cuenta destino",
            custom_expected: "Transferencia exitosa"
        };
        const scenario = normalizeTestRailCase(rawCase);
        (0, test_1.expect)(scenario.sectionId).toBe(790);
        (0, test_1.expect)(scenario.raw?.section_id).toBe(790);
    });
});
