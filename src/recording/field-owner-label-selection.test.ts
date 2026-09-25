import assert from "node:assert/strict";
import test from "node:test";
import { selectSemanticFieldOwnerLabel } from "./field-owner-label-selection";

/**
 * Physical diagnostic evidence (recording 14144564-e60f-4ac8-b4a8-65ac1ecf1f05, the
 * "Número de identificación" masked field): `nearestFieldGroupLabel`'s ancestor-level-1 check
 * found candidateLabelCount=2 — one real `<label>` with the field's actual caption, and one
 * empty decorative `span[class*="label"]` (a floating-label wrapper with no text yet) — and
 * rejected the level as `multiple_candidate_labels`, even though there was really only ONE
 * semantically meaningful label. The raw label-like element count was used for the
 * ambiguity/cardinality decision BEFORE any check of whether each candidate actually had a
 * caption.
 *
 * Fixed by extracting the decision into `selectSemanticFieldOwnerLabel`, shared (via
 * `.toString()` interpolation, the same pattern `classifyActionability`/
 * `normalizeStructuralOwnerIdentity` already use) between this real, independently-testable
 * module and the browser-injected `nearestFieldGroupLabel` in web-session-recorder.ts. Only
 * candidates whose caption is non-empty after collapsing whitespace and trimming count toward
 * the 0/1/>1 decision; raw candidates (including empty ones) are still preserved separately in
 * the diagnostic trace for observability, never for the decision itself.
 *
 * The strings used below ("Número de identificación", etc.) are fixtures only, matching the
 * ticket's own physical evidence shape — never hardcoded into production code (verified: the
 * production function takes plain `{ textContent }` candidates and contains no field names).
 */

test("1. one field + real label + empty decorative label -> resolved to the real label", () => {
  const result = selectSemanticFieldOwnerLabel([
    { textContent: "Número de identificación" },
    { textContent: "" },
  ]);
  assert.equal(result.reason, "resolved");
  assert.equal(result.chosenText, "Número de identificación");
  assert.equal(result.semanticCandidates.length, 1, "the empty decorative label must never count toward cardinality");
});

test("2. one field + whitespace-only decorative label -> resolved to the real label", () => {
  const result = selectSemanticFieldOwnerLabel([
    { textContent: "Número de identificación" },
    { textContent: "   \n\t  " },
  ]);
  assert.equal(result.reason, "resolved");
  assert.equal(result.chosenText, "Número de identificación");
});

test("3. one field + two non-empty labels -> unresolved, multiple_candidate_labels", () => {
  const result = selectSemanticFieldOwnerLabel([
    { textContent: "Número de identificación" },
    { textContent: "Tipo de identificación" },
  ]);
  assert.equal(result.reason, "multiple_candidate_labels");
  assert.equal(result.chosenText, undefined);
  assert.equal(result.semanticCandidates.length, 2);
});

test("4. one field + only an empty label -> unresolved, label_empty (a raw candidate existed but carried no caption)", () => {
  const result = selectSemanticFieldOwnerLabel([{ textContent: "" }]);
  assert.equal(result.reason, "label_empty");
  assert.equal(result.chosenText, undefined);
});

test("4b. one field + zero raw label candidates at all -> unresolved, no_candidate_labels", () => {
  const result = selectSemanticFieldOwnerLabel([]);
  assert.equal(result.reason, "no_candidate_labels");
});

test("regression: three or more raw candidates where only one is semantic still resolves cleanly", () => {
  const result = selectSemanticFieldOwnerLabel([
    { textContent: "" },
    { textContent: "   " },
    { textContent: "Número de identificación" },
    { textContent: null },
  ]);
  assert.equal(result.reason, "resolved");
  assert.equal(result.chosenText, "Número de identificación");
});

test("regression: whitespace differences alone never manufacture two distinct semantic candidates from the same real label", () => {
  // Two raw label-like elements, but this function only ever sees them as independent
  // candidates -- it does not deduplicate identical text. This documents that behavior stays
  // unchanged (deduplication is out of this ticket's scope; only empty-caption exclusion is in
  // scope), so two real, distinct-source labels sharing text still correctly count as ambiguous.
  const result = selectSemanticFieldOwnerLabel([
    { textContent: "Número de identificación" },
    { textContent: "Número de identificación" },
  ]);
  assert.equal(result.reason, "multiple_candidate_labels");
});
