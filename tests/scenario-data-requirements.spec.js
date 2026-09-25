"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_data_requirements_1 = require("../src/scenarios/scenario-data-requirements");
(0, test_1.test)("TEST1 Amount=100 Reference=ABC123", () => {
    const reqs = (0, scenario_data_requirements_1.deriveDataRequirements)({
        huText: 'Capturar Amount con 100 y Capturar Reference con ABC123',
        explicitFields: [
            { label: "Amount", suggestedValue: "100", source: "hu_explicit" },
            { label: "Reference", suggestedValue: "ABC123", source: "hu_explicit" },
        ],
    });
    (0, test_1.expect)(reqs.find(r => r.label === "Amount")?.suggestedValue).toBe("100");
    (0, test_1.expect)(reqs.find(r => r.label === "Reference")?.suggestedValue).toBe("ABC123");
    (0, test_1.expect)(reqs.length).toBe(2);
    (0, test_1.expect)(reqs.every(r => r.required && r.editable)).toBe(true);
});
(0, test_1.test)("TEST2 Customer Code without value", () => {
    const reqs = (0, scenario_data_requirements_1.deriveDataRequirements)({
        explicitFields: [{ label: "Customer Code", source: "hu_implied" }],
    });
    const r = reqs.find(x => x.label === "Customer Code");
    (0, test_1.expect)(r.required).toBe(true);
    (0, test_1.expect)(r.editable).toBe(true);
    (0, test_1.expect)(r.suggestedValue).toBeUndefined();
});
(0, test_1.test)("TEST3 runtime dynamic excluded", () => {
    const reqs = (0, scenario_data_requirements_1.deriveDataRequirements)({
        explicitFields: [
            { label: "Available Account", source: "runtime_dynamic", runtime: true },
            { label: "Amount", suggestedValue: "100", source: "hu_explicit" },
        ],
    });
    (0, test_1.expect)(reqs.find(r => r.label === "Available Account")).toBeUndefined();
    (0, test_1.expect)(reqs.find(r => r.label === "Amount")).toBeDefined();
});
(0, test_1.test)("TEST4 project_config credentials excluded", () => {
    const reqs = (0, scenario_data_requirements_1.deriveDataRequirements)({
        explicitFields: [
            { label: "Usuario", source: "project_config", kind: "credential" },
            { label: "Contraseña", source: "project_config", kind: "credential" },
            { label: "Amount", suggestedValue: "100", source: "hu_explicit" },
        ],
    });
    (0, test_1.expect)(reqs.find(r => r.label === "Usuario")).toBeUndefined();
    (0, test_1.expect)(reqs.find(r => r.label === "Contraseña")).toBeUndefined();
    (0, test_1.expect)(reqs.length).toBe(1);
    (0, test_1.expect)(reqs[0].label).toBe("Amount");
});
(0, test_1.test)("dedupe organization id case insensitive", () => {
    const reqs = (0, scenario_data_requirements_1.deriveDataRequirements)({
        explicitFields: [
            { label: "Organization ID", source: "hu_explicit" },
            { label: "organization id", source: "hu_explicit" },
        ],
    });
    (0, test_1.expect)(reqs.length).toBe(1);
    (0, test_1.expect)(reqs[0].key).toBe("organization_id");
});
(0, test_1.test)("jit secret OTP excluded", () => {
    const reqs = (0, scenario_data_requirements_1.deriveDataRequirements)({
        explicitFields: [
            { label: "OTP", source: "jit_secret", kind: "jit_secret" },
            { label: "Reference", suggestedValue: "ABC", source: "hu_explicit" },
        ],
    });
    (0, test_1.expect)(reqs.find(r => r.label === "OTP")).toBeUndefined();
});
(0, test_1.test)("EXT TEST1 Amount type number", () => {
    const reqs = (0, scenario_data_requirements_1.deriveDataRequirements)({
        explicitFields: [{ label: "Amount", suggestedValue: "100", source: "hu_explicit", controlType: "number", type: "number" }],
    });
    const r = reqs.find(x => x.label === "Amount");
    (0, test_1.expect)(r.controlType).toBe("number");
    (0, test_1.expect)(r.suggestedValue).toBe("100");
});
(0, test_1.test)("EXT TEST2 Access Type select with selected Business", () => {
    const reqs = (0, scenario_data_requirements_1.deriveDataRequirements)({
        explicitFields: [{ label: "Access Type", source: "hu_explicit", controlType: "select", options: ["Individual", "Business"], optionsSource: "hu_explicit", suggestedValue: "Business" }],
    });
    const r = reqs.find(x => x.label === "Access Type");
    (0, test_1.expect)(r.controlType).toBe("select");
    (0, test_1.expect)(r.options).toEqual(["Individual", "Business"]);
    (0, test_1.expect)(r.optionsSource).toBe("hu_explicit");
    (0, test_1.expect)(r.suggestedValue).toBe("Business");
});
(0, test_1.test)("EXT TEST3 select observed without reliable selection", () => {
    const reqs = (0, scenario_data_requirements_1.deriveDataRequirements)({
        explicitFields: [{ label: "Access Type", source: "scenario", controlType: "select", options: ["Individual", "Business"], optionsSource: "runtime_observed" }],
    });
    const r = reqs.find(x => x.label === "Access Type");
    (0, test_1.expect)(r.controlType).toBe("select");
    (0, test_1.expect)(r.options).toEqual(["Individual", "Business"]);
    (0, test_1.expect)(r.suggestedValue).toBeUndefined();
});
(0, test_1.test)("EXT TEST4 runtime_dynamic multiple values still excluded", () => {
    const reqs = (0, scenario_data_requirements_1.deriveDataRequirements)({
        explicitFields: [
            { label: "Available Accounts", source: "runtime_dynamic", runtime: true, options: ["Acc1", "Acc2"], optionsSource: "runtime_observed" },
            { label: "Amount", suggestedValue: "100", source: "hu_explicit", controlType: "number" },
        ],
    });
    (0, test_1.expect)(reqs.find(r => r.label === "Available Accounts")).toBeUndefined();
    (0, test_1.expect)(reqs.find(r => r.label === "Amount")?.controlType).toBe("number");
});
