import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";
import type { TargetCandidate } from "../discovery/target-resolver";

export type AiExplorerAction = "click" | "fill" | "select" | "assert" | "wait" | "stop";

export type AiExplorerInput = {
  currentGoal: string;
  currentStep: string;
  target: string;
  snapshot: PageSnapshot;
  visibleElements: SnapshotElement[];
  clickableCandidates: TargetCandidate[];
  closestCandidates: TargetCandidate[];
  previousSteps: Array<{
    index: number;
    action: string;
    status: string;
    targetText?: string;
  }>;
  attemptedLocators?: string[];
  candidateDiagnostics?: unknown[];
  assertionDiagnostics?: unknown[];
  allowedActions: AiExplorerAction[];
  constraints: string[];
};

export type AiExplorerOutput = {
  action: AiExplorerAction;
  candidateId?: string;
  target: string;
  confidence: number;
  reason: string;
  alternatives: Array<{
    action: AiExplorerAction;
    candidateId?: string;
    target: string;
    reason: string;
  }>;
  risk: string;
  requiresHumanApproval: boolean;
};

export type AiExplorerProvider = {
  name: string;
  propose(input: AiExplorerInput): Promise<AiExplorerOutput | null>;
};

export type AiExplorerProviderName = "codex" | "copilot" | "custom";
