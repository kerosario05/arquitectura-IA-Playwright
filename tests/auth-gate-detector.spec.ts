import { test, expect } from "@playwright/test";
import { detectAuthGate } from "../src/discovery/auth-gate-detector";
import type { PageSnapshot } from "../src/types/page-snapshot.types";
import { isLikelyAuthGate, buildAuthFlowSpecImport, buildAuthFlowInstantiation, buildAuthFlowCall } from "../src/discovery/auth-flow-helpers";

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

// ==========================================
// AuthGateDetector tests
// ==========================================

test("detects identification type selection screen", () => {
  const snapshot = makeSnapshot([
    { text: "Identificación del cliente", tagName: "h2" },
    { text: "Seleccione su tipo de identificación", tagName: "p" },
    { text: "Cédula de identidad dominicana", tagName: "button" },
    { text: "Pasaporte extranjero", tagName: "button" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(true);
  expect(result.stage).toBe("identification_type_selection");
  expect(result.gateType).toBe("customer_identification_otp");
  expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  expect(result.evidence.length).toBeGreaterThan(0);
  expect(result.requiredInputs).toContain("identificationType");
});

test("detects identification input screen with virtual keyboard", () => {
  const snapshot = makeSnapshot([
    { text: "Número de identificación", tagName: "label" },
    { text: "Ingrese el número", tagName: "p" },
    { className: "virtual-keyboard numeric-keypad", tagName: "div" },
    { text: "Continuar", tagName: "button" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(true);
  expect(result.stage).toBe("identification_input");
  expect(result.gateType).toBe("customer_identification_otp");
  expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  expect(result.requiredInputs).toContain("identificationNumber");
  expect(result.hasVirtualKeyboard).toBe(true);
  expect(result.continueButtonPresent).toBe(true);
});

test("detects phone confirmation screen", () => {
  const snapshot = makeSnapshot([
    { text: "Confirmar número de teléfono", tagName: "h2" },
    { text: "Estaremos enviándole un código de verificación", tagName: "p" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(true);
  expect(result.stage).toBe("phone_confirmation");
  expect(result.gateType).toBe("customer_identification_otp");
});

test("detects OTP screen", () => {
  const snapshot = makeSnapshot([
    { text: "Código OTP", tagName: "h2" },
    { text: "Ingrese el código de verificación", tagName: "p" },
    { text: "Confirmar código", tagName: "button" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(true);
  expect(result.stage).toBe("otp");
  expect(result.gateType).toBe("customer_identification_otp");
});

test("does not detect auth gate on functional screen", () => {
  const snapshot = makeSnapshot([
    { text: "Generar cartas", tagName: "h2" },
    { text: "Carta de referencia", tagName: "button" },
    { text: "Cuenta de ahorro", tagName: "button" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(false);
});

test("does not detect auth gate on product list", () => {
  const snapshot = makeSnapshot([
    { text: "Tarjetas", tagName: "h2" },
    { text: "Tarjeta de Crédito Visa Gold", tagName: "button" },
    { text: "Tarjeta de Crédito Visa Platinum", tagName: "button" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(false);
});

test("detects OTP with virtual keyboard indicator", () => {
  const snapshot = makeSnapshot([
    { text: "Código de Verificación", tagName: "h2" },
    { className: "otp-input-container otp-field", tagName: "div" },
    { className: "virtual-keypad numeric-keyboard", tagName: "div" }
  ]);

  const result = detectAuthGate(snapshot);
  expect(result.detected).toBe(true);
  expect(result.stage).toBe("otp");
});

// ==========================================
// isLikelyAuthGate tests
// ==========================================

test("isLikelyAuthGate returns true for identification text", () => {
  expect(isLikelyAuthGate("Identificación del cliente")).toBe(true);
  expect(isLikelyAuthGate("identificacion del cliente")).toBe(true);
});

test("isLikelyAuthGate returns true for OTP text", () => {
  expect(isLikelyAuthGate("Código OTP")).toBe(true);
  expect(isLikelyAuthGate("codigo otp")).toBe(true);
});

test("isLikelyAuthGate returns true for phone confirmation text", () => {
  expect(isLikelyAuthGate("Confirmar número de teléfono")).toBe(true);
});

test("isLikelyAuthGate returns false for functional text", () => {
  expect(isLikelyAuthGate("Generar cartas")).toBe(false);
  expect(isLikelyAuthGate("Tarjeta de Crédito")).toBe(false);
  expect(isLikelyAuthGate("Cuenta de ahorro")).toBe(false);
});

// ==========================================
// AuthFlow spec generation tests
// ==========================================

test("buildAuthFlowSpecImport generates correct import", () => {
  const import1 = buildAuthFlowSpecImport("default");
  expect(import1).toContain("AuthFlow");
  expect(import1).toContain("setAuthFlowTestData");
  expect(import1).toContain("auth.flow");
});

test("buildAuthFlowInstantiation generates correct code", () => {
  const code = buildAuthFlowInstantiation();
  expect(code).toContain("new AuthFlow(page)");
});

test("buildAuthFlowCall generates correct call with options", () => {
  const code = buildAuthFlowCall({ alias: "defaultClient", landing: "transactions_menu" });
  expect(code).toContain("ensureAuthenticated");
  expect(code).toContain("defaultClient");
  expect(code).toContain("transactions_menu");
});

test("buildAuthFlowCall generates call with minimal options", () => {
  const code = buildAuthFlowCall({});
  expect(code).toContain("ensureAuthenticated");
});
