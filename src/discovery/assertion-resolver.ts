import { computeTokenScore, normalizeText } from "./target-resolver";
import { resolveCatalogListAssertion, isCatalogListAssertion } from "./catalog-list-resolver";
import { resolveFeedbackMessageAssertion, isFeedbackAssertion } from "./feedback-message-resolver";
import { resolveCompoundFormFieldsAssertion, parseCompoundFormFieldsAssertion } from "./compound-form-fields-resolver";
import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";

/**
 * Back/return button aliases for semantic matching
 * These allow "Volver al menú principal" to match "Volver al menú" or "Volver"
 */
const BACK_RETURN_ALIASES: Record<string, string[]> = {
  "volver": ["volver", "regresar", "atrás", "atras", "retroceder"],
  "menu": ["menú", "menu", "menu principal", "menú principal"],
  "listado": ["listado", "lista", "list"],
  "inicio": ["inicio", "home", "dashboard"]
};

/**
 * Check if an assertion target is a back/return type assertion
 */
function isBackReturnAssertion(assertionText: string): boolean {
  const normalized = normalizeText(assertionText);
  const backKeywords = ["volver", "regresar", "atras", "atrás", "retroceder", "back", "return"];
  return backKeywords.some(keyword => normalized.includes(keyword));
}

/**
 * Get semantic aliases for a back/return assertion
 * Returns expanded set of texts to match against
 */
function getBackReturnAliases(assertionText: string): string[] {
  const normalized = normalizeText(assertionText);
  const aliases: string[] = [assertionText]; // Always include original
  
  // Check each word/phrase against alias map
  for (const [key, synonyms] of Object.entries(BACK_RETURN_ALIASES)) {
    if (normalized.includes(key)) {
      // Add all synonyms for this key
      for (const synonym of synonyms) {
        // Create variations by replacing the key with synonym
        const replaced = assertionText.replace(new RegExp(key, "gi"), synonym);
        if (replaced !== assertionText && !aliases.includes(replaced)) {
          aliases.push(replaced);
        }
      }
    }
  }
  
  // Add shortened variants for common patterns
  if (normalized.includes("volver al menú principal")) {
    aliases.push("Volver al menú");
    aliases.push("Volver");
  }
  if (normalized.includes("volver al listado")) {
    aliases.push("Volver");
  }
  if (normalized.includes("regresar al")) {
    aliases.push("Regresar");
  }
  
  return aliases;
}

export type AssertionClassification =
  | "literal_observable"
  | "semantic_descriptor"
  | "composite_assertion"
  | "structural_assertion"
  | "catalog_list_assertion"
  | "feedback_message"
  | "compound_form_fields"
  | "expected_only"
  | "optional_assertion"
  | "ambiguous_assertion"
  | "precondition_check"
  | "passive_visibility";

export type AssertionResolutionStatus =
  | "passed"
  | "failed"
  | "skipped_semantic_descriptor"
  | "satisfied_by_children"
  | "needs_assertion_resolution"
  | "needs_approval"
  | "precondition_unresolved"
  | "satisfied_by_previous_assertion"
  | "optional_confirmation_detail_missing";

type CartExecutionState = {
  addToCartExecuted: boolean;
  productAddedToCart: boolean;
  cartOpened: boolean;
  deleteExecuted: boolean;
};

type AssertionContextType =
  | "catalog"
  | "filtered_list"
  | "detail"
  | "cart"
  | "form"
  | "confirmation"
  | "authenticated_area"
  | "unknown";

export type AssertionTargetInput = {
  index: number;
  action: string;
  target: string;
  source: "action" | "expected";
  requiredContext?: {
    destinationIdentity?: string;
    routeRole?: string;
    destinationRole?: string;
  };
};

export type AssertionResolutionResult = {
  assertionText: string;
  normalizedAssertion: string;
  classification: AssertionClassification;
  status: AssertionResolutionStatus;
  matchedText?: string;
  confidence: number;
  reason: string;
  matchReason?: string;
  originalTarget?: string;
  matchedTarget?: string;
  closestCandidates: Array<{
    text: string;
    score: number;
    type: string;
  }>;
  visibleTexts: string[];
  descriptorTypes?: string[];
  subject?: string;
  matchedTokens?: string[];
  structuralSignals?: string[];
  childAssertionsUsed?: string[];
  isWeakSignal?: boolean;
  assertionDiagnostics?: Record<string, unknown>;
  expectedConsumption?: {
    consumed: boolean;
    decision?: string;
    evidence?: string;
    consumedByAction?: string;
    notConsumedReason?: "context_not_reached" | "no_matching_action" | "structural_evidence_missing" | "precondition_unresolved" | "weak_signal" | "expected_only" | "unknown";
  };
  notConsumedReason?: "context_not_reached" | "no_matching_action" | "structural_evidence_missing" | "precondition_unresolved" | "weak_signal" | "expected_only" | "unknown";
  assertionType?: "field" | "action" | "form" | "cart" | "confirmation" | "catalog" | "detail" | "navigation" | "unknown";
};

export type AssertionContext = {
  childSignals?: string[];
};

const DESCRIPTOR_PATTERNS = [
  /\b(validar|verificar|confirmar|revisar|comprobar)\b/,
  /\blistado de\b/,
  /\bpantalla de\b/,
  /\bmostrar listado\b/,
  /\bconsultar listado\b/,
  /\bver pantalla\b/,
  /\bvalidar informacion\b/,
  /\bconfirmar resultados?\b/,
  /\bdetalle\s+(?:de\s+)?/i,
  /\bresumen\s+(?:de\s+)?/i,
  /\binformacion\s+de\s+detalle\b/i,
  /\bpantalla de detalle\b/i,
  /\bvista de detalle\b/i
];

const DESCRIPTOR_TYPE_KEYWORDS: Record<string, string[]> = {
  detail: ["detalle", "detail", "details"],
  listing: ["listado", "lista", "list", "listing", "grid", "table"],
  screen: ["pantalla", "screen", "page", "pagina", "página"],
  summary: ["resumen", "summary"],
  confirmation: ["confirmacion", "confirmación", "confirmation"],
  receipt: ["ticket", "comprobante", "receipt"],
  result: ["resultado", "result"],
  form: ["form", "formulario"],
  modal: ["modal", "dialog"]
};

const GENERIC_DESCRIPTOR_PATTERNS = [
  /\binformacion\s+principal\b.*\bvisible\b/,
  /\binformacion\s+general\b.*\bvisible\b/,
  /\bdatos\s+principales\b.*\bvisibles?\b/,
  /\bcontenido\s+principal\b.*\bvisible\b/,
  /\bseccion\s+principal\b.*\bvisible\b/,
  /\bacciones\s+disponibles\b/,
  /\bopciones\s+disponibles\b.*\bvisibles?\b/
];

const DETAIL_DESCRIPTOR_PATTERNS = [
  /\bdetalle\s+(?:de\s+)?/i,
  /\bresumen\s+(?:de\s+)?/i,
  /\binformacion\s+de\s+detalle\b/i,
  /\bpantalla de detalle\b/i
];

const PRECONDITION_PATTERNS = [
  { pattern: /\bcarrito\s+(?:con|tiene|contiene)\b.*\bproducto\b/i, precondition: "cart_has_product" },
  { pattern: /\bproducto\s+(?:agregado|en|dentro)\b.*\bcarrito\b/i, precondition: "cart_has_product" },
  { pattern: /\bitem\s+(?:en|dentro)\b.*\bcarrito\b/i, precondition: "cart_has_product" },
  { pattern: /\bcarrito\s+de\s+compras\b.*\bproducto\b/i, precondition: "cart_has_product" },
  { pattern: /\bproducto\s+(?:visible|mostrado|aparece)\b/i, precondition: "product_visible" },
  { pattern: /\busuario\s+(?:autenticado|logueado|loggeado|loggeado|sesion iniciada)\b/i, precondition: "user_authenticated" },
  { pattern: /\borden\s+(?:creada|existente|previa)\b/i, precondition: "order_exists" },
  { pattern: /\bregistro\s+(?:existente|previo)\b/i, precondition: "record_exists" },
  { pattern: /\bformulario\s+(?:abierto|visible)\b/i, precondition: "form_opened" },
  { pattern: /\bsolicitud\s+(?:existente|previa)\b/i, precondition: "request_exists" },
  { pattern: /\bcart\s+(?:has|with|contains)\b.*\bproduct\b/i, precondition: "cart_has_product" },
  { pattern: /\bproduct\s+(?:added|in|inside)\b.*\bcart\b/i, precondition: "cart_has_product" },
  { pattern: /\buser\s+(?:authenticated|logged\s*in)\b/i, precondition: "user_authenticated" },
  { pattern: /\border\s+(?:created|existing|prior)\b/i, precondition: "order_exists" },
  { pattern: /\brecord\s+(?:existing|prior)\b/i, precondition: "record_exists" },
  { pattern: /\bform\s+(?:open|visible)\b/i, precondition: "form_opened" },
  { pattern: /\brequest\s+(?:existing|prior)\b/i, precondition: "request_exists" }
];

