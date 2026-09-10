import { describe, expect, it } from "vitest";
import { extractTestRailInputRequirements } from "./testrail-input-requirements-adapter";

describe("TestRail input requirements adapter", () => {
  it("extracts requirements from approved markdown declarations", () => {
    const result = extractTestRailInputRequirements({
      id: 100,
      title: "Fixture",
      custom_preconds: "Customer id (customer.id, text)",
      custom_steps: "Use [customer.id]",
      custom_expected: "The result is shown",
    });

    expect(result.requirements).toEqual([{
      key: "customer.id",
      label: "Customer id",
      controlType: "text",
      required: true,
      sensitive: false,
      allowedValues: [],
    }]);
  });

  it("returns no requirements when markdown has no declarations", () => {
    const result = extractTestRailInputRequirements({
      id: 101,
      title: "Fixture",
      custom_preconds: "The user is authenticated",
      custom_steps: "Open the customer screen",
      custom_expected: "The customer is displayed",
    });

    expect(result.requirements).toEqual([]);
  });

  it("preserves parser conflicts for repeated keys with different metadata", () => {
    const result = extractTestRailInputRequirements({
      id: 102,
      title: "Fixture",
      custom_preconds: "Customer id (customer.id, text)\nSecret id (customer.id, secret)",
    });

    expect(result.requirements).toHaveLength(1);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].key).toBe("customer.id");
  });

  it("does not infer requirements from natural language", () => {
    const result = extractTestRailInputRequirements({
      id: 103,
      title: "Fixture",
      custom_preconds: "Provide the password and user identifier",
      custom_steps_separated: [{ content: "Enter the RNC", expected: "Continue" }],
    });

    expect(result.requirements).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });
});
