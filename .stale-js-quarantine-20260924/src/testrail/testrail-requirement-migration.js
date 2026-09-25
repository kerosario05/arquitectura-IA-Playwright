"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateTestRailRequirements = migrateTestRailRequirements;
const testrail_requirement_approval_service_1 = require("./testrail-requirement-approval-service");
const testrail_requirement_converter_1 = require("./testrail-requirement-converter");
const testrail_requirement_proposal_engine_1 = require("./testrail-requirement-proposal-engine");
function sameRequirement(left, right) {
    return left.label === right.label
        && left.controlType === right.controlType
        && left.required === right.required
        && left.sensitive === right.sensitive
        && JSON.stringify(left.allowedValues) === JSON.stringify(right.allowedValues);
}
function mergeRequirements(declared, approved) {
    const byKey = new Map();
    for (const requirement of [...declared, ...approved]) {
        const existing = byKey.get(requirement.key);
        if (existing && !sameRequirement(existing, requirement))
            return undefined;
        byKey.set(requirement.key, existing ?? requirement);
    }
    return Array.from(byKey.values());
}
function migrateTestRailRequirements(input) {
    const converted = (0, testrail_requirement_converter_1.convertTestRailRequirements)({
        caseId: input.caseId,
        rawCase: input.rawCase,
    });
    const proposals = (0, testrail_requirement_proposal_engine_1.proposeTestRailInputRequirements)({
        rawCase: input.rawCase,
        converterOutput: converted,
    });
    if (converted.conflicts.length > 0) {
        return { caseId: input.caseId, requirements: [], proposalsGenerated: proposals.proposals.length, status: "blocked" };
    }
    const approval = (0, testrail_requirement_approval_service_1.approveTestRailRequirementProposals)({
        caseId: input.caseId,
        approvedProposals: input.approvedProposals,
    });
    if (approval.status === "rejected" && input.approvedProposals.length > 0) {
        return { caseId: input.caseId, requirements: [], proposalsGenerated: proposals.proposals.length, status: "blocked" };
    }
    const requirements = mergeRequirements(converted.requirements, approval.approvedRequirements);
    if (!requirements) {
        return { caseId: input.caseId, requirements: [], proposalsGenerated: proposals.proposals.length, status: "blocked" };
    }
    return {
        caseId: input.caseId,
        requirements,
        proposalsGenerated: proposals.proposals.length,
        status: requirements.length > 0 ? "completed" : "empty",
    };
}
