import { expect, test } from "@playwright/test";
import { findBestElementForStep } from "../src/plans/snapshot-step-matcher";
import type { PageSnapshot } from "../src/types/page-snapshot.types";

const baseSnapshot: PageSnapshot = {
  version: "1.0",
  url: "https://example.com",
  title: "Example",
  capturedAt: new Date().toISOString(),
  elements: [
    {
      id: "e1",
      type: "input",
      label: "Cédula",
      visible: true,
      candidateLocators: [{ strategy: "label", value: "Cédula", confidence: 0.85 }],
      dataHints: ["cedula"]
    },
    {
      id: "e2",
      type: "input",
      placeholder: "Código OTP",
      visible: true,
      candidateLocators: [{ strategy: "placeholder", value: "Código OTP", confidence: 0.8 }],
      dataHints: ["codigo", "otp"]
    },
    {
      id: "e3",
      type: "button",
      text: "Consultar",
      visible: true,
      candidateLocators: [{ strategy: "text", value: "Consultar", confidence: 0.75 }],
      dataHints: []
    }
  ],
  summary: { totalElements: 3, buttons: 1, links: 0, inputs: 2, selects: 0, tables: 0, dialogs: 0, headings: 0 }
};

test("matches by label", () => {
  const result = findBestElementForStep("Ingresar cedula", baseSnapshot, ["input"]);
  expect(result.element?.id).toBe("e1");
});

test("matches by placeholder", () => {
  const result = findBestElementForStep("Escribir OTP", baseSnapshot, ["input"]);
  expect(result.element?.id).toBe("e2");
});

test("matches by text", () => {
  const result = findBestElementForStep("Presionar Consultar", baseSnapshot, ["button"]);
  expect(result.element?.id).toBe("e3");
});

test("preferred type increases confidence", () => {
  const withBonus = findBestElementForStep("Consultar", baseSnapshot, ["button"]);
  const withoutBonus = findBestElementForStep("Consultar", baseSnapshot, ["input"]);
  expect(withBonus.confidence).toBeGreaterThan(withoutBonus.confidence);
});

test("disabled element is penalized", () => {
  const snapshot = { ...baseSnapshot, elements: [{ ...baseSnapshot.elements[0], disabled: true }] };
  const result = findBestElementForStep("Ingresar cedula", snapshot, ["input"]);
  expect(result.confidence).toBeLessThan(0.8);
});

test("no candidate locators penalizes confidence", () => {
  const snapshot = { ...baseSnapshot, elements: [{ ...baseSnapshot.elements[0], candidateLocators: [] }] };
  const result = findBestElementForStep("Ingresar cedula", snapshot, ["input"]);
  expect(result.confidence).toBeLessThan(0.8);
});
