"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const effective_click_authority_1 = require("../src/scenarios/effective-click-authority");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
(0, test_1.test)("quoted and named unquoted targets are preserved", () => {
    const huText = [
        'Seleccionar "Acción Alfa".',
        'Hacer clic en botón "Acción Beta".',
        "Seleccionar Productos.",
    ].join(" ");
    const targets = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(huText);
    (0, test_1.expect)(targets).toContain("Acción Alfa");
    (0, test_1.expect)(targets).toContain("Acción Beta");
    (0, test_1.expect)(targets).toContain("Productos");
});
(0, test_1.test)("generic determiner references are rejected as click targets", () => {
    const huText = [
        "Seleccionar un elemento.",
        "Seleccionar este tipo.",
        "Seleccionar uno de los elementos.",
        "Seleccionar un producto.",
    ].join(" ");
    const targets = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(huText);
    (0, test_1.expect)(targets).not.toContain("un elemento");
    (0, test_1.expect)(targets).not.toContain("este tipo");
    (0, test_1.expect)(targets).not.toContain("uno de los elementos");
    (0, test_1.expect)(targets).not.toContain("un producto");
    (0, test_1.expect)(targets.length).toBe(0);
});
(0, test_1.test)("narrative obligation can still remain a functional requirement", () => {
    const huText = "Seleccionar un elemento de la lista para continuar.";
    const targets = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(huText);
    (0, test_1.expect)(targets).toHaveLength(0);
    const acct = (0, scenario_functional_quality_1.buildRequirementAccounting)([], [], huText, "GEN");
    const obligations = acct.requirements.filter((r) => r.category === "action" || r.category === "prerequisite");
    (0, test_1.expect)(obligations.length).toBeGreaterThanOrEqual(1);
});
