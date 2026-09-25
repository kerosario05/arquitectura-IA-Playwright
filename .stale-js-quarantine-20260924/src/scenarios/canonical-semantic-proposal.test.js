"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const canonical_semantic_proposal_1 = require("./canonical-semantic-proposal");
function validProposal() {
    return {
        status: "resolved",
        confidence: "high",
        requirements: [{
                proposalId: "proposal-1",
                kind: "input",
                description: "The user provides an account number",
                origin: { stepOrders: [1], sourceFragmentRefs: ["step-1"] },
            }],
        branches: [{
                branchProposalId: "branch-1",
                requirementProposalRefs: ["proposal-1"],
                destinationIntent: "Account page",
            }],
        stepRequirementLinks: [{ stepOrder: 1, requirementProposalRefs: ["proposal-1"] }],
        unresolved: [],
    };
}
(0, node_test_1.default)("accepts valid requirement, branch, link, partial, and low-confidence proposals", () => {
    const resolved = validProposal();
    strict_1.default.equal((0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)(resolved, { stepOrders: [1] }).valid, true);
    strict_1.default.equal((0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)({
        ...resolved,
        status: "partial",
        confidence: "medium",
        unresolved: [{ code: "ambiguous_branch", message: "Branch is unclear" }],
    }, { stepOrders: [1] }).valid, true);
    strict_1.default.equal((0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)({
        ...resolved,
        status: "unresolved",
        confidence: "low",
        requirements: [],
        branches: [],
        stepRequirementLinks: [],
        unresolved: [{ code: "insufficient_evidence", message: "No safe interpretation" }],
    }, { stepOrders: [1] }).valid, true);
});
(0, node_test_1.default)("rejects duplicate and dangling proposal references and invalid step orders", () => {
    const proposal = validProposal();
    strict_1.default.equal((0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)({ ...proposal, status: "invalid" }, { stepOrders: [1] }).valid, false);
    strict_1.default.equal((0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)({ ...proposal, confidence: "invalid" }, { stepOrders: [1] }).valid, false);
    strict_1.default.equal((0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)({
        ...proposal,
        requirements: [proposal.requirements[0], proposal.requirements[0]],
    }, { stepOrders: [1] }).valid, false);
    strict_1.default.equal((0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)({
        ...proposal,
        stepRequirementLinks: [{ stepOrder: 1, requirementProposalRefs: ["missing"] }],
    }, { stepOrders: [1] }).valid, false);
    strict_1.default.equal((0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)({
        ...proposal,
        branches: [{ ...proposal.branches[0], requirementProposalRefs: ["missing"] }],
    }, { stepOrders: [1] }).valid, false);
    strict_1.default.equal((0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)({
        ...proposal,
        requirements: [{ ...proposal.requirements[0], branchProposalId: "missing" }],
    }, { stepOrders: [1] }).valid, false);
    strict_1.default.equal((0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)({
        ...proposal,
        stepRequirementLinks: [{ stepOrder: 0, requirementProposalRefs: ["proposal-1"] }],
    }, { stepOrders: [1] }).valid, false);
});
(0, node_test_1.default)("rejects canonical, runtime, authority, locator, and unknown fields", () => {
    const forbidden = [
        "title", "preconditions", "steps", "expectedResults", "sourceRef", "scenarioId",
        "canonicalSchemaVersion", "inputRequirements", "namedProfileRef", "generationProfile",
        "requirementAccounting", "executionReadiness", "mcpExecutable", "locator", "routeProof",
        "runtimeEvidence", "unknownField",
    ];
    for (const field of forbidden) {
        const proposal = { ...validProposal(), [field]: field === "steps" ? [] : "forbidden" };
        strict_1.default.equal((0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)(proposal, { stepOrders: [1] }).valid, false, field);
    }
});
