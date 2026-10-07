import { test, expect } from "@playwright/test";
import { resolveEffectiveIntent } from "../src/scenarios/scenario-preview.service";

test("structured specific primary intent is preserved over generic model intent", () => {
  const effective = resolveEffectiveIntent("catalog_listing_flow", "generic");
  expect(effective).toBe("catalog_listing_flow");
});

test("generic primary intent falls back to structured model intent", () => {
  const effective = resolveEffectiveIntent("generic", "catalog_listing");
  expect(effective).toBe("catalog_listing");
});

test("specific primary intent is preserved over conflicting model intent", () => {
  const effective = resolveEffectiveIntent("payment_transfer", "catalog_listing");
  expect(effective).toBe("payment_transfer");
});
