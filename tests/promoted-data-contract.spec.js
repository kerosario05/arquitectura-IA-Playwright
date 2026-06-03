"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promoted_data_1 = require("../src/data/promoted-data");
const basePlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "manual", title: "Generic form" },
    requiredData: [
        { key: "customer_name", required: true, resolved: true },
        { key: "password_key", required: true, resolved: true, sensitive: true }
    ],
    steps: [
        { index: 1, action: "fill", target: { strategy: "label", value: "Customer Name" }, valueKey: "customer_name" },
        { index: 2, action: "fill", target: { strategy: "label", value: "Password" }, valueKey: "password_key" }
    ],
    createdAt: new Date().toISOString()
};
const baseContext = {
    entries: [
        { key: "customer_name", value: "Alice QA", source: "test_data", sensitive: false },
        { key: "password_key", value: "S3cret!", source: "environment_variable", sensitive: true }
    ],
    counts: { total: 2, sensitive: 1, nonSensitive: 1 }
};
(0, test_1.test)("manifest incluye keys usadas y required=true", () => {
    const manifest = (0, promoted_data_1.buildPromotedDataManifest)(basePlan, baseContext);
    (0, test_1.expect)(manifest.entries.map((e) => e.key)).toEqual(["customer_name", "password_key"]);
    (0, test_1.expect)(manifest.entries.every((e) => e.required)).toBe(true);
});
(0, test_1.test)("manifest no persiste secretos reales y conserva maskedValue", () => {
    const manifest = (0, promoted_data_1.buildPromotedDataManifest)(basePlan, baseContext);
    const secret = manifest.entries.find((e) => e.key === "password_key");
    (0, test_1.expect)(secret?.value).toBeUndefined();
    (0, test_1.expect)(secret?.maskedValue).toBeTruthy();
    (0, test_1.expect)(secret?.maskedValue).not.toContain("S3cret!");
});
(0, test_1.test)("runtime hydration resuelve key directa y error claro cuando falta required", () => {
    const manifest = (0, promoted_data_1.buildPromotedDataManifest)(basePlan, baseContext);
    const hydrated = (0, promoted_data_1.buildPromotedDataContext)({
        baseDataContext: { entries: [], counts: { total: 0, sensitive: 0, nonSensitive: 0 } },
        manifest,
        testDataProfile: "qa",
        autoGenerateTestData: false
    });
    (0, test_1.expect)((0, promoted_data_1.requirePromotedData)(hydrated, "customer_name", { fieldName: "Customer Name", stepIndex: 1 })).toBe("Alice QA");
    (0, test_1.expect)(() => (0, promoted_data_1.requirePromotedData)(hydrated, "password_key", { fieldName: "Password", stepIndex: 2 })).toThrow(/Missing required promoted data key "password_key"/);
});
(0, test_1.test)("runtime hydration genera fallback demo-safe cuando perfil lo permite", () => {
    const demoPlan = {
        ...basePlan,
        requiredData: [{ key: "order_name", required: true, resolved: false }],
        steps: [{ index: 1, action: "fill", target: { strategy: "label", value: "Order Name" }, valueKey: "order_name" }]
    };
    const manifest = (0, promoted_data_1.buildPromotedDataManifest)(demoPlan, { entries: [], counts: { total: 0, sensitive: 0, nonSensitive: 0 } });
    const hydrated = (0, promoted_data_1.buildPromotedDataContext)({
        baseDataContext: { entries: [], counts: { total: 0, sensitive: 0, nonSensitive: 0 } },
        manifest,
        testDataProfile: "demo",
        autoGenerateTestData: true
    });
    const value = (0, promoted_data_1.requirePromotedData)(hydrated, "order_name");
    (0, test_1.expect)(value.length).toBeGreaterThan(0);
});
(0, test_1.test)("data keys se convierten a nombres TS validos y deduplicados", () => {
    (0, test_1.expect)((0, promoted_data_1.toSafeTsVariableName)("orden_nombre")).toBe("ordenNombre");
    (0, test_1.expect)((0, promoted_data_1.toSafeTsVariableName)("payment.amount")).toBe("paymentAmount");
    (0, test_1.expect)((0, promoted_data_1.toSafeTsVariableName)("user-email")).toBe("userEmail");
    const map = (0, promoted_data_1.buildDataKeyVariableMap)(["user-email", "user_email"]);
    (0, test_1.expect)(map.get("user-email")).toBe("userEmail");
    (0, test_1.expect)(map.get("user_email")).toBe("userEmail2");
});
