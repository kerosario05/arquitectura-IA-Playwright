"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const testrail_requirement_review_store_1 = require("./testrail-requirement-review-store");
const proposals = [{
        key: "auth.password",
        label: "Contraseña",
        controlType: "password",
        required: true,
        sensitive: true,
        confidence: 0.9,
        evidence: "Contraseña [auth.password]",
    }];
(0, vitest_1.describe)("TestRail requirement review store", () => {
    (0, vitest_1.beforeEach)(() => {
        for (const item of (0, testrail_requirement_review_store_1.listPendingReviews)())
            (0, testrail_requirement_review_store_1.rejectReviewItem)(item.caseId);
    });
    (0, vitest_1.it)("creates a pending review", () => {
        const item = (0, testrail_requirement_review_store_1.createReviewItem)(701, proposals);
        (0, vitest_1.expect)(item).toMatchObject({ caseId: 701, proposals, status: "pending" });
        (0, vitest_1.expect)(item.createdAt).toEqual(vitest_1.expect.any(String));
    });
    (0, vitest_1.it)("gets a pending review by caseId", () => {
        (0, testrail_requirement_review_store_1.createReviewItem)(702, proposals);
        (0, vitest_1.expect)((0, testrail_requirement_review_store_1.getReviewItem)(702)).toMatchObject({ caseId: 702, status: "pending", proposals });
    });
    (0, vitest_1.it)("changes a review to approved", () => {
        (0, testrail_requirement_review_store_1.createReviewItem)(703, proposals);
        (0, vitest_1.expect)((0, testrail_requirement_review_store_1.approveReviewItem)(703)).toMatchObject({ caseId: 703, status: "approved" });
        (0, vitest_1.expect)((0, testrail_requirement_review_store_1.getReviewItem)(703)?.status).toBe("approved");
    });
    (0, vitest_1.it)("changes a review to rejected", () => {
        (0, testrail_requirement_review_store_1.createReviewItem)(704, proposals);
        (0, vitest_1.expect)((0, testrail_requirement_review_store_1.rejectReviewItem)(704)).toMatchObject({ caseId: 704, status: "rejected" });
        (0, vitest_1.expect)((0, testrail_requirement_review_store_1.getReviewItem)(704)?.status).toBe("rejected");
    });
    (0, vitest_1.it)("keeps different case reviews isolated", () => {
        (0, testrail_requirement_review_store_1.createReviewItem)(705, [{ ...proposals[0], key: "case.705" }]);
        (0, testrail_requirement_review_store_1.createReviewItem)(706, [{ ...proposals[0], key: "case.706" }]);
        (0, vitest_1.expect)((0, testrail_requirement_review_store_1.listPendingReviews)().map((item) => item.caseId)).toEqual([705, 706]);
        (0, vitest_1.expect)((0, testrail_requirement_review_store_1.getReviewItem)(705)?.proposals[0].key).toBe("case.705");
        (0, vitest_1.expect)((0, testrail_requirement_review_store_1.getReviewItem)(706)?.proposals[0].key).toBe("case.706");
    });
});
