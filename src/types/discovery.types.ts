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
    | "needs_approval";
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
  aiAssisted?: boolean;
  aiProposal?: AiExplorerOutput;
  aiReason?: string;
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
    | "discovered_partial"
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
