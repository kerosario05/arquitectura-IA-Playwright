import type {
  ExecutionPlan,
  ExecutionPlanStatus,
  ExecutionPlanStep,
  RequiredDataRef
} from "../types/execution-plan.types";
import { getActionCapability } from "../registry/action-registry";

export type PlanValidationIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  stepIndex?: number;
};

export type PlanValidationResult = {
  valid: boolean;
  status: ExecutionPlanStatus;
  issues: PlanValidationIssue[];
};

const allowedSources = new Set(["manual", "rule_based", "ai_generated", "discovery_generated"]);
const allowedStatuses = new Set(["draft", "validated", "invalid", "needs_data", "needs_discovery", "unsupported"]);
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function pushError(issues: PlanValidationIssue[], code: string, message: string, stepIndex?: number): void {
  issues.push({ level: "error", code, message, stepIndex });
}

function pushWarning(issues: PlanValidationIssue[], code: string, message: string, stepIndex?: number): void {
  issues.push({ level: "warning", code, message, stepIndex });
}

function validateStepRules(step: ExecutionPlanStep, issues: PlanValidationIssue[]): void {
  const stepIndex = step.index;
  const capability = getActionCapability(step.action);
  if (!capability) {
    pushError(issues, "STEP_ACTION_INVALID", `Unsupported step action: ${String(step.action)}`, stepIndex);
    return;
  }

  if (capability.requiresTarget) {
    if (step.action === "navigate") {
      if (!(step.target === "APP_BASE_URL" || isObject(step.target))) {
        pushError(
          issues,
          "STEP_NAVIGATE_TARGET_REQUIRED",
          "navigate requires target APP_BASE_URL or PlanTarget.",
          stepIndex
        );
      }
    } else if (!isObject(step.target)) {
      pushError(issues, "STEP_TARGET_REQUIRED", `${step.action} requires target.`, stepIndex);
    }
  }

  if (capability.requiresValue && !hasNonEmptyString(step.value) && !(capability.allowsValueKey && hasNonEmptyString(step.valueKey))) {
    pushError(issues, "STEP_VALUE_REQUIRED", `${step.action} requires value${capability.allowsValueKey ? " or valueKey" : ""}.`, stepIndex);
  }

  if (capability.requiresExpected && !hasNonEmptyString(step.expected)) {
    pushError(issues, "STEP_EXPECTED_REQUIRED", `${step.action} requires expected value.`, stepIndex);
  }

  if (step.action === "waitFor" && typeof step.timeoutMs !== "number" && !isObject(step.target)) {
    pushError(issues, "STEP_WAITFOR_REQUIRED", "waitFor requires timeoutMs or target.", stepIndex);
  }
}

function deriveStatus(current: ExecutionPlanStatus, issues: PlanValidationIssue[]): ExecutionPlanStatus {
  const hasErrors = issues.some((issue) => issue.level === "error");
  if (!hasErrors) {
    return current;
  }
  if (current === "unsupported") {
    return "unsupported";
  }
  return "invalid";
}