const CONFIRMATION_SUCCESS_PATTERNS = [
  /\bthank\s+you\b.*\bpurchase\b/i,
  /\bgracias\s+por\s+su\s+compra\b/i,
  /\bcompra\s+exitosa\b/i,
  /\bpurchase\s+successful\b/i,
  /\border\s+confirmed\b/i,
  /\borden\s+confirmada\b/i,
  /\bpayment\s+successful\b/i,
  /\bpago\s+exitoso\b/i
];

const CONFIRMATION_DETAIL_FIELDS = ["id", "amount", "card number", "name", "date", "numero de orden", "monto", "tarjeta", "nombre", "fecha"];

const STRUCTURAL_KEYWORDS = [
  "tabla",
  "table",
  "lista",
  "list",
  "card",
  "cards",
  "modal",
  "dialog",
  "fila",
  "row",
  "contador",
  "count",
  "badge",
  "estado",
  "url"
];

const ASSERTION_LEADING_VERBS = [
  "validar", "verificar", "comprobar", "confirmar", "revisar",
  "esperar", "observar", "validate", "verify", "check", "assert", "wait for", "should see"
];

const WEAK_TOKENS = new Set([
  "de", "del", "la", "el", "los", "las", "en", "para", "con", "y", "a",
  "the", "of", "in", "on", "to", "for", "and",
  "detalle", "detalles", "detail", "details", "listado", "lista", "list", "listing",
  "pantalla", "screen", "page", "pagina", "página", "resumen", "summary",
  "confirmacion", "confirmación", "confirmation", "ticket", "receipt", "resultado", "result"
]);

const CONSUMPTION_NOISE_TOKENS = new Set([
  ...Array.from(WEAK_TOKENS),
  "visible", "visibles", "mostrar", "muestra", "muestran", "show", "shown",
  "boton", "botones", "button", "buttons",
  "opcion", "opciones", "option", "options",
  "campo", "campos", "field", "fields",
  "requerido", "requerida", "required", "disponible", "disponibles", "available",
  "actualizado", "actualizada", "updated"
]);

function tokenizeForConsumption(text: string): string[] {
  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length > 1 && !CONSUMPTION_NOISE_TOKENS.has(token));
}

function tokenCoverage(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bSet = new Set(b);
  const matched = a.filter((t) => bSet.has(t)).length;
  return matched / a.length;
}

function extractQuotedOrDelimitedFieldGroups(text: string): string[][] {
  const groups: string[][] = [];
  const quoted = Array.from(text.matchAll(/["']([^"']+)["']/g)).map((m) => tokenizeForConsumption(m[1] ?? ""));
  for (const tokens of quoted) {
    if (tokens.length > 0) groups.push(tokens);
  }
  if (groups.length > 0) return groups;

  const normalized = normalizeText(text);
  const split = normalized.split(/\s*(?:,| y | and )\s*/).map((part) => tokenizeForConsumption(part));
  const filtered = split.filter((tokens) => tokens.length > 0);
  return filtered.length > 1 ? filtered : [];
}

function detectAssertionConsumption(
  snapshot: PageSnapshot,
  assertionText: string,
  executedActions: Array<{ action: string; target: string; status: string }>,
  currentContext: AssertionContextType
): {
  consumed: boolean;
  decision?: "satisfied_by_action_executed" | "satisfied_by_fill_action" | "satisfied_by_form_field_presence" | "satisfied_by_structural_evidence";
  evidence?: string;
  consumedByAction?: string;
} {
  const normalizedAssertion = normalizeText(assertionText);
  const assertionTokens = tokenizeForConsumption(assertionText);
  const fieldGroups = extractQuotedOrDelimitedFieldGroups(assertionText);
  const visibleBlob = normalizeText(
    `${snapshot.title} ${snapshot.elements.map((e) => `${e.text ?? ""} ${e.label ?? ""} ${e.name ?? ""} ${e.placeholder ?? ""}`).join(" ")}`
  );
  const isFilterOrListAssertion = /\b(listado|catalogo|resultados?\s+filtrados?|filtrado|filtrados|actualizado|actualizada|categoria|category|filter|search)\b/.test(normalizedAssertion);
  const hasListSignals = snapshot.summary.tables > 0
    || snapshot.elements.some((el) => (el.type ?? "").toLowerCase() === "card")
    || snapshot.elements.some((el) => ["li", "tr"].includes((el.tagName ?? "").toLowerCase()));
  const hasInputs = snapshot.summary.inputs > 0 || snapshot.elements.some((el) => ["input", "select", "textarea"].includes((el.type ?? "").toLowerCase()));
  const hasDialog = snapshot.summary.dialogs > 0 || snapshot.elements.some((el) => ["dialog", "modal"].includes((el.type ?? "").toLowerCase()));
  const hasSuccessSignal = /\b(gracias|thank you|success|successful|confirmad|confirmad[ao]|completad[ao])\b/.test(visibleBlob);
  const likelyCloseAssertion = /\b(cerrar|close|ok|aceptar|accept|finalizar|continuar)\b/.test(normalizedAssertion)
    && /\b(confirmacion|confirmation|modal|dialog|resumen|success)\b/.test(normalizedAssertion);

  if (likelyCloseAssertion && !hasSuccessSignal) {
    return {
      consumed: false
    };
  }

  if ((currentContext === "form" || (hasInputs && hasDialog)) && assertionTokens.length > 0 && assertionTokens.some((t) => visibleBlob.includes(t))) {
    return {
      consumed: true,
      decision: "satisfied_by_form_field_presence",
      evidence: "active_form_contains_assertion_field"
    };
  }

  if (isFilterOrListAssertion && hasListSignals) {
    return {
      consumed: true,
      decision: "satisfied_by_structural_evidence",
      evidence: "filtered_or_updated_list_visible"
    };
  }

  if (currentContext === "detail" && /\b(add to cart|agregar al carrito|accion principal|primary action|boton|button)\b/i.test(normalizeText(assertionText))) {
    if (/add to cart|agregar al carrito/.test(visibleBlob)) {
      return {
        consumed: true,
        decision: "satisfied_by_structural_evidence",
        evidence: "detail_primary_action_visible"
      };
    }
  }

  if (currentContext === "confirmation" && /\b(close|cerrar|ok|aceptar|accept)\b/i.test(normalizeText(assertionText))) {
    return {
      consumed: true,
      decision: "satisfied_by_structural_evidence",
      evidence: "confirmation_closed_or_navigation_available"
    };
  }

  for (const action of executedActions) {
    if (action.status !== "found") continue;
    const actionText = normalizeText(`${action.action} ${action.target}`);
    const actionTokens = tokenizeForConsumption(`${action.action} ${action.target}`);
    const coverage = tokenCoverage(assertionTokens, actionTokens);
    const groupCoverage = fieldGroups.length > 0
      ? fieldGroups.every((group) => tokenCoverage(group, actionTokens) >= 0.5 || group.every((t) => visibleBlob.includes(t)))
      : false;
    const hasVisibleTarget = assertionTokens.length > 0 && assertionTokens.every((t) => visibleBlob.includes(t));

    if (/\bfill\b|\bllenar\b|\bescribir\b|\binput\b|\btype\b/.test(actionText) && (coverage >= 0.5 || hasVisibleTarget || groupCoverage)) {
      return {
        consumed: true,
        decision: "satisfied_by_fill_action",
        evidence: `fill_action:${action.target}`,
        consumedByAction: action.target
      };
    }
    if (/\bclick\b|\bselect\b|\bseleccionar\b|\btap\b|\bpress\b/.test(actionText) && (coverage >= 0.5 || hasVisibleTarget || groupCoverage)) {
      return {
        consumed: true,
        decision: "satisfied_by_action_executed",
        evidence: `action_executed:${action.target}`,
        consumedByAction: action.target
      };
    }
  }

  return { consumed: false };
}

function uniqueVisibleTexts(snapshot: PageSnapshot): string[] {
  const values = new Set<string>();
  if (snapshot.title && snapshot.title.trim()) {
    values.add(snapshot.title.trim());
  }
  for (const element of snapshot.elements) {
    for (const text of [element.text, element.label, element.name, element.placeholder, element.nearbyText]) {
      if (text && text.trim()) {
        values.add(text.trim());
      }
    }
  }
  return Array.from(values).slice(0, 50);
}

