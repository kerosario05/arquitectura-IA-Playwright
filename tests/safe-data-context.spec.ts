import { expect, test } from "@playwright/test";
import { buildSafeDataContextSummary } from "../src/agent/safe-data-context";
import type { DataContext } from "../src/data/data-context";

test("builds summary without exposing values", () => {
  const dataContext: DataContext = {
    entries: [
      { key: "username", value: "user1", source: "test_data", sensitive: false },
      { key: "apiToken", value: "abc", source: "test_data", sensitive: true }
    ],
    counts: { total: 2, sensitive: 1, nonSensitive: 1 }
  };

  const summary = buildSafeDataContextSummary(dataContext);
  expect(summary.totalEntries).toBe(2);
  expect(summary.availableKeys.some((entry) => (entry as unknown as { value?: string }).value)).toBe(false);
});

test("redacts sensitive-like keys", () => {
  const dataContext: DataContext = {
    entries: [{ key: "payment_token", value: "x", source: "test_data", sensitive: true }],
    counts: { total: 1, sensitive: 1, nonSensitive: 0 }
  };
  const summary = buildSafeDataContextSummary(dataContext);
  expect(summary.availableKeys[0].key).toContain("REDACTED_KEY");
});

test("allows username/password key names but marks sensitive", () => {
  const dataContext: DataContext = {
    entries: [
      { key: "APP_USERNAME", value: "u", source: "app_username", sensitive: false },
      { key: "APP_PASSWORD", value: "p", source: "app_password", sensitive: true }
    ],
    counts: { total: 2, sensitive: 1, nonSensitive: 1 }
  };
  const summary = buildSafeDataContextSummary(dataContext);
  expect(summary.availableKeys.find((entry) => entry.key === "APP_PASSWORD")?.sensitive).toBe(true);
});
