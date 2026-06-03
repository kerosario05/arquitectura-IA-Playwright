"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const generated_spec_filter_1 = require("../src/runner/generated-spec-filter");
(0, test_1.test)("normalizeAppProfile trims and lowercases", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.normalizeAppProfile)("  Saucedemo  ")).toBe("saucedemo");
});
(0, test_1.test)("normalizeAppProfile replaces spaces with underscores", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.normalizeAppProfile)("my app")).toBe("my_app");
});
(0, test_1.test)("normalizeAppProfile replaces special characters with underscores", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.normalizeAppProfile)("test-app!@#")).toBe("test_app");
});
(0, test_1.test)("normalizeAppProfile returns default for empty string", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.normalizeAppProfile)("")).toBe("default");
});
(0, test_1.test)("normalizeAppProfile returns default for undefined", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.normalizeAppProfile)(undefined)).toBe("default");
});
(0, test_1.test)("normalizeAppProfile returns default for whitespace-only", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.normalizeAppProfile)("   ")).toBe("default");
});
(0, test_1.test)("normalizeAppProfile handles already-normalized string", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.normalizeAppProfile)("kiosko")).toBe("kiosko");
});
(0, test_1.test)("getCurrentAppProfile returns default when APP_PROFILE not set", () => {
    delete process.env.APP_PROFILE;
    (0, test_1.expect)((0, generated_spec_filter_1.getCurrentAppProfile)()).toBe("default");
});
(0, test_1.test)("getCurrentAppProfile returns normalized value when APP_PROFILE set", () => {
    process.env.APP_PROFILE = "  Kiosko  ";
    try {
        (0, test_1.expect)((0, generated_spec_filter_1.getCurrentAppProfile)()).toBe("kiosko");
    }
    finally {
        delete process.env.APP_PROFILE;
    }
});
(0, test_1.test)("shouldRunGeneratedSpec: same profile returns true", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.shouldRunGeneratedSpec)({ specProfile: "kiosko", currentProfile: "kiosko" })).toBe(true);
});
(0, test_1.test)("shouldRunGeneratedSpec: different profile returns false", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.shouldRunGeneratedSpec)({ specProfile: "saucedemo", currentProfile: "kiosko" })).toBe(false);
});
(0, test_1.test)("shouldRunGeneratedSpec: missing spec profile with no current profile returns true (legacy)", () => {
    delete process.env.APP_PROFILE;
    (0, test_1.expect)((0, generated_spec_filter_1.shouldRunGeneratedSpec)({})).toBe(true);
});
(0, test_1.test)("shouldRunGeneratedSpec: missing spec profile with explicit current profile returns false", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.shouldRunGeneratedSpec)({ specProfile: undefined, currentProfile: "saucedemo" })).toBe(false);
});
(0, test_1.test)("shouldRunGeneratedSpec: default spec profile with no current profile returns true", () => {
    delete process.env.APP_PROFILE;
    (0, test_1.expect)((0, generated_spec_filter_1.shouldRunGeneratedSpec)({ specProfile: "default" })).toBe(true);
});
(0, test_1.test)("shouldRunGeneratedSpec: uses env APP_PROFILE when currentProfile not provided", () => {
    process.env.APP_PROFILE = "saucedemo";
    try {
        (0, test_1.expect)((0, generated_spec_filter_1.shouldRunGeneratedSpec)({ specProfile: "saucedemo" })).toBe(true);
        (0, test_1.expect)((0, generated_spec_filter_1.shouldRunGeneratedSpec)({ specProfile: "kiosko" })).toBe(false);
    }
    finally {
        delete process.env.APP_PROFILE;
    }
});
(0, test_1.test)("shouldRunGeneratedSpec: normalization handles case differences", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.shouldRunGeneratedSpec)({ specProfile: "Kiosko", currentProfile: "kiosko" })).toBe(true);
    (0, test_1.expect)((0, generated_spec_filter_1.shouldRunGeneratedSpec)({ specProfile: "SauceDemo", currentProfile: "saucedemo" })).toBe(true);
});
(0, test_1.test)("buildGeneratedSpecSkipReason returns undefined when profiles match", () => {
    (0, test_1.expect)((0, generated_spec_filter_1.buildGeneratedSpecSkipReason)({ specProfile: "kiosko", currentProfile: "kiosko" })).toBeUndefined();
});
(0, test_1.test)("buildGeneratedSpecSkipReason returns reason when profiles differ", () => {
    const reason = (0, generated_spec_filter_1.buildGeneratedSpecSkipReason)({ specProfile: "kiosko", currentProfile: "saucedemo" });
    (0, test_1.expect)(reason).toContain("kiosko");
    (0, test_1.expect)(reason).toContain("saucedemo");
    (0, test_1.expect)(reason).toContain("Skipped");
});
(0, test_1.test)("buildGeneratedSpecSkipReason includes both profiles in message", () => {
    const reason = (0, generated_spec_filter_1.buildGeneratedSpecSkipReason)({ specProfile: "kiosko", currentProfile: "saucedemo" });
    (0, test_1.expect)(reason).toContain("saucedemo");
    (0, test_1.expect)(reason).toContain("kiosko");
});
