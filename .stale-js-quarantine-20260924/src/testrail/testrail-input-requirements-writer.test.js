"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const testrail_input_requirements_writer_1 = require("./testrail-input-requirements-writer");
const requirements = [{
        key: "auth.username",
        label: "Usuario de acceso",
        controlType: "text",
        required: true,
        sensitive: false,
    }];
(0, vitest_1.describe)("TestRail input requirements writer", () => {
    (0, vitest_1.it)("preserves existing human preconditions and adds the contract section", () => {
        const result = (0, testrail_input_requirements_writer_1.applyInputRequirementsToPreconditions)({ custom_preconds: "Usuario debe estar activo." }, requirements);
        (0, vitest_1.expect)(result).toContain("Usuario debe estar activo.");
        (0, vitest_1.expect)(result).toContain("Datos de ejecución requeridos:");
        (0, vitest_1.expect)(result).toContain("Usuario de acceso (auth.username, text, required)");
    });
    (0, vitest_1.it)("is idempotent when applied twice", () => {
        const once = (0, testrail_input_requirements_writer_1.applyInputRequirementsToPreconditions)({ custom_preconds: "Precondición humana." }, requirements);
        const twice = (0, testrail_input_requirements_writer_1.applyInputRequirementsToPreconditions)({ custom_preconds: once }, requirements);
        (0, vitest_1.expect)(twice).toBe(once);
        (0, vitest_1.expect)((twice.match(/Datos de ejecución requeridos:/g) ?? []).length).toBe(1);
    });
    (0, vitest_1.it)("replaces only an existing contractual section", () => {
        const oldRequirements = [{ key: "old.key", label: "Old", controlType: "text", required: true }];
        const existing = (0, testrail_input_requirements_writer_1.applyInputRequirementsToPreconditions)({ custom_preconds: "Humano antes." }, oldRequirements);
        const replaced = (0, testrail_input_requirements_writer_1.applyInputRequirementsToPreconditions)({ custom_preconds: `${existing}\nHumano después.` }, requirements);
        (0, vitest_1.expect)(replaced).toContain("Humano antes.");
        (0, vitest_1.expect)(replaced).toContain("Humano después.");
        (0, vitest_1.expect)(replaced).not.toContain("old.key");
        (0, vitest_1.expect)(replaced).toContain("auth.username");
    });
    (0, vitest_1.it)("serializes required and sensitive flags without inventing allowed values", () => {
        const section = (0, testrail_input_requirements_writer_1.buildInputRequirementsContractSection)([{
                key: "auth.password",
                label: "Contraseña de acceso",
                controlType: "password",
                required: true,
                sensitive: true,
                allowedValues: ["must-not-be-serialized"],
            }]);
        (0, vitest_1.expect)(section).toContain("Contraseña de acceso (auth.password, password, required, sensitive)");
        (0, vitest_1.expect)(section).not.toContain("must-not-be-serialized");
    });
});
