"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const testrail_input_requirements_adapter_1 = require("./testrail-input-requirements-adapter");
(0, vitest_1.describe)("TestRail input requirements adapter", () => {
    (0, vitest_1.it)("extracts requirements from approved markdown declarations", () => {
        const result = (0, testrail_input_requirements_adapter_1.extractTestRailInputRequirements)({
            id: 100,
            title: "Fixture",
            custom_preconds: "Customer id (customer.id, text)",
            custom_steps: "Use [customer.id]",
            custom_expected: "The result is shown",
        });
        (0, vitest_1.expect)(result.requirements).toEqual([{
                key: "customer.id",
                label: "Customer id",
                controlType: "text",
                required: true,
                sensitive: false,
                allowedValues: [],
            }]);
    });
    (0, vitest_1.it)("returns no requirements when markdown has no declarations", () => {
        const result = (0, testrail_input_requirements_adapter_1.extractTestRailInputRequirements)({
            id: 101,
            title: "Fixture",
            custom_preconds: "The user is authenticated",
            custom_steps: "Open the customer screen",
            custom_expected: "The customer is displayed",
        });
        (0, vitest_1.expect)(result.requirements).toEqual([]);
    });
    (0, vitest_1.it)("preserves parser conflicts for repeated keys with different metadata", () => {
        const result = (0, testrail_input_requirements_adapter_1.extractTestRailInputRequirements)({
            id: 102,
            title: "Fixture",
            custom_preconds: "Customer id (customer.id, text)\nSecret id (customer.id, secret)",
        });
        (0, vitest_1.expect)(result.requirements).toHaveLength(1);
        (0, vitest_1.expect)(result.conflicts).toHaveLength(1);
        (0, vitest_1.expect)(result.conflicts[0].key).toBe("customer.id");
    });
    (0, vitest_1.it)("does not infer requirements from natural language", () => {
        const result = (0, testrail_input_requirements_adapter_1.extractTestRailInputRequirements)({
            id: 103,
            title: "Fixture",
            custom_preconds: "Provide the password and user identifier",
            custom_steps_separated: [{ content: "Enter the RNC", expected: "Continue" }],
        });
        (0, vitest_1.expect)(result.requirements).toEqual([]);
        (0, vitest_1.expect)(result.conflicts).toEqual([]);
    });
});
