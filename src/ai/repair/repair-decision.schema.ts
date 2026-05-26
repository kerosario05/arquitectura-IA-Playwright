export const REPAIR_DECISION_ALLOWED_DECISIONS = [
  "repaired_plan",
  "no_safe_action",
  "needs_more_context"
] as const;

export const REPAIR_DECISION_ALLOWED_TYPES = [
  "target_resolution",
  "route_recovery",
  "assertion_resolution",
  "pom_method_missing",
  "selection_resolution"
] as const;

export const REPAIR_DECISION_ALLOWED_KEYS = [
  "decision",
  "repairType",
  "candidateId",
  "evidenceId",
  "assertionStatus",
  "selectionStatus",
  "reason",
  "confidence",
  "questions"
] as const;

export const REPAIR_DECISION_FORBIDDEN_KEYS_PATTERN = /(css|xpath|locator|selector|testid|getby|queryselector|inventedText|fakeEvidence)/i;

export type RepairDecision = {
  decision: (typeof REPAIR_DECISION_ALLOWED_DECISIONS)[number];
  repairType?: (typeof REPAIR_DECISION_ALLOWED_TYPES)[number];
  candidateId?: string; // For target_resolution, route_recovery, selection_resolution
  evidenceId?: string; // For assertion_resolution
  assertionStatus?: "satisfied_by_existing_evidence" | "partially_satisfied" | "needs_manual_review"; // For assertion_resolution
  selectionStatus?: "selected" | "partially_matched" | "needs_confirmation"; // For selection_resolution
  reason: string;
  confidence?: number;
  questions?: string[];
};

export function hasForbiddenRepairDecisionFields(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    if (REPAIR_DECISION_FORBIDDEN_KEYS_PATTERN.test(key)) return true;
    if (!(REPAIR_DECISION_ALLOWED_KEYS as readonly string[]).includes(key)) return true;
  }
  return false;
}
