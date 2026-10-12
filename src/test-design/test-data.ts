import type { TestDesignDataField, TestDesignScenario } from "./test-design.types";

/**
 * Test data placeholders.
 *
 * A step that needs a value typed in says so with `{{key}}` instead of an
 * invented value; the scenario's `data` list declares each key with a label and
 * the value the user fills in. Publishing replaces placeholders with their
 * values, except sensitive ones (passwords, PINs, OTPs, card data), which stay
 * as `<Label>` because TestRail and Jira are read by many people.
 */

export const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export const MAX_DATA_FIELDS = 30;
export const MAX_DATA_VALUE_LENGTH = 1000;

const SENSITIVE = /(pass(word)?|contrase|clave|\bpin\b|otp|token|secret|secreto|cvv|cvc|tarjeta|card)/i;

export function isSensitiveName(name: string): boolean {
  return SENSITIVE.test(name);
}

export function keyFromLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function labelFromKey(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** Keys referenced as {{key}} anywhere in the given texts, in order of appearance. */
export function placeholderKeys(texts: string[]): string[] {
  const keys: string[] = [];
  for (const text of texts) {
    for (const match of text.matchAll(PLACEHOLDER)) {
      const key = match[1].toLowerCase();
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

export function scenarioTexts(s: Pick<TestDesignScenario, "preconditions" | "steps" | "expectedResult">): string[] {
  return [s.preconditions, s.expectedResult, ...s.steps.flatMap((step) => [step.action, step.expected])];
}

/**
 * Every placeholder used in the texts gets a field (created from its key when
 * missing), and fields declared without a placeholder are kept: the user may
 * have added a value the steps describe in words.
 */
export function reconcileDataFields(
  fields: TestDesignDataField[],
  texts: string[],
): TestDesignDataField[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const result = [...fields];
  for (const key of placeholderKeys(texts)) {
    if (byKey.has(key)) continue;
    const label = labelFromKey(key);
    const field = { key, label, description: "", value: "", sensitive: isSensitiveName(`${key} ${label}`) };
    byKey.set(key, field);
    result.push(field);
  }
  return result.slice(0, MAX_DATA_FIELDS);
}

export type RenderOptions = {
  /** Publish sensitive values too (off by default). */
  revealSensitive?: boolean;
};

/** Replaces {{key}} with its value; unknown, empty or sensitive values become <Label>. */
export function renderWithData(text: string, data: TestDesignDataField[], options: RenderOptions = {}): string {
  const byKey = new Map(data.map((f) => [f.key, f]));
  return text.replace(PLACEHOLDER, (_whole, rawKey: string) => {
    const field = byKey.get(rawKey.toLowerCase());
    if (!field) return `<${labelFromKey(rawKey)}>`;
    if (!field.value || (field.sensitive && !options.revealSensitive)) return `<${field.label}>`;
    return field.value;
  });
}

/** One line per field, for the published preconditions. */
export function describeTestData(data: TestDesignDataField[], options: RenderOptions = {}): string[] {
  return data.map((f) => {
    if (!f.value) return `- ${f.label}: (por definir)`;
    if (f.sensitive && !options.revealSensitive) return `- ${f.label}: (dato sensible, se entrega por canal seguro)`;
    return `- ${f.label}: ${f.value}`;
  });
}

export function missingDataCount(s: Pick<TestDesignScenario, "data">): number {
  return s.data.filter((f) => !f.value.trim()).length;
}

/** After a regeneration, new scenarios reuse values the user already typed for the same key. */
export function carryOverDataValues(
  previous: TestDesignScenario[],
  fresh: TestDesignScenario[],
): TestDesignScenario[] {
  const known = new Map<string, string>();
  for (const s of previous) {
    for (const f of s.data) if (f.value && !known.has(f.key)) known.set(f.key, f.value);
  }
  if (known.size === 0) return fresh;
  return fresh.map((s) => ({
    ...s,
    data: s.data.map((f) => (f.value || !known.has(f.key) ? f : { ...f, value: known.get(f.key)! })),
  }));
}
