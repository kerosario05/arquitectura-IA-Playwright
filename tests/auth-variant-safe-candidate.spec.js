"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const auth_variant_discovery_1 = require("../src/discovery/auth-variant-discovery");
(0, test_1.test)("TEST1 <a data-toggle tab> Variant B matches 3/3 pending", () => {
    const required = ["Organization ID", "User", "Password"];
    const before = ["User", "Password"];
    const candidates = [
        { variantLabel: "Variant A", sourceScreenKey: "s1", observedFieldsAfter: ["User", "Password"], role: "a", dataToggle: "tab" },
        { variantLabel: "Variant B", sourceScreenKey: "s1", observedFieldsAfter: ["Organization ID", "User", "Password"], role: "a", dataToggle: "tab" },
    ];
    // Both should be safe via data-toggle
    (0, test_1.expect)((0, auth_variant_discovery_1.isSafeVariantCandidate)({ role: "a", dataToggle: "tab" })).toBe(true);
    const selected = (0, auth_variant_discovery_1.selectPendingVariants)(required, before, candidates);
    (0, test_1.expect)(selected.length).toBe(1);
    (0, test_1.expect)(selected[0].variantLabel).toBe("Variant B");
    (0, test_1.expect)(selected[0].requiredFieldsMatched.length).toBe(3);
});
(0, test_1.test)("TEST2 <a href=/help> unsafe", () => {
    (0, test_1.expect)((0, auth_variant_discovery_1.isSafeVariantCandidate)({ role: "a", label: "Help" })).toBe(false);
    // also with href but no data-toggle
    (0, test_1.expect)((0, auth_variant_discovery_1.isSafeVariantCandidate)({ role: "a", dataToggle: undefined, ariaSelected: null })).toBe(false);
});
(0, test_1.test)("TEST3 <button>Submit</button> without selector structure unsafe", () => {
    (0, test_1.expect)((0, auth_variant_discovery_1.isSafeVariantCandidate)({ role: "button", label: "Submit" })).toBe(false);
    (0, test_1.expect)((0, auth_variant_discovery_1.isSafeVariantCandidate)({ role: "button", ariaSelected: null, dataToggle: undefined })).toBe(false);
});
(0, test_1.test)("TEST4 two variants both satisfy 3/3 ambiguous -> no persist", () => {
    const required = ["Organization ID", "User", "Password"];
    const before = ["User"];
    const candidates = [
        { variantLabel: "Variant A", sourceScreenKey: "s1", observedFieldsAfter: ["Organization ID", "User", "Password"], role: "tab" },
        { variantLabel: "Variant B", sourceScreenKey: "s1", observedFieldsAfter: ["Organization ID", "User", "Password"], role: "tab" },
    ];
    const selected = (0, auth_variant_discovery_1.selectPendingVariants)(required, before, candidates);
    (0, test_1.expect)(selected.length).toBe(0); // ambiguous
});
(0, test_1.test)("generic anchor <a data-toggle tab> supported, generic button still blocked", () => {
    (0, test_1.expect)((0, auth_variant_discovery_1.isSafeVariantCandidate)({ role: "a", dataToggle: "tab" })).toBe(true);
    (0, test_1.expect)((0, auth_variant_discovery_1.isSafeVariantCandidate)({ role: "a", dataToggle: "pill" })).toBe(true);
    (0, test_1.expect)((0, auth_variant_discovery_1.isSafeVariantCandidate)({ role: "button", ariaSelected: "true" })).toBe(true);
    (0, test_1.expect)((0, auth_variant_discovery_1.isSafeVariantCandidate)({ role: "button", parentRole: "tablist" })).toBe(true);
    (0, test_1.expect)((0, auth_variant_discovery_1.isSafeVariantCandidate)({ role: "button" })).toBe(false);
});
