"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const data_key_resolver_1 = require("../src/data/data-key-resolver");
(0, test_1.test)("TEST1 override 250 wins over suggested 100", () => {
    const r = (0, data_key_resolver_1.resolveDataKey)("field_a", {
        overrides: { field_a: "250" },
        suggestedData: { field_a: "100" },
        testData: {},
    });
    (0, test_1.expect)(r.status).toBe("resolved");
    (0, test_1.expect)(r.value).toBe("250");
    (0, test_1.expect)(r.source).toBe("dataOverrides");
});
(0, test_1.test)("TEST2 no override fallback to suggested 100", () => {
    const r = (0, data_key_resolver_1.resolveDataKey)("field_a", {
        suggestedData: { field_a: "100" },
        testData: {},
    });
    (0, test_1.expect)(r.value).toBe("100");
    (0, test_1.expect)(r.source).toBe("suggestedValue");
});
(0, test_1.test)("TEST3 isolation two scenarios", () => {
    const ra = (0, data_key_resolver_1.resolveDataKey)("field_a", { overrides: { field_a: "250" } });
    const rb = (0, data_key_resolver_1.resolveDataKey)("field_a", { overrides: { field_a: "500" } });
    (0, test_1.expect)(ra.value).toBe("250");
    (0, test_1.expect)(rb.value).toBe("500");
    (0, test_1.expect)(ra.value).not.toBe(rb.value);
});
(0, test_1.test)("secret masking preserved", () => {
    const r = (0, data_key_resolver_1.resolveDataKey)("password", { overrides: { password: "supersecret123" } });
    (0, test_1.expect)(r.masked).toBe(true);
    // ensure no hardcode key check
    const r2 = (0, data_key_resolver_1.resolveDataKey)("generic_field", { overrides: { generic_field: "value123" } });
    (0, test_1.expect)(r2.value).toBe("value123");
});
