import { test, expect } from "@playwright/test";
import { mergeDeclaredPathsIntoScenario } from "../src/scenarios/declared-path-merger";
import { repairUnbackedClicks } from "../src/scenarios/codex-scenario-generator";
import type { DeclaredOrderedPath } from "../src/scenarios/knowledge-context-resolver";

const pathAB: DeclaredOrderedPath = {
  steps: [
    { order: 1, stepKind: "prerequisite", actionTarget: "Entrada A", actionIntent: "click" },
    { order: 2, stepKind: "branch_action", actionTarget: "Destino B", actionIntent: "select_option" },
  ],
};

const pathABC: DeclaredOrderedPath = {
  steps: [
    { order: 1, stepKind: "prerequisite", actionTarget: "Entrada A", actionIntent: "click" },
    { order: 2, stepKind: "branch_action", actionTarget: "Destino B", actionIntent: "select_option" },
    { order: 3, stepKind: "branch_action", actionTarget: "Destino C", actionIntent: "select_option" },
  ],
};

test("Caso 1: path A→B, scenario inicia en B → inserta A antes", () => {
  const r = mergeDeclaredPathsIntoScenario(
    ['Clic en "Destino B"', "Validar X"],
    [pathAB],
  );
  expect(r.insertedCount).toBe(1);
  expect(r.insertedTargets).toEqual(["Entrada A"]);
  expect(r.steps).toEqual([
    'Clic en "Entrada A"',
    'Clic en "Destino B"',
    "Validar X",
  ]);
  console.log("Caso 1 OK");
});

test("Caso 2: scenario ya tiene A→B → sin duplicados", () => {
  const r = mergeDeclaredPathsIntoScenario(
    ['Clic en "Entrada A"', 'Clic en "Destino B"', "Validar X"],
    [pathAB],
  );
  expect(r.insertedCount).toBe(0);
  expect(r.existingCount).toBe(1);
  expect(r.steps).toEqual([
    'Clic en "Entrada A"',
    'Clic en "Destino B"',
    "Validar X",
  ]);
  console.log("Caso 2 OK");
});

test("Caso 3: path A→B→C, scenario A→C → inserta B", () => {
  const r = mergeDeclaredPathsIntoScenario(
    ['Clic en "Entrada A"', 'Clic en "Destino C"', "Validar X"],
    [pathABC],
  );
  expect(r.insertedCount).toBe(1);
  expect(r.insertedTargets).toEqual(["Destino B"]);
  expect(r.steps).toEqual([
    'Clic en "Entrada A"',
    'Clic en "Destino B"',
    'Clic en "Destino C"',
    "Validar X",
  ]);
  console.log("Caso 3 OK");
});

test("Caso 4: scenario B→A→C con path A→B→C → skip por order conflict", () => {
  const r = mergeDeclaredPathsIntoScenario(
    ['Clic en "Destino B"', 'Clic en "Entrada A"', 'Clic en "Destino C"'],
    [pathABC],
  );
  expect(r.skipped).toBe(true);
  expect(r.skipReason).toBe("existing_path_order_conflict");
  expect(r.steps).toEqual([
    'Clic en "Destino B"',
    'Clic en "Entrada A"',
    'Clic en "Destino C"',
  ]);
  console.log("Caso 4 OK");
});

test("Caso 5: Destino B solo como assertion → NO aplicar", () => {
  const r = mergeDeclaredPathsIntoScenario(
    ['Validar que se muestre "Destino B"', "Validar X"],
    [pathAB],
  );
  expect(r.insertedCount).toBe(0);
  expect(r.skipped).toBe(false);
  expect(r.steps).toEqual([
    'Validar que se muestre "Destino B"',
    "Validar X",
  ]);
  console.log("Caso 5 OK");
});

test("Caso 6: repair preserva steps declarados — executionBacked=false, sin allowedExecutableClicks", () => {
  const merged = mergeDeclaredPathsIntoScenario(
    ['Clic en "Destino B"', "Validar X"],
    [pathAB],
  );
  // allowedExecutableClicks vacío — el paso declarado NO se agrega a authority
  const repaired = repairUnbackedClicks(
    merged.steps,
    [],
    [],
    [],
    [],
    ["Entrada A"],
  );
  // El paso funcional declarado se conserva como CLICK (no se convierte a validación)
  expect(repaired).toContain('Clic en "Entrada A"');
  expect(repaired).not.toContain('Validar que se muestre "Entrada A"');
  // allowedExecutableClicks permanece vacío — el paso declarado no otorga authority
  expect(repaired).not.toContain("allowedExecutableClicks");
  console.log("Caso 6 OK");
});

test("Caso 7: merge dos veces → resultado idéntico, sin duplicados", () => {
  const steps = ['Clic en "Destino B"', "Validar X"];
  const r1 = mergeDeclaredPathsIntoScenario(steps, [pathAB]);
  const r2 = mergeDeclaredPathsIntoScenario(r1.steps, [pathAB]);
  expect(r2.steps).toEqual(r1.steps);
  expect(r2.insertedCount).toBe(0);
  expect(r2.steps.filter((s) => s.includes("Entrada A"))).toHaveLength(1);
  console.log("Caso 7 OK");
});