"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReviewItem = createReviewItem;
exports.getReviewItem = getReviewItem;
exports.listReviewItems = listReviewItems;
exports.approveReviewItem = approveReviewItem;
exports.rejectReviewItem = rejectReviewItem;
exports.listPendingReviews = listPendingReviews;
const reviewItems = new Map();
function cloneItem(item) {
    return {
        ...item,
        proposals: item.proposals.map((proposal) => ({
            ...proposal,
            ...(Array.isArray(proposal.allowedValues) ? { allowedValues: [...proposal.allowedValues] } : {}),
        })),
    };
}
function createReviewItem(caseId, proposals) {
    const item = {
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
function getReviewItem(caseId) {
    const item = reviewItems.get(caseId);
    return item ? cloneItem(item) : undefined;
}
function listReviewItems(caseIds) {
    return caseIds
        .map((caseId) => reviewItems.get(caseId))
        .filter((item) => item !== undefined)
        .map(cloneItem);
}
function updateReviewStatus(caseId, status) {
    const item = reviewItems.get(caseId);
    if (!item)
        return undefined;
    item.status = status;
    return cloneItem(item);
}
function approveReviewItem(caseId) {
    return updateReviewStatus(caseId, "approved");
}
function rejectReviewItem(caseId) {
    return updateReviewStatus(caseId, "rejected");
}
function listPendingReviews() {
    return Array.from(reviewItems.values())
        .filter((item) => item.status === "pending")
        .map(cloneItem);
}
