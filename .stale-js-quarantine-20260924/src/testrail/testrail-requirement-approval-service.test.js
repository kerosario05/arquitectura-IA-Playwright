"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const testrail_requirement_approval_service_1 = require("./testrail-requirement-approval-service");
function proposal(overrides = {}) {
    return {
        key: "auth.username",
        label: "Username",
        controlType: "text",
        required: true,
        sensitive: false,
        allowedValues: [],
        confidence: 0.9,
        evidence: "Username [auth.username]",
        approved: true,
        ...overrides,
    };
}
(0, vitest_1.describe)("TestRail requirement approval service", () => {
    (0, vitest_1.it)("converts an approved proposal into a requirement", () => {
        const result = (0, testrail_requirement_approval_service_1.approveTestRailRequirementProposals)({ caseId: 401, approvedProposals: [proposal()] });
        (0, vitest_1.expect)(result).toEqual({
            caseId: 401,
            approvedRequirements: [{
                    key: "auth.username",
                    label: "Username",
                    controlType: "text",
                    required: true,
                    sensitive: false,
                    allowedValues: [],
                }],
            status: "approved",
        });
    });
    (0, vitest_1.it)("does not convert a rejected proposal", () => {
        const result = (0, testrail_requirement_approval_service_1.approveTestRailRequirementProposals)({ caseId: 402, approvedProposals: [proposal({ approved: false })] });
        (0, vitest_1.expect)(result).toEqual({ caseId: 402, approvedRequirements: [], status: "rejected" });
    });
    (0, vitest_1.it)("rejects conflicting proposals for the same key", () => {
        const result = (0, testrail_requirement_approval_service_1.approveTestRailRequirementProposals)({
            caseId: 403,
            approvedProposals: [proposal(), proposal({ label: "Secret", controlType: "password", sensitive: true })],
        });
        (0, vitest_1.expect)(result).toEqual({ caseId: 403, approvedRequirements: [], status: "rejected" });
    });
    (0, vitest_1.it)("deduplicates identical approved proposals", () => {
        const result = (0, testrail_requirement_approval_service_1.approveTestRailRequirementProposals)({ caseId: 404, approvedProposals: [proposal(), proposal()] });
        (0, vitest_1.expect)(result.approvedRequirements).toHaveLength(1);
        (0, vitest_1.expect)(result.status).toBe("approved");
    });
});
