import { computeTokenScore, normalizeText } from "./target-resolver";
import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";

export type AssertionClassification =
  | "literal_observable"
  | "semantic_descriptor"
  | "composite_assertion"
  | "structural_assertion"
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
  /\bconfirmar resultados?\b/
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

export function classifyAssertion(assertionText: string, context?: AssertionContext): AssertionClassification {
  const normalized = normalizeText(assertionText);
  const hasChildren = (context?.childSignals?.length ?? 0) > 0;
  const hasDescriptor = DESCRIPTOR_PATTERNS.some((pattern) => pattern.test(normalized));
  const hasStructuralKeyword = STRUCTURAL_KEYWORDS.some((keyword) => normalized.includes(keyword));

  if (hasDescriptor) {
    return hasChildren ? "composite_assertion" : "semantic_descriptor";
  }

  if (hasStructuralKeyword) {
    return "structural_assertion";
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
    const closestCandidates = buildClosestCandidates(snapshot, assertion.target);
    const literalMatch = isTextVisible(snapshot, assertion.target);

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
          visibleTexts
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
        visibleTexts
      };
    }

    if (classification === "structural_assertion") {
      const structural = resolveStructuralAssertion(snapshot, assertion.target);
      return {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: structural.passed ? "passed" : "needs_assertion_resolution",
        matchedText: structural.matchedText,
        confidence: structural.confidence,
        reason: structural.reason,
        closestCandidates,
        visibleTexts
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
          visibleTexts
        };
      }

      return {
        assertionText: assertion.target,
        normalizedAssertion: normalizeText(assertion.target),
        classification,
        status: "needs_assertion_resolution",
        confidence: 0.4,
        reason: "Semantic descriptor has no concrete child signals to validate with confidence.",
        closestCandidates,
        visibleTexts
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
      visibleTexts
    };
  });
}
