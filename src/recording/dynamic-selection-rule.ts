/** Explicit QA data, transported through the existing string dataset binding.
 * Terms describe live option text, never a recorded option key or balance.
 */
export const SELECTION_RULE_PREFIX = "@selection-rule/v1:";
export type DynamicSelectionRule = { terms: string[]; matchIndex: number };

export function isSelectionRuleValue(value: string | undefined): boolean {
  return Boolean(value?.startsWith("@selection-rule/"));
}

export function parseSelectionRule(value: string | undefined): DynamicSelectionRule | undefined {
  if (!value?.startsWith(SELECTION_RULE_PREFIX)) return undefined;
  try {
    const rule = JSON.parse(value.slice(SELECTION_RULE_PREFIX.length));
    if (!Array.isArray(rule.terms) || rule.terms.length < 1 || rule.terms.length > 8
      || !rule.terms.every((term: unknown) => typeof term === "string" && term.trim().length > 0 && term.length <= 120)
      || !Number.isSafeInteger(rule.matchIndex) || rule.matchIndex < 0) return undefined;
    return { terms: rule.terms.map((term: string) => term.trim()), matchIndex: rule.matchIndex };
  } catch { return undefined; }
}

export function encodeSelectionRule(rule: DynamicSelectionRule): string {
  const value = SELECTION_RULE_PREFIX + JSON.stringify(rule);
  if (!parseSelectionRule(value)) throw new Error("invalid_dynamic_selection_rule");
  return value;
}

const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();

export function matchingSelectionOptions<T extends { label: string; value: string; disabled?: boolean }>(options: T[], rule: DynamicSelectionRule): T[] {
  return options.filter(option => option.value && !option.disabled
    && rule.terms.every(term => normalize(option.label).includes(normalize(term))));
}

export function selectionRuleDescription(value: string): string {
  const rule = parseSelectionRule(value);
  // Keep the display grammar parseable by Discovery. Quoting arbitrary terms here
  // embeds quotes inside the step's quoted placeholder and used to turn the whole
  // description into a locator target.
  const terms = rule?.terms.map(term => term.replace(/[\r\n"'“”‘’]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  return rule && terms?.length
    ? `opción que contiene ${terms.join(" y ")} (coincidencia ${rule.matchIndex + 1})`
    : value;
}
