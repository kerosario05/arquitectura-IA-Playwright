import { test, expect } from "@playwright/test";
import { deriveRequiredAuthFields } from "../src/discovery/auth-variant-discovery";

test("TEST1 auth fields before business excluded", () => {
  const scenario: any = {
    authIntent: "full_authentication",
    authFields: ["Organization ID","User","Password"],
    businessFields: ["Transfers"],
  };
  const fields = deriveRequiredAuthFields({ scenario });
  expect(fields).toEqual(expect.arrayContaining(["Organization ID","User","Password"]));
  expect(fields).not.toContain("Transfers");
  expect(fields.length).toBe(3);
});

test("TEST2 requiredData contains auth fields not in prerequisite", () => {
  const scenario: any = {
    authIntent: "full_authentication",
    dataRequirements: [
      { label: "FieldA", source: "hu_model", kind: "auth", scope: "authentication" },
      { label: "FieldB", source: "hu_model", kind: "input", scope: "authentication" },
    ],
    steps: ['Clic en "Transfers"'],
  };
  const huDeclaredItems: any[] = [];
  const fields = deriveRequiredAuthFields({ scenario, huDeclaredItems });
  expect(fields.length).toBeGreaterThan(0);
  expect(fields).toEqual(expect.arrayContaining(["FieldA","FieldB"]));
});

test("TEST3 business Amount/Destination/Comment not contaminate", () => {
  const scenario: any = {
    authIntent: "full_authentication",
    authFields: ["Organization ID","User","Password"],
    businessFields: ["Amount","Destination","Comment"],
    steps: ['Ingresar "Organization ID"', 'Clic en "Transfers"'],
  };
  const fields = deriveRequiredAuthFields({ scenario });
  expect(fields).not.toContain("Amount");
  expect(fields).not.toContain("Destination");
  expect(fields).not.toContain("Comment");
  expect(fields).toEqual(expect.arrayContaining(["Organization ID","User","Password"]));
});

test("AA-95 regression without structured source now failClosed", () => {
  const scenario: any = {
    authIntent: "full_authentication",
    steps: ['Clic en "Transferencias"'],
  };
  const huDeclaredItems = [
    { category:"branch", sourceText:"transferencias" },
    { category:"branch", sourceText:"cuentas propias" },
  ];
  const fields = deriveRequiredAuthFields({ scenario, huDeclaredItems });
  expect(fields.length).toBe(0); // no structured auth source → failClosed, gap reported
});
