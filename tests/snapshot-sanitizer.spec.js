"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const snapshot_sanitizer_1 = require("../src/explorer/snapshot-sanitizer");
(0, test_1.test)("normalizes whitespace and trims", () => {
    (0, test_1.expect)((0, snapshot_sanitizer_1.sanitizeVisibleText)("  hola   mundo  ")).toBe("hola mundo");
});
(0, test_1.test)("long text is truncated", () => {
    const text = "a".repeat(240);
    const sanitized = (0, snapshot_sanitizer_1.sanitizeSnapshotText)(text);
    (0, test_1.expect)(sanitized.length).toBeLessThanOrEqual(203);
    (0, test_1.expect)(sanitized.endsWith("...")).toBe(true);
});
(0, test_1.test)("detects password token secret patterns", () => {
    (0, test_1.expect)((0, snapshot_sanitizer_1.isPotentiallySensitiveText)("temporary password here")).toBe(true);
    (0, test_1.expect)((0, snapshot_sanitizer_1.isPotentiallySensitiveText)("bearer token value")).toBe(true);
});
(0, test_1.test)("detects long sensitive digit chains", () => {
    (0, test_1.expect)((0, snapshot_sanitizer_1.isPotentiallySensitiveText)("1234 5678 9012 3456")).toBe(true);
});
(0, test_1.test)("handles empty string", () => {
    (0, test_1.expect)((0, snapshot_sanitizer_1.sanitizeSnapshotText)("")).toBe("");
    (0, test_1.expect)((0, snapshot_sanitizer_1.isPotentiallySensitiveText)("")).toBe(false);
});
