import type { ExecutionPlan, ExecutionPlanStep, RequiredDataRef } from "../types/execution-plan.types";
import type { TestScenario } from "../types/testrail.types";

function normalizeHintKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function generateRuleBasedExecutionPlan(
  scenario: TestScenario,
  options?: {
    includeLogin?: boolean;
    includeInitialNavigate?: boolean;
  }
): ExecutionPlan {
  const steps: ExecutionPlanStep[] = [];
  let stepIndex = 1;

  if (options?.includeInitialNavigate !== false) {
    steps.push({
      index: stepIndex,
      action: "navigate",
      target: "APP_BASE_URL",
      description: "Navigate to base URL",
      evidence: true
    });
    stepIndex += 1;
  }

  if (options?.includeLogin) {
    steps.push({
      index: stepIndex,
      action: "login",
      description: "Apply configured login strategy",
      evidence: true
    });
    stepIndex += 1;
  }

  for (const sourceStep of scenario.steps) {
    steps.push({
      index: stepIndex,
      action: "noop",
      description: sourceStep.action,
      expected: sourceStep.expected,
      ...(sourceStep.conditionalAction ? {
        action: sourceStep.conditionalAction.operation,
        target: { strategy: "text" as const, value: sourceStep.conditionalAction.actionTarget, exact: false },
        optional: true,
        conditionalAction: sourceStep.conditionalAction
      } : {}),
      evidence: true
    });
    stepIndex += 1;
  }

  const requiredDataMap = new Map<string, RequiredDataRef>();
  for (const scenarioStep of scenario.steps) {
    for (const hint of scenarioStep.dataHints) {
      const key = normalizeHintKey(hint);
      if (!key || requiredDataMap.has(key)) {
        continue;
      }
      requiredDataMap.set(key, {
        key,
        required: true,
        resolved: false,
        reason: "Detected from TestRail scenario dataHints"
      });
    }
  }

  return {
    version: "1.0",
    source: "rule_based",
    status: "draft",
    scenario: {
      source: scenario.source,
      externalId: scenario.externalId,
      caseId: scenario.caseId,
      title: scenario.title
    },
    requiredData: Array.from(requiredDataMap.values()),
    steps,
    notes: [
      "This is an initial rule_based plan.",
      "NOOP steps must be converted into executable actions by a future discovery/AI phase."
    ],
    createdAt: new Date().toISOString()
  };
}
