import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "@playwright/test";
import { resolveRecordedStructuralSemanticFallback } from "./promoted-spec-runtime";

const target = {
  structuralContext: { owner: { tag: "span", role: "combobox" }, scopeIdentity: { strategy: "id", value: "pv_id_94" } },
} as any;
const refs = ["role:combobox|Select an option"];

function pageWithMatches(count: number): Page {
  const locator = { count: async () => count, isVisible: async () => true, isEnabled: async () => true };
  return { getByRole: () => locator } as unknown as Page;
}

test("a captured scope that no longer exists (0 matches) admits the unique exact semantic ref", async () => {
  const resolved = await resolveRecordedStructuralSemanticFallback(pageWithMatches(1), target, refs, "scoped_scope_not_unique", 0);
  assert.equal(resolved?.strategy, "recorded:role-semantic-compatibility");
});

test("an ambiguous scope (several matches) or an unrelated reason still fails closed", async () => {
  assert.equal(await resolveRecordedStructuralSemanticFallback(pageWithMatches(1), target, refs, "scoped_scope_not_unique", 2), undefined);
  assert.equal(await resolveRecordedStructuralSemanticFallback(pageWithMatches(1), target, refs, "scoped_scope_not_unique"), undefined);
  assert.equal(await resolveRecordedStructuralSemanticFallback(pageWithMatches(1), target, refs, "owner_not_deterministic", 0), undefined);
});

test("with a vanished scope the semantic ref must still resolve to exactly one control", async () => {
  assert.equal(await resolveRecordedStructuralSemanticFallback(pageWithMatches(2), target, refs, "scoped_scope_not_unique", 0), undefined);
  assert.equal(await resolveRecordedStructuralSemanticFallback(pageWithMatches(0), target, refs, "scoped_scope_not_unique", 0), undefined);
});
