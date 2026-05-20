import { expect, test } from "@playwright/test";
import { isPotentiallySensitiveText, sanitizeSnapshotText, sanitizeVisibleText } from "../src/explorer/snapshot-sanitizer";

test("normalizes whitespace and trims", () => {
  expect(sanitizeVisibleText("  hola   mundo  ")).toBe("hola mundo");
});

test("long text is truncated", () => {
  const text = "a".repeat(240);
  const sanitized = sanitizeSnapshotText(text);
  expect(sanitized.length).toBeLessThanOrEqual(203);
  expect(sanitized.endsWith("...")).toBe(true);
});

test("detects password token secret patterns", () => {
  expect(isPotentiallySensitiveText("temporary password here")).toBe(true);
  expect(isPotentiallySensitiveText("bearer token value")).toBe(true);
});

test("detects long sensitive digit chains", () => {
  expect(isPotentiallySensitiveText("1234 5678 9012 3456")).toBe(true);
});

test("handles empty string", () => {
  expect(sanitizeSnapshotText("")).toBe("");
  expect(isPotentiallySensitiveText("")).toBe(false);
});
