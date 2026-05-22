import { test, expect } from "@playwright/test";
import { detectAuthGate } from "../src/discovery/auth-gate-detector";
import type { PageSnapshot } from "../src/types/page-snapshot.types";

function makeSnapshot(elements: Array<{ text?: string; className?: string; tagName?: string }>): PageSnapshot {
  return {
    url: "https://example.com",
    title: "Test Page",
    elements: elements as any,
    summary: {
      totalElements: elements.length,
      buttons: elements.filter(e => e.tagName === "button").length,
      inputs: elements.filter(e => e.tagName === "input").length
    }
  } as PageSnapshot;
}

test("detects identification_input with 'Número de identificación' + 'Ingrese el número'", () => {
  const snapshot = makeSnapshot([
    { text: "Número de identificación", tagName: "label" },
    { text: "Ingrese el número", tagName: "p" },
    { className: "virtual-keyboard numeric-keypad", tagName: "div" },
    { text: "Continuar", tagName: "button" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(true);
  expect(result.stage).toBe("identification_input");
  expect(result.requiredInputs).toContain("identificationNumber");
  expect(result.confidence).toBeGreaterThanOrEqual(0.6);
});

test("identification_input requires identificationNumber", () => {
  const snapshot = makeSnapshot([
    { text: "Numero de identificacion", tagName: "label" },
    { text: "Ingrese el numero", tagName: "p" },
    { className: "keypad-container", tagName: "div" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(true);
  expect(result.stage).toBe("identification_input");
  expect(result.requiredInputs).toEqual(["identificationNumber"]);
});

test("detects identification_input with numeric buttons even without explicit class", () => {
  const snapshot = makeSnapshot([
    { text: "Número de identificación", tagName: "label" },
    { text: "0", tagName: "button" },
    { text: "1", tagName: "button" },
    { text: "2", tagName: "button" },
    { text: "3", tagName: "button" },
    { text: "4", tagName: "button" },
    { text: "5", tagName: "button" },
    { text: "6", tagName: "button" },
    { text: "7", tagName: "button" },
    { text: "8", tagName: "button" },
    { text: "9", tagName: "button" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(true);
  expect(result.stage).toBe("identification_input");
  expect(result.hasVirtualKeyboard).toBe(false);
});

test("does not confuse identification_type_selection with identification_input", () => {
  const snapshot = makeSnapshot([
    { text: "Identificación del cliente", tagName: "h2" },
    { text: "Seleccione su tipo de identificación", tagName: "p" },
    { text: "Cédula de identidad dominicana", tagName: "button" },
    { text: "Pasaporte extranjero", tagName: "button" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(true);
  expect(result.stage).toBe("identification_type_selection");
  expect(result.requiredInputs).toContain("identificationType");
  expect(result.requiredInputs).not.toContain("identificationNumber");
});

test("detects OTP with virtual keyboard", () => {
  const snapshot = makeSnapshot([
    { text: "Código OTP", tagName: "h2" },
    { text: "Ingrese el código", tagName: "p" },
    { className: "virtual-keyboard numeric-keypad", tagName: "div" },
    { text: "Confirmar código", tagName: "button" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(true);
  expect(result.stage).toBe("otp");
  expect(result.requiredInputs).toContain("otp");
  expect(result.hasVirtualKeyboard).toBe(true);
});

test("reports continueButtonPresent when continuar button exists", () => {
  const snapshot = makeSnapshot([
    { text: "Número de identificación", tagName: "label" },
    { text: "Ingrese el número", tagName: "p" },
    { className: "virtual-keyboard", tagName: "div" },
    { text: "Continuar", tagName: "button" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.continueButtonPresent).toBe(true);
});

test("reports hasNativeInput when input elements exist", () => {
  const snapshot = makeSnapshot([
    { text: "Número de identificación", tagName: "label" },
    { tagName: "input" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.hasNativeInput).toBe(true);
});

test("masked identificationNumber shows last 4 digits", () => {
  const { maskValue } = require("../src/discovery/auth-input-resolver");
  expect(maskValue("40224679551")).toBe("*******9551");
  expect(maskValue("1234")).toBe("****");
  expect(maskValue("123")).toBe("****");
  expect(maskValue("")).toBe("");
});
