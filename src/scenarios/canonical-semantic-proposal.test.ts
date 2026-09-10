import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCanonicalSemanticNormalizationProposal,
  type CanonicalSemanticNormalizationProposal,
} from "./canonical-semantic-proposal";

function validProposal(): CanonicalSemanticNormalizationProposal {
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

test("accepts valid requirement, branch, link, partial, and low-confidence proposals", () => {
  const resolved = validProposal();
  assert.equal(validateCanonicalSemanticNormalizationProposal(resolved, { stepOrders: [1] }).valid, true);
  assert.equal(validateCanonicalSemanticNormalizationProposal({
    ...resolved,
    status: "partial",
    confidence: "medium",
    unresolved: [{ code: "ambiguous_branch", message: "Branch is unclear" }],
  }, { stepOrders: [1] }).valid, true);
  assert.equal(validateCanonicalSemanticNormalizationProposal({
    ...resolved,
    status: "unresolved",
    confidence: "low",
    requirements: [],
    branches: [],
    stepRequirementLinks: [],
    unresolved: [{ code: "insufficient_evidence", message: "No safe interpretation" }],
  }, { stepOrders: [1] }).valid, true);
});

test("rejects duplicate and dangling proposal references and invalid step orders", () => {
  const proposal = validProposal();
  assert.equal(validateCanonicalSemanticNormalizationProposal({ ...proposal, status: "invalid" }, { stepOrders: [1] }).valid, false);
  assert.equal(validateCanonicalSemanticNormalizationProposal({ ...proposal, confidence: "invalid" }, { stepOrders: [1] }).valid, false);
  assert.equal(validateCanonicalSemanticNormalizationProposal({
    ...proposal,
    requirements: [proposal.requirements[0], proposal.requirements[0]],
  }, { stepOrders: [1] }).valid, false);
  assert.equal(validateCanonicalSemanticNormalizationProposal({
    ...proposal,
    stepRequirementLinks: [{ stepOrder: 1, requirementProposalRefs: ["missing"] }],
  }, { stepOrders: [1] }).valid, false);
  assert.equal(validateCanonicalSemanticNormalizationProposal({
    ...proposal,
    branches: [{ ...proposal.branches![0], requirementProposalRefs: ["missing"] }],
  }, { stepOrders: [1] }).valid, false);
  assert.equal(validateCanonicalSemanticNormalizationProposal({
    ...proposal,
    requirements: [{ ...proposal.requirements[0], branchProposalId: "missing" }],
  }, { stepOrders: [1] }).valid, false);
  assert.equal(validateCanonicalSemanticNormalizationProposal({
    ...proposal,
    stepRequirementLinks: [{ stepOrder: 0, requirementProposalRefs: ["proposal-1"] }],
  }, { stepOrders: [1] }).valid, false);
});

test("rejects canonical, runtime, authority, locator, and unknown fields", () => {
  const forbidden = [
    "title", "preconditions", "steps", "expectedResults", "sourceRef", "scenarioId",
    "canonicalSchemaVersion", "inputRequirements", "namedProfileRef", "generationProfile",
    "requirementAccounting", "executionReadiness", "mcpExecutable", "locator", "routeProof",
    "runtimeEvidence", "unknownField",
  ];
  for (const field of forbidden) {
    const proposal = { ...validProposal(), [field]: field === "steps" ? [] : "forbidden" };
    assert.equal(validateCanonicalSemanticNormalizationProposal(proposal, { stepOrders: [1] }).valid, false, field);
  }
});
