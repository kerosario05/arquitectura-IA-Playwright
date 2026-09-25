/**
 * Decides which label-like DOM candidate, if any, is the field-owner's real caption —
 * the exact algorithm the browser-injected `nearestFieldGroupLabel` (web-session-recorder.ts)
 * runs in-page. Defined here, stringified via `.toString()`, and interpolated into the capture
 * script (the same pattern already used for `classifyActionability`/
 * `normalizeStructuralOwnerIdentity`) so the SAME logic is both real inside a live recording and
 * independently unit-testable in Node, without needing a browser/jsdom.
 *
 * Must stay self-contained: `.toString()` only captures the function body, not any outer
 * closure — it may not reference anything from web-session-recorder.ts's own scope.
 */
export function selectSemanticFieldOwnerLabel(
  candidates: readonly { textContent?: string | null }[],
): {
  /** Candidates whose own caption is non-empty after collapsing whitespace and trimming. */
  semanticCandidates: { textContent?: string | null }[];
  /** The resolved caption text, present only when reason is "resolved". */
  chosenText?: string;
  reason: "resolved" | "no_candidate_labels" | "label_empty" | "multiple_candidate_labels";
} {
  const clean = (value: unknown): string => String(value || "").replace(/\s+/g, " ").trim();
  const semanticCandidates = candidates.filter((candidate) => clean(candidate.textContent));
  if (semanticCandidates.length === 1) {
    return { semanticCandidates, chosenText: clean(semanticCandidates[0].textContent), reason: "resolved" };
  }
  if (semanticCandidates.length === 0) {
    return { semanticCandidates, reason: candidates.length === 0 ? "no_candidate_labels" : "label_empty" };
  }
  return { semanticCandidates, reason: "multiple_candidate_labels" };
}

export const SELECT_SEMANTIC_FIELD_OWNER_LABEL_SOURCE = `(${selectSemanticFieldOwnerLabel.toString()})`;
