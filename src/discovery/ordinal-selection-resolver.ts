/**
 * Ordinal Selection Resolver
 * 
 * Detects and resolves ordinal selection patterns like:
 * - "Seleccionar la primera tarjeta visible del listado" (action completo)
 * - "la primera tarjeta visible del listado" (target limpio)
 * - "el primer producto visible del listado" (fallback genérico)
 * 
 * Uses routeProfile.domainTerms for multi-project support (no hardcoded domains).
 * Works with both action_text and target_text input modes.
 */

import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";
import type { AppRouteProfile } from "../types/env.types";

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export type OrdinalSelectionPattern = {
  ordinal: "first" | "second" | "third" | "last";
  domainTerm?: string;
  genericItemTerm: string;
  isListContext: boolean;
};

export type OrdinalSelectionDiagnostics = {
  selectionPatternDetected: boolean;
  inputMode: "action_text" | "target_text" | "combined";
  ordinal?: "first" | "second" | "third" | "last";
  domainTerm?: string;
  domainTermSource: "routeProfile" | "generic_fallback";
  selectedCandidateText?: string;
  selectedCandidateId?: string;
  excludedCandidates: string[];
  totalCandidates: number;
  clickableCandidates: number;
  candidateSearchScope: "main_content" | "snapshot";
  resolution?: "clicked_card" | "clicked_container" | "accepted_visible_item" | "ambiguous";
  reason?: string;
  domainTermsUsed: string[];
};

export type OrdinalSelectionResult = {
  status: "resolved" | "ambiguous_target" | "no_safe_candidate" | "pattern_not_matched";
  candidateId?: string;
  candidateText?: string;
  locatorStrategy?: string;
  confidence: number;
  diagnostics: OrdinalSelectionDiagnostics;
};

const ORDINAL_PATTERNS = [
  { pattern: /(?:la|el|los|las)\s+primera?\s+/i, ordinal: "first" as const },
  { pattern: /(?:la|el|los|las)\s+segunda?\s+/i, ordinal: "second" as const },
  { pattern: /(?:la|el|los|las)\s+tercera?\s+/i, ordinal: "third" as const },
  { pattern: /(?:la|el|los|las)\s+(?:última|ultima)\s+/i, ordinal: "last" as const }
];

const LIST_CONTEXT_PATTERNS = [
  /del\s+listado/i,
  /de\s+la\s+lista/i,
  /del\s+list/i,
  /de\s+la\s+list/i,
  /visible\s+del/i,
  /disponible\s+del/i,
  /en\s+el\s+listado/i,
  /en\s+la\s+lista/i,
  /visible/i,
  /disponible/i,
  /mostrad[o0]/i
];

const SELECTION_VERBS = [
  /seleccionar/i,
  /elegir/i,
  /escoger/i,
  /select/i,
  /choose/i,
  /pick/i
];

const GLOBAL_BUTTON_LABELS = [
  "volver", "salir", "finalizar sesión", "cerrar sesión", "logout", "sign out",
  "solicitar", "request", "submit", "enviar", "send",
  "cancelar", "cancel", "atrás", "back", "regresar", "return",
  "ok", "aceptar", "accept", "confirmar", "confirm",
  "menú principal", "menu principal", "main menu"
];

const SUBMIT_LIKE_PATTERNS = [
  /submit/i,
  /enviar/i,
  /envíar/i,
  /mandar/i,
  /request/i,
  /solicitar/i,
  /aplicar/i,
  /apply/i,
  /confirmar/i,
  /confirm/i,
  /aceptar/i,
  /accept/i,
  /continuar/i,
  /continue/i,
  /siguiente/i,
  /next/i,
  /pagar/i,
  /pay/i,
  /transferir/i,
  /transfer/i,
  /contrato/i,
  /contract/i
];

function isSelectionVerb(text: string): boolean {
  return SELECTION_VERBS.some(pattern => pattern.test(text));
}

function hasListContext(text: string): boolean {
  return LIST_CONTEXT_PATTERNS.some(pattern => pattern.test(text));
}

function extractOrdinal(text: string): "first" | "second" | "third" | "last" | null {
  for (const { pattern, ordinal } of ORDINAL_PATTERNS) {
    if (pattern.test(text)) {
      return ordinal;
    }
  }
  return null;
}

