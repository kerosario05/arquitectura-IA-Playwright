import { readFileSync } from "fs";
import { join } from "path";
import type { Page, Locator } from "@playwright/test";
import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";
import type { AppRouteProfile } from "../types/env.types";
import { parseProductConditionTarget, resolveProductConditionAgainstSnapshot, type ProductCondition } from "./product-condition-parser";
import { detectOrdinalSelectionPattern, resolveOrdinalSelection, type OrdinalSelectionResult } from "./ordinal-selection-resolver";
import { resolveAmbiguousIntermediateTarget, type ContextualResolverInput } from "./contextual-intermediate-resolver";

let evaluateCodeCache: string | undefined;
function readEvaluateCode(): string {
  if (evaluateCodeCache) return evaluateCodeCache;
  evaluateCodeCache = readFileSync(join(__dirname, "semantic-evaluate.js"), "utf8");
  return evaluateCodeCache;
}

export type TargetCandidate = {
  elementId?: string;
  text: string;
  normalizedText: string;
  type: string;
  role?: string;
  tagName?: string;
  isClickable: boolean;
  matchScore: number;
  matchReason: string;
  locatorStrategy: string;
  href?: string;
  ariaLabel?: string;
  title?: string;
  alt?: string;
  dataTestid?: string;
  className?: string;
  matchedSignal?: string;
};

export type AmbiguityDiagnostics = {
  target: string;
  semanticRole?: "product" | "card" | "option" | "category" | "item" | "section" | "first_visible_item" | "unknown";
  relationContext?: string;
  candidateCount: number;
  candidateTexts: string[];
  candidateRoles: string[];
  candidateStrategies: string[];
  suggestedExactTargetPattern?: string;
  suggestedAssociatedActionPattern?: string;
};

export type TargetDisambiguationDiagnostics = {
  target: string;
  submitLike: boolean;
  activeContainerUsed: boolean;
  candidatesInsideActiveContainer: number;
  candidatesOutsideActiveContainer: number;
  selectedReason: string;
};

export type TargetResolutionResult = {
  status: "resolved" | "not_found" | "ambiguous" | "locator_resolution_failed";
  target: string;
  locator?: Locator;
  locatorStrategy?: string;
  confidence: number;
  matchReason: string;
  candidateText: string;
  candidateId?: string;
  candidates: TargetCandidate[];
  visibleTexts?: string[];
  clickableCandidates?: Array<{ text: string; normalizedText: string; type: string; role?: string; tagName?: string }>;
  closestCandidates?: TargetCandidate[];
  attemptedLocators?: string[];
  ambiguityDiagnostics?: AmbiguityDiagnostics;
  targetDisambiguation?: TargetDisambiguationDiagnostics;
  alreadySatisfiedEvidence?: {
    candidateText: string;
    candidateType: string;
    containsTarget: boolean;
    consistentWithNextTarget: boolean;
    reason: string;
  };
};

export type ResolveActionTargetOptions = {
  minConfidence?: number;
  ambiguousThreshold?: number;
  semanticRole?: "product" | "card" | "option" | "category" | "item" | "section" | "first_visible_item" | "unknown";
  relationContext?: string;
  activeContainer?: ActiveContainerContext;
  routeProfile?: AppRouteProfile;
  actionText?: string;
  nextTarget?: string;
  previousTarget?: string;
  routeHistory?: string[];
};

export type AiAssistanceTriggerReason =
  | "resolver_not_found"
  | "resolver_ambiguous"
  | "locator_resolution_failed"
  | "confidence_below_threshold"
  | "multiple_semantic_matches"
  | "missing_navigation_step";

export type AiAssistanceDecision = {
  shouldInvoke: boolean;
  reason?: AiAssistanceTriggerReason;
};

const DEFAULT_OPTIONS = {
  minConfidence: 0.4,
  ambiguousThreshold: 0.15,
  semanticRole: "unknown" as const,
  relationContext: "",
  activeContainer: undefined
};

function extractTextValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => extractTextValue(item)).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
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

