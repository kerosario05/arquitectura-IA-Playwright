import { describe, expect, it } from "vitest";
import {
  applyInputRequirementsToPreconditions,
  buildInputRequirementsContractSection,
} from "./testrail-input-requirements-writer";

const requirements = [{
  key: "auth.username",
  label: "Usuario de acceso",
  controlType: "text",
  required: true,
  sensitive: false,
}] as any;

describe("TestRail input requirements writer", () => {
  it("preserves existing human preconditions and adds the contract section", () => {
    const result = applyInputRequirementsToPreconditions({ custom_preconds: "Usuario debe estar activo." } as any, requirements);

    expect(result).toContain("Usuario debe estar activo.");
    expect(result).toContain("Datos de ejecución requeridos:");
    expect(result).toContain("Usuario de acceso (auth.username, text, required)");
  });

  it("is idempotent when applied twice", () => {
    const once = applyInputRequirementsToPreconditions({ custom_preconds: "Precondición humana." } as any, requirements);
    const twice = applyInputRequirementsToPreconditions({ custom_preconds: once } as any, requirements);

    expect(twice).toBe(once);
    expect((twice.match(/Datos de ejecución requeridos:/g) ?? []).length).toBe(1);
  });

  it("replaces only an existing contractual section", () => {
    const oldRequirements = [{ key: "old.key", label: "Old", controlType: "text", required: true }] as any;
    const existing = applyInputRequirementsToPreconditions({ custom_preconds: "Humano antes." } as any, oldRequirements);
    const replaced = applyInputRequirementsToPreconditions({ custom_preconds: `${existing}\nHumano después.` } as any, requirements);

    expect(replaced).toContain("Humano antes.");
    expect(replaced).toContain("Humano después.");
    expect(replaced).not.toContain("old.key");
    expect(replaced).toContain("auth.username");
  });

  it("serializes required and sensitive flags without inventing allowed values", () => {
    const section = buildInputRequirementsContractSection([{
      key: "auth.password",
      label: "Contraseña de acceso",
      controlType: "password",
      required: true,
      sensitive: true,
      allowedValues: ["must-not-be-serialized"],
    }]);

    expect(section).toContain("Contraseña de acceso (auth.password, password, required, sensitive)");
    expect(section).not.toContain("must-not-be-serialized");
  });
});
