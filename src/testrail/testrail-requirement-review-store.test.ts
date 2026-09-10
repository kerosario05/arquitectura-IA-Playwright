import { beforeEach, describe, expect, it } from "vitest";
import {
  approveReviewItem,
  createReviewItem,
  getReviewItem,
  listPendingReviews,
  rejectReviewItem,
} from "./testrail-requirement-review-store";

const proposals = [{
  key: "auth.password",
  label: "Contraseña",
  controlType: "password",
  required: true,
  sensitive: true,
  confidence: 0.9,
  evidence: "Contraseña [auth.password]",
}] as any;

describe("TestRail requirement review store", () => {
  beforeEach(() => {
    for (const item of listPendingReviews()) rejectReviewItem(item.caseId);
  });

  it("creates a pending review", () => {
    const item = createReviewItem(701, proposals);

    expect(item).toMatchObject({ caseId: 701, proposals, status: "pending" });
    expect(item.createdAt).toEqual(expect.any(String));
  });

  it("gets a pending review by caseId", () => {
    createReviewItem(702, proposals);

    expect(getReviewItem(702)).toMatchObject({ caseId: 702, status: "pending", proposals });
  });

  it("changes a review to approved", () => {
    createReviewItem(703, proposals);

    expect(approveReviewItem(703)).toMatchObject({ caseId: 703, status: "approved" });
    expect(getReviewItem(703)?.status).toBe("approved");
  });

  it("changes a review to rejected", () => {
    createReviewItem(704, proposals);

    expect(rejectReviewItem(704)).toMatchObject({ caseId: 704, status: "rejected" });
    expect(getReviewItem(704)?.status).toBe("rejected");
  });

  it("keeps different case reviews isolated", () => {
    createReviewItem(705, [{ ...proposals[0], key: "case.705" }] as any);
    createReviewItem(706, [{ ...proposals[0], key: "case.706" }] as any);

    expect(listPendingReviews().map((item) => item.caseId)).toEqual([705, 706]);
    expect(getReviewItem(705)?.proposals[0].key).toBe("case.705");
    expect(getReviewItem(706)?.proposals[0].key).toBe("case.706");
  });
});
