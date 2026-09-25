"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const testrail_requirement_converter_1 = require("./testrail-requirement-converter");
(0, vitest_1.describe)("TestRail requirement converter", () => {
    (0, vitest_1.it)("returns a proposed result for declared requirements", () => {
        const result = (0, testrail_requirement_converter_1.convertTestRailRequirements)({
            caseId: 201,
            rawCase: {
                id: 201,
                title: "Fixture",
                custom_preconds: "Customer id (customer.id, text)",
                custom_steps: "Use [customer.id]",
            },
        });
        (0, vitest_1.expect)(result).toMatchObject({ caseId: 201, status: "proposed", requiresApproval: true });
        (0, vitest_1.expect)(result.requirements).toHaveLength(1);
        (0, vitest_1.expect)(result.unresolvedPlaceholders).toEqual([]);
    });
    (0, vitest_1.it)("reports namespace placeholders without declarations", () => {
        const result = (0, testrail_requirement_converter_1.convertTestRailRequirements)({
            caseId: 202,
            rawCase: { id: 202, title: "Fixture", custom_steps: "Use [auth.username] and [not-a-placeholder]" },
        });
        (0, vitest_1.expect)(result.status).toBe("empty");
        (0, vitest_1.expect)(result.requirements).toEqual([]);
        (0, vitest_1.expect)(result.unresolvedPlaceholders).toEqual(["auth.username"]);
    });
    (0, vitest_1.it)("returns empty for a case without requirements", () => {
        const result = (0, testrail_requirement_converter_1.convertTestRailRequirements)({
            caseId: 203,
            rawCase: { id: 203, title: "Fixture", custom_expected: "The operation succeeds" },
        });
        (0, vitest_1.expect)(result).toMatchObject({ caseId: 203, requirements: [], unresolvedPlaceholders: [], conflicts: [], status: "empty", requiresApproval: true });
    });
    (0, vitest_1.it)("preserves parser conflicts", () => {
        const result = (0, testrail_requirement_converter_1.convertTestRailRequirements)({
            caseId: 204,
            rawCase: {
                id: 204,
                title: "Fixture",
                custom_preconds: "Customer id (customer.id, text)\nSecret id (customer.id, secret)",
            },
        });
        (0, vitest_1.expect)(result.status).toBe("conflict");
        (0, vitest_1.expect)(result.conflicts).toHaveLength(1);
        (0, vitest_1.expect)(result.conflicts[0].key).toBe("customer.id");
    });
});
