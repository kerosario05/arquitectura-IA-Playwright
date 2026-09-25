"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promotion_gate_1 = require("../src/automations/promotion-gate");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
test_1.test.describe("Promotion Gate - Evidence Validation", () => {
    const testEvidenceDir = ".artifacts/tmp/test-evidence-gate";
    test_1.test.beforeEach(async () => {
        await (0, promises_1.mkdir)(testEvidenceDir, { recursive: true });
    });
    test_1.test.afterEach(async () => {
        await (0, promises_1.rm)(testEvidenceDir, { recursive: true, force: true });
    });
    (0, test_1.test)("blocks promotion when detail screenshot required but not captured", async () => {
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
        const evidenceJsonPath = (0, node_path_1.join)(testEvidenceDir, "evidence.json");
        await (0, promises_1.writeFile)(evidenceJsonPath, JSON.stringify(evidenceRecord, null, 2), "utf-8");
        const discoveryResult = {
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
            },
            evidenceDir: testEvidenceDir
        };
        const result = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult });
        (0, test_1.expect)(result.allowed).toBe(false);
        (0, test_1.expect)(result.status).toBe("blocked");
        // Check that evidence gate reason is present
        const hasEvidenceGateReason = result.reasons.some(r => r.includes("Evidence gate failed") &&
            r.includes("Detail screenshot was required but not captured"));
        (0, test_1.expect)(hasEvidenceGateReason).toBe(true);
        // Check target mentioned
        const hasTargetMention = result.reasons.some(r => r.includes('Target="Tarjeta Crédito Visa Clásica"'));
        (0, test_1.expect)(hasTargetMention).toBe(true);
    });
    (0, test_1.test)("blocks promotion when detail did not actually open", async () => {
        // Create evidence.json with detailEvidence: required=true, captured=true, detailOpened=false
        const evidenceRecord = {
            scenarioId: "test-scenario",
            status: "Fallido",
            detailEvidence: {
                required: true,
                captured: true,
                screenshotPath: (0, node_path_1.join)(testEvidenceDir, "screenshots", "step-004-detail.png"),
                target: "Tarjeta Crédito Visa Clásica",
                detailOpened: false,
                detailHeading: false,
                detailSections: false,
                actionButtons: true,
                oracleReason: "insufficient_detail_signals"
            },
            steps: []
        };
        const evidenceJsonPath = (0, node_path_1.join)(testEvidenceDir, "evidence.json");
        await (0, promises_1.writeFile)(evidenceJsonPath, JSON.stringify(evidenceRecord, null, 2), "utf-8");
        const discoveryResult = {
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
            },
            evidenceDir: testEvidenceDir
        };
        const result = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult });
        (0, test_1.expect)(result.allowed).toBe(false);
        (0, test_1.expect)(result.status).toBe("blocked");
        // Check that evidence gate reason is present
        const hasEvidenceGateReason = result.reasons.some(r => r.includes("Evidence gate failed") &&
            r.includes("Detail screen did not open"));
        (0, test_1.expect)(hasEvidenceGateReason).toBe(true);
        // Check oracle signals mentioned
        const hasOracleSignals = result.reasons.some(r => r.includes("detailHeading=false") &&
            r.includes("detailSections=false") &&
            r.includes("actionButtons=true"));
        (0, test_1.expect)(hasOracleSignals).toBe(true);
    });
    (0, test_1.test)("allows promotion when detail screenshot captured and validated", async () => {
        // Create evidence.json with detailEvidence: required=true, captured=true, detailOpened=true
        const evidenceRecord = {
            scenarioId: "test-scenario",
            status: "Exitoso",
            detailEvidence: {
                required: true,
                captured: true,
                screenshotPath: (0, node_path_1.join)(testEvidenceDir, "screenshots", "step-004-detail.png"),
                target: "Tarjeta Crédito Visa Clásica",
                detailOpened: true,
                detailHeading: true,
                detailSections: true,
                actionButtons: true,
                oracleReason: "detail_loaded"
            },
            steps: []
        };
        const evidenceJsonPath = (0, node_path_1.join)(testEvidenceDir, "evidence.json");
        await (0, promises_1.writeFile)(evidenceJsonPath, JSON.stringify(evidenceRecord, null, 2), "utf-8");
        const discoveryResult = {
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
            },
            evidenceDir: testEvidenceDir
        };
        const result = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult });
        // Evidence gate should pass
        const hasEvidenceGateFailure = result.reasons.some(r => r.includes("Evidence gate failed"));
        (0, test_1.expect)(hasEvidenceGateFailure).toBe(false);
        // May have other blocking reasons (plan validation), but evidence gate specifically passed
    });
    (0, test_1.test)("skips evidence gate check when no evidence.json exists", async () => {
        // Don't create evidence.json
        const discoveryResult = {
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
            },
            evidenceDir: testEvidenceDir
        };
        const result = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult });
        // Evidence gate should not block
        const hasEvidenceGateFailure = result.reasons.some(r => r.includes("Evidence gate failed"));
        (0, test_1.expect)(hasEvidenceGateFailure).toBe(false);
    });
    (0, test_1.test)("skips evidence gate check when detailEvidence not required", async () => {
        // Create evidence.json without detailEvidence or with required=false
        const evidenceRecord = {
            scenarioId: "test-scenario",
            status: "Exitoso",
            steps: []
            // No detailEvidence
        };
        const evidenceJsonPath = (0, node_path_1.join)(testEvidenceDir, "evidence.json");
        await (0, promises_1.writeFile)(evidenceJsonPath, JSON.stringify(evidenceRecord, null, 2), "utf-8");
        const discoveryResult = {
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
            },
            evidenceDir: testEvidenceDir
        };
        const result = (0, promotion_gate_1.evaluatePromotionGate)({ discoveryResult });
        // Evidence gate should not block since detail evidence is not required
        const hasEvidenceGateFailure = result.reasons.some(r => r.includes("Evidence gate failed"));
        (0, test_1.expect)(hasEvidenceGateFailure).toBe(false);
    });
});
