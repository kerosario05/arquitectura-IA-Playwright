import { expect, test } from "@playwright/test";
import {
  extractDataHintsFromText,
  normalizeTestRailCase,
  normalizeTestRailCases
} from "../src/testrail/testrail-normalizer";
import type { RawTestRailCase } from "../src/types/testrail.types";

test("normalizes custom_steps_separated into separated steps", () => {
  const rawCase: RawTestRailCase = {
    id: 101,
    title: "Validar transferencia",
    custom_steps_separated: [
      { content: "Ingresar cédula", expected: "Cédula aceptada" },
      { content: "Ingresar código OTP", expected: "Token válido" }
    ]
  };

  const scenario = normalizeTestRailCase(rawCase);
  expect(scenario.steps).toHaveLength(2);
  expect(scenario.steps[0].action).toBe("Ingresar cédula");
  expect(scenario.steps[1].expected).toBe("Token válido");
});

test("normalizes custom_steps and custom_expected", () => {
  const rawCase: RawTestRailCase = {
    id: 102,
    title: "Validar pago",
    custom_steps: "1. Ingresar monto\n2. Confirmar cuenta",
    custom_expected: "Pago procesado"
  };

  const scenario = normalizeTestRailCase(rawCase);
  expect(scenario.steps.length).toBeGreaterThan(0);
  expect(scenario.steps[scenario.steps.length - 1].expected).toBe("Pago procesado");
});

test("creates fallback step when no steps exist", () => {
  const rawCase: RawTestRailCase = {
    id: 103,
    title: "Caso sin pasos"
  };

  const scenario = normalizeTestRailCase(rawCase);
  expect(scenario.steps).toHaveLength(1);
  expect(scenario.steps[0].action).toBe("Caso sin pasos");
});

test("extracts expected data hints", () => {
  const hints = extractDataHintsFromText(
    "Ingresar cedula y codigo OTP, validar monto en cuenta y numero de prestamo"
  );

  expect(hints).toEqual(expect.arrayContaining(["cedula", "codigo", "otp", "monto", "cuenta", "prestamo"]));
});

test("cleans basic html from steps", () => {
  const rawCase: RawTestRailCase = {
    id: 104,
    title: "<b>Flujo</b>",
    custom_steps_separated: [{ content: "<p>Ingresar <b>usuario</b></p>", expected: "<div>Acceso OK</div>" }]
  };

  const scenarios = normalizeTestRailCases([rawCase]);
  expect(scenarios[0].steps[0].action).toBe("Ingresar usuario");
  expect(scenarios[0].steps[0].expected).toBe("Acceso OK");
});

test("splits multiline custom_steps into separate action steps", () => {
  const rawCase: RawTestRailCase = {
    id: 37750,
    title: "Consulta listado de tarjetas de credito",
    custom_steps: [
      "Abrir URL del Kiosko.",
      "Clic en 'Iniciar'.",
      "Clic en 'Información de productos'.",
      "Clic en 'Tarjetas'.",
      "Clic en 'Tarjeta de Crédito'.",
      "Validar listado de tarjetas de crédito."
    ].join("\n"),
    custom_expected: "Visa Clásica\nVisa Gold\nVisa Platinum\nVisa Infinite"
  };

  const scenario = normalizeTestRailCase(rawCase);

  expect(scenario.steps.length).toBe(6);
  expect(scenario.steps[0].action).toBe("Abrir URL del Kiosko.");
  expect(scenario.steps[1].action).toBe("Clic en 'Iniciar'.");
  expect(scenario.steps[2].action).toBe("Clic en 'Información de productos'.");
  expect(scenario.steps[3].action).toBe("Clic en 'Tarjetas'.");
  expect(scenario.steps[4].action).toBe("Clic en 'Tarjeta de Crédito'.");
  expect(scenario.steps[5].action).toBe("Validar listado de tarjetas de crédito.");
  expect(scenario.steps[5].expected).toBe("Visa Clásica\nVisa Gold\nVisa Platinum\nVisa Infinite");
});

test("does not truncate multiline action into single target", () => {
  const rawCase: RawTestRailCase = {
    id: 37750,
    title: "Test",
    custom_steps: "Clic en 'Iniciar'.\nClic en 'Información de productos'.\nClic en 'Tarjetas'."
  };

  const scenario = normalizeTestRailCase(rawCase);

  expect(scenario.steps.length).toBe(3);
  for (const step of scenario.steps) {
    expect(step.action).not.toContain("\n");
    expect(step.action.length).toBeLessThan(50);
  }
});

test("handles numbered multiline steps still works", () => {
  const rawCase: RawTestRailCase = {
    id: 105,
    title: "Flujo numerado",
    custom_steps: "1. Abrir URL\n2. Clic en 'Iniciar'\n3. Validar resultado"
  };

  const scenario = normalizeTestRailCase(rawCase);

  expect(scenario.steps.length).toBe(3);
  expect(scenario.steps[0].action).toBe("1. Abrir URL");
  expect(scenario.steps[1].action).toBe("Clic en 'Iniciar'");
});
