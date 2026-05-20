import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";
import type { DiscoveryStepResult } from "../types/discovery.types";
import type { TargetResolutionResult, AiAssistanceTriggerReason } from "./target-resolver";
import type { AiExplorerAction, AiExplorerOutput } from "../ai/ai-explorer.types";
import type { AIExplorer } from "../ai/ai-explorer";
import { isElementClickable } from "./target-resolver";

export type AiAssistedDiscoveryConfig = {
  enabled: boolean;
  confidenceThreshold: number;
  requireApprovalThreshold: number;
  maxAttempts: number;
  sensitiveActions?: AiExplorerAction[];
};

export type AiProposalExecutionResult = {
  success: boolean;
  transitionDetected?: boolean;
  expectedAssertionMet?: boolean;
  evidencePath?: string;
  reason?: string;
  beforeSnapshot?: PageSnapshot;
  afterSnapshot?: PageSnapshot;
};

export type AiAssistedDiscoveryDependencies = {
  explorer: AIExplorer;
  config: AiAssistedDiscoveryConfig;
  executeProposal: (proposal: AiExplorerOutput, element?: SnapshotElement) => Promise<AiProposalExecutionResult>;
};

export type AiAssistedDiscoveryRequest = {
  currentGoal: string;
  currentStep: string;
  target: string;
  snapshot: PageSnapshot;
  resolution: TargetResolutionResult;
  previousSteps: DiscoveryStepResult[];
  allowedActions: AiExplorerAction[];
  constraints: string[];
  triggerReason: AiAssistanceTriggerReason;
  attempt?: number;
};

export type AiAssistedDiscoveryOutcome =
  | {
      status: "skipped";
      reason: string;
    }
  | {
      status: "ai_candidate_rejected" | "needs_approval";
      reason: string;
      proposal?: AiExplorerOutput;
    }
  | {
      status: "executed";
      proposal: AiExplorerOutput;
      execution: AiProposalExecutionResult;
      pending: true;
    };

function violatesConstraints(action: AiExplorerAction, constraints: string[]): string | null {
  const normalizedAction = action.toLowerCase();
  for (const constraint of constraints) {
    const normalized = constraint.toLowerCase();
    if (
      normalized.includes("forbid_action:") && normalized.includes(normalizedAction)
      || normalized.includes("disallow") && normalized.includes(normalizedAction)
      || normalized.includes("no ") && normalized.includes(normalizedAction)
    ) {
      return `Action "${action}" violates constraint "${constraint}".`;
    }
  }

  return null;
}

export function validateAiProposal(
  proposal: AiExplorerOutput,
  request: AiAssistedDiscoveryRequest,
  config: AiAssistedDiscoveryConfig
): {
  valid: boolean;
  requiresApproval: boolean;
  reason?: string;
  element?: SnapshotElement;
} {
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

  if (proposal.action === "click" && element && !isElementClickable(element)) {
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

export async function runAiAssistedDiscovery(
  request: AiAssistedDiscoveryRequest,
  dependencies: AiAssistedDiscoveryDependencies
): Promise<AiAssistedDiscoveryOutcome> {
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
    candidateDiagnostics: (request.resolution as TargetResolutionResult & { _diagnosis?: unknown[] })._diagnosis,
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
