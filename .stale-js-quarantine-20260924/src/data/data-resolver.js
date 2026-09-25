"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeText = normalizeText;
exports.suggestVariableNamesForField = suggestVariableNamesForField;
exports.resolveDataForField = resolveDataForField;
const semanticHints = [
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
function normalizeText(value) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s_]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function asResolved(entry, matchedBy, confidence) {
    return {
        status: "resolved",
        key: entry.key,
        value: String(entry.value),
        sensitive: entry.sensitive,
        confidence,
        matchedBy
    };
}
function findByExactKey(dataContext, token) {
    const normalized = normalizeText(token);
    return dataContext.entries.find((entry) => normalizeText(entry.key) === normalized);
}
function findByContains(dataContext, text) {
    const normalizedText = normalizeText(text);
    return dataContext.entries.find((entry) => normalizedText.includes(normalizeText(entry.key)));
}
function buildAliasPairs(aliases) {
    const result = [];
    for (const [key, values] of Object.entries(aliases)) {
        for (const value of values) {
            result.push({ key, alias: value });
        }
    }
    return result;
}
function findByAlias(dataContext, aliases, text) {
    const normalizedText = normalizeText(text);
    const aliasPairs = buildAliasPairs(aliases);
    const hit = aliasPairs.find((pair) => normalizeText(pair.alias) === normalizedText || normalizedText.includes(normalizeText(pair.alias)));
    if (!hit) {
        return undefined;
    }
    return findByExactKey(dataContext, hit.key);
}
function findBySemanticHint(dataContext, text) {
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
function suggestVariableNamesForField(field) {
    const text = normalizeText([field.fieldName, field.label, field.placeholder, field.ariaLabel, field.nearbyText, field.inputType]
        .filter(Boolean)
        .join(" "));
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
function missingResult(field, behavior) {
    const suggestedVariableNames = suggestVariableNamesForField(field);
    if (behavior === "skip") {
        return {
            status: "skipped",
            field,
            reason: "Input not found in DataContext and behavior is skip."
        };
    }
    const message = behavior === "prompt"
        ? "Input not found in DataContext. User intervention is required (prompt mode)."
        : "Input not found in DataContext and behavior is fail.";
    return {
        status: "missing_input",
        field,
        suggestedVariableNames,
        message
    };
}
function resolveDataForField(field, dataContext, aliases, behavior) {
    const clues = [field.fieldName, field.label, field.placeholder, field.ariaLabel, field.nearbyText, field.inputType].filter((value) => Boolean(value && value.trim()));
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
        const fromPlaceholder = findByContains(dataContext, field.placeholder) ?? findByAlias(dataContext, aliases, field.placeholder);
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
