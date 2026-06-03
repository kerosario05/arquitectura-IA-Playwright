"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const safe_data_context_1 = require("../src/agent/safe-data-context");
(0, test_1.test)("builds summary without exposing values", () => {
    const dataContext = {
        entries: [
            { key: "username", value: "user1", source: "test_data", sensitive: false },
            { key: "apiToken", value: "abc", source: "test_data", sensitive: true }
        ],
        counts: { total: 2, sensitive: 1, nonSensitive: 1 }
    };
    const summary = (0, safe_data_context_1.buildSafeDataContextSummary)(dataContext);
    (0, test_1.expect)(summary.totalEntries).toBe(2);
    (0, test_1.expect)(summary.availableKeys.some((entry) => entry.value)).toBe(false);
});
(0, test_1.test)("redacts sensitive-like keys", () => {
    const dataContext = {
        entries: [{ key: "payment_token", value: "x", source: "test_data", sensitive: true }],
        counts: { total: 1, sensitive: 1, nonSensitive: 0 }
    };
    const summary = (0, safe_data_context_1.buildSafeDataContextSummary)(dataContext);
    (0, test_1.expect)(summary.availableKeys[0].key).toContain("REDACTED_KEY");
});
(0, test_1.test)("allows username/password key names but marks sensitive", () => {
    const dataContext = {
        entries: [
            { key: "APP_USERNAME", value: "u", source: "app_username", sensitive: false },
            { key: "APP_PASSWORD", value: "p", source: "app_password", sensitive: true }
        ],
        counts: { total: 2, sensitive: 1, nonSensitive: 1 }
    };
    const summary = (0, safe_data_context_1.buildSafeDataContextSummary)(dataContext);
    (0, test_1.expect)(summary.availableKeys.find((entry) => entry.key === "APP_PASSWORD")?.sensitive).toBe(true);
});
