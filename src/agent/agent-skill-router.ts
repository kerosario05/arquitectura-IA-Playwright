import type { SkillId, SkillFailureReason, SkillSelectionCriteria, SkillRouterResult, AgentSkillDefinition } from "../types/agent-skill.types";
import { loadSkillDefinition } from "./agent-skill-loader";

const SKILL_ROUTING: Record<SkillFailureReason, SkillId[]> = {
  ambiguous_target: ["target-disambiguation"],
  target_not_found: ["navigation-recovery"],
  locator_resolution_failed: ["target-disambiguation", "navigation-recovery"],
  assertion_not_found: ["assertion-resolution"],
  pendingAssertions: ["assertion-resolution"],
  needs_assertion_resolution: ["assertion-resolution"],
  missing_test_data: ["form-fill"],
  field_not_found: ["form-fill"],
  ambiguous_field: ["form-fill"],
  fill_target_not_found: ["form-fill"],
  fill_target_not_editable: ["form-fill"],
  click_no_transition: ["navigation-recovery"],
  promotion_gate_blocked: ["promotion-review"],
  poor_case_quality: ["case-quality"],
  repeated_targets: ["case-quality"],
  vague_assertions: ["case-quality"]
};

function computeConfidence(criteria: SkillSelectionCriteria, skillId: SkillId): number {
  switch (skillId) {
    case "target-disambiguation":
      return criteria.hasCandidates ? 0.85 : 0.3;
    case "navigation-recovery":
      return criteria.hasCandidates ? 0.7 : 0.2;
    case "assertion-resolution":
      return criteria.hasPendingAssertions ? 0.8 : 0.4;
    case "form-fill":
      return 0.75;
    case "promotion-review":
      return 0.8;
    case "case-quality":
      return 0.7;
    default:
      return 0.5;
  }
}

function selectFromCandidates(
  candidates: SkillId[],
  criteria: SkillSelectionCriteria
): { skillId: SkillId; definition: AgentSkillDefinition; confidence: number } | null {
  if (candidates.length === 0) return null;

  if (candidates.length === 1) {
    const skillId = candidates[0];
    return {
      skillId,
      definition: loadSkillDefinition(skillId),
      confidence: computeConfidence(criteria, skillId)
    };
  }

  const scored = candidates.map((skillId) => ({
    skillId,
    definition: loadSkillDefinition(skillId),
    confidence: computeConfidence(criteria, skillId),
    priority: skillId === "target-disambiguation" && criteria.hasCandidates ? 2
      : skillId === "navigation-recovery" && !criteria.hasCandidates ? 1
      : 0
  }));

  scored.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  return scored[0];
}

export function selectSkill(criteria: SkillSelectionCriteria): SkillRouterResult | null {
  if (!criteria.failedReason && !criteria.diagnostics) {
    return null;
  }

  const reason = criteria.failedReason as SkillFailureReason | undefined;
  if (!reason || !SKILL_ROUTING[reason]) {
    for (const key of Object.keys(SKILL_ROUTING) as SkillFailureReason[]) {
      if (criteria.failedReason?.toLowerCase().includes(key.toLowerCase())) {
        return selectFromCandidates(SKILL_ROUTING[key], criteria);
      }
    }
    return null;
  }

  const candidates = SKILL_ROUTING[reason];

  const result = selectFromCandidates(candidates, criteria);
  if (!result) return null;

  return result;
}

export function isSkillAllowedInBatch(skillId: SkillId): boolean {
  const BATCH_ALLOWED: SkillId[] = [
    "target-disambiguation",
    "navigation-recovery",
    "assertion-resolution",
    "form-fill",
    "promotion-review",
    "case-quality"
  ];
  return BATCH_ALLOWED.includes(skillId);
}

export function validateSkillResponseAgainstRules(
  response: { skillId: SkillId; proposedAction: { type: string; candidateId?: string }; confidence: number; status: string; requiresCodeChange?: boolean; requiresRegistryChange?: boolean },
  snapshotCandidateIds: string[],
  skillDefinition: AgentSkillDefinition
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (response.skillId !== skillDefinition.id) {
    errors.push(`Response skillId "${response.skillId}" does not match selected skill "${skillDefinition.id}".`);
  }

  if (response.proposedAction?.candidateId && !snapshotCandidateIds.includes(response.proposedAction.candidateId)) {
    errors.push(`candidateId "${response.proposedAction.candidateId}" does not exist in snapshotCandidates.`);
  }

  if (response.confidence < 0.6 && response.status !== "needs_agent_review" && response.status !== "no_safe_action") {
    errors.push(`confidence ${response.confidence} is below 0.6 but status is "${response.status}", expected "needs_agent_review".`);
  }

  if (response.requiresCodeChange && response.proposedAction?.type === "click_candidate") {
    errors.push("click_candidate action should not require code change.");
  }

  if (response.requiresRegistryChange) {
    errors.push("Agent response must not require registry changes in batch mode.");
  }

  return { valid: errors.length === 0, errors };
}

export function getFailedReasonForRouting(
  failedReason: string | undefined,
  diagnostics?: Record<string, unknown>
): SkillFailureReason | undefined {
  if (!failedReason) return undefined;

  const diagnosticHints: Record<string, SkillFailureReason> = {
    repeated_targets: "repeated_targets",
    vague_assertions: "vague_assertions",
    poor_case_quality: "poor_case_quality",
    promotion_gate_blocked: "promotion_gate_blocked",
    missing_test_data: "missing_test_data",
    field_not_found: "field_not_found",
    ambiguous_field: "ambiguous_field"
  };

  for (const [key, reason] of Object.entries(diagnosticHints)) {
    if (failedReason.toLowerCase().includes(key)) {
      return reason;
    }
  }

  return failedReason as SkillFailureReason;
}
