import { describe, expect, it } from "vitest";
import { approveTestRailRequirementProposals } from "./testrail-requirement-approval-service";

function proposal(overrides: Record<string, unknown> = {}) {
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
  } as any;
}

describe("TestRail requirement approval service", () => {
  it("converts an approved proposal into a requirement", () => {
    const result = approveTestRailRequirementProposals({ caseId: 401, approvedProposals: [proposal()] });

    expect(result).toEqual({
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

  it("does not convert a rejected proposal", () => {
    const result = approveTestRailRequirementProposals({ caseId: 402, approvedProposals: [proposal({ approved: false })] });

    expect(result).toEqual({ caseId: 402, approvedRequirements: [], status: "rejected" });
  });

  it("rejects conflicting proposals for the same key", () => {
    const result = approveTestRailRequirementProposals({
      caseId: 403,
      approvedProposals: [proposal(), proposal({ label: "Secret", controlType: "password", sensitive: true })],
    });

    expect(result).toEqual({ caseId: 403, approvedRequirements: [], status: "rejected" });
  });

  it("deduplicates identical approved proposals", () => {
    const result = approveTestRailRequirementProposals({ caseId: 404, approvedProposals: [proposal(), proposal()] });

    expect(result.approvedRequirements).toHaveLength(1);
    expect(result.status).toBe("approved");
  });
});
