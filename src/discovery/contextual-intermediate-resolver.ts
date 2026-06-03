/**
 * Contextual Ambiguous Intermediate Resolver
 * 
 * Resolves ambiguous short/generic targets that represent intermediate steps
 * in hierarchical routes (e.g., "Pesos" as a filter vs "Cuenta en Pesos" as product).
 * 
 * Uses route context, previousTarget, nextTarget, routeProfile, and candidate classification
 * to distinguish between:
 * - filter/category/intermediate/route_option (intermediate steps)
 * - product_card/list_item (final selection targets)
 * 
 * Activates when:
 * - Target is ambiguous (multiple similar candidates)
 * - Target is short/generic
 * - Previous target or routeHistory exists
 * - Next target indicates ordinal_selection or item selection
 * - routeProfile intermediates/routes can help disambiguate
 */

import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";
import type { AppRouteProfile } from "../types/env.types";

export type CandidateType =
  | "filter"
  | "category"
  | "intermediate"
  | "route_option"
  | "product_card"
  | "list_item"
  | "submit"
  | "navigation"
  | "back"
  | "heading"
  | "unknown";

export type ClassifiedCandidate = {
  element: SnapshotElement;
  text: string;
  normalizedText: string;
  type: CandidateType;
  isExactMatch: boolean;
  isContainsMatch: boolean;
  isInsideCard: boolean;
  isInsideListItem: boolean;
  isClickable: boolean;
  isSubmitLike: boolean;
  isSensitive: boolean;
  isBackNavigation: boolean;
  score: number;
  scoreReasons: string[];
  routeProfileMatch?: "intermediate" | "route" | "alias" | "domainTerm";
};

export type ContextualResolverInput = {
  target: string;
  previousTarget?: string;
  nextTarget?: string;
  routeHistory?: string[];
  routeProfile?: AppRouteProfile;
  candidates: SnapshotElement[];
};

export type ContextualResolverResult = {
  status: "resolved" | "unresolved" | "skip_contextual" | "already_satisfied";
  selectedCandidate?: SnapshotElement;
  selectedCandidateText?: string;
  classifiedCandidates: ClassifiedCandidate[];
  reason?: string;
  alreadySatisfiedEvidence?: {
    candidateText: string;
    candidateType: CandidateType;
    containsTarget: boolean;
    consistentWithNextTarget: boolean;
    reason: string;
  };
  diagnostics: {
    targetIsShort: boolean;
    nextTargetIsOrdinal: boolean;
    routeProfileUsed: boolean;
    intermediatesMatched: string[];
    classificationSummary: Record<CandidateType, number>;
  };
};

const SHORT_TARGET_MAX_LENGTH = 15;
const GENERIC_TERMS = [
  "pesos", "dólares", "dolares", "euros", "moneda",
  "vigentes", "activos", "inactivos", "pendientes", "aprobados",
  "residencial", "empresarial", "personal", "corporativo",
  "credito", "crédito", "ahorro", "corriente", "nomina", "nómina",
  "primer", "primera", "último", "última", "visible", "listado"
];

const BACK_NAVIGATION_PATTERNS = [
  /volver/i, /atrás/i, /atras/i, /regresar/i, /return/i, /back/i,
  /cancel/i, /cancelar/i, /salir/i, /exit/i, /close/i, /cerrar/i
];

const SUBMIT_LIKE_PATTERNS = [
  /submit/i, /enviar/i, /send/i, /confirm/i, /confirmar/i,
  /accept/i, /aceptar/i, /agree/i, /continuar/i, /continue/i,
  /pagar/i, /pay/i, /transfer/i, /transferir/i
];

const SENSITIVE_PATTERNS = [
  /eliminar/i, /delete/i, /borrar/i, /remove/i,
  /cancelar.*producto/i, /cancel.*product/i,
  /cerrar.*cuenta/i, /close.*account/i
];

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