export function normalizeText(text: unknown): string {
  return extractTextValue(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeRegexPattern(pattern: string): string {
  return pattern
    .replace(/\\s\+\*/g, "\\s+")
    .replace(/\\s\*\+/g, "\\s*")
    .replace(/\\s\+\+/g, "\\s+")
    .replace(/\\s\*\*/g, "\\s*")
    .replace(/(\.\*|\.\+|\.\?)([+*?]+)/g, "$1")
    .replace(/([+*?]){2,}/g, "$1");
}

function createSafeRegExp(pattern: string, flags = "i"): RegExp {
  const sanitized = sanitizeRegexPattern(pattern);
  try {
    return new RegExp(sanitized, flags);
  } catch {
    const literal = escapeRegex(normalizeText(pattern));
    return new RegExp(literal || ".^", flags);
  }
}

function toAccentInsensitivePattern(text: string): string {
  const accentMap: Record<string, string> = {
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

export function buildFlexibleTextRegex(text: unknown): RegExp {
  const trimmed = extractTextValue(text).trim();
  if (!trimmed) {
    return /.^/i;
  }

  return createSafeRegExp(toAccentInsensitivePattern(trimmed), "i");
}

export function buildFlexibleTokenRegex(text: unknown): RegExp {
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

export function computeTokenScore(target: string, candidate: string): number {
  const normalizedTarget = normalizeText(target);
  const normalizedCandidate = normalizeText(candidate);

  if (!normalizedTarget || !normalizedCandidate) return 0;

  if (normalizedCandidate === normalizedTarget) return 1.0;

  if (normalizedCandidate.includes(normalizedTarget)) {
    const ratio = normalizedTarget.length / normalizedCandidate.length;
    return 0.7 + 0.3 * ratio;
  }

  if (normalizedTarget.includes(normalizedCandidate)) {
    const ratio = normalizedCandidate.length / normalizedTarget.length;
    if (normalizedCandidate.length < 6 || ratio < 0.25) return 0;
    return 0.5 + 0.3 * ratio;
  }

  const targetTokens = normalizedTarget.split(/\s+/).filter(Boolean);
  const candidateTokens = normalizedCandidate.split(/\s+/).filter(Boolean);

  if (targetTokens.length === 0) return 0;

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

const SEMANTIC_GROUPS: Record<string, string[]> = {
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

function isSubmitLikeTarget(target: string): boolean {
  const normalized = normalizeText(target);
  return SUBMIT_LIKE_PATTERNS.some(pattern => 
    normalized === pattern || 
    normalized.includes(pattern) ||
    pattern.includes(normalized)
  );
}

export function normalizeSemanticText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeWithStopwords(text: string): string[] {
  const normalized = normalizeSemanticText(text);
  return normalized.split(/\s+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function expandSemanticTokens(tokens: string[]): { tokens: string[]; groups: string[] } {
  const expanded = new Set<string>();
  const matchedGroups = new Set<string>();

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

export function computeSemanticScore(
  target: string,
  signals: {
    text?: string;
    ariaLabel?: string;
    title?: string;
    alt?: string;
    href?: string;
    dataTestid?: string;
    className?: string;
    id?: string;
    name?: string;
    role?: string;
  }
): { score: number; matchedSignal: string; signalValue: string; semanticGroup?: string } {
  const targetTokens = tokenizeWithStopwords(target);
  if (targetTokens.length === 0) {
    return { score: 0, matchedSignal: "none", signalValue: "" };
  }

  const { tokens: expandedTokens, groups: matchedGroups } = expandSemanticTokens(targetTokens);
  const allTargetTokens = new Set(expandedTokens);

  let bestScore = 0;
  let bestSignal = "none";
  let bestValue = "";
  let bestGroup: string | undefined;

  const signalEntries: Array<{ key: string; value: string | undefined; weight: number }> = [
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
    if (!value) continue;
    const normalized = normalizeSemanticText(value);
    // Split the signal into tokens
    const signalTokens = normalized.split(/\s+/).filter((t) => t.length > 1);

    // Check each signal token against expanded target tokens
    let matchedCount = 0;
    for (const st of signalTokens) {
      if (allTargetTokens.has(st)) {
        matchedCount++;
      } else {
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
            if (groupSynonyms.includes(st)) return true;
          }
          return false;
        });
        if (hasGroupToken) {
          score += 0.3 * weight;
          bestGroup = matchedGroups.find((g) =>
            signalTokens.some((st) => SEMANTIC_GROUPS[g].includes(st))
          );
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

export function isElementClickable(el: SnapshotElement): boolean {
  if (CLICKABLE_ROLES.has(el.role ?? "")) return true;
  if (CLICKABLE_TAGS.has(el.tagName?.toLowerCase() ?? "")) return true;
  if (el.type === "button" || el.type === "link") return true;
  if (el.type === "input" && (el.inputType === "submit" || el.inputType === "button")) return true;
  return false;
}

export function buildSnapshotCandidates(snapshot: PageSnapshot, target: string): TargetCandidate[] {
  const normalizedTarget = normalizeText(target);
  const candidates: TargetCandidate[] = [];

  for (const el of snapshot.elements) {
    const texts = [el.text, el.label, el.name, el.placeholder].filter(Boolean) as string[];

    for (const text of texts) {
      const score = computeTokenScore(target, text);
      if (score > 0) {
        const isClickable = isElementClickable(el);
        const clickableBonus = isClickable ? 0.15 : 0;

        let matchReason = "token_match";
        const normalizedText = normalizeText(text);
        if (normalizedText === normalizedTarget) {
          matchReason = "exact_match";
        } else if (normalizedText.includes(normalizedTarget)) {
          matchReason = "contains_match";
        } else if (normalizedTarget.includes(normalizedText)) {
          matchReason = "contained_by_match";
        }

        let locatorStrategy = "text";
        if (el.role && CLICKABLE_ROLES.has(el.role)) {
          locatorStrategy = `role:${el.role}`;
        } else if (el.tagName && CLICKABLE_TAGS.has(el.tagName.toLowerCase())) {
          locatorStrategy = `tag:${el.tagName}`;
        } else if (el.candidateLocators.length > 0) {
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

export function deduplicateCandidates(candidates: TargetCandidate[]): TargetCandidate[] {
  const seen = new Map<string, TargetCandidate>();

  for (const c of candidates) {
    const key = `${c.elementId ?? ""}|${c.normalizedText}`;
    if (!seen.has(key) || seen.get(key)!.matchScore < c.matchScore) {
      seen.set(key, c);
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.matchScore - a.matchScore);
}

function normalizeRouteTerms(routeProfile?: AppRouteProfile): string[] {
  return [
    ...(routeProfile?.domainTerms || []),
    ...(routeProfile?.entryPoints || []),
    ...Object.values(routeProfile?.aliases || {})
  ].map((term) => normalizeText(term)).filter(Boolean);
}

function shouldTryContextualOptionResolution(target: string, opts: ResolveActionTargetOptions): boolean {
  const normalized = normalizeText(target);
  if (!normalized) return false;

  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  const hasOptionKeywords = /\b(opcion|opción|tipo|subtipo|producto|cuenta|moneda|beneficiario|registro|fila|card|lista|listado)\b/i.test(normalized);
  const hasSelectionKeywords = /\b(selecciona|seleccionar|elige|escoge|clic en|click en|pulsa|toca|ver)\b/i.test(normalized);
  const routeTerms = normalizeRouteTerms(opts.routeProfile);
  const routeTermMatch = routeTerms.some((term) => term && (normalized.includes(term) || term.includes(normalized)));

  return tokenCount <= 6 || hasOptionKeywords || hasSelectionKeywords || routeTermMatch;
}

async function attemptContextualOptionResolution(
  page: Page,
  snapshot: PageSnapshot,
  target: string,
  opts: ResolveActionTargetOptions
): Promise<TargetResolutionResult | undefined> {
  if (!shouldTryContextualOptionResolution(target, opts)) {
    return undefined;
  }

  const contextualInput: ContextualResolverInput = {
    target,
    previousTarget: opts.previousTarget || opts.relationContext,
    nextTarget: opts.nextTarget,
    routeHistory: opts.routeHistory,
    routeProfile: opts.routeProfile,
    candidates: snapshot.elements.filter((el) => el.visible).slice(0, 30)
  };

  const contextualResult = resolveAmbiguousIntermediateTarget(contextualInput);
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
      } as TargetResolutionResult & { contextualResolverDiagnostics?: any };
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
    } as TargetResolutionResult;
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
        } as TargetResolutionResult & { contextualResolverDiagnostics?: any };
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
    } as TargetResolutionResult;
  }

  return undefined;
}

export async function resolveActionTarget(
  page: Page,
  snapshot: PageSnapshot,
  target: string,
  options?: ResolveActionTargetOptions
): Promise<TargetResolutionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // === Ordinal Selection Pattern Resolution (BEFORE product_condition) ===
  // Must run first to handle "Seleccionar la primera tarjeta visible del listado" patterns
  const ordinalPattern = detectOrdinalSelectionPattern(target, opts.routeProfile, opts.actionText);
  if (ordinalPattern) {
    console.log(`[target-resolver] Ordinal selection pattern detected: ordinal=${ordinalPattern.ordinal} domainTerm=${ordinalPattern.domainTerm || "none"} target="${target}"`);
    
    const ordinalResult = resolveOrdinalSelection(snapshot, ordinalPattern, opts.routeProfile, opts.actionText);
    
    if (ordinalResult.status === "resolved" && ordinalResult.candidateId) {
      const element = snapshot.elements.find(e => e.id === ordinalResult.candidateId);
      if (element) {
        const resolved = await resolveSnapshotElementLocator(page, {
          element,
          target,
          candidateText: ordinalResult.candidateText!,
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
            candidateText: ordinalResult.candidateText!,
            candidateId: ordinalResult.candidateId,
            candidates: [
              {
                elementId: ordinalResult.candidateId,
                text: ordinalResult.candidateText!,
                normalizedText: normalizeText(ordinalResult.candidateText!),
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
          } as TargetResolutionResult & { ordinalSelectionDiagnostics?: any };
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
      } as TargetResolutionResult & { ordinalSelectionDiagnostics?: any };
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
      } as TargetResolutionResult & { ordinalSelectionDiagnostics?: any };
    }
  }
  
  // === Product Condition Resolution (after ordinal) ===
  const productCondition = parseProductConditionTarget(target);
  if (productCondition) {
    const resolution = resolveProductConditionAgainstSnapshot(snapshot, productCondition, target);
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
            } as TargetResolutionResult & { productConditionDiagnostics?: any };
          }
        }
      }
    }
  }

  const snapshotCandidates = buildSnapshotCandidates(snapshot, target);

  const normalizedTarget = normalizeText(target);
  const backNavigationAlias = (
    /\bvolver\b/.test(normalizedTarget) ||
    /\bregresar\b/.test(normalizedTarget) ||
    /\bvolver\s+al\s+listado\b/.test(normalizedTarget) ||
    /\bregresar\s+al\s+listado\b/.test(normalizedTarget) ||
    /\bvolver\s+atr[áa]s\b/.test(normalizedTarget) ||
    /\bregresar\s+atr[áa]s\b/.test(normalizedTarget)
  );

  if (backNavigationAlias) {
    const backButton = page.getByRole("button", { name: buildFlexibleTextRegex("Volver") }).first();
    if (await backButton.count().catch(() => 0) > 0) {
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
          candidatesOutsideActiveContainer: snapshotCandidates.filter(c => !(c as any).insideActiveContainer).length,
          selectedReason: "submit_like_inside_active_container"
        }
      };
    }
    
    if (buttonCount > 1) {
      console.log(`[target-resolver] Multiple buttons (${buttonCount}) inside active container, continuing with disambiguation`);
    } else {
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
            candidatesOutsideActiveContainer: snapshotCandidates.filter(c => !(c as any).insideActiveContainer).length,
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
    if (!el) continue;

    const isContainer = containerRoles.has(el.role ?? "") || containerTags.has(el.tagName?.toLowerCase() ?? "") || el.type === "card";
    const isNavElement = navRoles.has(el.role ?? "") || (navTags.has(el.tagName?.toLowerCase() ?? "") && el.role !== "button");

    // === product/card/item: prefer actionable containers ===
    if (opts.semanticRole === "product" || opts.semanticRole === "card" || opts.semanticRole === "item") {
      if (isContainer && c.isClickable) {
        c.matchScore = Math.min(1.0, c.matchScore + 0.25);
        c.matchReason += " +container_rank";
      } else if (isContainer) {
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
          const isContainerModal = 
            containerClass.toLowerCase().includes('modal') ||
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
        (c as any).insideActiveContainer = true;
      }
    }
    
    // === submit-like target: prefer button over link ===
    if (isSubmitLikeTarget(target)) {
      const isButton = el.tagName?.toLowerCase() === 'button' || el.role === 'button';
      const isLink = el.tagName?.toLowerCase() === 'a' || el.type === 'link';
      
      if (isButton && !isLink) {
        c.matchScore = Math.min(1.0, c.matchScore + 0.20);
        c.matchReason += " +button_over_link_for_submit";
      } else if (isLink && !isButton) {
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
        } as TargetResolutionResult & { semanticTokens?: string[]; expandedTokens?: string[]; matchedSignals?: string[] };
      }
      if (semanticResult.status === "ambiguous_semantic_target") {
        const ambiguityDiagnostics: AmbiguityDiagnostics = {
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
        } as TargetResolutionResult & { semanticTokens?: string[]; expandedTokens?: string[]; matchedSignals?: string[] };
      }
    } catch {
      // Semantic resolution failed, fall through to original not_found
    }

    const visibleTexts = snapshot.elements
      .filter((el) => el.visible && el.text)
      .map((el) => el.text!)
      .slice(0, 30);

    const clickableElements = snapshot.elements
      .filter((el) => isElementClickable(el) && el.text)
      .map((el) => ({
        text: el.text!,
        normalizedText: normalizeText(el.text!),
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
    } as TargetResolutionResult & { _diagnosis?: unknown[] };
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
      const contextualInput: ContextualResolverInput = {
        target,
        previousTarget: opts.previousTarget || opts.relationContext,
        nextTarget: opts.nextTarget,
        routeHistory: opts.routeHistory,
        routeProfile: opts.routeProfile,
        candidates: sorted.slice(0, 10).map(c => {
          // Reconstruct snapshot elements from candidates
          const element = snapshot.elements.find(e => 
            (e.text && normalizeText(e.text) === c.normalizedText) ||
            (e.label && normalizeText(e.label) === c.normalizedText) ||
            (e.name && normalizeText(e.name) === c.normalizedText)
          );
          if (element) return element;
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
          } as SnapshotElement;
        })
      };
      
      const contextualResult = resolveAmbiguousIntermediateTarget(contextualInput);
      
      if (contextualResult.status === "resolved" && contextualResult.selectedCandidate) {
        console.log(`[target-resolver] contextual_intermediate_resolver resolved target="${target}" selected="${contextualResult.selectedCandidateText}" type="${contextualResult.classifiedCandidates.find(c => c.element === contextualResult.selectedCandidate)?.type}"`);
        
        const resolved = await resolveSnapshotElementLocator(page, {
          element: contextualResult.selectedCandidate,
          target,
          candidateText: contextualResult.selectedCandidateText!,
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
            candidateText: contextualResult.selectedCandidateText!,
            candidateId: contextualResult.selectedCandidate.id,
            candidates: sorted.slice(0, 5),
            contextualResolverDiagnostics: contextualResult.diagnostics
          } as TargetResolutionResult & { contextualResolverDiagnostics?: any };
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
        } as TargetResolutionResult & { contextualResolverDiagnostics?: any };
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
        } as TargetResolutionResult & { contextualResolverDiagnostics?: any; alreadySatisfiedEvidence?: any };
      }
      
      // Try semantic DOM-based resolution before declaring ambiguous
      const semanticResult = await trySemanticFallback(page, target, opts);
      if (semanticResult) return semanticResult;

      const ambiguityDiagnostics: AmbiguityDiagnostics = {
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
    const contextualInput: ContextualResolverInput = {
      target,
      previousTarget: opts.previousTarget || opts.relationContext,
      nextTarget: opts.nextTarget,
      routeHistory: opts.routeHistory,
      routeProfile: opts.routeProfile,
      candidates: snapshot.elements.filter(e => e.visible).slice(0, 20)
    };
    
    const contextualResult = resolveAmbiguousIntermediateTarget(contextualInput);
    
    if (contextualResult.status === "resolved" && contextualResult.selectedCandidate) {
      console.log(`[target-resolver] contextual_intermediate_resolver resolved low-confidence target="${target}" selected="${contextualResult.selectedCandidateText}"`);
      
      const resolved = await resolveSnapshotElementLocator(page, {
        element: contextualResult.selectedCandidate,
        target,
        candidateText: contextualResult.selectedCandidateText!,
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
          candidateText: contextualResult.selectedCandidateText!,
          candidateId: contextualResult.selectedCandidate.id,
          contextualResolverDiagnostics: contextualResult.diagnostics
        } as TargetResolutionResult & { contextualResolverDiagnostics?: any };
      }
    }
    
    // Try semantic DOM-based resolution before giving up
    const semanticResult = await trySemanticFallback(page, target, opts);
    if (semanticResult) return semanticResult;

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
    : { attemptedLocators: [] as string[] };

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
    } as TargetResolutionResult & { _diagnosis?: unknown[] };
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

async function trySemanticFallback(
  page: Page,
  target: string,
  opts: { minConfidence: number; ambiguousThreshold: number; semanticRole: ResolveActionTargetOptions['semanticRole']; relationContext: string; activeContainer?: ResolveActionTargetOptions['activeContainer'] }
): Promise<TargetResolutionResult | undefined> {
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
      } as TargetResolutionResult & { semanticTokens?: string[]; expandedTokens?: string[]; matchedSignals?: string[] };
    }
  } catch {
    // Semantic resolution failed silently
  }
  return undefined;
}

export function shouldInvokeAiAssistedDiscovery(input: {
  resolution: TargetResolutionResult;
  confidenceThreshold: number;
  missingNavigationStep?: boolean;
  enabled?: boolean;
}): AiAssistanceDecision {
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

  if ((resolution as any).status === "needs_discovery") {
    return { shouldInvoke: true, reason: "needs_discovery" as any };
  }

  if ((resolution as any).status === "needs_associated_target_resolution") {
    return { shouldInvoke: true, reason: "needs_associated_target_resolution" as any };
  }

  if ((resolution as any).status === "needs_assertion_resolution") {
    return { shouldInvoke: true, reason: "needs_assertion_resolution" as any };
  }

  if (resolution.confidence < confidenceThreshold) {
    return { shouldInvoke: true, reason: "confidence_below_threshold" };
  }

  return { shouldInvoke: false };
}

async function countLocator(locator: Locator): Promise<number> {
  try {
    return await locator.count();
  } catch {
    return 0;
  }
}

export async function resolveSnapshotElementLocator(
  page: Page,
  candidate: {
    element: SnapshotElement;
    target: string;
    candidateText: string;
    type: string;
    tagName?: string;
    confidence: number;
    matchReason: string;
  }
): Promise<{ locator?: Locator; locatorStrategy?: string; attemptedLocators: string[] }> {
  const { element, target, candidateText, type, tagName } = candidate;
  const attemptedLocators: string[] = [];
  const sortedLocators = [...element.candidateLocators].sort((a, b) => b.confidence - a.confidence);
  const candidateTextRegex = buildFlexibleTextRegex(candidateText);
  const targetRegex = buildFlexibleTokenRegex(target);

  const tryLocator = async (
    label: string,
    factory: () => Locator | undefined,
    strategy: string
  ): Promise<{ locator?: Locator; locatorStrategy?: string }> => {
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
    const byCandidateText = await tryLocator(
      `getByRole(${role}, candidateText:${candidateText})`,
      () => page.getByRole(role as any, { name: candidateTextRegex }),
      `role:${role}`
    );
    if (byCandidateText.locator) {
      return { ...byCandidateText, attemptedLocators };
    }

    const byTarget = await tryLocator(
      `getByRole(${role}, targetTokens:${target})`,
      () => page.getByRole(role as any, { name: targetRegex }),
      `role:${role}`
    );
    if (byTarget.locator) {
      return { ...byTarget, attemptedLocators };
    }
  }

  const byCandidateText = await tryLocator(
    `getByText(candidateText:${candidateText})`,
    () => page.getByText(candidateTextRegex, { exact: false }),
    "text"
  );
  if (byCandidateText.locator) {
    return { ...byCandidateText, attemptedLocators };
  }

  const byTargetText = await tryLocator(
    `getByText(target:${target})`,
    () => page.getByText(targetRegex, { exact: false }),
    "text"
  );
  if (byTargetText.locator) {
    return { ...byTargetText, attemptedLocators };
  }

  for (const candidateLocator of sortedLocators) {
    let locator: Locator | undefined;
    attemptedLocators.push(`snapshot:${candidateLocator.strategy}:${candidateLocator.value ?? candidateLocator.role ?? candidateLocator.name ?? ""}`);

    if (candidateLocator.strategy === "role" && candidateLocator.role) {
      locator = page.getByRole(candidateLocator.role as any, {
        name: candidateLocator.name ?? candidateLocator.value,
        exact: candidateLocator.exact
      });
    } else if (candidateLocator.strategy === "text" && candidateLocator.value) {
      locator = page.getByText(candidateLocator.value, { exact: candidateLocator.exact ?? false });
    } else if (candidateLocator.strategy === "label" && candidateLocator.value) {
      locator = page.getByLabel(candidateLocator.value, { exact: candidateLocator.exact ?? false });
    } else if (candidateLocator.strategy === "placeholder" && candidateLocator.value) {
      locator = page.getByPlaceholder(candidateLocator.value, { exact: candidateLocator.exact ?? false });
    } else if (candidateLocator.strategy === "testId" && candidateLocator.value) {
      locator = page.getByTestId(candidateLocator.value);
    } else if (candidateLocator.strategy === "css" && candidateLocator.value) {
      locator = page.locator(candidateLocator.value);
    } else if (candidateLocator.strategy === "xpath" && candidateLocator.value) {
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

  const fallbackTexts = [element.text, element.label, element.name, element.placeholder].filter(Boolean) as string[];
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

export async function findTargetByText(page: Page, target: string): Promise<boolean> {
  const regex = buildFlexibleTextRegex(target);
  const count = await page.getByText(regex).count();
  return count > 0;
}

export async function clickResolvedTarget(locator: Locator, force: boolean = false): Promise<void> {
  if (force) {
    await locator.click({ force: true });
  } else {
    await locator.click();
  }
}

const EDITABLE_TAGS = new Set(["input", "textarea", "select"]);
const EDITABLE_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);

function isElementEditable(el: SnapshotElement): boolean {
  if (el.tagName && EDITABLE_TAGS.has(el.tagName.toLowerCase())) return true;
  if (el.role && EDITABLE_ROLES.has(el.role)) return true;
  return false;
}

export type FillTargetResolutionResult = {
  status: "resolved" | "not_found" | "not_editable" | "ambiguous" | "not_visible" | "fill_target_not_editable";
  target: string;
  locator?: Locator;
  locatorStrategy?: string;
  confidence: number;
  matchReason: string;
  matchedTag?: string;
  matchedText?: string;
  attemptedLocators: string[];
  editableCandidatesCount: number;
  nonEditableMatch?: { text: string; tag: string; reason: string };
  fillDiagnostics?: {
    field: string;
    activeContainerUsed: boolean;
    activeContainerType?: string;
    candidatesEvaluated: number;
    candidatesEvaluatedDetails?: Array<{
      strategy: string;
      tagName: string;
      role?: string;
      visible: boolean;
      enabled: boolean;
      editable: boolean;
      insideActiveContainer: boolean;
      text?: string;
      domId?: string;
      name?: string;
      placeholder?: string;
      ariaLabel?: string;
      score?: number;
    }>;
    rejectedCandidates: Array<{ strategy: string; reason: string; tagName?: string; text?: string }>;
    selectedCandidate?: {
      strategy: string;
      tagName: string;
      role?: string;
      visible: boolean;
      enabled: boolean;
      editable: boolean;
      insideActiveContainer: boolean;
    };
  };
  localResolversTried?: string[];
  autoRepairSkippedReason?: string;
};

export type ActiveContainerContext = {
  type: "modal" | "dialog" | "form" | "panel" | "drawer";
  reason: "modal_opened" | "dialog_opened" | "form_opened" | "panel_opened" | "overlay_opened";
  containerLocator?: Locator;
  containerElement?: SnapshotElement;
  detectedAt?: string;
};

const FILL_LOCATOR_STRATEGIES = [
  { label: "getByLabel", factory: (page: Page, target: string, _regex: RegExp) => page.getByLabel(target, { exact: false }) },
  { label: "getByPlaceholder", factory: (page: Page, target: string, _regex: RegExp) => page.getByPlaceholder(target, { exact: false }) },
  { label: "getByRole(textbox)", factory: (page: Page, target: string, regex: RegExp) => page.getByRole("textbox", { name: regex }) },
  { label: "getByRole(combobox)", factory: (page: Page, target: string, regex: RegExp) => page.getByRole("combobox", { name: regex }) },
  { label: "getByRole(searchbox)", factory: (page: Page, target: string, regex: RegExp) => page.getByRole("searchbox", { name: regex }) },
  { label: "getByRole(spinbutton)", factory: (page: Page, target: string, regex: RegExp) => page.getByRole("spinbutton", { name: regex }) },
  { label: "input[name]", factory: (page: Page, target: string, _regex: RegExp) => page.locator(`input[name="${target}"]`) },
  { label: "input[id]", factory: (page: Page, target: string, _regex: RegExp) => page.locator(`input[id="${target}"]`) },
  { label: "input[aria-label]", factory: (page: Page, target: string, _regex: RegExp) => page.locator(`input[aria-label="${target}"]`) },
  { label: "input[placeholder]", factory: (page: Page, target: string, _regex: RegExp) => page.locator(`input[placeholder="${target}"]`) },
  { label: "textarea", factory: (page: Page, target: string, _regex: RegExp) => page.locator(`textarea[name="${target}"], textarea[id="${target}"], textarea[aria-label="${target}"], textarea[placeholder="${target}"]`) },
  { label: "select", factory: (page: Page, target: string, _regex: RegExp) => page.locator(`select[name="${target}"], select[id="${target}"], select[aria-label="${target}"]`) },
  { label: "contenteditable", factory: (page: Page, target: string, _regex: RegExp) => page.locator(`[contenteditable="true"][aria-label="${target}"], [contenteditable="true"][name="${target}"], [contenteditable="true"][id="${target}"]`) },
  { label: "input[fuzzy]", factory: (page: Page, target: string, regex: RegExp) => page.locator(`input[name^="${target.substring(0, 3)}"], input[placeholder^="${target.substring(0, 3)}"], input[aria-label^="${target.substring(0, 3)}"]`) },
];

function createScopedFillStrategies(containerLocator: Locator, target: string): Array<{ label: string; factory: () => Locator }> {
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

function escapeCssId(id: string): string {
  return id.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, "\\$1");
}

async function tryConstructLocatorFromSnapshotElement(
  page: Page,
  element: SnapshotElement,
  target: string,
  activeContainer?: ActiveContainerContext
): Promise<{ locator?: Locator; strategy?: string; reason?: string }> {
  const attemptedStrategies: string[] = [];
  
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
      const locator = container.getByRole(element.role as any, { name: regex });
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
      } else if (normalizedTarget.includes("email") || normalizedTarget.includes("correo")) {
        typeSelector = 'input[type="email"]';
      } else if (normalizedTarget.includes("username") || normalizedTarget.includes("usuario") || normalizedTarget.includes("user")) {
        typeSelector = 'input[type="text"]:not([type="password"]), input:not([type])';
      } else if (inputType && inputType !== "hidden" && inputType !== "submit" && inputType !== "button") {
        typeSelector = `input[type="${inputType}"]`;
      } else if (tagName === "textarea") {
        typeSelector = "textarea";
      } else if (tagName === "select") {
        typeSelector = "select";
      } else {
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

async function tryLoginFillFallback(
  page: Page,
  target: string,
  activeContainer: ActiveContainerContext,
  snapshot?: PageSnapshot
): Promise<{ locator?: Locator; strategy?: string; reason?: string }> {
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
      if (el.tagName && EDITABLE_TAGS.has(el.tagName.toLowerCase())) return true;
      if (el.role && EDITABLE_ROLES.has(el.role.toLowerCase())) return true;
      return false;
    });
    
    console.log(`[fill-resolver] Login fallback: found ${editableElements.length} editable elements in snapshot`);
    
    const inputs: Array<{ element: SnapshotElement; type: string; index: number }> = [];
    
    for (let i = 0; i < editableElements.length; i++) {
      const el = editableElements[i];
      if (!el.visible) continue;
      
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
  
  const inputs: Array<{ index: number; type: string; locator: Locator; visible: boolean; enabled: boolean }> = [];
  
  for (let i = 0; i < count; i++) {
    const input = allInputs.nth(i);
    try {
      const visible = await input.isVisible().catch(() => false);
      console.log(`[fill-resolver] Login fallback candidate index=${i} visible=${visible}`);
      if (!visible) continue;
      
      const enabled = await input.isEnabled().catch(() => false);
      if (!enabled) continue;
      
      const type = await input.evaluate((el) => el.getAttribute("type") || "text").catch(() => "text");
      
      inputs.push({ index: i, type: type.toLowerCase(), locator: input, visible: true, enabled: true });
      console.log(`[fill-resolver] Login fallback candidate index=${i} type="${type}" visible=true enabled=true`);
    } catch (e) {
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

async function tryFillLocator(
  page: Page,
  strategy: { label: string; factory: (page: Page, target: string, regex: RegExp) => Locator },
  target: string,
  regex: RegExp,
  attempted: string[],
  activeContainer?: ActiveContainerContext
): Promise<{ 
  locator?: Locator; 
  locatorStrategy?: string; 
  visible?: boolean; 
  enabled?: boolean;
  tagName?: string;
  role?: string;
  insideActiveContainer?: boolean;
}> {
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
        let insideActiveContainer = false;
        
        try {
          isVisible = await element.isVisible().catch(() => true);
          isEnabled = await element.isEnabled().catch(() => true);
          tagName = await element.evaluate((el) => el.tagName.toLowerCase()).catch(() => "unknown");
          role = await element.evaluate((el) => el.getAttribute("role") || "").catch(() => "");
          
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
        } catch {
          isVisible = true;
          isEnabled = true;
        }
        
        if (isVisible && isEnabled) {
          return { 
            locator: element, 
            locatorStrategy: strategy.label, 
            visible: true, 
            enabled: true,
            tagName,
            role: role || undefined,
            insideActiveContainer
          };
        }
      }
      const firstElement = locator.first();
      let tagName = "unknown";
      try {
        tagName = await firstElement.evaluate((el) => el.tagName.toLowerCase()).catch(() => "unknown");
      } catch {
        // ignore
      }
      return { 
        locator: firstElement, 
        locatorStrategy: strategy.label, 
        visible: false, 
        enabled: false,
        tagName 
      };
    }
  } catch {
    // ignore
  }
  return {};
}

export async function resolveFillTarget(
  page: Page,
  snapshot: PageSnapshot,
  target: string,
  activeContainer?: ActiveContainerContext
): Promise<FillTargetResolutionResult> {
  const attemptedLocators: string[] = [];
  const rejectedCandidates: Array<{ strategy: string; reason: string; tagName?: string; text?: string }> = [];
  const evaluatedCandidates: Array<{
    strategy: string;
    tagName: string;
    role?: string;
    visible: boolean;
    enabled: boolean;
    editable: boolean;
    insideActiveContainer: boolean;
    text?: string;
    domId?: string;
    name?: string;
    placeholder?: string;
    ariaLabel?: string;
    score?: number;
  }> = [];
  const localResolversTried: string[] = ["fill_resolver"];
  const regex = buildFlexibleTokenRegex(target);

  console.log(`[fill-resolver] Resolving field="${target}"${activeContainer ? ` within active container="${activeContainer.type}"` : ""}`);

  const EDITABLE_TAGS = new Set(["input", "textarea", "select"]);
  const EDITABLE_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);

  function isEditableElement(tagName: string, role?: string): boolean {
    if (EDITABLE_TAGS.has(tagName.toLowerCase())) return true;
    if (role && EDITABLE_ROLES.has(role.toLowerCase())) return true;
    return false;
  }

  // Phase 0: Try scoped strategies within active container first (if exists)
  if (activeContainer?.containerLocator) {
    console.log(`[fill-resolver] Trying scoped search within active container="${activeContainer.type}"`);
    const scopedStrategies = createScopedFillStrategies(activeContainer.containerLocator, target);
    
    for (const strategy of scopedStrategies) {
      const result = await tryFillLocator(
        page,
        { label: strategy.label, factory: () => strategy.factory() },
        target,
        regex,
        attemptedLocators,
        activeContainer
      );
      
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
          editable: isEditableElement(tag, role),
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

        if (!isEditableElement(tag, role)) {
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
        editable: isEditableElement(tag, role),
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

      if (!isEditableElement(tag, role)) {
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
  let bestMatch: { element: SnapshotElement; score: number; field: string; insideActiveContainer: boolean } | null = null;

  for (const el of editableElements) {
    const texts = [el.label, el.name, el.placeholder, el.text, el.id].filter(Boolean) as string[];
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
            role: el.getAttribute("role") || ""
          })).catch(() => null);
          if (elInfo) {
            tagName = elInfo.tagName;
            role = elInfo.role || undefined;
          }
        }
      } catch {
        isVisible = true;
        isEnabled = true;
      }
      
      evaluatedCandidates.push({
        strategy: locatorResult.strategy || "snapshot",
        tagName,
        role,
        visible: isVisible,
        enabled: isEnabled,
        editable: isEditableElement(tagName, role),
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
      } else if (!isEditableElement(tagName, role)) {
        rejectedCandidates.push({ 
          strategy: locatorResult.strategy || "snapshot", 
          reason: "not_editable",
          tagName,
          text: bestMatch.field
        });
        console.log(`[fill-resolver] Candidate rejected: tag="${tagName}" reason="not_editable"`);
      } else {
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
    } else if (locatorResult.reason === "missing_stable_locator_attributes") {
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
        } else {
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
              role: el.getAttribute("role") || ""
            })).catch(() => null);
            if (elInfo) {
              tagName = elInfo.tagName;
              role = elInfo.role || undefined;
            }
          }
        } catch {
          isVisible = true;
          isEnabled = true;
        }
        
        evaluatedCandidates.push({
          strategy: "snapshot",
          tagName,
          role,
          visible: isVisible,
          enabled: isEnabled,
          editable: isEditableElement(tagName, role),
          insideActiveContainer: bestMatch.insideActiveContainer,
          text: bestMatch.field
        });
        
        if (!isVisible || !isEnabled) {
          rejectedCandidates.push({ 
            strategy: "snapshot", 
            reason: !isVisible ? "not_visible" : "not_enabled",
            tagName
          });
        } else if (!isEditableElement(tagName, role)) {
          rejectedCandidates.push({ 
            strategy: "snapshot", 
            reason: "not_editable",
            tagName,
            text: bestMatch.field
          });
          console.log(`[fill-resolver] Candidate rejected: tag="${tagName}" reason="not_editable"`);
        } else {
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
  let nonEditableMatch: { text: string; tag: string; score: number } | null = null;

  for (const el of nonEditableElements) {
    if (!el.text) continue;
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
    const isLoginField = 
      normalizedTarget.includes("username") || 
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
      } else {
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

export function validateFillResolutionContract(result: FillTargetResolutionResult): { valid: boolean; error?: string } {
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

// ─── Associated Target Resolution ─────────────────────────────────

export type AssociatedContainerInfo = {
  index: number;
  tagName: string;
  textContent: string;
  entityMatchScore: number;
  entityMatchText: string;
  childActionCount: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
};

export type AssociatedCandidate = {
  containerIndex: number;
  containerTag: string;
  containerText: string;
  actionText: string;
  actionTag: string;
  actionRole?: string;
  entityScore: number;
  actionScore: number;
  combinedScore: number;
  actionSelector?: string;
};

export type AssociatedDiagnostics = {
  associatedEntity: string;
  actionTarget: string;
  entityExists: boolean;
  entityElementCount: number;
  candidateContainers: AssociatedContainerInfo[];
  candidateActions: AssociatedCandidate[];
  selectedCandidate?: AssociatedCandidate;
  reason?: string;
};

export type AssociatedTargetResolutionResult = {
  status: "resolved" | "needs_associated_target_resolution" | "associated_entity_not_found" | "associated_action_not_found";
  target: string;
  associatedEntity: string;
  locator?: Locator;
  locatorStrategy?: string;
  confidence: number;
  matchReason: string;
  containerText?: string;
  containerTag?: string;
  diagnostics: AssociatedDiagnostics;
};

const CONTAINER_SELECTORS = [
  "article", "section", "li", "tr", "fieldset", "form",
  "[role='group']", "[role='region']", "[role='listitem']",
  "[role='row']", "[role='article']", "[role='card']",
  "div[class*='card']", "div[class*='item']", "div[class*='product']",
  "div[class*='row']", "div[class*='panel']"
];

const CLICKABLE_ACTION_TAGS = ["button", "a", "input[type='submit']", "input[type='button']", "[role='button']", "[role='link']"];

async function evaluateContainers(page: Page, entityText: string, actionTarget: string): Promise<{
  containers: AssociatedContainerInfo[];
  actions: AssociatedCandidate[];
  entityElementCount: number;
}> {
  const entity = entityText.toLowerCase().trim();
  const action = actionTarget.toLowerCase().trim();

  const result = await page.evaluate(
    ({ entity, action, containerSelectors, clickableSelectors }) => {
      const containers: Array<{
        index: number; tagName: string; textContent: string; entityMatchScore: number;
        entityMatchText: string; childActionCount: number;
        boundingBox?: { x: number; y: number; width: number; height: number };
      }> = [];
      const actions: Array<{
        containerIndex: number; containerTag: string; containerText: string;
        actionText: string; actionTag: string; actionRole?: string;
        entityScore: number; actionScore: number; combinedScore: number;
        actionSelector?: string;
      }> = [];

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
      const seenContainers = new Set<Element>();
      for (const sel of containerSelectors) {
        const candidates = document.querySelectorAll(sel);
        for (const container of candidates) {
          if (seenContainers.has(container)) continue;
          if (!container.isConnected) continue;
          const fullText = (container.textContent || "").toLowerCase().trim();
          if (!fullText.includes(entity)) continue;
          seenContainers.add(container);

          // Find the entity match text more precisely
          let entityMatchText = "";
          let entityScore = 0;
          const childElements = container.querySelectorAll("*");
          for (const child of childElements) {
            const ct = (child.textContent || "").trim();
            if (ct && ct.toLowerCase().includes(entity)) {
              if (ct.toLowerCase() === entity) { entityScore = 1.0; entityMatchText = ct; break; }
              if (ct.toLowerCase().includes(entity) && entityScore < 0.8) {
                entityScore = 0.8; entityMatchText = ct;
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
        if (!containerInfo) continue;

        // Find clickable action elements matching the action target within container
        const clickableElements = container.querySelectorAll(clickableSelectors.join(","));
        let actionCount = 0;

        for (const el of clickableElements) {
          const elText = (el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
          if (!elText) continue;
          const elLower = elText.toLowerCase();

          // Check if the element text matches the action target
          let actionScore = 0;
          if (elLower === action) actionScore = 1.0;
          else if (elLower.includes(action)) actionScore = 0.7;
          else if (action.includes(elLower) && elLower.length > 3) actionScore = 0.5;

          if (actionScore > 0) {
            actionCount++;
            const isVisible = (el as HTMLElement).offsetParent !== null;
            if (!isVisible) actionScore *= 0.3;

            const role = el.getAttribute("role") || undefined;
            const tag = el.tagName.toLowerCase();

            // Build CSS selector for this element
            let selector = "";
            if (el.id) {
              selector = `#${CSS.escape(el.id)}`;
            } else if (el.getAttribute("data-testid")) {
              selector = `[data-testid="${CSS.escape(el.getAttribute("data-testid")!)}"]`;
            } else if (el.getAttribute("data-test")) {
              selector = `[data-test="${CSS.escape(el.getAttribute("data-test")!)}"]`;
            } else if (el.getAttribute("name")) {
              selector = `${tag}[name="${CSS.escape(el.getAttribute("name")!)}"]`;
            } else if (el.getAttribute("aria-label")) {
              selector = `${tag}[aria-label="${CSS.escape(el.getAttribute("aria-label")!)}"]`;
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
    },
    { entity, action, containerSelectors: CONTAINER_SELECTORS, clickableSelectors: CLICKABLE_ACTION_TAGS }
  );

  return result;
}

export async function resolveAssociatedActionTarget(
  page: Page,
  snapshot: PageSnapshot,
  actionTarget: string,
  associatedEntity: string
): Promise<AssociatedTargetResolutionResult> {
  const { containers, actions, entityElementCount } = await evaluateContainers(page, associatedEntity, actionTarget);

  const diagnostics: AssociatedDiagnostics = {
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
    } else {
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
  let locator: Locator | undefined;
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
    const roleLocator = containerLocator.getByRole(actionRole as any, { name: actionRegex });
    if (await roleLocator.count() > 0) {
      locator = roleLocator.first();
      locatorStrategy = `associated-${strategySuffix}:role`;
    } else {
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

// ─── Semantic Target Resolution ───────────────────────────────────

export type SemanticSignal = {
  key: string;
  value: string;
};

export type SemanticCandidate = {
  elementIndex: number;
  tagName: string;
  type: string;
  role?: string;
  text?: string;
  signals: SemanticSignal[];
  score: number;
  matchedSignal: string;
  signalValue: string;
  semanticGroup?: string;
  selector?: string;
};

export type SemanticResolutionResult = {
  status: "resolved" | "semantic_target_not_found" | "ambiguous_semantic_target";
  target: string;
  locator?: Locator;
  locatorStrategy?: string;
  confidence: number;
  matchReason: string;
  candidateText: string;
  candidates: SemanticCandidate[];
  targetTokens: string[];
  expandedTokens: string[];
  matchedGroups: string[];
  candidateSignals?: SemanticSignal[];
  matchedSignals?: string[];
};

const SEMANTIC_SELECTORS = [
  "button", "a", "input[type='submit']", "input[type='button']",
  "[role='button']", "[role='link']", "[role='menuitem']", "[role='tab']",
  "[role='treeitem']", "[role='option']", "[contenteditable='true']"
];

function isSemanticSignal(value: unknown): value is SemanticSignal {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.key === "string" && typeof obj.value === "string";
}

function isSemanticCandidate(value: unknown): value is SemanticCandidate {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.elementIndex !== "number") return false;
  if (typeof obj.tagName !== "string") return false;
  if (typeof obj.type !== "string") return false;
  if (typeof obj.score !== "number") return false;
  if (!Array.isArray(obj.signals)) return false;
  if (!obj.signals.every(isSemanticSignal)) return false;
  if (obj.matchedSignal !== undefined && typeof obj.matchedSignal !== "string") return false;
  if (obj.signalValue !== undefined && typeof obj.signalValue !== "string") return false;
  return true;
}

export function normalizeSemanticCandidates(value: unknown): SemanticCandidate[] {
  if (!Array.isArray(value)) return [];
  const valid: SemanticCandidate[] = [];
  for (const item of value) {
    if (!isSemanticCandidate(item)) continue;
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

export async function resolveSemanticActionTarget(
  page: Page,
  target: string
): Promise<SemanticResolutionResult> {
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
  const result: SemanticCandidate[] = normalizeSemanticCandidates(rawResult);

  const allSignals = result.flatMap((c: SemanticCandidate) => c.signals);
  const matchedSignals = result
    .filter((c: SemanticCandidate) => c.score > 0)
    .map((c: SemanticCandidate) => c.matchedSignal);

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
  const best: SemanticCandidate = result[0];
  let locator: Locator | undefined;
  let locatorStrategy = "semantic";

  if (best.selector) {
    locator = page.locator(best.selector);
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      locator = locator.first();
      locatorStrategy = `semantic:css`;
    } else {
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
