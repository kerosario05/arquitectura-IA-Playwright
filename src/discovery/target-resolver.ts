import { readFileSync } from "fs";
import { join } from "path";
import type { Page, Locator } from "@playwright/test";
import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";
import { parseProductConditionTarget, resolveProductConditionAgainstSnapshot, type ProductCondition } from "./product-condition-parser";

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
  semanticRole?: "product" | "card" | "option" | "category" | "item" | "section" | "unknown";
  relationContext?: string;
  candidateCount: number;
  candidateTexts: string[];
  candidateRoles: string[];
  candidateStrategies: string[];
  suggestedExactTargetPattern?: string;
  suggestedAssociatedActionPattern?: string;
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
};

export type ResolveActionTargetOptions = {
  minConfidence?: number;
  ambiguousThreshold?: number;
  semanticRole?: "product" | "card" | "option" | "category" | "item" | "section" | "unknown";
  relationContext?: string;
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

const DEFAULT_OPTIONS: Required<ResolveActionTargetOptions> = {
  minConfidence: 0.4,
  ambiguousThreshold: 0.15,
  semanticRole: "unknown",
  relationContext: ""
};

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function buildFlexibleTextRegex(text: string): RegExp {
  const trimmed = text.trim();
  if (!trimmed) {
    return /.^/i;
  }

  return new RegExp(toAccentInsensitivePattern(trimmed), "i");
}

export function buildFlexibleTokenRegex(text: string): RegExp {
  const normalized = normalizeText(text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return /.^/i;
  }

  const pattern = tokens
    .map((token) => toAccentInsensitivePattern(token))
    .join(".*");

  return new RegExp(pattern, "i");
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

export async function resolveActionTarget(
  page: Page,
  snapshot: PageSnapshot,
  target: string,
  options?: ResolveActionTargetOptions
): Promise<TargetResolutionResult> {
  const opts: Required<ResolveActionTargetOptions> = { ...DEFAULT_OPTIONS, ...options };

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
  }

  const dedupedCandidates = deduplicateCandidates(snapshotCandidates);

  const highConfidence = dedupedCandidates.filter((c) => c.matchScore >= opts.minConfidence);

  const clickableCandidates = highConfidence.filter((c) => c.isClickable);
  const nonClickableCandidates = highConfidence.filter((c) => !c.isClickable);

  const allViable = [...clickableCandidates, ...nonClickableCandidates].slice(0, 10);

  if (clickableCandidates.length === 0 && nonClickableCandidates.length === 0) {
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

  const normalizedTarget = normalizeText(target);
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
      target: normalizedTarget,
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
  opts: Required<ResolveActionTargetOptions>
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
  status: "resolved" | "not_found" | "not_editable" | "ambiguous";
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

async function tryFillLocator(
  page: Page,
  strategy: { label: string; factory: (page: Page, target: string, regex: RegExp) => Locator },
  target: string,
  regex: RegExp,
  attempted: string[]
): Promise<{ locator?: Locator; locatorStrategy?: string }> {
  attempted.push(strategy.label);
  const locator = strategy.factory(page, target, regex);
  try {
    const count = await locator.count();
    if (count > 0) {
      return { locator: locator.first(), locatorStrategy: strategy.label };
    }
  } catch {
    // ignore
  }
  return {};
}

export async function resolveFillTarget(
  page: Page,
  snapshot: PageSnapshot,
  target: string
): Promise<FillTargetResolutionResult> {
  const attemptedLocators: string[] = [];
  const regex = buildFlexibleTokenRegex(target);

  // Phase 1: Playwright native locator strategies
  for (const strategy of FILL_LOCATOR_STRATEGIES) {
    const result = await tryFillLocator(page, strategy, target, regex, attemptedLocators);
    if (result.locator) {
      const tag = await result.locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "unknown");
      return {
        status: "resolved",
        target,
        locator: result.locator,
        locatorStrategy: result.locatorStrategy,
        confidence: 1.0,
        matchReason: `fill_locator_${strategy.label}`,
        matchedTag: tag,
        attemptedLocators,
        editableCandidatesCount: 1
      };
    }
  }

  // Phase 2: Snapshot-based editable element resolution
  const editableElements = snapshot.elements.filter((el) => isElementEditable(el));
  let bestMatch: { element: SnapshotElement; score: number; field: string } | null = null;

  for (const el of editableElements) {
    const texts = [el.label, el.name, el.placeholder, el.text, el.id].filter(Boolean) as string[];
    for (const text of texts) {
      const score = computeTokenScore(target, text);
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { element: el, score, field: text };
      }
    }
  }

  if (bestMatch && bestMatch.score >= 0.4) {
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
      const tag = bestMatch.element.tagName ?? "unknown";
      return {
        status: "resolved",
        target,
        locator: resolved.locator,
        locatorStrategy: resolved.locatorStrategy ?? "snapshot",
        confidence: bestMatch.score,
        matchReason: "snapshot_editable_match",
        matchedTag: tag,
        matchedText: bestMatch.field,
        attemptedLocators,
        editableCandidatesCount: editableElements.length
      };
    }
  }

  // Phase 3: Check for non-editable text matches (to distinguish not_found from not_editable)
  const nonEditableElements = snapshot.elements.filter((el) => !isElementEditable(el));
  let nonEditableMatch: { text: string; tag: string; score: number } | null = null;

  for (const el of nonEditableElements) {
    if (!el.text) continue;
    const score = computeTokenScore(target, el.text);
    if (score >= 0.4 && (!nonEditableMatch || score > nonEditableMatch.score)) {
      nonEditableMatch = { text: el.text, tag: el.tagName ?? "unknown", score };
    }
  }

  if (nonEditableMatch) {
    return {
      status: "not_editable",
      target,
      confidence: Math.min(nonEditableMatch.score, 0.99),
      matchReason: "fill_target_not_editable",
      matchedTag: nonEditableMatch.tag,
      matchedText: nonEditableMatch.text,
      attemptedLocators,
      editableCandidatesCount: editableElements.length,
      nonEditableMatch: {
        text: nonEditableMatch.text,
        tag: nonEditableMatch.tag,
        reason: `Matched text is not an editable field. Found in <${nonEditableMatch.tag}> element.`
      }
    };
  }

  // Phase 4: No match at all
  return {
    status: "not_found",
    target,
    confidence: 0,
    matchReason: "fill_target_not_found",
    attemptedLocators,
    editableCandidatesCount: editableElements.length
  };
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
