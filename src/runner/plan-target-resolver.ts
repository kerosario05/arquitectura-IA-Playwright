import type { Locator, Page } from "@playwright/test";
import type { PlanTarget } from "../types/execution-plan.types";

function requireTargetValue(target: PlanTarget, context: string): string {
  const value = target.value ?? target.name;
  if (!value || !value.trim()) {
    throw new Error(`Invalid target for ${context}. Missing value/name.`);
  }
  return value;
}

/** Global control patterns that should never be selected as ordinal items. */
const GLOBAL_CONTROL_PATTERNS = /seleccionar\s+todos?\b|todos?\s+los\s+(?:elementos|productos|items|registros|resultados)|todas\s+las\s+opciones|\d+\s+de\s+\d+\s+seleccionados?/i;

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
    const rawText = requireTargetValue(target, "text");
    // Ordinal selection: exclude global "Seleccionar todos" controls
    if (/seleccionar\s+(?:el|la)\s+primer[oa]?\b/i.test(rawText)) {
      const entity = rawText.replace(/seleccionar\s+(?:el|la)\s+primer[oa]?\s*/i, "").replace(/\s+visible\s+del\s+listado\.?\s*$/i, "").trim();
      if (entity && entity.length > 2) {
        console.log(`[ordinal-selection] resolved entity="${entity}" strategy=text+filter exclusion=global_controls ordinal=first`);
        return page.locator(`[role="listitem"], [role="row"], .card, [class*="item"], [class*="row"], li, tr`)
          .filter({ hasText: entity })
          .filter({ hasNotText: GLOBAL_CONTROL_PATTERNS })
          .first();
      }
    }
    // Second ordinal: exclude the already-selected item and global controls
    if (/seleccionar\s+(?:el|la)\s+segund[oa]?\b/i.test(rawText)) {
      const entity = rawText.replace(/seleccionar\s+(?:el|la)\s+segund[oa]?\s*/i, "").replace(/\s+visible\s+del\s+listado\.?\s*$/i, "").trim();
      if (entity && entity.length > 2) {
        console.log(`[ordinal-selection] resolved entity="${entity}" strategy=text+filter exclusion=global_controls+already_selected ordinal=second`);
        return page.locator(`[role="listitem"], [role="row"], .card, [class*="item"], [class*="row"], li, tr`)
          .filter({ hasText: entity })
          .filter({ hasNotText: GLOBAL_CONTROL_PATTERNS })
          .filter({ hasNot: page.locator('[aria-checked="true"], [aria-selected="true"], input:checked, .selected') })
          .first();
      }
    }
    return page.getByText(rawText, { exact: target.exact });
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
