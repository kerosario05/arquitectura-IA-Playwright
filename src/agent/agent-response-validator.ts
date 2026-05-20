import { validateExecutionPlan } from "../plans";
import type { AgentHandoffResponse } from "../types/agent-handoff.types";
import type { ExecutionPlan } from "../types/execution-plan.types";

export type AgentResponseValidationIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  planIndex?: number;
  stepIndex?: number;
};

export type AgentResponseValidationResult = {
  valid: boolean;
  issues: AgentResponseValidationIssue[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function looksSensitiveLiteral(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("bearer") ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.replace(/\D/g, "").length >= 12
  );
}

function looksLikeExecutionPlan(value: unknown): value is ExecutionPlan {
  if (!isObject(value)) {
    return false;
  }

  return (
    value.version === "1.0" &&
    hasText(value.source) &&
    hasText(value.status) &&
    isObject(value.scenario) &&
    Array.isArray(value.requiredData) &&
    Array.isArray(value.steps)
  );
}

export function normalizeAgentHandoffResponse(response: unknown): AgentHandoffResponse | unknown {
  if (looksLikeExecutionPlan(response)) {
    return {
      version: "1.0",
      generatedAt:
        typeof response.createdAt === "string" && response.createdAt.trim().length > 0
          ? response.createdAt
          : new Date().toISOString(),
      plans: [response],
      proposedObjects: [],
      unresolvedQuestions: [],
      rationale: ["Normalized legacy bare ExecutionPlan response into AgentHandoffResponse."]
    };
  }

  return response;
}

export function validateAgentHandoffResponse(
  response: unknown,
  options?: { availableDataKeys?: string[] }
): AgentResponseValidationResult {
  response = normalizeAgentHandoffResponse(response);
  const issues: AgentResponseValidationIssue[] = [];

  if (!isObject(response)) {
    return {
      valid: false,
      issues: [{ level: "error", code: "RESPONSE_OBJECT_REQUIRED", message: "Agent response must be an object." }]
    };
  }

  if (response.version !== "1.0") {
    issues.push({ level: "error", code: "RESPONSE_VERSION_INVALID", message: "Response version must be 1.0." });
  }
  if (!hasText(response.generatedAt)) {
    issues.push({ level: "error", code: "RESPONSE_GENERATED_AT_REQUIRED", message: "generatedAt is required." });
  }
  if (!Array.isArray(response.plans)) {
    issues.push({ level: "error", code: "RESPONSE_PLANS_ARRAY_REQUIRED", message: "plans must be an array." });
  }
  if (!Array.isArray(response.proposedObjects)) {
    issues.push({ level: "error", code: "RESPONSE_PROPOSED_OBJECTS_ARRAY_REQUIRED", message: "proposedObjects must be an array." });
  }
  if (!Array.isArray(response.unresolvedQuestions)) {
    issues.push({ level: "error", code: "RESPONSE_UNRESOLVED_ARRAY_REQUIRED", message: "unresolvedQuestions must be an array." });
  }
  if (!Array.isArray(response.rationale)) {
    issues.push({ level: "error", code: "RESPONSE_RATIONALE_ARRAY_REQUIRED", message: "rationale must be an array." });
  }

  const plansCount = Array.isArray(response.plans) ? response.plans.length : 0;
  const proposedObjectsCount = Array.isArray(response.proposedObjects) ? response.proposedObjects.length : 0;
  const unresolvedCount = Array.isArray(response.unresolvedQuestions) ? response.unresolvedQuestions.length : 0;
  const rationaleCount = Array.isArray(response.rationale) ? response.rationale.length : 0;

  if (plansCount === 0 && proposedObjectsCount === 0 && unresolvedCount === 0 && rationaleCount === 0) {
    issues.push({
      level: "error",
      code: "RESPONSE_NOT_ACTIONABLE",
      message: "agent-response.json was found but is not actionable. All sections are empty: plans=0, proposedObjects=0, unresolvedQuestions=0, rationale=0."
    });
  }

  if (Array.isArray(response.plans) && response.plans.length === 0) {
    issues.push({
      level: "error",
      code: "RESPONSE_PLANS_EMPTY",
      message: `plans array is empty. The agent did not produce any ExecutionPlan. (plans: ${plansCount}, proposedObjects: ${proposedObjectsCount}, unresolvedQuestions: ${unresolvedCount}, rationale: ${rationaleCount})`
    });
  }

  if (Array.isArray(response.plans)) {
    for (let planIndex = 0; planIndex < response.plans.length; planIndex += 1) {
      const plan = response.plans[planIndex];
      const result = validateExecutionPlan(plan);
      for (const issue of result.issues) {
        issues.push({
          level: issue.level,
          code: `PLAN_${issue.code}`,
          message: issue.message,
          planIndex,
          stepIndex: issue.stepIndex
        });
      }

      if (isObject(plan) && Array.isArray(plan.steps)) {
        for (const stepRaw of plan.steps) {
          if (!isObject(stepRaw)) {
            continue;
          }
          const stepIndex = typeof stepRaw.index === "number" ? stepRaw.index : undefined;
          if (hasText(stepRaw.value) && looksSensitiveLiteral(String(stepRaw.value))) {
            issues.push({
              level: "error",
              code: "PLAN_SENSITIVE_LITERAL_VALUE",
              message: "Step contains suspicious literal value. Use valueKey instead.",
              planIndex,
              stepIndex
            });
          }

          if (hasText(stepRaw.valueKey) && options?.availableDataKeys) {
            const allowed = new Set(options.availableDataKeys);
            const valueKey = String(stepRaw.valueKey);
            if (!allowed.has(valueKey)) {
              issues.push({
                level: "error",
                code: "PLAN_VALUEKEY_NOT_AVAILABLE",
                message: `valueKey '${valueKey}' is not available in handoff request dataContextSummary.`,
                planIndex,
                stepIndex
              });
            }
          }
        }
      }
    }
  }

  if (Array.isArray(response.proposedObjects)) {
    for (const item of response.proposedObjects) {
      if (!isObject(item)) {
        issues.push({ level: "error", code: "PROPOSED_OBJECT_INVALID", message: "Each proposedObject must be an object." });
        continue;
      }
      if (!hasText(item.key) || !hasText(item.name) || typeof item.confidence !== "number") {
        issues.push({
          level: "error",
          code: "PROPOSED_OBJECT_REQUIRED_FIELDS",
          message: "proposedObject requires key, name and confidence."
        });
      }
      if (typeof item.confidence === "number" && item.confidence < 0.7) {
        issues.push({
          level: "warning",
          code: "PROPOSED_OBJECT_LOW_CONFIDENCE",
          message: `proposedObject '${String(item.key ?? "unknown")}' has low confidence.`
        });
      }
    }
  }

  return {
    valid: !issues.some((issue) => issue.level === "error"),
    issues
  };
}

export function assertValidAgentHandoffResponse(response: unknown): asserts response is AgentHandoffResponse {
  const result = validateAgentHandoffResponse(response);
  if (!result.valid) {
    const message = result.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid agent response: ${message || "unknown validation error"}`);
  }
}
