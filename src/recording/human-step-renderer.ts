/** Shared presentation-only materialization for recorded human steps. */
export function quoteHumanValue(value: string): string {
  return JSON.stringify(value);
}

export function renderHumanStepValue(template: string, valueKey: string, value: string): string {
  return template.split(`[${valueKey}]`).join(quoteHumanValue(value));
}
