"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANONICAL_SCENARIO_SCHEMA_VERSION = void 0;
exports.classifyCanonicalAssertionIntents = classifyCanonicalAssertionIntents;
exports.parseCanonicalAssertion = parseCanonicalAssertion;
exports.classifyAssertionPolarity = classifyAssertionPolarity;
exports.resolveCanonicalAssertionPolarity = resolveCanonicalAssertionPolarity;
exports.canonicalRequirementId = canonicalRequirementId;
exports.CANONICAL_SCENARIO_SCHEMA_VERSION = "canonical-scenario-1";
/**
 * Classifies only generic outcome semantics at the canonical boundary. Runtime
 * execution consumes these intents; it must not reinterpret application text.
 */
function classifyCanonicalAssertionIntents(description) {
    const normalized = (description ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized)
        return [];
    const intents = [];
    const validationSignal = /\b(validac|validar|validation|validate|error|invalid|invalido|incompleto|feedback|alerta|mensaje|errormessage)\w*/.test(normalized);
    const transitionSignal = /\b(continuar|continue|avanzar|advance|proceder|proceed|siguiente|next|transicion|transition)\w*/.test(normalized);
    const blockSignal = /\b(no permita|no permitir|no puede|cannot|must not|does not|bloque|impid|prevent|deten|hasta que|until)\w*/.test(normalized);
    if (validationSignal)
        intents.push("validation_present");
    if (transitionSignal && blockSignal)
        intents.push("transition_blocked");
    if (intents.length === 0 && /\b(validar|verificar|comprobar|confirmar|assert|check|validate|verify)\b/.test(normalized)) {
        intents.push("state_assertion");
    }
    return intents;
}
function trimAssertionPunctuation(value) {
    return value.trim().replace(/[.!?]+$/, "").trim();
}
function assertionMarkerIndex(value) {
    const match = value.match(/\b(validar|verificar|comprobar|confirmar|revisar|assert|check|validate|verify)\b/i);
    return match?.index ?? -1;
}
function hasActionBeforeAssertion(value) {
    return /^(?:clic|click|hacer clic|presionar|tocar|seleccionar|escoger|elegir|ingresar|completar|escribir|digitar|navegar|abrir|ir a)\b/i.test(value.trim());
}
function extractQuotedSubject(value) {
    const match = value.match(/["“‘']([^"”’']+)["”’']/);
    return match?.[1]?.trim() || undefined;
}
function splitChildExpectations(value) {
    const parts = value
        .split(/\s+(?:y|e|and)\s+(?=(?:que|no|not|la|el|los|las|un|una|the|a|an)\b)/i)
        .map(trimAssertionPunctuation)
        .filter(Boolean);
    return parts.length > 1 ? parts : [];
}
function inferCanonicalOracleType(value, expectedState) {
    const normalized = `${value} ${expectedState}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    if (/\b(dentro|inside|within)\b/.test(normalized) && /\[[^\]]+\]/.test(normalized)) {
        return "entity_within_container";
    }
    if (/\b(?:segunda|second|nueva?|new|agreg(?:ue|ar|ada|ado)|added)\b.*\b(?:linea|fila|row|registro|record)\b|\b(?:linea|fila|row|registro|record)\b.*\b(?:agreg(?:ue|ar|ada|ado)|added|nueva?|new)\b/.test(normalized)) {
        return "structural_row_count";
    }
    if (/\[[^\]]+\]/.test(expectedState) && /\b(?:nombre|name|fecha|date|valor|value|campo|field)\b/.test(normalized)) {
        return "row_scoped_value";
    }
    return undefined;
}
/**
 * Converts one natural-language assertion step into structured metadata while
 * preserving the original step as the authoritative parent. This deliberately
 * uses generic linguistic markers; it never creates additional scenario steps.
 */
function parseCanonicalAssertion(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text)
        return undefined;
    const marker = assertionMarkerIndex(text);
    if (marker < 0)
        return undefined;
    const prefix = text.slice(0, marker).trim();
    if (hasActionBeforeAssertion(prefix))
        return undefined;
    const assertionText = trimAssertionPunctuation(text.slice(marker));
    const normalized = assertionText
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ");
    const validationSignal = /\b(valid|validation|validar|verificar|error|invalid|invalido|incompleto|feedback|mensaje|alerta)\w*/.test(normalized);
    const transitionSignal = /\b(continuar|continue|avanzar|advance|proceder|proceed|siguiente|next|transicion|transition)\w*/.test(normalized);
    const blockSignal = /\b(no permita|no permitir|no puede|cannot|must not|does not|bloque|impid|prevent|deten|hasta que|until)\w*/.test(normalized);
    const intent = transitionSignal && blockSignal
        ? "transition_blocked"
        : validationSignal
            ? "validation_present"
            : "state_assertion";
    const afterMarker = assertionText
        .replace(/^(?:validar|verificar|comprobar|confirmar|revisar|assert|check|validate|verify)\s*/i, "")
        .replace(/^que\s*,?\s*/i, "")
        .trim();
    const conditionMatch = afterMarker.match(/^(?:mientras|cuando|siempre que|si|until|until)\s+(.+?)(?:,|;|\s+-\s+)/i);
    const condition = conditionMatch?.[1] ? trimAssertionPunctuation(conditionMatch[1]) : undefined;
    const trigger = /\b(?:al salir|al dejar|al abandonar|on blur|when leaving|after leaving)\b/i.test(prefix)
        ? "leave_field"
        : undefined;
    const expectedState = trimAssertionPunctuation(conditionMatch
        ? afterMarker.slice(conditionMatch[0].length)
        : afterMarker);
    const advanceAction = intent === "transition_blocked"
        ? afterMarker.match(/\b(?:la\s+)?(?:acción|accion|action)\s+["“‘']([^"”’']+)["”’']/i)?.[1]?.trim()
        : undefined;
    const childExpectations = splitChildExpectations(expectedState);
    const oracleType = inferCanonicalOracleType(text, expectedState);
    const prerequisite = oracleType === "entity_within_container"
        ? "container_action_completed"
        : oracleType === "structural_row_count"
            ? "row_added"
            : oracleType === "row_scoped_value"
                ? "source_value_resolved"
                : undefined;
    return {
        intent,
        subject: extractQuotedSubject(text),
        ...(trigger ? { trigger } : {}),
        ...(condition ? { condition } : {}),
        ...(expectedState ? { expectedState } : {}),
        ...(advanceAction ? { advanceAction } : {}),
        ...(childExpectations.length > 0 ? { childExpectations } : {}),
        ...(oracleType ? { oracleType } : {}),
        ...(prerequisite ? { prerequisite } : {}),
    };
}
const NEGATIVE_ASSERTION_PATTERNS = [
    /\b(?:ya\s+)?no\b/i,
    /\bdejar(?:se)?\s+de\b/i,
    /\bdesaparec(?:er|e|ido|ida)\b/i,
    /\b(?:ausente|oculto|oculta|hidden|absent)\b/i,
    /\b(?:must|should|does)\s+not\b/i,
];
const POSITIVE_ASSERTION_PATTERNS = [
    /\b(?:se\s+)?muestre\b/i,
    /\b(?:estar|est[ée])\s+(?:visible|activo|activa|presente)\b/i,
    /\b(?:visible|activo|activa|presente|aparece|aparezca)\b/i,
    /\b(?:must|should)\s+(?:be|show|display|exist)\b/i,
];
/**
 * Classifies assertion intent once, at the semantic boundary. Downstream
 * layers must consume this field and never reinterpret natural language.
 */
function classifyAssertionPolarity(expected) {
    const text = typeof expected === "string" ? expected.trim() : "";
    if (!text)
        return { reason: "ambiguous" };
    if (NEGATIVE_ASSERTION_PATTERNS.some((pattern) => pattern.test(text))) {
        return { polarity: "negative", reason: "absence" };
    }
    if (POSITIVE_ASSERTION_PATTERNS.some((pattern) => pattern.test(text))) {
        return { polarity: "positive", reason: "presence" };
    }
    return { reason: "ambiguous" };
}
/**
 * Resolves polarity from structured assertion semantics only. This is the
 * canonical authority; renderers, contracts, and runtime probes must not
 * derive polarity from step order, target text, or observed DOM state.
 */
function resolveCanonicalAssertionPolarity(assertion) {
    if (assertion.intent === "transition_blocked") {
        return { polarity: "negative", reason: "structured_transition" };
    }
    if (assertion.intent === "validation_present") {
        return { polarity: "positive", reason: "structured_presence" };
    }
    const state = assertion.expectedState?.trim();
    if (!state)
        return { reason: "ambiguous" };
    const classified = classifyAssertionPolarity(state);
    if (classified.polarity)
        return classified;
    // A declared state such as disabled/invalid/enabled is a positive assertion
    // about that state, not a negative transition. Unknown state semantics stay
    // unresolved and therefore fail closed.
    if (/\b(disabled|deshabilitad\w*|invalid|invalidad\w*|enabled|habilitad\w*)\b/i.test(state)) {
        return { polarity: "positive", reason: "structured_state" };
    }
    return { reason: "ambiguous" };
}
function canonicalRequirementId(originRef) {
    return `requirement:${originRef}`;
}
