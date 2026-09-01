import { test, expect } from "@playwright/test";
import { isSafeVariantCandidate, selectPendingVariants } from "../src/discovery/auth-variant-discovery";

test("TEST1 <a data-toggle tab> Variant B matches 3/3 pending", () => {
  const required = ["Organization ID","User","Password"];
  const before = ["User","Password"];
  const candidates: any[] = [
    { variantLabel:"Variant A", sourceScreenKey:"s1", observedFieldsAfter:["User","Password"], role:"a", dataToggle:"tab" },
    { variantLabel:"Variant B", sourceScreenKey:"s1", observedFieldsAfter:["Organization ID","User","Password"], role:"a", dataToggle:"tab" },
  ];
  // Both should be safe via data-toggle
  expect(isSafeVariantCandidate({ role:"a", dataToggle:"tab"} as any)).toBe(true);
  const selected = selectPendingVariants(required, before, candidates as any);
  expect(selected.length).toBe(1);
  expect(selected[0].variantLabel).toBe("Variant B");
  expect(selected[0].requiredFieldsMatched.length).toBe(3);
});

test("TEST2 <a href=/help> unsafe", () => {
  expect(isSafeVariantCandidate({ role:"a", label:"Help"} as any)).toBe(false);
  // also with href but no data-toggle
  expect(isSafeVariantCandidate({ role:"a", dataToggle: undefined, ariaSelected: null } as any)).toBe(false);
});

test("TEST3 <button>Submit</button> without selector structure unsafe", () => {
  expect(isSafeVariantCandidate({ role:"button", label:"Submit"} as any)).toBe(false);
  expect(isSafeVariantCandidate({ role:"button", ariaSelected: null, dataToggle: undefined } as any)).toBe(false);
});

test("TEST4 two variants both satisfy 3/3 ambiguous -> no persist", () => {
  const required = ["Organization ID","User","Password"];
  const before = ["User"];
  const candidates: any[] = [
    { variantLabel:"Variant A", sourceScreenKey:"s1", observedFieldsAfter:["Organization ID","User","Password"], role:"tab" },
    { variantLabel:"Variant B", sourceScreenKey:"s1", observedFieldsAfter:["Organization ID","User","Password"], role:"tab" },
  ];
  const selected = selectPendingVariants(required, before, candidates as any);
  expect(selected.length).toBe(0); // ambiguous
});

test("generic anchor <a data-toggle tab> supported, generic button still blocked", () => {
  expect(isSafeVariantCandidate({ role:"a", dataToggle:"tab"} as any)).toBe(true);
  expect(isSafeVariantCandidate({ role:"a", dataToggle:"pill"} as any)).toBe(true);
  expect(isSafeVariantCandidate({ role:"button", ariaSelected:"true"} as any)).toBe(true);
  expect(isSafeVariantCandidate({ role:"button", parentRole:"tablist"} as any)).toBe(true);
  expect(isSafeVariantCandidate({ role:"button"} as any)).toBe(false);
});
