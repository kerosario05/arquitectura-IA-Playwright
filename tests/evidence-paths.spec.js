"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const evidence_paths_1 = require("../src/evidence/evidence-paths");
const evidence_types_1 = require("../src/evidence/evidence-types");
test_1.test.describe("evidence-paths", () => {
    const ctx = {
        appSlug: "arquitectura-automatizacion",
        sectionSlug: "detalle-kiosko",
        scenarioId: "PREVIEW-005",
        scenarioTitle: "Test",
    };
    (0, test_1.test)("builds correct scenario directory", () => {
        const dir = (0, evidence_paths_1.buildEvidenceScenarioDir)(ctx);
        (0, test_1.expect)(dir).toContain("arquitectura-automatizacion");
        (0, test_1.expect)(dir).toContain("detalle-kiosko");
        (0, test_1.expect)(dir).toContain("PREVIEW-005");
    });
    (0, test_1.test)("blocks path traversal in appSlug", () => {
        (0, test_1.expect)(() => (0, evidence_paths_1.buildEvidenceScenarioDir)({ ...ctx, appSlug: "../malicious" })).toThrow();
    });
    (0, test_1.test)("blocks path traversal in sectionSlug", () => {
        (0, test_1.expect)(() => (0, evidence_paths_1.buildEvidenceScenarioDir)({ ...ctx, sectionSlug: "../evil" })).toThrow();
    });
    (0, test_1.test)("builds screenshots directory", () => {
        const paths = (0, evidence_paths_1.buildEvidencePaths)(ctx);
        (0, test_1.expect)(paths.screenshotsDir).toContain("screenshots");
    });
    (0, test_1.test)("builds evidence.json path", () => {
        const paths = (0, evidence_paths_1.buildEvidencePaths)(ctx);
        (0, test_1.expect)(paths.evidenceJsonPath).toContain("evidence.json");
    });
    (0, test_1.test)("builds docx path", () => {
        const paths = (0, evidence_paths_1.buildEvidencePaths)(ctx);
        (0, test_1.expect)(paths.docxPath).toContain("evidencia.docx");
    });
    (0, test_1.test)("creates screenshot filename from step text", () => {
        const filename = (0, evidence_paths_1.buildScreenshotFilename)(1, "Clic en Iniciar");
        (0, test_1.expect)(filename).toMatch(/^step-001-/);
        (0, test_1.expect)(filename).toContain("iniciar");
        (0, test_1.expect)(filename).toMatch(/\.png$/);
    });
    (0, test_1.test)("screenshot filename handles long text", () => {
        const long = "Clic en Información de productos bancarios y financieros".repeat(3);
        const filename = (0, evidence_paths_1.buildScreenshotFilename)(2, long);
        (0, test_1.expect)(filename.length).toBeLessThan(100);
    });
});
test_1.test.describe("evidence-types", () => {
    (0, test_1.test)("loadEvidenceConfig reads defaults", () => {
        const cfg = (0, evidence_types_1.loadEvidenceConfig)({});
        (0, test_1.expect)(cfg.enabled).toBe(true);
        (0, test_1.expect)(cfg.docxEnabled).toBe(true);
        (0, test_1.expect)(cfg.templatePath).toContain("execution-evidence-template.docx");
    });
    (0, test_1.test)("loadEvidenceConfig respects env vars", () => {
        const cfg = (0, evidence_types_1.loadEvidenceConfig)({ EVIDENCE_ENABLED: "false", EVIDENCE_DOCX_ENABLED: "false" });
        (0, test_1.expect)(cfg.enabled).toBe(false);
        (0, test_1.expect)(cfg.docxEnabled).toBe(false);
    });
    (0, test_1.test)("deriveScenarioStatus: all passed -> Exitoso", () => {
        (0, test_1.expect)((0, evidence_types_1.deriveScenarioStatus)([
            { index: 1, stepText: "Step 1", status: "passed", timestamp: "" },
            { index: 2, stepText: "Step 2", status: "passed", timestamp: "" },
        ])).toBe("Exitoso");
    });
    (0, test_1.test)("deriveScenarioStatus: any failed -> Fallido", () => {
        (0, test_1.expect)((0, evidence_types_1.deriveScenarioStatus)([
            { index: 1, stepText: "Step 1", status: "passed", timestamp: "" },
            { index: 2, stepText: "Step 2", status: "failed", timestamp: "" },
        ])).toBe("Fallido");
    });
    (0, test_1.test)("deriveScenarioStatus: empty -> No ejecutado", () => {
        (0, test_1.expect)((0, evidence_types_1.deriveScenarioStatus)([])).toBe("No ejecutado");
    });
    (0, test_1.test)("mapStatusToSpanish: passed -> Exitoso", () => {
        (0, test_1.expect)((0, evidence_types_1.mapStatusToSpanish)("passed")).toBe("Exitoso");
    });
    (0, test_1.test)("mapStatusToSpanish: failed -> Fallido", () => {
        (0, test_1.expect)((0, evidence_types_1.mapStatusToSpanish)("failed")).toBe("Fallido");
    });
});
