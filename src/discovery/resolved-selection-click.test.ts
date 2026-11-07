import assert from "node:assert/strict";
import test from "node:test";
import { shouldSkipClickAfterVerifiedSelection } from "./resolved-selection-click";

test("a resolver-applied and verified recorded option is not clicked a second time", () => {
  assert.equal(shouldSkipClickAfterVerifiedSelection({
    selectionApplied: true,
    selectionStateVerified: true,
    locatorStrategy: "selection_option_causal_surface",
  }), true);
});

test("unverified, unapplied, or non-option targets still dispatch their recorded click", () => {
  for (const input of [
    { selectionApplied: false, selectionStateVerified: true, locatorStrategy: "selection_option_causal_surface" },
    { selectionApplied: true, selectionStateVerified: false, locatorStrategy: "selection_option_causal_surface" },
    { selectionApplied: true, selectionStateVerified: true, locatorStrategy: "recorded:css" },
  ]) assert.equal(shouldSkipClickAfterVerifiedSelection(input), false);
});
