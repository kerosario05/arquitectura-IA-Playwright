import { describe, expect, it } from "vitest";
import { migrateTestRailRequirements } from "./testrail-requirement-migration";

const approvedPasswordProposal = {
  key: "auth.password",
  label: "Contraseña",
  controlType: "password",
  required: true,
  sensitive: true,
  allowedValues: [],
  confidence: 0.9,
  evidence: "Contraseña [auth.password]",
  approved: true,
} as any;

describe("TestRail requirement migration", () => {
  it("completes with declared requirements", () => {
    const result = migrateTestRailRequirements({
      caseId: 501,
      rawCase: { id: 501, title: "Fixture", custom_preconds: "Customer id (customer.id, text)" },
      approvedProposals: [],
    });

    expect(result).toMatchObject({ caseId: 501, status: "completed", proposalsGenerated: 0 });
    expect(result.requirements.map((requirement) => requirement.key)).toEqual(["customer.id"]);
  });

  it("completes with an explicitly approved proposal", () => {
    const result = migrateTestRailRequirements({
      caseId: 502,
      rawCase: { id: 502, title: "Fixture", custom_steps: "Contraseña [auth.password]" },
      approvedProposals: [approvedPasswordProposal],
    });

    expect(result).toMatchObject({ caseId: 502, status: "completed", proposalsGenerated: 1 });
    expect(result.requirements).toContainEqual(expect.objectContaining({ key: "auth.password", sensitive: true }));
  });

  it("returns empty for a case without requirements or proposals", () => {
    const result = migrateTestRailRequirements({
      caseId: 503,
      rawCase: { id: 503, title: "Fixture", custom_expected: "The operation succeeds" },
      approvedProposals: [],
    });

    expect(result).toEqual({ caseId: 503, requirements: [], proposalsGenerated: 0, status: "empty" });
  });

  it("blocks migration when the converter reports conflicts", () => {
    const result = migrateTestRailRequirements({
      caseId: 504,
      rawCase: {
        id: 504,
        title: "Fixture",
        custom_preconds: "User (auth.user, text)\nSecret user (auth.user, password)",
      },
      approvedProposals: [],
    });

    expect(result).toEqual({ caseId: 504, requirements: [], proposalsGenerated: 0, status: "blocked" });
  });
});
