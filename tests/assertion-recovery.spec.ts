import { test, expect } from "@playwright/test";
import {
  attemptAssertionRecovery,
  classifyAssertionImportance,
  detectConditionalAssertionRisk,
} from "../src/discovery/assertion-recovery";
import type { PageSnapshot } from "../src/types/page-snapshot.types";
import type { McpRouteProfile } from "../src/scenarios/scenario-types";

function makeSnapshot(elements: Array<{ text?: string; label?: string; name?: string }>): PageSnapshot {
  return {
    version: "1.0",
    url: "https://example.com",
    title: "Test Page",
    capturedAt: new Date().toISOString(),
    elements: elements.map((el, i) => ({
      id: `el-${i}`,
      type: "text",
      role: "generic",
      tagName: "span",
      text: el.text,
      label: el.label,
      name: el.name,
      placeholder: undefined,
      value: undefined,
      visible: true,
      enabled: true,
      candidateLocators: [],
      dataHints: [],
    })),
    summary: {
      totalElements: elements.length,
      buttons: 0,
      inputs: 0,
      links: 0,
      selects: 0,
      tables: 0,
      dialogs: 0,
      headings: 0,
    },
  };
}

function makeRouteProfile(aliases?: Record<string, string | string[]>): McpRouteProfile {
  return {
    name: "test_profile",
    entry: [],
    aliases: aliases ?? {},
    intermediates: {},
    domainTerms: {},
    visibleControls: ["Volver", "Finalizar sesión", "Solicitar"],
    representativeFixture: {},
    notes: [],
  };
}

// ── attemptAssertionRecovery tests ──

test("assertion recovery finds accent-insensitive match", () => {
  const snapshot = makeSnapshot([{ text: "Préstamos personales" }]);
  const result = attemptAssertionRecovery(snapshot, "Prestamos personales");

  expect(result.recovered).toBe(true);
  expect(result.decision).toBe("recovered_accent_insensitive");
  expect(result.matchedText).toBe("Préstamos personales");
  expect(result.confidence).toBeGreaterThanOrEqual(0.85);
});

test("assertion recovery uses alias from routeProfile", () => {
  const snapshot = makeSnapshot([{ text: "USD" }]);
  const routeProfile = makeRouteProfile({
    dolares: ["Dólares", "USD", "Dólares estadounidenses"],
  });
  const result = attemptAssertionRecovery(snapshot, "dolares", { routeProfile });

  expect(result.recovered).toBe(true);
});

test("assertion recovery handles plural/singular variants", () => {
  const snapshot = makeSnapshot([{ text: "Tarjetas" }]);
  const result = attemptAssertionRecovery(snapshot, "Tarjetas");

  expect(result.recovered).toBe(true);
  expect(result.decision).toBe("recovered_accent_insensitive");
});

test("assertion recovery uses visibleControls", () => {
  const snapshot = makeSnapshot([{ text: "Volver" }]);
  const routeProfile = makeRouteProfile();
  const result = attemptAssertionRecovery(snapshot, "Volver", { routeProfile });

  expect(result.recovered).toBe(true);
});

test("assertion recovery handles conditional variants", () => {
  const snapshot = makeSnapshot([{ text: "No disponible" }]);
  const result = attemptAssertionRecovery(snapshot, "no está disponible");

  expect(result.recovered).toBe(true);
  expect(result.decision).toBe("recovered_conditional_variant");
});

test("assertion recovery returns not_recovered when no match", () => {
  const snapshot = makeSnapshot([{ text: "Something else" }]);
  const result = attemptAssertionRecovery(snapshot, "completely different text");

  expect(result.recovered).toBe(false);
  expect(result.decision).toBe("not_recovered");
  expect(result.recoveryAttempts.length).toBeGreaterThan(0);
});

// ── classifyAssertionImportance tests ──

test("classifyAssertionImportance: blocking when in title", () => {
  const importance = classifyAssertionImportance("Tarjetas de crédito", {
    scenarioTitle: "Visualizar Tarjetas de crédito",
  });

  expect(importance).toBe("blocking");
});

test("classifyAssertionImportance: blocking when in expectedResult", () => {
  const importance = classifyAssertionImportance("Préstamos personales", {
    expectedResult: "Se muestran Préstamos personales",
  });

  expect(importance).toBe("blocking");
});

test("classifyAssertionImportance: optional for conditional language", () => {
  const importance = classifyAssertionImportance("si está disponible");

  expect(importance).toBe("optional");
});

test("classifyAssertionImportance: optional for 'no está disponible'", () => {
  const importance = classifyAssertionImportance("no está disponible");

  expect(importance).toBe("optional");
});

test("classifyAssertionImportance: contextual for routeProfile labels", () => {
  const routeProfile = makeRouteProfile();
  const importance = classifyAssertionImportance("Volver", { routeProfile });

  expect(importance).toBe("contextual");
});

test("classifyAssertionImportance: contextual for secondary buttons when not primary objective", () => {
  const importance = classifyAssertionImportance("Solicitar", {
    scenarioTitle: "Visualizar detalle del producto",
    expectedResult: "Se muestra el detalle completo del producto",
    routeProfile: makeRouteProfile(),
  });

  expect(importance).toBe("contextual");
});

test("classifyAssertionImportance: blocking for secondary button when explicit objective", () => {
  const importance = classifyAssertionImportance("Solicitar", {
    scenarioTitle: "Solicitar producto",
    expectedResult: "Se debe poder Solicitar el producto",
    routeProfile: makeRouteProfile(),
  });

  expect(importance).toBe("blocking");
});

// ── detectConditionalAssertionRisk tests ──

test("detectConditionalAssertionRisk: high risk without dataRequirement", () => {
  const risk = detectConditionalAssertionRisk("no está disponible");

  expect(risk.isConditional).toBe(true);
  expect(risk.risk).toBe("high");
  expect(risk.reason).toContain("without_data_requirement");
});

test("detectConditionalAssertionRisk: low risk with dataRequirement", () => {
  const risk = detectConditionalAssertionRisk("no está disponible", {
    dataRequirement: "product must be unavailable",
  });

  expect(risk.isConditional).toBe(true);
  expect(risk.risk).toBe("low");
  expect(risk.reason).toContain("with_data_requirement");
});

test("detectConditionalAssertionRisk: not conditional for normal assertion", () => {
  const risk = detectConditionalAssertionRisk("Tarjetas de crédito");

  expect(risk.isConditional).toBe(false);
  expect(risk.risk).toBe("low");
});
