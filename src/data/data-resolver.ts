import type { DataContext, DataContextEntry } from "./data-context";
import type { MissingInputBehavior, TestDataAliasesMap } from "../types/env.types";
import type { FieldRequirement, TestDataResolutionResult } from "../types/test-data.types";

const semanticHints: Array<{ hints: string[]; keys: string[] }> = [
  { hints: ["usuario", "user", "username", "email login"], keys: ["APP_USERNAME", "username", "user", "email"] },
  { hints: ["password", "contrasena", "contraseña", "clave"], keys: ["APP_PASSWORD", "password", "pass", "clave"] },
  { hints: ["cedula", "cédula", "documento", "identificacion", "identificación", "id"], keys: ["cedula", "documento", "identificacion", "id"] },
  { hints: ["codigo", "código", "otp", "pin", "token"], keys: ["codigo", "codigo6", "otp", "pin", "token", "numero2"] },
  { hints: ["telefono", "teléfono", "celular", "mobile", "phone"], keys: ["telefono", "celular", "phone"] },
  { hints: ["monto", "importe", "amount", "valor"], keys: ["monto", "importe", "amount", "valor"] },
  { hints: ["correo", "email", "mail"], keys: ["email", "correo"] },
  { hints: ["cuenta", "account"], keys: ["cuenta", "account", "cuentaOrigen", "cuentaDestino"] },
  { hints: ["prestamo", "préstamo", "loan"], keys: ["prestamo", "numeroPrestamo", "loanNumber"] },
  { hints: ["cliente", "customer"], keys: ["cliente", "customerId", "numeroCliente"] }
];

const genericFieldHints = ["numero", "número", "valor", "referencia"];

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asResolved(
  entry: DataContextEntry,
  matchedBy: "exact_key" | "alias" | "field_name" | "label" | "placeholder" | "semantic_hint" | "data_context",
  confidence: number
): TestDataResolutionResult {
  return {
    status: "resolved",
    key: entry.key,
    value: String(entry.value),
    sensitive: entry.sensitive,
    confidence,
    matchedBy
  };
}

function findByExactKey(dataContext: DataContext, token: string): DataContextEntry | undefined {
  const normalized = normalizeText(token);
  return dataContext.entries.find((entry) => normalizeText(entry.key) === normalized);
}

function findByContains(dataContext: DataContext, text: string): DataContextEntry | undefined {
  const normalizedText = normalizeText(text);
  return dataContext.entries.find((entry) => normalizedText.includes(normalizeText(entry.key)));
}

function buildAliasPairs(aliases: TestDataAliasesMap): Array<{ key: string; alias: string }> {
  const result: Array<{ key: string; alias: string }> = [];
  for (const [key, values] of Object.entries(aliases)) {
    for (const value of values) {
      result.push({ key, alias: value });
    }
  }
  return result;
}

function findByAlias(dataContext: DataContext, aliases: TestDataAliasesMap, text: string): DataContextEntry | undefined {
  const normalizedText = normalizeText(text);
  const aliasPairs = buildAliasPairs(aliases);
  const hit = aliasPairs.find((pair) => normalizeText(pair.alias) === normalizedText || normalizedText.includes(normalizeText(pair.alias)));
  if (!hit) {
    return undefined;
  }
  return findByExactKey(dataContext, hit.key);
}

function findBySemanticHint(dataContext: DataContext, text: string): DataContextEntry | undefined {
  const normalizedText = normalizeText(text);

  for (const semantic of semanticHints) {
    if (semantic.hints.some((hint) => normalizedText.includes(normalizeText(hint)))) {
      for (const key of semantic.keys) {
        const byKey = findByExactKey(dataContext, key);
        if (byKey) {
          return byKey;
        }
      }
    }
  }

  return undefined;
}

export function suggestVariableNamesForField(field: FieldRequirement): string[] {
  const text = normalizeText(
    [field.fieldName, field.label, field.placeholder, field.ariaLabel, field.nearbyText, field.inputType]
      .filter(Boolean)
      .join(" ")
  );

  if (!text) {
    return ["APP_TEST_DATA_JSON"];
  }

  if (text.includes("prestamo") || text.includes("loan")) {
    return ["numeroPrestamo", "prestamo", "loanNumber"];
  }
  if (text.includes("cedula") || text.includes("documento") || text.includes("identificacion") || text.includes("id")) {
    return ["cedula", "documento", "identificacion"];
  }
  if (text.includes("codigo") || text.includes("otp") || text.includes("pin") || text.includes("token")) {
    return ["codigo", "codigo6", "otp", "pin", "token", "numero2"];
  }
  if (text.includes("telefono") || text.includes("celular") || text.includes("phone")) {
    return ["telefono", "celular", "phone"];
  }

  const compact = text.replace(/\s+/g, "");
  return compact ? [compact] : ["APP_TEST_DATA_JSON"];
}

function missingResult(field: FieldRequirement, behavior: MissingInputBehavior): TestDataResolutionResult {
  const suggestedVariableNames = suggestVariableNamesForField(field);
  if (behavior === "skip") {
    return {
      status: "skipped",
      field,
      reason: "Input not found in DataContext and behavior is skip."
    };
  }

  const message =
    behavior === "prompt"
      ? "Input not found in DataContext. User intervention is required (prompt mode)."
      : "Input not found in DataContext and behavior is fail.";

  return {
    status: "missing_input",
    field,
    suggestedVariableNames,
    message
  };
}

export function resolveDataForField(
  field: FieldRequirement,
  dataContext: DataContext,
  aliases: TestDataAliasesMap,
  behavior: MissingInputBehavior
): TestDataResolutionResult {
  const clues = [field.fieldName, field.label, field.placeholder, field.ariaLabel, field.nearbyText, field.inputType].filter(
    (value): value is string => Boolean(value && value.trim())
  );

  for (const clue of clues) {
    const exact = findByExactKey(dataContext, clue);
    if (exact) {
      return asResolved(exact, "exact_key", 1.0);
    }
  }

  for (const clue of clues) {
    const byAlias = findByAlias(dataContext, aliases, clue);
    if (byAlias) {
      return asResolved(byAlias, "alias", 0.9);
    }
  }

  if (field.fieldName) {
    const fromFieldName = findByContains(dataContext, field.fieldName) ?? findByAlias(dataContext, aliases, field.fieldName);
    if (fromFieldName) {
      return asResolved(fromFieldName, "field_name", 0.85);
    }
  }

  if (field.label) {
    const fromLabel = findByContains(dataContext, field.label) ?? findByAlias(dataContext, aliases, field.label);
    if (fromLabel) {
      return asResolved(fromLabel, "label", 0.8);
    }
  }

  if (field.placeholder) {
    const fromPlaceholder =
      findByContains(dataContext, field.placeholder) ?? findByAlias(dataContext, aliases, field.placeholder);
    if (fromPlaceholder) {
      return asResolved(fromPlaceholder, "placeholder", 0.75);
    }
  }

  for (const clue of clues) {
    const semantic = findBySemanticHint(dataContext, clue);
    if (semantic) {
      return asResolved(semantic, "semantic_hint", 0.65);
    }
  }

  const allText = normalizeText(clues.join(" "));
  if (genericFieldHints.some((hint) => allText.includes(normalizeText(hint)))) {
    const nonSensitive = dataContext.entries.filter((entry) => !entry.sensitive);
    if (nonSensitive.length === 1) {
      return asResolved(nonSensitive[0], "data_context", 0.45);
    }
  }

  return missingResult(field, behavior);
}
