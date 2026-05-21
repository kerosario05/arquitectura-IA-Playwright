export type RepairedPlanRouteRecoveryDecision = {
  recoveryDecision: "repaired_plan";
  selectedCandidateId: string;
  action: string;
  confidence: number;
  sensitive: boolean;
  rationale: string;
};

export type NoSafeActionRouteRecoveryDecision = {
  recoveryDecision: "no_safe_action";
  rationale: string;
};

export type NeedsMoreContextRouteRecoveryDecision = {
  recoveryDecision: "needs_more_context";
  unresolvedQuestions: string[];
  rationale: string;
};

export type RouteRecoveryDecision =
  | RepairedPlanRouteRecoveryDecision
  | NoSafeActionRouteRecoveryDecision
  | NeedsMoreContextRouteRecoveryDecision;