function buildClosestCandidates(snapshot: PageSnapshot, assertionText: string): AssertionResolutionResult["closestCandidates"] {
  const candidates: AssertionResolutionResult["closestCandidates"] = [];
  for (const element of snapshot.elements) {
    const texts = [element.text, element.label, element.name, element.placeholder].filter(Boolean) as string[];
    for (const text of texts) {
      const score = computeTokenScore(assertionText, text);
      if (score > 0) {
        candidates.push({ text, score, type: element.type });
      }
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function isTextVisible(snapshot: PageSnapshot, assertionText: string): { matchedText?: string; confidence: number; matchReason?: string } {
  const normalizedAssertion = normalizeText(assertionText);
  let bestMatch: { matchedText?: string; confidence: number; matchReason?: string } = { confidence: 0 };

  // Get aliases for back/return assertions
  const textsToMatch = isBackReturnAssertion(assertionText) 
    ? getBackReturnAliases(assertionText)
    : [assertionText];

  for (const visibleText of uniqueVisibleTexts(snapshot)) {
    const normalizedVisible = normalizeText(visibleText);
    
    // Try matching against each alias
    for (const textToMatch of textsToMatch) {
      const normalizedToMatch = normalizeText(textToMatch);
      let confidence = 0;
      let matchReason: string | undefined;

      if (normalizedVisible === normalizedToMatch) {
        confidence = 1;
        matchReason = textToMatch === assertionText ? "exact_match" : "alias_exact_match";
      } else if (normalizedVisible.includes(normalizedToMatch) || normalizedToMatch.includes(normalizedVisible)) {
        confidence = Math.max(0.85, computeTokenScore(textToMatch, visibleText));
        matchReason = textToMatch === assertionText ? "contains_match" : "alias_contains_match";
      } else {
        confidence = computeTokenScore(textToMatch, visibleText);
        if (isBackReturnAssertion(assertionText) && textToMatch !== assertionText) {
          matchReason = "alias_token_match";
        }
      }

      // Boost confidence for back/return alias matches
      if (isBackReturnAssertion(assertionText) && textToMatch !== assertionText && confidence > 0.5) {
        confidence = Math.min(0.95, confidence + 0.1);
        matchReason = matchReason ? `${matchReason}_boosted` : "alias_boosted";
      }

      if (confidence > bestMatch.confidence) {
        bestMatch = {
          matchedText: visibleText,
          confidence,
          matchReason
        };
      }
    }
  }

  return bestMatch;
}

function resolveStructuralAssertion(snapshot: PageSnapshot, assertionText: string): { passed: boolean; matchedText?: string; confidence: number; reason: string } {
  const normalized = normalizeText(assertionText);
  const hasTable = normalized.includes("tabla") || normalized.includes("table");
  const hasList = normalized.includes("lista") || normalized.includes("list") || normalized.includes("listado");
  const hasCard = normalized.includes("card");
  const hasModal = normalized.includes("modal") || normalized.includes("dialog");
  const hasUrl = normalized.includes("url");

  if (hasTable && snapshot.summary.tables > 0) {
    return { passed: true, confidence: 0.9, reason: "Table structure detected in snapshot." };
  }
  if (hasList && snapshot.elements.some((element) => element.type === "section" || element.type === "table" || element.type === "card")) {
    return { passed: true, confidence: 0.8, reason: "List-like structure detected in snapshot." };
  }
  if (hasCard && snapshot.elements.some((element) => element.type === "card")) {
    return { passed: true, confidence: 0.85, reason: "Card structure detected in snapshot." };
  }
  if (hasModal && snapshot.summary.dialogs > 0) {
    return { passed: true, confidence: 0.9, reason: "Dialog structure detected in snapshot." };
  }
  if (hasUrl && snapshot.url) {
    return { passed: true, matchedText: snapshot.url, confidence: 0.75, reason: "URL is observable and available." };
  }

  return {
    passed: false,
    confidence: 0.35,
    reason: "No structural indicator matched the assertion with enough confidence."
  };
}

function extractDescriptorTypes(assertionText: string): string[] {
  const normalized = normalizeText(assertionText);
  const types: string[] = [];
  for (const [type, keywords] of Object.entries(DESCRIPTOR_TYPE_KEYWORDS)) {
    if (keywords.some((keyword) => normalized.includes(normalizeText(keyword)))) {
      types.push(type);
    }
  }
  return types;
}

function extractSubject(assertionText: string): string {
  let text = normalizeText(assertionText);
  for (const verb of ASSERTION_LEADING_VERBS) {
    const pattern = new RegExp(`^${verb}\\s+`, "i");
    text = text.replace(pattern, "");
  }
  text = text
    .replace(/\b(?:que se visualice|que se muestre|que aparezca)\b/g, "")
    .replace(/\b(?:de|del|la|el|los|las)\b/g, " ")
    .replace(/\s*\/\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const descriptorTokens = Object.values(DESCRIPTOR_TYPE_KEYWORDS).flat().map((t) => normalizeText(t));
  const cleanedTokens = text
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !descriptorTokens.includes(token));

  return cleanedTokens.join(" ").trim();
}

function tokenizeStrongSubject(subject: string): string[] {
  return normalizeText(subject)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length > 2 && !WEAK_TOKENS.has(token));
}

function matchSubjectSignals(snapshot: PageSnapshot, subject: string): { matchedTexts: string[]; matchedTokens: string[]; confidence: number } {
  const visible = uniqueVisibleTexts(snapshot);
  const strongTokens = tokenizeStrongSubject(subject);
  if (strongTokens.length === 0) {
    return { matchedTexts: [], matchedTokens: [], confidence: 0 };
  }

  const matchedTexts: string[] = [];
  const matchedTokenSet = new Set<string>();
  for (const text of visible) {
    const normalizedVisible = normalizeText(text);
    const matchedInThisText = strongTokens.filter((token) => normalizedVisible.includes(token));
    if (matchedInThisText.length > 0) {
      matchedTexts.push(text);
      matchedInThisText.forEach((token) => matchedTokenSet.add(token));
    }
  }

  const matchedTokens = Array.from(matchedTokenSet);
  const tokenRatio = matchedTokens.length / strongTokens.length;
  const confidence = Math.min(0.95, tokenRatio * 0.9);
  return { matchedTexts: matchedTexts.slice(0, 5), matchedTokens, confidence };
}

export function classifyAssertion(assertionText: string, context?: AssertionContext): AssertionClassification {
  const normalized = normalizeText(assertionText);
  const hasChildren = (context?.childSignals?.length ?? 0) > 0;
  const hasDescriptor = DESCRIPTOR_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasStructuralKeyword = STRUCTURAL_KEYWORDS.some((keyword) => normalized.includes(keyword));
  const hasOptionalPrefix = /^(optional|opcional)\b/i.test(normalized);
  const isExpectedOnly = /^(?:(?:señales?|senales?)\s+esperadas?|expected\s+signals?)\b/i.test(normalized);
  const hasQuotedText = /['"][^'"]+['"]/.test(assertionText);
  const explicitLiteralIntent = /^(?:validar|verificar|comprobar|confirmar|esperar|wait for)\s+(?:que\s+se\s+muestre|que\s+este\s+visible|visible)/i.test(normalized);
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;

  const compoundFormFields = parseCompoundFormFieldsAssertion(assertionText);
  if (compoundFormFields) {
    return "compound_form_fields";
  }

  if (isFeedbackAssertion(assertionText)) {
    return "feedback_message";
  }

  if (isCatalogListAssertion(assertionText)) {
    return "catalog_list_assertion";
  }

  if (hasQuotedText || explicitLiteralIntent) {
    return "literal_observable";
  }

  if (hasOptionalPrefix) {
    return "optional_assertion";
  }
  if (isExpectedOnly) {
    return "expected_only";
  }
  if (!hasDescriptor && !hasStructuralKeyword && tokenCount <= 2) {
    return "literal_observable";
  }

  if (hasDescriptor) {
    return hasChildren ? "composite_assertion" : "semantic_descriptor";
  }

  if (hasStructuralKeyword) {
    return "structural_assertion";
  }

  const isGenericDescriptor = GENERIC_DESCRIPTOR_PATTERNS.some((pattern) => pattern.test(normalized));
  if (isGenericDescriptor) {
    return "semantic_descriptor";
  }

  if (normalized.split(/\s+/).length <= 1) {
    return "literal_observable";
  }

  if (normalized.length > 0) {
    return "literal_observable";
  }

  return "ambiguous_assertion";
}

function detectPrecondition(assertionText: string): { detected: boolean; precondition?: string } {
  const normalized = normalizeText(assertionText);
  for (const { pattern, precondition } of PRECONDITION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { detected: true, precondition };
    }
  }
  return { detected: false };
}

function isConfirmationSuccessMessage(assertionText: string): boolean {
  const normalized = normalizeText(assertionText);
  return CONFIRMATION_SUCCESS_PATTERNS.some(pattern => pattern.test(normalized));
}

function isConfirmationDetailField(assertionText: string): boolean {
  const normalized = normalizeText(assertionText);
  return CONFIRMATION_DETAIL_FIELDS.some(field => normalized.includes(field));
}

function buildCartExecutionState(executedActions: Array<{ action: string; target: string; status: string }>): CartExecutionState {
  const allText = executedActions.map((a) => `${a.action} ${a.target}`.toLowerCase());
  const has = (patterns: RegExp[]) => patterns.some((p) => allText.some((t) => p.test(t)));
  return {
    addToCartExecuted: has([/\badd to cart\b/i, /\bagregar\b.*\bcarrito\b/i]),
    productAddedToCart: has([/\badd to cart\b/i, /\bagregar\b.*\bcarrito\b/i, /\bproducto\b.*\bagregado\b/i]),
    cartOpened: has([/\bcart\b/i, /\bcarrito\b/i]),
    deleteExecuted: has([/\bdelete\b/i, /\beliminar\b/i, /\bremove\b/i, /\bquitar\b/i])
  };
}

function isCartAssertion(assertionText: string): boolean {
  const normalized = normalizeText(assertionText);
  if (/\bcarrito\b|\bcart\b/.test(normalized)) return true;
  return (/\btotal\b/.test(normalized) && /\bcarrito\b|\bcart\b/.test(normalized));
}

function isProductDetailAssertion(assertionText: string): boolean {
  const normalized = normalizeText(assertionText);
  return /\b(nombre del producto|product name|precio|price|descripcion|description|imagen|image|add to cart|agregar al carrito)\b/.test(normalized);
}

function inferRequiredContext(assertionText: string): AssertionContextType {
  const normalized = normalizeText(assertionText);
  if (/\bcarrito\b|\bcart\b|\bcheckout\b|\bsubtotal\b|\btotal\b/.test(normalized)) return "cart";
  if (/\bmodal\b|\bdialog\b|\bform\b|\bformulario\b|\bcampo\b|\bfield\b/.test(normalized)) return "form";
  if (/\bconfirm\w*\b|\bsuccess\b|\bexito\b|\bfinaliz\w*\b|\bcompletad\w*\b/.test(normalized)) return "confirmation";
  if (/\bdetalle\b|\bdetail\b|\bdescripcion\b|\bdescription\b|\bimagen\b|\bimage\b|\bprecio\b|\bprice\b/.test(normalized)) return "detail";
  if (/\bfiltro\b|\bfilter\b|\bcategoria\b|\bcategory\b|\bbusqueda\b|\bsearch\b|\bresultad\w*\b/.test(normalized)) return "filtered_list";
  if (/\blistado\b|\bcatalog\w*\b|\bproductos?\b|\bitems?\b|\bcards?\b/.test(normalized)) return "catalog";
  return "unknown";
}

function inferAssertionType(assertionText: string): "field" | "action" | "form" | "cart" | "confirmation" | "catalog" | "detail" | "navigation" | "unknown" {
  const normalized = normalizeText(assertionText);
  
  if (/\b(field|campo|input|checkbox|select|dropdown|username|password|email|phone|name|address|city|country|card number|credit card)\b/.test(normalized)) {
    return "field";
  }
  
  if (/\b(button|click|tap|press|submit|send|continue|next|back|cancel|ok|accept|close)\b/.test(normalized)) {
    return "action";
  }
  
  if (/\b(form|formulario|form field|compound field|multiple fields)\b/.test(normalized)) {
    return "form";
  }
  
  if (/\b(cart|carrito|shopping cart|checkout|subtotal|total|cart total)\b/.test(normalized)) {
    return "cart";
  }
  
  if (/\b(confirm|confirmation|success|thank you|completed|finalized|order confirmed|purchase successful)\b/.test(normalized)) {
    return "confirmation";
  }
  
  if (/\b(list|listing|catalog|catalogo|productos|items|cards|tabla|table|grid)\b/.test(normalized)) {
    return "catalog";
  }
  
  if (/\b(detail|detalle|description|descripcion|product detail|informacion de|producto)\b/.test(normalized)) {
    return "detail";
  }
  
  if (/\b(navigate|navigation|url|page|screen|pantalla|redirect|route)\b/.test(normalized)) {
    return "navigation";
  }
  
  return "unknown";
}

function inferCurrentContext(
  snapshot: PageSnapshot,
  executedActions: Array<{ action: string; target: string; status: string }>
): AssertionContextType {
  const visible = uniqueVisibleTexts(snapshot).map((t) => normalizeText(t));
  const hasCards = snapshot.elements.some((el) => (el.type ?? "").toLowerCase() === "card");
  const hasRows = snapshot.elements.some((el) => ["tr", "li"].includes((el.tagName ?? "").toLowerCase()) || (el.role ?? "").toLowerCase() === "row");
  const hasDialog = snapshot.summary.dialogs > 0 || snapshot.elements.some((el) => ["dialog", "modal"].includes((el.type ?? "").toLowerCase()));
  const hasInputs = snapshot.summary.inputs > 0 || snapshot.elements.some((el) => ["input", "select", "textarea"].includes((el.type ?? "").toLowerCase()));
  const hasHeading = snapshot.elements.some((el) => ["heading", "h1", "h2", "h3"].includes((el.type ?? "").toLowerCase()) || ["h1", "h2", "h3"].includes((el.tagName ?? "").toLowerCase()));
  const hasImage = snapshot.elements.some((el) => (el.tagName ?? "").toLowerCase() === "img" || (el.role ?? "").toLowerCase() === "img");
  const hasMoney = uniqueVisibleTexts(snapshot).some((t) => MONETARY_PATTERN.test(t));
  const hasAddToCart = visible.some((t) => /\badd to cart\b|\bagregar al carrito\b/i.test(t));
  const hasCartPageSignal = hasRows || visible.some((t) => /\bcheckout\b|\bsubtotal\b|\btotal\b|\bshopping cart\b|\bcarrito de compras\b/i.test(t));
  const hasSuccessSignal = visible.some((t) => /\bsuccess\b|\bconfirm\w*\b|\bgracias\b|\bcompletad\w*\b|\bfinalizad\w*\b/i.test(t));
  const hasAuthSignal = visible.some((t) => /\blogout\b|\bcerrar sesion\b|\bperfil\b|\bmenu\b|\bdashboard\b/i.test(t));
  const actionsText = executedActions.map((a) => normalizeText(`${a.action} ${a.target}`)).join(" ");

  if (hasSuccessSignal && /\bsubmit\b|\benviar\b|\bconfirm\b|\bfinalizar\b|\bcomprar\b|\bpagar\b/.test(actionsText)) return "confirmation";
  if ((hasDialog && hasInputs) || (hasInputs && snapshot.summary.buttons > 0)) return "form";
  if (hasCartPageSignal || /\bopen\b.*\bcart\b|\bver\b.*\bcarrito\b|\bir al carrito\b|\bcheckout\b/.test(actionsText)) return "cart";
  if ((hasHeading || hasImage || hasMoney || hasAddToCart) && /\bview\b|\bdetalle\b|\bselect\b|\bseleccionar\b|\bproduct\b|\bitem\b/.test(actionsText)) return "detail";
  if ((hasCards || hasRows) && /\bfilter\b|\bfiltro\b|\bcategoria\b|\bcategory\b|\bbusqueda\b|\bsearch\b/.test(actionsText)) return "filtered_list";
  if (hasCards || hasRows) return "catalog";
  if (hasAuthSignal) return "authenticated_area";
  return "unknown";
}

function isContextSatisfied(required: AssertionContextType, current: AssertionContextType): boolean {
  if (required === "unknown") return true;
  if (required === current) return true;
  if (required === "catalog" && (current === "catalog" || current === "filtered_list")) return true;
  return false;
}

function resolveProductDetailStructural(snapshot: PageSnapshot, assertionText: string): { passed: boolean; diagnostics: Record<string, unknown>; confidence: number } {
  const visible = uniqueVisibleTexts(snapshot).map((t) => normalizeText(t));
  const productNameVisible = snapshot.elements.some((el) => ["heading", "h1", "h2"].includes((el.type ?? "").toLowerCase()) || ["h1", "h2", "h3"].includes((el.tagName ?? "").toLowerCase()));
  const priceVisible = snapshot.elements.some((el) => MONETARY_PATTERN.test(`${el.text ?? ""} ${el.label ?? ""} ${el.name ?? ""}`));
  const descriptionVisible = snapshot.elements.some((el) => {
    const txt = normalizeText(`${el.text ?? ""} ${el.label ?? ""}`);
    return txt.length > 20 && !MONETARY_PATTERN.test(txt);
  });
  const imageVisible = snapshot.elements.some((el) => (el.tagName ?? "").toLowerCase() === "img" || (el.role ?? "").toLowerCase() === "img");
  const primaryActionVisible = visible.some((t) => /add to cart|agregar al carrito/.test(t));
  const wantsAny = isProductDetailAssertion(assertionText);
  const passed = wantsAny && (productNameVisible || priceVisible || descriptionVisible || imageVisible || primaryActionVisible);
  return {
    passed,
    confidence: passed ? 0.82 : 0.35,
    diagnostics: {
      productNameVisible,
      priceVisible,
      descriptionVisible,
      imageVisible,
      primaryActionVisible,
      reason: "product_detail_structure_detected"
    }
  };
}

const MONETARY_PATTERN = /(?:USD?\$|EUR|RD\$|\$)\s*\d[\d,.]*|\d[\d,.]*\s*(?:USD|EUR|RD\$)/i;

export type ExpectedResultConsumption = {
  originalText: string;
  classification: "executable_assertion" | "non_executable_criteria" | "covered_by_concrete_assertions";
  reason: string;
  coveredByAssertions?: string[];
  extractedQuotedTexts?: string[];
};

export type BuildConcreteAssertionsResult = {
  assertions: string[];
  expectedResultConsumption: ExpectedResultConsumption[];
  nonExecutableCriteria: string[];
};

const ABSTRACT_EXPECTED_PATTERNS = [
  /\bel\s+cliente\s+visualiza\b/i,
  /\bvisualiza\s+las\s+categor[aí]as\b/i,
  /\bcategor[aí]as\s+principales\b/i,
  /\bdisponibles\s+para\s+consulta\b/i,
  /\bconsulta\s+informativa\b/i,
  /\bflujo\s+permanece\b/i,
  /\bentorno\s+controlado\b/i,
  /\bsistema\s+muestra\b.*\bcorrectamente\b/i,
  /\binformacion\s+correctamente\b/i,
  /\bcorresponden\s+al\s+cat[aá]logo\b/i,
  /\boperacion\s+se\s+realiza\s+exitosamente\b/i,
  /\bexitosamente\b/i,
  /\busuario\s+puede\s+consultar\b/i,
  /\bpantalla\s+muestra\s+los\s+datos\s+solicitados\b/i,
  /\bdatos\s+solicitados\s+correctamente\b/i,
  /\bse\s+realiza\s+con\s+[eé]xito\b/i,
  /\bcompletado\s+con\s+[eé]xito\b/i,
  /\bcorrectamente\b/i
];

function isAbstractExpected(text: string): boolean {
  const normalized = normalizeText(text);
  return ABSTRACT_EXPECTED_PATTERNS.some((pattern) => pattern.test(normalized));
}

function extractQuotedTexts(text: string): string[] {
  const quoted: string[] = [];
  const matches = text.match(/["']([^"']+)["']/g);
  if (matches) {
    for (const match of matches) {
      const clean = match.replace(/^["']|["']$/g, "").trim();
      if (clean.length > 0) {
        quoted.push(clean);
      }
    }
  }
  return quoted;
}

export function buildConcreteAssertionsFromExpected(
  expectedTexts: string[],
  existingAssertions?: string[],
  _options?: Record<string, unknown>
): BuildConcreteAssertionsResult {
  const assertions: string[] = [];
  const expectedResultConsumption: ExpectedResultConsumption[] = [];
  const nonExecutableCriteria: string[] = [];

  for (const text of expectedTexts) {
    const trimmed = text.trim();
    if (!trimmed) continue;

    const consumption: ExpectedResultConsumption = {
      originalText: trimmed,
      classification: "executable_assertion",
      reason: "",
      coveredByAssertions: [],
      extractedQuotedTexts: []
    };

    // Check if abstract/non-observable
    if (isAbstractExpected(trimmed)) {
      // Check if covered by existing concrete assertions
      if (existingAssertions && existingAssertions.length > 0) {
        consumption.classification = "covered_by_concrete_assertions";
        consumption.reason = "Abstract expected result is semantically covered by concrete assertions from steps";
        consumption.coveredByAssertions = [...existingAssertions];
        nonExecutableCriteria.push(trimmed);
      } else {
        consumption.classification = "non_executable_criteria";
        consumption.reason = "Expected result contains abstract/non-observable language without concrete evidence";
        nonExecutableCriteria.push(trimmed);
      }
      expectedResultConsumption.push(consumption);
      continue;
    }

    // Extract quoted texts - these are concrete assertions
    const quotedTexts = extractQuotedTexts(trimmed);
    if (quotedTexts.length > 0) {
      consumption.extractedQuotedTexts = quotedTexts;
      consumption.reason = "Quoted texts extracted as concrete assertions";
      for (const quoted of quotedTexts) {
        if (!existingAssertions?.some((a) => normalizeText(a) === normalizeText(quoted))) {
          assertions.push(quoted);
        }
      }
      expectedResultConsumption.push(consumption);
      continue;
    }

    // Legacy behavior: classify and filter
    const classification = classifyAssertion(trimmed);
    if (classification === "literal_observable" || classification === "structural_assertion") {
      if (!existingAssertions?.some((a) => normalizeText(a) === normalizeText(trimmed))) {
        assertions.push(trimmed);
      }
      consumption.reason = `Classified as ${classification}`;
    } else {
      consumption.classification = "non_executable_criteria";
      consumption.reason = `Classified as ${classification} - not concrete enough for execution`;
      nonExecutableCriteria.push(trimmed);
    }
    expectedResultConsumption.push(consumption);
  }

  return {
    assertions,
    expectedResultConsumption,
    nonExecutableCriteria
  };
}

export function resolveAssertionTargets(
  snapshot: PageSnapshot,
  assertionTargets: AssertionTargetInput[],
  options?: {
    childSignalsByIndex?: Record<number, string[]>;
    executedActions?: Array<{ action: string; target: string; status: string }>;
    appConfig?: any; // app.config.json with assertionAliases/uiAliases
  }
): AssertionResolutionResult[] {
  const visibleTexts = uniqueVisibleTexts(snapshot);
  const results: AssertionResolutionResult[] = [];
  const executedActions = options?.executedActions ?? [];
  const currentContext = inferCurrentContext(snapshot, executedActions);
  let successMessageFound = false;
  const appConfig = options?.appConfig;

  // Helper: normalize text for comparison
  function normalizeForComparison(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Helper: extract target name from assertion like "Validar que el botón X esté visible"
  function extractAssertionTarget(assertion: string): { target: string; kind: "button" | "option" | "text" | "control" } {
    const patterns = [
      /validar que el botón "([^"]+)" esté visible/i,
      /validar que el botón "([^"]+)" est[á]?\s+/i,
      /validar que la opción "([^"]+)" est[á]?\s+/i,
      /validar que se muestre "([^"]+)"/i,
      /validar que "([^"]+)"/i
    ];
    for (const pattern of patterns) {
      const match = assertion.match(pattern);
      if (match) {
        // Determine kind from original assertion text
        let kind: "button" | "option" | "text" | "control" = "text";
        if (assertion.toLowerCase().includes("botón")) kind = "button";
        else if (assertion.toLowerCase().includes("opción")) kind = "option";
        else if (assertion.toLowerCase().includes("control")) kind = "control";
        return { target: match[1], kind };
      }
    }
    return { target: assertion, kind: "text" };
  }

  // Task 1: Classify assertions
  for (const assertion of assertionTargets) {
    const isPassiveVisibility = /validar que|assertion.*visible/i.test(assertion.action || assertion.target);
    if (isPassiveVisibility) {
      const { target, kind } = extractAssertionTarget(assertion.target);
      console.log(
        `[assertion] classified target="${target}" type=passive_visibility kind="${kind}"`
      );
    }
  }

  // First pass: detect if any confirmation success message is validated
  for (const assertion of assertionTargets) {
    if (isConfirmationSuccessMessage(assertion.target)) {
      const literalMatch = isTextVisible(snapshot, assertion.target);
      if (literalMatch.confidence >= 0.4) {
        successMessageFound = true;
        console.log(`[assertion-resolver] Success confirmation detected in first pass: "${assertion.target}" confidence=${literalMatch.confidence}`);
        break;
      }
    }
  }

  // Also check visible texts for success messages
  if (!successMessageFound) {
    const visibleTexts = uniqueVisibleTexts(snapshot);
    for (const text of visibleTexts) {
      if (isConfirmationSuccessMessage(text)) {
        successMessageFound = true;
        console.log(`[assertion-resolver] Success confirmation detected in snapshot text: "${text}"`);
        break;
      }
    }
  }

  return assertionTargets.map((assertion, index) => {
    const { target: extractedTarget, kind } = extractAssertionTarget(assertion.target);
    const isPassiveVisibility = /validar que|assertion.*visible/i.test(assertion.action || assertion.target);

    // Task 2 & 3: Resolve target with aliases
    console.log(`[assertion] resolving target="${extractedTarget}" candidates=${snapshot.elements?.length ?? 0}`);

    let bestMatch: { text: string; source: string; confidence: number } | null = null;

    // Try exact match first
    const normalizedTarget = normalizeForComparison(extractedTarget);
    const candidates: Array<{ text: string; source: string; confidence: number }> = [];

    for (const el of snapshot.elements || []) {
      const texts = [
        el.text,
        el.label,
        el.accessibleName,
        el.ariaLabel,
        el.title,
        el.placeholder,
        el.name
      ].filter(Boolean);

      for (const text of texts) {
        const normalizedText = normalizeForComparison(text);
        if (normalizedText === normalizedTarget) {
          const source = el.text === text ? "text" :
                        el.accessibleName === text ? "accessible_name" :
                        el.ariaLabel === text ? "aria_label" : "attribute";
          candidates.push({ text, source, confidence: 1.0 });
          if (!bestMatch || bestMatch.confidence < 1.0) {
            bestMatch = { text, source, confidence: 1.0 };
          }
        }
      }
    }

    // Task 3: Check app.config for aliases
    if (!bestMatch && appConfig) {
      const uiAliases = appConfig.uiAliases || appConfig.assertionAliases || {};
      const aliasForTarget = uiAliases[extractedTarget];
      if (aliasForTarget) {
        const normalizedAlias = normalizeForComparison(aliasForTarget);
        for (const el of snapshot.elements || []) {
          const texts = [el.text, el.label, el.accessibleName, el.ariaLabel].filter(Boolean);
          for (const text of texts) {
            const normalizedText = normalizeForComparison(text);
            if (normalizedText === normalizedAlias) {
              console.log(
                `[assertion] aliasResolved target="${extractedTarget}" alias="${aliasForTarget}" source=app_config confidence=0.95`
              );
              bestMatch = { text, source: "app_config_alias", confidence: 0.95 };
            }
          }
        }
      }
    }

    // Task 4: If passive visibility assertion and found match, pass
    if (isPassiveVisibility) {
      if (bestMatch) {
        console.log(
          `[assertion] passed target="${extractedTarget}" matched="${bestMatch.text}" source="${bestMatch.source}"`
        );
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification: "passive_visibility",
          status: "passed",
          matchedText: bestMatch.text,
          confidence: bestMatch.confidence,
          reason: `visibility_assertion_satisfied (${bestMatch.source})`,
          closestCandidates: candidates,
          visibleTexts
        } as any;
      } else if (candidates.length > 1) {
        // Task 4: Ambiguous candidates
        console.log(
          `[assertion] failed target="${extractedTarget}" reason=ambiguous_assertion_target candidates=${candidates.length}`
        );
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification: "passive_visibility",
          status: "failed",
          confidence: 0,
          reason: "ambiguous_assertion_target",
          closestCandidates: candidates,
          visibleTexts
        } as any;
      } else {
        // Task 5: Not found
        console.log(
          `[assertion] failed target="${extractedTarget}" reason=assertion_not_found`
        );
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification: "passive_visibility",
          status: "failed",
          confidence: 0,
          reason: "assertion_not_found",
          closestCandidates: candidates,
          visibleTexts
        } as any;
      }
    }

    // Continue with existing logic for non-passive assertions
    const childSignals = options?.childSignalsByIndex?.[assertion.index] ?? [];
    const classification = classifyAssertion(assertion.target, { childSignals });
    const normalized = normalizeText(assertion.target);
    const descriptorTypes = extractDescriptorTypes(assertion.target);
    const matchesGeneric = GENERIC_DESCRIPTOR_PATTERNS.some((pattern) => pattern.test(normalized));
    const matchesDetail = DETAIL_DESCRIPTOR_PATTERNS.some((pattern) => pattern.test(normalized)) && (descriptorTypes.includes("detail") || descriptorTypes.includes("screen") || descriptorTypes.includes("summary"));
    const isWeakSignal = matchesGeneric || matchesDetail;
    const closestCandidates = buildClosestCandidates(snapshot, assertion.target);
    const literalMatch = isTextVisible(snapshot, assertion.target);
    const subject = extractSubject(assertion.target);
    const subjectSignal = matchSubjectSignals(snapshot, subject);
    const structuralSignals: string[] = [];

    const cartState = buildCartExecutionState(executedActions);
    const precondition = detectPrecondition(assertion.target);
    const requiredContext = inferRequiredContext(assertion.target);
    const contextReached = isContextSatisfied(requiredContext, currentContext);
    const shouldDeferForContext = requiredContext !== "unknown" && executedActions.length > 0 && !contextReached;
    const consumption = detectAssertionConsumption(snapshot, assertion.target, executedActions, currentContext);

    if (consumption.consumed) {
      return {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: "satisfied_by_previous_assertion",
        matchedText: literalMatch.matchedText ?? closestCandidates[0]?.text,
        confidence: Math.max(0.78, literalMatch.confidence),
        reason: consumption.decision ?? "satisfied_by_action_executed",
        closestCandidates,
        visibleTexts,
        descriptorTypes,
        subject,
        matchedTokens: subjectSignal.matchedTokens,
        structuralSignals: [consumption.decision ?? "satisfied_by_action_executed"],
        assertionDiagnostics: {
          assertionConsumptionDiagnostics: {
            assertion: assertion.target,
            decision: consumption.decision,
            evidence: consumption.evidence,
            autoRepairAllowed: false
          }
        },
        expectedConsumption: {
          consumed: true,
          decision: consumption.decision,
          evidence: consumption.evidence,
          consumedByAction: consumption.consumedByAction
        },
        assertionType: inferAssertionType(assertion.target),
        ...(isWeakSignal ? { isWeakSignal: true } : {})
      };
    }

    if (classification === "catalog_list_assertion") {
      const catalogResult = resolveCatalogListAssertion(snapshot, assertion.target);
      const passed = !shouldDeferForContext && catalogResult.passed;
      const assertionDiagnostics: Record<string, unknown> = {
        resolver: catalogResult.resolver,
        assertion: catalogResult.assertion,
        matchedItems: catalogResult.matchedItems,
        evidence: catalogResult.evidence,
        catalogAssertionDiagnostics: catalogResult.diagnostics,
        assertionContextDiagnostics: {
          assertion: assertion.target,
          contextType: requiredContext,
          currentContext,
          decision: passed ? "structurally_satisfied" : (shouldDeferForContext ? "deferred_until_context" : "unresolved"),
          evidence: catalogResult.evidence,
          reason: passed ? "structural_evidence_found" : (shouldDeferForContext ? "required_context_not_reached" : "structural_evidence_missing")
        }
      };
      return {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: passed ? "passed" : "needs_assertion_resolution",
        matchedText: catalogResult.evidence[0],
        confidence: catalogResult.confidence,
        reason: passed ? "structurally_satisfied" : (shouldDeferForContext ? "assertion_context_not_reached" : "catalog_assertion_unresolved"),
        closestCandidates,
        visibleTexts,
        descriptorTypes,
        subject,
        matchedTokens: subjectSignal.matchedTokens,
        structuralSignals: passed ? ["catalog_assertion_structural"] : [],
        assertionDiagnostics,
        expectedConsumption: {
          consumed: false,
          decision: shouldDeferForContext ? "deferred_until_context" : "structural_evidence_missing",
          notConsumedReason: shouldDeferForContext ? "context_not_reached" : "structural_evidence_missing"
        },
        notConsumedReason: shouldDeferForContext ? "context_not_reached" : "structural_evidence_missing",
        assertionType: "catalog",
        ...(isWeakSignal && { isWeakSignal })
      };
    }

    if (isCartAssertion(assertion.target)) {
      const hasCartNavigationIntent = /\bcart\b|\bcarrito\b|\bcheckout\b/.test(
        executedActions.map((a) => normalizeText(`${a.action} ${a.target}`)).join(" ")
      );
      const setupDetected = cartState.addToCartExecuted || cartState.productAddedToCart;
      if (shouldDeferForContext && !hasCartNavigationIntent) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "needs_assertion_resolution",
          confidence: 0.8,
          reason: "assertion_context_not_reached",
          closestCandidates,
          visibleTexts,
          structuralSignals: ["assertion_context_not_reached"],
          assertionDiagnostics: {
            assertionContextDiagnostics: {
              assertion: assertion.target,
              decision: "deferred_until_context",
              requiredContext: "cart",
              currentContext,
              waitingForAction: "open_cart_or_selection_summary",
              reason: "required_context_not_reached"
            }
          },
          expectedConsumption: {
            consumed: false,
            decision: "deferred_until_context",
            notConsumedReason: "context_not_reached"
          },
          notConsumedReason: "context_not_reached",
          assertionType: "cart"
        };
      }
      if (!setupDetected) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification: "precondition_check",
          status: "precondition_unresolved",
          confidence: 0.92,
          reason: "cart_setup_missing",
          closestCandidates,
          visibleTexts,
          structuralSignals: ["cart_precondition_unresolved"],
          assertionDiagnostics: {
            cartDiagnostics: {
              setupDetected: false,
              addToCartExecuted: cartState.addToCartExecuted,
              cartOpened: cartState.cartOpened,
              rowCount: 0,
              totalVisible: false,
              deleteExecuted: cartState.deleteExecuted,
              reason: "missing_cart_setup"
            }
          },
          expectedConsumption: {
            consumed: false,
            decision: "precondition_unresolved",
            notConsumedReason: "precondition_unresolved"
          },
          notConsumedReason: "precondition_unresolved",
          assertionType: "cart"
        };
      }
      const rowCount = snapshot.elements.filter((el) => ["tr", "li"].includes((el.tagName ?? "").toLowerCase()) || (el.role ?? "").toLowerCase() === "row").length;
      const totalVisible = uniqueVisibleTexts(snapshot).some((t) => /\btotal\b/i.test(t) || MONETARY_PATTERN.test(t));
      const passed = rowCount > 0 || totalVisible;
      return {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: passed ? "passed" : "needs_assertion_resolution",
        confidence: passed ? 0.82 : 0.4,
        reason: passed ? "structurally_satisfied" : "cart_assertion_unresolved",
        closestCandidates,
        visibleTexts,
        structuralSignals: passed ? ["cart_assertion_structural"] : [],
        assertionDiagnostics: {
          assertionContextDiagnostics: {
            assertion: assertion.target,
            contextType: "cart",
            currentContext,
            decision: passed ? "structurally_satisfied" : "unresolved",
            evidence: [`rows:${rowCount}`, `totalVisible:${String(totalVisible)}`],
            reason: passed ? "structural_evidence_found" : "structural_evidence_missing"
          },
          cartDiagnostics: {
            setupDetected: true,
            addToCartExecuted: cartState.addToCartExecuted,
            cartOpened: cartState.cartOpened,
            rowCount,
            totalVisible,
            deleteExecuted: cartState.deleteExecuted,
            reason: passed ? "cart_structure_detected" : "cart_structure_not_detected"
          }
        }
      };
    }

    if (precondition.detected) {
      const relevantActions = executedActions.filter(a => 
        a.action.toLowerCase().includes("add") || 
        a.action.toLowerCase().includes("agregar") ||
        a.action.toLowerCase().includes("create") ||
        a.action.toLowerCase().includes("crear") ||
        a.action.toLowerCase().includes("login") ||
        a.action.toLowerCase().includes("submit")
      );
      if (relevantActions.length === 0 && precondition.precondition) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification: "precondition_check",
          status: "precondition_unresolved",
          confidence: 0.9,
          reason: `Precondition "${precondition.precondition}" was not established by previous steps. This assertion requires prior state setup.`,
          closestCandidates,
          visibleTexts,
          descriptorTypes,
          subject,
          matchedTokens: subjectSignal.matchedTokens,
          structuralSignals,
          assertionDiagnostics: {
            preconditionType: precondition.precondition,
            executedActionsCount: executedActions.length,
            relevantActionsCount: relevantActions.length,
            recommendation: "make_case_self_contained_or_add_setup_resolver"
          },
          ...(isWeakSignal ? { isWeakSignal: true } : {})
        };
      }
    }

    if (isProductDetailAssertion(assertion.target) && (classification === "semantic_descriptor" || classification === "literal_observable")) {
      if (shouldDeferForContext) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification: "semantic_descriptor",
          status: "needs_assertion_resolution",
          confidence: 0.8,
          reason: "assertion_context_not_reached",
          closestCandidates,
          visibleTexts,
          structuralSignals: ["assertion_context_not_reached"],
          assertionDiagnostics: {
            assertionContextDiagnostics: {
              assertion: assertion.target,
              decision: "deferred_until_context",
              requiredContext: "detail",
              currentContext,
              waitingForAction: "select_item_or_open_detail",
              reason: "required_context_not_reached"
            }
          }
        };
      }
      const detail = resolveProductDetailStructural(snapshot, assertion.target);
      if (detail.passed) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification: "structural_assertion",
          status: "passed",
          confidence: detail.confidence,
          reason: "structurally_satisfied",
          closestCandidates,
          visibleTexts,
          structuralSignals: ["product_detail_structural"],
          assertionDiagnostics: {
            assertionContextDiagnostics: {
              assertion: assertion.target,
              contextType: "detail",
              currentContext,
              decision: "structurally_satisfied",
              evidence: ["product_detail_structure_detected"],
              reason: "structural_evidence_found"
            },
            productDetailDiagnostics: detail.diagnostics
          }
        };
      }
    }
    
    const isConfirmationDetail = isConfirmationDetailField(assertion.target);
    const isConfirmationSuccess = isConfirmationSuccessMessage(assertion.target);
    
    if (isConfirmationSuccess && literalMatch.confidence >= 0.6) {
      successMessageFound = true;
    }
    
    if (isConfirmationDetail && successMessageFound && literalMatch.confidence < 0.6) {
      const hasStructuralMatch = closestCandidates.some(c => c.score >= 0.4);
      if (hasStructuralMatch) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "satisfied_by_previous_assertion",
          matchedText: closestCandidates[0]?.text,
          confidence: 0.7,
          reason: "Confirmation detail field validated structurally within successful confirmation context.",
          closestCandidates,
          visibleTexts,
          descriptorTypes,
          subject,
          matchedTokens: subjectSignal.matchedTokens,
          structuralSignals: ["confirmation_summary"],
          assertionDiagnostics: {
            satisfiedBy: "confirmation_summary",
            successMessageFound: true,
            structuralMatch: true
          },
          ...(isWeakSignal && { isWeakSignal })
        };
      }
    }
    
    const prevResults = results.slice(0, index);
    const equivalentPrev = prevResults.find(r => 
      r.status === "passed" && 
      normalizeText(r.assertionText) === normalized
    );
    
    if (equivalentPrev) {
      return {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: "satisfied_by_previous_assertion",
        matchedText: equivalentPrev.matchedText,
        confidence: equivalentPrev.confidence,
        reason: "Equivalent assertion was already validated.",
        closestCandidates,
        visibleTexts,
        descriptorTypes,
        subject,
        matchedTokens: subjectSignal.matchedTokens,
        structuralSignals,
        assertionDiagnostics: {
          satisfiedBy: "previous_success_message",
          equivalentAssertion: equivalentPrev.assertionText
        },
        ...(isWeakSignal && { isWeakSignal })
      };
    }

    if (classification === "literal_observable") {
      if (literalMatch.confidence >= 0.6 && literalMatch.matchedText) {
        // Add back/return alias diagnostics
        const isBackReturn = isBackReturnAssertion(assertion.target);
        const backReturnDiagnostics = isBackReturn ? {
          backReturnAliasMatch: {
            originalTarget: assertion.target,
            matchedTarget: literalMatch.matchedText,
            matchReason: literalMatch.matchReason || "back_return_alias"
          }
        } : {};
        
        const result = {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "passed" as const,
          matchedText: literalMatch.matchedText,
          confidence: literalMatch.confidence,
          reason: isBackReturn && literalMatch.matchReason?.includes("alias") 
            ? "Back/return assertion matched via semantic alias." 
            : "Observable text matched in the snapshot.",
          matchReason: literalMatch.matchReason,
          originalTarget: isBackReturn ? assertion.target : undefined,
          matchedTarget: isBackReturn && literalMatch.matchReason?.includes("alias") ? literalMatch.matchedText : undefined,
          closestCandidates,
          visibleTexts,
          descriptorTypes,
          subject,
          matchedTokens: subjectSignal.matchedTokens,
          structuralSignals,
          assertionType: inferAssertionType(assertion.target),
          assertionDiagnostics: isBackReturn ? backReturnDiagnostics : undefined,
          ...(isWeakSignal && { isWeakSignal })
        };
        results.push(result);
        return result;
      }

      // If success confirmation was validated and this is a confirmation detail field, mark as optional
      if (successMessageFound && isConfirmationDetail) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "optional_confirmation_detail_missing",
          matchedText: closestCandidates[0]?.text,
          confidence: 0.5,
          reason: "Confirmation detail field not found, but success confirmation was already validated. This detail is considered optional.",
          closestCandidates,
          visibleTexts,
          descriptorTypes,
          subject,
          matchedTokens: subjectSignal.matchedTokens,
          structuralSignals: ["confirmation_success_validated"],
          assertionDiagnostics: {
            successMessageFound: true,
            isConfirmationDetail: true,
            recommendation: "detail_optional_if_success_confirmed"
          },
          assertionType: inferAssertionType(assertion.target),
          ...(isWeakSignal && { isWeakSignal })
        };
      }

      // Add back/return alias diagnostics for failed assertions
      const isBackReturn = isBackReturnAssertion(assertion.target);
      const backReturnDiagnostics = isBackReturn ? {
        backReturnAliasAttempt: {
          originalTarget: assertion.target,
          attemptedAliases: getBackReturnAliases(assertion.target),
          bestMatch: literalMatch.matchedText,
          bestConfidence: literalMatch.confidence,
          matchReason: literalMatch.matchReason
        }
      } : {};

      const result = {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: "failed" as const,
        confidence: literalMatch.confidence,
        reason: isBackReturn && literalMatch.confidence >= 0.5
          ? "Back/return assertion partially matched but below threshold."
          : "Concrete observable text was not found in the snapshot.",
        matchReason: literalMatch.matchReason,
        originalTarget: isBackReturn ? assertion.target : undefined,
        matchedTarget: isBackReturn && literalMatch.matchedText ? literalMatch.matchedText : undefined,
        closestCandidates,
        visibleTexts,
        descriptorTypes,
        subject,
        matchedTokens: subjectSignal.matchedTokens,
        structuralSignals,
        assertionType: inferAssertionType(assertion.target),
        assertionDiagnostics: isBackReturn ? backReturnDiagnostics : undefined,
        ...(isWeakSignal && { isWeakSignal })
      };
      results.push(result);
      return result;
    }

    if (classification === "structural_assertion") {
      if (shouldDeferForContext) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "needs_assertion_resolution",
          confidence: 0.8,
          reason: "assertion_context_not_reached",
          closestCandidates,
          visibleTexts,
          descriptorTypes,
          subject,
          matchedTokens: subjectSignal.matchedTokens,
          structuralSignals: ["assertion_context_not_reached"],
          assertionDiagnostics: {
            assertionContextDiagnostics: {
              assertion: assertion.target,
              decision: "deferred_until_context",
              requiredContext,
              currentContext,
              waitingForAction: "reach_required_context",
              reason: "required_context_not_reached"
            }
          }
        };
      }
      const structural = resolveStructuralAssertion(snapshot, assertion.target);
      if (structural.passed) {
        structuralSignals.push(structural.reason);
      }
      return {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: structural.passed ? "passed" : "needs_assertion_resolution",
        matchedText: structural.matchedText,
        confidence: structural.confidence,
        reason: structural.passed ? "structurally_satisfied" : structural.reason,
        closestCandidates,
        visibleTexts,
        descriptorTypes,
        subject,
        matchedTokens: subjectSignal.matchedTokens,
        structuralSignals,
        ...(isWeakSignal && { isWeakSignal })
      };
    }


    if (classification === "feedback_message") {
      const feedbackResult = resolveFeedbackMessageAssertion(snapshot, assertion.target);
      if (feedbackResult.passed) {
        structuralSignals.push(`feedback_message: ${feedbackResult.capturedMessage?.type} captured`);
      }
      const assertionDiagnostics: Record<string, unknown> = {
        resolver: feedbackResult.resolver,
        assertion: feedbackResult.assertion,
        capturedMessage: feedbackResult.capturedMessage,
        evidence: feedbackResult.evidence,
      };
      return {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: feedbackResult.passed ? "passed" : "needs_assertion_resolution",
        matchedText: feedbackResult.capturedMessage?.text,
        confidence: feedbackResult.confidence,
        reason: feedbackResult.passed
          ? `Feedback message captured: ${feedbackResult.capturedMessage?.type} - "${feedbackResult.capturedMessage?.text?.slice(0, 50)}"`
          : `Feedback message not captured. ${feedbackResult.evidence.length > 0 ? feedbackResult.evidence.join("; ") : "No feedback messages detected."}`,
        closestCandidates,
        visibleTexts,
        descriptorTypes,
        subject,
        matchedTokens: subjectSignal.matchedTokens,
        structuralSignals,
        assertionDiagnostics,
        ...(isWeakSignal && { isWeakSignal })
      };
    }

    if (classification === "compound_form_fields") {
      const compoundResult = resolveCompoundFormFieldsAssertion(snapshot, assertion.target);
      if (compoundResult.passed) {
        structuralSignals.push(`compound_form_fields: ${compoundResult.satisfied.length} fields satisfied`);
      }
      const assertionDiagnostics: Record<string, unknown> = {
        resolver: compoundResult.resolver,
        assertion: compoundResult.assertion,
        fields: compoundResult.fields,
        satisfied: compoundResult.satisfied,
        missing: compoundResult.missing,
        evidence: compoundResult.evidence,
      };
      console.log(`[assertion-resolver] Compound form fields detected: fields=[${compoundResult.fields.join(", ")}]`);
      console.log(`[assertion-resolver] compound_form_fields result: satisfied=${compoundResult.satisfied.length} missing=${compoundResult.missing.length}`);
      return {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: compoundResult.passed ? "passed" : "needs_assertion_resolution",
        matchedText: compoundResult.evidence[0],
        confidence: compoundResult.confidence,
        reason: compoundResult.passed
          ? `Compound form fields validated: ${compoundResult.satisfied.length} fields visible.`
          : `Compound form fields validation failed. Missing: ${compoundResult.missing.join(", ")}. ${compoundResult.evidence.slice(0, 3).join("; ")}`,
        closestCandidates,
        visibleTexts,
        descriptorTypes,
        subject,
        matchedTokens: subjectSignal.matchedTokens,
        structuralSignals,
        assertionDiagnostics,
        ...(isWeakSignal && { isWeakSignal })
      };
    }

    if (classification === "optional_assertion" || classification === "expected_only") {
      return {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: "skipped_semantic_descriptor",
        confidence: 0.7,
        reason: "Optional/expected-only assertion treated as informational.",
        closestCandidates,
        visibleTexts,
        descriptorTypes,
        subject,
        matchedTokens: subjectSignal.matchedTokens,
        structuralSignals
      };
    }

    if (classification === "composite_assertion" || classification === "semantic_descriptor") {
      if (shouldDeferForContext && !isWeakSignal) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "needs_assertion_resolution",
          confidence: 0.8,
          reason: "assertion_context_not_reached",
          closestCandidates,
          visibleTexts,
          descriptorTypes,
          subject,
          matchedTokens: subjectSignal.matchedTokens,
          structuralSignals: ["assertion_context_not_reached"],
          assertionDiagnostics: {
            assertionContextDiagnostics: {
              assertion: assertion.target,
              decision: "deferred_until_context",
              requiredContext,
              currentContext,
              waitingForAction: "reach_required_context",
              reason: "required_context_not_reached"
            }
          },
          ...(isWeakSignal ? { isWeakSignal: true } : {})
        };
      }
      if (assertion.source === "expected" && isWeakSignal) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "skipped_semantic_descriptor",
          confidence: 0.6,
          reason: "Weak semantic descriptor from expected signals treated as non-blocking.",
          closestCandidates,
          visibleTexts,
          descriptorTypes,
          subject,
          matchedTokens: subjectSignal.matchedTokens,
          structuralSignals,
          ...(isWeakSignal && { isWeakSignal })
        };
      }
      if (childSignals.length > 0) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "satisfied_by_children",
          confidence: 0.85,
          reason: "Semantic descriptor resolved through concrete child signals.",
          closestCandidates,
          visibleTexts,
          descriptorTypes,
          subject,
          matchedTokens: subjectSignal.matchedTokens,
          structuralSignals,
          childAssertionsUsed: childSignals,
          ...(isWeakSignal && { isWeakSignal })
        };
      }

      const structural = resolveStructuralAssertion(snapshot, assertion.target);
      if (structural.passed) {
        structuralSignals.push(structural.reason);
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "passed",
          matchedText: structural.matchedText,
          confidence: Math.max(0.75, structural.confidence),
          reason: "structurally_satisfied",
          closestCandidates,
          visibleTexts,
          descriptorTypes,
          subject,
          matchedTokens: subjectSignal.matchedTokens,
          structuralSignals,
          ...(isWeakSignal && { isWeakSignal })
        };
      }

      if (subjectSignal.matchedTokens.length >= Math.max(1, Math.ceil(tokenizeStrongSubject(subject).length * 0.5))) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "passed",
          matchedText: subjectSignal.matchedTexts[0],
          confidence: Math.max(0.7, subjectSignal.confidence),
          reason: "structurally_satisfied",
          closestCandidates,
          visibleTexts,
          descriptorTypes,
          subject,
          matchedTokens: subjectSignal.matchedTokens,
          structuralSignals,
          ...(isWeakSignal && { isWeakSignal })
        };
      }

      if (assertion.source === "expected") {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "skipped_semantic_descriptor",
          confidence: 0.5,
          reason: "Expected-only semantic descriptor has insufficient direct evidence; skipped as non-blocking.",
          closestCandidates,
          visibleTexts,
          descriptorTypes,
          subject,
          matchedTokens: subjectSignal.matchedTokens,
          structuralSignals,
          ...(isWeakSignal && { isWeakSignal })
        };
      }

      return {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: "needs_assertion_resolution",
        confidence: Math.max(0.35, subjectSignal.confidence),
        reason: "Semantic descriptor has insufficient evidence from child signals, subject tokens, and structural indicators.",
        closestCandidates,
        visibleTexts,
        descriptorTypes,
        subject,
        matchedTokens: subjectSignal.matchedTokens,
        structuralSignals,
        expectedConsumption: {
          consumed: false,
          decision: "structural_evidence_missing",
          notConsumedReason: "structural_evidence_missing"
        },
        notConsumedReason: "structural_evidence_missing",
        assertionType: inferAssertionType(assertion.target),
        ...(isWeakSignal && { isWeakSignal })
      };
    }

    return {
      assertionText: assertion.target,
      normalizedAssertion: normalizeText(assertion.target),
      classification: "ambiguous_assertion",
      status: "needs_assertion_resolution",
      confidence: 0.3,
      reason: "Assertion could not be resolved confidently from snapshot evidence.",
      closestCandidates,
      visibleTexts,
      descriptorTypes,
      subject,
      matchedTokens: subjectSignal.matchedTokens,
      structuralSignals,
      expectedConsumption: {
        consumed: false,
        decision: "unknown",
        notConsumedReason: "unknown"
      },
      notConsumedReason: "unknown",
      assertionType: inferAssertionType(assertion.target),
      ...(isWeakSignal && { isWeakSignal })
    };
  });
}
