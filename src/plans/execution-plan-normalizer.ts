import type { ExecutionPlan } from "../types/execution-plan.types";

function trimOptional(value?: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed || undefined;
}

export function normalizeExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
  const normalizedSteps = [...plan.steps]
    .sort((a, b) => a.index - b.index)
    .map((step) => ({
      ...step,
      description: trimOptional(step.description),
      value: trimOptional(step.value),
      valueKey: trimOptional(step.valueKey),
      expected: trimOptional(step.expected),
      target:
        step.target && step.target !== "APP_BASE_URL"
          ? {
              ...step.target,
              value: trimOptional(step.target.value),
              hint: trimOptional(step.target.hint),
              role: trimOptional(step.target.role),
              name: trimOptional(step.target.name)
            }
          : step.target
    }));

  const normalizedRequiredData = [...plan.requiredData]
    .map((item) => ({
      ...item,
      key: item.key.trim(),
      source: trimOptional(item.source),
      reason: trimOptional(item.reason)
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const normalizedNotes = plan.notes
    ?.map((note) => trimOptional(note))
    .filter((note): note is string => Boolean(note));

  return {
    ...plan,
    createdAt: plan.createdAt?.trim() || new Date().toISOString(),
    scenario: {
      ...plan.scenario,
      title: plan.scenario.title.trim(),
      externalId: trimOptional(plan.scenario.externalId)
    },
    notes: normalizedNotes,
    requiredData: normalizedRequiredData,
    steps: normalizedSteps
  };
}
