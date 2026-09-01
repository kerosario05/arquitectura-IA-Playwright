import { test, expect } from "@playwright/test";
import { mergeDeclaredPathsIntoScenario, extractClickTarget } from "../src/scenarios/declared-path-merger";
import { repairUnbackedClicks } from "../src/scenarios/codex-scenario-generator";
import type { DeclaredOrderedPath } from "../src/scenarios/knowledge-context-resolver";

const pathAB: DeclaredOrderedPath = {
  steps: [
    { order: 1, stepKind: "prerequisite", actionTarget: "Entrada A", actionIntent: "click" },
    { order: 2, stepKind: "branch_action", actionTarget: "Destino B", actionIntent: "select_option" },
  ],
};

test("REPRODUCCIÓN: path completo en IA (unquoted) — merge inserted=0 y repair preserva prerequisite", () => {
  const steps = [
    "1. Clic en Entrada A",
    '2. Clic en "Destino B"',
    '3. Validar que se muestre "Contenido"',
  ];
  const mergeResult = mergeDeclaredPathsIntoScenario(steps, [pathAB]);

  // Ruta ya presente → nada que insertar, pero el path es reconocido
  expect(mergeResult.insertedCount).toBe(0);
  expect(mergeResult.matchedDeclaredPathTargets).toEqual(["Entrada A", "Destino B"]);

  const repaired = repairUnbackedClicks(
    mergeResult.steps,
    [],
    [],
    [],
    [],
    mergeResult.matchedDeclaredPathTargets,
  );

  // Obligatorio: el prerequisite se conserva como CLICK (no convertido a validación)
  expect(repaired).toEqual([
    "1. Clic en Entrada A",
    '2. Clic en "Destino B"',
    '3. Validar que se muestre "Contenido"',
  ]);
  console.log("REPRODUCCIÓN OK — inserted=0, Entrada A preservada");
});

test("Unquoted click reconocido por el parser compartido; assertion ignorada", () => {
  expect(extractClickTarget("Clic en Entrada A")).toBe("Entrada A");
  expect(extractClickTarget('Clic en "Destino B"')).toBe("Destino B");
  expect(extractClickTarget('1. Clic en Entrada A')).toBe("Entrada A");
  expect(extractClickTarget('Validar que se muestre "Entrada A"')).toBeNull();
  expect(extractClickTarget("El usuario selecciona Entrada A")).toBeNull();
  console.log("Parser OK");
});

test("Si falta Entrada A → B inserta A y ambos quedan protegidos", () => {
  const mergeResult = mergeDeclaredPathsIntoScenario(
    ['Clic en "Destino B"', 'Validar que se muestre "Contenido"'],
    [pathAB],
  );
  expect(mergeResult.insertedCount).toBe(1);
  expect(mergeResult.matchedDeclaredPathTargets).toEqual(["Entrada A", "Destino B"]);

  const repaired = repairUnbackedClicks(
    mergeResult.steps,
    [],
    [],
    [],
    [],
    mergeResult.matchedDeclaredPathTargets,
  );
  expect(repaired).toContain('Clic en "Entrada A"');
  expect(repaired).toContain('Clic en "Destino B"');
  console.log("Caso falta Entrada A OK");
});

test("Terminal solo como assertion → NO se aplica protección", () => {
  const mergeResult = mergeDeclaredPathsIntoScenario(
    ['Validar que se muestre "Destino B"', "Validar X"],
    [pathAB],
  );
  expect(mergeResult.insertedCount).toBe(0);
  expect(mergeResult.matchedDeclaredPathTargets).toEqual([]);
  console.log("Assertion-only OK");
});

test("Path no aplica al escenario → Entrada A sin protección especial", () => {
  const mergeResult = mergeDeclaredPathsIntoScenario(
    ['Clic en "Otro destino"', "Validar X"],
    [pathAB],
  );
  expect(mergeResult.matchedDeclaredPathTargets).toEqual([]);
  // Repair normal convierte el click no respaldado
  const repaired = repairUnbackedClicks(mergeResult.steps, [], [], [], [], []);
  expect(repaired).not.toContain('Clic en "Entrada A"');
  console.log("No-aplica OK");
});

test("allowedExecutableClicks antes === después; readiness intacto", () => {
  const allowedBefore = ["Destino B"];
  const steps = ['Clic en "Entrada A"', 'Clic en "Destino B"', "Validar X"];
  const mergeResult = mergeDeclaredPathsIntoScenario(steps, [pathAB]);
  const repaired = repairUnbackedClicks(
    mergeResult.steps,
    allowedBefore,
    [],
    [],
    [],
    mergeResult.matchedDeclaredPathTargets,
  );
  // allowedExecutableClicks no cambió (el repair no agrega nada a authority)
  expect(allowedBefore).toEqual(["Destino B"]);
  // El pasos declarado se preserva pero con execution_backed=false (sin evidence)
  expect(repaired).toContain('Clic en "Entrada A"');
  console.log("Authority OK");
});