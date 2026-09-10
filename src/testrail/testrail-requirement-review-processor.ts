import type { RawTestRailCase } from "../types/testrail.types";
import {
  approveTestRailRequirementProposals,
  type RequirementApprovalOutput,
} from "./testrail-requirement-approval-service";
import {
  getReviewItem,
  type MigrationReviewItem,
} from "./testrail-requirement-review-store";
import {
  syncTestRailInputRequirements,
  type TestRailInputRequirementsSyncResult,
} from "./testrail-input-requirements-sync";
import { applyInputRequirementsToPreconditions } from "./testrail-input-requirements-writer";

export type RequirementReviewProcessorInput = {
  caseId: number;
  projectSlug: string;
  rawTestRailCase: RawTestRailCase;
  updateTestRail?: boolean;
};

export type RequirementReviewProcessorOutput = {
  caseId: number;
  status: "persisted" | "persisted_and_updated" | "blocked" | "empty" | "update_failed";
  requirementsCount: number;
};

export type RequirementReviewProcessorDependencies = {
  getReviewItem?: (caseId: number) => MigrationReviewItem | undefined;
  approveProposals?: (input: { caseId: number; approvedProposals: MigrationReviewItem["proposals"] }) => RequirementApprovalOutput;
  sync?: (input: {
    projectSlug: string;
    caseId: number;
    rawTestRailCase: RawTestRailCase;
    requirements?: RequirementApprovalOutput["approvedRequirements"];
  }) => Promise<TestRailInputRequirementsSyncResult>;
  updateCase?: (caseId: number, input: { custom_preconds: string }) => Promise<RawTestRailCase>;
};

export async function processApprovedRequirementReview(
  input: RequirementReviewProcessorInput,
  dependencies: RequirementReviewProcessorDependencies = {},
): Promise<RequirementReviewProcessorOutput> {
  const review = (dependencies.getReviewItem ?? getReviewItem)(input.caseId);
  if (!review || review.status !== "approved") {
    return { caseId: input.caseId, status: "blocked", requirementsCount: 0 };
  }

  const approvedProposals = review.proposals.map((proposal) => ({ ...proposal, approved: true }));
  const approval = (dependencies.approveProposals ?? approveTestRailRequirementProposals)({
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
    await (dependencies.sync ?? syncTestRailInputRequirements)({
      projectSlug: input.projectSlug,
      caseId: input.caseId,
      rawTestRailCase: input.rawTestRailCase,
      requirements: approval.approvedRequirements,
    });
  } catch {
    return { caseId: input.caseId, status: "blocked", requirementsCount: 0 };
  }
  if (input.updateTestRail !== true) {
    return { caseId: input.caseId, status: "persisted", requirementsCount: approval.approvedRequirements.length };
  }

  try {
    const updateCase = dependencies.updateCase;
    if (!updateCase) throw new Error("TestRail updateCase dependency is required");
    await updateCase(input.caseId, {
      custom_preconds: applyInputRequirementsToPreconditions(input.rawTestRailCase, approval.approvedRequirements),
    });
  } catch {
    return { caseId: input.caseId, status: "update_failed", requirementsCount: approval.approvedRequirements.length };
  }
  return { caseId: input.caseId, status: "persisted_and_updated", requirementsCount: approval.approvedRequirements.length };
}
