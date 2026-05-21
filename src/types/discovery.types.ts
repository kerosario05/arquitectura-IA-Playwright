import type { RegistryObject, RegistryObjectType, RegistryLocator } from "./object-registry.types";
import type { SnapshotElement } from "./page-snapshot.types";
import type { ExecutionPlan } from "./execution-plan.types";
import type { AiExplorerOutput } from "../ai/ai-explorer.types";
import type { AssertionClassification, AssertionResolutionStatus } from "../discovery/assertion-resolver";

export type ProposedObject = RegistryObject & {
  confidence: number;
  reason: string;
  sourceElementId: string;
};

export type DiscoveryScanResult = {
  version: "1.0";
  url: string;
  title: string;
  scannedAt: string;
  totalElementsScanned: number;
  proposedObjects: ProposedObject[];
  summary: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    byType: Record<string, number>;
  };
};

export type ProposedObjectCandidate = {
  element: SnapshotElement;
  type: RegistryObjectType;
  key: string;
  name: string;
  locator: RegistryLocator;
  confidence: number;
  reason: string;
};

export type DiscoveryStepResult = {
  index: number;
  action: string;
  status:
    | "found"
    | "not_found"
    | "skipped"
    | "click_no_transition"
    | "ambiguous_target"
    | "locator_resolution_failed"
    | "fill_target_not_editable"
    | "satisfied_by_children"
    | "skipped_semantic_descriptor"
    | "needs_assertion_resolution"
    | "needs_setup_resolution"
    | "needs_associated_target_resolution"
    | "ai_candidate_rejected"
    | "needs_approval"
    | "skipped_after_completion"
    | "skipped_redundant";
  targetText?: string;
  snapshotUrl?: string;
  snapshotTitle?: string;
  elementsFound?: number;
  error?: string;
  evidencePath?: string;
  resolutionDiagnosis?: unknown[];
  attemptedLocators?: string[];
  candidateId?: string;
  candidateText?: string;
  assertionClassification?: AssertionClassification;
  assertionStatus?: AssertionResolutionStatus;
  matchedText?: string;
  confidence?: number;
  closestCandidates?: Array<{ text: string; score: number; type: string }>;
  visibleTexts?: string[];
  descriptorTypes?: string[];
  subject?: string;
  matchedTokens?: string[];
  structuralSignals?: string[];
  childAssertionsUsed?: string[];
  aiAssisted?: boolean;
  aiProposal?: AiExplorerOutput;
  aiReason?: string;
  ambiguityDiagnostics?: {
    target: string;
    semanticRole?: "product" | "card" | "option" | "category" | "item" | "section" | "unknown";
    relationContext?: string;
    candidateCount: number;
    candidateTexts: string[];
    candidateRoles: string[];
    candidateStrategies: string[];
    suggestedExactTargetPattern?: string;
    suggestedAssociatedActionPattern?: string;
  };
  aiDiagnostics?: {
    attempted: boolean;
    result: string;
    proposal?: AiExplorerOutput;
  };
  // Recovery metadata — set when segmented route recovery resolves a failed step
  originalStatus?: string;
  recoveryStatus?: "recovered" | "repaired";
  recoveredBy?: "segmented_route_recovery";
  recoveryMetadata?: {
    selectedCandidateId: string;
    selectedCandidateText?: string;
    semanticRelation?: string;
    score?: number;
    segmentIndex: number;
    transitionDetected: boolean;
    executedAction: string;
    rationale?: string;
  };
  earlyCompletionDiagnostics?: {
    checked: boolean;
    satisfied: boolean;
    satisfiedAssertions: string[];
    pendingAssertions: string[];
    blockingAssertions: string[];
    skippedAssertions: string[];
    weakSignals: string[];
    skippedReason?: string;
    skippedRemainingActions: number;
  };
  semanticRole?: "product" | "card" | "option" | "category" | "item" | "section" | "unknown";
  relationContext?: string;
};

export type DiscoveredObject = {
  key: string;
  name: string;
  type: RegistryObjectType;
  locator: RegistryLocator;
  aliases: string[];
  discoveredAt: string;
  sourceStep: number;
  confidence: number;
};

export type CaseDiscoveryResult = {
  version: "1.0";
  caseId: number;
  caseTitle: string;
  discoveredAt: string;
  status:
    | "discovered_passed"
    | "repaired_passed"
    | "discovered_partial"
    | "needs_agent"
    | "auto_repair_exhausted"
    | "needs_assertion_resolution"
    | "needs_setup_resolution"
    | "needs_associated_target_resolution"
    | "needs_approval"
    | "exploration_failed";
  steps: DiscoveryStepResult[];
  discoveredObjects: DiscoveredObject[];
  candidatePlan?: ExecutionPlan;
  pendingObjectsPath?: string;
  pendingPlansPath?: string;
  evidenceDir?: string;
  failedAtStep?: number;
  failedTarget?: string;
  failedReason?: string;
};
