import type { DataContext } from "../data/data-context";
import type { ExecutionPlanStep } from "../types/execution-plan.types";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function resolveStepValue(input: { step: ExecutionPlanStep; dataContext: DataContext }): string | undefined {
  const { step, dataContext } = input;

  if (typeof step.value === "string") {
    return step.value;
  }

  if (!step.valueKey) {
    return undefined;
  }

  const exact = dataContext.entries.find((entry) => entry.key === step.valueKey);
  if (exact) {
    return exact.value;
  }

  const normalizedKey = normalize(step.valueKey);
  const normalized = dataContext.entries.find((entry) => normalize(entry.key) === normalizedKey);
  if (normalized) {
    return normalized.value;
  }

  throw new Error(`Missing value for step valueKey '${step.valueKey}'.`);
}
