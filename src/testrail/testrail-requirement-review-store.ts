import type { InputRequirementProposal } from "./testrail-requirement-proposal-engine";

export type MigrationReviewStatus = "pending" | "approved" | "rejected";

export type MigrationReviewItem = {
  caseId: number;
  proposals: InputRequirementProposal[];
  status: MigrationReviewStatus;
  createdAt: string;
};

const reviewItems = new Map<number, MigrationReviewItem>();

function cloneItem(item: MigrationReviewItem): MigrationReviewItem {
  return {
    ...item,
    proposals: item.proposals.map((proposal) => ({
      ...proposal,
      ...(Array.isArray(proposal.allowedValues) ? { allowedValues: [...proposal.allowedValues] } : {}),
    })),
  };
}

export function createReviewItem(caseId: number, proposals: InputRequirementProposal[]): MigrationReviewItem {
  const item: MigrationReviewItem = {
    caseId,
    proposals: proposals.map((proposal) => ({
      ...proposal,
      ...(Array.isArray(proposal.allowedValues) ? { allowedValues: [...proposal.allowedValues] } : {}),
    })),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  reviewItems.set(caseId, item);
  return cloneItem(item);
}

export function getReviewItem(caseId: number): MigrationReviewItem | undefined {
  const item = reviewItems.get(caseId);
  return item ? cloneItem(item) : undefined;
}

export function listReviewItems(caseIds: number[]): MigrationReviewItem[] {
  return caseIds
    .map((caseId) => reviewItems.get(caseId))
    .filter((item): item is MigrationReviewItem => item !== undefined)
    .map(cloneItem);
}

function updateReviewStatus(caseId: number, status: MigrationReviewStatus): MigrationReviewItem | undefined {
  const item = reviewItems.get(caseId);
  if (!item) return undefined;
  item.status = status;
  return cloneItem(item);
}

export function approveReviewItem(caseId: number): MigrationReviewItem | undefined {
  return updateReviewStatus(caseId, "approved");
}

export function rejectReviewItem(caseId: number): MigrationReviewItem | undefined {
  return updateReviewStatus(caseId, "rejected");
}

export function listPendingReviews(): MigrationReviewItem[] {
  return Array.from(reviewItems.values())
    .filter((item) => item.status === "pending")
    .map(cloneItem);
}
