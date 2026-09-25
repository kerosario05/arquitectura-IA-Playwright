"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDiscoveryEvidence = initDiscoveryEvidence;
exports.captureDiscoveryStep = captureDiscoveryStep;
exports.finalizeDiscoveryEvidence = finalizeDiscoveryEvidence;
const evidence_recorder_1 = require("./evidence-recorder");
const evidence_types_1 = require("./evidence-types");
/**
 * Initialize an EvidenceRecorder for a discovery case.
 * Call before runCaseDiscovery, then call finalizeDiscoveryEvidence() after.
 */
function initDiscoveryEvidence(page, options) {
    const cfg = (0, evidence_types_1.loadEvidenceConfig)();
    if (!cfg.enabled) {
        console.log(`[evidence:scenario] disabled scenarioId=${options.scenarioId}`);
        return null;
    }
    const recorder = new evidence_recorder_1.EvidenceRecorder({
        appSlug: options.appSlug,
        sectionSlug: options.sectionSlug || "default-section",
        sectionName: options.sectionName,
        scenarioId: options.scenarioId,
        scenarioTitle: options.scenarioTitle,
        caseId: options.caseId,
        runId: options.runId,
        analystName: cfg.analystName || process.env.EVIDENCE_ANALYST_NAME,
    }, cfg);
    // Start asynchronously but don't await — discovery needs to begin immediately
    recorder.start().catch((err) => {
        console.log(`[evidence:scenario] start failed: ${err.message}`);
        if (cfg.failOnError)
            throw err;
    });
    return recorder;
}
/**
 * Capture evidence for a discovery step.
 */
async function captureDiscoveryStep(recorder, page, stepIndex, stepText, status, errorMessage) {
    if (!recorder)
        return;
    try {
        const target = stepText.match(/"([^"]+)"/)?.[1];
        await recorder.captureStep(page, stepIndex, stepText, { target, status, errorMessage });
    }
    catch (err) {
        console.log(`[evidence:scenario] step capture failed: ${err.message}`);
    }
}
/**
 * Finalize discovery evidence.
 * Must be called in a finally block.
 * If recorder has no steps yet, populates from discoveryResult.
 */
async function finalizeDiscoveryEvidence(recorder, discoveryResult, page, evidenceKind, isDetailEvidence, lastActionTarget) {
    if (!recorder)
        return;
    try {
        // Set evidence classification if provided
        if (evidenceKind) {
            recorder.setEvidenceClassification(evidenceKind, isDetailEvidence ?? false, lastActionTarget);
        }
        // If no steps were captured live, populate from discovery result
        if (recorder.stepCount === 0 && discoveryResult?.steps && discoveryResult.steps.length > 0) {
            console.log(`[evidence:scenario] populating ${discoveryResult.steps.length} steps from discovery result`);
            for (const step of discoveryResult.steps) {
                // Map discovery step status to evidence status
                let evidenceStatus = "passed";
                if (step.status === "not_found" || step.status.includes("failed") || step.error) {
                    evidenceStatus = "failed";
                }
                else if (step.status === "skipped" || step.status.includes("skipped") || step.status === "satisfied_by_previous_assertion") {
                    evidenceStatus = "skipped";
                }
                else if (step.status === "found") {
                    evidenceStatus = "passed";
                }
                // Build step text from action and target
                const stepText = step.targetText
                    ? `${step.action} "${step.targetText}"`
                    : step.action;
                // Separate screenshot and snapshot paths
                const isImagePath = step.evidencePath && isImageFile(step.evidencePath);
                const screenshotPath = isImagePath ? step.evidencePath : undefined;
                const snapshotPath = step.evidencePath && !isImagePath ? step.evidencePath : undefined;
                recorder.addStepRecord(step.index, stepText, {
                    target: step.targetText,
                    status: evidenceStatus,
                    errorMessage: step.error,
                    screenshotPath,
                    snapshotPath,
                });
            }
        }
        if (discoveryResult) {
            const discoveryStatus = discoveryResult.status;
            recorder.setExecutionStatuses({
                discoveryStatus,
                functionalStatus: discoveryStatus === "exploration_failed"
                    ? "not_run"
                    : discoveryStatus === "discovered_passed" || discoveryStatus === "repaired_passed"
                        ? "passed"
                        : "failed",
            });
        }
        const record = await recorder.finish(page);
        console.log(`[evidence-status] captureStatus=${record.captureStatus ?? "unknown"} ` +
            `discoveryStatus=${record.discoveryStatus ?? "unknown"} ` +
            `functionalStatus=${record.functionalStatus ?? "unknown"} ` +
            `statusContradiction=${record.statusContradiction ?? false}`);
        const stepCount = record.steps.length;
        const screenshotCount = record.steps.filter((s) => {
            if (!s.screenshotPath)
                return false;
            return isImageFile(s.screenshotPath);
        }).length;
        const snapshotCount = record.steps.filter((s) => s.snapshotPath).length;
        // Update discovery result status to match evidence status if evidence gate failed
        if (discoveryResult && record.status === "Fallido") {
            const originalDiscoveryStatus = discoveryResult.status;
            if (originalDiscoveryStatus === "discovered_passed" || originalDiscoveryStatus === "repaired_passed") {
                discoveryResult.status = "exploration_failed";
                console.log(`[status-reconcile] evidenceGateFailed=true ` +
                    `originalStatus=${originalDiscoveryStatus} ` +
                    `updatedStatus=${discoveryResult.status} ` +
                    `reason=detail_evidence_requirement_not_met`);
                // Also update candidate plan status to reflect failure
                if (discoveryResult.candidatePlan && discoveryResult.candidatePlan.status === "validated") {
                    const originalPlanStatus = discoveryResult.candidatePlan.status;
                    discoveryResult.candidatePlan.status = "invalid";
                    console.log(`[status-reconcile] candidatePlanStatus updated ` +
                        `originalStatus=${originalPlanStatus} ` +
                        `updatedStatus=${discoveryResult.candidatePlan.status} ` +
                        `reason=evidence_gate_failed`);
                }
            }
        }
        // Propagate evidence paths to discovery result
        if (discoveryResult && record.evidenceJsonPath) {
            discoveryResult.evidenceJsonPath = record.evidenceJsonPath;
        }
        if (discoveryResult && record.docxPath) {
            discoveryResult.evidenceDocxPath = record.docxPath;
        }
    }
    catch (err) {
        console.log(`[evidence:scenario] finalize failed: ${err.message}`);
    }
}
function isImageFile(filepath) {
    const ext = require("node:path").extname(filepath).toLowerCase();
    return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
}
