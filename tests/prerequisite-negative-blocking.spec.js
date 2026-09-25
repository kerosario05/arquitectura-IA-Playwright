"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
(0, test_1.test)("negative blocking select prerequisite → quoted target with select intent", () => {
    const huText = 'No debe permitirse avanzar sin que el usuario seleccione el botón "Acción Alfa".';
    const targets = (0, scenario_functional_quality_1.extractPrerequisiteTargets)(huText);
    (0, test_1.expect)(targets.length).toBe(1);
    (0, test_1.expect)(targets[0].actionTarget).toBe("Acción Alfa");
    (0, test_1.expect)(targets[0].actionIntent).toBe("select");
});
(0, test_1.test)("negative blocking click prerequisite → quoted target with click intent", () => {
    const huText = 'No debe permitirse continuar sin que el usuario haga clic en "Acción Beta".';
    const targets = (0, scenario_functional_quality_1.extractPrerequisiteTargets)(huText);
    (0, test_1.expect)(targets.length).toBe(1);
    (0, test_1.expect)(targets[0].actionTarget).toBe("Acción Beta");
    (0, test_1.expect)(targets[0].actionIntent).toBe("click");
});
(0, test_1.test)("negative control → no prerequisite for non-blocking 'sin que'", () => {
    const huText = "El sistema muestra un mensaje sin que el usuario intervenga.";
    const targets = (0, scenario_functional_quality_1.extractPrerequisiteTargets)(huText);
    (0, test_1.expect)(targets.length).toBe(0);
});
