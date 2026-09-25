"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const testrail_requirement_review_processor_1 = require("./testrail-requirement-review-processor");
const requirement = {
    key: "auth.password",
    label: "Contraseña",
    controlType: "password",
    required: true,
    sensitive: true,
    allowedValues: [],
};
const proposal = { ...requirement, confidence: 0.9, evidence: "Contraseña [auth.password]" };
function deps(status, proposals = [proposal]) {
    const calls = { approved: [], sync: [], update: [] };
    return {
        calls,
        getReviewItem: () => ({ caseId: 801, proposals, status, createdAt: "2026-01-01T00:00:00.000Z" }),
        approveProposals: () => ({ caseId: 801, approvedRequirements: status === "approved" ? [requirement] : [], status: status === "approved" ? "approved" : "rejected" }),
        sync: async (input) => { calls.sync.push(input); return { requirements: [requirement] }; },
        updateCase: async (caseId, input) => { calls.update.push({ caseId, input }); return { id: caseId, title: "Fixture" }; },
    };
}
(0, vitest_1.describe)("approved TestRail requirement review processor", () => {
    (0, vitest_1.it)("persists SQL and does not update TestRail when update is disabled", async () => {
        const dependencies = deps("approved");
        const result = await (0, testrail_requirement_review_processor_1.processApprovedRequirementReview)({ caseId: 801, projectSlug: "project-a", rawTestRailCase: { id: 801, title: "Fixture" } }, dependencies);
        (0, vitest_1.expect)(result).toEqual({ caseId: 801, status: "persisted", requirementsCount: 1 });
        (0, vitest_1.expect)(dependencies.calls.sync[0].requirements).toEqual([requirement]);
        (0, vitest_1.expect)(dependencies.calls.update).toEqual([]);
    });
    (0, vitest_1.it)("persists SQL and updates only custom_preconds when enabled", async () => {
        const dependencies = deps("approved");
        const result = await (0, testrail_requirement_review_processor_1.processApprovedRequirementReview)({ caseId: 801, projectSlug: "project-a", updateTestRail: true, rawTestRailCase: { id: 801, title: "Fixture", custom_preconds: "Usuario activo." } }, dependencies);
        (0, vitest_1.expect)(result).toEqual({ caseId: 801, status: "persisted_and_updated", requirementsCount: 1 });
        (0, vitest_1.expect)(dependencies.calls.update).toEqual([{
                caseId: 801,
                input: { custom_preconds: "Usuario activo.\n\nDatos de ejecución requeridos:\n<!-- qa-lab:input-requirements:start -->\nContraseña (auth.password, password, required, sensitive)\n<!-- qa-lab:input-requirements:end -->" },
            }]);
    });
    (0, vitest_1.it)("does not update TestRail when SQL sync fails", async () => {
        const dependencies = deps("approved");
        dependencies.sync = async () => { throw new Error("sql failed"); };
        const result = await (0, testrail_requirement_review_processor_1.processApprovedRequirementReview)({ caseId: 801, projectSlug: "project-a", updateTestRail: true, rawTestRailCase: { id: 801, title: "Fixture" } }, dependencies);
        (0, vitest_1.expect)(result).toEqual({ caseId: 801, status: "blocked", requirementsCount: 0 });
        (0, vitest_1.expect)(dependencies.calls.update).toEqual([]);
    });
    (0, vitest_1.it)("reports update failure while retaining the persisted count", async () => {
        const dependencies = deps("approved");
        dependencies.updateCase = async () => { throw new Error("TestRail failed"); };
        const result = await (0, testrail_requirement_review_processor_1.processApprovedRequirementReview)({ caseId: 801, projectSlug: "project-a", updateTestRail: true, rawTestRailCase: { id: 801, title: "Fixture" } }, dependencies);
        (0, vitest_1.expect)(result).toEqual({ caseId: 801, status: "update_failed", requirementsCount: 1 });
    });
    (0, vitest_1.it)("blocks pending and rejected reviews without writing", async () => {
        for (const status of ["pending", "rejected"]) {
            const dependencies = deps(status);
            await (0, vitest_1.expect)((0, testrail_requirement_review_processor_1.processApprovedRequirementReview)({ caseId: 801, projectSlug: "project-a", updateTestRail: true, rawTestRailCase: { id: 801, title: "Fixture" } }, dependencies))
                .resolves.toEqual({ caseId: 801, status: "blocked", requirementsCount: 0 });
            (0, vitest_1.expect)(dependencies.calls.sync).toEqual([]);
            (0, vitest_1.expect)(dependencies.calls.update).toEqual([]);
        }
    });
});
