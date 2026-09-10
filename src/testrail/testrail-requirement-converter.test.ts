import { describe, expect, it } from "vitest";
import { convertTestRailRequirements } from "./testrail-requirement-converter";

describe("TestRail requirement converter", () => {
  it("returns a proposed result for declared requirements", () => {
    const result = convertTestRailRequirements({
      caseId: 201,
      rawCase: {
        id: 201,
        title: "Fixture",
        custom_preconds: "Customer id (customer.id, text)",
        custom_steps: "Use [customer.id]",
      },
    });

    expect(result).toMatchObject({ caseId: 201, status: "proposed", requiresApproval: true });
    expect(result.requirements).toHaveLength(1);
    expect(result.unresolvedPlaceholders).toEqual([]);
  });

  it("reports namespace placeholders without declarations", () => {
    const result = convertTestRailRequirements({
      caseId: 202,
      rawCase: { id: 202, title: "Fixture", custom_steps: "Use [auth.username] and [not-a-placeholder]" },
    });

    expect(result.status).toBe("empty");
    expect(result.requirements).toEqual([]);
    expect(result.unresolvedPlaceholders).toEqual(["auth.username"]);
  });

  it("returns empty for a case without requirements", () => {
    const result = convertTestRailRequirements({
      caseId: 203,
      rawCase: { id: 203, title: "Fixture", custom_expected: "The operation succeeds" },
    });

    expect(result).toMatchObject({ caseId: 203, requirements: [], unresolvedPlaceholders: [], conflicts: [], status: "empty", requiresApproval: true });
  });

  it("preserves parser conflicts", () => {
    const result = convertTestRailRequirements({
      caseId: 204,
      rawCase: {
        id: 204,
        title: "Fixture",
        custom_preconds: "Customer id (customer.id, text)\nSecret id (customer.id, secret)",
      },
    });

    expect(result.status).toBe("conflict");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].key).toBe("customer.id");
  });
});
