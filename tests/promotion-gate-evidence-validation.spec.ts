import { test, expect } from "@playwright/test";
import { evaluatePromotionGate } from "../src/automations/promotion-gate";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { CaseDiscoveryResult } from "../src/types/discovery.types";
import type { ExecutionPlan } from "../src/types/execution-plan.types";

test.describe("Promotion Gate - Evidence Validation", () => {
  const testEvidenceDir = ".artifacts/tmp/test-evidence-gate";

  test.beforeEach(async () => {
    await mkdir(testEvidenceDir, { recursive: true });
  });

  test.afterEach(async () => {
    await rm(testEvidenceDir, { recursive: true, force: true });
  });

  test("blocks promotion when detail screenshot required but not captured", async () => {
    // Create evidence.json with detailEvidence: required=true, captured=false
    const evidenceRecord = {
      scenarioId: "test-scenario",
      status: "Fallido",
      detailEvidence: {
        required: true,
        captured: false,
        target: "Tarjeta Crédito Visa Clásica",
        reason: "detail_screenshot_not_captured"
      },
      steps: []
    };

    const evidenceJsonPath = join(testEvidenceDir, "evidence.json");
    await writeFile(evidenceJsonPath, JSON.stringify(evidenceRecord, null, 2), "utf-8");

    const discoveryResult: CaseDiscoveryResult = {
      version: "1.0",
      caseId: 39286,
      caseTitle: "Test case",
      discoveredAt: new Date().toISOString(),
      status: "discovered_passed",
      steps: [],
      discoveredObjects: [],
      candidatePlan: {
        version: "1.0",
        caseId: 39286,
        title: "Test plan",
        status: "validated",
        steps: [],
        requiredData: []
      } as ExecutionPlan,
      evidenceDir: testEvidenceDir
    };

    const result = evaluatePromotionGate({ discoveryResult });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("blocked");

    // Check that evidence gate reason is present
    const hasEvidenceGateReason = result.reasons.some(r =>
      r.includes("Evidence gate failed") &&
      r.includes("Detail screenshot was required but not captured")
    );
    expect(hasEvidenceGateReason).toBe(true);

    // Check target mentioned
    const hasTargetMention = result.reasons.some(r =>
      r.includes('Target="Tarjeta Crédito Visa Clásica"')
    );
    expect(hasTargetMention).toBe(true);
  });

  test("blocks promotion when detail did not actually open", async () => {
    // Create evidence.json with detailEvidence: required=true, captured=true, detailOpened=false
    const evidenceRecord = {
      scenarioId: "test-scenario",
      status: "Fallido",
      detailEvidence: {
        required: true,
        captured: true,
        screenshotPath: join(testEvidenceDir, "screenshots", "step-004-detail.png"),
        target: "Tarjeta Crédito Visa Clásica",
        detailOpened: false,
        detailHeading: false,
        detailSections: false,
        actionButtons: true,
        oracleReason: "insufficient_detail_signals"
      },
      steps: []
    };

    const evidenceJsonPath = join(testEvidenceDir, "evidence.json");
    await writeFile(evidenceJsonPath, JSON.stringify(evidenceRecord, null, 2), "utf-8");

    const discoveryResult: CaseDiscoveryResult = {
      version: "1.0",
      caseId: 39286,
      caseTitle: "Test case",
      discoveredAt: new Date().toISOString(),
      status: "discovered_passed",
      steps: [],
      discoveredObjects: [],
      candidatePlan: {
        version: "1.0",
        caseId: 39286,
        title: "Test plan",
        status: "validated",
        steps: [],
        requiredData: []
      } as ExecutionPlan,
      evidenceDir: testEvidenceDir
    };

    const result = evaluatePromotionGate({ discoveryResult });

    expect(result.allowed).toBe(false);
    expect(result.status).toBe("blocked");

    // Check that evidence gate reason is present
    const hasEvidenceGateReason = result.reasons.some(r =>
      r.includes("Evidence gate failed") &&
      r.includes("Detail screen did not open")
    );
    expect(hasEvidenceGateReason).toBe(true);

    // Check oracle signals mentioned
    const hasOracleSignals = result.reasons.some(r =>
      r.includes("detailHeading=false") &&
      r.includes("detailSections=false") &&
      r.includes("actionButtons=true")
    );
    expect(hasOracleSignals).toBe(true);
  });

  test("allows promotion when detail screenshot captured and validated", async () => {
    // Create evidence.json with detailEvidence: required=true, captured=true, detailOpened=true
    const evidenceRecord = {
      scenarioId: "test-scenario",
      status: "Exitoso",
      detailEvidence: {
        required: true,
        captured: true,
        screenshotPath: join(testEvidenceDir, "screenshots", "step-004-detail.png"),
        target: "Tarjeta Crédito Visa Clásica",
        detailOpened: true,
        detailHeading: true,
        detailSections: true,
        actionButtons: true,
        oracleReason: "detail_loaded"
      },
      steps: []
    };

    const evidenceJsonPath = join(testEvidenceDir, "evidence.json");
    await writeFile(evidenceJsonPath, JSON.stringify(evidenceRecord, null, 2), "utf-8");

    const discoveryResult: CaseDiscoveryResult = {
      version: "1.0",
      caseId: 39286,
      caseTitle: "Test case",
      discoveredAt: new Date().toISOString(),
      status: "discovered_passed",
      steps: [],
      discoveredObjects: [],
      candidatePlan: {
        version: "1.0",
        caseId: 39286,
        title: "Test plan",
        status: "validated",
        steps: [],
        requiredData: []
      } as ExecutionPlan,
      evidenceDir: testEvidenceDir
    };

    const result = evaluatePromotionGate({ discoveryResult });

    // Evidence gate should pass
    const hasEvidenceGateFailure = result.reasons.some(r =>
      r.includes("Evidence gate failed")
    );
    expect(hasEvidenceGateFailure).toBe(false);

    // May have other blocking reasons (plan validation), but evidence gate specifically passed
  });

  test("skips evidence gate check when no evidence.json exists", async () => {
    // Don't create evidence.json

    const discoveryResult: CaseDiscoveryResult = {
      version: "1.0",
      caseId: 39286,
      caseTitle: "Test case",
      discoveredAt: new Date().toISOString(),
      status: "discovered_passed",
      steps: [],
      discoveredObjects: [],
      candidatePlan: {
        version: "1.0",
        caseId: 39286,
        title: "Test plan",
        status: "validated",
        steps: [],
        requiredData: []
      } as ExecutionPlan,
      evidenceDir: testEvidenceDir
    };

    const result = evaluatePromotionGate({ discoveryResult });

    // Evidence gate should not block
    const hasEvidenceGateFailure = result.reasons.some(r =>
      r.includes("Evidence gate failed")
    );
    expect(hasEvidenceGateFailure).toBe(false);
  });

  test("skips evidence gate check when detailEvidence not required", async () => {
    // Create evidence.json without detailEvidence or with required=false
    const evidenceRecord = {
      scenarioId: "test-scenario",
      status: "Exitoso",
      steps: []
      // No detailEvidence
    };

    const evidenceJsonPath = join(testEvidenceDir, "evidence.json");
    await writeFile(evidenceJsonPath, JSON.stringify(evidenceRecord, null, 2), "utf-8");

    const discoveryResult: CaseDiscoveryResult = {
      version: "1.0",
      caseId: 39286,
      caseTitle: "Test case",
      discoveredAt: new Date().toISOString(),
      status: "discovered_passed",
      steps: [],
      discoveredObjects: [],
      candidatePlan: {
        version: "1.0",
        caseId: 39286,
        title: "Test plan",
        status: "validated",
        steps: [],
        requiredData: []
      } as ExecutionPlan,
      evidenceDir: testEvidenceDir
    };

    const result = evaluatePromotionGate({ discoveryResult });

    // Evidence gate should not block since detail evidence is not required
    const hasEvidenceGateFailure = result.reasons.some(r =>
      r.includes("Evidence gate failed")
    );
    expect(hasEvidenceGateFailure).toBe(false);
  });
});
