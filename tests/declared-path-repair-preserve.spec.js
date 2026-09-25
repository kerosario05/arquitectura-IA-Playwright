"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const declared_path_merger_1 = require("../src/scenarios/declared-path-merger");
const codex_scenario_generator_1 = require("../src/scenarios/codex-scenario-generator");
const pathAB = {
    steps: [
        { order: 1, stepKind: "prerequisite", actionTarget: "Entrada A", actionIntent: "click" },
        { order: 2, stepKind: "branch_action", actionTarget: "Destino B", actionIntent: "select_option" },
    ],
};
(0, test_1.test)("REPRODUCCIÓN: path completo en IA (unquoted) — merge inserted=0 y repair preserva prerequisite", () => {
    const steps = [
        "1. Clic en Entrada A",
        '2. Clic en "Destino B"',
        '3. Validar que se muestre "Contenido"',
    ];
    const mergeResult = (0, declared_path_merger_1.mergeDeclaredPathsIntoScenario)(steps, [pathAB]);
    // Ruta ya presente → nada que insertar, pero el path es reconocido
    (0, test_1.expect)(mergeResult.insertedCount).toBe(0);
    (0, test_1.expect)(mergeResult.matchedDeclaredPathTargets).toEqual(["Entrada A", "Destino B"]);
    const repaired = (0, codex_scenario_generator_1.repairUnbackedClicks)(mergeResult.steps, [], [], [], [], mergeResult.matchedDeclaredPathTargets);
    // Obligatorio: el prerequisite se conserva como CLICK (no convertido a validación)
    (0, test_1.expect)(repaired).toEqual([
        "1. Clic en Entrada A",
        '2. Clic en "Destino B"',
        '3. Validar que se muestre "Contenido"',
    ]);
    console.log("REPRODUCCIÓN OK — inserted=0, Entrada A preservada");
});
(0, test_1.test)("Unquoted click reconocido por el parser compartido; assertion ignorada", () => {
    (0, test_1.expect)((0, declared_path_merger_1.extractClickTarget)("Clic en Entrada A")).toBe("Entrada A");
    (0, test_1.expect)((0, declared_path_merger_1.extractClickTarget)('Clic en "Destino B"')).toBe("Destino B");
    (0, test_1.expect)((0, declared_path_merger_1.extractClickTarget)('1. Clic en Entrada A')).toBe("Entrada A");
    (0, test_1.expect)((0, declared_path_merger_1.extractClickTarget)('Validar que se muestre "Entrada A"')).toBeNull();
    (0, test_1.expect)((0, declared_path_merger_1.extractClickTarget)("El usuario selecciona Entrada A")).toBeNull();
    console.log("Parser OK");
});
(0, test_1.test)("Si falta Entrada A → B inserta A y ambos quedan protegidos", () => {
    const mergeResult = (0, declared_path_merger_1.mergeDeclaredPathsIntoScenario)(['Clic en "Destino B"', 'Validar que se muestre "Contenido"'], [pathAB]);
    (0, test_1.expect)(mergeResult.insertedCount).toBe(1);
    (0, test_1.expect)(mergeResult.matchedDeclaredPathTargets).toEqual(["Entrada A", "Destino B"]);
    const repaired = (0, codex_scenario_generator_1.repairUnbackedClicks)(mergeResult.steps, [], [], [], [], mergeResult.matchedDeclaredPathTargets);
    (0, test_1.expect)(repaired).toContain('Clic en "Entrada A"');
    (0, test_1.expect)(repaired).toContain('Clic en "Destino B"');
    console.log("Caso falta Entrada A OK");
});
(0, test_1.test)("Terminal solo como assertion → NO se aplica protección", () => {
    const mergeResult = (0, declared_path_merger_1.mergeDeclaredPathsIntoScenario)(['Validar que se muestre "Destino B"', "Validar X"], [pathAB]);
    (0, test_1.expect)(mergeResult.insertedCount).toBe(0);
    (0, test_1.expect)(mergeResult.matchedDeclaredPathTargets).toEqual([]);
    console.log("Assertion-only OK");
});
(0, test_1.test)("Path no aplica al escenario → Entrada A sin protección especial", () => {
    const mergeResult = (0, declared_path_merger_1.mergeDeclaredPathsIntoScenario)(['Clic en "Otro destino"', "Validar X"], [pathAB]);
    (0, test_1.expect)(mergeResult.matchedDeclaredPathTargets).toEqual([]);
    // Repair normal convierte el click no respaldado
    const repaired = (0, codex_scenario_generator_1.repairUnbackedClicks)(mergeResult.steps, [], [], [], [], []);
    (0, test_1.expect)(repaired).not.toContain('Clic en "Entrada A"');
    console.log("No-aplica OK");
});
(0, test_1.test)("allowedExecutableClicks antes === después; readiness intacto", () => {
    const allowedBefore = ["Destino B"];
    const steps = ['Clic en "Entrada A"', 'Clic en "Destino B"', "Validar X"];
    const mergeResult = (0, declared_path_merger_1.mergeDeclaredPathsIntoScenario)(steps, [pathAB]);
    const repaired = (0, codex_scenario_generator_1.repairUnbackedClicks)(mergeResult.steps, allowedBefore, [], [], [], mergeResult.matchedDeclaredPathTargets);
    // allowedExecutableClicks no cambió (el repair no agrega nada a authority)
    (0, test_1.expect)(allowedBefore).toEqual(["Destino B"]);
    // El pasos declarado se preserva pero con execution_backed=false (sin evidence)
    (0, test_1.expect)(repaired).toContain('Clic en "Entrada A"');
    console.log("Authority OK");
});
