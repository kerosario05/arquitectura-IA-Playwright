"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const testrail_requirement_migration_1 = require("./testrail-requirement-migration");
const approvedPasswordProposal = {
    key: "auth.password",
    label: "Contraseña",
    controlType: "password",
    required: true,
    sensitive: true,
    allowedValues: [],
    confidence: 0.9,
    evidence: "Contraseña [auth.password]",
    approved: true,
};
(0, vitest_1.describe)("TestRail requirement migration", () => {
    (0, vitest_1.it)("completes with declared requirements", () => {
        const result = (0, testrail_requirement_migration_1.migrateTestRailRequirements)({
            caseId: 501,
            rawCase: { id: 501, title: "Fixture", custom_preconds: "Customer id (customer.id, text)" },
            approvedProposals: [],
        });
        (0, vitest_1.expect)(result).toMatchObject({ caseId: 501, status: "completed", proposalsGenerated: 0 });
        (0, vitest_1.expect)(result.requirements.map((requirement) => requirement.key)).toEqual(["customer.id"]);
    });
    (0, vitest_1.it)("completes with an explicitly approved proposal", () => {
        const result = (0, testrail_requirement_migration_1.migrateTestRailRequirements)({
            caseId: 502,
            rawCase: { id: 502, title: "Fixture", custom_steps: "Contraseña [auth.password]" },
            approvedProposals: [approvedPasswordProposal],
        });
        (0, vitest_1.expect)(result).toMatchObject({ caseId: 502, status: "completed", proposalsGenerated: 1 });
        (0, vitest_1.expect)(result.requirements).toContainEqual(vitest_1.expect.objectContaining({ key: "auth.password", sensitive: true }));
    });
    (0, vitest_1.it)("returns empty for a case without requirements or proposals", () => {
        const result = (0, testrail_requirement_migration_1.migrateTestRailRequirements)({
            caseId: 503,
            rawCase: { id: 503, title: "Fixture", custom_expected: "The operation succeeds" },
            approvedProposals: [],
        });
        (0, vitest_1.expect)(result).toEqual({ caseId: 503, requirements: [], proposalsGenerated: 0, status: "empty" });
    });
    (0, vitest_1.it)("blocks migration when the converter reports conflicts", () => {
        const result = (0, testrail_requirement_migration_1.migrateTestRailRequirements)({
            caseId: 504,
            rawCase: {
                id: 504,
                title: "Fixture",
                custom_preconds: "User (auth.user, text)\nSecret user (auth.user, password)",
            },
            approvedProposals: [],
        });
        (0, vitest_1.expect)(result).toEqual({ caseId: 504, requirements: [], proposalsGenerated: 0, status: "blocked" });
    });
});
