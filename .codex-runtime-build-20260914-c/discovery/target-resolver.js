"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeText = normalizeText;
exports.buildFlexibleTextRegex = buildFlexibleTextRegex;
exports.buildFlexibleTokenRegex = buildFlexibleTokenRegex;
exports.computeTokenScore = computeTokenScore;
exports.normalizeSemanticText = normalizeSemanticText;
exports.tokenizeWithStopwords = tokenizeWithStopwords;
exports.expandSemanticTokens = expandSemanticTokens;
exports.computeSemanticScore = computeSemanticScore;
exports.isElementClickable = isElementClickable;
exports.buildSnapshotCandidates = buildSnapshotCandidates;
exports.deduplicateCandidates = deduplicateCandidates;
exports.captureGridCollectionSnapshot = captureGridCollectionSnapshot;
exports.compareGridCollection = compareGridCollection;
exports.resolveGridEditor = resolveGridEditor;
exports.resolveActionTarget = resolveActionTarget;
exports.shouldInvokeAiAssistedDiscovery = shouldInvokeAiAssistedDiscovery;
exports.resolveSnapshotElementLocator = resolveSnapshotElementLocator;
exports.findTargetByText = findTargetByText;
exports.clickResolvedTarget = clickResolvedTarget;
exports.disambiguateStructuredTargetCandidates = disambiguateStructuredTargetCandidates;
exports.resolveFillTarget = resolveFillTarget;
exports.validateFillResolutionContract = validateFillResolutionContract;
exports.resolveAssociatedActionTarget = resolveAssociatedActionTarget;
exports.normalizeSemanticCandidates = normalizeSemanticCandidates;
exports.resolveSemanticActionTarget = resolveSemanticActionTarget;
const fs_1 = require("fs");
const path_1 = require("path");
const product_condition_parser_1 = require("./product-condition-parser");
const ordinal_selection_resolver_1 = require("./ordinal-selection-resolver");
const contextual_intermediate_resolver_1 = require("./contextual-intermediate-resolver");
const target_alias_resolver_1 = require("./target-alias-resolver");
let evaluateCodeCache;
function readEvaluateCode() {
    if (evaluateCodeCache)
        return evaluateCodeCache;
    evaluateCodeCache = (0, fs_1.readFileSync)((0, path_1.join)(__dirname, "semantic-evaluate.js"), "utf8");
    return evaluateCodeCache;
}
const DEFAULT_OPTIONS = {
    minConfidence: 0.4,
    ambiguousThreshold: 0.15,
    semanticRole: "unknown",
    relationContext: "",
    activeContainer: undefined
};
function extractTextValue(value) {
    if (typeof value === "string")
        return value;
    if (value == null)
        return "";
    if (Array.isArray(value))
        return value.map((item) => extractTextValue(item)).filter(Boolean).join(" ");
    if (typeof value === "object") {
        const obj = value;
        return [
            extractTextValue(obj.text),
            extractTextValue(obj.label),
            extractTextValue(obj.name),
            extractTextValue(obj.value),
            extractTextValue(obj.title)
        ].filter(Boolean).join(" ").trim();
    }
    return String(value);
}
function normalizeText(text) {
    return extractTextValue(text)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function sanitizeRegexPattern(pattern) {
    return pattern
        .replace(/\\s\+\*/g, "\\s+")
        .replace(/\\s\*\+/g, "\\s*")
        .replace(/\\s\+\+/g, "\\s+")
        .replace(/\\s\*\*/g, "\\s*")
        .replace(/(\.\*|\.\+|\.\?)([+*?]+)/g, "$1")
        .replace(/([+*?]){2,}/g, "$1");
}
function createSafeRegExp(pattern, flags = "i") {
    const sanitized = sanitizeRegexPattern(pattern);
    try {
        return new RegExp(sanitized, flags);
    }
    catch {
        const literal = escapeRegex(normalizeText(pattern));
        return new RegExp(literal || ".^", flags);
    }
}
function toAccentInsensitivePattern(text) {
    const accentMap = {
        a: "[aàáâãäå]",
        e: "[eèéêë]",
        i: "[iìíîï]",
        o: "[oòóôõö]",
        u: "[uùúûü]",
        n: "[nñ]",
        c: "[cç]"
    };
    return Array.from(text).map((char) => {
        if (/\s/.test(char)) {
            return "\\s*";
        }
        const normalized = char.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (accentMap[normalized]) {
            return accentMap[normalized];
        }
        return escapeRegex(char);
    }).join("");
}
function buildFlexibleTextRegex(text) {
    const trimmed = extractTextValue(text).trim();
    if (!trimmed) {
        return /.^/i;
    }
    return createSafeRegExp(toAccentInsensitivePattern(trimmed), "i");
}
function buildFlexibleTokenRegex(text) {
    const normalized = normalizeText(text);
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
        return /.^/i;
    }
    const pattern = tokens
        .map((token) => toAccentInsensitivePattern(token))
        .join(".*");
    return createSafeRegExp(pattern, "i");
}
function computeTokenScore(target, candidate) {
    const normalizedTarget = normalizeText(target);
    const normalizedCandidate = normalizeText(candidate);
    if (!normalizedTarget || !normalizedCandidate)
        return 0;
    if (normalizedCandidate === normalizedTarget)
        return 1.0;
    if (normalizedCandidate.includes(normalizedTarget)) {
        const ratio = normalizedTarget.length / normalizedCandidate.length;
        return 0.7 + 0.3 * ratio;
    }
    if (normalizedTarget.includes(normalizedCandidate)) {
        const ratio = normalizedCandidate.length / normalizedTarget.length;
        if (normalizedCandidate.length < 6 || ratio < 0.25)
            return 0;
        return 0.5 + 0.3 * ratio;
    }
    const targetTokens = normalizedTarget.split(/\s+/).filter(Boolean);
    const candidateTokens = normalizedCandidate.split(/\s+/).filter(Boolean);
    if (targetTokens.length === 0)
        return 0;
    let matchedTokens = 0;
    for (const token of targetTokens) {
        for (const cToken of candidateTokens) {
            if (cToken.includes(token) || token.includes(cToken)) {
                matchedTokens++;
                break;
            }
        }
    }
    return (matchedTokens / targetTokens.length) * 0.6;
}
const STOPWORDS = new Set([
    "el", "la", "los", "las", "de", "del", "a", "al", "en", "un", "una", "unos", "unas",
    "y", "e", "o", "u", "pero", "que", "con", "por", "para", "se", "no", "su", "le", "lo",
    "the", "a", "an", "of", "to", "in", "on", "at", "by", "for", "with", "from", "is", "it",
    "and", "or", "but", "as", "be", "are", "was", "were", "this", "that", "has", "have"
]);
const SEMANTIC_GROUPS = {
    cart: ["carrito", "carro", "cesta", "bolsa", "compras", "shopping", "cart", "basket", "bag", "canasta", "bolso"],
    menu: ["menu", "menú", "hamburger", "navigation", "nav", "navegacion", "navegación"],
    profile: ["perfil", "cuenta", "usuario", "account", "user", "avatar", "profile", "miembro"],
    settings: ["configuracion", "configuración", "ajustes", "settings", "preferences", "preferencias", "opciones"],
    notifications: ["notificaciones", "notifications", "notificacion", "notification", "alerts", "alertas", "bell", "campana", "campanita", "timbre"],
    search: ["buscar", "busqueda", "búsqueda", "search", "magnifier", "lupa", "find", "explorar"],
    home: ["inicio", "home", "dashboard", "principal", "inicio"],
    logout: ["salir", "cerrar", "sesion", "logout", "signout", "sign out", "log out", "desconectar", "cerrar sesion"],
    login: ["iniciar", "login", "signin", "sign in", "log in", "acceder", "ingresar", "entrar"],
    help: ["ayuda", "help", "soporte", "support", "faq", "preguntas"],
    close: ["cerrar", "close", "dismiss", "descartar", "x"],
    back: ["volver", "atras", "atrás", "back", "regresar", "retroceder", "anterior"],
    add: ["agregar", "añadir", "add", "nuevo", "new", "crear", "create", "nuevo"],
    delete: ["eliminar", "borrar", "delete", "remove", "remover", "quitar", "suprimir"],
    edit: ["editar", "edit", "modificar", "modify", "actualizar", "update", "cambiar"],
};
const SUBMIT_LIKE_PATTERNS = [
    "log in", "login", "iniciar sesión", "acceder", "entrar",
    "continue", "continuar", "submit", "enviar", "confirmar",
    "aceptar", "purchase", "comprar", "finalizar", "checkout",
    "place order", "pagar", "pay", "next", "siguiente"
];
function isSubmitLikeTarget(target) {
    const normalized = normalizeText(target);
    return SUBMIT_LIKE_PATTERNS.some(pattern => normalized === pattern ||
        normalized.includes(pattern) ||
        pattern.includes(normalized));
}
function normalizeSemanticText(text) {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[-_/]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function tokenizeWithStopwords(text) {
    const normalized = normalizeSemanticText(text);
    return normalized.split(/\s+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}
function expandSemanticTokens(tokens) {
    const expanded = new Set();
    const matchedGroups = new Set();
    for (const token of tokens) {
        expanded.add(token);
        for (const [group, synonyms] of Object.entries(SEMANTIC_GROUPS)) {
            if (synonyms.includes(token)) {
                matchedGroups.add(group);
                for (const syn of synonyms) {
                    expanded.add(syn);
                }
            }
        }
    }
    return { tokens: Array.from(expanded), groups: Array.from(matchedGroups) };
}
function computeSemanticScore(target, signals) {
    const targetTokens = tokenizeWithStopwords(target);
    if (targetTokens.length === 0) {
        return { score: 0, matchedSignal: "none", signalValue: "" };
    }
    const { tokens: expandedTokens, groups: matchedGroups } = expandSemanticTokens(targetTokens);
    const allTargetTokens = new Set(expandedTokens);
    let bestScore = 0;
    let bestSignal = "none";
    let bestValue = "";
    let bestGroup;
    const signalEntries = [
        { key: "text", value: signals.text, weight: 1.0 },
        { key: "aria-label", value: signals.ariaLabel, weight: 1.0 },
        { key: "title", value: signals.title, weight: 0.9 },
        { key: "alt", value: signals.alt, weight: 0.8 },
        { key: "href", value: signals.href, weight: 0.9 },
        { key: "data-testid", value: signals.dataTestid, weight: 0.9 },
        { key: "class", value: signals.className, weight: 0.7 },
        { key: "id", value: signals.id, weight: 0.7 },
        { key: "name", value: signals.name, weight: 0.8 },
    ];
    for (const { key, value, weight } of signalEntries) {
        if (!value)
            continue;
        const normalized = normalizeSemanticText(value);
        // Split the signal into tokens
        const signalTokens = normalized.split(/\s+/).filter((t) => t.length > 1);
        // Check each signal token against expanded target tokens
        let matchedCount = 0;
        for (const st of signalTokens) {
            if (allTargetTokens.has(st)) {
                matchedCount++;
            }
            else {
                // Check partial matches (e.g., "cart" in "shopping_cart_link")
                for (const tt of allTargetTokens) {
                    if (st.includes(tt) || tt.includes(st)) {
                        matchedCount += 0.5;
                        break;
                    }
                }
            }
        }
        if (signalTokens.length > 0) {
            let score = (matchedCount / Math.max(signalTokens.length, targetTokens.length)) * weight;
            // Bonus for exact signal token match to target
            if (signalTokens.some((st) => allTargetTokens.has(st))) {
                score += 0.2 * weight;
            }
            // Bonus and group detection for semantic group matches in any signal
            if (matchedGroups.length > 0) {
                const hasGroupToken = signalTokens.some((st) => {
                    for (const group of matchedGroups) {
                        const groupSynonyms = SEMANTIC_GROUPS[group];
                        if (groupSynonyms.includes(st))
                            return true;
                    }
                    return false;
                });
                if (hasGroupToken) {
                    score += 0.3 * weight;
                    bestGroup = matchedGroups.find((g) => signalTokens.some((st) => SEMANTIC_GROUPS[g].includes(st)));
                }
            }
            // Bonus for href path matching semantic concepts
            if (key === "href" && matchedGroups.length > 0) {
                const pathParts = value.toLowerCase().split(/[/?#]/).filter(Boolean);
                const hasPathMatch = pathParts.some((part) => allTargetTokens.has(part));
                if (hasPathMatch) {
                    score += 0.3 * weight;
                }
            }
            if (score > bestScore) {
                bestScore = Math.min(score, 1.0);
                bestSignal = key;
                bestValue = value;
            }
        }
    }
    // If no signal matched but target has semantic groups, try text match as fallback
    if (bestScore === 0 && signals.text) {
        const textScore = computeTokenScore(target, signals.text);
        if (textScore > 0.3) {
            bestScore = textScore * 0.7;
            bestSignal = "text";
            bestValue = signals.text;
        }
    }
    return { score: bestScore, matchedSignal: bestSignal, signalValue: bestValue, semanticGroup: bestGroup };
}
const CLICKABLE_ROLES = new Set(["button", "link", "menuitem", "tab", "treeitem", "option"]);
const CLICKABLE_TAGS = new Set(["button", "a", "input", "select", "textarea"]);
function isElementClickable(el) {
    if (CLICKABLE_ROLES.has(el.role ?? ""))
        return true;
    if (CLICKABLE_TAGS.has(el.tagName?.toLowerCase() ?? ""))
        return true;
    if (el.type === "button" || el.type === "link")
        return true;
    if (el.type === "input" && (el.inputType === "submit" || el.inputType === "button"))
        return true;
    return false;
}
function buildSnapshotCandidates(snapshot, target) {
    const normalizedTarget = normalizeText(target);
    const candidates = [];
    for (const el of snapshot.elements) {
        const texts = [el.text, el.label, el.name, el.placeholder].filter(Boolean);
        for (const text of texts) {
            const score = computeTokenScore(target, text);
            if (score > 0) {
                const isClickable = isElementClickable(el);
                const clickableBonus = isClickable ? 0.15 : 0;
                let matchReason = "token_match";
                const normalizedText = normalizeText(text);
                if (normalizedText === normalizedTarget) {
                    matchReason = "exact_match";
                }
                else if (normalizedText.includes(normalizedTarget)) {
                    matchReason = "contains_match";
                }
                else if (normalizedTarget.includes(normalizedText)) {
                    matchReason = "contained_by_match";
                }
                let locatorStrategy = "text";
                if (el.role && CLICKABLE_ROLES.has(el.role)) {
                    locatorStrategy = `role:${el.role}`;
                }
                else if (el.tagName && CLICKABLE_TAGS.has(el.tagName.toLowerCase())) {
                    locatorStrategy = `tag:${el.tagName}`;
                }
                else if (el.candidateLocators.length > 0) {
                    locatorStrategy = el.candidateLocators[0].strategy;
                }
                candidates.push({
                    elementId: el.id,
                    text,
                    normalizedText,
                    type: el.type,
                    role: el.role,
                    tagName: el.tagName,
                    isClickable,
                    matchScore: Math.min(1, score + clickableBonus),
                    matchReason,
                    locatorStrategy,
                    href: el.href,
                    ariaLabel: el.ariaLabel,
                    title: el.title,
                    alt: el.alt,
                    dataTestid: el.dataTestid,
                    className: el.className,
                    matchedSignal: "text"
                });
            }
        }
        // Semantic attributes are checked by resolveSemanticActionTarget (DOM-based) as fallback
    }
    return candidates;
}
function deduplicateCandidates(candidates) {
    const seen = new Map();
    for (const c of candidates) {
        const key = `${c.elementId ?? ""}|${c.normalizedText}`;
        if (!seen.has(key) || seen.get(key).matchScore < c.matchScore) {
            seen.set(key, c);
        }
    }
    return Array.from(seen.values()).sort((a, b) => b.matchScore - a.matchScore);
}
function normalizeRouteTerms(routeProfile) {
    return [
        ...(routeProfile?.domainTerms || []),
        ...(routeProfile?.entryPoints || []),
        ...Object.values(routeProfile?.aliases || {}).flatMap((term) => Array.isArray(term) ? term : [term])
    ].filter((term) => typeof term === "string").map((term) => normalizeText(term)).filter(Boolean);
}
function shouldTryContextualOptionResolution(target, opts) {
    const normalized = normalizeText(target);
    if (!normalized)
        return false;
    const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
    const hasOptionKeywords = /\b(opcion|opción|tipo|subtipo|producto|cuenta|moneda|beneficiario|registro|fila|card|lista|listado)\b/i.test(normalized);
    const hasSelectionKeywords = /\b(selecciona|seleccionar|elige|escoge|clic en|click en|pulsa|toca|ver)\b/i.test(normalized);
    const routeTerms = normalizeRouteTerms(opts.routeProfile);
    const routeTermMatch = routeTerms.some((term) => term && (normalized.includes(term) || term.includes(normalized)));
    return tokenCount <= 6 || hasOptionKeywords || hasSelectionKeywords || routeTermMatch;
}
async function attemptContextualOptionResolution(page, snapshot, target, opts) {
    if (!shouldTryContextualOptionResolution(target, opts)) {
        return undefined;
    }
    const contextualInput = {
        target,
        previousTarget: opts.previousTarget || opts.relationContext,
        nextTarget: opts.nextTarget,
        routeHistory: opts.routeHistory,
        routeProfile: opts.routeProfile,
        candidates: snapshot.elements.filter((el) => el.visible).slice(0, 30)
    };
    const contextualResult = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(contextualInput);
    const selectedCandidate = contextualResult.selectedCandidate;
    const selectedCandidateText = contextualResult.selectedCandidateText || "";
    if (contextualResult.status === "resolved" && selectedCandidate) {
        console.log(`[target-resolver] contextual_option_resolver resolved target="${target}" selected="${selectedCandidateText}" reason="${contextualResult.reason}"`);
        const resolved = await resolveSnapshotElementLocator(page, {
            element: selectedCandidate,
            target,
            candidateText: selectedCandidateText,
            type: contextualResult.classifiedCandidates.find((c) => c.element === selectedCandidate)?.type || "button",
            tagName: selectedCandidate.tagName,
            confidence: contextualResult.classifiedCandidates.find((c) => c.element === selectedCandidate)?.score || 0.7,
            matchReason: `contextual_option:${contextualResult.reason}`
        });
        if (resolved.locator) {
            return {
                status: "resolved",
                target,
                locator: resolved.locator,
                locatorStrategy: "contextual_option",
                confidence: contextualResult.classifiedCandidates.find((c) => c.element === selectedCandidate)?.score || 0.7,
                matchReason: `contextual_option:${contextualResult.reason}`,
                candidateText: selectedCandidateText,
                candidateId: selectedCandidate.id,
                candidates: contextualResult.classifiedCandidates.map((c) => ({
                    elementId: c.element.id,
                    text: c.text,
                    normalizedText: c.normalizedText,
                    type: c.type,
                    role: c.element.role,
                    tagName: c.element.tagName,
                    isClickable: c.isClickable,
                    matchScore: c.score,
                    matchReason: `contextual_option:${c.scoreReasons.join(",")}`,
                    locatorStrategy: c.isClickable ? "contextual_option" : "text"
                })),
                contextualResolverDiagnostics: contextualResult.diagnostics
            };
        }
    }
    if (contextualResult.status === "already_satisfied") {
        return {
            status: "resolved",
            target,
            locator: undefined,
            locatorStrategy: "contextual_option_already_satisfied",
            confidence: 0.9,
            matchReason: `contextual_option_already_satisfied:${contextualResult.reason || "already_satisfied"}`,
            candidateText: contextualResult.alreadySatisfiedEvidence?.candidateText || "",
            candidates: [],
            alreadySatisfiedEvidence: contextualResult.alreadySatisfiedEvidence,
            ambiguityDiagnostics: {
                target,
                semanticRole: opts.semanticRole !== "unknown" ? opts.semanticRole : undefined,
                relationContext: opts.relationContext || undefined,
                candidateCount: contextualResult.classifiedCandidates.length,
                candidateTexts: contextualResult.classifiedCandidates.slice(0, 5).map((c) => c.text),
                candidateRoles: [...new Set(contextualResult.classifiedCandidates.slice(0, 5).map((c) => c.element.role ?? c.element.tagName ?? "unknown"))],
                candidateStrategies: [...new Set(contextualResult.classifiedCandidates.slice(0, 5).map((c) => c.type))]
            }
        };
    }
    if (contextualResult.status === "unresolved" && contextualResult.classifiedCandidates.length > 0) {
        const classified = [...contextualResult.classifiedCandidates].sort((a, b) => b.score - a.score);
        const best = classified[0];
        const second = classified[1];
        const hasAmbiguity = classified.length > 1 && !!second && Math.abs(best.score - second.score) < 0.15;
        if (classified.length === 1 && !best.isSubmitLike && !best.isSensitive && !best.isBackNavigation) {
            const resolved = await resolveSnapshotElementLocator(page, {
                element: best.element,
                target,
                candidateText: best.text,
                type: best.type,
                tagName: best.element.tagName,
                confidence: Math.max(best.score, 0.5),
                matchReason: "contextual_option_single_safe_candidate"
            });
            if (resolved.locator) {
                return {
                    status: "resolved",
                    target,
                    locator: resolved.locator,
                    locatorStrategy: "contextual_option",
                    confidence: Math.max(best.score, 0.5),
                    matchReason: "contextual_option_single_safe_candidate",
                    candidateText: best.text,
                    candidateId: best.element.id,
                    candidates: classified.slice(0, 5).map((c) => ({
                        elementId: c.element.id,
                        text: c.text,
                        normalizedText: c.normalizedText,
                        type: c.type,
                        role: c.element.role,
                        tagName: c.element.tagName,
                        isClickable: c.isClickable,
                        matchScore: c.score,
                        matchReason: `contextual_option:${c.scoreReasons.join(",")}`,
                        locatorStrategy: c.isClickable ? "contextual_option" : "text"
                    })),
                    contextualResolverDiagnostics: contextualResult.diagnostics
                };
            }
        }
        return {
            status: hasAmbiguity ? "ambiguous" : "not_found",
            target,
            confidence: best.score,
            matchReason: hasAmbiguity ? "ambiguous_contextual_option" : "review_needed",
            candidateText: best.text,
            candidates: classified.slice(0, 5).map((c) => ({
                elementId: c.element.id,
                text: c.text,
                normalizedText: c.normalizedText,
                type: c.type,
                role: c.element.role,
                tagName: c.element.tagName,
                isClickable: c.isClickable,
                matchScore: c.score,
                matchReason: `contextual_option:${c.scoreReasons.join(",")}`,
                locatorStrategy: c.isClickable ? "contextual_option" : "text"
            })),
            ambiguityDiagnostics: {
                target,
                semanticRole: opts.semanticRole !== "unknown" ? opts.semanticRole : undefined,
                relationContext: opts.relationContext || undefined,
                candidateCount: classified.length,
                candidateTexts: classified.slice(0, 5).map((c) => c.text),
                candidateRoles: [...new Set(classified.slice(0, 5).map((c) => c.element.role ?? c.element.tagName ?? "unknown"))],
                candidateStrategies: [...new Set(classified.slice(0, 5).map((c) => c.type))],
                suggestedExactTargetPattern: hasAmbiguity
                    ? `Ambiguous contextual option. Candidates: ${classified.slice(0, 3).map((c) => `"${c.text}"`).join(", ")}`
                    : `Review needed for contextual option "${target}". Best candidate: "${best.text}".`
            }
        };
    }
    return undefined;
}
function fieldLabelMatchesHeader(fieldLabel, headerText) {
    const field = normalizeText(fieldLabel);
    const header = normalizeText(headerText);
    if (!field || !header)
        return false;
    if (field === header || field.includes(header) || header.includes(field))
        return true;
    const fieldTokens = field.split(/\s+/).filter((token) => !["el", "la", "los", "las", "de", "del", "en", "the", "of", "in"].includes(token));
    const headerTokens = header.split(/\s+/).filter((token) => !["el", "la", "los", "las", "de", "del", "en", "the", "of", "in"].includes(token));
    const weakStructuralTokens = new Set(["fecha", "tipo"]);
    if (fieldTokens.some((token) => headerTokens.includes(token) && !weakStructuralTokens.has(token)))
        return true;
    // Common UI abbreviations are structural field aliases, not case data.
    const idTerms = new Set(["id", "identificacion", "identidad", "documento", "doc"]);
    return fieldTokens.some((token) => idTerms.has(token)) && headerTokens.some((token) => idTerms.has(token));
}
/** Capture structural row identity before/after a row-creation action. */
async function captureGridCollectionSnapshot(page) {
    const containers = page.locator("table, [role='grid']");
    const count = await containers.count().catch(() => 0);
    for (let containerIndex = 0; containerIndex < count; containerIndex += 1) {
        const container = containers.nth(containerIndex);
        const rows = container.locator("tbody tr, [role='row']");
        const rowCount = await rows.count().catch(() => 0);
        const rowIdentities = [];
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
            const row = rows.nth(rowIndex);
            if (await row.locator("td, th, [role='gridcell']").count().catch(() => 0) === 0)
                continue;
            const identity = await row.evaluate((element) => {
                const el = element;
                return el.getAttribute("data-row-id")
                    || el.getAttribute("data-id")
                    || el.getAttribute("aria-rowindex")
                    || el.id
                    || undefined;
            }).catch(() => undefined);
            if (identity)
                rowIdentities.push(identity);
        }
        return { rowCount: rowIdentities.length, rowIdentities, containerIndex };
    }
    return { rowCount: 0, rowIdentities: [] };
}
function compareGridCollection(before, after) {
    const beforeIds = new Set(before.rowIdentities);
    const newRowObserved = after.rowIdentities.some((identity) => !beforeIds.has(identity));
    return {
        rowCountIncreased: after.rowCount > before.rowCount,
        newRowObserved,
        newRowIdentityDistinct: newRowObserved,
    };
}
const GRID_EDITOR_SELECTOR = "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox']";
const GRID_INTERACTIVE_CONTROL_SELECTOR = `${GRID_EDITOR_SELECTOR}, button:not([role='option']), [role='button']`;
/**
 * Resolves an editable grid cell from its structural row/column intersection.
 * An ordinal is accepted only when it is part of the parsed scenario scope;
 * the resolver never chooses a page-wide nth control as an authority.
 */
async function resolveGridEditor(page, fieldLabel, context = {}, options = {}) {
    const empty = {
        diagnostics: {
            rowResolved: false,
            columnResolved: false,
            cellResolved: false,
            editorInitiallyPresent: false,
            cellActivationAttempted: false,
            editorResolvedAfterActivation: false,
        },
    };
    const containers = page.locator("table, [role='grid']");
    const containerCount = await containers.count().catch(() => 0);
    for (let containerIndex = 0; containerIndex < containerCount; containerIndex += 1) {
        const container = containers.nth(containerIndex);
        const headerCandidates = container.locator("thead th, thead td, [role='columnheader']");
        const headerCount = await headerCandidates.count().catch(() => 0);
        const firstRow = container.locator("tr, [role='row']").first();
        const fallbackHeaders = headerCount > 0 ? headerCandidates : firstRow.locator("th, td, [role='columnheader']");
        const effectiveHeaderCount = await fallbackHeaders.count().catch(() => 0);
        let columnIndex = -1;
        for (let candidateIndex = 0; candidateIndex < effectiveHeaderCount; candidateIndex += 1) {
            const headerText = await fallbackHeaders.nth(candidateIndex).innerText().catch(() => "");
            if (fieldLabelMatchesHeader(fieldLabel, headerText)) {
                columnIndex = candidateIndex;
                break;
            }
        }
        if (columnIndex < 0)
            continue;
        const structuralRowMatch = context.rowRef?.match(/(?:^|:)row:(\d+)$/) ?? context.rowRef?.match(/(\d+)$/);
        const structuralRowOrdinal = structuralRowMatch ? Number.parseInt(structuralRowMatch[1], 10) : undefined;
        const rowCandidates = structuralRowOrdinal && structuralRowOrdinal > 0
            ? container.locator("tr, [role='row']")
            : container.locator("tbody tr, [role='row']");
        const candidateRows = [];
        const rowCandidateCount = await rowCandidates.count().catch(() => 0);
        for (let candidateIndex = 0; candidateIndex < rowCandidateCount; candidateIndex += 1) {
            const row = rowCandidates.nth(candidateIndex);
            const cells = row.locator("td, th, [role='gridcell']");
            if (await cells.count().catch(() => 0) > 0)
                candidateRows.push(row);
        }
        if (candidateRows.length === 0)
            continue;
        const requestedRowIndex = structuralRowOrdinal && structuralRowOrdinal > 0
            ? structuralRowOrdinal - 1
            : context.rowRelation === "added"
                ? candidateRows.length - 1
                : context.rowScope !== undefined ? context.rowScope - 1 : 0;
        const row = candidateRows[requestedRowIndex];
        if (!row)
            continue;
        const cells = row.locator("td, th, [role='gridcell']");
        const cellCount = await cells.count().catch(() => 0);
        const leadingOffset = Math.max(0, cellCount - effectiveHeaderCount);
        const cellIndex = columnIndex + leadingOffset;
        const cell = cells.nth(cellIndex);
        if (cellIndex >= cellCount)
            continue;
        const diagnostics = {
            rowResolved: true,
            columnResolved: true,
            cellResolved: true,
            editorInitiallyPresent: false,
            cellActivationAttempted: false,
            editorResolvedAfterActivation: false,
            rowIndex: requestedRowIndex,
            columnIndex,
            containerIndex,
        };
        const rowIdentity = await row.evaluate((element) => {
            const el = element;
            return el.getAttribute("data-row-id") || el.getAttribute("data-id") || el.getAttribute("aria-rowindex") || el.id || undefined;
        }).catch(() => undefined);
        const columnIdentity = await fallbackHeaders.nth(columnIndex).innerText().catch(() => fieldLabel);
        const candidateDetails = [];
        const inspectEditor = async (editor, locatorStrategy) => {
            const details = await editor.evaluate((element) => {
                const el = element;
                const tag = el.tagName.toLowerCase();
                const role = el.getAttribute("role") || undefined;
                const ariaHasPopup = el.getAttribute("aria-haspopup") || undefined;
                const ariaExpanded = el.getAttribute("aria-expanded");
                const contentEditable = el.isContentEditable;
                const visible = Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
                const readOnly = ("readOnly" in el && Boolean(el.readOnly))
                    || el.getAttribute("aria-readonly") === "true";
                const enabled = (!("disabled" in el) || !el.disabled)
                    && el.getAttribute("aria-disabled") !== "true";
                const domPath = [];
                let current = el;
                while (current?.parentElement) {
                    const parentElement = current.parentElement;
                    domPath.unshift(Array.from(parentElement.children).indexOf(current));
                    current = parentElement;
                }
                const optionTexts = tag === "select"
                    ? Array.from(el.options).map((option) => option.textContent?.trim() || option.value).filter(Boolean)
                    : [];
                return { tag, role, ariaHasPopup, ariaExpanded, contentEditable, readOnly, visible, enabled, domPath, optionTexts };
            }).catch(() => ({ tag: "unknown", role: undefined, ariaHasPopup: undefined, ariaExpanded: null, contentEditable: false, readOnly: false, visible: false, enabled: false, domPath: [], optionTexts: [] }));
            const editorBox = await editor.boundingBox().catch(() => null);
            const cellBox = await cell.boundingBox().catch(() => null);
            const boundingRelation = editorBox && cellBox
                && editorBox.x >= cellBox.x - 1
                && editorBox.y >= cellBox.y - 1
                && editorBox.x + editorBox.width <= cellBox.x + cellBox.width + 1
                && editorBox.y + editorBox.height <= cellBox.y + cellBox.height + 1
                ? "cell" : editorBox && cellBox ? "outside_cell" : "unknown";
            const candidate = {
                rowIdentity,
                columnIdentity,
                associatedField: context.associatedField,
                tag: details.tag,
                role: details.role,
                visible: details.visible,
                enabled: details.enabled,
                readOnly: details.readOnly,
                contentEditable: details.contentEditable,
                boundingRelation: boundingRelation,
                availableOptionTexts: details.optionTexts,
                locatorStrategy,
                confidence: 0.95,
            };
            candidateDetails.push(candidate);
            console.log(`[grid-selection-candidate] rowIdentity=${rowIdentity ?? "unresolved"} columnIdentity=${JSON.stringify(columnIdentity)} associatedField=${JSON.stringify(context.associatedField ?? "")} tag=${details.tag} role=${details.role ?? ""} visible=${details.visible} enabled=${details.enabled} boundingRelation=${candidate.boundingRelation} availableOptionTexts=${JSON.stringify(details.optionTexts)} locatorStrategy=${locatorStrategy} confidence=${candidate.confidence.toFixed(2)}`);
            return { locator: editor, ...details, boundingRelation: candidate.boundingRelation };
        };
        const findEditor = async () => {
            const editors = cell.locator(options.includeInteractiveControls ? GRID_INTERACTIVE_CONTROL_SELECTOR : GRID_EDITOR_SELECTOR);
            const editorCount = await editors.count().catch(() => 0);
            const candidates = [];
            for (let editorIndex = 0; editorIndex < editorCount; editorIndex += 1) {
                const editor = editors.nth(editorIndex);
                const inspected = await inspectEditor(editor, options.controlKind === "selection" ? "grid_cell_selection_control" : options.controlKind === "fill" ? "grid_cell_fill_control" : "grid_cell_editor");
                if (inspected.visible && inspected.boundingRelation === "cell")
                    candidates.push(inspected);
            }
            const selectionControls = candidates.filter((candidate) => candidate.tag === "select"
                || candidate.role === "combobox"
                || candidate.role === "button"
                || (candidate.tag === "button" && !candidate.role)
                || Boolean(candidate.ariaHasPopup)
                || candidate.ariaExpanded !== null);
            const fillControls = candidates.filter((candidate) => !candidate.readOnly
                && candidate.enabled
                && (candidate.tag === "input" || candidate.tag === "textarea" || candidate.role === "textbox" || candidate.role === "searchbox" || candidate.role === "spinbutton" || candidate.contentEditable));
            let eligible = options.controlKind === "selection" ? selectionControls : options.controlKind === "fill" ? fillControls : candidates;
            if (options.controlKind === "selection") {
                const nativeOrCombobox = eligible.filter((candidate) => candidate.enabled && !candidate.readOnly && (candidate.tag === "select" || candidate.role === "combobox"));
                if (nativeOrCombobox.length > 0)
                    eligible = nativeOrCombobox;
            }
            if (options.optionText?.trim()) {
                const wanted = normalizeText(options.optionText);
                const compatible = eligible.filter((candidate) => candidate.optionTexts.some((option) => normalizeText(option) === wanted));
                if (compatible.length > 0)
                    eligible = compatible;
                else if (eligible.some((candidate) => candidate.tag === "select"))
                    eligible = [];
                diagnostics.candidateCountAfterOptionCompatibility = compatible.length;
            }
            diagnostics.candidateCount = candidates.length;
            // A wrapper may expose the same editor through both a semantic role and
            // its concrete child. Keep only the deepest compatible node. Sibling
            // editors remain ambiguous and are never resolved by first()/nth().
            const isAncestorPath = (ancestor, descendant) => ancestor.length < descendant.length && ancestor.every((part, index) => part === descendant[index]);
            eligible = eligible.filter((candidate) => !eligible.some((other) => other !== candidate && isAncestorPath(candidate.domPath, other.domPath)));
            diagnostics.candidateCountAfterControlType = eligible.length;
            diagnostics.candidates = candidateDetails;
            if (eligible.length > 1)
                return { ambiguous: true };
            if (eligible.length === 1)
                return { locator: eligible[0].locator, cell };
            return {};
        };
        const existingEditor = await findEditor();
        if (existingEditor.ambiguous)
            return { ambiguous: true, diagnostics };
        if (existingEditor.locator) {
            diagnostics.editorInitiallyPresent = true;
            return { locator: existingEditor.locator, cell, strategy: options.controlKind === "selection" ? "grid_cell_selection_control" : "grid_cell_editor", diagnostics };
        }
        if (options.allowActivation === false)
            return { cell, diagnostics };
        diagnostics.cellActivationAttempted = true;
        await cell.click().catch(() => undefined);
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
            const activatedEditor = await findEditor();
            if (activatedEditor.ambiguous)
                return { ambiguous: true, diagnostics };
            if (activatedEditor.locator) {
                diagnostics.editorResolvedAfterActivation = true;
                return { locator: activatedEditor.locator, cell, strategy: options.controlKind === "selection" ? "grid_cell_selection_control_after_activation" : "grid_cell_editor_after_activation", diagnostics };
            }
            await page.waitForTimeout(100).catch(() => undefined);
        }
        return { diagnostics };
    }
    return empty;
}
async function findVisibleTextLocator(page, target) {
    const exactTarget = new RegExp(`^${escapeRegex(target)}$`, "i");
    const candidates = page.getByText(exactTarget);
    const count = await candidates.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
        const candidate = candidates.nth(index);
        if (await candidate.isVisible().catch(() => false))
            return candidate;
    }
    return undefined;
}
async function resolveVisibleSelectionOption(page, target) {
    const optionTarget = normalizeText(target);
    const optionMatches = async (candidate) => {
        const text = await candidate.innerText().catch(() => "");
        const normalized = normalizeText(text);
        return normalized === optionTarget || normalized.includes(optionTarget) || optionTarget.includes(normalized);
    };
    const findOnce = async () => {
        const roleOption = page.getByRole("option", { name: new RegExp(escapeRegex(target), "i") });
        if (await roleOption.count().catch(() => 0) > 0) {
            for (let index = 0; index < await roleOption.count().catch(() => 0); index += 1) {
                const candidate = roleOption.nth(index);
                if (await candidate.isVisible().catch(() => false) && await optionMatches(candidate))
                    return candidate;
            }
        }
        const buttonOption = page.getByRole("button", { name: new RegExp(escapeRegex(target), "i") });
        const buttonCount = await buttonOption.count().catch(() => 0);
        for (let index = 0; index < buttonCount; index += 1) {
            const candidate = buttonOption.nth(index);
            if (await candidate.isVisible().catch(() => false) && await optionMatches(candidate))
                return candidate;
        }
        const textCandidates = page.getByText(new RegExp(escapeRegex(target), "i"));
        const textCount = await textCandidates.count().catch(() => 0);
        for (let index = 0; index < textCount; index += 1) {
            const candidate = textCandidates.nth(index);
            if (await candidate.isVisible().catch(() => false) && await optionMatches(candidate))
                return candidate;
        }
        return undefined;
    };
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const option = await findOnce();
        if (option)
            return option;
        await page.waitForTimeout(100).catch(() => undefined);
    }
    return undefined;
}
function selectionFailureResult(target, reason, diagnostics, gridDiagnostics) {
    return {
        status: reason === "ambiguous_option" ? "ambiguous" : "not_found",
        target,
        confidence: 0,
        matchReason: reason ?? "selection_surface_not_observed",
        candidateText: target,
        candidates: [],
        gridDiagnostics,
        selectionDiagnostics: diagnostics,
    };
}
async function installSelectionMutationObserver(page) {
    await page.evaluate(() => {
        const runtimeWindow = window;
        runtimeWindow.__codexSelectionMutationCount = 0;
        runtimeWindow.__codexSelectionObserver?.disconnect();
        runtimeWindow.__codexSelectionObserver = new MutationObserver((records) => {
            runtimeWindow.__codexSelectionMutationCount = (runtimeWindow.__codexSelectionMutationCount ?? 0) + records.length;
        });
        runtimeWindow.__codexSelectionObserver.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-expanded", "aria-selected", "aria-checked", "data-state"]
        });
    }).catch(() => undefined);
}
async function readSelectionMutationCount(page) {
    return page.evaluate(() => {
        const runtimeWindow = window;
        return runtimeWindow.__codexSelectionMutationCount ?? 0;
    }).catch(() => 0);
}
async function removeSelectionMutationObserver(page) {
    await page.evaluate(() => {
        const runtimeWindow = window;
        runtimeWindow.__codexSelectionObserver?.disconnect();
        delete runtimeWindow.__codexSelectionObserver;
        delete runtimeWindow.__codexSelectionMutationCount;
    }).catch(() => undefined);
}
async function inspectControlledSurface(page, id) {
    if (!id)
        return { exists: false, connected: false, tag: "", role: "", hidden: false, ariaHidden: "", display: "", visibility: "", childCount: 0, textSummary: "empty", roles: [], optionCount: 0, visibleOptionCount: 0, optionVisibility: [], visible: false };
    return page.evaluate((controlledId) => {
        const node = document.getElementById(controlledId);
        if (!node)
            return { exists: false, connected: false, tag: "", role: "", hidden: false, ariaHidden: "", display: "", visibility: "", childCount: 0, textSummary: "empty", roles: [], optionCount: 0, visibleOptionCount: 0, optionVisibility: [], visible: false };
        const element = node;
        const style = window.getComputedStyle(element);
        const visible = !element.hidden && element.getAttribute("aria-hidden") !== "true"
            && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0
            && Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
        const roles = Array.from(node.querySelectorAll("[role]")).map((child) => child.getAttribute("role") || "").filter(Boolean);
        const uniqueRoles = [...new Set(roles)];
        const options = Array.from(node.querySelectorAll("[role='option']"));
        const optionVisibility = options.map((option) => {
            const optionNode = option;
            const optionStyle = window.getComputedStyle(optionNode);
            const optionVisible = !optionNode.hidden && optionNode.getAttribute("aria-hidden") !== "true"
                && optionStyle.display !== "none" && optionStyle.visibility !== "hidden" && Number(optionStyle.opacity || "1") > 0
                && Boolean(optionNode.offsetWidth || optionNode.offsetHeight || optionNode.getClientRects().length);
            return `${optionVisible ? "visible" : "hidden"}|display=${optionStyle.display}|visibility=${optionStyle.visibility}|width=${optionNode.offsetWidth}|height=${optionNode.offsetHeight}`;
        });
        const xpathFor = (target) => {
            const parts = [];
            let current = target;
            while (current && current !== document.documentElement) {
                let index = 1;
                let sibling = current.previousElementSibling;
                while (sibling) {
                    if (sibling.tagName === current.tagName)
                        index++;
                    sibling = sibling.previousElementSibling;
                }
                parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
                current = current.parentElement;
            }
            return `/html/${parts.join("/")}`;
        };
        const optionSelector = "[role='option'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [data-value], [data-radix-collection-item], button";
        const surfaceOptions = Array.from(node.querySelectorAll(optionSelector))
            .filter((candidate) => {
            const candidateNode = candidate;
            const candidateStyle = window.getComputedStyle(candidateNode);
            return !candidateNode.hidden && candidateNode.getAttribute("aria-hidden") !== "true"
                && candidateStyle.display !== "none" && candidateStyle.visibility !== "hidden"
                && Number(candidateStyle.opacity || "1") > 0 && (visible || Boolean(candidateNode.offsetWidth || candidateNode.offsetHeight || candidateNode.getClientRects().length));
        })
            .map((candidate, candidateIndex) => {
            const candidateNode = candidate;
            const marker = `codex-selection-option-${Date.now()}-${candidateIndex}-${Math.random().toString(36).slice(2)}`;
            candidateNode.setAttribute("data-codex-selection-option", marker);
            return {
                xpath: xpathFor(candidate),
                text: (candidateNode.innerText || candidateNode.textContent || "").trim(),
                value: candidateNode.getAttribute("data-value") || candidateNode.getAttribute("value") || undefined,
                role: candidateNode.getAttribute("role") || undefined,
                marker,
            };
        })
            .filter((candidate) => Boolean(candidate.text || candidate.value));
        const text = (element.innerText || element.textContent || "").trim();
        return {
            exists: true,
            connected: node.isConnected,
            tag: node.tagName.toLowerCase(),
            role: node.getAttribute("role") || "",
            hidden: element.hidden,
            ariaHidden: node.getAttribute("aria-hidden") || "",
            display: style.display,
            visibility: style.visibility,
            childCount: node.children.length,
            textSummary: text ? `non-empty(${text.length})` : "empty",
            roles: uniqueRoles,
            optionCount: options.length,
            visibleOptionCount: optionVisibility.filter((item) => item.startsWith("visible|")).length,
            optionVisibility,
            visible,
            selectionSurface: {
                key: node.id ? `id:${node.id}` : xpathFor(node),
                xpath: xpathFor(node),
                type: node.getAttribute("role") || (node.hasAttribute("popover") ? "popover" : "surface"),
                role: node.getAttribute("role") || undefined,
                relatedId: controlledId,
                visible: visible || surfaceOptions.length > 0,
                portalized: !node.closest("td, th, [role='gridcell']"),
                ariaControls: node.getAttribute("aria-controls") || undefined,
                ariaOwns: node.getAttribute("aria-owns") || undefined,
                optionCandidates: surfaceOptions,
            },
        };
    }, id).catch(() => ({ exists: false, connected: false, tag: "", role: "", hidden: false, ariaHidden: "", display: "", visibility: "", childCount: 0, textSummary: "empty", roles: [], optionCount: 0, visibleOptionCount: 0, optionVisibility: [], visible: false }));
}
async function inspectGlobalSelectableCounts(page) {
    return page.evaluate(() => {
        const isVisible = (element) => {
            const node = element;
            const style = window.getComputedStyle(node);
            return !node.hidden && node.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden"
                && Number(style.opacity || "1") > 0 && Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
        };
        const roleOptions = document.querySelectorAll("[role='option']").length;
        const listboxes = document.querySelectorAll("[role='listbox']").length;
        const menus = document.querySelectorAll("[role='menu']").length;
        const nativeOptions = document.querySelectorAll("select option").length;
        const selectable = Array.from(document.querySelectorAll("[role='option'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], select option, [data-value], button")).filter(isVisible).length;
        return { globalRoleOptionCount: roleOptions, globalListboxCount: listboxes, globalMenuCount: menus, nativeOptionCount: nativeOptions, visibleSelectableCount: selectable };
    }).catch(() => ({ globalRoleOptionCount: 0, globalListboxCount: 0, globalMenuCount: 0, nativeOptionCount: 0, visibleSelectableCount: 0 }));
}
async function readSelectionTriggerMeta(trigger) {
    if (await trigger.count().catch(() => 0) === 0)
        return { identity: "detached", role: "", ariaExpanded: "", ariaControls: "", present: false };
    return trigger.evaluate((element) => ({
        identity: `${element.tagName.toLowerCase()}|role=${element.getAttribute("role") || ""}|aria-controls=${element.hasAttribute("aria-controls") ? "present" : "absent"}`,
        role: element.getAttribute("role") || "",
        ariaExpanded: element.getAttribute("aria-expanded") || "",
        ariaControls: (element.getAttribute("aria-controls") || "").split(/\s+/).filter(Boolean)[0] || "",
        present: true,
    })).catch(() => ({ identity: "detached", role: "", ariaExpanded: "", ariaControls: "", present: false }));
}
async function collectControlledSurfaceDiagnostics(page, trigger, beforeIds) {
    const before = await inspectControlledSurface(page, beforeIds[0]);
    const polls = [];
    const startedAt = Date.now();
    const offsets = [0, 50, 100, 250, 500, 1000];
    for (const offset of offsets) {
        const remaining = offset - (Date.now() - startedAt);
        if (remaining > 0)
            await page.waitForTimeout(remaining).catch(() => undefined);
        const meta = await readSelectionTriggerMeta(trigger);
        const controlledId = meta.ariaControls || beforeIds[0] || "";
        const controlled = await inspectControlledSurface(page, controlledId);
        const global = await inspectGlobalSelectableCounts(page);
        polls.push({ elapsedMs: Date.now() - startedAt, ariaExpanded: meta.ariaExpanded, ariaControls: meta.ariaControls, controlled, ...global, mutationCount: await readSelectionMutationCount(page) });
    }
    const meta = await readSelectionTriggerMeta(trigger);
    const after = await inspectControlledSurface(page, meta.ariaControls || beforeIds[0]);
    console.log(`[selection-controlled-surface] comboboxIdentity=${meta.identity} ariaExpanded=${meta.ariaExpanded} ariaControlsValue=${meta.ariaControls || "none"} controlledNodeExists=${after.exists} controlledNodeConnected=${after.connected} controlledNodeTag=${after.tag || "none"} controlledNodeRole=${after.role || "none"} controlledNodeHidden=${after.hidden} controlledNodeAriaHidden=${after.ariaHidden || "none"} controlledNodeDisplay=${after.display || "none"} controlledNodeVisibility=${after.visibility || "none"} controlledNodeChildCount=${after.childCount} controlledNodeTextSummary=${after.textSummary} controlledNodeRoles=${JSON.stringify(after.roles)} controlledNodeOptionCount=${after.optionCount} controlledNodeVisibleOptionCount=${after.visibleOptionCount} controlledNodeOptionVisibility=${JSON.stringify(after.optionVisibility)}`);
    for (const poll of polls)
        console.log(`[selection-controlled-poll] elapsedMs=${poll.elapsedMs} ariaExpanded=${poll.ariaExpanded} controlledNodeExists=${poll.controlled.exists} controlledNodeVisible=${poll.controlled.visible} roleOptionCount=${poll.controlled.optionCount} visibleRoleOptionCount=${poll.controlled.visibleOptionCount} globalRoleOptionCount=${poll.globalRoleOptionCount} globalListboxCount=${poll.globalListboxCount} globalMenuCount=${poll.globalMenuCount} nativeOptionCount=${poll.nativeOptionCount} visibleSelectableCount=${poll.visibleSelectableCount} domMutationCount=${poll.mutationCount}`);
    return { before, after, polls, meta, surface: after.selectionSurface };
}
function controlledSurfaceLifecycle(before, after, polls) {
    if (!before.exists && after.exists)
        return "inserted";
    if (before.exists && !after.exists)
        return "missing";
    if (before.exists && before.hidden && after.visible)
        return "visibility_changed";
    if (before.exists && before.childCount !== after.childCount)
        return "children_changed";
    if (after.exists && polls.some((poll) => poll.globalRoleOptionCount > 0) && after.optionCount === 0)
        return "outside_controlled_node";
    return after.exists ? "unchanged" : "missing";
}
async function inspectSelectionSurfaces(page, relatedIds = []) {
    return page.evaluate((ids) => {
        const visible = (element) => {
            const node = element;
            if (node.hidden || node.getAttribute("aria-hidden") === "true")
                return false;
            const style = window.getComputedStyle(node);
            return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0
                && Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
        };
        const xpathFor = (element) => {
            const parts = [];
            let current = element;
            while (current && current !== document.documentElement) {
                let index = 1;
                let sibling = current.previousElementSibling;
                while (sibling) {
                    if (sibling.tagName === current.tagName)
                        index++;
                    sibling = sibling.previousElementSibling;
                }
                parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
                current = current.parentElement;
            }
            return `/html/${parts.join("/")}`;
        };
        const surfaceSelector = "[role='listbox'], [role='menu'], [role='dialog'], [aria-modal='true'], [popover]";
        const optionSelector = "[role='option'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [data-value], [data-radix-collection-item], button";
        const roots = new Map();
        for (const element of Array.from(document.querySelectorAll(surfaceSelector)))
            roots.set(element, undefined);
        for (const id of ids) {
            const related = document.getElementById(id);
            if (!related)
                continue;
            // aria-controls/aria-owns may point at a semantic surface, a zero-size
            // viewport, or an implementation wrapper. Keep the relationship while
            // walking only the local portal ancestry; never fall back to body-wide
            // option discovery.
            let current = related;
            for (let depth = 0; current && current !== document.body && current !== document.documentElement && depth < 6; depth += 1) {
                roots.set(current, id);
                current = current.parentElement;
            }
        }
        // Custom controls may render role=option items in a portal container that
        // has no listbox/menu role. Treat the nearest option-owning container as a
        // candidate surface; causal binding is still enforced later by the
        // trigger relationship or post-activation mutation evidence.
        for (const option of Array.from(document.querySelectorAll("[role='option'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox']"))) {
            let owner = option.parentElement;
            let depth = 0;
            while (owner && owner !== document.body && owner !== document.documentElement && depth < 4) {
                roots.set(owner, undefined);
                if (owner.getAttribute("role") === "listbox" || owner.getAttribute("role") === "menu")
                    break;
                owner = owner.parentElement;
                depth += 1;
            }
        }
        const snapshots = [];
        for (const [root, relatedId] of roots) {
            const role = root.getAttribute("role") || undefined;
            const type = role || (root.hasAttribute("popover") ? "popover" : "surface");
            const relatedControlledRoot = relatedId ? document.getElementById(relatedId) : undefined;
            const optionCandidates = Array.from(root.querySelectorAll(optionSelector))
                .filter((candidate) => {
                if (visible(candidate))
                    return true;
                // Custom listboxes can keep the option's own box at zero size while
                // the related controlled surface owns the visible interaction area.
                // The aria-controls/aria-owns relationship is the authority here;
                // do not broaden this to unrelated page-wide options.
                if (!relatedControlledRoot || !relatedControlledRoot.contains(candidate) || !visible(relatedControlledRoot))
                    return false;
                const node = candidate;
                const style = window.getComputedStyle(node);
                return !node.hidden && node.getAttribute("aria-hidden") !== "true"
                    && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
            })
                .map((candidate, candidateIndex) => {
                const element = candidate;
                const marker = `codex-selection-option-${Date.now()}-${candidateIndex}-${Math.random().toString(36).slice(2)}`;
                element.setAttribute("data-codex-selection-option", marker);
                return {
                    xpath: xpathFor(candidate),
                    text: (element.innerText || element.textContent || "").trim(),
                    value: element.getAttribute("data-value") || element.getAttribute("value") || undefined,
                    role: element.getAttribute("role") || undefined,
                    marker,
                };
            })
                .filter((candidate) => Boolean(candidate.text || candidate.value));
            // Some portal implementations keep the related content wrapper at
            // zero-size while its viewport/items carry the visible geometry.
            const rootVisible = visible(root) || optionCandidates.length > 0;
            snapshots.push({
                key: root.id ? `id:${root.id}` : xpathFor(root),
                xpath: xpathFor(root),
                type,
                role,
                relatedId,
                visible: rootVisible,
                portalized: !root.closest("td, th, [role='gridcell']"),
                ariaControls: root.getAttribute("aria-controls") || undefined,
                ariaOwns: root.getAttribute("aria-owns") || undefined,
                optionCandidates,
            });
        }
        return snapshots;
    }, relatedIds).catch(() => []);
}
/**
 * Capture the controlled surface at the same observation instant as the
 * trigger metadata. Some portal implementations replace or detach the
 * wrapper before the subsequent global scan, so the direct ARIA relationship
 * must remain the causal source of the snapshot.
 */