/**
 * Build domain terms list from routeProfile with singular/plural variants.
 * Supports: "tarjeta" -> ["tarjeta", "tarjetas"], "usuario" -> ["usuario", "usuarios"]
 */
function buildDomainTermsList(routeProfile?: AppRouteProfile): string[] {
  const terms = routeProfile?.domainTerms ?? [];
  const expanded: string[] = [];
  
  for (const term of terms) {
    const normalized = normalizeText(term);
    expanded.push(normalized);
    
    // Add plural variants (simple -s suffix)
    if (!normalized.endsWith("s")) {
      expanded.push(normalized + "s");
    }
    
    // Handle common singular forms
    if (normalized.endsWith("es")) {
      expanded.push(normalized.slice(0, -2)); // "usuarios" -> "usuario"
    } else if (normalized.endsWith("as") || normalized.endsWith("os")) {
      expanded.push(normalized.slice(0, -1)); // "tarjetas" -> "tarjeta"
    }
  }
  
  return Array.from(new Set(expanded));
}

function extractDomainTerm(
  text: string,
  domainTermsList: string[]
): { term: string | undefined; source: "routeProfile" | "generic_fallback" } {
  const normalized = normalizeText(text);
  
  // First, try to match against routeProfile domain terms
  for (const term of domainTermsList) {
    if (normalized.includes(term)) {
      return { term, source: "routeProfile" };
    }
  }
  
  // Fallback: check for generic item terms
  const genericTerms = ["producto", "productos", "product", "products", "elemento", "elementos", "item", "items", "opción", "opciones", "option", "options"];
  for (const term of genericTerms) {
    if (normalized.includes(normalizeText(term))) {
      return { term: term.split("s")[0], source: "generic_fallback" }; // Return singular form
    }
  }
  
  return { term: undefined, source: "generic_fallback" };
}

function isGlobalButton(text: string, routeProfile?: AppRouteProfile): boolean {
  const normalized = normalizeText(text);
  const blockedLabels = routeProfile?.blockedLabels ?? [];
  
  // Check against blocked labels from routeProfile
  for (const label of blockedLabels) {
    if (normalized.includes(normalizeText(label))) {
      return true;
    }
  }
  
  // Check against visibleControls from routeProfile
  const visibleControls = (routeProfile as any)?.visibleControls ?? [];
  for (const control of visibleControls) {
    if (typeof control === "string" && normalized.includes(normalizeText(control))) {
      return true;
    }
  }
  
  return GLOBAL_BUTTON_LABELS.some(label => normalized === normalizeText(label) || normalized.includes(normalizeText(label)));
}

function isSubmitLike(text: string): boolean {
  return SUBMIT_LIKE_PATTERNS.some(pattern => pattern.test(text));
}

function isGenericItemTerm(term: string): boolean {
  const genericTerms = ["producto", "product", "elemento", "item", "tarjeta", "card", "resultado", "result", "opción", "option"];
  const normalized = normalizeText(term);
  return genericTerms.some(t => normalizeText(t) === normalized || normalized.includes(normalizeText(t)));
}

/**
 * Detect ordinal selection pattern from text.
 * Works with both action_text (full step) and target_text (cleaned target).
 * Does NOT require selection verb - ordinal + domainTerm + list context is sufficient.
 */
