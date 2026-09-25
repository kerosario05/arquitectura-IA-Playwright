"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseProductConditionTarget = parseProductConditionTarget;
exports.resolveTargetHint = resolveTargetHint;
exports.matchesProductCondition = matchesProductCondition;
exports.resolveProductConditionAgainstSnapshot = resolveProductConditionAgainstSnapshot;
const PRODUCT_TYPE_MAP = {
    "tarjeta_credito": ["tarjeta de credito", "tarjeta de crédito", "tarjeta credito", "tarjeta crédito", "credit card"],
    "tarjeta_debito": ["tarjeta de debito", "tarjeta de débito", "tarjeta debito", "tarjeta débito", "debit card"],
    "cuenta_corriente": ["cuenta corriente", "checking account"],
    "deposito_plazo": ["deposito a plazo", "depósito a plazo", "plazo fijo", "fixed deposit"],
    "prestamo": ["prestamo", "préstamo", "loan"],
    "cuenta_ahorro": ["cuenta de ahorro", "cuenta de ahorros", "savings account"],
    "tarjeta": ["tarjeta", "card"],
    "cuenta": ["cuenta", "account"],
    "producto": ["producto", "product"],
    "ahorro": ["ahorro", "savings"],
    "corriente": ["corriente", "checking"],
    "tc": ["tc"],
    "td": ["td"]
};
const STATUS_KEYWORDS = [
    "activa", "activo", "active", "vigente", "current",
    "bloqueada", "blocked", "cancelada", "cancelled",
    "desembolsado", "desembolsada", "disbursed",
    "pagado", "pagada", "paid", "matured",
    "pendiente", "pending", "en proceso", "processing"
];
const GENERIC_PRODUCT_PATTERNS = [
    { pattern: /^producto\s+(activo|disponible|primer)?$/i, type: "producto", statusFromMatch: true },
    { pattern: /^primer\s+producto\s+(disponible)?$/i, type: "producto", statusFromMatch: true },
    { pattern: /^producto\s+disponible$/i, type: "producto", status: "disponible" }
];
function normalizeText(text) {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function parseProductConditionTarget(target) {
    const normalized = normalizeText(target);
    const trimmed = target.trim();
    for (const gp of GENERIC_PRODUCT_PATTERNS) {
        const match = trimmed.match(gp.pattern);
        if (match) {
            return {
                kind: "product_condition",
                type: gp.type,
                status: gp.statusFromMatch ? (match[1] ? normalizeText(match[1]) : undefined) : gp.status,
                keywords: [trimmed]
            };
        }
    }
    let bestType = null;
    let bestPatternLength = 0;
    let matchedStatus;
    const keywords = [];
    for (const [type, patterns] of Object.entries(PRODUCT_TYPE_MAP)) {
        for (const pattern of patterns) {
            const normalizedPattern = normalizeText(pattern);
            if (normalized.includes(normalizedPattern) && normalizedPattern.length > bestPatternLength) {
                bestType = type;
                bestPatternLength = normalizedPattern.length;
                keywords.length = 0;
                keywords.push(pattern);
            }
        }
    }
    if (!bestType)
        return null;
    for (const status of STATUS_KEYWORDS) {
        if (normalized.includes(normalizeText(status))) {
            matchedStatus = status;
            keywords.push(status);
            break;
        }
    }
    return {
        kind: "product_condition",
        type: bestType,
        status: matchedStatus,
        keywords
    };
}
function resolveTargetHint(target) {
    const condition = parseProductConditionTarget(target);
    if (condition) {
        return {
            kind: "product_condition",
            value: target,
            condition
        };
    }
    return {
        kind: "exact_text",
        value: target
    };
}
function matchesProductCondition(elementText, condition) {
    const normalized = normalizeText(elementText);
    const typePatterns = PRODUCT_TYPE_MAP[condition.type] || [];
    const hasType = typePatterns.some(pattern => normalized.includes(normalizeText(pattern)));
    if (!hasType)
        return false;
    if (condition.status) {
        return normalized.includes(normalizeText(condition.status));
    }
    return true;
}
function resolveProductConditionAgainstSnapshot(snapshot, condition, target) {
    const matches = [];
    const elements = snapshot?.elements || [];
    const typePatterns = PRODUCT_TYPE_MAP[condition.type] || [];
    const normalizedTypePatterns = typePatterns.map(normalizeText);
    const normalizedStatus = condition.status ? normalizeText(condition.status) : undefined;
    const containerRoles = new Set(["listitem", "group", "region", "card", "article", "row"]);
    const containerTags = new Set(["article", "li", "tr", "div"]);
    const clickableRoles = new Set(["button", "link", "checkbox", "radio", "tab", "menuitem"]);
    const clickableTags = new Set(["button", "a", "input", "label"]);
    for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (!el.visible)
            continue;
        const elText = el.text || "";
        const nearbyText = el.nearbyText || "";
        const combinedText = `${elText} ${nearbyText}`.trim();
        const normalizedCombined = normalizeText(combinedText);
        if (!normalizedCombined)
            continue;
        const hasType = normalizedTypePatterns.some(pattern => normalizedCombined.includes(pattern));
        if (!hasType)
            continue;
        const hasStatus = !normalizedStatus || normalizedCombined.includes(normalizedStatus);
        if (!hasStatus)
            continue;
        const isContainer = containerRoles.has(el.role ?? "") || containerTags.has(el.tagName?.toLowerCase() ?? "") || el.type === "card";
        const isClickable = clickableRoles.has(el.role ?? "") || clickableTags.has(el.tagName?.toLowerCase() ?? "") || el.isClickable || el.type === "button" || el.type === "link" || el.type === "checkbox";
        let score = 0.5;
        if (elText && normalizeText(elText).includes(normalizedTypePatterns[0] || ""))
            score += 0.2;
        if (isContainer)
            score += 0.15;
        if (isClickable)
            score += 0.15;
        if (normalizedStatus && normalizedCombined.includes(normalizedStatus))
            score += 0.1;
        score = Math.min(1.0, score);
        matches.push({
            elementIndex: i,
            elementId: el.id,
            text: elText || combinedText,
            normalizedText: normalizedCombined,
            score,
            matchedType: condition.type,
            matchedStatus: condition.status,
            isClickable,
            containerIndex: isContainer ? i : undefined
        });
    }
    if (matches.length === 0) {
        return {
            status: "not_found",
            matches: [],
            selectedIndex: -1,
            diagnostics: {
                target,
                parsedCondition: { type: condition.type, status: condition.status },
                matchedCount: 0,
                selectedIndex: -1,
                resolutionStrategy: "product_condition_no_matches"
            }
        };
    }
    const clickableMatches = matches.filter(m => m.isClickable);
    const selectedMatches = clickableMatches.length > 0 ? clickableMatches : matches;
    selectedMatches.sort((a, b) => b.score - a.score || a.elementIndex - b.elementIndex);
    const selected = selectedMatches[0];
    const selectedTextMasked = selected.text
        .replace(/\*{3,}\d{2,}/g, "****XXX")
        .replace(/\b\d{4,}\b/g, "XXXX");
    const finalText = selectedTextMasked.length > 50 ? selectedTextMasked.substring(0, 47) + "..." : selectedTextMasked;
    return {
        status: selectedMatches.length === 1 ? "resolved" : "multiple",
        matches: selectedMatches,
        selectedIndex: 0,
        diagnostics: {
            target,
            parsedCondition: { type: condition.type, status: condition.status },
            matchedCount: selectedMatches.length,
            selectedIndex: 0,
            resolutionStrategy: "first_visible_matching_product_card",
            selectedTextMasked: finalText
        }
    };
}
