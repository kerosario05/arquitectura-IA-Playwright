import { test, expect } from "@playwright/test";
import { deriveDataRequirements } from "../src/scenarios/scenario-data-requirements";

test("TEST1 Amount=100 Reference=ABC123", () => {
  const reqs = deriveDataRequirements({
    huText: 'Capturar Amount con 100 y Capturar Reference con ABC123',
    explicitFields: [
      { label: "Amount", suggestedValue: "100", source: "hu_explicit" },
      { label: "Reference", suggestedValue: "ABC123", source: "hu_explicit" },
    ],
  });
  expect(reqs.find(r=>r.label==="Amount")?.suggestedValue).toBe("100");
  expect(reqs.find(r=>r.label==="Reference")?.suggestedValue).toBe("ABC123");
  expect(reqs.length).toBe(2);
  expect(reqs.every(r=>r.required && r.editable)).toBe(true);
});

test("TEST2 Customer Code without value", () => {
  const reqs = deriveDataRequirements({
    explicitFields: [{ label: "Customer Code", source: "hu_implied" }],
  });
  const r = reqs.find(x=>x.label==="Customer Code")!;
  expect(r.required).toBe(true);
  expect(r.editable).toBe(true);
  expect(r.suggestedValue).toBeUndefined();
});

test("TEST3 runtime dynamic excluded", () => {
  const reqs = deriveDataRequirements({
    explicitFields: [
      { label: "Available Account", source: "runtime_dynamic", runtime: true },
      { label: "Amount", suggestedValue: "100", source: "hu_explicit" },
    ],
  });
  expect(reqs.find(r=>r.label==="Available Account")).toBeUndefined();
  expect(reqs.find(r=>r.label==="Amount")).toBeDefined();
});

test("TEST4 project_config credentials excluded", () => {
  const reqs = deriveDataRequirements({
    explicitFields: [
      { label: "Usuario", source: "project_config", kind: "credential" },
      { label: "Contraseña", source: "project_config", kind: "credential" },
      { label: "Amount", suggestedValue: "100", source: "hu_explicit" },
    ],
  });
  expect(reqs.find(r=>r.label==="Usuario")).toBeUndefined();
  expect(reqs.find(r=>r.label==="Contraseña")).toBeUndefined();
  expect(reqs.length).toBe(1);
  expect(reqs[0].label).toBe("Amount");
});

test("dedupe organization id case insensitive", () => {
  const reqs = deriveDataRequirements({
    explicitFields: [
      { label: "Organization ID", source: "hu_explicit" },
      { label: "organization id", source: "hu_explicit" },
    ],
  });
  expect(reqs.length).toBe(1);
  expect(reqs[0].key).toBe("organization_id");
});

test("jit secret OTP excluded", () => {
  const reqs = deriveDataRequirements({
    explicitFields: [
      { label: "OTP", source: "jit_secret", kind: "jit_secret" },
      { label: "Reference", suggestedValue: "ABC", source: "hu_explicit" },
    ],
  });
  expect(reqs.find(r=>r.label==="OTP")).toBeUndefined();
});

test("EXT TEST1 Amount type number", () => {
  const reqs = deriveDataRequirements({
    explicitFields: [{ label: "Amount", suggestedValue: "100", source: "hu_explicit", controlType: "number", type: "number" }],
  });
  const r = reqs.find(x=>x.label==="Amount")!;
  expect(r.controlType).toBe("number");
  expect(r.suggestedValue).toBe("100");
});

test("EXT TEST2 Access Type select with selected Business", () => {
  const reqs = deriveDataRequirements({
    explicitFields: [{ label: "Access Type", source: "hu_explicit", controlType: "select", options: ["Individual","Business"], optionsSource: "hu_explicit", suggestedValue: "Business" }],
  });
  const r = reqs.find(x=>x.label==="Access Type")!;
  expect(r.controlType).toBe("select");
  expect(r.options).toEqual(["Individual","Business"]);
  expect(r.optionsSource).toBe("hu_explicit");
  expect(r.suggestedValue).toBe("Business");
});

test("EXT TEST3 select observed without reliable selection", () => {
  const reqs = deriveDataRequirements({
    explicitFields: [{ label: "Access Type", source: "scenario", controlType: "select", options: ["Individual","Business"], optionsSource: "runtime_observed" }],
  });
  const r = reqs.find(x=>x.label==="Access Type")!;
  expect(r.controlType).toBe("select");
  expect(r.options).toEqual(["Individual","Business"]);
  expect(r.suggestedValue).toBeUndefined();
});

test("EXT TEST4 runtime_dynamic multiple values still excluded", () => {
  const reqs = deriveDataRequirements({
    explicitFields: [
      { label: "Available Accounts", source: "runtime_dynamic", runtime: true, options: ["Acc1","Acc2"], optionsSource: "runtime_observed" },
      { label: "Amount", suggestedValue: "100", source: "hu_explicit", controlType: "number" },
    ],
  });
  expect(reqs.find(r=>r.label==="Available Accounts")).toBeUndefined();
  expect(reqs.find(r=>r.label==="Amount")?.controlType).toBe("number");
});
