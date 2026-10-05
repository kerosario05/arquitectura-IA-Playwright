import { selectionRuleDescription } from "./dynamic-selection-rule";
/** Shared presentation-only materialization for recorded human steps. */
export function quoteHumanValue(value: string): string {
  return JSON.stringify(value);
}

export function renderHumanStepValue(template: string, valueKey: string, value: string): string {
  const marker = `[${valueKey}]`;
  const description = selectionRuleDescription(value);
  if (description !== value && template.includes(marker)) {
    const selectFieldTemplate = template.match(/^\s*Seleccionar\s+\[[^\]]+\]\s+en\s+["']([^"']+)["']\s*$/i);
    if (selectFieldTemplate) {
      return `Seleccionar ${description} en el campo ${quoteHumanValue(selectFieldTemplate[1])}`;
    }
  }
  return template.split(marker).join(quoteHumanValue(description));
}
