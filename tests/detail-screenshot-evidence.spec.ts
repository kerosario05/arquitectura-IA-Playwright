import { test, expect } from "@playwright/test";
import { EvidenceRecorder } from "../src/evidence/evidence-recorder";
import type { EvidenceScenarioContext, DetailEvidenceMetadata } from "../src/evidence/evidence-types";
import * as fs from "node:fs";
import * as path from "node:path";

test.describe("Detail Screenshot Evidence", () => {
  const baseContext: EvidenceScenarioContext = {
    appSlug: "test-app",
    sectionSlug: "test-section",
    sectionName: "Test Section",
    scenarioId: "test-scenario-001",
    scenarioTitle: "Test Detail Scenario",
    outputRoot: ".artifacts/evidence-test"
  };

  test.afterEach(async () => {
    // Cleanup test artifacts
    try {
      await fs.promises.rm(baseContext.outputRoot!, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("captureDetailScreenshot marks evidence as captured", async ({ page }) => {
    const recorder = new EvidenceRecorder(baseContext, { enabled: true });
    await recorder.start();

    // Navigate to a simple page for testing
    await page.goto("data:text/html,<html><body><h1>Product Detail</h1><p>Test product details</p></body></html>");

    const result = await recorder.captureDetailScreenshot(page, "Test Product", 5);

    expect(result.captured).toBe(true);
    expect(result.reason).toBe("detail_loaded");
    expect(result.screenshotPath).toBeDefined();

    // Verify screenshot file exists
    if (result.screenshotPath) {
      const exists = fs.existsSync(result.screenshotPath);
      expect(exists).toBe(true);
      console.log(`✓ Detail screenshot captured at ${result.screenshotPath}`);
    }

    const record = await recorder.finish();
    expect(record.detailEvidence).toBeDefined();
    expect(record.detailEvidence?.required).toBe(true);
    expect(record.detailEvidence?.captured).toBe(true);
    expect(record.detailEvidence?.target).toBe("Test Product");
    expect(record.detailEvidence?.reason).toBe("detail_loaded");
  });

  test("evidence.json contains detailEvidence metadata", async ({ page }) => {
    const recorder = new EvidenceRecorder(baseContext, { enabled: true });
    await recorder.start();

    await page.goto("data:text/html,<html><body><h1>Tarjeta Visa Gold</h1></body></html>");

    await recorder.captureDetailScreenshot(page, "Tarjeta Visa Gold", 3);
    await recorder.addStepRecord(1, "Clic en Iniciar", { status: "passed" });
    await recorder.addStepRecord(2, "Clic en Información de productos", { status: "passed" });
    await recorder.addStepRecord(3, "Clic en Tarjeta Visa Gold", { status: "passed" });

    const record = await recorder.finish();

    // Verify evidence.json was written
    const evidenceJsonPath = record.evidenceJsonPath;
    expect(evidenceJsonPath).toBeDefined();

    if (evidenceJsonPath) {
      const exists = fs.existsSync(evidenceJsonPath);
      expect(exists).toBe(true);

      const content = await fs.promises.readFile(evidenceJsonPath, "utf8");
      const parsed = JSON.parse(content);

      expect(parsed.detailEvidence).toBeDefined();
      expect(parsed.detailEvidence.required).toBe(true);
      expect(parsed.detailEvidence.captured).toBe(true);
      expect(parsed.detailEvidence.target).toBe("Tarjeta Visa Gold");
      expect(parsed.detailEvidence.capturedAfterStep).toBe(3);
      expect(parsed.detailEvidence.screenshotPath).toBeDefined();
      expect(parsed.detailEvidence.reason).toBe("detail_loaded");

      console.log(`✓ evidence.json contains complete detailEvidence metadata`);
    }
  });

  test("detail scenario without screenshot overrides status to Fallido", async ({ page }) => {
    const recorder = new EvidenceRecorder(baseContext, { enabled: true });
    await recorder.start();

    // Mark detail screenshot as required but don't capture it
    recorder.markDetailScreenshotRequired("Préstamo Personal");

    await recorder.addStepRecord(1, "Clic en Iniciar", { status: "passed" });
    await recorder.addStepRecord(2, "Clic en Préstamos", { status: "passed" });
    await recorder.addStepRecord(3, "Clic en Préstamo Personal", { status: "passed" });

    const record = await recorder.finish();

    // Status should be overridden to Fallido because detail screenshot is missing
    expect(record.status).toBe("Fallido");
    expect(record.detailEvidence?.required).toBe(true);
    expect(record.detailEvidence?.captured).toBe(false);

    // Last step should have error message
    const lastStep = record.steps[record.steps.length - 1];
    expect(lastStep.status).toBe("failed");
    expect(lastStep.errorMessage).toContain("Missing detail screenshot");

    console.log(`✓ Status overridden to Fallido when detail screenshot missing`);
  });

  test("scenario without detailEvidence maintains normal behavior", async ({ page }) => {
    const recorder = new EvidenceRecorder(baseContext, { enabled: true });
    await recorder.start();

    // Regular scenario without detail screenshot requirement
    await recorder.addStepRecord(1, "Clic en Iniciar", { status: "passed" });
    await recorder.addStepRecord(2, "Validar que se muestre Menú", { status: "passed" });

    const record = await recorder.finish();

    // Status should be Exitoso (all steps passed)
    expect(record.status).toBe("Exitoso");
    expect(record.detailEvidence).toBeUndefined();

    console.log(`✓ Scenarios without detailEvidence work normally`);
  });

  test("evidence gate logs correct diagnostics", async ({ page }) => {
    const recorder = new EvidenceRecorder(baseContext, { enabled: true });
    await recorder.start();

    recorder.markDetailScreenshotRequired("Cuenta en Euros");
    await recorder.addStepRecord(1, "Clic en Cuentas", { status: "passed" });

    // Capture console logs
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    await recorder.finish();

    console.log = originalLog;

    // Verify evidence-gate logs
    const evidenceGateLogs = logs.filter(l => l.includes("[evidence-gate]"));
    expect(evidenceGateLogs.length).toBeGreaterThan(0);

    // First log: basic check
    const firstGateLog = evidenceGateLogs[0];
    expect(firstGateLog).toContain("detailScreenshotRequired=true");
    expect(firstGateLog).toContain("found=false");

    // Second log should have full details including statusOverride
    if (evidenceGateLogs.length > 1) {
      const detailedGateLog = evidenceGateLogs[1];
      expect(detailedGateLog).toContain("statusOverride=failed");
      expect(detailedGateLog).toContain("reason=missing_detail_screenshot");
    }

    console.log(`✓ Evidence gate produces correct diagnostic logs`);
  });

  test("no hardcoded products or appSlug (generic implementation)", async ({ page }) => {
    // Test with different product and appSlug
    const customContext: EvidenceScenarioContext = {
      appSlug: "dynamic-app-123",
      sectionSlug: "custom-section",
      scenarioId: "custom-001",
      scenarioTitle: "Custom Product Detail",
      outputRoot: ".artifacts/evidence-test-custom"
    };

    const recorder = new EvidenceRecorder(customContext, { enabled: true });
    await recorder.start();

    await page.goto("data:text/html,<html><body><h1>Custom Product XYZ</h1></body></html>");

    const result = await recorder.captureDetailScreenshot(page, "Custom Product XYZ", 1);

    expect(result.captured).toBe(true);
    expect(result.screenshotPath).toBeDefined();

    const record = await recorder.finish();
    expect(record.appSlug).toBe("dynamic-app-123");
    expect(record.detailEvidence?.target).toBe("Custom Product XYZ");

    console.log(`✓ Implementation works with any product name and appSlug`);

    // Cleanup custom artifacts
    await fs.promises.rm(customContext.outputRoot!, { recursive: true, force: true });
  });
});