async function inspectRelatedControlledSurface(page, id) {
    if (!id)
        return undefined;
    return page.evaluate((controlledId) => {
        const root = document.getElementById(controlledId);
        if (!root)
            return undefined;
        const xpathFor = (element) => {
            const parts = [];
            let current = element;
            while (current && current !== document.documentElement) {
                let index = 1;
                let sibling = current.previousElementSibling;
                while (sibling) {
                    if (sibling.tagName === current.tagName)
                        index++;
                    sibling = sibling.previousElementSibling;
                }
                parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
                current = current.parentElement;
            }
            return `/html/${parts.join("/")}`;
        };
        const isVisible = (element) => {
            const node = element;
            const style = window.getComputedStyle(node);
            return !node.hidden && node.getAttribute("aria-hidden") !== "true"
                && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0
                && Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
        };
        const optionSelector = "[role='option'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [data-value], [data-radix-collection-item], button";
        const rootVisible = isVisible(root);
        const optionCandidates = Array.from(root.querySelectorAll(optionSelector))
            .filter((candidate) => {
            if (isVisible(candidate))
                return true;
            const node = candidate;
            const style = window.getComputedStyle(node);
            return rootVisible && !node.hidden && node.getAttribute("aria-hidden") !== "true"
                && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
        })
            .map((candidate, candidateIndex) => {
            const node = candidate;
            const marker = `codex-selection-option-${Date.now()}-${candidateIndex}-${Math.random().toString(36).slice(2)}`;
            node.setAttribute("data-codex-selection-option", marker);
            return {
                xpath: xpathFor(candidate),
                text: (node.innerText || node.textContent || "").trim(),
                value: node.getAttribute("data-value") || node.getAttribute("value") || undefined,
                role: node.getAttribute("role") || undefined,
                marker,
            };
        })
            .filter((candidate) => Boolean(candidate.text || candidate.value));
        return {
            key: root.id ? `id:${root.id}` : xpathFor(root),
            xpath: xpathFor(root),
            type: root.getAttribute("role") || (root.hasAttribute("popover") ? "popover" : "surface"),
            role: root.getAttribute("role") || undefined,
            relatedId: controlledId,
            visible: rootVisible || optionCandidates.length > 0,
            portalized: !root.closest("td, th, [role='gridcell']"),
            ariaControls: root.getAttribute("aria-controls") || undefined,
            ariaOwns: root.getAttribute("aria-owns") || undefined,
            optionCandidates,
        };
    }, id).catch(() => undefined);
}
async function captureSelectionTriggerState(trigger) {
    if (await trigger.count().catch(() => 0) === 0) {
        return { text: "", value: "", ariaValueText: "", ariaSelected: "", ariaChecked: "", dataValue: "" };
    }
    return trigger.evaluate((element) => {
        const node = element;
        return {
            text: (node.innerText || node.textContent || "").trim(),
            value: node.value || "",
            ariaValueText: node.getAttribute("aria-valuetext") || "",
            ariaSelected: node.getAttribute("aria-selected") || "",
            ariaChecked: node.getAttribute("aria-checked") || "",
            dataValue: node.getAttribute("data-value") || "",
        };
    }).catch(() => ({ text: "", value: "", ariaValueText: "", ariaSelected: "", ariaChecked: "", dataValue: "" }));
}
async function getSelectionTriggerRelationship(trigger) {
    if (await trigger.count().catch(() => 0) === 0)
        return { controls: [], owns: [] };
    return trigger.evaluate((element) => ({
        controls: (element.getAttribute("aria-controls") || "").split(/\s+/).filter(Boolean),
        owns: (element.getAttribute("aria-owns") || "").split(/\s+/).filter(Boolean),
    })).catch(() => ({ controls: [], owns: [] }));
}
async function resolveStableSelectionCell(page, trigger) {
    const token = await trigger.evaluate((element) => {
        const cell = element.closest("td, th, [role='gridcell']");
        if (!cell)
            return "";
        const value = `selection-cell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        cell.setAttribute("data-codex-selection-cell", value);
        return value;
    }).catch(() => "");
    if (!token)
        return undefined;
    const cell = page.locator(`[data-codex-selection-cell="${escapeRegex(token)}"]`);
    return await cell.count().catch(() => 0) > 0 ? cell : undefined;
}
async function verifySelectionState(trigger, optionTarget, before, beforeCellText, surfaceBefore, stableCell) {
    const wanted = normalizeText(optionTarget);
    const cell = stableCell ?? trigger.locator("xpath=ancestor::*[self::td or @role='gridcell'][1]");
    const cellPresent = await cell.count().catch(() => 0) > 0;
    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
        const state = await captureSelectionTriggerState(trigger);
        const cellText = await cell.innerText().catch(() => "");
        const normalizedState = normalizeText([state.text, state.value, state.ariaValueText, state.dataValue].join(" "));
        const stateChanged = JSON.stringify(state) !== JSON.stringify(before);
        const cellChanged = Boolean(beforeCellText) && cellText !== beforeCellText;
        const valueMatches = normalizedState === wanted || normalizedState.includes(wanted);
        const cellMatches = normalizeText(cellText).includes(wanted);
        const selectedState = /true|selected|checked/i.test(`${state.ariaSelected} ${state.ariaChecked}`);
        const surfacesAfter = await inspectSelectionSurfaces(trigger.page());
        const overlayClosed = surfaceBefore.some((surface) => surface.visible)
            ? !surfacesAfter.some((surface) => surface.visible && surface.key === surfaceBefore.find((candidate) => candidate.visible)?.key)
            : true;
        if ((valueMatches || cellMatches || (stateChanged && selectedState && cellChanged)) && (stateChanged || cellChanged)) {
            console.log(`[selection-surface-verify] cellPresent=${cellPresent} stateChanged=${stateChanged} cellChanged=${cellChanged} valueMatches=${valueMatches} cellMatches=${cellMatches} selectedState=${selectedState} overlayClosed=${overlayClosed}`);
            return { verified: true, overlayClosed };
        }
        await trigger.page().waitForTimeout(100).catch(() => undefined);
    }
    console.log(`[selection-surface-verify] cellPresent=${cellPresent} stateChanged=false cellChanged=false valueMatches=false cellMatches=false selectedState=false overlayClosed=false`);
    return { verified: false, overlayClosed: false };
}
function dynamicEditorStateFor(snapshot, surfaceObserved = false) {
    if (surfaceObserved)
        return "OPTIONS_VISIBLE";
    if (snapshot.selectableDescendants > 0 || snapshot.targetRole === "combobox" || snapshot.targetTag === "select")
        return "SELECTION_CONTROL_READY";
    if (snapshot.editableDescendants > 0)
        return "EDITOR_MATERIALIZED";
    return "DISPLAY";
}
async function captureDynamicEditorSnapshot(cell, trigger) {
    const cellSnapshot = await cell.evaluate((element) => {
        const identity = (node) => {
            if (!node)
                return "";
            const attrs = ["data-testid", "data-row-id", "data-id", "id", "name", "aria-controls", "aria-haspopup", "aria-label", "role", "tabindex"]
                .map((name) => `${name}=${node.getAttribute(name) || ""}`)
                .join("|");
            return `${node.tagName.toLowerCase()}|${attrs}`;
        };
        const visible = (node) => {
            const element = node;
            if (element.hidden || element.getAttribute("aria-hidden") === "true")
                return false;
            const style = window.getComputedStyle(element);
            return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0
                && Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
        };
        const enabled = (node) => !("disabled" in node) || !node.disabled;
        const controls = Array.from(element.querySelectorAll("select, input, textarea, [contenteditable='true'], [role='textbox'], [role='combobox'], [aria-haspopup], button, [role='button']"))
            .map((node) => {
            const tag = node.tagName.toLowerCase();
            const role = node.getAttribute("role") || undefined;
            const editable = tag === "input" || tag === "textarea" || node.getAttribute("contenteditable") === "true" || role === "textbox";
            const selectionAffordance = tag === "select" || role === "combobox" || Boolean(node.getAttribute("aria-haspopup")) || role === "button" || tag === "button";
            return { identity: identity(node), tag, role, visible: visible(node), enabled: enabled(node), editable, selectionAffordance };
        });
        const activeElement = document.activeElement && element.contains(document.activeElement) ? document.activeElement : null;
        return {
            cellIdentity: identity(element),
            activeElementIdentity: identity(activeElement),
            editableDescendants: controls.filter((control) => control.editable && control.visible && control.enabled).length,
            selectableDescendants: controls.filter((control) => control.selectionAffordance && control.visible && control.enabled).length,
            visibleDescendants: controls.filter((control) => control.visible).length,
            controls,
        };
    }).catch(() => ({ cellIdentity: "", activeElementIdentity: "", editableDescendants: 0, selectableDescendants: 0, visibleDescendants: 0, controls: [] }));
    const triggerState = trigger && await trigger.count().catch(() => 0) > 0
        ? await trigger.evaluate((element) => ({
            targetIdentity: ["data-testid", "data-row-id", "data-id", "id", "name", "aria-controls", "aria-haspopup", "aria-label", "role", "tabindex"]
                .map((name) => `${name}=${element.getAttribute(name) || ""}`).join("|"),
            targetTag: element.tagName.toLowerCase(),
            targetRole: element.getAttribute("role") || "",
            targetAttributes: Array.from(element.attributes).map((attribute) => attribute.name),
            ariaExpanded: element.getAttribute("aria-expanded") || "",
            ariaHaspopup: element.getAttribute("aria-haspopup") || "",
            ariaControls: element.getAttribute("aria-controls") || "",
            tabindex: element.getAttribute("tabindex") || "",
        })).catch(() => ({ targetIdentity: "", targetTag: "", targetRole: "", targetAttributes: [], ariaExpanded: "", ariaHaspopup: "", ariaControls: "", tabindex: "" }))
        : { targetIdentity: "", targetTag: "", targetRole: "", targetAttributes: [], ariaExpanded: "", ariaHaspopup: "", ariaControls: "", tabindex: "" };
    return { ...cellSnapshot, ...triggerState };
}
function compareDynamicEditorSnapshots(before, after) {
    const beforeIdentities = new Set(before.controls.map((control) => control.identity));
    const afterIdentities = new Set(after.controls.map((control) => control.identity));
    const newDescendants = after.controls.filter((control) => !beforeIdentities.has(control.identity)).length;
    const newEditableControl = after.controls.some((control) => control.editable && control.visible && control.enabled && !beforeIdentities.has(control.identity));
    const newSelectableControl = after.controls.some((control) => control.selectionAffordance && control.visible && control.enabled && !beforeIdentities.has(control.identity));
    const roleChanged = before.targetRole !== after.targetRole || before.targetTag !== after.targetTag || before.ariaExpanded !== after.ariaExpanded || before.ariaHaspopup !== after.ariaHaspopup || before.ariaControls !== after.ariaControls;
    const targetIdentityChanged = Boolean(before.targetIdentity && after.targetIdentity && before.targetIdentity !== after.targetIdentity);
    const domReplaced = targetIdentityChanged || beforeIdentities.size !== afterIdentities.size || [...beforeIdentities].some((identity) => !afterIdentities.has(identity));
    const activeElementChanged = before.activeElementIdentity !== after.activeElementIdentity && Boolean(after.activeElementIdentity);
    const observableProgress = domReplaced || roleChanged || activeElementChanged || newEditableControl || newSelectableControl;
    return { targetIdentityChanged, domReplaced, roleChanged, newDescendants, activeElementChanged, newEditableControl, newSelectableControl, observableProgress };
}
async function findRematerializedEditor(cell, before) {
    const controls = cell.locator("select, input, textarea, [contenteditable='true'], [role='textbox'], [role='combobox'], [aria-haspopup], button, [role='button']");
    const count = await controls.count().catch(() => 0);
    const candidates = [];
    for (let index = 0; index < count; index += 1) {
        const locator = controls.nth(index);
        const snapshot = await locator.evaluate((element) => {
            const tag = element.tagName.toLowerCase();
            const role = element.getAttribute("role") || undefined;
            const editable = tag === "input" || tag === "textarea" || element.getAttribute("contenteditable") === "true" || role === "textbox";
            const selectionAffordance = tag === "select" || role === "combobox" || Boolean(element.getAttribute("aria-haspopup")) || role === "button" || tag === "button";
            const visible = Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
            const enabled = !("disabled" in element) || !element.disabled;
            return {
                identity: ["data-testid", "data-row-id", "data-id", "id", "name", "aria-controls", "aria-haspopup", "aria-label", "role", "tabindex"]
                    .map((name) => `${name}=${element.getAttribute(name) || ""}`).join("|"),
                tag, role, visible, enabled, editable, selectionAffordance,
            };
        }).catch(() => undefined);
        if (!snapshot || !snapshot.visible || !snapshot.enabled || before.controls.some((control) => control.identity === snapshot.identity))
            continue;
        const score = (snapshot.role === "combobox" || snapshot.tag === "select" ? 4 : snapshot.selectionAffordance ? 3 : snapshot.editable ? 2 : 0);
        if (score > 0)
            candidates.push({ locator, snapshot, score });
    }
    if (candidates.length === 0)
        return {};
    const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
    const best = candidates.filter((candidate) => candidate.score === bestScore);
    if (best.length !== 1)
        return {};
    return { locator: best[0].locator, snapshot: best[0].snapshot };
}
async function resolveAndApplySelectionSurfaceOnce(page, trigger, optionTarget, triggerStrategy, gridDiagnostics, activationAlreadyPerformed = false) {
    const beforeSurfaces = await inspectSelectionSurfaces(page);
    const beforeState = await captureSelectionTriggerState(trigger);
    const stableCell = await resolveStableSelectionCell(page, trigger);
    const beforeCellText = await stableCell?.innerText().catch(() => "") ?? "";
    const relationshipBefore = await getSelectionTriggerRelationship(trigger);
    const controlledBefore = await inspectControlledSurface(page, relationshipBefore.controls[0] || relationshipBefore.owns[0]);
    console.log(`[selection-controlled-before] ariaControlsValue=${relationshipBefore.controls[0] || "none"} controlledNodeExists=${controlledBefore.exists} controlledNodeConnected=${controlledBefore.connected} controlledNodeTag=${controlledBefore.tag || "none"} controlledNodeRole=${controlledBefore.role || "none"} controlledNodeHidden=${controlledBefore.hidden} controlledNodeAriaHidden=${controlledBefore.ariaHidden || "none"} controlledNodeDisplay=${controlledBefore.display || "none"} controlledNodeVisibility=${controlledBefore.visibility || "none"} controlledNodeChildCount=${controlledBefore.childCount} controlledNodeTextSummary=${controlledBefore.textSummary} controlledNodeRoles=${JSON.stringify(controlledBefore.roles)}`);
    let controlledDiagnostics;
    await installSelectionMutationObserver(page);
    if (!activationAlreadyPerformed) {
        try {
            console.log(`[selection-surface-activation] triggerCount=${await trigger.count().catch(() => 0)} action=click`);
            await trigger.click();
            console.log(`[selection-surface-activation] action=click completed=true`);
        }
        catch {
            await removeSelectionMutationObserver(page);
            return selectionFailureResult(optionTarget, "selection_surface_not_observed", {
                triggerResolved: true,
                triggerStrategy,
                ariaRelationshipFound: false,
                surfaceCausallyBound: false,
                optionCandidateCount: 0,
                desiredOptionFound: false,
                stateVerified: false,
                failureReason: "selection_surface_not_observed",
            }, gridDiagnostics);
        }
    }
    const triggerStillConnected = await trigger.count().catch(() => 0) > 0;
    controlledDiagnostics = activationAlreadyPerformed && !triggerStillConnected
        ? undefined
        : await collectControlledSurfaceDiagnostics(page, trigger, [...relationshipBefore.controls, ...relationshipBefore.owns]);
    const observeUntil = Date.now() + 2000;
    let mutationCount = 0;
    let afterSurfaces = [];
    let relationshipAfter = { controls: [], owns: [] };
    const beforeByKey = new Map(beforeSurfaces.map((surface) => [surface.key, surface]));
    const findCausalSurfaces = (surfaces, relationship) => {
        const relatedIds = new Set([...relationship.controls, ...relationship.owns]);
        return surfaces.filter((surface) => {
            if (!surface.visible)
                return false;
            const related = (surface.key.startsWith("id:") && relatedIds.has(surface.key.slice(3)))
                || Boolean(surface.relatedId && relatedIds.has(surface.relatedId))
                || relationship.controls.includes(surface.key) || relationship.owns.includes(surface.key);
            const before = beforeByKey.get(surface.key);
            const newlyVisible = !before || !before.visible;
            return related
                || (newlyVisible && mutationCount > 0)
                || (activationAlreadyPerformed && !surface.portalized && surface.optionCandidates.length > 0);
        });
    };
    let causalSurfaces = [];
    const directControlledSurface = controlledDiagnostics?.surface
        ?? await inspectRelatedControlledSurface(page, controlledDiagnostics?.meta.ariaControls || relationshipBefore.controls[0] || relationshipBefore.owns[0]);
    if (directControlledSurface) {
        afterSurfaces = [directControlledSurface];
        causalSurfaces = findCausalSurfaces(afterSurfaces, {
            controls: [...new Set([...relationshipBefore.controls, controlledDiagnostics.meta.ariaControls].filter(Boolean))],
            owns: relationshipBefore.owns,
        });
    }
    while (Date.now() < observeUntil) {
        if (causalSurfaces.some((candidate) => candidate.optionCandidates.length > 0))
            break;
        mutationCount = await readSelectionMutationCount(page);
        relationshipAfter = await getSelectionTriggerRelationship(trigger);
        const liveRelatedIds = [...new Set([...relationshipBefore.controls, ...relationshipBefore.owns, ...relationshipAfter.controls, ...relationshipAfter.owns])];
        afterSurfaces = await inspectSelectionSurfaces(page, liveRelatedIds);
        causalSurfaces = findCausalSurfaces(afterSurfaces, relationshipAfter);
        if (causalSurfaces.some((candidate) => candidate.optionCandidates.length > 0))
            break;
        await page.waitForTimeout(100).catch(() => undefined);
    }
    // Some accessible custom comboboxes expose aria-expanded before mounting
    // their popup and complete the opening transaction on the standard
    // keyboard interaction. This is one bounded, state-backed activation: it
    // is attempted only after the control is observable as an expanded
    // combobox, never as a blind retry of the original display click.
    const triggerStillPresent = await trigger.count().catch(() => 0) > 0;
    const expandedCombobox = triggerStillPresent
        && (await trigger.getAttribute("role").catch(() => "")) === "combobox"
        && (await trigger.getAttribute("aria-expanded").catch(() => "")) === "true";
    if (causalSurfaces.every((candidate) => candidate.optionCandidates.length === 0) && expandedCombobox) {
        await trigger.press("ArrowDown").catch(() => undefined);
        const keyboardObserveUntil = Date.now() + 1500;
        while (Date.now() < keyboardObserveUntil) {
            mutationCount = await readSelectionMutationCount(page);
            relationshipAfter = await getSelectionTriggerRelationship(trigger);
            const liveRelatedIds = [...new Set([...relationshipBefore.controls, ...relationshipBefore.owns, ...relationshipAfter.controls, ...relationshipAfter.owns])];
            afterSurfaces = await inspectSelectionSurfaces(page, liveRelatedIds);
            causalSurfaces = findCausalSurfaces(afterSurfaces, relationshipAfter);
            if (causalSurfaces.some((candidate) => candidate.optionCandidates.length > 0))
                break;
            await page.waitForTimeout(100).catch(() => undefined);
        }
    }
    const relationship = {
        controls: [...new Set([...relationshipBefore.controls, ...relationshipAfter.controls])],
        owns: [...new Set([...relationshipBefore.owns, ...relationshipAfter.owns])],
    };
    const relatedIds = new Set([...relationship.controls, ...relationship.owns]);
    if (causalSurfaces.length === 0) {
        causalSurfaces = findCausalSurfaces(afterSurfaces, relationship);
    }
    const surface = causalSurfaces.find((candidate) => candidate.optionCandidates.length > 0);
    const diagnosticsBase = {
        triggerResolved: true,
        triggerStrategy,
        ariaRelationshipFound: causalSurfaces.some((candidate) => (candidate.key.startsWith("id:") && relatedIds.has(candidate.key.slice(3)))
            || Boolean(candidate.relatedId && relatedIds.has(candidate.relatedId))),
        surfaceType: surface?.type,
        surfacePortalized: surface?.portalized,
        surfaceCausallyBound: Boolean(surface),
        optionCandidateCount: surface?.optionCandidates.length ?? 0,
        desiredOptionFound: false,
        stateVerified: false,
        comboboxIdentity: controlledDiagnostics?.meta.identity,
        ariaExpanded: controlledDiagnostics?.meta.ariaExpanded,
        ariaControlsValue: controlledDiagnostics?.meta.ariaControls,
        oldControlDetached: !await trigger.count().catch(() => 0),
        newControlIdentity: controlledDiagnostics?.meta.identity,
        ariaControlsReadFromNewControl: Boolean(controlledDiagnostics?.meta.ariaControls),
        controlledSurfaceExistsBefore: controlledBefore.exists,
        controlledSurfaceExistsAfter: controlledDiagnostics?.after.exists,
        controlledSurfaceLifecycle: controlledDiagnostics ? controlledSurfaceLifecycle(controlledBefore, controlledDiagnostics.after, controlledDiagnostics.polls) : "missing",
        controlledSurfaceRole: controlledDiagnostics?.after.role,
        controlledSurfaceVisible: controlledDiagnostics?.after.visible,
        controlledSurfaceChildCount: controlledDiagnostics?.after.childCount,
        controlledSurfaceOptionCount: controlledDiagnostics?.after.optionCount,
        controlledSurfaceVisibleOptionCount: controlledDiagnostics?.after.visibleOptionCount,
        controlledSurfaceOptionVisibility: controlledDiagnostics?.after.optionVisibility,
        globalRoleOptionCount: controlledDiagnostics?.polls.at(-1)?.globalRoleOptionCount,
        globalListboxCount: controlledDiagnostics?.polls.at(-1)?.globalListboxCount,
        globalMenuCount: controlledDiagnostics?.polls.at(-1)?.globalMenuCount,
        nativeOptionCount: controlledDiagnostics?.polls.at(-1)?.nativeOptionCount,
        visibleSelectableCount: controlledDiagnostics?.polls.at(-1)?.visibleSelectableCount,
        optionsFirstObservedAtMs: controlledDiagnostics?.polls.find((poll) => poll.globalRoleOptionCount > 0 || poll.controlled.visibleOptionCount > 0)?.elapsedMs,
        candidateDropReason: undefined,
        openingMethod: controlledDiagnostics?.polls.some((poll) => poll.globalRoleOptionCount > 0) ? "CLICK_OPENS" : "NO_OPENING_METHOD_OBSERVED",
    };
    if (!surface && controlledDiagnostics?.polls.some((poll) => poll.globalRoleOptionCount > 0)) {
        diagnosticsBase.candidateDropReason = controlledDiagnostics.after.optionCount > 0 ? "causal-surface-filter" : "controlled-node-binding";
    }
    const triggerPresent = await trigger.count().catch(() => 0) > 0;
    const triggerTag = triggerPresent ? await trigger.evaluate((element) => element.tagName.toLowerCase()).catch(() => "unknown") : "detached";
    const triggerRole = triggerPresent ? await trigger.getAttribute("role").catch(() => "") : "";
    const triggerExpanded = triggerPresent ? await trigger.getAttribute("aria-expanded").catch(() => "") : "";
    console.log(`[selection-surface-observation] triggerTag=${triggerTag} triggerRole=${triggerRole} ariaControlsPresent=${relationship.controls.length > 0} ariaOwnsPresent=${relationship.owns.length > 0} ariaExpanded=${triggerExpanded} surfaceRoots=${afterSurfaces.length} visibleSurfaceRoots=${afterSurfaces.filter((candidate) => candidate.visible).length} rootsWithOptions=${afterSurfaces.filter((candidate) => candidate.optionCandidates.length > 0).length} relatedRoots=${afterSurfaces.filter((candidate) => Boolean(candidate.relatedId)).length}`);
    console.log(`[selection-surface] triggerResolved=true triggerStrategy=${triggerStrategy} ariaRelationshipFound=${diagnosticsBase.ariaRelationshipFound} surfaceType=${surface?.type ?? "none"} portalized=${surface?.portalized ?? false} causallyBound=${diagnosticsBase.surfaceCausallyBound} optionCandidateCount=${diagnosticsBase.optionCandidateCount} desiredOptionFound=${diagnosticsBase.desiredOptionFound} mutations=${mutationCount}`);
    if (!surface) {
        await removeSelectionMutationObserver(page);
        return selectionFailureResult(optionTarget, "selection_surface_not_observed", { ...diagnosticsBase, failureReason: "selection_surface_not_observed" }, gridDiagnostics);
    }
    const wanted = normalizeText(optionTarget);
    const compatible = surface.optionCandidates.filter((candidate) => {
        const candidateText = normalizeText([candidate.text, candidate.value || ""].join(" "));
        return candidateText === wanted || candidateText.includes(wanted) || wanted.includes(candidateText);
    });
    if (compatible.length === 0) {
        await removeSelectionMutationObserver(page);
        return selectionFailureResult(optionTarget, "option_not_supported", { ...diagnosticsBase, desiredOptionFound: false, failureReason: "option_not_supported", optionResolutionStrategy: "causal_surface_option_compatibility" }, gridDiagnostics);
    }
    if (compatible.length > 1) {
        await removeSelectionMutationObserver(page);
        return selectionFailureResult(optionTarget, "ambiguous_option", { ...diagnosticsBase, desiredOptionFound: true, failureReason: "ambiguous_option", optionResolutionStrategy: "causal_surface_option_compatibility" }, gridDiagnostics);
    }
    const surfaceMarked = await page.evaluate((xpath) => {
        document.querySelectorAll("[data-codex-selection-surface='active']").forEach((element) => element.removeAttribute("data-codex-selection-surface"));
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (!(result instanceof HTMLElement))
            return false;
        result.setAttribute("data-codex-selection-surface", "active");
        return true;
    }, surface.xpath).catch(() => false);
    const candidateRole = compatible[0].role === "menuitem" || compatible[0].role === "menuitemradio" || compatible[0].role === "menuitemcheckbox"
        ? compatible[0].role
        : compatible[0].role === "option" ? "option" : "button";
    const liveOptions = page.locator(candidateRole === "option"
        ? "[role='option']"
        : candidateRole === "menuitem" ? "[role='menuitem']"
            : candidateRole === "menuitemradio" ? "[role='menuitemradio']"
                : candidateRole === "menuitemcheckbox" ? "[role='menuitemcheckbox']" : "button");
    const domOptionCount = await page.evaluate(() => document.querySelectorAll("[role='option'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [data-value], button").length).catch(() => 0);
    console.log(`[selection-surface-options] candidateRole=${candidateRole} surfaceMarked=${surfaceMarked} liveOptionCount=${await liveOptions.count().catch(() => 0)} domOptionCount=${domOptionCount}`);
    let option;
    let optionRequiresDomActivation = false;
    const observedOptionMarker = compatible[0].marker;
    if (observedOptionMarker) {
        const observedOption = page.locator(`[data-codex-selection-option="${observedOptionMarker}"]`);
        if (await observedOption.count().catch(() => 0) === 1) {
            if (await observedOption.isVisible().catch(() => false)) {
                option = observedOption;
            }
            else if (await observedOption.evaluate((element) => {
                const root = element.closest("[data-codex-selection-surface='active']");
                if (!root)
                    return false;
                const rootNode = root;
                const rootStyle = window.getComputedStyle(rootNode);
                const node = element;
                const style = window.getComputedStyle(node);
                return !rootNode.hidden && rootNode.getAttribute("aria-hidden") !== "true"
                    && rootStyle.display !== "none" && rootStyle.visibility !== "hidden" && Number(rootStyle.opacity || "1") > 0
                    && !node.hidden && node.getAttribute("aria-hidden") !== "true"
                    && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0;
            }).catch(() => false)) {
                // The related surface is the visible interaction owner even when the
                // option itself has no layout box. Keep the causal marker and use a
                // DOM activation followed by the same state verification.
                option = observedOption;
                optionRequiresDomActivation = true;
            }
        }
    }
    for (let index = 0; index < await liveOptions.count().catch(() => 0); index += 1) {
        if (option)
            break;
        const candidate = liveOptions.nth(index);
        if (!(await candidate.isVisible().catch(() => false)))
            continue;
        const candidateState = await candidate.evaluate((element) => ({
            text: element.innerText || element.textContent || "",
            value: element.getAttribute("data-value") || element.getAttribute("value") || "",
        })).catch(() => ({ text: "", value: "" }));
        const candidateKey = normalizeText([candidateState.text, candidateState.value].join(" "));
        const compatibleKey = normalizeText([compatible[0].text, compatible[0].value || ""].join(" "));
        const inCausalSurface = await candidate.evaluate((element, expected) => {
            if (element.closest("[data-codex-selection-surface='active']"))
                return true;
            const root = element.closest("[role='listbox'], [role='menu'], [role='dialog'], [aria-modal='true'], [popover]");
            if (!root || !expected.surfaceRole || root.getAttribute("role") !== expected.surfaceRole)
                return false;
            const visibleItems = Array.from(root.querySelectorAll("[role='option'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [data-value], button"))
                .filter((item) => {
                const node = item;
                const style = window.getComputedStyle(node);
                return !node.hidden && node.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden"
                    && Number(style.opacity || "1") > 0 && Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
            })
                .map((item) => (item.innerText || item.textContent || "").trim())
                .filter(Boolean);
            const expectedItems = expected.optionTexts.map((text) => normalizeText(text)).sort();
            return visibleItems.map((text) => normalizeText(text)).sort().join("|") === expectedItems.join("|");
        }, { surfaceRole: surface.role || "", optionTexts: surface.optionCandidates.map((candidate) => candidate.text || candidate.value || "") }).catch(() => false);
        if (inCausalSurface && (candidateKey === compatibleKey || candidateKey.includes(compatibleKey) || compatibleKey.includes(candidateKey))) {
            option = candidate;
            break;
        }
    }
    if (!option && !surface.portalized && stableCell) {
        const scopedOptions = stableCell.locator("[role='option'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [data-value], button");
        const compatibleScoped = [];
        const scopedCount = await scopedOptions.count().catch(() => 0);
        for (let index = 0; index < scopedCount; index += 1) {
            const candidate = scopedOptions.nth(index);
            if (!(await candidate.isVisible().catch(() => false)))
                continue;
            const state = await candidate.evaluate((element) => ({
                text: element.innerText || element.textContent || "",
                value: element.getAttribute("data-value") || element.getAttribute("value") || "",
            })).catch(() => ({ text: "", value: "" }));
            const key = normalizeText([state.text, state.value].join(" "));
            const wantedKey = normalizeText([compatible[0].text, compatible[0].value || ""].join(" "));
            if (key === wantedKey || key.includes(wantedKey) || wantedKey.includes(key))
                compatibleScoped.push(candidate);
        }
        console.log(`[selection-surface-cell-option] stableCell=true scopedOptionCount=${scopedCount} compatibleOptionCount=${compatibleScoped.length}`);
        if (compatibleScoped.length === 1)
            option = compatibleScoped[0];
    }
    let optionClickedBySurfaceIdentity = false;
    // The option snapshot is already scoped to the causal surface. Prefer its
    // structural identity when a rematerialized in-cell surface cannot be
    // marked through the parent XPath (for example while React replaces the
    // cell subtree between observation and interaction).
    if (!option) {
        const directOption = page.locator(`xpath=${compatible[0].xpath}`);
        const directOptionCount = await directOption.count().catch(() => 0);
        console.log(`[selection-surface-direct-option] surfacePathResolved=${surfaceMarked} directOptionCount=${directOptionCount}`);
        if (directOptionCount === 1 && await directOption.isVisible().catch(() => false)) {
            const directState = await directOption.evaluate((element) => ({
                text: element.innerText || element.textContent || "",
                value: element.getAttribute("data-value") || element.getAttribute("value") || "",
            })).catch(() => ({ text: "", value: "" }));
            const directKey = normalizeText([directState.text, directState.value].join(" "));
            const compatibleKey = normalizeText([compatible[0].text, compatible[0].value || ""].join(" "));
            if (directKey === compatibleKey || directKey.includes(compatibleKey) || compatibleKey.includes(directKey))
                option = directOption;
        }
    }
    if (!option) {
        optionClickedBySurfaceIdentity = await page.evaluate(async ({ surfaceRole, optionTexts, wanted }) => {
            if (!surfaceRole)
                return false;
            const normalize = (text) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
            const isVisible = (element) => {
                const node = element;
                const style = window.getComputedStyle(node);
                return !node.hidden && node.getAttribute("aria-hidden") !== "true" && style.display !== "none" && style.visibility !== "hidden"
                    && Number(style.opacity || "1") > 0 && Boolean(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
            };
            const expectedItems = optionTexts.map(normalize).sort().join("|");
            const deadline = Date.now() + 1500;
            while (Date.now() < deadline) {
                const roots = Array.from(document.querySelectorAll("[role='listbox'], [role='menu'], [role='dialog'], [aria-modal='true'], [popover]"))
                    .filter((root) => root.getAttribute("role") === surfaceRole && isVisible(root))
                    .map((root) => {
                    const items = Array.from(root.querySelectorAll("[role='option'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [data-value], button"))
                        .filter(isVisible);
                    return { root, items, itemTexts: items.map((item) => normalize(item.innerText || item.textContent || "")).sort() };
                })
                    .filter((candidate) => candidate.itemTexts.join("|") === expectedItems);
                if (roots.length === 1) {
                    const wantedKey = normalize(wanted);
                    const matches = roots[0].items.filter((item) => {
                        const text = normalize(item.innerText || item.textContent || "");
                        const value = normalize(item.getAttribute("data-value") || item.getAttribute("value") || "");
                        return text === wantedKey || value === wantedKey || text.includes(wantedKey) || wantedKey.includes(text);
                    });
                    if (matches.length === 1) {
                        matches[0].click();
                        return true;
                    }
                }
                await new Promise((resolve) => window.setTimeout(resolve, 50));
            }
            return false;
        }, {
            surfaceRole: surface.role || "",
            optionTexts: surface.optionCandidates.map((candidate) => candidate.text || candidate.value || ""),
            wanted: optionTarget,
        }).catch(() => false);
    }
    if (!option && !optionClickedBySurfaceIdentity) {
        await page.locator("[data-codex-selection-surface='active']").evaluateAll((elements) => elements.forEach((element) => element.removeAttribute("data-codex-selection-surface"))).catch(() => undefined);
        await removeSelectionMutationObserver(page);
        return selectionFailureResult(optionTarget, "selection_surface_not_observed", { ...diagnosticsBase, failureReason: "selection_surface_not_observed" }, gridDiagnostics);
    }
    if (option) {
        if (optionRequiresDomActivation)
            await option.evaluate((element) => element.click());
        else
            await option.click();
    }
    await page.locator("[data-codex-selection-surface='active']").evaluateAll((elements) => elements.forEach((element) => element.removeAttribute("data-codex-selection-surface"))).catch(() => undefined);
    const verification = await verifySelectionState(trigger, optionTarget, beforeState, beforeCellText, beforeSurfaces, stableCell);
    await removeSelectionMutationObserver(page);
    const diagnostics = {
        ...diagnosticsBase,
        desiredOptionFound: true,
        optionResolutionStrategy: "causal_surface_option_compatibility",
        stateVerified: verification.verified,
        overlayClosed: verification.overlayClosed,
        failureReason: verification.verified ? undefined : "selection_state_not_verified",
    };
    if (!verification.verified)
        return selectionFailureResult(optionTarget, "selection_state_not_verified", diagnostics, gridDiagnostics);
    return {
        status: "resolved",
        target: optionTarget,
        locator: option,
        locatorStrategy: "selection_option_causal_surface",
        confidence: 0.98,
        matchReason: "selection_option_state_verified",
        candidateText: optionTarget,
        candidates: [],
        selectionApplied: true,
        selectionDiagnostics: diagnostics,
        gridDiagnostics,
    };
}
/**
 * Bounded state machine for compound grid editors. A click is retried only
 * after the same cell reports an observable editor/control transition.
 */
async function resolveAndApplySelectionSurface(page, trigger, optionTarget, triggerStrategy, gridDiagnostics, cellOverride) {
    const cell = cellOverride ?? await resolveStableSelectionCell(page, trigger);
    if (!cell)
        return resolveAndApplySelectionSurfaceOnce(page, trigger, optionTarget, triggerStrategy, gridDiagnostics);
    let currentTrigger = trigger;
    let before = await captureDynamicEditorSnapshot(cell, currentTrigger);
    const initialState = dynamicEditorStateFor(before);
    const transitionsObserved = [initialState ?? "DISPLAY"];
    const progressPerAttempt = [];
    let activationAttempts = 0;
    let domReplacementObserved = false;
    let editorMaterialized = before.editableDescendants > 0;
    let editorIdentity = before.targetIdentity;
    let comboboxObserved = before.targetRole === "combobox" || before.controls.some((control) => control.role === "combobox");
    let comboboxObservedAtState = comboboxObserved ? "SELECTION_CONTROL_READY" : undefined;
    let optionObservedAtState;
    let lastResult;
    let keyboardFallbackAttempted = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        activationAttempts += 1;
        // A rematerialized in-cell combobox can be usable through keyboard
        // typeahead before its popup is mounted. Prefer that state-backed path
        // once, before clicking a control whose React subtree may immediately be
        // replaced by the application.
        if (attempt === 0 && (before.targetRole === "combobox" || before.targetTag === "select")) {
            keyboardFallbackAttempted = true;
            const beforeKeyboardState = await captureSelectionTriggerState(currentTrigger);
            const beforeKeyboardCellText = await cell.innerText().catch(() => "");
            console.log(`[selection-keyboard-fallback] triggerTag=${before.targetTag} triggerRole=${before.targetRole || "none"} valueSource=dataset state=ready_before_surface`);
            await currentTrigger.focus().catch(() => undefined);
            await currentTrigger.press("Home").catch(() => undefined);
            await currentTrigger.pressSequentially(optionTarget, { delay: 10 }).catch(() => undefined);
            await currentTrigger.press("Enter").catch(() => undefined);
            const keyboardVerification = await verifySelectionState(currentTrigger, optionTarget, beforeKeyboardState, beforeKeyboardCellText, [], cell);
            console.log(`[selection-keyboard-fallback] verified=${keyboardVerification.verified} overlayClosed=${keyboardVerification.overlayClosed}`);
            if (keyboardVerification.verified) {
                return {
                    status: "resolved",
                    target: optionTarget,
                    locator: currentTrigger,
                    locatorStrategy: "selection_keyboard_typeahead",
                    confidence: 0.96,
                    matchReason: "selection_option_state_verified_by_keyboard",
                    candidateText: optionTarget,
                    candidates: [],
                    selectionApplied: true,
                    selectionDiagnostics: {
                        triggerResolved: true,
                        triggerStrategy,
                        surfaceCausallyBound: true,
                        optionCandidateCount: 0,
                        desiredOptionFound: true,
                        optionResolutionStrategy: "keyboard_typeahead_dataset_value",
                        stateVerified: true,
                        overlayClosed: keyboardVerification.overlayClosed,
                    },
                    gridDiagnostics,
                };
            }
        }
        lastResult = await resolveAndApplySelectionSurfaceOnce(page, currentTrigger, optionTarget, triggerStrategy, gridDiagnostics);
        // Some rematerialized controls accept typeahead only after their first
        // activation. Keep this bounded to the already observed combobox state
        // and the same structural cell; do not re-resolve page-wide candidates.
        if (attempt === 0 && (before.targetRole === "combobox" || before.targetTag === "select")
            && lastResult.matchReason === "selection_surface_not_observed") {
            const afterActivationState = await captureSelectionTriggerState(currentTrigger);
            const afterActivationCellText = await cell.innerText().catch(() => "");
            console.log(`[selection-keyboard-fallback] triggerTag=${before.targetTag} triggerRole=${before.targetRole || "none"} valueSource=dataset state=after_activation`);
            await currentTrigger.focus().catch(() => undefined);
            await currentTrigger.press("Home").catch(() => undefined);
            await currentTrigger.pressSequentially(optionTarget, { delay: 10 }).catch(() => undefined);
            await currentTrigger.press("Enter").catch(() => undefined);
            const afterActivationVerification = await verifySelectionState(currentTrigger, optionTarget, afterActivationState, afterActivationCellText, [], cell);
            console.log(`[selection-keyboard-fallback] verified=${afterActivationVerification.verified} overlayClosed=${afterActivationVerification.overlayClosed}`);
            if (afterActivationVerification.verified) {
                return {
                    status: "resolved",
                    target: optionTarget,
                    locator: currentTrigger,
                    locatorStrategy: "selection_keyboard_typeahead",
                    confidence: 0.96,
                    matchReason: "selection_option_state_verified_by_keyboard",
                    candidateText: optionTarget,
                    candidates: [],
                    selectionApplied: true,
                    selectionDiagnostics: {
                        triggerResolved: true,
                        triggerStrategy,
                        surfaceCausallyBound: true,
                        optionCandidateCount: 0,
                        desiredOptionFound: true,
                        optionResolutionStrategy: "keyboard_typeahead_dataset_value",
                        stateVerified: true,
                        overlayClosed: afterActivationVerification.overlayClosed,
                    },
                    gridDiagnostics,
                };
            }
        }
        const selectionDiagnostics = lastResult.selectionDiagnostics;
        if (selectionDiagnostics?.surfaceCausallyBound && selectionDiagnostics.optionCandidateCount > 0) {
            optionObservedAtState = "OPTIONS_VISIBLE";
            if (!transitionsObserved.includes("OPTIONS_VISIBLE"))
                transitionsObserved.push("OPTIONS_VISIBLE");
        }
        if (lastResult.matchReason !== "selection_surface_not_observed")
            break;
        // Some browser-native/custom comboboxes expose no DOM option surface at
        // all: aria-controls points to a stale/nonexistent node and the option
        // popup is owned by the browser UI. Use the recorded dataset value as
        // typeahead input, then verify the control/cell state before accepting it.
        if (attempt === 0 && !keyboardFallbackAttempted) {
            const triggerRole = await currentTrigger.getAttribute("role").catch(() => "");
            const triggerTag = await currentTrigger.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
            if (triggerRole === "combobox" || triggerTag === "select") {
                const beforeState = await captureSelectionTriggerState(currentTrigger);
                const beforeCellText = await cell.innerText().catch(() => "");
                console.log(`[selection-keyboard-fallback] triggerTag=${triggerTag} triggerRole=${triggerRole || "none"} valueSource=dataset`);
                await currentTrigger.focus().catch(() => undefined);
                await currentTrigger.press("Home").catch(() => undefined);
                await currentTrigger.pressSequentially(optionTarget, { delay: 10 }).catch(() => undefined);
                await currentTrigger.press("Enter").catch(() => undefined);
                const verification = await verifySelectionState(currentTrigger, optionTarget, beforeState, beforeCellText, [], cell);
                console.log(`[selection-keyboard-fallback] verified=${verification.verified} overlayClosed=${verification.overlayClosed}`);
                if (verification.verified) {
                    return {
                        status: "resolved",
                        target: optionTarget,
                        locator: currentTrigger,
                        locatorStrategy: "selection_keyboard_typeahead",
                        confidence: 0.96,
                        matchReason: "selection_option_state_verified_by_keyboard",
                        candidateText: optionTarget,
                        candidates: [],
                        selectionApplied: true,
                        selectionDiagnostics: {
                            triggerResolved: true,
                            triggerStrategy,
                            surfaceCausallyBound: true,
                            optionCandidateCount: 0,
                            desiredOptionFound: true,
                            optionResolutionStrategy: "keyboard_typeahead_dataset_value",
                            stateVerified: true,
                            overlayClosed: verification.overlayClosed,
                        },
                        gridDiagnostics,
                    };
                }
            }
        }
        const after = await captureDynamicEditorSnapshot(cell, currentTrigger);
        const progress = compareDynamicEditorSnapshots(before, after);
        progressPerAttempt.push(progress.observableProgress);
        domReplacementObserved ||= progress.domReplaced;
        editorMaterialized ||= progress.newEditableControl || after.editableDescendants > 0;
        if (after.targetRole === "combobox" || after.controls.some((control) => control.role === "combobox")) {
            comboboxObserved = true;
            comboboxObservedAtState ||= "SELECTION_CONTROL_READY";
        }
        const afterState = dynamicEditorStateFor(after);
        if (afterState && afterState !== transitionsObserved[transitionsObserved.length - 1])
            transitionsObserved.push(afterState);
        console.log(`[selection-editor-state] attempt=${activationAttempts} observableProgress=${progress.observableProgress} targetIdentityChanged=${progress.targetIdentityChanged} domReplaced=${progress.domReplaced} roleChanged=${progress.roleChanged} newDescendants=${progress.newDescendants} activeElementChanged=${progress.activeElementChanged} newEditableControl=${progress.newEditableControl} newSelectableControl=${progress.newSelectableControl} afterTag=${after.targetTag} afterRole=${after.targetRole} afterAriaControls=${Boolean(after.ariaControls)} afterAriaExpanded=${after.ariaExpanded || ""}`);
        if (!progress.observableProgress)
            break;
        // If a prior activation left an expandable control open but no usable
        // surface was observed, close it before the next bounded activation.
        // Escape is reversible and avoids a blind click being intercepted by the
        // overlay/backdrop.
        if (await currentTrigger.count().catch(() => 0) > 0
            && await currentTrigger.getAttribute("aria-expanded").catch(() => "") === "true") {
            await page.keyboard.press("Escape").catch(() => undefined);
        }
        const rematerialized = await findRematerializedEditor(cell, before);
        if (rematerialized.locator && rematerialized.snapshot) {
            currentTrigger = rematerialized.locator;
            editorIdentity = rematerialized.snapshot.identity;
            const nextState = rematerialized.snapshot.role === "combobox" || rematerialized.snapshot.tag === "select"
                ? "SELECTION_CONTROL_READY"
                : rematerialized.snapshot.editable ? "EDITOR_MATERIALIZED" : "CELL_ACTIVE";
            if (!transitionsObserved.includes(nextState))
                transitionsObserved.push(nextState);
            if (nextState === "SELECTION_CONTROL_READY") {
                comboboxObserved ||= rematerialized.snapshot.role === "combobox";
                comboboxObservedAtState ||= nextState;
            }
            before = after;
            continue;
        }
        // A replaced display can leave only the already-observed option surface
        // in the cell. It is not a new trigger and retrying the detached locator
        // would wait for the default Playwright timeout without adding evidence.
        const hasNewSelectionControl = after.controls.some((control) => control.visible && control.enabled && control.selectionAffordance
            && !["option", "menuitem", "menuitemradio", "menuitemcheckbox"].includes(control.role || ""));
        if (!hasNewSelectionControl && await currentTrigger.count().catch(() => 0) === 0)
            break;
        // A role/ARIA transition can rematerialize the same DOM address. Reuse
        // the locator only when that transition itself is the observed progress.
        if (progress.roleChanged || progress.activeElementChanged) {
            editorIdentity = after.targetIdentity || editorIdentity;
            before = after;
            continue;
        }
        break;
    }
    const diagnostics = {
        ...(lastResult?.selectionDiagnostics ?? {
            triggerResolved: true,
            triggerStrategy,
            ariaRelationshipFound: false,
            surfaceCausallyBound: false,
            optionCandidateCount: 0,
            desiredOptionFound: false,
            stateVerified: false,
            failureReason: "selection_surface_not_observed",
        }),
        initialState,
        transitionsObserved,
        activationAttempts,
        progressPerAttempt,
        domReplacementObserved,
        editorMaterialized,
        editorIdentity,
        comboboxObserved,
        comboboxObservedAtState,
        optionObservedAtState,
    };
    if (!lastResult)
        return selectionFailureResult(optionTarget, "selection_surface_not_observed", diagnostics, gridDiagnostics);
    return { ...lastResult, selectionDiagnostics: diagnostics };
}
async function tryResolveSelectionOptionViaField(page, target, selectionField, context = {}, selectionValue) {
    const fieldLabel = selectionField?.trim();
    if (!fieldLabel)
        return undefined;
    const optionTarget = selectionValue?.trim() || target;
    const buildResult = (locator, strategy, reason) => ({
        status: "resolved",
        target,
        locator,
        locatorStrategy: strategy,
        confidence: 0.93,
        matchReason: reason,
        candidateText: target,
        candidates: []
    });
    // A scoped grid row has authority over any page-wide accessible-label match.
    // Resolve its cell before trying generic form labels so another row cannot
    // consume the action merely because it rendered first.
    if (context.rowScope !== undefined || context.entityScope || context.associatedField) {
        // A logical selection may be rendered by the control of its associated
        // column (e.g. a currency chooser inside the income cell). Use only the
        // declared relationship as a fallback; no column/index inference is used.
        const gridFields = [fieldLabel, context.associatedField]
            .map((field) => field?.trim())
            .filter((field, index, fields) => Boolean(field) && fields.indexOf(field) === index);
        for (const gridField of gridFields) {
            const grid = await resolveGridEditor(page, gridField, context, {
                includeInteractiveControls: true,
                controlKind: "selection",
                optionText: optionTarget,
            });
            if (grid.ambiguous) {
                return {
                    status: "ambiguous",
                    target,
                    confidence: 0.5,
                    matchReason: "ambiguous_grid_selection_control",
                    candidateText: target,
                    candidates: [],
                    gridDiagnostics: grid.diagnostics,
                };
            }
            if (!grid.locator)
                continue;
            const tagName = await grid.locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
            if (tagName === "select") {
                return {
                    ...buildResult(grid.locator, grid.strategy ?? "grid_cell_select", "grid_cell_editor_resolved"),
                    gridDiagnostics: grid.diagnostics,
                };
            }
            // A selection without a runtime value is an exploratory/action step.
            // Preserve its existing behavior: activate the resolved trigger and
            // resolve the declared visible option. Causal value selection below is
            // reserved for runtime-backed selections with an explicit desired value.
            if (!selectionValue?.trim()) {
                await grid.locator.click().catch(() => undefined);
                await page.waitForTimeout(100).catch(() => undefined);
                const option = await resolveVisibleSelectionOption(page, optionTarget);
                if (option) {
                    return {
                        ...buildResult(option, "selection_option_grid_cell", "grid_cell_activated_and_option_opened"),
                        gridDiagnostics: grid.diagnostics,
                    };
                }
                continue;
            }
            const initialRole = await grid.locator.getAttribute("role").catch(() => "");
            const initialPopup = await grid.locator.getAttribute("aria-haspopup").catch(() => "");
            const initialExpanded = await grid.locator.getAttribute("aria-expanded").catch(() => null);
            const initialControls = await grid.locator.getAttribute("aria-controls").catch(() => "");
            const displayOnlyTrigger = tagName === "button"
                && !initialRole && !initialPopup && !initialExpanded && !initialControls;
            console.log(`[grid-compound] selectionValuePresent=${Boolean(selectionValue?.trim())} tag=${tagName} role=${initialRole || "none"} expanded=${initialExpanded ?? "missing"} controls=${Boolean(initialControls)} displayOnly=${displayOnlyTrigger}`);
            if (displayOnlyTrigger && grid.cell) {
                const beforeCellText = await grid.cell.innerText().catch(() => "");
                const beforeCellMarkup = await grid.cell.evaluate((element) => element.outerHTML).catch(() => "");
                const beforeSurfaceKeys = new Set((await inspectSelectionSurfaces(page)).map((surface) => surface.key));
                const beforeTriggerState = await captureSelectionTriggerState(grid.locator);
                let secondActivationAttempted = false;
                console.log(`[grid-compound-activation] strategy=${grid.strategy ?? "grid_cell_activation"} action=click`);
                await grid.locator.click({ noWaitAfter: true }).catch(() => undefined);
                console.log(`[grid-compound-activation] clickCompleted=true`);
                const materializationDeadline = Date.now() + 2000;
                while (Date.now() < materializationDeadline) {
                    const rematerialized = await resolveGridEditor(page, gridField, context, {
                        includeInteractiveControls: true,
                        controlKind: "selection",
                        optionText: optionTarget,
                        allowActivation: false,
                    });
                    if (rematerialized.locator) {
                        const rematerializedTag = await rematerialized.locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");
                        const rematerializedRole = await rematerialized.locator.getAttribute("role").catch(() => "");
                        const rematerializedPopup = await rematerialized.locator.getAttribute("aria-haspopup").catch(() => "");
                        const rematerializedExpanded = await rematerialized.locator.getAttribute("aria-expanded").catch(() => null);
                        const rematerializedControls = await rematerialized.locator.getAttribute("aria-controls").catch(() => "");
                        const selectable = rematerializedTag === "select" || rematerializedRole === "combobox"
                            || Boolean(rematerializedPopup) || rematerializedExpanded !== null || Boolean(rematerializedControls);
                        const stillDisplayOnly = rematerializedTag === "button" && !rematerializedRole
                            && !rematerializedPopup && !rematerializedExpanded && !rematerializedControls;
                        if (selectable && !stillDisplayOnly) {
                            if (rematerializedTag === "select") {
                                return {
                                    ...buildResult(rematerialized.locator, rematerialized.strategy ?? "grid_cell_select_after_activation", "grid_cell_selection_control_after_activation"),
                                    gridDiagnostics: rematerialized.diagnostics,
                                };
                            }
                            return resolveAndApplySelectionSurface(page, rematerialized.locator, optionTarget, rematerialized.strategy ?? "grid_cell_selection_control_after_activation", rematerialized.diagnostics, rematerialized.cell);
                        }
                    }
                    const observedSurface = (await inspectSelectionSurfaces(page)).find((surface) => !beforeSurfaceKeys.has(surface.key) && surface.visible && surface.optionCandidates.length > 0);
                    if (observedSurface) {
                        const wanted = normalizeText(optionTarget);
                        const compatible = observedSurface.optionCandidates.filter((candidate) => {
                            const candidateKey = normalizeText([candidate.text, candidate.value || ""].join(" "));
                            return candidateKey === wanted || candidateKey.includes(wanted) || wanted.includes(candidateKey);
                        });
                        if (compatible.length !== 1) {
                            return selectionFailureResult(optionTarget, compatible.length > 1 ? "ambiguous_option" : "option_not_supported", {
                                triggerResolved: true,
                                triggerStrategy: grid.strategy ?? "grid_cell_activation",
                                surfaceType: observedSurface.type,
                                surfacePortalized: observedSurface.portalized,
                                surfaceCausallyBound: true,
                                optionCandidateCount: observedSurface.optionCandidates.length,
                                desiredOptionFound: compatible.length > 0,
                                stateVerified: false,
                                optionResolutionStrategy: "causal_surface_option_compatibility",
                                failureReason: compatible.length > 1 ? "ambiguous_option" : "option_not_supported",
                            }, grid.diagnostics);
                        }
                        const option = page.locator(`xpath=${compatible[0].xpath}`);
                        if (await option.count().catch(() => 0) !== 1 || !(await option.isVisible().catch(() => false))) {
                            return selectionFailureResult(optionTarget, "selection_surface_not_observed", {
                                triggerResolved: true,
                                triggerStrategy: grid.strategy ?? "grid_cell_activation",
                                surfaceType: observedSurface.type,
                                surfacePortalized: observedSurface.portalized,
                                surfaceCausallyBound: true,
                                optionCandidateCount: observedSurface.optionCandidates.length,
                                desiredOptionFound: true,
                                stateVerified: false,
                                failureReason: "selection_surface_not_observed",
                            }, grid.diagnostics);
                        }
                        await option.click();
                        const verification = await verifySelectionState(grid.locator, optionTarget, beforeTriggerState, beforeCellText, [observedSurface], grid.cell);
                        return verification.verified
                            ? {
                                status: "resolved",
                                target: optionTarget,
                                locator: option,
                                locatorStrategy: "selection_option_causal_surface",
                                confidence: 0.98,
                                matchReason: "selection_option_state_verified",
                                candidateText: optionTarget,
                                candidates: [],
                                selectionApplied: true,
                                gridDiagnostics: grid.diagnostics,
                                selectionDiagnostics: {
                                    triggerResolved: true,
                                    triggerStrategy: grid.strategy ?? "grid_cell_activation",
                                    surfaceType: observedSurface.type,
                                    surfacePortalized: observedSurface.portalized,
                                    surfaceCausallyBound: true,
                                    optionCandidateCount: observedSurface.optionCandidates.length,
                                    desiredOptionFound: true,
                                    optionResolutionStrategy: "causal_surface_option_compatibility",
                                    stateVerified: true,
                                    overlayClosed: verification.overlayClosed,
                                },
                            }
                            : selectionFailureResult(optionTarget, "selection_state_not_verified", {
                                triggerResolved: true,
                                triggerStrategy: grid.strategy ?? "grid_cell_activation",
                                surfaceType: observedSurface.type,
                                surfacePortalized: observedSurface.portalized,
                                surfaceCausallyBound: true,
                                optionCandidateCount: observedSurface.optionCandidates.length,
                                desiredOptionFound: true,
                                stateVerified: false,
                                failureReason: "selection_state_not_verified",
                            }, grid.diagnostics);
                    }
                    const currentCellMarkup = await grid.cell.evaluate((element) => element.innerHTML).catch(() => beforeCellMarkup);
                    if (!secondActivationAttempted && currentCellMarkup !== beforeCellMarkup) {
                        secondActivationAttempted = true;
                        const secondOpening = await resolveAndApplySelectionSurface(page, grid.locator, optionTarget, grid.strategy ?? "grid_cell_selection_control_after_activation", grid.diagnostics, grid.cell);
                        if (secondOpening.status === "resolved" || secondOpening.matchReason !== "selection_surface_not_observed")
                            return secondOpening;
                    }
                    await page.waitForTimeout(100).catch(() => undefined);
                }
                return selectionFailureResult(optionTarget, "selection_surface_not_observed", {
                    triggerResolved: true,
                    triggerStrategy: grid.strategy ?? "grid_cell_activation",
                    surfaceCausallyBound: false,
                    optionCandidateCount: 0,
                    desiredOptionFound: false,
                    stateVerified: false,
                    failureReason: "selection_surface_not_observed",
                }, grid.diagnostics);
            }
            const firstSurfaceResolution = await resolveAndApplySelectionSurface(page, grid.locator, optionTarget, grid.strategy ?? "grid_cell_selection_control", grid.diagnostics, grid.cell);
            if (firstSurfaceResolution.status === "resolved" || firstSurfaceResolution.matchReason !== "selection_surface_not_observed") {
                return firstSurfaceResolution;
            }
            // Compound cells may expose a trigger first and render the actual
            // selection control only after activation. Re-resolve the same
            // row/column intersection before falling back to page-wide options.
            const activatedGrid = await resolveGridEditor(page, gridField, context, {
                includeInteractiveControls: true,
                controlKind: "selection",
                optionText: optionTarget,
            });
            if (activatedGrid.ambiguous) {
                return {
                    status: "ambiguous",
                    target,
                    confidence: 0.5,
                    matchReason: "ambiguous_grid_selection_control_after_activation",
                    candidateText: target,
                    candidates: [],
                    gridDiagnostics: activatedGrid.diagnostics,
                };
            }
            const activatedTagName = activatedGrid.locator
                ? await activatedGrid.locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "")
                : "";
            if (activatedGrid.locator && (activatedTagName === "select" || activatedTagName === "input" || activatedTagName === "textarea" || activatedTagName === "button" || activatedTagName === "div" || activatedTagName === "span")) {
                if (activatedTagName === "select") {
                    return {
                        ...buildResult(activatedGrid.locator, activatedGrid.strategy ?? "grid_cell_select_after_activation", "grid_cell_selection_control_after_activation"),
                        gridDiagnostics: activatedGrid.diagnostics,
                    };
                }
                const secondSurfaceResolution = await resolveAndApplySelectionSurface(page, activatedGrid.locator, optionTarget, activatedGrid.strategy ?? "grid_cell_selection_control_after_activation", activatedGrid.diagnostics, activatedGrid.cell);
                if (secondSurfaceResolution.status === "resolved" || secondSurfaceResolution.matchReason !== "selection_surface_not_observed") {
                    return secondSurfaceResolution;
                }
                return secondSurfaceResolution;
            }
            return firstSurfaceResolution;
        }
    }
    const alreadyVisible = await resolveVisibleSelectionOption(page, optionTarget);
    if (alreadyVisible)
        return buildResult(alreadyVisible, "selection_option", "option_already_visible");
    const fieldLocators = [
        page.getByRole("combobox", { name: fieldLabel, exact: false }),
        page.getByLabel(fieldLabel, { exact: false })
    ];
    for (const fieldLocator of fieldLocators) {
        const count = await fieldLocator.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
            const candidate = fieldLocator.nth(index);
            if (!(await candidate.isVisible().catch(() => false)))
                continue;
            await candidate.click().catch(() => undefined);
            await page.waitForTimeout(250).catch(() => undefined);
            const option = await resolveVisibleSelectionOption(page, optionTarget);
            if (option) {
                console.log(`[target-resolver] selection_field_resolved target="${target}" field="${fieldLabel}" strategy=label`);
                return buildResult(option, "selection_field_label", "field_opened_by_label");
            }
        }
    }
    const tables = page.locator("table");
    const tableCount = await tables.count().catch(() => 0);
    for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
        const table = tables.nth(tableIndex);
        const headerCells = table.locator("thead th, thead td, [role='columnheader']");
        const headerCount = await headerCells.count().catch(() => 0);
        const effectiveHeaders = headerCount > 0 ? headerCells : table.locator("tr").first().locator("th, td, [role='columnheader']");
        const effectiveHeaderCount = await effectiveHeaders.count().catch(() => 0);
        let fieldColumn = -1;
        for (let columnIndex = 0; columnIndex < effectiveHeaderCount; columnIndex += 1) {
            const headerText = await effectiveHeaders.nth(columnIndex).innerText().catch(() => "");
            if (fieldLabelMatchesHeader(fieldLabel, headerText)) {
                fieldColumn = columnIndex;
                break;
            }
        }
        if (fieldColumn < 0)
            continue;
        const rows = table.locator("tbody tr");
        const rowCount = await rows.count().catch(() => 0);
        const effectiveRows = rowCount > 0 ? rows : table.locator("tr").nth(1);
        const effectiveRowCount = rowCount > 0 ? rowCount : await effectiveRows.count().catch(() => 0);
        for (let rowIndex = 0; rowIndex < effectiveRowCount; rowIndex += 1) {
            const row = rowCount > 0 ? rows.nth(rowIndex) : effectiveRows;
            const rowCells = row.locator("td, th");
            const rowCellCount = await rowCells.count().catch(() => 0);
            // Data rows may prepend selection/action cells that are not represented
            // by column headers. Derive that structural offset from the DOM rather
            // than assuming a fixed table position.
            const leadingCellOffset = Math.max(0, rowCellCount - effectiveHeaderCount);
            const cell = rowCells.nth(fieldColumn + leadingCellOffset);
            const controls = cell.locator("button, [role='button'], select, input, [role='combobox']");
            if (await controls.count().catch(() => 0) !== 1)
                continue;
            const control = controls;
            if (!(await control.isVisible().catch(() => false)))
                continue;
            const resolvedSelection = await resolveAndApplySelectionSurface(page, control, optionTarget, "selection_field_table", undefined, cell);
            if (resolvedSelection.status === "resolved" || resolvedSelection.matchReason !== "selection_surface_not_observed") {
                console.log(`[target-resolver] selection_field_resolved target="${target}" field="${fieldLabel}" option="${optionTarget}" strategy=${resolvedSelection.locatorStrategy ?? "selection_field_table"}`);
                return resolvedSelection;
            }
        }
    }
    console.log(`[target-resolver] selection_field_unresolved target="${optionTarget}" field="${fieldLabel}"`);
    return undefined;
}
async function tryResolveTableFieldControl(page, target, context = {}) {
    let grid = await resolveGridEditor(page, target, context);
    // A recorded click can be the prerequisite that turns a display-only cell
    // into an editor. Include interactive display controls for that action path
    // while retaining the same structural row/column authority.
    if (!grid.locator && (context.rowScope !== undefined || context.entityScope || context.associatedField)) {
        grid = await resolveGridEditor(page, target, context, { includeInteractiveControls: true });
    }
    if (grid.locator) {
        return {
            status: "resolved",
            target,
            locator: grid.locator,
            locatorStrategy: grid.strategy ?? "grid_cell_editor",
            confidence: 0.95,
            matchReason: "grid_header_cell_editor",
            candidateText: target,
            candidates: [],
            gridDiagnostics: grid.diagnostics,
        };
    }
    if (context.rowScope !== undefined || context.entityScope || context.associatedField)
        return undefined;
    const tables = page.locator("table");
    const tableCount = await tables.count().catch(() => 0);
    for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
        const table = tables.nth(tableIndex);
        const headerCells = table.locator("thead th, thead td, [role='columnheader']");
        const headerCount = await headerCells.count().catch(() => 0);
        const effectiveHeaders = headerCount > 0 ? headerCells : table.locator("tr").first().locator("th, td, [role='columnheader']");
        const effectiveHeaderCount = await effectiveHeaders.count().catch(() => 0);
        let fieldColumn = -1;
        for (let columnIndex = 0; columnIndex < effectiveHeaderCount; columnIndex += 1) {
            const headerText = await effectiveHeaders.nth(columnIndex).innerText().catch(() => "");
            if (fieldLabelMatchesHeader(target, headerText)) {
                fieldColumn = columnIndex;
                break;
            }
        }
        if (fieldColumn < 0)
            continue;
        const rows = table.locator("tbody tr");
        const rowCount = await rows.count().catch(() => 0);
        const effectiveRows = rowCount > 0 ? rows : table.locator("tr").nth(1);
        const effectiveRowCount = rowCount > 0 ? rowCount : await effectiveRows.count().catch(() => 0);
        for (let rowIndex = 0; rowIndex < effectiveRowCount; rowIndex += 1) {
            const row = rowCount > 0 ? rows.nth(rowIndex) : effectiveRows;
            const rowCells = row.locator("td, th");
            const rowCellCount = await rowCells.count().catch(() => 0);
            const leadingCellOffset = Math.max(0, rowCellCount - effectiveHeaderCount);
            const cell = rowCells.nth(fieldColumn + leadingCellOffset);
            const controls = cell.locator("button, [role='button'], input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox']");
            const controlCount = await controls.count().catch(() => 0);
            for (let controlIndex = 0; controlIndex < controlCount; controlIndex += 1) {
                const control = controls.nth(controlIndex);
                if (!(await control.isVisible().catch(() => false)))
                    continue;
                if (!(await control.isEnabled().catch(() => true)))
                    continue;
                return {
                    status: "resolved",
                    target,
                    locator: control,
                    locatorStrategy: "table_field_control",
                    confidence: 0.92,
                    matchReason: "table_header_field_control",
                    candidateText: target,
                    candidates: []
                };
            }
        }
    }
    return undefined;
}
async function tryResolveGridRowSelectionControl(page, target, context = {}) {
    const containers = page.locator("table, [role='grid']");
    const containerCount = await containers.count().catch(() => 0);
    for (let containerIndex = 0; containerIndex < containerCount; containerIndex += 1) {
        const container = containers.nth(containerIndex);
        const rowCandidates = container.locator("tbody tr, [role='row']");
        const rows = [];
        const rowCount = await rowCandidates.count().catch(() => 0);
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
            const row = rowCandidates.nth(rowIndex);
            if (await row.locator("td, th, [role='gridcell']").count().catch(() => 0) > 0)
                rows.push(row);
        }
        if (rows.length === 0)
            continue;
        const requestedRowIndex = context.rowRelation === "added"
            ? rows.length - 1
            : context.rowScope !== undefined ? context.rowScope - 1 : 0;
        const row = rows[requestedRowIndex];
        if (!row)
            continue;
        const controls = row.getByRole("checkbox", { name: target, exact: false });
        const controlCount = await controls.count().catch(() => 0);
        for (let controlIndex = 0; controlIndex < controlCount; controlIndex += 1) {
            const control = controls.nth(controlIndex);
            if (!(await control.isVisible().catch(() => false)))
                continue;
            if (!(await control.isEnabled().catch(() => true)))
                continue;
            console.log(`[recording-replay] structuredGridRowControlResolved=true target=${JSON.stringify(target)} rowRelation=${context.rowRelation ?? "current"} rowIndex=${requestedRowIndex} strategy=grid_row_checkbox`);
            return {
                status: "resolved",
                target,
                locator: control,
                locatorStrategy: "grid_row_checkbox",
                confidence: 0.96,
                matchReason: "grid_structural_row_checkbox",
                candidateText: target,
                candidates: [],
            };
        }
    }
    return undefined;
}
async function resolveActionTarget(page, snapshot, target, options) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const gridContext = {
        rowScope: opts.rowScope,
        rowRef: opts.rowRef,
        rowRelation: opts.rowRelation,
        entityScope: opts.entityScope,
        associatedField: opts.associatedField,
        recordedTechnicalTargetRefs: opts.recordedTechnicalTargetRefs,
    };
    // A structured recording target is the execution authority. Resolve it
    // before semantic/table/contextual fallbacks so an unrelated visible label
    // cannot be selected when the recorded control is absent or duplicated.
    const expectedSurfaceMismatch = Boolean(opts.expectedRouteBefore && !routeSurfaceMatches(page.url(), opts.expectedRouteBefore));
    const recorded = expectedSurfaceMismatch
        ? undefined
        : await resolveRecordedTechnicalTarget(page, opts.recordedTechnicalTargets, "action", opts.recordedTechnicalTargetRefs);
    if (recorded) {
        console.log(`[recording-replay] technicalTargetResolved=true strategy=${recorded.strategy} currentMatchCount=${recorded.currentMatchCount} structurallyCompatible=${recorded.structuralCompatibility}`);
        return {
            status: "resolved",
            target,
            locator: recorded.locator,
            locatorStrategy: recorded.strategy,
            confidence: recorded.confidence,
            matchReason: "recorded_technical_target_current_dom",
            candidateText: target,
            candidates: [],
        };
    }
    // Runtime-backed custom selections must resolve their causal option surface
    // before the generic grid activation fallback. Otherwise a display trigger
    // can be returned as the action target and the selected value never reaches
    // the current editor state.
    if (opts.actionType === "action_select") {
        const fieldSelectionResult = await tryResolveSelectionOptionViaField(page, target, opts.selectionField, gridContext, opts.selectionValue);
        if (fieldSelectionResult)
            return fieldSelectionResult;
    }
    // A recorded grid activation may point at a display control that the current
    // editor materializes as an input/combobox. Preserve the structured target
    // authority by resolving only the recorded row/column cell before declaring
    // the target absent; never fall back to a page-wide label match here.
    if (!expectedSurfaceMismatch && (gridContext.rowScope !== undefined || gridContext.entityScope || gridContext.associatedField)) {
        const gridTarget = await tryResolveTableFieldControl(page, target, gridContext);
        if (gridTarget) {
            console.log(`[recording-replay] structuredGridTargetResolved=true target="${target}" strategy=${gridTarget.locatorStrategy ?? "grid_cell_editor"}`);
            return gridTarget;
        }
    }
    if (!expectedSurfaceMismatch && opts.actionType === "action_click" && opts.recordingActionType === "check" && (gridContext.rowScope !== undefined || gridContext.entityScope || gridContext.rowRelation)) {
        const gridRowControl = await tryResolveGridRowSelectionControl(page, target, gridContext);
        if (gridRowControl)
            return gridRowControl;
    }
    if ((opts.recordedTechnicalTargetRefs?.length ?? 0) > 0 || (opts.recordedTechnicalTargets?.length ?? 0) > 0) {
        const candidateDetails = snapshot.elements
            .filter((element) => element.visible && (element.type === "button" || element.type === "link" || element.role === "button" || element.role === "link" || element.tagName?.toLowerCase() === "button" || element.tagName?.toLowerCase() === "a"))
            .slice(0, 5)
            .map((element) => {
            const textSummary = [element.text, element.label, element.name, element.ariaLabel, element.title]
                .filter((value) => Boolean(value?.trim()))
                .join(" ")
                .trim();
            let origin;
            let pathname;
            try {
                const url = new URL(element.href ?? snapshot.url);
                origin = url.origin;
                pathname = url.pathname;
            }
            catch {
                // Keep diagnostics available even for a malformed/relative href.
            }
            return {
                elementId: element.id,
                text: textSummary || "(empty)",
                textSummary: textSummary || "(empty)",
                normalizedText: normalizeText(textSummary),
                accessibleName: element.ariaLabel ?? element.label ?? element.name ?? element.text,
                type: element.type,
                role: element.role,
                tagName: element.tagName,
                isClickable: true,
                clickable: true,
                visible: element.visible,
                enabled: !element.disabled,
                boundingBoxPresent: element.visible,
                origin,
                pathname,
                ancestorRoles: [],
                ancestorLabels: [],
                recordedTechnicalIdentityMatch: false,
                structuralCompatibility: false,
                surfaceIdentity: snapshot.technicalScreenKey ?? snapshot.url,
                matchScore: 0,
                matchReason: "current_surface_candidate_not_recorded_target",
                locatorStrategy: element.candidateLocators[0]?.strategy ?? "snapshot",
                href: element.href,
                ariaLabel: element.ariaLabel,
                title: element.title,
                dataTestid: element.dataTestid,
                className: element.className,
            };
        });
        const diagnosticReason = expectedSurfaceMismatch
            ? "recorded_target_wrong_expected_surface"
            : "recorded_target_not_present_or_unique";
        console.log(`[recording-replay] technicalTargetResolved=false reason=${diagnosticReason} currentSurface=${snapshot.technicalScreenKey ?? snapshot.url} candidateCount=${candidateDetails.length} candidateDetails=${JSON.stringify(candidateDetails)}`);
        return {
            status: "not_found",
            target,
            confidence: 0,
            matchReason: expectedSurfaceMismatch
                ? "recorded_target_wrong_expected_surface"
                : "recorded_target_not_present_or_unique_on_current_surface",
            candidateText: "",
            candidates: candidateDetails,
            structuredTargetDiagnostics: {
                recordedTechnicalTargetRefs: opts.recordedTechnicalTargetRefs ?? [],
                currentSurface: snapshot.technicalScreenKey ?? snapshot.url,
                currentUrl: snapshot.url,
                ...(opts.expectedRouteBefore ? { expectedRouteBefore: opts.expectedRouteBefore } : {}),
                candidates: candidateDetails,
            },
        };
    }
    const fieldSelectionResult = opts.actionType === "action_select"
        ? undefined
        : await tryResolveSelectionOptionViaField(page, target, opts.selectionField, gridContext, opts.selectionValue);
    if (fieldSelectionResult)
        return fieldSelectionResult;
    const tableFieldResult = await tryResolveTableFieldControl(page, target, gridContext);
    if (tableFieldResult)
        return tableFieldResult;
    // === Ordinal Selection Pattern Resolution (BEFORE product_condition) ===
    // Must run first to handle "Seleccionar la primera tarjeta visible del listado" patterns
    const ordinalPattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, opts.routeProfile, opts.actionText);
    if (ordinalPattern) {
        console.log(`[target-resolver] Ordinal selection pattern detected: ordinal=${ordinalPattern.ordinal} domainTerm=${ordinalPattern.domainTerm || "none"} target="${target}"`);
        const ordinalResult = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, ordinalPattern, opts.routeProfile, opts.actionText, opts.expectedTarget);
        if (ordinalResult.status === "resolved" && ordinalResult.candidateId) {
            const element = snapshot.elements.find(e => e.id === ordinalResult.candidateId);
            if (element) {
                const resolved = await resolveSnapshotElementLocator(page, {
                    element,
                    target,
                    candidateText: ordinalResult.candidateText,
                    type: "card",
                    tagName: element.tagName,
                    confidence: ordinalResult.confidence,
                    matchReason: `ordinal_selection:${ordinalPattern.ordinal}`
                });
                if (resolved.locator) {
                    return {
                        status: "resolved",
                        target,
                        locator: resolved.locator,
                        locatorStrategy: "ordinal_selection",
                        confidence: ordinalResult.confidence,
                        matchReason: `ordinal_selection:${ordinalPattern.ordinal}`,
                        candidateText: ordinalResult.candidateText,
                        candidateId: ordinalResult.candidateId,
                        candidates: [
                            {
                                elementId: ordinalResult.candidateId,
                                text: ordinalResult.candidateText,
                                normalizedText: normalizeText(ordinalResult.candidateText),
                                type: "card",
                                role: "listitem",
                                tagName: element.tagName,
                                isClickable: true,
                                matchScore: ordinalResult.confidence,
                                matchReason: `ordinal_selection:${ordinalPattern.ordinal}`,
                                locatorStrategy: "ordinal_selection"
                            }
                        ],
                        ordinalSelectionDiagnostics: ordinalResult.diagnostics
                    };
                }
            }
        }
        if (ordinalResult.status === "ambiguous_target") {
            return {
                status: "ambiguous",
                target,
                confidence: ordinalResult.confidence,
                matchReason: "ordinal_selection_ambiguous",
                candidateText: "",
                candidates: [],
                ordinalSelectionDiagnostics: ordinalResult.diagnostics
            };
        }
        if (ordinalResult.status === "no_safe_candidate") {
            return {
                status: "not_found",
                target,
                confidence: 0,
                matchReason: "ordinal_selection_no_safe_candidate",
                candidateText: "",
                candidates: [],
                ordinalSelectionDiagnostics: ordinalResult.diagnostics
            };
        }
    }
    // === Alias-based resolution (BEFORE product_condition) ===
    console.log(`[target-alias] evaluating`);
    const normalizedTargetAlias = normalizeText(target);
    const backNavigationAlias = (/\bvolver\b/.test(normalizedTargetAlias) ||
        /\bregresar\b/.test(normalizedTargetAlias) ||
        /\bvolver\s+al\s+listado\b/.test(normalizedTargetAlias) ||
        /\bregresar\s+al\s+listado\b/.test(normalizedTargetAlias) ||
        /\bvolver\s+atr[�a]s\b/.test(normalizedTargetAlias) ||
        /\bregresar\s+atr[�a]s\b/.test(normalizedTargetAlias));
    // Strategy A: hardcoded back navigation alias
    if (backNavigationAlias) {
        const backButton = page.getByRole("button", { name: buildFlexibleTextRegex("Volver") }).first();
        if (await backButton.count().catch(() => 0) > 0) {
            console.log(`[target-alias] candidate visible alias="Volver" confidence=0.85`);
            console.log(`[target-alias] using effectiveTarget="Volver" for click originalTarget="` + '$' + `{target}"`);
            return {
                status: "resolved",
                target,
                locator: backButton,
                locatorStrategy: "back_navigation_alias",
                confidence: 0.85,
                matchReason: "back_navigation_alias",
                candidateText: "Volver",
                candidates: [{
                        elementId: "back-navigation",
                        text: "Volver",
                        normalizedText: "volver",
                        type: "button",
                        role: "button",
                        tagName: "button",
                        isClickable: true,
                        matchScore: 0.85,
                        matchReason: "back_navigation_alias",
                        locatorStrategy: "back_navigation_alias"
                    }],
                targetDisambiguation: {
                    target,
                    submitLike: false,
                    activeContainerUsed: false,
                    candidatesInsideActiveContainer: 0,
                    candidatesOutsideActiveContainer: 1,
                    selectedReason: "back_navigation_alias"
                }
            };
        }
    }
    // Strategy B: routeProfile aliases (app-specific, from target-alias-resolver)
    if (opts?.routeProfile?.aliases && Object.keys(opts.routeProfile.aliases).length > 0) {
        const aliasResult = (0, target_alias_resolver_1.resolveTargetWithAliases)(target, opts.routeProfile);
        if (aliasResult.resolved && aliasResult.resolvedTarget && aliasResult.resolvedTarget !== target) {
            console.log(`[target-alias] candidate visible alias="` + '$' + `{aliasResult.resolvedTarget}" confidence=` + '$' + `{aliasResult.confidence}`);
            // Try button role first
            const aliasLocator = page.getByRole("button", { name: buildFlexibleTextRegex(aliasResult.resolvedTarget) }).first();
            if (await aliasLocator.count().catch(() => 0) > 0) {
                console.log(`[target-alias] using effectiveTarget="` + '$' + `{aliasResult.resolvedTarget}" for click originalTarget="` + '$' + `{target}"`);
                return {
                    status: "resolved",
                    target,
                    locator: aliasLocator,
                    locatorStrategy: "route_profile_alias",
                    confidence: aliasResult.confidence,
                    matchReason: `route_profile_alias:` + '$' + `{aliasResult.resolvedTarget}`,
                    candidateText: aliasResult.resolvedTarget,
                    candidates: [{
                            elementId: "alias-resolution",
                            text: aliasResult.resolvedTarget,
                            normalizedText: normalizeText(aliasResult.resolvedTarget),
                            type: "button",
                            role: "button",
                            tagName: "button",
                            isClickable: true,
                            matchScore: aliasResult.confidence,
                            matchReason: "route_profile_alias",
                            locatorStrategy: "route_profile_alias"
                        }],
                    targetDisambiguation: {
                        target,
                        submitLike: false,
                        activeContainerUsed: false,
                        candidatesInsideActiveContainer: 0,
                        candidatesOutsideActiveContainer: 1,
                        selectedReason: "route_profile_alias"
                    }
                };
            }
            // Fallback to text locator
            const aliasTextLocator = page.getByText(buildFlexibleTextRegex(aliasResult.resolvedTarget)).first();
            if (await aliasTextLocator.count().catch(() => 0) > 0) {
                console.log(`[target-alias] using effectiveTarget="` + '$' + `{aliasResult.resolvedTarget}" (text) originalTarget="` + '$' + `{target}"`);
                return {
                    status: "resolved",
                    target,
                    locator: aliasTextLocator,
                    locatorStrategy: "route_profile_alias",
                    confidence: aliasResult.confidence * 0.9,
                    matchReason: `route_profile_alias:` + '$' + `{aliasResult.resolvedTarget}`,
                    candidateText: aliasResult.resolvedTarget,
                    candidates: [{
                            elementId: "alias-resolution-text",
                            text: aliasResult.resolvedTarget,
                            normalizedText: normalizeText(aliasResult.resolvedTarget),
                            type: "text",
                            role: "link",
                            tagName: "span",
                            isClickable: true,
                            matchScore: aliasResult.confidence * 0.9,
                            matchReason: "route_profile_alias_text",
                            locatorStrategy: "route_profile_alias"
                        }],
                    targetDisambiguation: {
                        target,
                        submitLike: false,
                        activeContainerUsed: false,
                        candidatesInsideActiveContainer: 0,
                        candidatesOutsideActiveContainer: 1,
                        selectedReason: "route_profile_alias_text"
                    }
                };
            }
            console.log(`[target-alias] alias "` + '$' + `{aliasResult.resolvedTarget}" resolved but not found as visible element, falling through`);
        }
    }
    // Common dismiss controls are frequently rendered as an icon or as an
    // English accessible name while the business step uses a short label such
    // such as "X". Resolve only a unique visible button, preferring the active
    // dialog, before broad contextual candidate scoring can make it ambiguous.
    if (/^(x|×|cerrar|close|dismiss|descartar)$/i.test(normalizedTargetAlias)) {
        const closeName = /^(x|×|cerrar|close|dismiss|descartar)$/i;
        const dialogClose = page.getByRole("dialog").getByRole("button", { name: closeName }).first();
        if (await dialogClose.count().catch(() => 0) === 1) {
            return {
                status: "resolved",
                target,
                locator: dialogClose,
                locatorStrategy: "common_dismiss_control",
                confidence: 0.95,
                matchReason: "unique_dialog_dismiss_control",
                candidateText: "close",
                candidates: [],
            };
        }
        const closeButton = page.getByRole("button", { name: closeName }).first();
        if (await closeButton.count().catch(() => 0) === 1) {
            return {
                status: "resolved",
                target,
                locator: closeButton,
                locatorStrategy: "common_dismiss_control",
                confidence: 0.9,
                matchReason: "unique_dismiss_control",
                candidateText: "close",
                candidates: [],
            };
        }
    }
    console.log(`[target-alias] skipped`);
    // === Product Condition Resolution (after ordinal) ===
    const productCondition = (0, product_condition_parser_1.parseProductConditionTarget)(target);
    if (productCondition) {
        const resolution = (0, product_condition_parser_1.resolveProductConditionAgainstSnapshot)(snapshot, productCondition, target);
        if (resolution.status === "resolved" || resolution.status === "multiple") {
            const selectedMatch = resolution.matches[resolution.selectedIndex];
            if (selectedMatch) {
                const element = snapshot.elements.find(e => e.id === selectedMatch.elementId);
                if (element) {
                    const resolved = await resolveSnapshotElementLocator(page, {
                        element,
                        target,
                        candidateText: selectedMatch.text,
                        type: "card",
                        tagName: element.tagName,
                        confidence: selectedMatch.score,
                        matchReason: `product_condition:${productCondition.type}${productCondition.status ? `:${productCondition.status}` : ""}`
                    });
                    if (resolved.locator) {
                        return {
                            status: "resolved",
                            target,
                            locator: resolved.locator,
                            locatorStrategy: "product_condition",
                            confidence: selectedMatch.score,
                            matchReason: `product_condition:${productCondition.type}${productCondition.status ? `:${productCondition.status}` : ""}`,
                            candidateText: selectedMatch.text,
                            candidateId: selectedMatch.elementId,
                            candidates: resolution.matches.map(m => ({
                                elementId: m.elementId,
                                text: m.text,
                                normalizedText: m.normalizedText,
                                type: "card",
                                role: "listitem",
                                tagName: "div",
                                isClickable: m.isClickable,
                                matchScore: m.score,
                                matchReason: `product_condition_match:${m.matchedType}`,
                                locatorStrategy: "product_condition"
                            })),
                            productConditionDiagnostics: resolution.diagnostics
                        };
                    }
                }
            }
        }
    }
    const snapshotCandidates = buildSnapshotCandidates(snapshot, target);
    // === Early resolution for submit-like targets within activeContainer ===
    if (opts.activeContainer && isSubmitLikeTarget(target) && opts.activeContainer.containerLocator) {
        console.log(`[target-resolver] Submit-like target within active container: target="${target}"`);
        // Try to find button inside activeContainer first
        const buttonInContainer = opts.activeContainer.containerLocator.getByRole('button', { name: buildFlexibleTextRegex(target) }).first();
        const buttonCount = await buttonInContainer.count().catch(() => 0);
        console.log(`[target-resolver] Button count in container: ${buttonCount}`);
        if (buttonCount === 1) {
            console.log(`[target-resolver] Candidate selected inside active container: role=button name="${target}"`);
            return {
                status: "resolved",
                target,
                locator: buttonInContainer,
                locatorStrategy: "activeContainer:submit",
                confidence: 0.95,
                matchReason: "submit_like_inside_active_container",
                candidateText: target,
                candidates: [{
                        elementId: "activeContainer-button",
                        text: target,
                        normalizedText: normalizeText(target),
                        type: "button",
                        role: "button",
                        tagName: "button",
                        isClickable: true,
                        matchScore: 0.95,
                        matchReason: "submit_like_inside_active_container",
                        locatorStrategy: "activeContainer:submit"
                    }],
                targetDisambiguation: {
                    target,
                    submitLike: true,
                    activeContainerUsed: true,
                    candidatesInsideActiveContainer: 1,
                    candidatesOutsideActiveContainer: snapshotCandidates.filter(c => !c.insideActiveContainer).length,
                    selectedReason: "submit_like_inside_active_container"
                }
            };
        }
        if (buttonCount > 1) {
            console.log(`[target-resolver] Multiple buttons (${buttonCount}) inside active container, continuing with disambiguation`);
        }
        else {
            console.log(`[target-resolver] No button found with getByRole, trying alternative selectors`);
            // Fallback: try text-based selector within container
            const buttonByText = opts.activeContainer.containerLocator.locator(`button:has-text("${target}")`).first();
            const textButtonCount = await buttonByText.count().catch(() => 0);
            console.log(`[target-resolver] Button count by text: ${textButtonCount}`);
            if (textButtonCount === 1) {
                console.log(`[target-resolver] Candidate selected inside active container: button:text="${target}"`);
                return {
                    status: "resolved",
                    target,
                    locator: buttonByText,
                    locatorStrategy: "activeContainer:button:text",
                    confidence: 0.90,
                    matchReason: "submit_like_button_text_inside_active_container",
                    candidateText: target,
                    candidates: [{
                            elementId: "activeContainer-button-text",
                            text: target,
                            normalizedText: normalizeText(target),
                            type: "button",
                            role: "button",
                            tagName: "button",
                            isClickable: true,
                            matchScore: 0.90,
                            matchReason: "submit_like_button_text_inside_active_container",
                            locatorStrategy: "activeContainer:button:text"
                        }],
                    targetDisambiguation: {
                        target,
                        submitLike: true,
                        activeContainerUsed: true,
                        candidatesInsideActiveContainer: 1,
                        candidatesOutsideActiveContainer: snapshotCandidates.filter(c => !c.insideActiveContainer).length,
                        selectedReason: "submit_like_button_text_inside_active_container"
                    }
                };
            }
            // Last resort: find any button with text matching target on the page
            // and prefer it over links when there's ambiguity
            const anyButton = page.locator(`button:has-text("${target}")`).first();
            const anyButtonCount = await anyButton.count().catch(() => 0);
            console.log(`[target-resolver] Any button count on page: ${anyButtonCount}`);
            if (anyButtonCount === 1) {
                console.log(`[target-resolver] Selected button on page (container scope failed): button:text="${target}"`);
                return {
                    status: "resolved",
                    target,
                    locator: anyButton,
                    locatorStrategy: "page:button:text",
                    confidence: 0.85,
                    matchReason: "submit_like_button_on_page",
                    candidateText: target,
                    candidates: [{
                            elementId: "page-button-text",
                            text: target,
                            normalizedText: normalizeText(target),
                            type: "button",
                            role: "button",
                            tagName: "button",
                            isClickable: true,
                            matchScore: 0.85,
                            matchReason: "submit_like_button_on_page",
                            locatorStrategy: "page:button:text"
                        }],
                    targetDisambiguation: {
                        target,
                        submitLike: true,
                        activeContainerUsed: false,
                        candidatesInsideActiveContainer: 0,
                        candidatesOutsideActiveContainer: snapshotCandidates.length,
                        selectedReason: "submit_like_button_on_page_fallback"
                    }
                };
            }
        }
    }
    // Apply semanticRole-based ranking and relationContext boost
    const containerRoles = new Set(["listitem", "group", "region", "card", "article", "row", "tab"]);
    const containerTags = new Set(["article", "li", "tr", "fieldset"]);
    const navRoles = new Set(["tab", "menuitem", "treeitem", "option"]);
    const navTags = new Set(["button", "a"]);
    for (const c of snapshotCandidates) {
        const el = snapshot.elements.find(e => e.id === c.elementId);
        if (!el)
            continue;
        const isContainer = containerRoles.has(el.role ?? "") || containerTags.has(el.tagName?.toLowerCase() ?? "") || el.type === "card";
        const isNavElement = navRoles.has(el.role ?? "") || (navTags.has(el.tagName?.toLowerCase() ?? "") && el.role !== "button");
        // === product/card/item: prefer actionable containers ===
        if (opts.semanticRole === "product" || opts.semanticRole === "card" || opts.semanticRole === "item") {
            if (isContainer && c.isClickable) {
                c.matchScore = Math.min(1.0, c.matchScore + 0.25);
                c.matchReason += " +container_rank";
            }
            else if (isContainer) {
                c.matchScore = Math.min(1.0, c.matchScore + 0.15);
                c.matchReason += " +container_context";
            }
        }
        // === category/option: prefer navigation/selection elements ===
        if (opts.semanticRole === "category" || opts.semanticRole === "option") {
            if (isNavElement) {
                c.matchScore = Math.min(1.0, c.matchScore + 0.25);
                c.matchReason += " +nav_rank";
            }
            if (el.role === "tab" || el.role === "menuitem") {
                c.matchScore = Math.min(1.0, c.matchScore + 0.20);
                c.matchReason += " +selectable_rank";
            }
        }
        // === relationContext boost: prefer elements whose context contains the relation ===
        if (opts.relationContext && el.nearbyText) {
            const ctxNormalized = normalizeText(opts.relationContext);
            const nearbyNormalized = normalizeText(el.nearbyText);
            if (nearbyNormalized.includes(ctxNormalized) || ctxNormalized.includes(nearbyNormalized)) {
                c.matchScore = Math.min(1.0, c.matchScore + 0.15);
                c.matchReason += " +context_boost";
            }
        }
        // === submit-like target within activeContainer: prefer elements inside the container ===
        if (opts.activeContainer && isSubmitLikeTarget(target)) {
            let insideActiveContainer = false;
            // Check if element is inside activeContainer by various strategies
            if (opts.activeContainer.containerElement) {
                const containerClass = opts.activeContainer.containerElement.className || "";
                const containerDomId = opts.activeContainer.containerElement.domId || "";
                const elementClass = el.className || "";
                const elementDomId = el.domId || "";
                // Strategy 1: Check if element has a parent-like relationship with container
                // If container has domId and element's nearby text or context suggests it's in a modal
                if (containerDomId && el.nearbyText) {
                    // Elements inside modal often have text that's part of the modal content
                    insideActiveContainer = true;
                }
                // Strategy 2: Check class overlap (for elements that inherit container classes)
                if (!insideActiveContainer && containerClass && elementClass) {
                    const containerClasses = containerClass.split(/\s+/);
                    const elementClasses = elementClass.split(/\s+/);
                    insideActiveContainer = containerClasses.some(cls => elementClasses.includes(cls));
                }
                // Strategy 3: If container is a modal/dialog, prefer buttons over links
                if (!insideActiveContainer) {
                    const isContainerModal = containerClass.toLowerCase().includes('modal') ||
                        containerClass.toLowerCase().includes('dialog') ||
                        opts.activeContainer.type === 'modal' ||
                        opts.activeContainer.type === 'dialog' ||
                        opts.activeContainer.type === 'form';
                    if (isContainerModal && el.tagName?.toLowerCase() === 'button') {
                        insideActiveContainer = true;
                    }
                }
            }
            if (insideActiveContainer) {
                c.matchScore = Math.min(1.0, c.matchScore + 0.35);
                c.matchReason += " +active_container_submit_boost";
                c.insideActiveContainer = true;
            }
        }
        // === submit-like target: prefer button over link ===
        if (isSubmitLikeTarget(target)) {
            const isButton = el.tagName?.toLowerCase() === 'button' || el.role === 'button';
            const isLink = el.tagName?.toLowerCase() === 'a' || el.type === 'link';
            if (isButton && !isLink) {
                c.matchScore = Math.min(1.0, c.matchScore + 0.20);
                c.matchReason += " +button_over_link_for_submit";
            }
            else if (isLink && !isButton) {
                c.matchScore = Math.max(0, c.matchScore - 0.10);
                c.matchReason += " -link_penalty_for_submit";
            }
        }
    }
    const dedupedCandidates = deduplicateCandidates(snapshotCandidates);
    const highConfidence = dedupedCandidates.filter((c) => c.matchScore >= opts.minConfidence);
    const clickableCandidates = highConfidence.filter((c) => c.isClickable);
    const nonClickableCandidates = highConfidence.filter((c) => !c.isClickable);
    const allViable = [...clickableCandidates, ...nonClickableCandidates].slice(0, 10);
    if (clickableCandidates.length === 0 && nonClickableCandidates.length === 0) {
        const contextualOptionResult = await attemptContextualOptionResolution(page, snapshot, target, opts);
        if (contextualOptionResult) {
            return contextualOptionResult;
        }
        // Try semantic resolution as fallback
        try {
            const semanticResult = await resolveSemanticActionTarget(page, target);
            if (semanticResult.status === "resolved" && semanticResult.locator && semanticResult.confidence >= opts.minConfidence) {
                return {
                    status: "resolved",
                    target,
                    locator: semanticResult.locator,
                    locatorStrategy: semanticResult.locatorStrategy,
                    confidence: semanticResult.confidence,
                    matchReason: semanticResult.matchReason,
                    candidateText: semanticResult.candidateText,
                    candidates: semanticResult.candidates.map((c) => ({
                        elementId: `semantic-${c.elementIndex}`,
                        text: c.signalValue || c.text || target,
                        normalizedText: normalizeText(c.signalValue || c.text || target),
                        type: c.type,
                        role: c.role,
                        tagName: c.tagName,
                        isClickable: true,
                        matchScore: c.score,
                        matchReason: `semantic_${c.matchedSignal}`,
                        locatorStrategy: `semantic:${c.matchedSignal}`,
                        matchedSignal: c.matchedSignal
                    })),
                    semanticTokens: semanticResult.targetTokens,
                    expandedTokens: semanticResult.expandedTokens,
                    matchedSignals: semanticResult.matchedSignals
                };
            }
            if (semanticResult.status === "ambiguous_semantic_target") {
                const ambiguityDiagnostics = {
                    target,
                    semanticRole: opts.semanticRole !== "unknown" ? opts.semanticRole : undefined,
                    relationContext: opts.relationContext || undefined,
                    candidateCount: semanticResult.candidates.length,
                    candidateTexts: semanticResult.candidates.slice(0, 5).map(c => c.text || c.signalValue || ""),
                    candidateRoles: [...new Set(semanticResult.candidates.slice(0, 5).map(c => c.role ?? c.tagName ?? "unknown"))],
                    candidateStrategies: semanticResult.matchedSignals ? [...new Set(semanticResult.matchedSignals)] : []
                };
                return {
                    status: "ambiguous",
                    target,
                    confidence: semanticResult.confidence,
                    matchReason: semanticResult.matchReason,
                    candidateText: semanticResult.candidateText,
                    candidates: semanticResult.candidates.map((c) => ({
                        elementId: `semantic-${c.elementIndex}`,
                        text: c.signalValue || c.text || target,
                        normalizedText: normalizeText(c.signalValue || c.text || target),
                        type: c.type,
                        role: c.role,
                        tagName: c.tagName,
                        isClickable: true,
                        matchScore: c.score,
                        matchReason: `semantic_${c.matchedSignal}`,
                        locatorStrategy: `semantic:${c.matchedSignal}`,
                        matchedSignal: c.matchedSignal
                    })),
                    semanticTokens: semanticResult.targetTokens,
                    expandedTokens: semanticResult.expandedTokens,
                    matchedSignals: semanticResult.matchedSignals,
                    ambiguityDiagnostics
                };
            }
        }
        catch {
            // Semantic resolution failed, fall through to original not_found
        }
        const visibleTexts = snapshot.elements
            .filter((el) => el.visible && el.text)
            .map((el) => el.text)
            .slice(0, 30);
        const clickableElements = snapshot.elements
            .filter((el) => isElementClickable(el) && el.text)
            .map((el) => ({
            text: el.text,
            normalizedText: normalizeText(el.text),
            type: el.type,
            role: el.role,
            tagName: el.tagName
        }))
            .slice(0, 20);
        const closestCandidates = dedupedCandidates
            .filter((c) => c.matchScore > 0.1 && c.matchScore < opts.minConfidence)
            .slice(0, 5);
        const diagnosis = dedupedCandidates.map((c) => ({
            target: normalizeText(target),
            candidateText: c.text,
            normalizedCandidate: c.normalizedText,
            type: c.type,
            clickable: c.isClickable,
            score: c.matchScore,
            matchReason: c.matchReason,
            rejectionReason: c.matchScore < opts.minConfidence ? "below_threshold" : "filtered_out"
        }));
        return {
            status: "not_found",
            target,
            confidence: 0,
            matchReason: "no_matching_candidates",
            candidateText: "",
            candidates: allViable,
            visibleTexts,
            clickableCandidates: clickableElements,
            closestCandidates,
            ...(diagnosis.length > 0 ? { _diagnosis: diagnosis } : {})
        };
    }
    const topCandidates = clickableCandidates.length > 0 ? clickableCandidates : nonClickableCandidates;
    const sorted = topCandidates.sort((a, b) => b.matchScore - a.matchScore);
    const best = sorted[0];
    if (sorted.length >= 2) {
        const second = sorted[1];
        const scoreDiff = best.matchScore - second.matchScore;
        if (scoreDiff < opts.ambiguousThreshold && second.matchScore >= opts.minConfidence) {
            // === Contextual Ambiguous Intermediate Resolution ===
            // Try to resolve using route context before semantic fallback
            const contextualInput = {
                target,
                previousTarget: opts.previousTarget || opts.relationContext,
                nextTarget: opts.nextTarget,
                routeHistory: opts.routeHistory,
                routeProfile: opts.routeProfile,
                candidates: sorted.slice(0, 10).map(c => {
                    // Reconstruct snapshot elements from candidates
                    const element = snapshot.elements.find(e => (e.text && normalizeText(e.text) === c.normalizedText) ||
                        (e.label && normalizeText(e.label) === c.normalizedText) ||
                        (e.name && normalizeText(e.name) === c.normalizedText));
                    if (element)
                        return element;
                    // Create minimal element if not found
                    return {
                        id: c.elementId || `cand-${c.normalizedText.slice(0, 10)}`,
                        type: c.type === "card" ? "card" : c.type === "link" ? "link" : "button",
                        text: c.text,
                        label: c.text,
                        name: c.text,
                        role: c.role,
                        tagName: c.tagName || "div",
                        visible: true,
                        candidateLocators: [],
                        dataHints: []
                    };
                })
            };
            const contextualResult = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(contextualInput);
            if (contextualResult.status === "resolved" && contextualResult.selectedCandidate) {
                console.log(`[target-resolver] contextual_intermediate_resolver resolved target="${target}" selected="${contextualResult.selectedCandidateText}" type="${contextualResult.classifiedCandidates.find(c => c.element === contextualResult.selectedCandidate)?.type}"`);
                const resolved = await resolveSnapshotElementLocator(page, {
                    element: contextualResult.selectedCandidate,
                    target,
                    candidateText: contextualResult.selectedCandidateText,
                    type: contextualResult.classifiedCandidates.find(c => c.element === contextualResult.selectedCandidate)?.type || "button",
                    tagName: contextualResult.selectedCandidate.tagName,
                    confidence: contextualResult.classifiedCandidates.find(c => c.element === contextualResult.selectedCandidate)?.score || 0.7,
                    matchReason: `contextual_intermediate:${contextualResult.reason}`
                });
                if (resolved.locator) {
                    return {
                        status: "resolved",
                        target,
                        locator: resolved.locator,
                        locatorStrategy: "contextual_intermediate",
                        confidence: contextualResult.classifiedCandidates.find(c => c.element === contextualResult.selectedCandidate)?.score || 0.7,
                        matchReason: `contextual_intermediate:${contextualResult.reason}`,
                        candidateText: contextualResult.selectedCandidateText,
                        candidateId: contextualResult.selectedCandidate.id,
                        candidates: sorted.slice(0, 5),
                        contextualResolverDiagnostics: contextualResult.diagnostics
                    };
                }
                return {
                    status: "ambiguous",
                    target,
                    confidence: contextualResult.classifiedCandidates.find(c => c.element === contextualResult.selectedCandidate)?.score || best.matchScore,
                    matchReason: "ambiguous_contextual_option",
                    candidateText: contextualResult.selectedCandidateText || best.text,
                    candidates: contextualResult.classifiedCandidates.map(c => ({
                        elementId: c.element.id,
                        text: c.text,
                        normalizedText: c.normalizedText,
                        type: c.type,
                        role: c.element.role,
                        tagName: c.element.tagName,
                        isClickable: c.isClickable,
                        matchScore: c.score,
                        matchReason: `contextual_option:${c.scoreReasons.join(",")}`,
                        locatorStrategy: c.isClickable ? "contextual_option" : "text"
                    })).slice(0, 5),
                    ambiguityDiagnostics: {
                        target,
                        semanticRole: opts.semanticRole !== "unknown" ? opts.semanticRole : undefined,
                        relationContext: opts.relationContext || undefined,
                        candidateCount: contextualResult.classifiedCandidates.length,
                        candidateTexts: contextualResult.classifiedCandidates.slice(0, 5).map(c => c.text),
                        candidateRoles: [...new Set(contextualResult.classifiedCandidates.slice(0, 5).map(c => c.element.role ?? c.element.tagName ?? "unknown"))],
                        candidateStrategies: [...new Set(contextualResult.classifiedCandidates.slice(0, 5).map(c => c.type))],
                        suggestedExactTargetPattern: `Ambiguous contextual option. Candidates: ${contextualResult.classifiedCandidates.slice(0, 3).map(c => `"${c.text}"`).join(", ")}`
                    },
                    contextualResolverDiagnostics: contextualResult.diagnostics
                };
            }
            // Handle already_satisfied: intermediate variant already visible, skip click
            if (contextualResult.status === "already_satisfied") {
                console.log(`[target-resolver] contextual_intermediate already_satisfied target="${target}" reason="${contextualResult.reason}" evidence="${contextualResult.alreadySatisfiedEvidence?.candidateText}"`);
                return {
                    status: "resolved",
                    target,
                    locator: undefined,
                    locatorStrategy: "contextual_intermediate_already_satisfied",
                    confidence: 0.9,
                    matchReason: `contextual_intermediate_already_satisfied:${contextualResult.reason}`,
                    candidateText: contextualResult.alreadySatisfiedEvidence?.candidateText || "",
                    contextualResolverDiagnostics: contextualResult.diagnostics,
                    alreadySatisfiedEvidence: contextualResult.alreadySatisfiedEvidence
                };
            }
            // Try semantic DOM-based resolution before declaring ambiguous
            const semanticResult = await trySemanticFallback(page, target, opts);
            if (semanticResult)
                return semanticResult;
            const ambiguityDiagnostics = {
                target,
                semanticRole: opts.semanticRole !== "unknown" ? opts.semanticRole : undefined,
                relationContext: opts.relationContext || undefined,
                candidateCount: sorted.length,
                candidateTexts: sorted.slice(0, 5).map(c => c.text),
                candidateRoles: [...new Set(sorted.slice(0, 5).map(c => c.role ?? c.tagName ?? "unknown"))],
                candidateStrategies: [...new Set(sorted.slice(0, 5).map(c => c.locatorStrategy))],
                suggestedExactTargetPattern: sorted.length <= 3
                    ? `Try a more specific target matching one of: ${sorted.slice(0, 3).map(c => `"${c.text.length > 40 ? c.text.slice(0, 40) + "..." : c.text}"`).join(", ")}`
                    : `Multiple candidates found (${sorted.length}). Consider narrowing the target with additional context.`,
                suggestedAssociatedActionPattern: opts.semanticRole && opts.semanticRole !== "unknown"
                    ? `Try using associated entity: clic en '${target}' relacionado con '${opts.semanticRole === "product" ? "producto" : opts.semanticRole === "card" ? "card" : opts.semanticRole === "category" ? "categoría" : "entidad"}'.`
                    : undefined
            };
            return {
                status: "ambiguous",
                target,
                confidence: best.matchScore,
                matchReason: `multiple_similar_candidates (${sorted.length} with score >= ${opts.minConfidence})`,
                candidateText: best.text,
                candidates: sorted.slice(0, 5),
                ambiguityDiagnostics
            };
        }
    }
    if (best.matchScore < opts.minConfidence) {
        const contextualOptionResult = await attemptContextualOptionResolution(page, snapshot, target, opts);
        if (contextualOptionResult) {
            return contextualOptionResult;
        }
        // === Contextual Ambiguous Intermediate Resolution (low confidence) ===
        const contextualInput = {
            target,
            previousTarget: opts.previousTarget || opts.relationContext,
            nextTarget: opts.nextTarget,
            routeHistory: opts.routeHistory,
            routeProfile: opts.routeProfile,
            candidates: snapshot.elements.filter(e => e.visible).slice(0, 20)
        };
        const contextualResult = (0, contextual_intermediate_resolver_1.resolveAmbiguousIntermediateTarget)(contextualInput);
        if (contextualResult.status === "resolved" && contextualResult.selectedCandidate) {
            console.log(`[target-resolver] contextual_intermediate_resolver resolved low-confidence target="${target}" selected="${contextualResult.selectedCandidateText}"`);
            const resolved = await resolveSnapshotElementLocator(page, {
                element: contextualResult.selectedCandidate,
                target,
                candidateText: contextualResult.selectedCandidateText,
                type: contextualResult.classifiedCandidates.find(c => c.element === contextualResult.selectedCandidate)?.type || "button",
                tagName: contextualResult.selectedCandidate.tagName,
                confidence: contextualResult.classifiedCandidates.find(c => c.element === contextualResult.selectedCandidate)?.score || 0.5,
                matchReason: `contextual_intermediate_low_confidence:${contextualResult.reason}`
            });
            if (resolved.locator) {
                return {
                    status: "resolved",
                    target,
                    locator: resolved.locator,
                    locatorStrategy: "contextual_intermediate",
                    confidence: contextualResult.classifiedCandidates.find(c => c.element === contextualResult.selectedCandidate)?.score || 0.5,
                    matchReason: `contextual_intermediate_low_confidence:${contextualResult.reason}`,
                    candidateText: contextualResult.selectedCandidateText,
                    candidateId: contextualResult.selectedCandidate.id,
                    contextualResolverDiagnostics: contextualResult.diagnostics
                };
            }
        }
        // Try semantic DOM-based resolution before giving up
        const semanticResult = await trySemanticFallback(page, target, opts);
        if (semanticResult)
            return semanticResult;
        return {
            status: "not_found",
            target,
            confidence: best.matchScore,
            matchReason: "confidence_below_threshold",
            candidateText: best.text,
            candidates: allViable
        };
    }
    const normalizedTargetText = normalizeText(target);
    const element = best.elementId
        ? snapshot.elements.find((candidate) => candidate.id === best.elementId)
        : undefined;
    const resolved = element
        ? await resolveSnapshotElementLocator(page, {
            element,
            target,
            candidateText: best.text,
            type: best.type,
            tagName: best.tagName,
            confidence: best.matchScore,
            matchReason: best.matchReason
        })
        : { attemptedLocators: [] };
    if (!resolved.locator) {
        const diagnosis = allViable.map((c) => ({
            target: normalizedTargetText,
            candidateText: c.text,
            normalizedCandidate: c.normalizedText,
            type: c.type,
            clickable: c.isClickable,
            score: c.matchScore,
            matchReason: c.matchReason,
            rejectionReason: "locator_resolution_failed",
            attemptedLocators: resolved.attemptedLocators
        }));
        return {
            status: best.isClickable && best.matchScore >= opts.minConfidence ? "locator_resolution_failed" : "not_found",
            target,
            confidence: best.matchScore,
            matchReason: "locator_resolution_failed",
            candidateText: best.text,
            candidateId: best.elementId,
            candidates: allViable,
            attemptedLocators: resolved.attemptedLocators,
            _diagnosis: diagnosis
        };
    }
    return {
        status: "resolved",
        target,
        locator: resolved.locator,
        locatorStrategy: resolved.locatorStrategy ?? best.locatorStrategy,
        confidence: best.matchScore,
        matchReason: best.matchReason,
        candidateText: best.text,
        candidateId: best.elementId,
        candidates: allViable
    };
}
async function trySemanticFallback(page, target, opts) {
    try {
        const semanticResult = await resolveSemanticActionTarget(page, target);
        if (semanticResult.status === "resolved" && semanticResult.locator && semanticResult.confidence >= opts.minConfidence) {
            return {
                status: "resolved",
                target,
                locator: semanticResult.locator,
                locatorStrategy: semanticResult.locatorStrategy,
                confidence: semanticResult.confidence,
                matchReason: semanticResult.matchReason,
                candidateText: semanticResult.candidateText,
                candidates: semanticResult.candidates.map((c) => ({
                    elementId: `semantic-${c.elementIndex}`,
                    text: c.signalValue || c.text || target,
                    normalizedText: normalizeText(c.signalValue || c.text || target),
                    type: c.type,
                    role: c.role,
                    tagName: c.tagName,
                    isClickable: true,
                    matchScore: c.score,
                    matchReason: `semantic_${c.matchedSignal}`,
                    locatorStrategy: `semantic:${c.matchedSignal}`,
                    matchedSignal: c.matchedSignal
                })),
                semanticTokens: semanticResult.targetTokens,
                expandedTokens: semanticResult.expandedTokens,
                matchedSignals: semanticResult.matchedSignals
            };
        }
    }
    catch {
        // Semantic resolution failed silently
    }
    return undefined;
}
function shouldInvokeAiAssistedDiscovery(input) {
    const { resolution, confidenceThreshold, missingNavigationStep, enabled } = input;
    if (enabled === false) {
        return { shouldInvoke: false };
    }
    if (resolution.status === "resolved" && resolution.confidence >= confidenceThreshold && resolution.locator) {
        return { shouldInvoke: false };
    }
    if (missingNavigationStep) {
        return { shouldInvoke: true, reason: "missing_navigation_step" };
    }
    if (resolution.status === "not_found") {
        return { shouldInvoke: true, reason: "resolver_not_found" };
    }
    if (resolution.status === "ambiguous") {
        return { shouldInvoke: true, reason: "resolver_ambiguous" };
    }
    if (resolution.status === "locator_resolution_failed") {
        return { shouldInvoke: true, reason: "locator_resolution_failed" };
    }
    if (resolution.status === "needs_discovery") {
        return { shouldInvoke: true, reason: "needs_discovery" };
    }
    if (resolution.status === "needs_associated_target_resolution") {
        return { shouldInvoke: true, reason: "needs_associated_target_resolution" };
    }
    if (resolution.status === "needs_assertion_resolution") {
        return { shouldInvoke: true, reason: "needs_assertion_resolution" };
    }
    if (resolution.confidence < confidenceThreshold) {
        return { shouldInvoke: true, reason: "confidence_below_threshold" };
    }
    return { shouldInvoke: false };
}
async function countLocator(locator) {
    try {
        return await locator.count();
    }
    catch {
        return 0;
    }
}
async function resolveSnapshotElementLocator(page, candidate) {
    const { element, target, candidateText, type, tagName } = candidate;
    const attemptedLocators = [];
    const sortedLocators = [...element.candidateLocators].sort((a, b) => b.confidence - a.confidence);
    const candidateTextRegex = buildFlexibleTextRegex(candidateText);
    const targetRegex = buildFlexibleTokenRegex(target);
    const tryLocator = async (label, factory, strategy) => {
        attemptedLocators.push(label);
        const locator = factory();
        if (locator && await countLocator(locator) > 0) {
            return {
                locator: locator.first(),
                locatorStrategy: strategy
            };
        }
        return {};
    };
    const semanticRole = type === "link" || tagName?.toLowerCase() === "a" ? "link" : "button";
    for (const role of [semanticRole, semanticRole === "button" ? "link" : "button"]) {
        const byCandidateText = await tryLocator(`getByRole(${role}, candidateText:${candidateText})`, () => page.getByRole(role, { name: candidateTextRegex }), `role:${role}`);
        if (byCandidateText.locator) {
            return { ...byCandidateText, attemptedLocators };
        }
        const byTarget = await tryLocator(`getByRole(${role}, targetTokens:${target})`, () => page.getByRole(role, { name: targetRegex }), `role:${role}`);
        if (byTarget.locator) {
            return { ...byTarget, attemptedLocators };
        }
    }
    const byCandidateText = await tryLocator(`getByText(candidateText:${candidateText})`, () => page.getByText(candidateTextRegex, { exact: false }), "text");
    if (byCandidateText.locator) {
        return { ...byCandidateText, attemptedLocators };
    }
    const byTargetText = await tryLocator(`getByText(target:${target})`, () => page.getByText(targetRegex, { exact: false }), "text");
    if (byTargetText.locator) {
        return { ...byTargetText, attemptedLocators };
    }
    for (const candidateLocator of sortedLocators) {
        let locator;
        attemptedLocators.push(`snapshot:${candidateLocator.strategy}:${candidateLocator.value ?? candidateLocator.role ?? candidateLocator.name ?? ""}`);
        if (candidateLocator.strategy === "role" && candidateLocator.role) {
            locator = page.getByRole(candidateLocator.role, {
                name: candidateLocator.name ?? candidateLocator.value,
                exact: candidateLocator.exact
            });
        }
        else if (candidateLocator.strategy === "text" && candidateLocator.value) {
            locator = page.getByText(candidateLocator.value, { exact: candidateLocator.exact ?? false });
        }
        else if (candidateLocator.strategy === "label" && candidateLocator.value) {
            locator = page.getByLabel(candidateLocator.value, { exact: candidateLocator.exact ?? false });
        }
        else if (candidateLocator.strategy === "placeholder" && candidateLocator.value) {
            locator = page.getByPlaceholder(candidateLocator.value, { exact: candidateLocator.exact ?? false });
        }
        else if (candidateLocator.strategy === "testId" && candidateLocator.value) {
            locator = page.getByTestId(candidateLocator.value);
        }
        else if (candidateLocator.strategy === "css" && candidateLocator.value) {
            locator = page.locator(candidateLocator.value);
        }
        else if (candidateLocator.strategy === "xpath" && candidateLocator.value) {
            locator = page.locator(candidateLocator.value);
        }
        if (locator && await countLocator(locator) > 0) {
            return {
                locator: locator.first(),
                locatorStrategy: candidateLocator.strategy,
                attemptedLocators
            };
        }
    }
    const fallbackTexts = [element.text, element.label, element.name, element.placeholder].filter(Boolean);
    for (const text of fallbackTexts) {
        attemptedLocators.push(`elementText:${text}`);
        const locator = page.getByText(buildFlexibleTextRegex(text), { exact: false });
        if (await countLocator(locator) > 0) {
            return {
                locator: locator.first(),
                locatorStrategy: "text",
                attemptedLocators
            };
        }
    }
    return { attemptedLocators };
}
async function findTargetByText(page, target) {
    const regex = buildFlexibleTextRegex(target);
    const count = await page.getByText(regex).count();
    return count > 0;
}
async function clickResolvedTarget(locator, force = false) {
    if (force) {
        await locator.click({ force: true });
    }
    else {
        await locator.click();
    }
}
const EDITABLE_TAGS = new Set(["input", "textarea", "select"]);
const EDITABLE_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);
function isElementEditable(el) {
    if (el.tagName && EDITABLE_TAGS.has(el.tagName.toLowerCase()))
        return true;
    if (el.role && EDITABLE_ROLES.has(el.role))
        return true;
    return false;
}
/**
 * Select only a candidate whose recorded identity and current surface make it
 * uniquely safe. Equal candidates remain ambiguous; no positional choice is
 * allowed here.
 */
function disambiguateStructuredTargetCandidates(candidates, expected) {
    const usable = candidates.filter((candidate) => candidate.visible && candidate.enabled && candidate.clickable);
    const technicalIdentity = expected.technicalIdentity?.trim();
    const surfaceIdentity = expected.surfaceIdentity?.trim();
    const exact = usable.filter((candidate) => (!technicalIdentity || candidate.technicalIdentity === technicalIdentity)
        && (!surfaceIdentity || candidate.surfaceIdentity === surfaceIdentity));
    if (exact.length === 1)
        return { status: "resolved", candidate: exact[0], candidates: exact };
    if (exact.length > 1)
        return { status: "ambiguous", candidates: exact };
    return { status: "not_found", candidates: usable };
}
function routeSurfaceMatches(currentUrl, expectedUrl) {
    if (!expectedUrl?.trim())
        return true;
    try {
        const current = new URL(currentUrl);
        const expected = new URL(expectedUrl, currentUrl);
        return current.origin === expected.origin && current.pathname === expected.pathname;
    }
    catch {
        return currentUrl === expectedUrl;
    }
}
function recordedLocatorFactory(page, candidate, exact = false) {
    const value = candidate.value.trim();
    if (!value)
        return undefined;
    const strategy = candidate.strategy.trim().toLowerCase();
    if (strategy === "css")
        return page.locator(value);
    if (strategy === "data-testid")
        return page.getByTestId(value);
    if (strategy === "aria-label")
        return page.locator(`[aria-label="${value.replace(/"/g, '\\"')}"]`);
    if (strategy === "placeholder")
        return page.getByPlaceholder(value, { exact });
    if (strategy === "label")
        return page.getByLabel(value, { exact });
    if (strategy === "text")
        return page.getByText(value, { exact });
    if (strategy === "role") {
        const separator = value.indexOf("|");
        const roleOrTag = (separator >= 0 ? value.slice(0, separator) : value).trim().toLowerCase();
        const name = separator >= 0 ? value.slice(separator + 1).trim() : "";
        const role = roleOrTag === "input" || roleOrTag === "textarea" ? "textbox" : roleOrTag;
        if (["button", "link", "checkbox", "combobox", "textbox", "searchbox", "spinbutton", "option", "menuitem", "tab"].includes(role)) {
            return name ? page.getByRole(role, { name, exact }) : page.getByRole(role);
        }
        return page.locator(roleOrTag || "*");
    }
    // Structural strings are consumed by the existing grid resolver, which validates
    // header/row/cell relations against the current DOM rather than guessing a selector.
    return undefined;
}
async function resolveRecordedTechnicalTarget(page, targets, mode, technicalTargetRefs) {
    const recordedRefCandidates = (technicalTargetRefs ?? [])
        .flatMap((ref) => {
        const separator = ref.indexOf(":");
        if (separator <= 0)
            return [];
        return [{ strategy: ref.slice(0, separator), value: ref.slice(separator + 1), confidence: 1 }];
    });
    const candidatesByAuthority = [
        ...recordedRefCandidates.map((candidate) => ({ candidate, exact: true })),
        ...(targets ?? []).flatMap((technicalTarget) => (technicalTarget.locatorCandidates ?? []).map((candidate) => ({ candidate, technicalTarget, exact: false }))),
    ];
    for (const { candidate, technicalTarget, exact } of candidatesByAuthority) {
        if (candidate.ambiguous)
            continue;
        const locator = recordedLocatorFactory(page, candidate, exact);
        if (!locator)
            continue;
        const count = await locator.count().catch(() => 0);
        const visible = count === 1 && await locator.isVisible().catch(() => false);
        const enabled = visible && await locator.isEnabled().catch(() => true);
        if (!visible || !enabled)
            continue;
        const compatible = mode === "action" || await locator.evaluate((element) => {
            const tag = element.tagName.toLowerCase();
            const role = element.getAttribute("role")?.toLowerCase();
            const disabled = ("disabled" in element && Boolean(element.disabled))
                || element.getAttribute("aria-disabled") === "true";
            const readOnly = ("readOnly" in element && Boolean(element.readOnly))
                || element.getAttribute("aria-readonly") === "true";
            if (disabled || readOnly)
                return false;
            return ["input", "textarea", "select"].includes(tag)
                || ["textbox", "combobox", "searchbox", "spinbutton"].includes(role ?? "")
                || element.getAttribute("contenteditable") === "true";
        }).catch(() => false);
        if (!compatible)
            continue;
        return {
            locator,
            strategy: `recorded:${candidate.strategy}`,
            confidence: candidate.confidence ?? technicalTarget?.confidence ?? 1,
            currentMatchCount: count,
            structuralCompatibility: Boolean(technicalTarget?.structuralContext || technicalTarget?.stableAttributes),
        };
    }
    return undefined;
}
const FILL_LOCATOR_STRATEGIES = [
    { label: "getByLabel", factory: (page, target, _regex) => page.getByLabel(target, { exact: false }) },
    { label: "getByPlaceholder", factory: (page, target, _regex) => page.getByPlaceholder(target, { exact: false }) },
    { label: "getByRole(textbox)", factory: (page, target, regex) => page.getByRole("textbox", { name: regex }) },
    { label: "getByRole(combobox)", factory: (page, target, regex) => page.getByRole("combobox", { name: regex }) },
    { label: "getByRole(searchbox)", factory: (page, target, regex) => page.getByRole("searchbox", { name: regex }) },
    { label: "getByRole(spinbutton)", factory: (page, target, regex) => page.getByRole("spinbutton", { name: regex }) },
    { label: "input[name]", factory: (page, target, _regex) => page.locator(`input[name="${target}"]`) },
    { label: "input[id]", factory: (page, target, _regex) => page.locator(`input[id="${target}"]`) },
    { label: "input[aria-label]", factory: (page, target, _regex) => page.locator(`input[aria-label="${target}"]`) },
    { label: "input[placeholder]", factory: (page, target, _regex) => page.locator(`input[placeholder="${target}"]`) },
    { label: "textarea", factory: (page, target, _regex) => page.locator(`textarea[name="${target}"], textarea[id="${target}"], textarea[aria-label="${target}"], textarea[placeholder="${target}"]`) },
    { label: "select", factory: (page, target, _regex) => page.locator(`select[name="${target}"], select[id="${target}"], select[aria-label="${target}"]`) },
    { label: "contenteditable", factory: (page, target, _regex) => page.locator(`[contenteditable="true"][aria-label="${target}"], [contenteditable="true"][name="${target}"], [contenteditable="true"][id="${target}"]`) },
    { label: "input[fuzzy]", factory: (page, target, regex) => page.locator(`input[name^="${target.substring(0, 3)}"], input[placeholder^="${target.substring(0, 3)}"], input[aria-label^="${target.substring(0, 3)}"]`) },
];
function createScopedFillStrategies(containerLocator, target) {
    const regex = buildFlexibleTokenRegex(target);
    return [
        { label: "activeContainer:getByLabel", factory: () => containerLocator.getByLabel(target, { exact: false }) },
        { label: "activeContainer:getByPlaceholder", factory: () => containerLocator.getByPlaceholder(target, { exact: false }) },
        { label: "activeContainer:getByRole(textbox)", factory: () => containerLocator.getByRole("textbox", { name: regex }) },
        { label: "activeContainer:getByRole(combobox)", factory: () => containerLocator.getByRole("combobox", { name: regex }) },
        { label: "activeContainer:getByRole(searchbox)", factory: () => containerLocator.getByRole("searchbox", { name: regex }) },
        { label: "activeContainer:input[name]", factory: () => containerLocator.locator(`input[name="${target}"]`) },
        { label: "activeContainer:input[id]", factory: () => containerLocator.locator(`input[id="${target}"]`) },
        { label: "activeContainer:input[aria-label]", factory: () => containerLocator.locator(`input[aria-label="${target}"]`) },
        { label: "activeContainer:textarea", factory: () => containerLocator.locator(`textarea[name="${target}"], textarea[id="${target}"], textarea[aria-label="${target}"]`) },
        { label: "activeContainer:select", factory: () => containerLocator.locator(`select[name="${target}"], select[id="${target}"], select[aria-label="${target}"]`) },
    ];
}
function escapeCssId(id) {
    return id.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, "\\$1");
}
async function tryConstructLocatorFromSnapshotElement(page, element, target, activeContainer) {
    const attemptedStrategies = [];
    // Try with container first, then fallback to page
    const containers = activeContainer?.containerLocator ? [activeContainer.containerLocator, page] : [page];
    for (const container of containers) {
        const isPageFallback = container === page && activeContainer?.containerLocator;
        // Strategy 1: Try domId with CSS-safe selector
        if (element.domId) {
            attemptedStrategies.push("domId");
            const escapedId = escapeCssId(element.domId);
            const locator = container.locator(`[id="${escapedId}"]`);
            const count = await locator.count();
            console.log(`[fill-resolver] Trying domId="${element.domId}" count=${count}${isPageFallback ? ' (page fallback)' : ''}`);
            if (count > 0) {
                return { locator, strategy: "domId" };
            }
        }
        // Strategy 2: Try name attribute
        if (element.name) {
            attemptedStrategies.push("name");
            const locator = container.locator(`[name="${element.name}"]`);
            if (await locator.count() > 0) {
                return { locator, strategy: "name" };
            }
        }
        // Strategy 3: Try aria-label
        if (element.ariaLabel) {
            attemptedStrategies.push("aria-label");
            const locator = container.locator(`[aria-label="${element.ariaLabel}"]`);
            if (await locator.count() > 0) {
                return { locator, strategy: "aria-label" };
            }
        }
        // Strategy 4: Try placeholder
        if (element.placeholder) {
            attemptedStrategies.push("placeholder");
            const locator = container.locator(`[placeholder="${element.placeholder}"]`);
            if (await locator.count() > 0) {
                return { locator, strategy: "placeholder" };
            }
        }
        // Strategy 5: Try role-based locator
        if (element.role && ["textbox", "combobox", "searchbox", "spinbutton"].includes(element.role)) {
            attemptedStrategies.push(`role:${element.role}`);
            const regex = buildFlexibleTokenRegex(target);
            const locator = container.getByRole(element.role, { name: regex });
            if (await locator.count() > 0) {
                return { locator, strategy: `role:${element.role}` };
            }
        }
        // Strategy 6: Try label
        if (element.label) {
            attemptedStrategies.push("label");
            const locator = container.getByLabel(element.label, { exact: false });
            if (await locator.count() > 0) {
                return { locator, strategy: "label" };
            }
        }
        // Strategy 7: Tag-based with type detection
        const tagName = element.tagName?.toLowerCase();
        const inputType = element.inputType?.toLowerCase();
        if (tagName === "input" || tagName === "textarea" || tagName === "select") {
            attemptedStrategies.push(`tag:${tagName}`);
            const normalizedTarget = target.toLowerCase();
            let typeSelector = "";
            if (normalizedTarget.includes("password") || normalizedTarget.includes("contrasena") || normalizedTarget.includes("clave")) {
                typeSelector = 'input[type="password"]';
            }
            else if (normalizedTarget.includes("email") || normalizedTarget.includes("correo")) {
                typeSelector = 'input[type="email"]';
            }
            else if (normalizedTarget.includes("username") || normalizedTarget.includes("usuario") || normalizedTarget.includes("user")) {
                typeSelector = 'input[type="text"]:not([type="password"]), input:not([type])';
            }
            else if (inputType && inputType !== "hidden" && inputType !== "submit" && inputType !== "button") {
                typeSelector = `input[type="${inputType}"]`;
            }
            else if (tagName === "textarea") {
                typeSelector = "textarea";
            }
            else if (tagName === "select") {
                typeSelector = "select";
            }
            else {
                typeSelector = "input:text, input:not([type]), input[type=text], input[type=email], input:not([type=hidden]):not([type=submit]):not([type=button])";
            }
            const locator = container.locator(typeSelector).first();
            if (await locator.count() > 0) {
                return { locator, strategy: `tag:${tagName}:type:${inputType || "text"}` };
            }
        }
        if (!isPageFallback) {
            console.log(`[fill-resolver] Container strategies exhausted, trying page fallback`);
        }
    }
    console.log(`[fill-resolver] No stable locator attributes found for candidate: domId=${element.domId}, name=${element.name}, ariaLabel=${element.ariaLabel}, placeholder=${element.placeholder}, inputType=${element.inputType}`);
    return { strategy: "none", reason: "missing_stable_locator_attributes" };
}
async function tryLoginFillFallback(page, target, activeContainer, snapshot) {
    const normalizedTarget = target.toLowerCase();
    const isUsername = normalizedTarget.includes("username") || normalizedTarget.includes("usuario") || normalizedTarget.includes("user") || normalizedTarget.includes("login") || normalizedTarget.includes("email") || normalizedTarget.includes("correo");
    const isPassword = normalizedTarget.includes("password") || normalizedTarget.includes("contrasena") || normalizedTarget.includes("clave");
    if (!isUsername && !isPassword) {
        return { strategy: "none", reason: "not_login_field" };
    }
    // If snapshot is provided, use it to find editable inputs
    if (snapshot) {
        const EDITABLE_TAGS = new Set(["input", "textarea", "select"]);
        const EDITABLE_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);
        const editableElements = snapshot.elements.filter(el => {
            if (el.tagName && EDITABLE_TAGS.has(el.tagName.toLowerCase()))
                return true;
            if (el.role && EDITABLE_ROLES.has(el.role.toLowerCase()))
                return true;
            return false;
        });
        console.log(`[fill-resolver] Login fallback: found ${editableElements.length} editable elements in snapshot`);
        const inputs = [];
        for (let i = 0; i < editableElements.length; i++) {
            const el = editableElements[i];
            if (!el.visible)
                continue;
            const type = el.inputType || (el.tagName === "textarea" ? "textarea" : el.tagName === "select" ? "select" : "text");
            inputs.push({ element: el, type: type.toLowerCase(), index: i });
            console.log(`[fill-resolver] Login fallback candidate index=${i} tag=${el.tagName} type="${type}" visible=true enabled=true editable=true`);
        }
        if (inputs.length === 0) {
            return { strategy: "none", reason: "no_enabled_visible_inputs" };
        }
        if (isPassword) {
            const passwordInput = inputs.find(i => i.type === "password");
            if (passwordInput) {
                console.log(`[fill-resolver] Login fallback: field="Password" selected input index=${passwordInput.index} type="password"`);
                const locatorResult = await tryConstructLocatorFromSnapshotElement(page, passwordInput.element, target, activeContainer);
                if (locatorResult.locator) {
                    return { locator: locatorResult.locator, strategy: "login_fallback:password", reason: "password_input_found" };
                }
                return { strategy: "none", reason: "password_locator_not_constructable" };
            }
            if (inputs.length === 2) {
                console.log(`[fill-resolver] Login fallback: field="Password" selected input index=${inputs[1].index} type="${inputs[1].type}" (second input in 2-field form)`);
                const locatorResult = await tryConstructLocatorFromSnapshotElement(page, inputs[1].element, target, activeContainer);
                if (locatorResult.locator) {
                    return { locator: locatorResult.locator, strategy: "login_fallback:second_input", reason: "second_input_in_login_form" };
                }
            }
            return { strategy: "none", reason: "no_password_input_found" };
        }
        if (isUsername) {
            const emailInput = inputs.find(i => i.type === "email");
            if (emailInput) {
                console.log(`[fill-resolver] Login fallback: field="Username" selected input index=${emailInput.index} type="email"`);
                const locatorResult = await tryConstructLocatorFromSnapshotElement(page, emailInput.element, target, activeContainer);
                if (locatorResult.locator) {
                    return { locator: locatorResult.locator, strategy: "login_fallback:email", reason: "email_input_found" };
                }
                return { strategy: "none", reason: "email_locator_not_constructable" };
            }
            const textInput = inputs.find(i => i.type === "text" || i.type === "");
            if (textInput && !textInput.type.includes("password")) {
                console.log(`[fill-resolver] Login fallback: field="Username" selected input index=${textInput.index} type="${textInput.type || "text"}"`);
                const locatorResult = await tryConstructLocatorFromSnapshotElement(page, textInput.element, target, activeContainer);
                if (locatorResult.locator) {
                    return { locator: locatorResult.locator, strategy: "login_fallback:text", reason: "text_input_found" };
                }
            }
            if (inputs.length >= 1 && inputs[0].type !== "password") {
                console.log(`[fill-resolver] Login fallback: field="Username" selected input index=${inputs[0].index} type="${inputs[0].type}" (first non-password input)`);
                const locatorResult = await tryConstructLocatorFromSnapshotElement(page, inputs[0].element, target, activeContainer);
                if (locatorResult.locator) {
                    return { locator: locatorResult.locator, strategy: "login_fallback:first_non_password", reason: "first_non_password_input" };
                }
            }
            const nonPasswordInput = inputs.find(i => !i.type.includes("password"));
            if (nonPasswordInput) {
                console.log(`[fill-resolver] Login fallback: field="Username" selected input index=${nonPasswordInput.index} type="${nonPasswordInput.type}"`);
                const locatorResult = await tryConstructLocatorFromSnapshotElement(page, nonPasswordInput.element, target, activeContainer);
                if (locatorResult.locator) {
                    return { locator: locatorResult.locator, strategy: "login_fallback:non_password", reason: "non_password_input_found" };
                }
            }
            return { strategy: "none", reason: "no_username_input_found" };
        }
        return { strategy: "none", reason: "unknown_login_field_type" };
    }
    // Fallback to DOM-based approach if no snapshot
    if (!activeContainer.containerLocator) {
        return { strategy: "none", reason: "no_active_container_locator" };
    }
    // Get all inputs within the container without :visible filter
    const allInputs = activeContainer.containerLocator.locator("input, textarea, select, [contenteditable=true]");
    const count = await allInputs.count();
    console.log(`[fill-resolver] Login fallback: container has ${count} inputs`);
    if (count === 0) {
        return { strategy: "none", reason: "no_visible_inputs_in_container" };
    }
    if (count > 6) {
        return { strategy: "none", reason: "too_many_inputs_for_login_fallback" };
    }
    const inputs = [];
    for (let i = 0; i < count; i++) {
        const input = allInputs.nth(i);
        try {
            const visible = await input.isVisible().catch(() => false);
            console.log(`[fill-resolver] Login fallback candidate index=${i} visible=${visible}`);
            if (!visible)
                continue;
            const enabled = await input.isEnabled().catch(() => false);
            if (!enabled)
                continue;
            const type = await input.evaluate((el) => el.getAttribute("type") || "text").catch(() => "text");
            inputs.push({ index: i, type: type.toLowerCase(), locator: input, visible: true, enabled: true });
            console.log(`[fill-resolver] Login fallback candidate index=${i} type="${type}" visible=true enabled=true`);
        }
        catch (e) {
            console.log(`[fill-resolver] Login fallback candidate index=${i} error: ${e}`);
        }
    }
    console.log(`[fill-resolver] Login fallback candidates: count=${inputs.length}`);
    for (let i = 0; i < inputs.length; i++) {
        console.log(`[fill-resolver] candidate index=${inputs[i].index} tag=input type="${inputs[i].type}" visible=true enabled=true editable=true`);
    }
    if (inputs.length === 0) {
        return { strategy: "none", reason: "no_enabled_visible_inputs" };
    }
    if (isPassword) {
        const passwordInput = inputs.find(i => i.type === "password");
        if (passwordInput) {
            console.log(`[fill-resolver] Login fallback: field="Password" selected input index=${passwordInput.index} type="password"`);
            return { locator: passwordInput.locator, strategy: "login_fallback:password", reason: "password_input_found" };
        }
        if (inputs.length === 2) {
            console.log(`[fill-resolver] Login fallback: field="Password" selected input index=1 type="${inputs[1].type}" (second input in 2-field form)`);
            return { locator: inputs[1].locator, strategy: "login_fallback:second_input", reason: "second_input_in_login_form" };
        }
        return { strategy: "none", reason: "no_password_input_found" };
    }
    if (isUsername) {
        const emailInput = inputs.find(i => i.type === "email");
        if (emailInput) {
            console.log(`[fill-resolver] Login fallback: field="Username" selected input index=${emailInput.index} type="email"`);
            return { locator: emailInput.locator, strategy: "login_fallback:email", reason: "email_input_found" };
        }
        const textInput = inputs.find(i => i.type === "text" || i.type === "");
        if (textInput && !textInput.type.includes("password")) {
            console.log(`[fill-resolver] Login fallback: field="Username" selected input index=${textInput.index} type="${textInput.type || "text"}"`);
            return { locator: textInput.locator, strategy: "login_fallback:text", reason: "text_input_found" };
        }
        if (inputs.length >= 1 && inputs[0].type !== "password") {
            console.log(`[fill-resolver] Login fallback: field="Username" selected input index=${inputs[0].index} type="${inputs[0].type}" (first non-password input)`);
            return { locator: inputs[0].locator, strategy: "login_fallback:first_non_password", reason: "first_non_password_input" };
        }
        const nonPasswordInput = inputs.find(i => !i.type.includes("password"));
        if (nonPasswordInput) {
            console.log(`[fill-resolver] Login fallback: field="Username" selected input index=${nonPasswordInput.index} type="${nonPasswordInput.type}"`);
            return { locator: nonPasswordInput.locator, strategy: "login_fallback:non_password", reason: "non_password_input_found" };
        }
        return { strategy: "none", reason: "no_username_input_found" };
    }
    return { strategy: "none", reason: "unknown_login_field_type" };
}
async function tryFillLocator(page, strategy, target, regex, attempted, activeContainer) {
    attempted.push(strategy.label);
    const locator = strategy.factory(page, target, regex);
    try {
        const count = await locator.count();
        if (count > 0) {
            for (let i = 0; i < count; i++) {
                const element = locator.nth(i);
                let isVisible = true;
                let isEnabled = true;
                let tagName = "unknown";
                let role = "";
                let readOnly = false;
                let contentEditable = false;
                let insideActiveContainer = false;
                try {
                    isVisible = await element.isVisible().catch(() => true);
                    isEnabled = await element.isEnabled().catch(() => true);
                    tagName = await element.evaluate((el) => el.tagName.toLowerCase()).catch(() => "unknown");
                    role = await element.evaluate((el) => el.getAttribute("role") || "").catch(() => "");
                    ({ readOnly, contentEditable } = await element.evaluate((el) => ({
                        readOnly: ("readOnly" in el && Boolean(el.readOnly)) || el.getAttribute("aria-readonly") === "true",
                        contentEditable: el.isContentEditable,
                    })).catch(() => ({ readOnly: false, contentEditable: false })));
                    if (activeContainer?.containerLocator) {
                        const containerBox = await activeContainer.containerLocator.boundingBox().catch(() => null);
                        const elementBox = await element.boundingBox().catch(() => null);
                        if (containerBox && elementBox) {
                            insideActiveContainer =
                                elementBox.x >= containerBox.x &&
                                    elementBox.y >= containerBox.y &&
                                    elementBox.x + elementBox.width <= containerBox.x + containerBox.width &&
                                    elementBox.y + elementBox.height <= containerBox.y + containerBox.height;
                        }
                    }
                }
                catch {
                    isVisible = true;
                    isEnabled = true;
                }
                if (isVisible && isEnabled) {
                    return {
                        locator: element,
                        locatorStrategy: strategy.label,
                        visible: true,
                        enabled: true,
                        readOnly,
                        contentEditable,
                        tagName,
                        role: role || undefined,
                        insideActiveContainer
                    };
                }
            }
            const firstElement = locator.first();
            let tagName = "unknown";
            let readOnly = false;
            let contentEditable = false;
            try {
                tagName = await firstElement.evaluate((el) => el.tagName.toLowerCase()).catch(() => "unknown");
                ({ readOnly, contentEditable } = await firstElement.evaluate((el) => ({
                    readOnly: ("readOnly" in el && Boolean(el.readOnly)) || el.getAttribute("aria-readonly") === "true",
                    contentEditable: el.isContentEditable,
                })).catch(() => ({ readOnly: false, contentEditable: false })));
            }
            catch {
                // ignore
            }
            return {
                locator: firstElement,
                locatorStrategy: strategy.label,
                visible: false,
                enabled: false,
                readOnly,
                contentEditable,
                tagName
            };
        }
    }
    catch {
        // ignore
    }
    return {};
}
async function resolveTableFieldEditor(page, target, context = {}, options = {}) {
    const grid = await resolveGridEditor(page, target, context, options);
    if (grid.locator || context.rowScope !== undefined || context.entityScope || context.associatedField) {
        return { locator: grid.locator, cell: grid.cell, strategy: grid.strategy, diagnostics: grid.diagnostics };
    }
    const tables = page.locator("table");
    const tableCount = await tables.count().catch(() => 0);
    for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
        const table = tables.nth(tableIndex);
        const headerCells = table.locator("thead th, thead td, [role='columnheader']");
        const headerCount = await headerCells.count().catch(() => 0);
        const effectiveHeaders = headerCount > 0 ? headerCells : table.locator("tr").first().locator("th, td, [role='columnheader']");
        const effectiveHeaderCount = await effectiveHeaders.count().catch(() => 0);
        let fieldColumn = -1;
        for (let columnIndex = 0; columnIndex < effectiveHeaderCount; columnIndex += 1) {
            const headerText = await effectiveHeaders.nth(columnIndex).innerText().catch(() => "");
            if (fieldLabelMatchesHeader(target, headerText)) {
                fieldColumn = columnIndex;
                break;
            }
        }
        if (fieldColumn < 0)
            continue;
        const rows = table.locator("tbody tr");
        const rowCount = await rows.count().catch(() => 0);
        const effectiveRows = rowCount > 0 ? rows : table.locator("tr").nth(1);
        const effectiveRowCount = rowCount > 0 ? rowCount : await effectiveRows.count().catch(() => 0);
        for (let rowIndex = 0; rowIndex < effectiveRowCount; rowIndex += 1) {
            const row = rowCount > 0 ? rows.nth(rowIndex) : effectiveRows;
            const rowCells = row.locator("td, th");
            const rowCellCount = await rowCells.count().catch(() => 0);
            const leadingCellOffset = Math.max(0, rowCellCount - effectiveHeaderCount);
            const cell = rowCells.nth(fieldColumn + leadingCellOffset);
            const editors = cell.locator("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox']");
            const editorCount = await editors.count().catch(() => 0);
            for (let editorIndex = 0; editorIndex < editorCount; editorIndex += 1) {
                const editor = editors.nth(editorIndex);
                if (!(await editor.isVisible().catch(() => false)))
                    continue;
                if (!(await editor.isEnabled().catch(() => true)))
                    continue;
                return { locator: editor, cell, strategy: "table_field_editor" };
            }
        }
    }
    return {};
}
async function resolveFillTarget(page, snapshot, target, activeContainer, gridContext = {}) {
    const attemptedLocators = [];
    const rejectedCandidates = [];
    const evaluatedCandidates = [];
    const localResolversTried = ["fill_resolver"];
    const regex = buildFlexibleTokenRegex(target);
    console.log(`[fill-resolver] Resolving field="${target}"${activeContainer ? ` within active container="${activeContainer.type}"` : ""}`);
    const EDITABLE_TAGS = new Set(["input", "textarea", "select"]);
    const EDITABLE_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);
    function isEditableElement(tagName, role, contentEditable = false, readOnly = false) {
        if (readOnly)
            return false;
        if (contentEditable)
            return true;
        if (EDITABLE_TAGS.has(tagName.toLowerCase()))
            return true;
        if (role && EDITABLE_ROLES.has(role.toLowerCase()))
            return true;
        return false;
    }
    const recorded = await resolveRecordedTechnicalTarget(page, gridContext.recordedTechnicalTargets, "fill", gridContext.recordedTechnicalTargetRefs);
    const gridScoped = gridContext.rowScope !== undefined || Boolean(gridContext.entityScope) || Boolean(gridContext.associatedField);
    if (recorded && (!gridScoped || recorded.structuralCompatibility === true)) {
        const tagName = await recorded.locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "unknown");
        console.log(`[recording-replay] technicalTargetResolved=true strategy=${recorded.strategy} currentMatchCount=${recorded.currentMatchCount} structurallyCompatible=${recorded.structuralCompatibility}`);
        return {
            status: "resolved",
            target,
            locator: recorded.locator,
            locatorStrategy: recorded.strategy,
            confidence: recorded.confidence,
            matchReason: "recorded_technical_target_current_dom",
            matchedTag: tagName,
            attemptedLocators: [recorded.strategy],
            editableCandidatesCount: 1,
            fillDiagnostics: {
                field: target,
                activeContainerUsed: Boolean(activeContainer),
                activeContainerType: activeContainer?.type,
                candidatesEvaluated: 1,
                candidatesEvaluatedDetails: [{
                        strategy: recorded.strategy,
                        tagName,
                        visible: true,
                        enabled: true,
                        editable: true,
                        insideActiveContainer: Boolean(activeContainer),
                        text: target,
                    }],
                rejectedCandidates: [],
                selectedCandidate: {
                    strategy: recorded.strategy,
                    tagName,
                    visible: true,
                    enabled: true,
                    editable: true,
                    insideActiveContainer: Boolean(activeContainer),
                },
            },
            localResolversTried: ["recorded_technical_target"],
            autoRepairSkippedReason: "recorded_contract_current_dom_validated",
        };
    }
    if (recorded && gridScoped) {
        console.log(`[recording-replay] technicalTargetSkipped=true reason=grid_structural_context_not_compatible target="${target}"`);
    }
    const tableEditor = await resolveTableFieldEditor(page, target, gridContext, { controlKind: "fill" });
    if (tableEditor.locator) {
        const tagName = await tableEditor.locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "input");
        console.log(`[fill-resolver] Candidate accepted: tag="${tagName}" strategy="${tableEditor.strategy}" visible=true enabled=true editable=true`);
        return {
            status: "resolved",
            target,
            locator: tableEditor.locator,
            verificationLocator: tableEditor.cell,
            locatorStrategy: tableEditor.strategy,
            confidence: 1.0,
            matchReason: "table_header_field_editor",
            matchedTag: tagName,
            attemptedLocators: [tableEditor.strategy ?? "table_field_editor"],
            editableCandidatesCount: 1,
            fillDiagnostics: {
                field: target,
                activeContainerUsed: false,
                activeContainerType: activeContainer?.type,
                candidatesEvaluated: 1,
                candidatesEvaluatedDetails: [{
                        strategy: tableEditor.strategy ?? "table_field_editor",
                        tagName,
                        visible: true,
                        enabled: true,
                        editable: true,
                        insideActiveContainer: false,
                        text: target
                    }],
                rejectedCandidates: [],
                selectedCandidate: {
                    strategy: tableEditor.strategy ?? "table_field_editor",
                    tagName,
                    visible: true,
                    enabled: true,
                    editable: true,
                    insideActiveContainer: false
                }
            },
            ...(tableEditor.diagnostics ? { gridDiagnostics: tableEditor.diagnostics } : {}),
            localResolversTried: ["table_field_editor"],
            autoRepairSkippedReason: "local_diagnostic_sufficient"
        };
    }
    // Some grids record a direct fill even though the current DOM first exposes
    // a display-only cell control. Treat that control as the structural editor
    // activation authority, then resolve the newly materialized editable child.
    // This remains generic: the row/column context selects the cell and the DOM
    // selects the actual interactive control; no field-specific locator is used.
    if (gridContext.rowScope !== undefined || gridContext.entityScope || gridContext.associatedField) {
        const interactiveCellControl = await resolveGridEditor(page, target, gridContext, {
            includeInteractiveControls: true,
            allowActivation: false,
        });
        if (interactiveCellControl.locator) {
            const beforeActivation = await resolveGridEditor(page, target, gridContext, {
                controlKind: "fill",
                allowActivation: false,
            });
            if (!beforeActivation.locator) {
                const activationStrategy = interactiveCellControl.strategy ?? "grid_cell_interactive_control";
                console.log(`[grid-editor-activation] field="${target}" strategy=${activationStrategy}`);
                await interactiveCellControl.locator.click().catch(() => undefined);
                const deadline = Date.now() + 2000;
                while (Date.now() < deadline) {
                    const materializedEditor = await resolveGridEditor(page, target, gridContext, {
                        controlKind: "fill",
                        allowActivation: false,
                    });
                    if (materializedEditor.locator) {
                        const tagName = await materializedEditor.locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "input");
                        console.log(`[grid-editor-activation] field="${target}" materialized=true tag="${tagName}"`);
                        return {
                            status: "resolved",
                            target,
                            locator: materializedEditor.locator,
                            verificationLocator: materializedEditor.cell,
                            locatorStrategy: materializedEditor.strategy ?? "grid_cell_editor_after_activation",
                            confidence: 1.0,
                            matchReason: "grid_cell_editor_materialized_after_interactive_activation",
                            matchedTag: tagName,
                            attemptedLocators: [activationStrategy, materializedEditor.strategy ?? "grid_cell_editor_after_activation"],
                            editableCandidatesCount: 1,
                            fillDiagnostics: {
                                field: target,
                                activeContainerUsed: false,
                                activeContainerType: activeContainer?.type,
                                candidatesEvaluated: 1,
                                candidatesEvaluatedDetails: [{
                                        strategy: materializedEditor.strategy ?? "grid_cell_editor_after_activation",
                                        tagName,
                                        visible: true,
                                        enabled: true,
                                        editable: true,
                                        insideActiveContainer: false,
                                        text: target,
                                    }],
                                rejectedCandidates: [],
                                selectedCandidate: {
                                    strategy: materializedEditor.strategy ?? "grid_cell_editor_after_activation",
                                    tagName,
                                    visible: true,
                                    enabled: true,
                                    editable: true,
                                    insideActiveContainer: false,
                                },
                            },
                            ...(materializedEditor.diagnostics ? { gridDiagnostics: materializedEditor.diagnostics } : {}),
                            localResolversTried: ["grid_interactive_activation", "grid_cell_editor"],
                            autoRepairSkippedReason: "local_diagnostic_sufficient",
                        };
                    }
                    await page.waitForTimeout(100).catch(() => undefined);
                }
            }
        }
    }
    // Phase 0: Try scoped strategies within active container first (if exists)
    if (activeContainer?.containerLocator) {
        console.log(`[fill-resolver] Trying scoped search within active container="${activeContainer.type}"`);
        const scopedStrategies = createScopedFillStrategies(activeContainer.containerLocator, target);
        for (const strategy of scopedStrategies) {
            const result = await tryFillLocator(page, { label: strategy.label, factory: () => strategy.factory() }, target, regex, attemptedLocators, activeContainer);
            if (result.locator) {
                const tag = result.tagName ?? await result.locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "unknown");
                const role = result.role;
                const insideActiveContainer = true;
                evaluatedCandidates.push({
                    strategy: strategy.label,
                    tagName: tag,
                    role,
                    visible: result.visible ?? false,
                    enabled: result.enabled ?? false,
                    editable: isEditableElement(tag, role, result.contentEditable, result.readOnly),
                    insideActiveContainer
                });
                if (!result.visible || !result.enabled) {
                    rejectedCandidates.push({
                        strategy: strategy.label,
                        reason: !result.visible ? "not_visible" : "not_enabled",
                        tagName: tag
                    });
                    continue;
                }
                if (!isEditableElement(tag, role, result.contentEditable, result.readOnly)) {
                    rejectedCandidates.push({
                        strategy: strategy.label,
                        reason: "not_editable",
                        tagName: tag,
                        text: target
                    });
                    console.log(`[fill-resolver] Candidate rejected: tag="${tag}" reason="not_editable"`);
                    continue;
                }
                console.log(`[fill-resolver] Candidate accepted: tag="${tag}" strategy="${strategy.label}" visible=true enabled=true editable=true insideActiveContainer=true`);
                return {
                    status: "resolved",
                    target,
                    locator: result.locator,
                    locatorStrategy: result.locatorStrategy,
                    confidence: 1.0,
                    matchReason: `fill_locator_${strategy.label}`,
                    matchedTag: tag,
                    attemptedLocators,
                    editableCandidatesCount: 1,
                    fillDiagnostics: {
                        field: target,
                        activeContainerUsed: true,
                        activeContainerType: activeContainer.type,
                        candidatesEvaluated: evaluatedCandidates.length,
                        candidatesEvaluatedDetails: evaluatedCandidates,
                        rejectedCandidates,
                        selectedCandidate: {
                            strategy: strategy.label,
                            tagName: tag,
                            role,
                            visible: true,
                            enabled: true,
                            editable: true,
                            insideActiveContainer: true
                        }
                    },
                    localResolversTried,
                    autoRepairSkippedReason: "local_diagnostic_sufficient"
                };
            }
        }
    }
    // Phase 1: Playwright native locator strategies with visibility and editability checks
    for (const strategy of FILL_LOCATOR_STRATEGIES) {
        const result = await tryFillLocator(page, strategy, target, regex, attemptedLocators, activeContainer);
        if (result.locator) {
            const tag = result.tagName ?? await result.locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "unknown");
            const role = result.role;
            const insideActiveContainer = result.insideActiveContainer ?? false;
            evaluatedCandidates.push({
                strategy: strategy.label,
                tagName: tag,
                role,
                visible: result.visible ?? false,
                enabled: result.enabled ?? false,
                editable: isEditableElement(tag, role, result.contentEditable, result.readOnly),
                insideActiveContainer
            });
            if (!result.visible || !result.enabled) {
                rejectedCandidates.push({
                    strategy: strategy.label,
                    reason: !result.visible ? "not_visible" : "not_enabled",
                    tagName: tag
                });
                continue;
            }
            if (!isEditableElement(tag, role, result.contentEditable, result.readOnly)) {
                rejectedCandidates.push({
                    strategy: strategy.label,
                    reason: "not_editable",
                    tagName: tag,
                    text: target
                });
                console.log(`[fill-resolver] Candidate rejected: tag="${tag}" reason="not_editable"`);
                continue;
            }
            console.log(`[fill-resolver] Candidate accepted: tag="${tag}" strategy="${strategy.label}" visible=true enabled=true editable=true${insideActiveContainer ? ' insideActiveContainer=true' : ''}`);
            return {
                status: "resolved",
                target,
                locator: result.locator,
                locatorStrategy: result.locatorStrategy,
                confidence: 1.0,
                matchReason: `fill_locator_${strategy.label}`,
                matchedTag: tag,
                attemptedLocators,
                editableCandidatesCount: 1,
                fillDiagnostics: {
                    field: target,
                    activeContainerUsed: insideActiveContainer,
                    activeContainerType: activeContainer?.type,
                    candidatesEvaluated: evaluatedCandidates.length,
                    candidatesEvaluatedDetails: evaluatedCandidates,
                    rejectedCandidates,
                    selectedCandidate: {
                        strategy: strategy.label,
                        tagName: tag,
                        role,
                        visible: true,
                        enabled: true,
                        editable: true,
                        insideActiveContainer
                    }
                },
                localResolversTried,
                autoRepairSkippedReason: "local_diagnostic_sufficient"
            };
        }
    }
    // Phase 2: Snapshot-based editable element resolution with active container priority
    const editableElements = snapshot.elements.filter((el) => isElementEditable(el));
    let bestMatch = null;
    for (const el of editableElements) {
        const texts = [el.label, el.name, el.placeholder, el.text, el.id].filter(Boolean);
        for (const text of texts) {
            const score = computeTokenScore(target, text);
            if (score > 0) {
                let insideActiveContainer = false;
                if (activeContainer?.containerElement) {
                    const containerClass = activeContainer.containerElement.className || "";
                    const elementClass = el.className || "";
                    if (containerClass && elementClass) {
                        const containerClasses = containerClass.split(/\s+/);
                        const elementClasses = elementClass.split(/\s+/);
                        insideActiveContainer = containerClasses.some(c => elementClasses.includes(c));
                    }
                }
                const boostedScore = insideActiveContainer ? Math.min(score + 0.1, 1.0) : score;
                if (!bestMatch || boostedScore > bestMatch.score) {
                    bestMatch = { element: el, score: boostedScore, field: text, insideActiveContainer };
                }
            }
        }
    }
    if (bestMatch && bestMatch.score >= 0.4) {
        const element = bestMatch.element;
        const locatorResult = await tryConstructLocatorFromSnapshotElement(page, element, target, activeContainer);
        attemptedLocators.push(locatorResult.strategy || "unknown");
        let locatorConstructed = false;
        if (locatorResult.locator) {
            console.log(`[fill-resolver] Trying candidate locator: strategy="${locatorResult.strategy}"`);
            let isVisible = true;
            let isEnabled = true;
            let tagName = element.tagName ?? "unknown";
            let role = element.role;
            let readOnly = false;
            let contentEditable = false;
            try {
                const count = await locatorResult.locator.count();
                if (count > 0) {
                    for (let i = 0; i < count; i++) {
                        const nthLocator = locatorResult.locator.nth(i);
                        const nthVisible = await nthLocator.isVisible().catch(() => true);
                        const nthEnabled = await nthLocator.isEnabled().catch(() => true);
                        if (nthVisible && nthEnabled) {
                            locatorResult.locator = nthLocator;
                            isVisible = true;
                            isEnabled = true;
                            break;
                        }
                    }
                }
                if (typeof locatorResult.locator.evaluate === "function") {
                    const elInfo = await locatorResult.locator.evaluate((el) => ({
                        tagName: el.tagName.toLowerCase(),
                        role: el.getAttribute("role") || "",
                        readOnly: ("readOnly" in el && Boolean(el.readOnly)) || el.getAttribute("aria-readonly") === "true",
                        contentEditable: el.isContentEditable,
                    })).catch(() => null);
                    if (elInfo) {
                        tagName = elInfo.tagName;
                        role = elInfo.role || undefined;
                        readOnly = elInfo.readOnly;
                        contentEditable = elInfo.contentEditable;
                    }
                }
            }
            catch {
                isVisible = true;
                isEnabled = true;
            }
            evaluatedCandidates.push({
                strategy: locatorResult.strategy || "snapshot",
                tagName,
                role,
                visible: isVisible,
                enabled: isEnabled,
                editable: isEditableElement(tagName, role, contentEditable, readOnly),
                insideActiveContainer: bestMatch.insideActiveContainer,
                text: bestMatch.field,
                domId: element.domId,
                name: element.name,
                placeholder: element.placeholder,
                ariaLabel: element.ariaLabel,
                score: bestMatch.score
            });
            if (!isVisible || !isEnabled) {
                rejectedCandidates.push({
                    strategy: locatorResult.strategy || "snapshot",
                    reason: !isVisible ? "not_visible" : "not_enabled",
                    tagName
                });
            }
            else if (!isEditableElement(tagName, role, contentEditable, readOnly)) {
                rejectedCandidates.push({
                    strategy: locatorResult.strategy || "snapshot",
                    reason: "not_editable",
                    tagName,
                    text: bestMatch.field
                });
                console.log(`[fill-resolver] Candidate rejected: tag="${tagName}" reason="not_editable"`);
            }
            else {
                locatorConstructed = true;
                console.log(`[fill-resolver] Candidate locator accepted: strategy="${locatorResult.strategy}" tag="${tagName}" visible=true enabled=true editable=true${bestMatch.insideActiveContainer ? ' insideActiveContainer=true' : ''}`);
                return {
                    status: "resolved",
                    target,
                    locator: locatorResult.locator,
                    locatorStrategy: locatorResult.strategy,
                    confidence: bestMatch.score,
                    matchReason: "snapshot_editable_match",
                    matchedTag: tagName,
                    matchedText: bestMatch.field,
                    attemptedLocators,
                    editableCandidatesCount: editableElements.length,
                    fillDiagnostics: {
                        field: target,
                        activeContainerUsed: bestMatch.insideActiveContainer,
                        activeContainerType: activeContainer?.type,
                        candidatesEvaluated: evaluatedCandidates.length,
                        candidatesEvaluatedDetails: evaluatedCandidates,
                        rejectedCandidates,
                        selectedCandidate: {
                            strategy: locatorResult.strategy || "snapshot",
                            tagName,
                            role,
                            visible: true,
                            enabled: true,
                            editable: true,
                            insideActiveContainer: bestMatch.insideActiveContainer
                        }
                    },
                    localResolversTried,
                    autoRepairSkippedReason: "local_diagnostic_sufficient"
                };
            }
        }
        else if (locatorResult.reason === "missing_stable_locator_attributes") {
            evaluatedCandidates.push({
                strategy: "snapshot",
                tagName: element.tagName ?? "unknown",
                role: element.role,
                visible: true,
                enabled: true,
                editable: true,
                insideActiveContainer: bestMatch.insideActiveContainer,
                text: bestMatch.field
            });
            rejectedCandidates.push({
                strategy: "snapshot",
                reason: "missing_stable_locator_attributes",
                tagName: element.tagName ?? "unknown",
                text: bestMatch.field
            });
            console.log(`[fill-resolver] Candidate rejected: strategy="snapshot" reason="missing_stable_locator_attributes"`);
            if (activeContainer?.containerLocator) {
                const loginFallback = await tryLoginFillFallback(page, target, activeContainer, snapshot);
                if (loginFallback.locator) {
                    console.log(`[fill-resolver] Login fallback successful: strategy="${loginFallback.strategy}"`);
                    return {
                        status: "resolved",
                        target,
                        locator: loginFallback.locator,
                        locatorStrategy: loginFallback.strategy,
                        confidence: 0.7,
                        matchReason: "login_fallback_match",
                        matchedTag: "input",
                        matchedText: target,
                        attemptedLocators,
                        editableCandidatesCount: editableElements.length,
                        fillDiagnostics: {
                            field: target,
                            activeContainerUsed: true,
                            activeContainerType: activeContainer.type,
                            candidatesEvaluated: evaluatedCandidates.length,
                            candidatesEvaluatedDetails: evaluatedCandidates,
                            rejectedCandidates,
                            selectedCandidate: {
                                strategy: loginFallback.strategy || "login_fallback",
                                tagName: "input",
                                visible: true,
                                enabled: true,
                                editable: true,
                                insideActiveContainer: true
                            }
                        },
                        localResolversTried,
                        autoRepairSkippedReason: "local_diagnostic_sufficient"
                    };
                }
                else {
                    console.log(`[fill-resolver] Login fallback attempted but failed: reason="${loginFallback.reason}"`);
                }
            }
        }
        if (!locatorConstructed) {
            const resolved = await resolveSnapshotElementLocator(page, {
                element: bestMatch.element,
                target,
                candidateText: bestMatch.field,
                type: bestMatch.element.type,
                tagName: bestMatch.element.tagName,
                confidence: bestMatch.score,
                matchReason: "snapshot_editable_match"
            });
            attemptedLocators.push(...resolved.attemptedLocators);
            if (resolved.locator) {
                let isVisible = true;
                let isEnabled = true;
                let tagName = bestMatch.element.tagName ?? "unknown";
                let role = bestMatch.element.role;
                let readOnly = false;
                let contentEditable = false;
                try {
                    if (typeof resolved.locator.isVisible === "function") {
                        isVisible = await resolved.locator.isVisible().catch(() => true);
                    }
                    if (typeof resolved.locator.isEnabled === "function") {
                        isEnabled = await resolved.locator.isEnabled().catch(() => true);
                    }
                    if (typeof resolved.locator.evaluate === "function") {
                        const elInfo = await resolved.locator.evaluate((el) => ({
                            tagName: el.tagName.toLowerCase(),
                            role: el.getAttribute("role") || "",
                            readOnly: ("readOnly" in el && Boolean(el.readOnly)) || el.getAttribute("aria-readonly") === "true",
                            contentEditable: el.isContentEditable,
                        })).catch(() => null);
                        if (elInfo) {
                            tagName = elInfo.tagName;
                            role = elInfo.role || undefined;
                            readOnly = elInfo.readOnly;
                            contentEditable = elInfo.contentEditable;
                        }
                    }
                }
                catch {
                    isVisible = true;
                    isEnabled = true;
                }
                evaluatedCandidates.push({
                    strategy: "snapshot",
                    tagName,
                    role,
                    visible: isVisible,
                    enabled: isEnabled,
                    editable: isEditableElement(tagName, role, contentEditable, readOnly),
                    insideActiveContainer: bestMatch.insideActiveContainer,
                    text: bestMatch.field
                });
                if (!isVisible || !isEnabled) {
                    rejectedCandidates.push({
                        strategy: "snapshot",
                        reason: !isVisible ? "not_visible" : "not_enabled",
                        tagName
                    });
                }
                else if (!isEditableElement(tagName, role, contentEditable, readOnly)) {
                    rejectedCandidates.push({
                        strategy: "snapshot",
                        reason: "not_editable",
                        tagName,
                        text: bestMatch.field
                    });
                    console.log(`[fill-resolver] Candidate rejected: tag="${tagName}" reason="not_editable"`);
                }
                else {
                    locatorConstructed = true;
                    console.log(`[fill-resolver] Candidate accepted: tag="${tagName}" strategy="snapshot" visible=true enabled=true editable=true${bestMatch.insideActiveContainer ? ' insideActiveContainer=true' : ''}`);
                    return {
                        status: "resolved",
                        target,
                        locator: resolved.locator,
                        locatorStrategy: resolved.locatorStrategy ?? "snapshot",
                        confidence: bestMatch.score,
                        matchReason: "snapshot_editable_match",
                        matchedTag: tagName,
                        matchedText: bestMatch.field,
                        attemptedLocators,
                        editableCandidatesCount: editableElements.length,
                        fillDiagnostics: {
                            field: target,
                            activeContainerUsed: bestMatch.insideActiveContainer,
                            activeContainerType: activeContainer?.type,
                            candidatesEvaluated: evaluatedCandidates.length,
                            candidatesEvaluatedDetails: evaluatedCandidates,
                            rejectedCandidates,
                            selectedCandidate: {
                                strategy: "snapshot",
                                tagName,
                                role,
                                visible: true,
                                enabled: true,
                                editable: true,
                                insideActiveContainer: bestMatch.insideActiveContainer
                            }
                        },
                        localResolversTried,
                        autoRepairSkippedReason: "local_diagnostic_sufficient"
                    };
                }
            }
        }
        if (!locatorConstructed) {
            evaluatedCandidates.push({
                strategy: "snapshot",
                tagName: bestMatch.element.tagName ?? "unknown",
                role: bestMatch.element.role,
                visible: true,
                enabled: true,
                editable: true,
                insideActiveContainer: bestMatch.insideActiveContainer,
                text: bestMatch.field
            });
            rejectedCandidates.push({
                strategy: "snapshot",
                reason: "locator_not_constructable",
                tagName: bestMatch.element.tagName ?? "unknown",
                text: bestMatch.field
            });
            console.log(`[fill-resolver] Editable candidate found but locator could not be constructed: tag="${bestMatch.element.tagName}" field="${bestMatch.field}"`);
        }
    }
    // Phase 3: Check for non-editable text matches (to distinguish not_found from not_editable)
    // IMPORTANT: Only return fill_target_not_editable if NO editable candidates were evaluated
    const nonEditableElements = snapshot.elements.filter((el) => !isElementEditable(el));
    let nonEditableMatch = null;
    for (const el of nonEditableElements) {
        if (!el.text)
            continue;
        const score = computeTokenScore(target, el.text);
        if (score >= 0.4 && (!nonEditableMatch || score > nonEditableMatch.score)) {
            nonEditableMatch = { text: el.text, tag: el.tagName ?? "unknown", score };
            evaluatedCandidates.push({
                strategy: "snapshot_text_match",
                tagName: el.tagName ?? "unknown",
                role: el.role,
                visible: el.visible ?? true,
                enabled: true,
                editable: false,
                insideActiveContainer: false,
                text: el.text
            });
        }
    }
    const editableCandidatesEvaluated = evaluatedCandidates.filter(c => c.editable);
    if (nonEditableMatch && editableCandidatesEvaluated.length === 0) {
        rejectedCandidates.push({
            strategy: "snapshot_text_match",
            reason: "not_editable",
            tagName: nonEditableMatch.tag,
            text: nonEditableMatch.text
        });
        console.log(`[fill-resolver] Candidate rejected: tag="${nonEditableMatch.tag}" text="${nonEditableMatch.text}" reason="not_editable"`);
        return {
            status: "fill_target_not_editable",
            target,
            confidence: Math.min(nonEditableMatch.score, 0.99),
            matchReason: "fill_target_not_editable",
            matchedTag: nonEditableMatch.tag,
            matchedText: nonEditableMatch.text,
            attemptedLocators,
            editableCandidatesCount: editableElements.length,
            fillDiagnostics: {
                field: target,
                activeContainerUsed: false,
                activeContainerType: activeContainer?.type,
                candidatesEvaluated: evaluatedCandidates.length,
                candidatesEvaluatedDetails: evaluatedCandidates,
                rejectedCandidates
            },
            nonEditableMatch: {
                text: nonEditableMatch.text,
                tag: nonEditableMatch.tag,
                reason: `Matched text is not an editable field. Found in <${nonEditableMatch.tag}> element.`
            },
            localResolversTried,
            autoRepairSkippedReason: "local_diagnostic_sufficient"
        };
    }
    if (nonEditableMatch && editableCandidatesEvaluated.length > 0) {
        rejectedCandidates.push({
            strategy: "snapshot_text_match",
            reason: "not_editable",
            tagName: nonEditableMatch.tag,
            text: nonEditableMatch.text
        });
        console.log(`[fill-resolver] Non-editable match found but ${editableCandidatesEvaluated.length} editable candidates were evaluated. Error based on editable candidates.`);
    }
    // Phase 4: Check for editable candidates without constructable locator
    if (editableCandidatesEvaluated.length > 0 && rejectedCandidates.some(c => c.reason === "locator_not_constructable")) {
        console.log(`[fill-resolver] Editable candidates found but no constructable locator: count=${editableCandidatesEvaluated.length}`);
        return {
            status: "not_found",
            target,
            confidence: 0.5,
            matchReason: "editable_candidates_without_constructable_locator",
            attemptedLocators,
            editableCandidatesCount: editableElements.length,
            fillDiagnostics: {
                field: target,
                activeContainerUsed: false,
                activeContainerType: activeContainer?.type,
                candidatesEvaluated: evaluatedCandidates.length,
                candidatesEvaluatedDetails: evaluatedCandidates,
                rejectedCandidates
            },
            localResolversTried,
            autoRepairSkippedReason: "local_diagnostic_sufficient"
        };
    }
    // Phase 5: No match found - check if we have rejected candidates due to visibility
    if (rejectedCandidates.length > 0 && rejectedCandidates.every(c => c.reason === "not_visible")) {
        console.log(`[fill-resolver] All candidates rejected: reason="not_visible"`);
        return {
            status: "not_visible",
            target,
            confidence: 0.5,
            matchReason: "fill_target_not_visible",
            attemptedLocators,
            editableCandidatesCount: editableElements.length,
            fillDiagnostics: {
                field: target,
                activeContainerUsed: false,
                activeContainerType: activeContainer?.type,
                candidatesEvaluated: evaluatedCandidates.length,
                candidatesEvaluatedDetails: evaluatedCandidates,
                rejectedCandidates
            },
            localResolversTried,
            autoRepairSkippedReason: "local_diagnostic_sufficient"
        };
    }
    // Phase 5: Final login fallback before returning not_found
    if (activeContainer?.containerLocator) {
        const normalizedTarget = target.toLowerCase();
        const isLoginField = normalizedTarget.includes("username") ||
            normalizedTarget.includes("usuario") ||
            normalizedTarget.includes("user") ||
            normalizedTarget.includes("login") ||
            normalizedTarget.includes("email") ||
            normalizedTarget.includes("correo") ||
            normalizedTarget.includes("password") ||
            normalizedTarget.includes("contrasena") ||
            normalizedTarget.includes("clave");
        if (isLoginField) {
            console.log(`[fill-resolver] Final login fallback attempt for field="${target}"`);
            const loginFallback = await tryLoginFillFallback(page, target, activeContainer, snapshot);
            if (loginFallback.locator) {
                console.log(`[fill-resolver] Final login fallback successful: strategy="${loginFallback.strategy}"`);
                return {
                    status: "resolved",
                    target,
                    locator: loginFallback.locator,
                    locatorStrategy: loginFallback.strategy,
                    confidence: 0.7,
                    matchReason: "login_fallback_match",
                    matchedTag: "input",
                    matchedText: target,
                    attemptedLocators,
                    editableCandidatesCount: evaluatedCandidates.length,
                    fillDiagnostics: {
                        field: target,
                        activeContainerUsed: true,
                        activeContainerType: activeContainer.type,
                        candidatesEvaluated: evaluatedCandidates.length,
                        candidatesEvaluatedDetails: evaluatedCandidates,
                        rejectedCandidates,
                        selectedCandidate: {
                            strategy: loginFallback.strategy || "login_fallback",
                            tagName: "input",
                            visible: true,
                            enabled: true,
                            editable: true,
                            insideActiveContainer: true
                        }
                    },
                    localResolversTried,
                    autoRepairSkippedReason: "local_diagnostic_sufficient"
                };
            }
            else {
                console.log(`[fill-resolver] Final login fallback failed: reason="${loginFallback.reason}"`);
            }
        }
    }
    // Phase 6: No match at all
    console.log(`[fill-resolver] No editable locator found for field="${target}"`);
    return {
        status: "not_found",
        target,
        confidence: 0,
        matchReason: "fill_target_not_found",
        attemptedLocators,
        editableCandidatesCount: editableElements.length,
        fillDiagnostics: {
            field: target,
            activeContainerUsed: false,
            activeContainerType: activeContainer?.type,
            candidatesEvaluated: evaluatedCandidates.length,
            candidatesEvaluatedDetails: evaluatedCandidates,
            rejectedCandidates
        },
        localResolversTried,
        autoRepairSkippedReason: "local_diagnostic_sufficient"
    };
}
function validateFillResolutionContract(result) {
    if (result.status === "resolved") {
        if (!result.locator) {
            return { valid: false, error: "resolved_without_locator" };
        }
        if (!result.locatorStrategy) {
            return { valid: false, error: "resolved_without_strategy" };
        }
        if (!result.fillDiagnostics?.selectedCandidate) {
            return { valid: false, error: "resolved_without_selected_candidate" };
        }
        if (!result.fillDiagnostics.selectedCandidate.editable) {
            return { valid: false, error: "resolved_with_non_editable_candidate" };
        }
        if (!result.fillDiagnostics.selectedCandidate.visible) {
            return { valid: false, error: "resolved_with_non_visible_candidate" };
        }
        if (!result.fillDiagnostics.selectedCandidate.enabled) {
            return { valid: false, error: "resolved_with_non_enabled_candidate" };
        }
    }
    return { valid: true };
}
const CONTAINER_SELECTORS = [
    "article", "section", "li", "tr", "fieldset", "form",
    "[role='group']", "[role='region']", "[role='listitem']",
    "[role='row']", "[role='article']", "[role='card']",
    "div[class*='card']", "div[class*='item']", "div[class*='product']",
    "div[class*='row']", "div[class*='panel']"
];
const CLICKABLE_ACTION_TAGS = ["button", "a", "input[type='submit']", "input[type='button']", "[role='button']", "[role='link']"];
async function evaluateContainers(page, entityText, actionTarget) {
    const entity = entityText.toLowerCase().trim();
    const action = actionTarget.toLowerCase().trim();
    const result = await page.evaluate(({ entity, action, containerSelectors, clickableSelectors }) => {
        const containers = [];
        const actions = [];
        let entityElementCount = 0;
        // Count all elements containing the entity text
        const allElements = document.querySelectorAll("*");
        allElements.forEach((el) => {
            const text = (el.textContent || "").toLowerCase().trim();
            if (text.includes(entity) && el.children.length === 0) {
                entityElementCount++;
            }
        });
        // Find containers by selector
        const seenContainers = new Set();
        for (const sel of containerSelectors) {
            const candidates = document.querySelectorAll(sel);
            for (const container of candidates) {
                if (seenContainers.has(container))
                    continue;
                if (!container.isConnected)
                    continue;
                const fullText = (container.textContent || "").toLowerCase().trim();
                if (!fullText.includes(entity))
                    continue;
                seenContainers.add(container);
                // Find the entity match text more precisely
                let entityMatchText = "";
                let entityScore = 0;
                const childElements = container.querySelectorAll("*");
                for (const child of childElements) {
                    const ct = (child.textContent || "").trim();
                    if (ct && ct.toLowerCase().includes(entity)) {
                        if (ct.toLowerCase() === entity) {
                            entityScore = 1.0;
                            entityMatchText = ct;
                            break;
                        }
                        if (ct.toLowerCase().includes(entity) && entityScore < 0.8) {
                            entityScore = 0.8;
                            entityMatchText = ct;
                        }
                    }
                }
                const tagName = container.tagName.toLowerCase();
                const rect = container.getBoundingClientRect();
                containers.push({
                    index: containers.length,
                    tagName,
                    textContent: fullText.slice(0, 200),
                    entityMatchScore: entityScore || (fullText.includes(entity) ? 0.5 : 0),
                    entityMatchText: entityMatchText || entity,
                    childActionCount: 0,
                    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                });
            }
        }
        // For each container, find clickable action elements
        const containerArray = Array.from(seenContainers);
        for (const container of containerArray) {
            const idx = containerArray.indexOf(container);
            const containerInfo = containers[idx];
            if (!containerInfo)
                continue;
            // Find clickable action elements matching the action target within container
            const clickableElements = container.querySelectorAll(clickableSelectors.join(","));
            let actionCount = 0;
            for (const el of clickableElements) {
                const elText = (el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
                if (!elText)
                    continue;
                const elLower = elText.toLowerCase();
                // Check if the element text matches the action target
                let actionScore = 0;
                if (elLower === action)
                    actionScore = 1.0;
                else if (elLower.includes(action))
                    actionScore = 0.7;
                else if (action.includes(elLower) && elLower.length > 3)
                    actionScore = 0.5;
                if (actionScore > 0) {
                    actionCount++;
                    const isVisible = el.offsetParent !== null;
                    if (!isVisible)
                        actionScore *= 0.3;
                    const role = el.getAttribute("role") || undefined;
                    const tag = el.tagName.toLowerCase();
                    // Build CSS selector for this element
                    let selector = "";
                    if (el.id) {
                        selector = `#${CSS.escape(el.id)}`;
                    }
                    else if (el.getAttribute("data-testid")) {
                        selector = `[data-testid="${CSS.escape(el.getAttribute("data-testid"))}"]`;
                    }
                    else if (el.getAttribute("data-test")) {
                        selector = `[data-test="${CSS.escape(el.getAttribute("data-test"))}"]`;
                    }
                    else if (el.getAttribute("name")) {
                        selector = `${tag}[name="${CSS.escape(el.getAttribute("name"))}"]`;
                    }
                    else if (el.getAttribute("aria-label")) {
                        selector = `${tag}[aria-label="${CSS.escape(el.getAttribute("aria-label"))}"]`;
                    }
                    const combinedScore = (containerInfo.entityMatchScore * 0.6 + actionScore * 0.4);
                    actions.push({
                        containerIndex: idx,
                        containerTag: containerInfo.tagName,
                        containerText: containerInfo.textContent.slice(0, 80),
                        actionText: elText,
                        actionTag: tag,
                        actionRole: role,
                        entityScore: containerInfo.entityMatchScore,
                        actionScore,
                        combinedScore,
                        actionSelector: selector || `${tag}:has-text("${CSS.escape(elText.slice(0, 30))}")`
                    });
                }
            }
            containerInfo.childActionCount = actionCount;
        }
        return { containers, actions, entityElementCount };
    }, { entity, action, containerSelectors: CONTAINER_SELECTORS, clickableSelectors: CLICKABLE_ACTION_TAGS });
    return result;
}
async function resolveAssociatedActionTarget(page, snapshot, actionTarget, associatedEntity) {
    const { containers, actions, entityElementCount } = await evaluateContainers(page, associatedEntity, actionTarget);
    const diagnostics = {
        associatedEntity,
        actionTarget,
        entityExists: entityElementCount > 0,
        entityElementCount,
        candidateContainers: containers,
        candidateActions: actions,
        selectedCandidate: undefined
    };
    // Check if entity exists at all
    if (entityElementCount === 0) {
        diagnostics.reason = `Entity "${associatedEntity}" not found on page. ${containers.length} semantic containers evaluated.`;
        return {
            status: "associated_entity_not_found",
            target: actionTarget,
            associatedEntity,
            confidence: 0,
            matchReason: "associated_entity_not_found",
            diagnostics
        };
    }
    // No containers found containing the entity
    if (containers.length === 0) {
        diagnostics.reason = `Entity "${associatedEntity}" found as text but not inside a clearly identifiable container.`;
        return {
            status: "needs_associated_target_resolution",
            target: actionTarget,
            associatedEntity,
            confidence: 0,
            matchReason: "entity_not_in_container",
            diagnostics
        };
    }
    // No action found within any container
    if (actions.length === 0) {
        diagnostics.reason = `Entity "${associatedEntity}" found in ${containers.length} container(s) but action "${actionTarget}" not found inside any container.`;
        return {
            status: "associated_action_not_found",
            target: actionTarget,
            associatedEntity,
            confidence: 0,
            matchReason: "associated_action_not_found",
            diagnostics
        };
    }
    // Sort actions by combined score descending
    const sorted = [...actions].sort((a, b) => b.combinedScore - a.combinedScore);
    const best = sorted[0];
    // Check for ambiguity: multiple containers with the same entity
    const uniqueContainers = new Set(actions.map((a) => a.containerIndex));
    if (uniqueContainers.size > 1) {
        // Multiple containers have the entity and overlapping actions
        const topActionsSameContainer = actions.filter((a) => a.containerIndex === best.containerIndex);
        if (topActionsSameContainer.length === 1 && best.combinedScore >= 0.5) {
            // Same container has a clear winner
            diagnostics.selectedCandidate = best;
        }
        else {
            diagnostics.reason = `Entity "${associatedEntity}" found in ${uniqueContainers.size} different containers with similar content. ${actions.length} candidate action(s) across containers.`;
            return {
                status: "needs_associated_target_resolution",
                target: actionTarget,
                associatedEntity,
                confidence: best.combinedScore,
                matchReason: "multiple_containers_ambiguous",
                diagnostics
            };
        }
    }
    // Single container with multiple matching actions
    if (sorted.length > 1 && uniqueContainers.size === 1) {
        const scoreDiff = sorted[0].combinedScore - sorted[1].combinedScore;
        if (scoreDiff < 0.15) {
            diagnostics.reason = `Single container has ${sorted.length} similar actions for "${actionTarget}". Top candidates: "${sorted[0].actionText}" (${sorted[0].combinedScore.toFixed(2)}) vs "${sorted[1].actionText}" (${sorted[1].combinedScore.toFixed(2)}).`;
            return {
                status: "needs_associated_target_resolution",
                target: actionTarget,
                associatedEntity,
                confidence: best.combinedScore,
                matchReason: "multiple_actions_in_container",
                diagnostics
            };
        }
    }
    // Confidence check
    if (best.combinedScore < 0.4) {
        diagnostics.reason = `Best candidate combined score ${best.combinedScore.toFixed(2)} below threshold 0.4. entityScore=${best.entityScore.toFixed(2)} actionScore=${best.actionScore.toFixed(2)}`;
        return {
            status: "needs_associated_target_resolution",
            target: actionTarget,
            associatedEntity,
            confidence: best.combinedScore,
            matchReason: "confidence_below_threshold",
            diagnostics
        };
    }
    // Resolve the locator
    let locator;
    let locatorStrategy = "associated-container";
    const strategySuffix = best.containerTag === "tr" ? "row" : best.containerTag === "li" ? "listitem" : best.containerTag.includes("card") ? "card" : "container";
    // Try using getByRole or getByText within the container context
    const containerIdx = best.containerIndex;
    const containerElements = await page.locator(CONTAINER_SELECTORS.join(",")).all();
    const targetContainer = containerElements[containerIdx];
    if (targetContainer) {
        // Try to find the action within the container using Playwright locators
        const actionRegex = buildFlexibleTextRegex(best.actionText);
        const containerLocator = targetContainer;
        // Try getByRole first
        const actionRole = best.actionRole || (best.actionTag === "a" ? "link" : "button");
        const roleLocator = containerLocator.getByRole(actionRole, { name: actionRegex });
        if (await roleLocator.count() > 0) {
            locator = roleLocator.first();
            locatorStrategy = `associated-${strategySuffix}:role`;
        }
        else {
            // Try getByText
            const textLocator = containerLocator.getByText(actionRegex, { exact: false });
            if (await textLocator.count() > 0) {
                locator = textLocator.first();
                locatorStrategy = `associated-${strategySuffix}:text`;
            }
        }
        // Fallback to CSS selector
        if (!locator && best.actionSelector) {
            const cssLocator = containerLocator.locator(best.actionSelector);
            if (await cssLocator.count() > 0) {
                locator = cssLocator.first();
                locatorStrategy = `associated-${strategySuffix}:css`;
            }
        }
    }
    if (!locator) {
        diagnostics.reason = `Container found but could not resolve Playwright locator for action "${best.actionText}" within it.`;
        return {
            status: "needs_associated_target_resolution",
            target: actionTarget,
            associatedEntity,
            confidence: best.combinedScore * 0.8,
            matchReason: "locator_resolution_failed",
            diagnostics
        };
    }
    diagnostics.selectedCandidate = best;
    return {
        status: "resolved",
        target: actionTarget,
        associatedEntity,
        locator,
        locatorStrategy,
        confidence: best.combinedScore,
        matchReason: `associated_${strategySuffix}_resolved`,
        containerText: best.containerText,
        containerTag: best.containerTag,
        diagnostics
    };
}
const SEMANTIC_SELECTORS = [
    "button", "a", "input[type='submit']", "input[type='button']",
    "[role='button']", "[role='link']", "[role='menuitem']", "[role='tab']",
    "[role='treeitem']", "[role='option']", "[contenteditable='true']"
];
function isSemanticSignal(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const obj = value;
    return typeof obj.key === "string" && typeof obj.value === "string";
}
function isSemanticCandidate(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const obj = value;
    if (typeof obj.elementIndex !== "number")
        return false;
    if (typeof obj.tagName !== "string")
        return false;
    if (typeof obj.type !== "string")
        return false;
    if (typeof obj.score !== "number")
        return false;
    if (!Array.isArray(obj.signals))
        return false;
    if (!obj.signals.every(isSemanticSignal))
        return false;
    if (obj.matchedSignal !== undefined && typeof obj.matchedSignal !== "string")
        return false;
    if (obj.signalValue !== undefined && typeof obj.signalValue !== "string")
        return false;
    return true;
}
function normalizeSemanticCandidates(value) {
    if (!Array.isArray(value))
        return [];
    const valid = [];
    for (const item of value) {
        if (!isSemanticCandidate(item))
            continue;
        valid.push({
            elementIndex: item.elementIndex,
            tagName: item.tagName,
            type: item.type,
            role: typeof item.role === "string" ? item.role : undefined,
            text: typeof item.text === "string" ? item.text : undefined,
            signals: item.signals,
            score: item.score,
            matchedSignal: item.matchedSignal || "",
            signalValue: item.signalValue || "",
            semanticGroup: typeof item.semanticGroup === "string" ? item.semanticGroup : undefined,
            selector: typeof item.selector === "string" ? item.selector : undefined
        });
    }
    return valid;
}
async function resolveSemanticActionTarget(page, target) {
    const targetTokens = tokenizeWithStopwords(target);
    const { tokens: expandedTokens, groups: matchedGroups } = expandSemanticTokens(targetTokens);
    const allExpanded = new Set(expandedTokens);
    const expandedTokensArray = Array.from(allExpanded);
    // Load evaluate code from external .js file to avoid tsx transpilation artifacts
    const evaluateTemplate = readEvaluateCode();
    const evaluateCode = evaluateTemplate
        .replace('__DATA_EXPANDED__', JSON.stringify(expandedTokensArray))
        .replace('__DATA_TOKENS__', JSON.stringify(targetTokens))
        .replace('__DATA_GROUPS__', JSON.stringify(matchedGroups))
        .replace('__DATA_SELECTORS__', JSON.stringify(SEMANTIC_SELECTORS));
    const rawResult = await page.evaluate(evaluateCode);
    const result = normalizeSemanticCandidates(rawResult);
    const allSignals = result.flatMap((c) => c.signals);
    const matchedSignals = result
        .filter((c) => c.score > 0)
        .map((c) => c.matchedSignal);
    if (result.length === 0) {
        return {
            status: "semantic_target_not_found",
            target,
            confidence: 0,
            matchReason: "no_semantic_candidates",
            candidateText: "",
            candidates: [],
            targetTokens,
            expandedTokens,
            matchedGroups,
            candidateSignals: allSignals,
            matchedSignals
        };
    }
    // Check for ambiguity
    if (result.length >= 2) {
        const secondScore = result[1].score;
        const scoreDiff = result[0].score - secondScore;
        if (scoreDiff < 0.15 && secondScore >= 0.35) {
            return {
                status: "ambiguous_semantic_target",
                target,
                confidence: result[0].score,
                matchReason: `multiple_semantic_candidates (${result.length} with score >= 0.35)`,
                candidateText: result[0].text || result[0].signalValue,
                candidates: result.slice(0, 5),
                targetTokens,
                expandedTokens,
                matchedGroups,
                candidateSignals: allSignals,
                matchedSignals
            };
        }
    }
    if (result[0].score < 0.4) {
        return {
            status: "semantic_target_not_found",
            target,
            confidence: result[0].score,
            matchReason: "semantic_confidence_below_threshold",
            candidateText: result[0].text || result[0].signalValue,
            candidates: result.slice(0, 5),
            targetTokens,
            expandedTokens,
            matchedGroups,
            candidateSignals: allSignals,
            matchedSignals
        };
    }
    // Build Playwright locator for the best candidate
    const best = result[0];
    let locator;
    let locatorStrategy = "semantic";
    if (best.selector) {
        locator = page.locator(best.selector);
        const count = await locator.count().catch(() => 0);
        if (count > 0) {
            locator = locator.first();
            locatorStrategy = `semantic:css`;
        }
        else {
            locator = undefined;
        }
    }
    if (!locator && best.role === "button" || best.tagName === "button") {
        const roleLocator = page.getByRole("button", { name: best.text || best.signalValue });
        if (await roleLocator.count().catch(() => 0) > 0) {
            locator = roleLocator.first();
            locatorStrategy = `semantic:role:button`;
        }
    }
    if (!locator && (best.role === "link" || best.tagName === "a")) {
        const linkLocator = page.getByRole("link", { name: best.text || best.signalValue });
        if (await linkLocator.count().catch(() => 0) > 0) {
            locator = linkLocator.first();
            locatorStrategy = `semantic:role:link`;
        }
    }
    if (!locator && best.text) {
        const textLocator = page.getByText(best.text, { exact: false });
        if (await textLocator.count().catch(() => 0) > 0) {
            locator = textLocator.first();
            locatorStrategy = `semantic:text`;
        }
    }
    // Fallback: try the selector again (might be the only option)
    if (!locator && best.selector) {
        const fallback = page.locator(best.selector);
        if (await fallback.count().catch(() => 0) > 0) {
            locator = fallback.first();
            locatorStrategy = `semantic:css-fallback`;
        }
    }
    const strategyDesc = best.matchedSignal === "href" ? "href" :
        best.matchedSignal === "aria-label" ? "accessible-name" :
            best.matchedSignal === "data-testid" ? "data-testid" :
                best.matchedSignal === "class" ? "icon" :
                    best.semanticGroup ? `group:${best.semanticGroup}` :
                        best.matchedSignal;
    return {
        status: "resolved",
        target,
        locator,
        locatorStrategy: locatorStrategy || `semantic:${strategyDesc}`,
        confidence: best.score,
        matchReason: `semantic_${strategyDesc}`,
        candidateText: best.text || best.signalValue,
        candidates: result.slice(0, 5),
        targetTokens,
        expandedTokens,
        matchedGroups,
        candidateSignals: allSignals,
        matchedSignals
    };
}
