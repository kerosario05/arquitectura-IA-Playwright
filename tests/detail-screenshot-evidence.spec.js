"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const evidence_recorder_1 = require("../src/evidence/evidence-recorder");
const fs = __importStar(require("node:fs"));
test_1.test.describe("Detail Screenshot Evidence", () => {
    const baseContext = {
        appSlug: "test-app",
        sectionSlug: "test-section",
        sectionName: "Test Section",
        scenarioId: "test-scenario-001",
        scenarioTitle: "Test Detail Scenario",
        outputRoot: ".artifacts/evidence-test"
    };
    test_1.test.afterEach(async () => {
        // Cleanup test artifacts
        try {
            await fs.promises.rm(baseContext.outputRoot, { recursive: true, force: true });
        }
        catch {
            // Ignore cleanup errors
        }
    });
    (0, test_1.test)("captureDetailScreenshot marks evidence as captured", async ({ page }) => {
        const recorder = new evidence_recorder_1.EvidenceRecorder(baseContext, { enabled: true });
        await recorder.start();
        // Navigate to a simple page for testing
        await page.goto("data:text/html,<html><body><h1>Product Detail</h1><p>Test product details</p></body></html>");
        const result = await recorder.captureDetailScreenshot(page, "Test Product", 5);
        (0, test_1.expect)(result.captured).toBe(true);
        (0, test_1.expect)(result.reason).toBe("detail_loaded");
        (0, test_1.expect)(result.screenshotPath).toBeDefined();
        // Verify screenshot file exists
        if (result.screenshotPath) {
            const exists = fs.existsSync(result.screenshotPath);
            (0, test_1.expect)(exists).toBe(true);
            console.log(`✓ Detail screenshot captured at ${result.screenshotPath}`);
        }
        const record = await recorder.finish();
        (0, test_1.expect)(record.detailEvidence).toBeDefined();
        (0, test_1.expect)(record.detailEvidence?.required).toBe(true);
        (0, test_1.expect)(record.detailEvidence?.captured).toBe(true);
        (0, test_1.expect)(record.detailEvidence?.target).toBe("Test Product");
        (0, test_1.expect)(record.detailEvidence?.reason).toBe("detail_loaded");
    });
    (0, test_1.test)("evidence.json contains detailEvidence metadata", async ({ page }) => {
        const recorder = new evidence_recorder_1.EvidenceRecorder(baseContext, { enabled: true });
        await recorder.start();
        await page.goto("data:text/html,<html><body><h1>Tarjeta Visa Gold</h1></body></html>");
        await recorder.captureDetailScreenshot(page, "Tarjeta Visa Gold", 3);
        await recorder.addStepRecord(1, "Clic en Iniciar", { status: "passed" });
        await recorder.addStepRecord(2, "Clic en Información de productos", { status: "passed" });
        await recorder.addStepRecord(3, "Clic en Tarjeta Visa Gold", { status: "passed" });
        const record = await recorder.finish();
        // Verify evidence.json was written
        const evidenceJsonPath = record.evidenceJsonPath;
        (0, test_1.expect)(evidenceJsonPath).toBeDefined();
        if (evidenceJsonPath) {
            const exists = fs.existsSync(evidenceJsonPath);
            (0, test_1.expect)(exists).toBe(true);
            const content = await fs.promises.readFile(evidenceJsonPath, "utf8");
            const parsed = JSON.parse(content);
            (0, test_1.expect)(parsed.detailEvidence).toBeDefined();
            (0, test_1.expect)(parsed.detailEvidence.required).toBe(true);
            (0, test_1.expect)(parsed.detailEvidence.captured).toBe(true);
            (0, test_1.expect)(parsed.detailEvidence.target).toBe("Tarjeta Visa Gold");
            (0, test_1.expect)(parsed.detailEvidence.capturedAfterStep).toBe(3);
            (0, test_1.expect)(parsed.detailEvidence.screenshotPath).toBeDefined();
            (0, test_1.expect)(parsed.detailEvidence.reason).toBe("detail_loaded");
            console.log(`✓ evidence.json contains complete detailEvidence metadata`);
        }
    });
    (0, test_1.test)("detail scenario without screenshot overrides status to Fallido", async ({ page }) => {
        const recorder = new evidence_recorder_1.EvidenceRecorder(baseContext, { enabled: true });
        await recorder.start();
        // Mark detail screenshot as required but don't capture it
        recorder.markDetailScreenshotRequired("Préstamo Personal");
        await recorder.addStepRecord(1, "Clic en Iniciar", { status: "passed" });
        await recorder.addStepRecord(2, "Clic en Préstamos", { status: "passed" });
        await recorder.addStepRecord(3, "Clic en Préstamo Personal", { status: "passed" });
        const record = await recorder.finish();
        // Status should be overridden to Fallido because detail screenshot is missing
        (0, test_1.expect)(record.status).toBe("Fallido");
        (0, test_1.expect)(record.detailEvidence?.required).toBe(true);
        (0, test_1.expect)(record.detailEvidence?.captured).toBe(false);
        // Last step should have error message
        const lastStep = record.steps[record.steps.length - 1];
        (0, test_1.expect)(lastStep.status).toBe("failed");
        (0, test_1.expect)(lastStep.errorMessage).toContain("Missing detail screenshot");
        console.log(`✓ Status overridden to Fallido when detail screenshot missing`);
    });
    (0, test_1.test)("scenario without detailEvidence maintains normal behavior", async ({ page }) => {
        const recorder = new evidence_recorder_1.EvidenceRecorder(baseContext, { enabled: true });
        await recorder.start();
        // Regular scenario without detail screenshot requirement
        await recorder.addStepRecord(1, "Clic en Iniciar", { status: "passed" });
        await recorder.addStepRecord(2, "Validar que se muestre Menú", { status: "passed" });
        const record = await recorder.finish();
        // Status should be Exitoso (all steps passed)
        (0, test_1.expect)(record.status).toBe("Exitoso");
        (0, test_1.expect)(record.detailEvidence).toBeUndefined();
        console.log(`✓ Scenarios without detailEvidence work normally`);
    });
    (0, test_1.test)("evidence gate logs correct diagnostics", async ({ page }) => {
        const recorder = new evidence_recorder_1.EvidenceRecorder(baseContext, { enabled: true });
        await recorder.start();
        recorder.markDetailScreenshotRequired("Cuenta en Euros");
        await recorder.addStepRecord(1, "Clic en Cuentas", { status: "passed" });
        // Capture console logs
        const logs = [];
        const originalLog = console.log;
        console.log = (...args) => {
            logs.push(args.join(" "));
            originalLog(...args);
        };
        await recorder.finish();
        console.log = originalLog;
        // Verify evidence-gate logs
        const evidenceGateLogs = logs.filter(l => l.includes("[evidence-gate]"));
        (0, test_1.expect)(evidenceGateLogs.length).toBeGreaterThan(0);
        // First log: basic check
        const firstGateLog = evidenceGateLogs[0];
        (0, test_1.expect)(firstGateLog).toContain("detailScreenshotRequired=true");
        (0, test_1.expect)(firstGateLog).toContain("found=false");
        // Second log should have full details including statusOverride
        if (evidenceGateLogs.length > 1) {
            const detailedGateLog = evidenceGateLogs[1];
            (0, test_1.expect)(detailedGateLog).toContain("statusOverride=failed");
            (0, test_1.expect)(detailedGateLog).toContain("reason=missing_detail_screenshot");
        }
        console.log(`✓ Evidence gate produces correct diagnostic logs`);
    });
    (0, test_1.test)("no hardcoded products or appSlug (generic implementation)", async ({ page }) => {
        // Test with different product and appSlug
        const customContext = {
            appSlug: "dynamic-app-123",
            sectionSlug: "custom-section",
            scenarioId: "custom-001",
            scenarioTitle: "Custom Product Detail",
            outputRoot: ".artifacts/evidence-test-custom"
        };
        const recorder = new evidence_recorder_1.EvidenceRecorder(customContext, { enabled: true });
        await recorder.start();
        await page.goto("data:text/html,<html><body><h1>Custom Product XYZ</h1></body></html>");
        const result = await recorder.captureDetailScreenshot(page, "Custom Product XYZ", 1);
        (0, test_1.expect)(result.captured).toBe(true);
        (0, test_1.expect)(result.screenshotPath).toBeDefined();
        const record = await recorder.finish();
        (0, test_1.expect)(record.appSlug).toBe("dynamic-app-123");
        (0, test_1.expect)(record.detailEvidence?.target).toBe("Custom Product XYZ");
        console.log(`✓ Implementation works with any product name and appSlug`);
        // Cleanup custom artifacts
        await fs.promises.rm(customContext.outputRoot, { recursive: true, force: true });
    });
});
