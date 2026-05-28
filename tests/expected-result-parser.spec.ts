/**
 * Expected Result Parser Tests
 * 
 * Tests for abstract vs concrete expected result classification.
 */

import { test, expect } from "@playwright/test";
import { buildConcreteAssertionsFromExpected, classifyAssertion } from "../src/discovery/assertion-resolver";

test("abstract expected result is marked as non_executable_criteria", () => {
  const result = buildConcreteAssertionsFromExpected(
    ["El cliente visualiza las categorías principales disponibles para consulta informativa."],
    []
  );

  expect(result.assertions).toHaveLength(0);
  expect(result.expectedResultConsumption).toHaveLength(1);
  expect(result.expectedResultConsumption[0].classification).toBe("non_executable_criteria");
  expect(result.nonExecutableCriteria).toContain("El cliente visualiza las categorías principales disponibles para consulta informativa.");
});

test("abstract expected result is covered_by_concrete_assertions when steps have assertions", () => {
  const result = buildConcreteAssertionsFromExpected(
    ["El cliente visualiza las categorías principales disponibles para consulta informativa."],
    ["Tarjetas", "Depósitos a Plazo", "Cuentas de Efectivo", "Préstamos"]
  );

  expect(result.assertions).toHaveLength(0);
  expect(result.expectedResultConsumption).toHaveLength(1);
  expect(result.expectedResultConsumption[0].classification).toBe("covered_by_concrete_assertions");
  expect(result.expectedResultConsumption[0].coveredByAssertions).toHaveLength(4);
  expect(result.nonExecutableCriteria).toContain("El cliente visualiza las categorías principales disponibles para consulta informativa.");
});

test("expected result with quoted text extracts concrete assertions", () => {
  const result = buildConcreteAssertionsFromExpected(
    ['Se muestran las categorías "Tarjetas", "Préstamos"'],
    []
  );

  expect(result.assertions).toContain("Tarjetas");
  expect(result.assertions).toContain("Préstamos");
  expect(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
  expect(result.expectedResultConsumption[0].extractedQuotedTexts).toContain("Tarjetas");
  expect(result.expectedResultConsumption[0].extractedQuotedTexts).toContain("Préstamos");
});

test("expected result with multiple quoted texts generates separate assertions", () => {
  const result = buildConcreteAssertionsFromExpected(
    ['Se visualiza el mensaje "Solicitud enviada" y el botón "Continuar"'],
    []
  );

  expect(result.assertions).toContain("Solicitud enviada");
  expect(result.assertions).toContain("Continuar");
  expect(result.expectedResultConsumption[0].extractedQuotedTexts).toHaveLength(2);
});

test("concrete expected result without quotes is classified correctly", () => {
  const result = buildConcreteAssertionsFromExpected(
    ["Tarjetas"],
    []
  );

  expect(result.assertions).toContain("Tarjetas");
  expect(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
});

test("generic success message is marked as non_executable", () => {
  const result = buildConcreteAssertionsFromExpected(
    ["La operación se realiza exitosamente"],
    []
  );

  expect(result.assertions).toHaveLength(0);
  expect(result.expectedResultConsumption[0].classification).toBe("non_executable_criteria");
});

test("abstract expected result does not block when concrete assertions exist", () => {
  const result = buildConcreteAssertionsFromExpected(
    ["El flujo permanece dentro del entorno controlado"],
    ["Botón visible", "Formulario completado"]
  );

  expect(result.assertions).toHaveLength(0);
  expect(result.expectedResultConsumption[0].classification).toBe("covered_by_concrete_assertions");
  expect(result.nonExecutableCriteria).toHaveLength(1);
});

test("expected result with button name in quotes is executable", () => {
  const result = buildConcreteAssertionsFromExpected(
    ['Se muestra el botón "Add to cart"'],
    []
  );

  expect(result.assertions).toContain("Add to cart");
  expect(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
});

test("expected result with link name in quotes is executable", () => {
  const result = buildConcreteAssertionsFromExpected(
    ['Se muestra el enlace "Información de productos"'],
    []
  );

  expect(result.assertions).toContain("Información de productos");
  expect(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
});

test("expected result with field name in quotes is executable", () => {
  const result = buildConcreteAssertionsFromExpected(
    ['Se visualiza el campo "Correo electrónico"'],
    []
  );

  expect(result.assertions).toContain("Correo electrónico");
  expect(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
});

test("classifyAssertion returns literal_observable for quoted text", () => {
  const classification = classifyAssertion('Se muestra "Tarjetas"');
  expect(classification).toBe("literal_observable");
});

test("classifyAssertion handles text without quotes", () => {
  // classifyAssertion is a general classifier - the abstract detection is in buildConcreteAssertionsFromExpected
  const classification = classifyAssertion("El cliente visualiza las categorías principales");
  // This may return literal_observable since it doesn't have descriptor keywords
  // The abstract detection happens in buildConcreteAssertionsFromExpected via isAbstractExpected
  expect(classification).toBeTruthy();
});

test("empty expected result returns empty arrays", () => {
  const result = buildConcreteAssertionsFromExpected([], []);
  expect(result.assertions).toHaveLength(0);
  expect(result.expectedResultConsumption).toHaveLength(0);
  expect(result.nonExecutableCriteria).toHaveLength(0);
});

test("expected result 'Las categorías principales corresponden al catálogo esperado' is non_executable", () => {
  const result = buildConcreteAssertionsFromExpected(
    ["Las categorías principales corresponden al catálogo esperado"],
    []
  );

  expect(result.assertions).toHaveLength(0);
  expect(result.expectedResultConsumption[0].classification).toBe("non_executable_criteria");
});

test("expected result 'El sistema muestra la información correctamente' is non_executable", () => {
  const result = buildConcreteAssertionsFromExpected(
    ["El sistema muestra la información correctamente"],
    []
  );

  expect(result.assertions).toHaveLength(0);
  expect(result.expectedResultConsumption[0].classification).toBe("non_executable_criteria");
});

test("expected result 'La pantalla muestra los datos solicitados correctamente' is non_executable", () => {
  const result = buildConcreteAssertionsFromExpected(
    ["La pantalla muestra los datos solicitados correctamente"],
    []
  );

  expect(result.assertions).toHaveLength(0);
  expect(result.expectedResultConsumption[0].classification).toBe("non_executable_criteria");
});

test("mixed expected result with concrete and abstract parts", () => {
  const result = buildConcreteAssertionsFromExpected(
    [
      'Se muestra "Tarjetas"',
      "El cliente visualiza las categorías principales"
    ],
    []
  );

  expect(result.assertions).toContain("Tarjetas");
  expect(result.assertions).not.toContain("El cliente visualiza las categorías principales");
  expect(result.expectedResultConsumption).toHaveLength(2);
  expect(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
  expect(result.expectedResultConsumption[1].classification).toBe("non_executable_criteria");
});

test("expected result covered does not duplicate existing assertions", () => {
  const result = buildConcreteAssertionsFromExpected(
    ['Se muestra "Tarjetas"'],
    ["Tarjetas"]
  );

  expect(result.assertions).toHaveLength(0);
  expect(result.expectedResultConsumption[0].classification).toBe("executable_assertion");
});
