import { test, expect } from "@playwright/test";
import { extractHuFunctionalClickTargets } from "../src/scenarios/effective-click-authority";

test("Caso 1: route path segments become functional click targets", () => {
  const hu = "Seleccionar en el menú: Operaciones > Consultas > Créditos";
  const targets = extractHuFunctionalClickTargets(hu);
  expect(targets).toContain("Operaciones");
  expect(targets).toContain("Consultas");
  expect(targets).toContain("Créditos");
  expect(targets).not.toContain("en el menú");
  expect(targets).not.toContain("la siguiente ruta");
});

test("Caso 2: narrative fragments are not concrete functional click targets", () => {
  const hu = [
    "Seleccionar en el menú: Operaciones > Consultas > Créditos",
    "seleccione el que desea consultar",
    "seleccionar un crédito del listado",
    "elegir una de las siguientes opciones",
  ].join(". ");
  const targets = extractHuFunctionalClickTargets(hu);
  expect(targets).toContain("Operaciones");
  expect(targets).toContain("Consultas");
  expect(targets).toContain("Créditos");
  expect(targets).not.toContain("que desea consultar");
  expect(targets).not.toContain("un crédito");
  expect(targets).not.toContain("crédito del listado");
  expect(targets).not.toContain("una de las siguientes opciones");
});

test("Caso 3: dynamic selections stay adaptive — not concrete click authority", () => {
  const hu = "Seleccionar un préstamo del listado para consultar detalles";
  const targets = extractHuFunctionalClickTargets(hu);
  expect(targets).not.toContain("un préstamo");
  expect(targets).not.toContain("préstamo del listado");
});

test("Caso 4: explicit route path produces only route segments as functional targets", () => {
  const hu = "Seleccionar en el menú: Operaciones > Consultas > Créditos para continuar";
  const targets = extractHuFunctionalClickTargets(hu);
  expect(targets).toEqual(["Operaciones", "Consultas", "Créditos"]);
});

test("route segments survive even when surrounded by narrative text", () => {
  const hu = "En el menú la siguiente ruta: Operaciones > Consultas. Debe seleccionar una opción para continuar";
  const targets = extractHuFunctionalClickTargets(hu);
  expect(targets).toContain("Operaciones");
  expect(targets).toContain("Consultas");
  expect(targets).not.toContain("la siguiente ruta");
  expect(targets).not.toContain("una opción");
});
