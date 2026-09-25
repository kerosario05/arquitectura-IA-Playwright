"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processApprovedRequirementReview = processApprovedRequirementReview;
const testrail_requirement_approval_service_1 = require("./testrail-requirement-approval-service");
const testrail_requirement_review_store_1 = require("./testrail-requirement-review-store");
const testrail_input_requirements_sync_1 = require("./testrail-input-requirements-sync");
const testrail_input_requirements_writer_1 = require("./testrail-input-requirements-writer");
async function processApprovedRequirementReview(input, dependencies = {}) {
    const review = (dependencies.getReviewItem ?? testrail_requirement_review_store_1.getReviewItem)(input.caseId);
    if (!review || review.status !== "approved") {
        return { caseId: input.caseId, status: "blocked", requirementsCount: 0 };
    }
    const approvedProposals = review.proposals.map((proposal) => ({ ...proposal, approved: true }));
    const approval = (dependencies.approveProposals ?? testrail_requirement_approval_service_1.approveTestRailRequirementProposals)({
        caseId: input.caseId,
        approvedProposals,
    });
    if (approval.status === "rejected") {
        return { caseId: input.caseId, status: "blocked", requirementsCount: 0 };
    }
    if (approval.approvedRequirements.length === 0) {
        return { caseId: input.caseId, status: "empty", requirementsCount: 0 };
    }
    try {
        await (dependencies.sync ?? testrail_input_requirements_sync_1.syncTestRailInputRequirements)({
            projectSlug: input.projectSlug,
            caseId: input.caseId,
            rawTestRailCase: input.rawTestRailCase,
            requirements: approval.approvedRequirements,
        });
    }
    catch {
        return { caseId: input.caseId, status: "blocked", requirementsCount: 0 };
    }
    if (input.updateTestRail !== true) {
        return { caseId: input.caseId, status: "persisted", requirementsCount: approval.approvedRequirements.length };
    }
    try {
        const updateCase = dependencies.updateCase;
        if (!updateCase)
            throw new Error("TestRail updateCase dependency is required");
        await updateCase(input.caseId, {
            custom_preconds: (0, testrail_input_requirements_writer_1.applyInputRequirementsToPreconditions)(input.rawTestRailCase, approval.approvedRequirements),
        });
    }
    catch {
        return { caseId: input.caseId, status: "update_failed", requirementsCount: approval.approvedRequirements.length };
    }
    return { caseId: input.caseId, status: "persisted_and_updated", requirementsCount: approval.approvedRequirements.length };
}
