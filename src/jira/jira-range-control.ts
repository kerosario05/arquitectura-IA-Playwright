import type { Locator } from "@playwright/test";

export function parseJiraNumericValue(input: string): number | undefined {
  const token = input.trim().replace(/\b(?:RD|US|[A-Z]{3})\b/gi, "").replace(/[$€£¥]/gu, "").trim();
  if (!/^[+-]?\d[\d.,]*$/.test(token)) return undefined;
  let normalized = token;
  const comma = token.lastIndexOf(",");
  const dot = token.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? "," : ".";
    const groupingSeparator = decimalSeparator === "," ? "." : ",";
    normalized = token.split(groupingSeparator).join("").replace(decimalSeparator, ".");
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? "," : ".";
    const tail = token.length - token.lastIndexOf(separator) - 1;
    normalized = tail === 3 ? token.split(separator).join("") : token.replace(separator, ".");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
}

export function jiraNumericValueMatches(actual: string, expected: string): boolean {
  const expectedValue = parseJiraNumericValue(expected);
  return expectedValue !== undefined && parseJiraNumericValue(actual) === expectedValue;
}

export function jiraRangeMetadataAssertionMatches(
  observed: { min?: string; max?: string; step?: string },
  expected: string,
): boolean {
  const numbers = expected.match(/[+-]?\d[\d.,]*/g)?.map(parseJiraNumericValue).filter((value): value is number => value !== undefined) ?? [];
  if (numbers.length === 1 && /\b(?:incrementos?|intervalos?|steps?)\b/i.test(expected)) {
    return parseJiraNumericValue(observed.step ?? "") === numbers[0];
  }
  if (numbers.length === 2 && /\b(?:a|hasta|to|through|entre|between)\b/i.test(expected)) {
    return parseJiraNumericValue(observed.min ?? "") === numbers[0]
      && parseJiraNumericValue(observed.max ?? "") === numbers[1];
  }
  return false;
}

export function isJiraRangeMetadataAssertion(expected: string): boolean {
  const numbers = expected.match(/[+-]?\d[\d.,]*/g) ?? [];
  return (numbers.length === 1 && /\b(?:incrementos?|intervalos?|steps?)\b/i.test(expected))
    || (numbers.length === 2 && /\b(?:a|hasta|to|through|entre|between)\b/i.test(expected));
}

/** Set a native range control from a numeric or formatted numeric value and verify its DOM value. */
export async function setJiraRangeControlValue(locator: Locator, requestedValue: string): Promise<void> {
  const range = await locator.evaluate(element => {
    if (!(element instanceof HTMLInputElement) || element.type !== "range") return undefined;
    return {
      min: element.min === "" ? 0 : Number(element.min),
      max: element.max === "" ? 100 : Number(element.max),
      step: element.step === "any" ? undefined : Number(element.step || 1),
    };
  });
  if (!range) throw new Error("JIRA_RANGE_CONTROL_UNSUPPORTED");
  const value = parseJiraNumericValue(requestedValue);
  if (value === undefined || !Number.isFinite(range.min) || !Number.isFinite(range.max)
    || value < range.min || value > range.max) throw new Error("JIRA_RANGE_VALUE_INVALID");
  if (range.step !== undefined) {
    const step = range.step;
    if (!Number.isFinite(step) || step <= 0) throw new Error("JIRA_RANGE_CONTROL_UNSUPPORTED");
    const stepPosition = (value - range.min) / step;
    if (Math.abs(stepPosition - Math.round(stepPosition)) > 1e-7) throw new Error("JIRA_RANGE_VALUE_INVALID");
  }
  const expected = String(value);
  await locator.evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement) || element.type !== "range") throw new Error("JIRA_RANGE_CONTROL_UNSUPPORTED");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("JIRA_RANGE_CONTROL_UNSUPPORTED");
    setter.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, expected);
  if (await locator.inputValue() !== expected) throw new Error("JIRA_RANGE_VALUE_NOT_CONFIRMED");
}
