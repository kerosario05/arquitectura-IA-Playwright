import { test, expect } from "@playwright/test";
import { resolveDataKey } from "../src/data/data-key-resolver";

test("TEST1 override 250 wins over suggested 100", () => {
  const r = resolveDataKey("field_a", {
    overrides: { field_a: "250" },
    suggestedData: { field_a: "100" },
    testData: {},
  } as any);
  expect(r.status).toBe("resolved");
  expect(r.value).toBe("250");
  expect(r.source).toBe("dataOverrides");
});

test("TEST2 no override fallback to suggested 100", () => {
  const r = resolveDataKey("field_a", {
    suggestedData: { field_a: "100" },
    testData: {},
  } as any);
  expect(r.value).toBe("100");
  expect(r.source).toBe("suggestedValue");
});

test("TEST3 isolation two scenarios", () => {
  const ra = resolveDataKey("field_a", { overrides: { field_a: "250" } } as any);
  const rb = resolveDataKey("field_a", { overrides: { field_a: "500" } } as any);
  expect(ra.value).toBe("250");
  expect(rb.value).toBe("500");
  expect(ra.value).not.toBe(rb.value);
});

test("secret masking preserved", () => {
  const r = resolveDataKey("password", { overrides: { password: "supersecret123" } } as any);
  expect(r.masked).toBe(true);
  // ensure no hardcode key check
  const r2 = resolveDataKey("generic_field", { overrides: { generic_field: "value123" } } as any);
  expect(r2.value).toBe("value123");
});
