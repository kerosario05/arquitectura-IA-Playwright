import { describe, expect, it } from "vitest";
import { proposeTestRailInputRequirements } from "./testrail-requirement-proposal-engine";
import { transformTestRailCaseForRuntime } from "./testrail-runtime-transformer";

function converted(requirements: any[] = []) {
  return {
    caseId: 301,
    requirements,
    unresolvedPlaceholders: [],
    conflicts: [],
    status: requirements.length > 0 ? "proposed" as const : "empty" as const,
    requiresApproval: true as const,
  };
}

describe("TestRail requirement proposal engine", () => {
  it("proposes a sensitive password input when the placeholder has password context", () => {
    const result = proposeTestRailInputRequirements({
      rawCase: {
        id: 301,
        title: "Login",
        custom_steps: "Introducir Contraseña [auth.password] en el campo de acceso",
      },
      converterOutput: converted(),
    });

    expect(result.proposals).toEqual([expect.objectContaining({
      key: "auth.password",
      label: "Contraseña",
      controlType: "password",
      sensitive: true,
    })]);
    expect(result.proposals[0].confidence).toBeGreaterThan(0);
  });

  it("leaves a placeholder without enough context unresolved", () => {
    const result = proposeTestRailInputRequirements({
      rawCase: { id: 302, title: "Fixture", custom_expected: "Use [auth.value]" },
      converterOutput: converted(),
    });

    expect(result.proposals).toEqual([expect.objectContaining({
      key: "auth.value",
      label: "Value",
      inputUsage: ["expected"],
      inputRole: "scenario",
    })]);
    expect(result.unresolved).toEqual([]);
  });

  it("does not propose a duplicate for an existing requirement", () => {
    const result = proposeTestRailInputRequirements({
      rawCase: { id: 303, title: "Fixture", custom_steps: "Contraseña [auth.password]" },
      converterOutput: converted([{ key: "auth.password", label: "Password", controlType: "password", sensitive: true }]),
    });

    expect(result.proposals).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it("does not write externally", () => {
    const result = proposeTestRailInputRequirements({
      rawCase: { id: 304, title: "Fixture", custom_steps: "Use [auth.value]" },
      converterOutput: converted(),
    });

    expect(result).toMatchObject({ requiresApproval: true });
  });

  it("isolates labels to the placeholder occurrence in each step", () => {
    const result = proposeTestRailInputRequirements({
      rawCase: {
        id: 305,
        title: "Fixture",
        custom_steps: [
          'Ingresar [account.identifier] en el campo "Identificador"',
          'Ingresar [account.user] en el campo "Usuario"',
          'Ingresar [account.secret] en el campo "Clave"',
        ].join("\n"),
      },
      converterOutput: converted(),
    });

    expect(result.proposals.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "account.identifier", label: "Identificador" },
      { key: "account.user", label: "Usuario" },
      { key: "account.secret", label: "Clave" },
    ]);
  });

  it("does not leak later password context into an earlier placeholder", () => {
    const result = proposeTestRailInputRequirements({
      rawCase: {
        id: 306,
        title: "Fixture",
        custom_steps: 'Ingresar [auth.username] en el campo "Usuario"\nIngresar [auth.password] en el campo "Contraseña"',
      },
      converterOutput: converted(),
    });

    expect(result.proposals.find((proposal) => proposal.key === "auth.username")).toMatchObject({
      label: "Usuario",
      controlType: "text",
    });
  });

  it("leaves a placeholder unresolved when its local context is insufficient", () => {
    const result = proposeTestRailInputRequirements({
      rawCase: { id: 307, title: "Fixture", custom_steps: "Use [account.value]" },
      converterOutput: converted(),
    });

    expect(result.proposals).toEqual([]);
    expect(result.unresolved).toEqual(["account.value"]);
  });

  it("keeps distinct keys even when labels happen to match", () => {
    const result = proposeTestRailInputRequirements({
      rawCase: {
        id: 308,
        title: "Fixture",
        custom_steps: 'Ingresar [account.one] en el campo "Dato"\nIngresar [account.two] en el campo "Dato"',
      },
      converterOutput: converted(),
    });

    expect(result.proposals.map((proposal) => proposal.key)).toEqual(["account.one", "account.two"]);
  });

  it("includes action and expected-only keys independently by structured key", () => {
    const result = proposeTestRailInputRequirements({
      rawCase: {
        id: 44759,
        title: "Repeated dataset fixture",
        custom_steps: "Ingresar [dataset_1.document] y luego ingresar [dataset_2.document]",
        custom_expected: "Verificar [dataset_1.expected_name] y [dataset_2.expected_name]",
      },
      converterOutput: converted(),
    });

    expect(result.proposals.map((proposal) => proposal.key)).toEqual([
      "dataset_1.document",
      "dataset_2.document",
      "dataset_1.expected_name",
      "dataset_2.expected_name",
    ]);
    expect(result.proposals.filter((proposal) => proposal.inputUsage?.includes("expected"))).toHaveLength(2);
    expect(result.unresolved).toEqual([]);
  });

  it("keeps contract requirements ahead of an inferred proposal with the same key", () => {
    const result = transformTestRailCaseForRuntime(
      { id: 309, title: "Fixture", custom_preconds: "Usuario (auth.user, text)" } as any,
      {
        propose: () => ({
          proposals: [{ key: "auth.user", label: "Otro", controlType: "password", confidence: 0.9, evidence: "fixture" }],
          unresolved: [],
          requiresApproval: true,
        }),
      },
    );

    expect(result.inputRequirements).toEqual([expect.objectContaining({ key: "auth.user", source: "contract" })]);
  });
});
