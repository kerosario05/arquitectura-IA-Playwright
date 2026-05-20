import type { Locator, Page } from "@playwright/test";
import type { PlanTarget } from "../types/execution-plan.types";

function requireTargetValue(target: PlanTarget, context: string): string {
  const value = target.value ?? target.name;
  if (!value || !value.trim()) {
    throw new Error(`Invalid target for ${context}. Missing value/name.`);
  }
  return value;
}

export function resolveLocatorFromPlanTarget(page: Page, target: PlanTarget): Locator {
  if (target.strategy === "semantic") {
    throw new Error("semantic target is not executable yet. Enrich or resolve target before execution.");
  }

  if (target.strategy === "registry") {
    throw new Error("registry target is not directly executable in this phase. Resolve registry target before execution.");
  }

  if (target.strategy === "role") {
    if (!target.role || !target.name) {
      throw new Error("role target requires role and name.");
    }
    return page.getByRole(target.role as never, { name: target.name, exact: target.exact });
  }

  if (target.strategy === "text") {
    return page.getByText(requireTargetValue(target, "text"), { exact: target.exact });
  }

  if (target.strategy === "label") {
    return page.getByLabel(requireTargetValue(target, "label"), { exact: target.exact });
  }

  if (target.strategy === "placeholder") {
    return page.getByPlaceholder(requireTargetValue(target, "placeholder"), { exact: target.exact });
  }

  if (target.strategy === "testId") {
    return page.getByTestId(requireTargetValue(target, "testId"));
  }

  if (target.strategy === "css") {
    return page.locator(requireTargetValue(target, "css"));
  }

  if (target.strategy === "xpath") {
    const value = requireTargetValue(target, "xpath");
    return value.startsWith("xpath=") ? page.locator(value) : page.locator(`xpath=${value}`);
  }

  throw new Error(`Unsupported target strategy: ${String((target as { strategy?: string }).strategy)}`);
}
