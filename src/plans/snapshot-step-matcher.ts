import type { PageSnapshot, SnapshotElement, SnapshotElementType } from "../types/page-snapshot.types";

export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapScore(a: string, b: string): number {
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function elementSearchText(element: SnapshotElement): string[] {
  return [element.text, element.label, element.placeholder, element.name, element.nearbyText, ...element.dataHints]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => normalizeMatchText(value));
}

export function findCandidateElementsForText(
  text: string,
  snapshot: PageSnapshot,
  preferredTypes?: SnapshotElementType[]
): Array<{ element: SnapshotElement; confidence: number; reason: string }> {
  const normalizedText = normalizeMatchText(text);
  if (!normalizedText) {
    return [];
  }

  const candidates = snapshot.elements.map((element) => {
    const searchTexts = elementSearchText(element);
    let score = 0;
    let reason = "no_match";

    for (const candidateText of searchTexts) {
      if (candidateText === normalizedText) {
        score = Math.max(score, 0.95);
        reason = "exact_match";
      } else if (candidateText.includes(normalizedText) || normalizedText.includes(candidateText)) {
        score = Math.max(score, 0.8);
        reason = "contains_match";
      } else {
        const overlap = tokenOverlapScore(normalizedText, candidateText);
        if (overlap >= 0.6) {
          score = Math.max(score, 0.65);
          reason = "token_overlap";
        }
      }
    }

    if (score < 0.6 && element.dataHints.some((hint) => normalizedText.includes(normalizeMatchText(hint)))) {
      score = Math.max(score, 0.6);
      reason = "data_hint_match";
    }

    if (preferredTypes?.includes(element.type)) {
      score = Math.min(1, score + 0.1);
    }
    if (element.disabled) {
      score -= 0.3;
    }
    if (!element.candidateLocators.length) {
      score -= 0.2;
    }
    if (element.type === "unknown") {
      score -= 0.1;
    }

    return { element, confidence: Math.max(0, Number(score.toFixed(2))), reason };
  });

  return candidates.filter((item) => item.confidence > 0).sort((a, b) => b.confidence - a.confidence);
}

export function findBestElementForStep(
  stepText: string,
  snapshot: PageSnapshot,
  preferredTypes?: SnapshotElementType[]
): {
  element?: SnapshotElement;
  confidence: number;
  reason: string;
} {
  const candidates = findCandidateElementsForText(stepText, snapshot, preferredTypes);
  if (candidates.length === 0) {
    return { confidence: 0, reason: "no_candidates" };
  }

  const [best, second] = candidates;
  if (second && Math.abs(best.confidence - second.confidence) < 0.05) {
    return { confidence: best.confidence, reason: "ambiguous_top_candidates" };
  }

  return {
    element: best.element,
    confidence: best.confidence,
    reason: best.reason
  };
}