export function validateExecutionPlan(plan: unknown): PlanValidationResult {
  const issues: PlanValidationIssue[] = [];

  if (!isObject(plan)) {
    return {
      valid: false,
      status: "invalid",
      issues: [{ level: "error", code: "PLAN_OBJECT_REQUIRED", message: "Execution plan must be an object." }]
    };
  }

  const version = plan.version;
  const source = plan.source;
  const status = plan.status as ExecutionPlanStatus;
  const scenario = plan.scenario;
  const requiredData = plan.requiredData;
  const steps = plan.steps;

  if (version !== "1.0") {
    pushError(issues, "PLAN_VERSION_INVALID", "Plan version must be '1.0'.");
  }
  if (!allowedSources.has(String(source))) {
    pushError(issues, "PLAN_SOURCE_INVALID", "Plan source is not allowed.");
  }
  if (!allowedStatuses.has(String(status))) {
    pushError(issues, "PLAN_STATUS_INVALID", "Plan status is not allowed.");
  }
  if (!isObject(scenario)) {
    pushError(issues, "PLAN_SCENARIO_REQUIRED", "Scenario is required.");
  } else if (!hasNonEmptyString(scenario.title)) {
    pushError(issues, "PLAN_SCENARIO_TITLE_REQUIRED", "Scenario title is required.");
  }

  if (!Array.isArray(requiredData)) {
    pushError(issues, "PLAN_REQUIRED_DATA_ARRAY", "requiredData must be an array.");
  }

  if (!Array.isArray(steps)) {
    pushError(issues, "PLAN_STEPS_ARRAY", "steps must be an array.");
  } else if (steps.length === 0 && status !== "unsupported") {
    pushError(issues, "PLAN_STEPS_EMPTY", "steps cannot be empty unless status is unsupported.");
  }

  const requiredDataKeys = new Set<string>();
  let unresolvedRequiredData = false;

  if (Array.isArray(requiredData)) {
    for (const item of requiredData) {
      if (!isObject(item)) {
        pushError(issues, "REQUIRED_DATA_INVALID", "requiredData entry must be an object.");
        continue;
      }
      const entry = item as RequiredDataRef;
      if (!hasNonEmptyString(entry.key)) {
        pushError(issues, "REQUIRED_DATA_KEY_REQUIRED", "requiredData.key must be non-empty.");
      } else {
        requiredDataKeys.add(entry.key.trim());
      }
      if (entry.required && !entry.resolved) {
        unresolvedRequiredData = true;
      }
    }
  }

  if (Array.isArray(steps)) {
    const usedIndexes = new Set<number>();

    for (const rawStep of steps) {
      if (!isObject(rawStep)) {
        pushError(issues, "STEP_OBJECT_REQUIRED", "Each step must be an object.");
        continue;
      }

      const step = rawStep as ExecutionPlanStep;
      if (typeof step.index !== "number" || !Number.isInteger(step.index) || step.index <= 0) {
        pushError(issues, "STEP_INDEX_INVALID", "Step index must be a positive integer.");
      } else if (usedIndexes.has(step.index)) {
        pushError(issues, "STEP_INDEX_DUPLICATED", "Step index is duplicated.", step.index);
      } else {
        usedIndexes.add(step.index);
      }

      if (!getActionCapability(step.action)) {
        pushError(issues, "STEP_ACTION_INVALID", "Step action is not allowed.", step.index);
      } else {
        validateStepRules(step, issues);
      }

      if (hasNonEmptyString(step.valueKey) && !requiredDataKeys.has(step.valueKey!.trim())) {
        pushWarning(
          issues,
          "STEP_VALUEKEY_NOT_DECLARED",
          `valueKey '${step.valueKey}' is not declared in requiredData.`,
          step.index
        );
      }
    }
  }

  if (status === "validated" && unresolvedRequiredData) {
    pushError(
      issues,
      "PLAN_VALIDATED_WITH_UNRESOLVED_DATA",
      "Plan status 'validated' is not allowed when requiredData has unresolved required entries."
    );
  }

  if (unresolvedRequiredData && status === "draft") {
    pushWarning(
      issues,
      "PLAN_DRAFT_WITH_UNRESOLVED_DATA",
      "Draft plan has unresolved required data and may later require status 'needs_data'."
    );
  }

  const derivedStatus = deriveStatus(status, issues);
  const hasErrors = issues.some((issue) => issue.level === "error");

  if (status === "validated" && hasErrors) {
    return { valid: false, status: "invalid", issues };
  }

  return {
    valid: !hasErrors,
    status: hasErrors ? derivedStatus : status,
    issues
  };
}

export function assertValidExecutionPlan(plan: unknown): asserts plan is ExecutionPlan {
  const result = validateExecutionPlan(plan);
  if (!result.valid) {
    const errors = result.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid execution plan: ${errors || "unknown validation errors"}`);
  }
}
