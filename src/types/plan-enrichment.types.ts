import type { ExecutionPlan } from "./execution-plan.types";

export type PlanEnrichmentDecisionType =
  | "converted_noop_to_fill"
  | "converted_noop_to_click"
  | "converted_noop_to_assert"
  | "kept_noop"
  | "required_data_resolved"
  | "required_data_missing"
  | "needs_discovery"
  | "low_confidence";

export type PlanEnrichmentDecision = {
  type: PlanEnrichmentDecisionType;
  stepIndex?: number;
  message: string;
  confidence?: number;
  elementId?: string;
  dataKey?: string;
};

export type PlanEnrichmentResult = {
  plan: ExecutionPlan;
  decisions: PlanEnrichmentDecision[];
  summary: {
    totalSteps: number;
    convertedSteps: number;
    unresolvedSteps: number;
    resolvedData: number;
    missingData: number;
    needsDiscovery: boolean;
  };
};
