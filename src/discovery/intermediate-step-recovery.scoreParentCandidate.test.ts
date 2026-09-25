import assert from "node:assert/strict";
import test from "node:test";
import { scoreParentCandidate, selectBestParentCandidate } from "./intermediate-step-recovery";

/**
 * FIRST_LOSS (job f3740663-9a3c-42dd-b209-d591f2c97773, actionIndex=9, target="Categoría de
 * producto"): the old scoring used whole-string substring containment
 * (`candNorm.includes(token) || token.includes(candNorm)`), so target token "producto" matched
 * candidate "Solicitud multiproducto" purely because "multiproducto" contains "producto" as a
 * substring -- an unrelated top-level navigation link got clicked as a "parent" recovery
 * candidate, triggering the app's own unsaved-changes exit guard ("Salir del proceso de
 * solicitud"). Evidence must now come from whole, word-boundary-preserved tokens only.
 */

const targetTokens = ["categoria", "producto"]; // extractSignificantTokens("Categoría de producto")

test("1/substringFalsePositiveRejected. an unrelated candidate whose word merely CONTAINS a target token as a substring is rejected", () => {
  const result = scoreParentCandidate(targetTokens, "Categoría de producto", "Solicitud multiproducto");
  assert.equal(result, null);
});

test("2/exactTokenOverlapPreserved. a candidate sharing whole target tokens is admitted", () => {
  const result = scoreParentCandidate(targetTokens, "Categoría de producto", "Categoría de producto");
  assert.ok(result);
  assert.ok(result!.score > 0);
});

test("3/partialWordOnlyRejected. target token 'producto' vs candidate token 'multiproducto' (word-level, not substring) is rejected", () => {
  const result = scoreParentCandidate(["producto"], "Producto", "Multiproducto");
  assert.equal(result, null);
});

test("4/inversePartialWordRejected. target token 'multiproducto' vs candidate token 'producto' is rejected", () => {
  const result = scoreParentCandidate(["multiproducto"], "Multiproducto", "Producto");
  assert.equal(result, null);
});

test("5/genuinePrefixStillAdmitted. an actual semantic-parent-prefix relationship (not substring token overlap) is preserved unchanged", () => {
  // "Depósito" is a real whole-word stem of "Depósitos a plazo" -- the documented, legitimate case.
  const result = scoreParentCandidate(["depositos", "plazo"], "Depósitos a plazo", "Depósito");
  assert.ok(result);
  assert.equal(result!.reason, "semantic_parent_prefix");
});

test("6/noSharedTokensRejected. completely unrelated text with zero token overlap is rejected", () => {
  const result = scoreParentCandidate(targetTokens, "Categoría de producto", "Configuración de usuarios");
  assert.equal(result, null);
});

test("5/ambiguousTieFailsClosed. two candidates tied at the top score select nothing -- never array/order position", () => {
  const a = { id: "a", score: 0.8 };
  const b = { id: "b", score: 0.8 };
  const c = { id: "c", score: 0.5 };
  assert.equal(selectBestParentCandidate([a, b, c]), null);
  assert.equal(selectBestParentCandidate([b, a, c]), null, "order must not change the outcome");
});

test("5b/nonTiedTopSelectedUnambiguously. a clear top score is selected even with lower-scoring competitors present", () => {
  const a = { id: "a", score: 0.8 };
  const b = { id: "b", score: 0.5 };
  const result = selectBestParentCandidate([b, a]);
  assert.equal(result?.id, "a");
});

test("5c/emptyCandidatesFailClosed. no candidates at all selects nothing", () => {
  assert.equal(selectBestParentCandidate([]), null);
});
