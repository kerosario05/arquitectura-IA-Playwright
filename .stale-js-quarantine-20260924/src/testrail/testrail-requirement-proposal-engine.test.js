"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const testrail_requirement_proposal_engine_1 = require("./testrail-requirement-proposal-engine");
const testrail_runtime_transformer_1 = require("./testrail-runtime-transformer");
function converted(requirements = []) {
    return {
        caseId: 301,
        requirements,
        unresolvedPlaceholders: [],
        conflicts: [],
        status: requirements.length > 0 ? "proposed" : "empty",
        requiresApproval: true,
    };
}
(0, vitest_1.describe)("TestRail requirement proposal engine", () => {
    (0, vitest_1.it)("proposes a sensitive password input when the placeholder has password context", () => {
        const result = (0, testrail_requirement_proposal_engine_1.proposeTestRailInputRequirements)({
            rawCase: {
                id: 301,
                title: "Login",
                custom_steps: "Introducir Contraseña [auth.password] en el campo de acceso",
            },
            converterOutput: converted(),
        });
        (0, vitest_1.expect)(result.proposals).toEqual([vitest_1.expect.objectContaining({
                key: "auth.password",
                label: "Contraseña",
                controlType: "password",
                sensitive: true,
            })]);
        (0, vitest_1.expect)(result.proposals[0].confidence).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("leaves a placeholder without enough context unresolved", () => {
        const result = (0, testrail_requirement_proposal_engine_1.proposeTestRailInputRequirements)({
            rawCase: { id: 302, title: "Fixture", custom_expected: "Use [auth.value]" },
            converterOutput: converted(),
        });
        (0, vitest_1.expect)(result.proposals).toEqual([vitest_1.expect.objectContaining({
                key: "auth.value",
                label: "Value",
                inputUsage: ["expected"],
                inputRole: "scenario",
            })]);
        (0, vitest_1.expect)(result.unresolved).toEqual([]);
    });
    (0, vitest_1.it)("does not propose a duplicate for an existing requirement", () => {
        const result = (0, testrail_requirement_proposal_engine_1.proposeTestRailInputRequirements)({
            rawCase: { id: 303, title: "Fixture", custom_steps: "Contraseña [auth.password]" },
            converterOutput: converted([{ key: "auth.password", label: "Password", controlType: "password", sensitive: true }]),
        });
        (0, vitest_1.expect)(result.proposals).toEqual([]);
        (0, vitest_1.expect)(result.unresolved).toEqual([]);
    });
    (0, vitest_1.it)("does not write externally", () => {
        const result = (0, testrail_requirement_proposal_engine_1.proposeTestRailInputRequirements)({
            rawCase: { id: 304, title: "Fixture", custom_steps: "Use [auth.value]" },
            converterOutput: converted(),
        });
        (0, vitest_1.expect)(result).toMatchObject({ requiresApproval: true });
    });
    (0, vitest_1.it)("isolates labels to the placeholder occurrence in each step", () => {
        const result = (0, testrail_requirement_proposal_engine_1.proposeTestRailInputRequirements)({
            rawCase: {
                id: 305,
                title: "Fixture",
                custom_steps: [
                    'Ingresar [account.identifier] en el campo "Identificador"',
                    'Ingresar [account.user] en el campo "Usuario"',
                    'Ingresar [account.secret] en el campo "Clave"',
                ].join("\n"),
            },
            converterOutput: converted(),
        });
        (0, vitest_1.expect)(result.proposals.map(({ key, label }) => ({ key, label }))).toEqual([
            { key: "account.identifier", label: "Identificador" },
            { key: "account.user", label: "Usuario" },
            { key: "account.secret", label: "Clave" },
        ]);
    });
    (0, vitest_1.it)("does not leak later password context into an earlier placeholder", () => {
        const result = (0, testrail_requirement_proposal_engine_1.proposeTestRailInputRequirements)({
            rawCase: {
                id: 306,
                title: "Fixture",
                custom_steps: 'Ingresar [auth.username] en el campo "Usuario"\nIngresar [auth.password] en el campo "Contraseña"',
            },
            converterOutput: converted(),
        });
        (0, vitest_1.expect)(result.proposals.find((proposal) => proposal.key === "auth.username")).toMatchObject({
            label: "Usuario",
            controlType: "text",
        });
    });
    (0, vitest_1.it)("leaves a placeholder unresolved when its local context is insufficient", () => {
        const result = (0, testrail_requirement_proposal_engine_1.proposeTestRailInputRequirements)({
            rawCase: { id: 307, title: "Fixture", custom_steps: "Use [account.value]" },
            converterOutput: converted(),
        });
        (0, vitest_1.expect)(result.proposals).toEqual([]);
        (0, vitest_1.expect)(result.unresolved).toEqual(["account.value"]);
    });
    (0, vitest_1.it)("keeps distinct keys even when labels happen to match", () => {
        const result = (0, testrail_requirement_proposal_engine_1.proposeTestRailInputRequirements)({
            rawCase: {
                id: 308,
                title: "Fixture",
                custom_steps: 'Ingresar [account.one] en el campo "Dato"\nIngresar [account.two] en el campo "Dato"',
            },
            converterOutput: converted(),
        });
        (0, vitest_1.expect)(result.proposals.map((proposal) => proposal.key)).toEqual(["account.one", "account.two"]);
    });
    (0, vitest_1.it)("includes action and expected-only keys independently by structured key", () => {
        const result = (0, testrail_requirement_proposal_engine_1.proposeTestRailInputRequirements)({
            rawCase: {
                id: 44759,
                title: "Repeated dataset fixture",
                custom_steps: "Ingresar [dataset_1.document] y luego ingresar [dataset_2.document]",
                custom_expected: "Verificar [dataset_1.expected_name] y [dataset_2.expected_name]",
            },
            converterOutput: converted(),
        });
        (0, vitest_1.expect)(result.proposals.map((proposal) => proposal.key)).toEqual([
            "dataset_1.document",
            "dataset_2.document",
            "dataset_1.expected_name",
            "dataset_2.expected_name",
        ]);
        (0, vitest_1.expect)(result.proposals.filter((proposal) => proposal.inputUsage?.includes("expected"))).toHaveLength(2);
        (0, vitest_1.expect)(result.unresolved).toEqual([]);
    });
    (0, vitest_1.it)("keeps contract requirements ahead of an inferred proposal with the same key", () => {
        const result = (0, testrail_runtime_transformer_1.transformTestRailCaseForRuntime)({ id: 309, title: "Fixture", custom_preconds: "Usuario (auth.user, text)" }, {
            propose: () => ({
                proposals: [{ key: "auth.user", label: "Otro", controlType: "password", confidence: 0.9, evidence: "fixture" }],
                unresolved: [],
                requiresApproval: true,
            }),
        });
        (0, vitest_1.expect)(result.inputRequirements).toEqual([vitest_1.expect.objectContaining({ key: "auth.user", source: "contract" })]);
    });
});
