"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAiProposal = validateAiProposal;
exports.runAiAssistedDiscovery = runAiAssistedDiscovery;
const target_resolver_1 = require("./target-resolver");
function violatesConstraints(action, constraints) {
    const normalizedAction = action.toLowerCase();
    for (const constraint of constraints) {
        const normalized = constraint.toLowerCase();
        if (normalized.includes("forbid_action:") && normalized.includes(normalizedAction)
            || normalized.includes("disallow") && normalized.includes(normalizedAction)
            || normalized.includes("no ") && normalized.includes(normalizedAction)) {
            return `Action "${action}" violates constraint "${constraint}".`;
        }
    }
    return null;
}
function validateAiProposal(proposal, request, config) {
    if (!request.allowedActions.includes(proposal.action)) {
        return { valid: false, requiresApproval: false, reason: `Action "${proposal.action}" is not allowed.` };
    }
    const constraintViolation = violatesConstraints(proposal.action, request.constraints);
    if (constraintViolation) {
        return { valid: false, requiresApproval: false, reason: constraintViolation };
    }
    const sensitiveActions = new Set(config.sensitiveActions ?? ["fill", "select"]);
    const isSensitive = sensitiveActions.has(proposal.action);
    if (proposal.confidence < config.requireApprovalThreshold) {
        return {
            valid: false,
            requiresApproval: false,
            reason: `AI confidence ${proposal.confidence.toFixed(2)} is below approval threshold ${config.requireApprovalThreshold.toFixed(2)}.`
        };
    }
    const element = proposal.candidateId
        ? request.snapshot.elements.find((candidate) => candidate.id === proposal.candidateId)
        : undefined;
    if (proposal.action !== "stop" && proposal.action !== "wait" && !element) {
        return {
            valid: false,
            requiresApproval: false,
            reason: `Candidate "${proposal.candidateId ?? "undefined"}" was not found in the snapshot.`
        };
    }
    if (proposal.action === "click" && element && !(0, target_resolver_1.isElementClickable)(element)) {
        return {
            valid: false,
            requiresApproval: false,
            reason: `Candidate "${element.id}" is not actionable for click.`
        };
    }
    if (proposal.requiresHumanApproval || isSensitive || proposal.confidence < config.confidenceThreshold) {
        return {
            valid: false,
            requiresApproval: true,
            reason: proposal.requiresHumanApproval
                ? "AI proposal explicitly requires human approval."
                : proposal.confidence < config.confidenceThreshold
                    ? `AI confidence ${proposal.confidence.toFixed(2)} is below execution threshold ${config.confidenceThreshold.toFixed(2)}.`
                    : `Sensitive action "${proposal.action}" requires human approval.`,
            element
        };
    }
    return { valid: true, requiresApproval: false, element };
}
async function runAiAssistedDiscovery(request, dependencies) {
    if (!dependencies.config.enabled) {
        return { status: "skipped", reason: "AI-assisted discovery is disabled." };
    }
    const attempt = request.attempt ?? 1;
    if (attempt > dependencies.config.maxAttempts) {
        return { status: "skipped", reason: "AI-assisted discovery max attempts reached." };
    }
    const visibleElements = request.snapshot.elements.filter((element) => element.visible);
    const clickableCandidates = request.resolution.candidates.filter((candidate) => candidate.isClickable);
    const closestCandidates = request.resolution.closestCandidates ?? request.resolution.candidates.slice(0, 5);
    const proposal = await dependencies.explorer.propose({
        currentGoal: request.currentGoal,
        currentStep: request.currentStep,
        target: request.target,
        snapshot: request.snapshot,
        visibleElements,
        clickableCandidates,
        closestCandidates,
        previousSteps: request.previousSteps.map((step) => ({
            index: step.index,
            action: step.action,
            status: step.status,
            targetText: step.targetText
        })),
        attemptedLocators: request.resolution.attemptedLocators,
        candidateDiagnostics: request.resolution._diagnosis,
        assertionDiagnostics: request.previousSteps
            .filter((step) => step.assertionClassification || step.assertionStatus)
            .map((step) => ({
            assertionClassification: step.assertionClassification,
            assertionStatus: step.assertionStatus,
            targetText: step.targetText,
            matchedText: step.matchedText
        })),
        allowedActions: request.allowedActions,
        constraints: request.constraints
    });
    if (!proposal) {
        return { status: "ai_candidate_rejected", reason: "AI explorer did not return a proposal." };
    }
    const validation = validateAiProposal(proposal, request, dependencies.config);
    if (!validation.valid) {
        return {
            status: validation.requiresApproval ? "needs_approval" : "ai_candidate_rejected",
            reason: validation.reason ?? "AI proposal rejected by framework validation.",
            proposal
        };
    }
    const execution = await dependencies.executeProposal(proposal, validation.element);
    if (!execution.success) {
        return {
            status: "ai_candidate_rejected",
            reason: execution.reason ?? "Framework execution rejected the AI proposal after validation.",
            proposal
        };
    }
    return {
        status: "executed",
        proposal,
        execution,
        pending: true
    };
}
