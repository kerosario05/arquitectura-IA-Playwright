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
  "reason",
  "confidence",
  "questions"
] as const;

export const REPAIR_DECISION_FORBIDDEN_KEYS_PATTERN = /(css|xpath|locator|selector|testid|getby|queryselector)/i;

export type RepairDecision = {
  decision: (typeof REPAIR_DECISION_ALLOWED_DECISIONS)[number];
  repairType?: (typeof REPAIR_DECISION_ALLOWED_TYPES)[number];
  candidateId?: string;
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
