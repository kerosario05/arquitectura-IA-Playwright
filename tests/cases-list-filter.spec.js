"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
function normalizeStatusFilter(value) {
    if (!value || value === "all")
        return "all";
    if (value === "automated")
        return "automated";
    if (value === "not-automated" || value === "not_automated")
        return "not_automated";
    throw new Error("Invalid status. Expected one of: all, automated, not-automated, not_automated");
}
function matchesStatusFilter(status, filter) {
    if (filter === "all")
        return true;
    if (filter === "automated")
        return status !== "not_automated" && status !== "different_profile";
    return status === filter;
}
(0, test_1.test)("normalizeStatusFilter: undefined returns all", () => {
    (0, test_1.expect)(normalizeStatusFilter(undefined)).toBe("all");
});
(0, test_1.test)("normalizeStatusFilter: empty string returns all", () => {
    (0, test_1.expect)(normalizeStatusFilter("")).toBe("all");
});
(0, test_1.test)("normalizeStatusFilter: 'all' returns all", () => {
    (0, test_1.expect)(normalizeStatusFilter("all")).toBe("all");
});
(0, test_1.test)("normalizeStatusFilter: 'automated' returns automated", () => {
    (0, test_1.expect)(normalizeStatusFilter("automated")).toBe("automated");
});
(0, test_1.test)("normalizeStatusFilter: 'not-automated' returns not_automated", () => {
    (0, test_1.expect)(normalizeStatusFilter("not-automated")).toBe("not_automated");
});
(0, test_1.test)("normalizeStatusFilter: 'not_automated' returns not_automated", () => {
    (0, test_1.expect)(normalizeStatusFilter("not_automated")).toBe("not_automated");
});
(0, test_1.test)("normalizeStatusFilter: invalid value throws clear error", () => {
    (0, test_1.expect)(() => normalizeStatusFilter("invalid")).toThrow("Invalid status. Expected one of: all, automated, not-automated, not_automated");
});
(0, test_1.test)("normalizeStatusFilter: 'pending' throws clear error", () => {
    (0, test_1.expect)(() => normalizeStatusFilter("pending")).toThrow("Invalid status. Expected one of: all, automated, not-automated, not_automated");
});
(0, test_1.test)("matchesStatusFilter: all matches not_automated", () => {
    (0, test_1.expect)(matchesStatusFilter("not_automated", "all")).toBe(true);
});
(0, test_1.test)("matchesStatusFilter: all matches active", () => {
    (0, test_1.expect)(matchesStatusFilter("active", "all")).toBe(true);
});
(0, test_1.test)("matchesStatusFilter: all matches draft", () => {
    (0, test_1.expect)(matchesStatusFilter("draft", "all")).toBe(true);
});
(0, test_1.test)("matchesStatusFilter: automated matches active", () => {
    (0, test_1.expect)(matchesStatusFilter("active", "automated")).toBe(true);
});
(0, test_1.test)("matchesStatusFilter: automated matches draft", () => {
    (0, test_1.expect)(matchesStatusFilter("draft", "automated")).toBe(true);
});
(0, test_1.test)("matchesStatusFilter: automated matches disabled", () => {
    (0, test_1.expect)(matchesStatusFilter("disabled", "automated")).toBe(true);
});
(0, test_1.test)("matchesStatusFilter: automated does NOT match not_automated", () => {
    (0, test_1.expect)(matchesStatusFilter("not_automated", "automated")).toBe(false);
});
(0, test_1.test)("matchesStatusFilter: not_automated matches only not_automated", () => {
    (0, test_1.expect)(matchesStatusFilter("not_automated", "not_automated")).toBe(true);
    (0, test_1.expect)(matchesStatusFilter("active", "not_automated")).toBe(false);
    (0, test_1.expect)(matchesStatusFilter("draft", "not_automated")).toBe(false);
    (0, test_1.expect)(matchesStatusFilter("disabled", "not_automated")).toBe(false);
    (0, test_1.expect)(matchesStatusFilter("different_profile", "not_automated")).toBe(false);
});
(0, test_1.test)("matchesStatusFilter: automated does NOT match different_profile", () => {
    (0, test_1.expect)(matchesStatusFilter("different_profile", "automated")).toBe(false);
});
(0, test_1.test)("matchesStatusFilter: different_profile matches all", () => {
    (0, test_1.expect)(matchesStatusFilter("different_profile", "all")).toBe(true);
});
