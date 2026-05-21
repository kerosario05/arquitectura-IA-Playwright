export type SkillId =
  | "target-disambiguation"
  | "navigation-recovery"
  | "assertion-resolution"
  | "form-fill"
  | "promotion-review"
  | "case-quality";

export type SkillFailureReason =
  | "ambiguous_target"
  | "target_not_found"
  | "locator_resolution_failed"
  | "assertion_not_found"
  | "pendingAssertions"
  | "needs_assertion_resolution"
  | "missing_test_data"
  | "field_not_found"
  | "ambiguous_field"
  | "fill_target_not_found"
  | "fill_target_not_editable"
  | "click_no_transition"
  | "promotion_gate_blocked"
  | "poor_case_quality"
  | "repeated_targets"
  | "vague_assertions";

export type AgentSkillDefinition = {
  id: SkillId;
  purpose: string;
  allowedFailureReasons: SkillFailureReason[];
  inputContract: string[];
  outputContract: string[];
  forbiddenActions: string[];
  validationRules: string[];
  examples: Array<{
    scenario: string;
    input: string;
    output: string;
    reasoning: string;
  }>;
};

export type AgentSkillResponse = {
  skillId: SkillId;
  repairType: "target_resolution" | "assertion_resolution" | "navigation_recovery" | "form_data_resolution" | "promotion_review" | "case_quality_suggestion";
  status: "proposal" | "needs_agent_review" | "no_safe_action";
  targetStep?: number;
  diagnosis: string;
  proposedAction: {
    type: "click_candidate" | "skip_assertion" | "retry_assertion" | "update_plan" | "needs_data" | "case_quality_suggestion";
    candidateId?: string;
    assertionId?: string;
    reason: string;
  };
  confidence: number;
  shouldRetryExecution: boolean;
  requiresHumanApproval: boolean;
  requiresCodeChange: boolean;
  requiresRegistryChange: boolean;
  evidenceUsed: string[];
  risks: string[];
};

export type SkillSelectionCriteria = {
  failedReason?: string;
  failedTarget?: string;
  diagnostics?: Record<string, unknown>;
  hasCandidates?: boolean;
  hasPendingAssertions?: boolean;
  isBatchDiscovery?: boolean;
};

export type SkillRouterResult = {
  skillId: SkillId;
  definition: AgentSkillDefinition;
  confidence: number;
};
