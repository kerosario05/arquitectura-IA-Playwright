import { test, expect } from "@playwright/test";
import {
  buildConcreteAssertionsFromExpected,
  classifyAssertion,
  resolveAssertionTargets,
  type AssertionTargetInput
} from "../src/discovery/assertion-resolver";
import type { PageSnapshot, SnapshotElement } from "../src/types/page-snapshot.types";

function makeElement(overrides: Partial<SnapshotElement>): SnapshotElement {
  return {
    id: `el-${Math.random().toString(36).slice(2, 8)}`,
    type: "text",
    visible: true,
    candidateLocators: [],
    dataHints: [],
    ...overrides
  };
}

function makeSnapshot(elements: SnapshotElement[], url = "https://example.com/app"): PageSnapshot {
  return {
    version: "1.0",
    url,
    title: "Example",
    capturedAt: new Date().toISOString(),
    elements,
    summary: {
      totalElements: elements.length,
      buttons: elements.filter((element) => element.type === "button").length,
      links: elements.filter((element) => element.type === "link").length,
      inputs: elements.filter((element) => element.type === "input").length,
      selects: elements.filter((element) => element.type === "select").length,
      tables: elements.filter((element) => element.type === "table").length,
      dialogs: elements.filter((element) => element.type === "dialog").length,
      headings: elements.filter((element) => element.type === "heading").length
    }
  };
}

function makeAssertion(target: string, source: "action" | "expected" = "action", index = 1): AssertionTargetInput {
  return {
    index,
    action: `Assert: ${target}`,
    target,
    source
  };
}

test("validar listado de productos se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("validar listado de productos")).toBe("semantic_descriptor");
});

test("confirmar pantalla de resumen se clasifica como semantic_descriptor", () => {
  expect(classifyAssertion("confirmar pantalla de resumen")).toBe("semantic_descriptor");
});

test("semantic_descriptor con señales hijas concretas pasa como satisfied_by_children", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Premium" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("pantalla de resumen")], {
    childSignalsByIndex: { 1: ["Premium", "Available"] }
  });

  expect(result.status).toBe("satisfied_by_children");
});

test("semantic_descriptor sin señales concretas queda needs_assertion_resolution", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Welcome" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("pantalla de resumen")]);

  expect(result.status).toBe("needs_assertion_resolution");
});

test("texto concreto visible pasa como literal_observable", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Transferencia completada" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Transferencia completada")]);

  expect(result.classification).toBe("literal_observable");
  expect(result.status).toBe("passed");
});

test("texto concreto faltante falla con closestCandidates", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Transferencia procesada" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("Transferencia completada")]);

  expect(result.status).toBe("failed");
  expect(result.closestCandidates.length).toBeGreaterThan(0);
});

test("contains normalizado funciona para assertions", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Resultado aprobado con detalles adicionales" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("resultado aprobado")]);

  expect(result.status).toBe("passed");
});

test("acentos y mayusculas no rompen matching", () => {
  const snapshot = makeSnapshot([makeElement({ text: "Información general" })]);
  const [result] = resolveAssertionTargets(snapshot, [makeAssertion("INFORMACION GENERAL")]);

  expect(result.status).toBe("passed");
});

test("expected texts concretos generan asserts observables", () => {
  const result = buildConcreteAssertionsFromExpected(["Premium", "Disponible", "pantalla de resumen"]);
  expect(result).toEqual(["Premium", "Disponible"]);
});

test("frases descriptivas no generan assertText literal", () => {
  const result = buildConcreteAssertionsFromExpected(["validar listado de productos", "Resumen"]);
  expect(result).toEqual(["Resumen"]);
});

test("structural assertions pueden representar tabla lista card modal sin depender de texto literal", () => {
  const snapshot = makeSnapshot([
    makeElement({ type: "table", text: "Data" }),
    makeElement({ type: "card", text: "Summary card" }),
    makeElement({ type: "dialog", text: "Dialog title" })
  ]);

  const results = resolveAssertionTargets(snapshot, [
    makeAssertion("tabla de resultados"),
    makeAssertion("modal de confirmacion", "action", 2),
    makeAssertion("card de resumen", "action", 3)
  ]);

  expect(results.every((result) => result.status === "passed")).toBe(true);
});

test("resolver de assertions no contiene hardcodes del dominio de regresion", () => {
  const fs = require("fs");
  const path = require("path");
  const content = fs.readFileSync(path.join(__dirname, "../src/discovery/assertion-resolver.ts"), "utf-8");

  expect(content).not.toContain("Banco Santa Cruz");
  expect(content).not.toContain("Kiosko");
  expect(content).not.toContain("Tarjeta de Crédito");
  expect(content).not.toContain("C37750");
});

test("regresion: descriptor con expected concretos visibles queda satisfied_by_children y no literal not_found", () => {
  const snapshot = makeSnapshot([
    makeElement({ text: "Visa Clásica" }),
    makeElement({ text: "Visa Gold" }),
    makeElement({ text: "Visa Platinum" }),
    makeElement({ text: "Visa Infinite" })
  ]);

  const results = resolveAssertionTargets(
    snapshot,
    [
      makeAssertion("listado de tarjetas de crédito."),
      makeAssertion("Visa Clásica", "expected"),
      makeAssertion("Visa Gold", "expected"),
      makeAssertion("Visa Platinum", "expected"),
      makeAssertion("Visa Infinite", "expected")
    ],
    {
      childSignalsByIndex: {
        1: ["Visa Clásica", "Visa Gold", "Visa Platinum", "Visa Infinite"]
      }
    }
  );

  const descriptor = results[0];
  const concretes = results.slice(1);

  expect(descriptor.status).toBe("satisfied_by_children");
  expect(concretes.every((result) => result.status === "passed")).toBe(true);
});
