import { test, expect } from "@playwright/test";
import { buildEvidenceScenarioDir, buildEvidencePaths, buildScreenshotFilename } from "../src/evidence/evidence-paths";
import { loadEvidenceConfig, deriveScenarioStatus, mapStatusToSpanish } from "../src/evidence/evidence-types";

test.describe("evidence-paths", () => {
  const ctx = {
    appSlug: "arquitectura-automatizacion",
    sectionSlug: "detalle-kiosko",
    scenarioId: "PREVIEW-005",
    scenarioTitle: "Test",
  };

  test("builds correct scenario directory", () => {
    const dir = buildEvidenceScenarioDir(ctx as any);
    expect(dir).toContain("arquitectura-automatizacion");
    expect(dir).toContain("detalle-kiosko");
    expect(dir).toContain("PREVIEW-005");
  });

  test("blocks path traversal in appSlug", () => {
    expect(() =>
      buildEvidenceScenarioDir({ ...ctx, appSlug: "../malicious" } as any),
    ).toThrow();
  });

  test("blocks path traversal in sectionSlug", () => {
    expect(() =>
      buildEvidenceScenarioDir({ ...ctx, sectionSlug: "../evil" } as any),
    ).toThrow();
  });

  test("builds screenshots directory", () => {
    const paths = buildEvidencePaths(ctx as any);
    expect(paths.screenshotsDir).toContain("screenshots");
  });

  test("builds evidence.json path", () => {
    const paths = buildEvidencePaths(ctx as any);
    expect(paths.evidenceJsonPath).toContain("evidence.json");
  });

  test("builds docx path", () => {
    const paths = buildEvidencePaths(ctx as any);
    expect(paths.docxPath).toContain("evidencia.docx");
  });

  test("creates screenshot filename from step text", () => {
    const filename = buildScreenshotFilename(1, "Clic en Iniciar");
    expect(filename).toMatch(/^step-001-/);
    expect(filename).toContain("iniciar");
    expect(filename).toMatch(/\.png$/);
  });

  test("screenshot filename handles long text", () => {
    const long = "Clic en Información de productos bancarios y financieros".repeat(3);
    const filename = buildScreenshotFilename(2, long);
    expect(filename.length).toBeLessThan(100);
  });
});

test.describe("evidence-types", () => {
  test("loadEvidenceConfig reads defaults", () => {
    const cfg = loadEvidenceConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.docxEnabled).toBe(true);
    expect(cfg.templatePath).toContain("execution-evidence-template.docx");
  });

  test("loadEvidenceConfig respects env vars", () => {
    const cfg = loadEvidenceConfig({ EVIDENCE_ENABLED: "false", EVIDENCE_DOCX_ENABLED: "false" });
    expect(cfg.enabled).toBe(false);
    expect(cfg.docxEnabled).toBe(false);
  });

  test("deriveScenarioStatus: all passed -> Exitoso", () => {
    expect(
      deriveScenarioStatus([
        { index: 1, stepText: "Step 1", status: "passed", timestamp: "" },
        { index: 2, stepText: "Step 2", status: "passed", timestamp: "" },
      ]),
    ).toBe("Exitoso");
  });

  test("deriveScenarioStatus: any failed -> Fallido", () => {
    expect(
      deriveScenarioStatus([
        { index: 1, stepText: "Step 1", status: "passed", timestamp: "" },
        { index: 2, stepText: "Step 2", status: "failed", timestamp: "" },
      ]),
    ).toBe("Fallido");
  });

  test("deriveScenarioStatus: empty -> No ejecutado", () => {
    expect(deriveScenarioStatus([])).toBe("No ejecutado");
  });

  test("mapStatusToSpanish: passed -> Exitoso", () => {
    expect(mapStatusToSpanish("passed")).toBe("Exitoso");
  });

  test("mapStatusToSpanish: failed -> Fallido", () => {
    expect(mapStatusToSpanish("failed")).toBe("Fallido");
  });
});
