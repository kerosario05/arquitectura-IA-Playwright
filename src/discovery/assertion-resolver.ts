import { computeTokenScore, normalizeText } from "./target-resolver";
import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";

export type AssertionClassification =
  | "literal_observable"
  | "semantic_descriptor"
  | "composite_assertion"
  | "structural_assertion"
  | "expected_only"
  | "optional_assertion"
  | "ambiguous_assertion";

export type AssertionResolutionStatus =
  | "passed"
  | "failed"
  | "skipped_semantic_descriptor"
  | "satisfied_by_children"
  | "needs_assertion_resolution"
  | "needs_approval";

export type AssertionTargetInput = {
  index: number;
  action: string;
  target: string;
  source: "action" | "expected";
};

export type AssertionResolutionResult = {
  assertionText: string;
  normalizedAssertion: string;
  classification: AssertionClassification;
  status: AssertionResolutionStatus;
  matchedText?: string;
  confidence: number;
  reason: string;
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

function isTextVisible(snapshot: PageSnapshot, assertionText: string): { matchedText?: string; confidence: number } {
  const normalizedAssertion = normalizeText(assertionText);
  let bestMatch: { matchedText?: string; confidence: number } = { confidence: 0 };

  for (const visibleText of uniqueVisibleTexts(snapshot)) {
    const normalizedVisible = normalizeText(visibleText);
    let confidence = 0;

    if (normalizedVisible === normalizedAssertion) {
      confidence = 1;
    } else if (normalizedVisible.includes(normalizedAssertion) || normalizedAssertion.includes(normalizedVisible)) {
      confidence = Math.max(0.85, computeTokenScore(assertionText, visibleText));
    } else {
      confidence = computeTokenScore(assertionText, visibleText);
    }

    if (confidence > bestMatch.confidence) {
      bestMatch = {
        matchedText: visibleText,
        confidence
      };
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

export function buildConcreteAssertionsFromExpected(
  expectedTexts: string[],
  _options?: Record<string, unknown>
): string[] {
  return expectedTexts
    .map((text) => text.trim())
    .filter(Boolean)
    .filter((text) => {
      const classification = classifyAssertion(text);
      return classification === "literal_observable" || classification === "structural_assertion";
    });
}

export function resolveAssertionTargets(
  snapshot: PageSnapshot,
  assertionTargets: AssertionTargetInput[],
  options?: {
    childSignalsByIndex?: Record<number, string[]>;
  }
): AssertionResolutionResult[] {
  const visibleTexts = uniqueVisibleTexts(snapshot);

  return assertionTargets.map((assertion) => {
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

    if (classification === "literal_observable") {
      if (literalMatch.confidence >= 0.6 && literalMatch.matchedText) {
        return {
          assertionText: assertion.target,
          normalizedAssertion: normalizeText(assertion.target),
          classification,
          status: "passed",
          matchedText: literalMatch.matchedText,
          confidence: literalMatch.confidence,
          reason: "Observable text matched in the snapshot.",
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
        status: "failed",
        confidence: literalMatch.confidence,
        reason: "Concrete observable text was not found in the snapshot.",
        closestCandidates,
        visibleTexts,
        descriptorTypes,
        subject,
        matchedTokens: subjectSignal.matchedTokens,
        structuralSignals,
        ...(isWeakSignal && { isWeakSignal })
      };
    }

    if (classification === "structural_assertion") {
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
        reason: structural.reason,
        closestCandidates,
        visibleTexts,
        descriptorTypes,
        subject,
        matchedTokens: subjectSignal.matchedTokens,
        structuralSignals,
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
          reason: "Semantic descriptor satisfied by structural signals.",
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
          reason: "Semantic descriptor satisfied by strong subject token evidence.",
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
      ...(isWeakSignal && { isWeakSignal })
    };
  });
}