export function detectOrdinalSelectionPattern(
  target: string,
  routeProfile?: AppRouteProfile,
  actionText?: string
): OrdinalSelectionPattern | null {
  const combinedText = actionText ? `${actionText} ${target}` : target;
  const normalized = normalizeText(combinedText);
  
  // Determine input mode
  const hasActionVerb = isSelectionVerb(actionText ?? "");
  const inputMode = actionText && hasActionVerb ? "combined" : (actionText ? "action_text" : "target_text");
  
  console.log(`[ordinal-selection] evaluating target="${target}"`);
  console.log(`[ordinal-selection] inputMode=${inputMode}`);
  console.log(`[ordinal-selection] routeProfile domainTerms=${routeProfile?.domainTerms?.length ?? 0}`);
  
  // Extract ordinal - required
  const ordinal = extractOrdinal(normalized);
  if (!ordinal) {
    console.log(`[ordinal-selection] skipped reason=no_ordinal`);
    return null;
  }
  
  // Extract list context - required
  const hasList = hasListContext(normalized);
  if (!hasList) {
    console.log(`[ordinal-selection] skipped reason=no_list_context`);
    return null;
  }
  
  // Extract domain term from routeProfile
  const domainTermsList = buildDomainTermsList(routeProfile);
  const { term: domainTerm, source } = extractDomainTerm(normalized, domainTermsList);
  
  console.log(`[ordinal-selection] pattern detected ordinal=${ordinal} domainTerm="${domainTerm ?? "none"}" source=${source}`);
  
  // Determine generic item term
  let genericItemTerm = "item";
  const itemTerms = ["producto", "product", "elemento", "item", "tarjeta", "card", "resultado", "result", "opción", "option", "cuenta", "account", "préstamo", "loan", "deposito", "depósito", "deposit", "usuario", "user", "servicio", "service", "documento", "document"];
  
  for (const term of itemTerms) {
    if (normalized.includes(normalizeText(term))) {
      genericItemTerm = term;
      break;
    }
  }
  
  return {
    ordinal,
    domainTerm,
    genericItemTerm,
    isListContext: true
  };
}

