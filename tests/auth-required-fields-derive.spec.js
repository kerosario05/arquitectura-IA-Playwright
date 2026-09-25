"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const auth_variant_discovery_1 = require("../src/discovery/auth-variant-discovery");
(0, test_1.test)("TEST1 auth fields before business excluded", () => {
    const scenario = {
        authIntent: "full_authentication",
        authFields: ["Organization ID", "User", "Password"],
        businessFields: ["Transfers"],
    };
    const fields = (0, auth_variant_discovery_1.deriveRequiredAuthFields)({ scenario });
    (0, test_1.expect)(fields).toEqual(test_1.expect.arrayContaining(["Organization ID", "User", "Password"]));
    (0, test_1.expect)(fields).not.toContain("Transfers");
    (0, test_1.expect)(fields.length).toBe(3);
});
(0, test_1.test)("TEST2 requiredData contains auth fields not in prerequisite", () => {
    const scenario = {
        authIntent: "full_authentication",
        dataRequirements: [
            { label: "FieldA", source: "hu_model", kind: "auth", scope: "authentication" },
            { label: "FieldB", source: "hu_model", kind: "input", scope: "authentication" },
        ],
        steps: ['Clic en "Transfers"'],
    };
    const huDeclaredItems = [];
    const fields = (0, auth_variant_discovery_1.deriveRequiredAuthFields)({ scenario, huDeclaredItems });
    (0, test_1.expect)(fields.length).toBeGreaterThan(0);
    (0, test_1.expect)(fields).toEqual(test_1.expect.arrayContaining(["FieldA", "FieldB"]));
});
(0, test_1.test)("TEST3 business Amount/Destination/Comment not contaminate", () => {
    const scenario = {
        authIntent: "full_authentication",
        authFields: ["Organization ID", "User", "Password"],
        businessFields: ["Amount", "Destination", "Comment"],
        steps: ['Ingresar "Organization ID"', 'Clic en "Transfers"'],
    };
    const fields = (0, auth_variant_discovery_1.deriveRequiredAuthFields)({ scenario });
    (0, test_1.expect)(fields).not.toContain("Amount");
    (0, test_1.expect)(fields).not.toContain("Destination");
    (0, test_1.expect)(fields).not.toContain("Comment");
    (0, test_1.expect)(fields).toEqual(test_1.expect.arrayContaining(["Organization ID", "User", "Password"]));
});
(0, test_1.test)("AA-95 regression without structured source now failClosed", () => {
    const scenario = {
        authIntent: "full_authentication",
        steps: ['Clic en "Transferencias"'],
    };
    const huDeclaredItems = [
        { category: "branch", sourceText: "transferencias" },
        { category: "branch", sourceText: "cuentas propias" },
    ];
    const fields = (0, auth_variant_discovery_1.deriveRequiredAuthFields)({ scenario, huDeclaredItems });
    (0, test_1.expect)(fields.length).toBe(0); // no structured auth source → failClosed, gap reported
});
