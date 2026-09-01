import { test, expect } from "@playwright/test";
import { resolveEffectiveIntent } from "../src/scenarios/scenario-preview.service";

test("high-confidence specific primary intent is preserved over heuristic model", () => {
  const effective = resolveEffectiveIntent("catalog_listing_flow", "high", "balance_inquiry");
  expect(effective).toBe("catalog_listing_flow");
});

test("unknown primary intent falls back to heuristic model", () => {
  const effective = resolveEffectiveIntent("unknown_flow", "low", "catalog_listing");
  expect(effective).toBe("catalog_listing");
});

test("high-confidence specific non-catalog primary intent is preserved", () => {
  const effective = resolveEffectiveIntent("payment_transfer", "high", "catalog_listing");
  expect(effective).toBe("payment_transfer");
});