"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
const effective_click_authority_1 = require("../src/scenarios/effective-click-authority");
const HU_TEXT = [
    "Para continuar debe seleccionar Opción Alfa.",
    "Antes de continuar haga clic en Acción Beta.",
].join(" ");
(0, test_1.test)("same prerequisite clause → requirementAccounting target = huFunctionalClickTargets target", () => {
    const prerequisiteTargets = (0, scenario_functional_quality_1.extractPrerequisiteTargets)(HU_TEXT);
    const prereqKeys = prerequisiteTargets.map((p) => p.actionTarget);
    const huTargets = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(HU_TEXT);
    (0, test_1.expect)(prereqKeys.length).toBeGreaterThanOrEqual(2);
    for (const key of prereqKeys) {
        (0, test_1.expect)(huTargets.some((t) => t.toLowerCase().includes(key.toLowerCase())), `huFunctionalClickTargets must include prerequisite target "${key}"`).toBeTruthy();
    }
});
(0, test_1.test)("different verb variants → same shared targets", () => {
    const huText = [
        "Para continuar debe seleccionar Opción Alfa.",
        "Antes de continuar haga clic en Acción Beta.",
        "Primero seleccionar Elemento Gamma.",
    ].join(" ");
    const prerequisiteTargets = (0, scenario_functional_quality_1.extractPrerequisiteTargets)(huText);
    const prereqKeys = prerequisiteTargets.map((p) => p.actionTarget);
    const huTargets = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(huText);
    (0, test_1.expect)(prereqKeys.length).toBeGreaterThanOrEqual(3);
    for (const key of prereqKeys) {
        (0, test_1.expect)(huTargets.some((t) => t.toLowerCase().includes(key.toLowerCase())), `huFunctionalClickTargets must include prerequisite target "${key}"`).toBeTruthy();
    }
});
(0, test_1.test)("narrative sentence → no prerequisite targets from either extractor", () => {
    const narrative = "El usuario observa la pantalla principal y espera a que se carguen los datos.";
    const prereqTargets = (0, scenario_functional_quality_1.extractPrerequisiteTargets)(narrative);
    const huTargets = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(narrative);
    (0, test_1.expect)(prereqTargets.length).toBe(0);
    (0, test_1.expect)(huTargets.length).toBe(0);
});
