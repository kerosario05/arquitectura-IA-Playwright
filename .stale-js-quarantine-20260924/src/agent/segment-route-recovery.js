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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSegmentedRouteRecovery = runSegmentedRouteRecovery;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const page_scanner_1 = require("../explorer/page-scanner");
const page_readiness_1 = require("../browser/page-readiness");
const route_recovery_pack_1 = require("./route-recovery-pack");
const codex_auto_repair_1 = require("./codex-auto-repair");
const data_context_1 = require("../data/data-context");
const handoff_builder_1 = require("./handoff-builder");
const handoff_writer_1 = require("./handoff-writer");
const execution_plan_executor_1 = require("../runner/execution-plan-executor");
async function captureSnapshot(page, evidenceDir, label) {
    await (0, page_readiness_1.waitForPageReady)(page, { networkIdleTimeoutMs: 5000, stabilizationMs: 500 });
    const snapshot = await (0, page_scanner_1.scanCurrentPage)(page);
    const snapshotPath = node_path_1.default.join(evidenceDir, `${label}-snapshot.json`);
    await (0, promises_1.mkdir)(node_path_1.default.dirname(snapshotPath), { recursive: true });
    await (0, promises_1.writeFile)(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
    return { snapshot, snapshotPath };
}
function buildSegmentRecord(input) {
    return {
        segmentIndex: input.segmentIndex,
        recoveryDecision: input.decision.recoveryDecision,
        candidateId: input.decision.recoveryDecision === "repaired_plan" ? input.decision.selectedCandidateId : undefined,
        candidateText: input.candidateText,
        semanticRelation: input.semanticRelation,
        score: input.score,
        action: input.decision.recoveryDecision === "repaired_plan" ? input.decision.action : undefined,
        snapshotPath: input.snapshotPath,
        executionStatus: input.executionStatus,
        error: input.error
    };
}
async function runSegmentedRouteRecovery(input) {
    const segments = [];
    const failedRoutePaths = [];
    let currentSnapshot = input.snapshot;
    let currentSnapshotPath = input.snapshotPath;
    let currentPlan = input.currentPlan;
    for (let segmentIndex = 0; segmentIndex < input.maxSegments; segmentIndex++) {
        if (segmentIndex > 0) {
            const segEvidenceDir = node_path_1.default.join(input.evidenceDir, `segment-${segmentIndex}`);
            const capture = await captureSnapshot(input.page, segEvidenceDir, `segment-${segmentIndex}-before`);
            currentSnapshot = capture.snapshot;
            currentSnapshotPath = capture.snapshotPath;
        }
        // --- Build route recovery pack for this segment ---
        const handoffDir = node_path_1.default.join(input.outputDir, `segment-${segmentIndex}`);
        await (0, promises_1.mkdir)(handoffDir, { recursive: true });
        const recoveryPack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
            failedReason: input.failedReason,
            failedTarget: input.failedTarget,
            failedAtStep: input.failedAtStep,
            currentPlan,
            snapshot: currentSnapshot,
            scenario: input.scenario,
            budget: input.agentCfg.planningBudget,
            failedRoutePaths
        });
        const routeRecoveryPackPath = node_path_1.default.join(handoffDir, "route-recovery-pack.json");
        await (0, promises_1.writeFile)(routeRecoveryPackPath, JSON.stringify(recoveryPack, null, 2), "utf-8");
        const stats = (0, route_recovery_pack_1.computeRouteRecoveryPackStats)(recoveryPack);
        if (input.showAgentLog) {
            console.log(`[segment-${segmentIndex}] Recovery pack stats: visibleCandidates=${stats.visibleCandidates}, pendingSteps=${stats.pendingSteps}`);
            for (const cand of recoveryPack.topVisibleCandidates.slice(0, 10)) {
                console.log(`  ${cand.id} "${cand.text ?? cand.type}" role=${cand.role ?? "unknown"} actionability=${cand.actionability ?? "unknown"} score=${cand.score} relation=${cand.semanticRelation ?? "none"}`);
            }
        }
        // --- Check if the pending target is now directly resolvable ---
        // Priority: exact_match > near_match > parent_category; require score >= 0.50 and non-empty text
        const directHit = recoveryPack.topVisibleCandidates
            .filter((c) => c.text && c.text.length > 1 && c.score >= 0.50 && c.actionability === "clickable" && !failedRoutePaths.includes(c.id))
            .sort((a, b) => {
            const rankA = a.semanticRelation === "exact_match" ? 0 : a.semanticRelation === "near_match" ? 1 : a.semanticRelation === "parent_category" ? 2 : 3;
            const rankB = b.semanticRelation === "exact_match" ? 0 : b.semanticRelation === "near_match" ? 1 : b.semanticRelation === "parent_category" ? 2 : 3;
            if (rankA !== rankB)
                return rankA - rankB;
            return b.score - a.score;
        })[0];
        if (directHit) {
            if (input.showAgentLog) {
                console.log(`[segment-${segmentIndex}] Direct hit: "${directHit.text ?? directHit.type}" (${directHit.id}) resolved via ${directHit.semanticRelation}`);
            }
            const directPlanStep = {
                index: 1,
                action: "click",
                target: directHit.role && directHit.text
                    ? { strategy: "role", role: directHit.role, name: directHit.text }
                    : { strategy: "text", value: directHit.text ?? directHit.id }
            };
            const directPlan = {
                version: "1.0",
                source: "discovery_generated",
                status: "validated",
                scenario: { source: "testrail", title: "Route recovery" },
                requiredData: [],
                steps: [directPlanStep],
                createdAt: new Date().toISOString()
            };
            const segEvidenceDir = node_path_1.default.join(input.evidenceDir, `segment-${segmentIndex}`);
            const retry = await (0, execution_plan_executor_1.executeExecutionPlan)({
                page: input.page,
                plan: directPlan,
                dataContext: (0, data_context_1.buildDataContext)(input.fullConfig),
                evidenceDir: segEvidenceDir,
                continueOnFailure: false,
                runtimeConfig: input.fullConfig,
                appBaseUrl: input.fullConfig.app.baseUrl
            });
            const executionStatus = retry.status === "passed" ? "passed" : "failed";
            const segmentSnapshot = await captureSnapshot(input.page, segEvidenceDir, `segment-${segmentIndex}-after`);
            segments.push(buildSegmentRecord({
                segmentIndex,
                decision: {
                    recoveryDecision: "repaired_plan",
                    selectedCandidateId: directHit.id,
                    action: "click",
                    confidence: directHit.score,
                    sensitive: false,
                    rationale: `Direct resolution: ${directHit.semanticRelation} match for target "${input.failedTarget}"`
                },
                snapshotPath: segmentSnapshot.snapshotPath,
                executionStatus,
                candidateText: directHit.text,
                semanticRelation: directHit.semanticRelation,
                score: directHit.score
            }));
            if (executionStatus === "passed") {
                return {
                    success: true,
                    status: "repaired_passed",
                    segments,
                    candidatePlan: directPlan,
                    finalSnapshot: segmentSnapshot.snapshot,
                    finalSnapshotPath: segmentSnapshot.snapshotPath
                };
            }
            failedRoutePaths.push(directHit.id);
            continue;
        }
        // --- Run auto-repair via Codex (or deterministic fallback) ---
        const dataContext = (0, data_context_1.buildDataContext)(input.fullConfig);
        const request = (0, handoff_builder_1.buildAgentHandoffRequest)({
            kind: "plan_repair",
            goal: `Route recovery segment ${segmentIndex}: ${input.failedReason} at "${input.failedTarget}"`,
            contextPackPath: undefined,
            scenario: input.scenario,
            currentPlan,
            snapshot: currentSnapshot,
            dataContext,
            selectedSkill: undefined
        });
        const { requestPath, instructionsPath, schemaPath, responsePath } = await (0, handoff_writer_1.writeAgentHandoffPackage)({
            request,
            outputDir: handoffDir
        });
        const stdoutLogPath = node_path_1.default.join(handoffDir, "codex.stdout.log");
        const stderrLogPath = node_path_1.default.join(handoffDir, "codex.stderr.log");
        const cfg = {
            ...input.agentCfg,
            promptMode: (input.compactPrompt ? "compact-route-recovery" : input.agentCfg.promptMode),
            compactPrompt: input.compactPrompt || input.agentCfg.compactPrompt
        };
        const repair = await (0, codex_auto_repair_1.runCodexAutoRepair)({
            handoffDir,
            requestPath,
            instructionsPath,
            responsePath,
            schemaPath,
            contextPackPath: undefined,
            projectRoot: process.cwd(),
            timeoutMs: cfg.timeoutMs,
            codexCommand: cfg.command,
            codexExtraArgs: cfg.extraArgs,
            promptMode: cfg.promptMode,
            showAgentLog: input.showAgentLog ?? false,
            stdoutLogPath,
            stderrLogPath,
            attempt: segmentIndex + 1,
            compactPrompt: cfg.compactPrompt,
            promptBudgetSeconds: cfg.promptBudgetSeconds,
            maxCandidates: cfg.maxCandidates,
            maxProposedActions: cfg.maxProposedActions,
            maxAttemptsOverride: cfg.maxAttempts,
            routeRecoveryPackPath,
            planningBudget: cfg.planningBudget
        });
        await (0, promises_1.writeFile)(node_path_1.default.join(handoffDir, "auto-repair-result.json"), JSON.stringify({ ...repair.diagnostics, timestamp: new Date().toISOString(), segmentIndex }, null, 2), "utf-8");
        if (!repair.success || !repair.diagnostics) {
            const reason = repair.error ?? "Segment auto-repair failed.";
            const segSnapshot = await captureSnapshot(input.page, handoffDir, `segment-${segmentIndex}-after`);
            segments.push(buildSegmentRecord({
                segmentIndex,
                decision: { recoveryDecision: "no_safe_action", rationale: reason },
                snapshotPath: segSnapshot.snapshotPath,
                executionStatus: "failed",
                error: reason
            }));
            return {
                success: false,
                status: "needs_agent",
                segments,
                failedReason: reason,
                failedTarget: input.failedTarget,
                failedAtStep: input.failedAtStep,
                finalSnapshot: segSnapshot.snapshot,
                finalSnapshotPath: segSnapshot.snapshotPath
            };
        }
        const recoveryDecision = repair.diagnostics?.recoveryDecision;
        if (recoveryDecision === "no_safe_action" || recoveryDecision === "needs_more_context") {
            const segSnapshot = await captureSnapshot(input.page, handoffDir, `segment-${segmentIndex}-after`);
            const nonPlanDecision = recoveryDecision === "needs_more_context"
                ? { recoveryDecision: "needs_more_context", unresolvedQuestions: ["Segment recovery: insufficient context after execution."], rationale: repair.error ?? `AI: ${recoveryDecision}` }
                : { recoveryDecision: "no_safe_action", rationale: repair.error ?? `AI: ${recoveryDecision}` };
            segments.push(buildSegmentRecord({
                segmentIndex,
                decision: nonPlanDecision,
                snapshotPath: segSnapshot.snapshotPath,
                executionStatus: "failed",
                error: recoveryDecision
            }));
            return {
                success: false,
                status: "needs_agent",
                segments,
                failedReason: recoveryDecision,
                failedTarget: input.failedTarget,
                failedAtStep: input.failedAtStep,
                finalSnapshot: segSnapshot.snapshot,
                finalSnapshotPath: segSnapshot.snapshotPath
            };
        }
        // --- Execute the repair plan ---
        const responseRaw = JSON.parse(await Promise.resolve().then(() => __importStar(require("node:fs/promises"))).then((fs) => fs.readFile(responsePath, "utf-8")));
        const repairedPlan = responseRaw.plans?.[0];
        if (!repairedPlan) {
            const segSnapshot = await captureSnapshot(input.page, handoffDir, `segment-${segmentIndex}-after`);
            segments.push(buildSegmentRecord({
                segmentIndex,
                decision: { recoveryDecision: "no_safe_action", rationale: "No plan in response" },
                snapshotPath: segSnapshot.snapshotPath,
                executionStatus: "failed",
                error: "No repaired plan in response."
            }));
            return {
                success: false,
                status: "needs_agent",
                segments,
                failedReason: "no_plan",
                failedTarget: input.failedTarget,
                failedAtStep: input.failedAtStep,
                finalSnapshot: segSnapshot.snapshot,
                finalSnapshotPath: segSnapshot.snapshotPath
            };
        }
        const segEvidenceDir = node_path_1.default.join(input.evidenceDir, `segment-${segmentIndex}`);
        const retry = await (0, execution_plan_executor_1.executeExecutionPlan)({
            page: input.page,
            plan: repairedPlan,
            dataContext,
            evidenceDir: segEvidenceDir,
            continueOnFailure: false,
            runtimeConfig: input.fullConfig,
            appBaseUrl: input.fullConfig.app.baseUrl
        });
        const executionStatus = retry.status === "passed" ? "passed" : "failed";
        const afterSnapshot = await captureSnapshot(input.page, segEvidenceDir, `segment-${segmentIndex}-after`);
        const selectedCandidateId = repair.diagnostics?.selectedCandidateId;
        // Track failed candidate to prevent loops
        if (selectedCandidateId) {
            failedRoutePaths.push(selectedCandidateId);
        }
        // Look up relation/score from the recovery pack for diagnostics
        const executedCandidate = selectedCandidateId
            ? recoveryPack.topVisibleCandidates.find((c) => c.id === selectedCandidateId)
            : undefined;
        segments.push(buildSegmentRecord({
            segmentIndex,
            decision: { recoveryDecision: "repaired_plan", selectedCandidateId: selectedCandidateId ?? "", action: "click", confidence: 0, sensitive: false, rationale: "" },
            snapshotPath: afterSnapshot.snapshotPath,
            executionStatus,
            candidateText: repair.diagnostics?.selectedCandidateText ?? executedCandidate?.text,
            semanticRelation: executedCandidate?.semanticRelation,
            score: executedCandidate?.score,
            error: executionStatus === "failed" ? `Step execution: ${retry.status}` : undefined
        }));
        if (executionStatus === "passed") {
            // If the plan executed successfully, check if pending targets can now be resolved
            // in the new snapshot. If direct hits exist, this segment resolved the path.
            const nextPack = (0, route_recovery_pack_1.buildRouteRecoveryPack)({
                failedReason: input.failedReason,
                failedTarget: input.failedTarget,
                failedAtStep: input.failedAtStep,
                currentPlan,
                snapshot: afterSnapshot.snapshot,
                scenario: input.scenario,
                budget: input.agentCfg.planningBudget,
                failedRoutePaths
            });
            const nextHit = nextPack.topVisibleCandidates.find((c) => (c.semanticRelation === "exact_match" || c.semanticRelation === "near_match")
                && c.actionability === "clickable"
                && !failedRoutePaths.includes(c.id));
            if (nextHit) {
                if (input.showAgentLog) {
                    console.log(`[segment-${segmentIndex}] Post-execution resolved: "${nextHit.text ?? nextHit.type}"`);
                }
                return {
                    success: true,
                    status: "repaired_passed",
                    segments,
                    candidatePlan: repairedPlan,
                    finalSnapshot: afterSnapshot.snapshot,
                    finalSnapshotPath: afterSnapshot.snapshotPath
                };
            }
            // Plan passed but target not directly resolvable; continue to next segment
            currentPlan = repairedPlan;
            currentSnapshot = afterSnapshot.snapshot;
            currentSnapshotPath = afterSnapshot.snapshotPath;
            continue;
        }
        // Execution failed, track and try next segment
        currentSnapshot = afterSnapshot.snapshot;
        currentSnapshotPath = afterSnapshot.snapshotPath;
    }
    return {
        success: false,
        status: "auto_repair_exhausted",
        segments,
        failedReason: "Segmented recovery exhausted after max segments.",
        failedTarget: input.failedTarget,
        failedAtStep: input.failedAtStep
    };
}
