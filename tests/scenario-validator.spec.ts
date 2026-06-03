import { test, expect } from "@playwright/test";
import { validateScenario } from "../src/scenarios/scenario-validator";
import type { McpScenario, McpRouteProfile } from "../src/scenarios/scenario-types";

function makeScenario(overrides: Partial<McpScenario> = {}): McpScenario {
  return {
    sourceIssueKey: "AA-123",
    title: "Test scenario",
    steps: ['1. Clic en "Iniciar".', '2. Validar que se muestre "X".'],
    preconditions: ["1. AuthGate habilitado."],
    expectedResult: "Test result",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug: "kiosko",
    routeProfile: "test",
    dataRequirements: "cliente_fixture",
    nonExecutableCriteria: "",
    mcpExecutable: true,
    ...overrides,
  };
}

// ── Multi-word ordinals ───────────────────────────────────────────

test("validator: accepts 'Seleccionar el primer depósito visible del listado'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar el primer depósito visible del listado.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

test("validator: accepts 'Seleccionar el primer deposito visible del listado' (no accent)", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar el primer deposito visible del listado.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

test("validator: accepts 'Seleccionar el primer depósito a plazo visible del listado'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar el primer depósito a plazo visible del listado.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

test("validator: accepts 'Seleccionar la primera tarjeta visible del listado'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar la primera tarjeta visible del listado.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

test("validator: accepts 'Seleccionar la primera tarjeta de crédito visible del listado'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar la primera tarjeta de crédito visible del listado.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

test("validator: accepts 'Seleccionar la primera cuenta de ahorro visible del listado'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar la primera cuenta de ahorro visible del listado.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

test("validator: accepts 'Seleccionar el primer préstamo personal visible del listado'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar el primer préstamo personal visible del listado.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

test("validator: accepts 'Seleccionar el ultimo producto visible del listado' (no accent)", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar el ultimo producto visible del listado.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

test("validator: accepts 'Seleccionar el último producto visible del listado'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar el último producto visible del listado.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

test("validator: rejects 'Seleccionar uno cualquiera'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar uno cualquiera.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(false);
  expect(result.errors.some((e) => e.includes("MCP pattern"))).toBe(true);
});

test("validator: rejects 'Seleccionar lo que aparezca'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar lo que aparezca.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(false);
});

test("validator: rejects 'Seleccionar el producto correcto'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      "2. Seleccionar el producto correcto.",
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(false);
});

// ── Sensitive actions ─────────────────────────────────────────────

test("validator: rejects 'Clic en \"Solicitar\"'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      '2. Clic en "Solicitar".',
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(false);
  expect(result.errors.some((e) => e.includes("sensitive_action"))).toBe(true);
});

test("validator: rejects 'Clic en \"Confirmar\"'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      '2. Clic en "Confirmar".',
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(false);
  expect(result.errors.some((e) => e.includes("sensitive_action"))).toBe(true);
});

test("validator: rejects 'Clic en \"Pagar\"'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      '2. Clic en "Pagar".',
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(false);
  expect(result.errors.some((e) => e.includes("sensitive_action"))).toBe(true);
});

test("validator: accepts 'Validar que el botón \"Solicitar\" esté visible'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      '2. Validar que el botón "Solicitar" esté visible.',
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

test("validator: accepts 'Validar que el botón \"Confirmar\" esté deshabilitado'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      '2. Validar que el botón "Confirmar" esté deshabilitado.',
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

test("validator: accepts 'Validar que se muestre \"Solicitar\"'", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      '2. Validar que se muestre "Solicitar".',
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
});

// ── Entry step validation ─────────────────────────────────────────

test("validator: rejects scenario missing required entry step", () => {
  const routeProfile: McpRouteProfile = {
    name: "informacion_productos",
    entry: [
      { businessLabel: "iniciar", visibleLabel: "Iniciar" },
      { businessLabel: "informacion_productos", visibleLabel: "Información de productos" },
    ],
    aliases: {},
    intermediates: {},
    domainTerms: {},
    visibleControls: [],
    representativeFixture: {},
    notes: [],
  };

  const scenario = makeScenario({
    steps: [
      '1. Clic en "Información de productos".',
      '2. Validar que se muestre "Tarjetas de crédito".',
    ],
  });

  const result = validateScenario(scenario, routeProfile);
  expect(result.valid).toBe(false);
  expect(result.errors.some((e) => e.includes("missing_required_entry_step"))).toBe(true);
});

test("validator: accepts scenario with correct entry step", () => {
  const routeProfile: McpRouteProfile = {
    name: "informacion_productos",
    entry: [
      { businessLabel: "iniciar", visibleLabel: "Iniciar" },
      { businessLabel: "informacion_productos", visibleLabel: "Información de productos" },
    ],
    aliases: {},
    intermediates: {},
    domainTerms: {},
    visibleControls: [],
    representativeFixture: {},
    notes: [],
  };

  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      '2. Clic en "Información de productos".',
      '3. Validar que se muestre "Tarjetas de crédito".',
    ],
  });

  const result = validateScenario(scenario, routeProfile);
  expect(result.valid).toBe(true);
});

// ── UTF-8 preservation ────────────────────────────────────────────

test("validator: handles UTF-8 correctly in steps", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Iniciar".',
      '2. Validar que se muestre "Tarjetas de crédito".',
      '3. Validar que se muestre "Depósitos a Plazo".',
      '4. Validar que se muestre "Préstamos".',
      '5. Validar que se muestre "Cuentas de Efectivo".',
    ],
  });
  const result = validateScenario(scenario);
  expect(result.valid).toBe(true);
  expect(result.errors).toHaveLength(0);
});