export function resolveOrdinalSelection(
  snapshot: PageSnapshot,
  pattern: OrdinalSelectionPattern,
  routeProfile?: AppRouteProfile,
  actionText?: string
): OrdinalSelectionResult {
  const domainTermsList = buildDomainTermsList(routeProfile);
  const excludedCandidates: string[] = [];
  
  // Determine input mode for diagnostics
  const hasActionVerb = isSelectionVerb(actionText ?? "");
  const inputMode: "action_text" | "target_text" | "combined" = actionText && hasActionVerb ? "combined" : (actionText ? "action_text" : "target_text");
  
  const candidates = snapshot.elements.filter(el => {
    const text = (el.text || el.label || el.name || "").trim();
    if (!text) return false;
    
    if (isGlobalButton(text, routeProfile)) {
      excludedCandidates.push(text);
      return false;
    }
    
    if (isSubmitLike(text)) {
      excludedCandidates.push(text);
      return false;
    }
    
    // Check if element is clickable (button, link, card, or has click handlers)
    const isClickable = el.type === "button" || el.type === "link" || el.type === "card" ||
                        el.role === "button" || el.role === "link" || el.role === "listitem" ||
                        el.tagName === "button" || el.tagName === "a" || el.tagName === "article" ||
                        el.candidateLocators.some(loc => loc.strategy === "role" || loc.strategy === "text");
    
    if (!isClickable) {
      return false;
    }
    
    if (!el.visible) {
      return false;
    }
    
    if (pattern.domainTerm) {
      const normalizedText = normalizeText(text);
      const normalizedDomainTerm = normalizeText(pattern.domainTerm);
      if (!normalizedText.includes(normalizedDomainTerm)) {
        return false;
      }
    } else if (!isGenericItemTerm(pattern.genericItemTerm)) {
      const normalizedText = normalizeText(text);
      const normalizedDomainTerm = normalizeText(pattern.genericItemTerm);
      if (!normalizedText.includes(normalizedDomainTerm)) {
        return false;
      }
    }
    
    const isListItem = el.type === "card" || el.role === "listitem" || el.role === "list-item" || 
                       el.tagName === "li" || el.tagName === "article" ||
                       (el as any).className?.includes("card") ||
                       (el as any).className?.includes("list-item");
    
    const isHeading = el.tagName === "h1" || el.tagName === "h2" || el.tagName === "h3" || 
                      el.tagName === "h4" || el.role?.includes("heading");
    
    return isListItem || isHeading;
  });
  
  if (candidates.length === 0) {
    console.log(`[ordinal-selection] skipped reason=no_safe_candidate domainTerm=${pattern.domainTerm ?? "none"}`);
    return {
      status: "no_safe_candidate",
      confidence: 0,
      diagnostics: {
        selectionPatternDetected: true,
        inputMode,
        ordinal: pattern.ordinal,
        domainTerm: pattern.domainTerm,
        domainTermSource: pattern.domainTerm ? "routeProfile" : "generic_fallback",
        excludedCandidates,
        totalCandidates: 0,
        clickableCandidates: 0,
        candidateSearchScope: "main_content",
        reason: "No visible clickable candidates matching domain term",
        domainTermsUsed: domainTermsList
      }
    };
  }
  
  if (candidates.length === 1) {
    const selected = candidates[0];
    const strategy = selected.type === "card" ? "card" : selected.role === "listitem" ? "listitem" : selected.tagName === "h1" || selected.tagName === "h2" ? "heading" : "button";
    console.log(`[ordinal-selection] selected candidate="${selected.text || selected.label || selected.name}" strategy=${strategy}`);
    return {
      status: "resolved",
      candidateId: selected.id,
      candidateText: selected.text || selected.label || selected.name,
      locatorStrategy: "ordinal_selection",
      confidence: 0.85,
      diagnostics: {
        selectionPatternDetected: true,
        inputMode,
        ordinal: pattern.ordinal,
        domainTerm: pattern.domainTerm,
        domainTermSource: pattern.domainTerm ? "routeProfile" : "generic_fallback",
        selectedCandidateText: selected.text || selected.label || selected.name,
        selectedCandidateId: selected.id,
        excludedCandidates,
        totalCandidates: candidates.length,
        clickableCandidates: candidates.length,
        candidateSearchScope: "main_content",
        resolution: strategy === "card" ? "clicked_card" : strategy === "heading" ? "clicked_container" : "accepted_visible_item",
        domainTermsUsed: domainTermsList
      }
    };
  }
  
  const sortedCandidates = candidates.sort((a, b) => {
    const aIndex = snapshot.elements.findIndex(el => el.id === a.id);
    const bIndex = snapshot.elements.findIndex(el => el.id === b.id);
    return aIndex - bIndex;
  });
  
  let selectedIndex = 0;
  switch (pattern.ordinal) {
    case "first":
      selectedIndex = 0;
      break;
    case "second":
      selectedIndex = Math.min(1, sortedCandidates.length - 1);
      break;
    case "third":
      selectedIndex = Math.min(2, sortedCandidates.length - 1);
      break;
    case "last":
      selectedIndex = sortedCandidates.length - 1;
      break;
  }
  
  const selected = sortedCandidates[selectedIndex];
  const strategy = selected.type === "card" ? "card" : selected.role === "listitem" ? "listitem" : selected.tagName === "h1" || selected.tagName === "h2" ? "heading" : "button";
  
  return {
    status: "resolved",
    candidateId: selected.id,
    candidateText: selected.text || selected.label || selected.name,
    locatorStrategy: "ordinal_selection",
    confidence: pattern.domainTerm ? 0.85 : 0.65,
    diagnostics: {
      selectionPatternDetected: true,
      inputMode,
      ordinal: pattern.ordinal,
      domainTerm: pattern.domainTerm,
      domainTermSource: pattern.domainTerm ? "routeProfile" : "generic_fallback",
      selectedCandidateText: selected.text || selected.label || selected.name,
      selectedCandidateId: selected.id,
      excludedCandidates,
      totalCandidates: sortedCandidates.length,
      clickableCandidates: sortedCandidates.length,
      candidateSearchScope: "main_content",
      resolution: strategy === "card" ? "clicked_card" : strategy === "heading" ? "clicked_container" : "accepted_visible_item",
      domainTermsUsed: domainTermsList
    }
  };
}

export function createAmbiguousResult(
  target: string,
  pattern: OrdinalSelectionPattern,
  candidateCount: number,
  candidateTexts: string[],
  routeProfile?: AppRouteProfile,
  actionText?: string
): OrdinalSelectionResult {
  const hasActionVerb = isSelectionVerb(actionText ?? "");
  const inputMode: "action_text" | "target_text" | "combined" = actionText && hasActionVerb ? "combined" : (actionText ? "action_text" : "target_text");
  const domainTermsList = buildDomainTermsList(routeProfile);
  
  return {
    status: "ambiguous_target",
    confidence: 0.3,
    diagnostics: {
      selectionPatternDetected: true,
      inputMode,
      ordinal: pattern.ordinal,
      domainTerm: pattern.domainTerm,
      domainTermSource: pattern.domainTerm ? "routeProfile" : "generic_fallback",
      excludedCandidates: [],
      totalCandidates: candidateCount,
      clickableCandidates: candidateCount,
      candidateSearchScope: "main_content",
      reason: `Multiple candidates (${candidateCount}) without sufficient disambiguation`,
      domainTermsUsed: domainTermsList
    }
  };
}
