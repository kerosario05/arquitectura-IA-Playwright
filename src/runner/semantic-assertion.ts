import type { Page } from "@playwright/test";

/**
 * Resolve semantic assertion patterns using DOM signals instead of literal text matching.
 * Universal — no hardcoded apps, HUs, routes, or entities.
 * Returns "passed" if DOM signals confirm the semantic intent,
 * "not_found" if no signal detected,
 * null if the targetLabel is not a recognized semantic pattern (use text matching).
 */
export async function resolveSemanticAssertion(page: Page, targetLabel: string): Promise<"passed" | "not_found" | null> {
  const t = targetLabel.toLowerCase();

  if (/marcad[oa]s?\s+como\s+seleccionad[oa]s?/.test(t)) {
    const count = await page.locator('[aria-checked="true"], [aria-selected="true"], input[type="checkbox"]:checked, input[type="radio"]:checked').count();
    return count > 0 ? "passed" : "not_found";
  }
  if (/requerido|obligatorio/.test(t)) {
    const count = await page.locator('[aria-required="true"], [required], .required, [class*="required"]').count();
    return count > 0 ? "passed" : "not_found";
  }
  if (/no\s+este\s+habilitado|deshabilitado|disabled/.test(t)) {
    const count = await page.locator("button[disabled], [aria-disabled=\"true\"], button.disabled").count();
    return count > 0 ? "passed" : "not_found";
  }
  if (/visible\s+en\s+el\s+listado|al\s+menos\s+un\s+resultado|resultados?\s+visibles?/.test(t)) {
    const count = await page.locator('[role="listitem"], [role="row"], li:visible, tr:visible, .card:visible').count();
    return count > 0 ? "passed" : "not_found";
  }
  if (/confirmacion\s+de\s+seleccion|elementos?\s+seleccionad[oa]s?|seleccion\s+confirmada/i.test(t)) {
    const checked = await page.locator('[aria-checked="true"], [aria-selected="true"], input:checked, .selected, [class*="selected"], [class*="active"]').count();
    if (checked > 0) return "passed";
    const buttonWithCount = await page.locator('button:has-text("(")').count();
    if (buttonWithCount > 0) return "passed";
    return "not_found";
  }
  // Multi-selection: "al menos dos", "dos elementos", "ambos elementos", "multiples elementos"
  if (/al\s+menos\s+dos|dos\s+elementos?\s+seleccionad|multiples\s+elementos?\s+seleccionad|ambos\s+elementos?\s+esten/i.test(t)) {
    const checked = await page.locator('[aria-checked="true"], [aria-selected="true"], input:checked, .selected').count();
    if (checked >= 2) return "passed";
    const counterBtn = await page.locator('button').filter({ hasText: /\([2-9]\d*\)/ }).count();
    if (counterBtn > 0) return "passed";
    return "not_found";
  }
  return null;
}