function normalizeText(text: unknown): string {
  return extractTextValue(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isShortTarget(target: string): boolean {
  return target.trim().length <= SHORT_TARGET_MAX_LENGTH;
}

function isGenericTarget(target: string): boolean {
  const normalized = normalizeText(target);
  return GENERIC_TERMS.some(term => normalized === term || normalized.includes(term));
}

function isOrdinalSelectionTarget(target: string): boolean {
  const normalized = normalizeText(target);
  return (
    /\bprimera?\s+/i.test(normalized) ||
    /\bprimer\s+/i.test(normalized) ||
    /\búltima?\s+/i.test(normalized) ||
    /\bultimo\s+/i.test(normalized) ||
    /\bvisible\s+/i.test(normalized) ||
    /\blistado/i.test(normalized) ||
    /\blista/i.test(normalized)
  );
}

function isSubmitLike(target: string): boolean {
  return SUBMIT_LIKE_PATTERNS.some(pattern => pattern.test(target));
}

function isSensitive(target: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(target));
}

function isBackNavigation(target: string): boolean {
  return BACK_NAVIGATION_PATTERNS.some(pattern => pattern.test(target));
}

function classifyCandidateType(
  element: SnapshotElement,
  target: string,
  nextTarget?: string
): CandidateType {
  const text = normalizeText(element.text || element.label || element.name || element.value || element.title || "");
  const normalizedTarget = normalizeText(target);
  
  // Check if element is inside a card or list item
  const isInsideCard = element.type === "card" || 
    element.className?.includes("card") ||
    element.role === "listitem";
  const isInsideListItem = element.role === "listitem" || element.type === "section";
  
  // Check if it's a heading
  const isHeading = ["h1", "h2", "h3", "h4", "h5", "h6"].includes(element.tagName?.toLowerCase() || "");
  
  // Check if it's submit-like
  if (isSubmitLike(text)) {
    return "submit";
  }
  
  // Check if it's back navigation
  if (isBackNavigation(text)) {
    return "navigation";
  }
  
  // Check if it's sensitive
  if (isSensitive(text)) {
    return "submit"; // Treat sensitive as submit for blocking
  }
  
  // If next target is ordinal selection, prefer filters/categories over product cards
  const nextIsOrdinal = nextTarget ? isOrdinalSelectionTarget(nextTarget) : false;
  
  // Exact match with short/generic target suggests filter/intermediate
  if (text === normalizedTarget && isShortTarget(target)) {
    if (nextIsOrdinal) {
      return "filter";
    }
    return element.type === "button" || element.role === "button" ? "filter" : "intermediate";
  }
  
  // Contains match with longer text suggests product card
  if (text.includes(normalizedTarget) && text.length > normalizedTarget.length + 10) {
    if (nextIsOrdinal) {
      return "product_card";
    }
    return isInsideCard || isInsideListItem ? "product_card" : "list_item";
  }
  
  // Check element type
  if (element.type === "button" || element.role === "button") {
    if (nextIsOrdinal) {
      return "filter";
    }
    return "intermediate";
  }
  
  if (element.type === "link" || element.role === "link") {
    if (nextIsOrdinal) {
      return "category";
    }
    return "route_option";
  }
  
  if (isInsideCard || isInsideListItem) {
    return "product_card";
  }
  
  if (isHeading) {
    return "heading";
  }
  
  return "unknown";
}

function calculateCandidateScore(
  candidate: ClassifiedCandidate,
  input: ContextualResolverInput
): { score: number; reasons: string[] } {
  let score: number = 0;
  const reasons: string[] = [];
  
  const normalizedTarget = normalizeText(input.target);
  
  // Base score from exact match
  if (candidate.isExactMatch) {
    score += 0.4;
    reasons.push("exact_match");
  } else if (candidate.isContainsMatch) {
    score += 0.2;
    reasons.push("contains_match");
  }
  
  // Penalize product cards when target is short/generic and next is ordinal
  const nextIsOrdinal = input.nextTarget ? isOrdinalSelectionTarget(input.nextTarget) : false;
  const targetIsShort = isShortTarget(input.target);
  
  if (targetIsShort && nextIsOrdinal) {
    if (candidate.type === "filter" || candidate.type === "category" || candidate.type === "intermediate") {
      score += 0.3;
      reasons.push("preferred_for_ordinal_next_step");
    } else if (candidate.type === "product_card") {
      score -= 0.3;
      reasons.push("penalized_product_card_for_ordinal_next_step");
    }
  }
  
  // Bonus for routeProfile match
  if (candidate.routeProfileMatch) {
    score += 0.2;
    reasons.push(`routeProfile_${candidate.routeProfileMatch}`);
  }
  
  // Penalize submit-like when not expected
  if (candidate.isSubmitLike && !isSubmitLike(input.target)) {
    score -= 0.4;
    reasons.push("penalized_submit_like");
  }
  
  // Penalize sensitive
  if (candidate.isSensitive) {
    score -= 0.5;
    reasons.push("penalized_sensitive");
  }
  
  // Penalize back navigation
  if (candidate.isBackNavigation) {
    score -= 0.4;
    reasons.push("penalized_back_navigation");
  }
  
  // Bonus for clickable
  if (candidate.isClickable) {
    score += 0.1;
    reasons.push("clickable");
  }
  
  // Bonus for consistency with previous target
  if (input.previousTarget && input.routeProfile) {
    // Check if this candidate fits in the route progression
    const routeMatches = input.routeProfile.routes?.some(route => {
      if (!route.from || !route.intermediates) return false;
      const fromMatch = normalizeText(route.from).includes(normalizeText(input.previousTarget!));
      // Handle both array and object format for intermediates
      let intermediateMatch = false;
      if (Array.isArray(route.intermediates)) {
        intermediateMatch = route.intermediates.some(int => 
          typeof int === "string" && normalizeText(int).includes(normalizedTarget)
        );
      } else if (typeof route.intermediates === "object") {
        // Object format: check all values
        for (const key of Object.keys(route.intermediates)) {
          const values = (route.intermediates as any)[key];
          if (Array.isArray(values)) {
            intermediateMatch = values.some((v: any) => 
              typeof v === "string" && normalizeText(v).includes(normalizedTarget)
            );
            if (intermediateMatch) break;
          }
        }
      }
      return fromMatch && intermediateMatch;
    });
    
    if (routeMatches) {
      score += 0.2;
      reasons.push("consistent_with_route_profile");
    }
  }
  
  return { score: Math.max(0, Math.min(1, score)), reasons };
}

function matchRouteProfile(
  target: string,
  routeProfile?: AppRouteProfile
): ClassifiedCandidate["routeProfileMatch"] {
  if (!routeProfile) return undefined;
  
  const normalizedTarget = normalizeText(target);
  
  // Check intermediates
  const routes = routeProfile.routes || [];
  for (const route of routes) {
    const intermediates = route.intermediates || [];
    // Handle both array format (intermediates: string[]) and object format (intermediates: { category: [...], ... })
    if (Array.isArray(intermediates)) {
      for (const intermediate of intermediates) {
        if (typeof intermediate !== "string") continue;
        if (normalizeText(intermediate) === normalizedTarget) {
          return "intermediate";
        }
        if (normalizeText(intermediate).includes(normalizedTarget)) {
          return "intermediate";
        }
      }
    } else if (typeof intermediates === "object") {
      // Object format: extract all values from the object
      for (const key of Object.keys(intermediates)) {
        const values = (intermediates as any)[key];
        if (Array.isArray(values)) {
          for (const value of values) {
            if (typeof value !== "string") continue;
            if (normalizeText(value) === normalizedTarget) {
              return "intermediate";
            }
            if (normalizeText(value).includes(normalizedTarget)) {
              return "intermediate";
            }
          }
        }
      }
    }
  }
  
  // Check aliases
  const aliases = routeProfile.aliases || {};
  for (const [alias, value] of Object.entries(aliases)) {
    if (typeof alias === "string" && typeof value === "string") {
      if (normalizeText(alias) === normalizedTarget || normalizeText(value) === normalizedTarget) {
        return "alias";
      }
    }
  }
  
  // Check domain terms
  const domainTerms = routeProfile.domainTerms || [];
  for (const term of domainTerms) {
    if (typeof term !== "string") continue;
    if (normalizeText(term) === normalizedTarget) {
      return "domainTerm";
    }
  }
  
  return undefined;
}

/**
 * Evaluate if an intermediate target is already satisfied by visible items.
 * 
 * This handles cases where a short/variant target (e.g., "Pesos", "Vigentes")
 * doesn't have an exact filter/button to click, but the visible list already
 * contains items matching that variant.
 * 
 * Returns already_satisfied when:
 * - Target is short/generic variant
 * - Next target is ordinal selection
 * - No safe exact filter candidate exists
 * - Visible product_card/list_item contains the target variant
 * - Candidate is consistent with nextTarget domainTerm
 */
function evaluateIntermediateAlreadySatisfied(
  input: ContextualResolverInput,
  classifiedCandidates: ClassifiedCandidate[]
): ContextualResolverResult["alreadySatisfiedEvidence"] | undefined {
  const normalizedTarget = normalizeText(input.target);
  const nextIsOrdinal = input.nextTarget ? isOrdinalSelectionTarget(input.nextTarget) : false;
  const targetIsShort = isShortTarget(input.target);
  const targetIsGeneric = isGenericTarget(input.target);
  
  // Must be short/generic target with ordinal next step
  if (!targetIsShort || !nextIsOrdinal) {
    return undefined;
  }
  
  // Find product_card or list_item candidates that contain the target
  const visibleItems = classifiedCandidates.filter(c => 
    c.element.visible &&
    (c.type === "product_card" || c.type === "list_item") &&
    !c.isSubmitLike &&
    !c.isSensitive &&
    !c.isBackNavigation &&
    (c.isContainsMatch || c.normalizedText.includes(normalizedTarget))
  );
  
  if (visibleItems.length === 0) {
    return undefined;
  }
  
  // Check if any visible item is consistent with nextTarget domainTerm
  let consistentCandidate: ClassifiedCandidate | undefined;
  
  if (input.routeProfile && input.nextTarget) {
    // Extract domain term from nextTarget or use routeProfile domainTerms
    const nextDomainTerms = input.routeProfile.domainTerms || [];
    
    for (const item of visibleItems) {
      // Check if item text contains any domain term
      const containsDomainTerm = nextDomainTerms.some(term => 
        item.normalizedText.includes(normalizeText(term))
      );
      
      if (containsDomainTerm) {
        consistentCandidate = item;
        break;
      }
    }
  }
  
  // If no routeProfile match, just use first visible item
  if (!consistentCandidate && visibleItems.length > 0) {
    consistentCandidate = visibleItems[0];
  }
  
  if (!consistentCandidate) {
    return undefined;
  }
  
  console.log(`[contextual-resolver] already_satisfied evidence candidate="${consistentCandidate.text}" type="${consistentCandidate.type}" reason="visible_item_contains_variant_and_next_step_is_ordinal"`);
  
  return {
    candidateText: consistentCandidate.text,
    candidateType: consistentCandidate.type,
    containsTarget: consistentCandidate.normalizedText.includes(normalizedTarget),
    consistentWithNextTarget: true,
    reason: "visible_item_contains_variant_and_next_step_is_ordinal"
  };
}

export function resolveAmbiguousIntermediateTarget(
  input: ContextualResolverInput
): ContextualResolverResult {
  const normalizedTarget = normalizeText(input.target);
  const targetIsShort = isShortTarget(input.target);
  const targetIsGeneric = isGenericTarget(input.target);
  const nextIsOrdinal = input.nextTarget ? isOrdinalSelectionTarget(input.nextTarget) : false;
  
  console.log(`[contextual-resolver] evaluating target="${input.target}" previous="${input.previousTarget || "none"}" next="${input.nextTarget || "none"}"`);
  console.log(`[contextual-resolver] targetIsShort=${targetIsShort} targetIsGeneric=${targetIsGeneric} nextIsOrdinal=${nextIsOrdinal}`);
  
  // Skip contextual resolution if conditions don't warrant it
  if (!targetIsShort && !targetIsGeneric) {
    console.log(`[contextual-resolver] skip_contextual reason="target_not_short_or_generic"`);
    return {
      status: "skip_contextual",
      classifiedCandidates: [],
      reason: "target_not_short_or_generic",
      diagnostics: {
        targetIsShort: false,
        nextTargetIsOrdinal: nextIsOrdinal,
        routeProfileUsed: false,
        intermediatesMatched: [],
        classificationSummary: {} as Record<CandidateType, number>
      }
    };
  }
  
  if (!nextIsOrdinal && !input.previousTarget && !input.routeProfile) {
    console.log(`[contextual-resolver] skip_contextual reason="no_context_available"`);
    return {
      status: "skip_contextual",
      classifiedCandidates: [],
      reason: "no_context_available",
      diagnostics: {
        targetIsShort: targetIsShort,
        nextTargetIsOrdinal: nextIsOrdinal,
        routeProfileUsed: false,
        intermediatesMatched: [],
        classificationSummary: {} as Record<CandidateType, number>
      }
    };
  }
  
  // Classify all candidates
  const classifiedCandidates: ClassifiedCandidate[] = input.candidates.map(element => {
    const text = extractTextValue(element.text || element.label || element.name || element.value || element.title || "");
    const normalizedText = normalizeText(text);
    const isExactMatch = normalizedText === normalizedTarget;
    const isContainsMatch = normalizedText.includes(normalizedTarget) && !isExactMatch;
    
    const type = classifyCandidateType(element, input.target, input.nextTarget);
    const routeProfileMatch = matchRouteProfile(input.target, input.routeProfile);
    
    const candidate: ClassifiedCandidate = {
      element,
      text,
      normalizedText,
      type,
      isExactMatch,
      isContainsMatch,
      isInsideCard: element.type === "card" || element.className?.includes("card") || false,
      isInsideListItem: element.role === "listitem" || false,
      isClickable: element.type === "button" || element.type === "link" || 
                   element.role === "button" || element.role === "link" ||
                   element.candidateLocators?.some(loc => loc.strategy === "role" || loc.strategy === "text") || false,
      isSubmitLike: isSubmitLike(text),
      isSensitive: isSensitive(text),
      isBackNavigation: isBackNavigation(text),
      score: 0,
      scoreReasons: [],
      routeProfileMatch
    };
    
    const scoring = calculateCandidateScore(candidate, input);
    candidate.score = scoring.score;
    candidate.scoreReasons = scoring.reasons;
    
    return candidate;
  });
  
  // Log classification
  for (const candidate of classifiedCandidates) {
    console.log(`[contextual-resolver] candidate classified text="${candidate.text}" type="${candidate.type}" exactMatch=${candidate.isExactMatch} score=${candidate.score.toFixed(2)} reasons="${candidate.scoreReasons.join(",")}"`);
  }
  
  // Build classification summary
  const classificationSummary = classifiedCandidates.reduce((acc, c) => {
    acc[c.type] = (acc[c.type] || 0) + 1;
    return acc;
  }, {} as Record<CandidateType, number>);
  
  // Find best candidate
  const safeCandidates = classifiedCandidates.filter(c => !c.isSubmitLike && !c.isSensitive && !c.isBackNavigation);
  
  if (safeCandidates.length === 0) {
    console.log(`[contextual-resolver] unresolved reason="no_safe_candidates"`);
    return {
      status: "unresolved",
      classifiedCandidates,
      reason: "no_safe_candidates",
      diagnostics: {
        targetIsShort,
        nextTargetIsOrdinal: nextIsOrdinal,
        routeProfileUsed: !!input.routeProfile,
        intermediatesMatched: classifiedCandidates.filter(c => c.routeProfileMatch === "intermediate").map(c => c.text),
        classificationSummary
      }
    };
  }
  
  const sorted = safeCandidates.sort((a, b) => b.score - a.score);
  const best = sorted[0];
  
  // Check if best candidate is sufficiently better than second
  const second = sorted[1];
  const scoreDiff = second ? best.score - second.score : 1.0;
  
  if (scoreDiff < 0.1 && second && second.score > 0.5) {
    console.log(`[contextual-resolver] unresolved reason="insufficient_score_difference" best="${best.text}" second="${second.text}" diff=${scoreDiff.toFixed(2)}`);
    return {
      status: "unresolved",
      classifiedCandidates,
      reason: "insufficient_score_difference",
      diagnostics: {
        targetIsShort,
        nextTargetIsOrdinal: nextIsOrdinal,
        routeProfileUsed: !!input.routeProfile,
        intermediatesMatched: classifiedCandidates.filter(c => c.routeProfileMatch === "intermediate").map(c => c.text),
        classificationSummary
      }
    };
  }
  
  if (best.score < 0.4) {
    // === Check for intermediate already satisfied ===
    // When no safe exact filter candidate exists, check if the variant is already visible
    const alreadySatisfied = evaluateIntermediateAlreadySatisfied(input, classifiedCandidates);
    
    if (alreadySatisfied) {
      console.log(`[contextual-resolver] already_satisfied target="${input.target}" evidence="${alreadySatisfied.candidateText}" reason="${alreadySatisfied.reason}"`);
      return {
        status: "already_satisfied",
        classifiedCandidates,
        reason: "variant_visible_in_next_list",
        alreadySatisfiedEvidence: alreadySatisfied,
        diagnostics: {
          targetIsShort,
          nextTargetIsOrdinal: nextIsOrdinal,
          routeProfileUsed: !!input.routeProfile,
          intermediatesMatched: classifiedCandidates.filter(c => c.routeProfileMatch === "intermediate").map(c => c.text),
          classificationSummary
        }
      };
    }
    
    console.log(`[contextual-resolver] unresolved reason="best_score_too_low" score=${best.score.toFixed(2)}`);
    return {
      status: "unresolved",
      classifiedCandidates,
      reason: "best_score_too_low",
      diagnostics: {
        targetIsShort,
        nextTargetIsOrdinal: nextIsOrdinal,
        routeProfileUsed: !!input.routeProfile,
        intermediatesMatched: classifiedCandidates.filter(c => c.routeProfileMatch === "intermediate").map(c => c.text),
        classificationSummary
      }
    };
  }

  if (targetIsShort || targetIsGeneric) {
    const bestTextMatchesTarget = best.isExactMatch || best.isContainsMatch || best.normalizedText.includes(normalizedTarget);
    const bestIsSafeContextualType = best.type === "filter" || best.type === "category" || best.type === "intermediate" || best.type === "route_option";
    if (!bestTextMatchesTarget || (!bestIsSafeContextualType && best.score < 0.75)) {
      console.log(`[contextual-resolver] unresolved reason="unsafe_generic_target" best="${best.text}" type="${best.type}" score=${best.score.toFixed(2)}`);
      return {
        status: "unresolved",
        classifiedCandidates,
        reason: "unsafe_generic_target",
        diagnostics: {
          targetIsShort,
          nextTargetIsOrdinal: nextIsOrdinal,
          routeProfileUsed: !!input.routeProfile,
          intermediatesMatched: classifiedCandidates.filter(c => c.routeProfileMatch === "intermediate").map(c => c.text),
          classificationSummary
        }
      };
    }
  }
  
  console.log(`[contextual-resolver] resolved target="${input.target}" selected="${best.text}" type="${best.type}" score=${best.score.toFixed(2)} reason="${best.scoreReasons.join(",")}"`);
  
  return {
    status: "resolved",
    selectedCandidate: best.element,
    selectedCandidateText: best.text,
    classifiedCandidates,
    reason: best.scoreReasons.join(","),
    diagnostics: {
      targetIsShort,
      nextTargetIsOrdinal: nextIsOrdinal,
      routeProfileUsed: !!input.routeProfile,
      intermediatesMatched: classifiedCandidates.filter(c => c.routeProfileMatch === "intermediate").map(c => c.text),
      classificationSummary
    }
  };
}
