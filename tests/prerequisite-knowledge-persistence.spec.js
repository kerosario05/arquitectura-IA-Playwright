"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
const hu_declared_persister_1 = require("../src/knowledge/hu-declared-persister");
const HU_WITH_PREREQS = [
    "Para continuar debe seleccionar Iniciar.",
    "Antes de continuar haga clic en Continuar.",
    "El usuario consulta su saldo.",
].join(" ");
(0, test_1.test)("explicit prerequisites enter requirementAccounting and hu_declared Knowledge with dynamic targets", () => {
    const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)([], [], HU_WITH_PREREQS, "HU-TEST-1");
    const prerequisiteRequirements = accounting.requirements.filter((r) => r.category === "prerequisite");
    (0, test_1.expect)(prerequisiteRequirements).toHaveLength(2);
    const items = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting, [], "HU-TEST-1");
    const prerequisiteItems = items.filter((i) => i.category === "prerequisite");
    (0, test_1.expect)(prerequisiteItems).toHaveLength(2);
    // Two DIFFERENT targets prove the extraction is generic (no label hardcode).
    const targets = prerequisiteItems.map((i) => i.actionTarget).sort();
    (0, test_1.expect)(targets).toEqual(["Continuar", "Iniciar"]);
    const iniciar = prerequisiteItems.find((i) => i.actionTarget === "Iniciar");
    (0, test_1.expect)(iniciar.actionIntent).toBe("select");
    const continuar = prerequisiteItems.find((i) => i.actionTarget === "Continuar");
    (0, test_1.expect)(continuar.actionIntent).toBe("click");
    for (const item of prerequisiteItems) {
        // HU-declared knowledge contract — never runtime authority.
        (0, test_1.expect)(item.source).toBe("hu_declared");
        (0, test_1.expect)(item.knowledgeKind).toBe("hu_declared");
        (0, test_1.expect)(item.validationStatus).toBe("pending");
        (0, test_1.expect)(item.executionBacked).toBe(false);
        (0, test_1.expect)(item.trustedForReuse).toBe(false);
        // Only what the HU declares is persisted — destination/origin are absent.
        (0, test_1.expect)(item.expectedDestination).toBeUndefined();
        (0, test_1.expect)(item.destinationScreenKey).toBeUndefined();
        (0, test_1.expect)(item.screenKey).toBeUndefined();
    }
});
(0, test_1.test)("narrative sentence produces no prerequisite item", () => {
    const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)([], [], "El usuario consulta su saldo.", "HU-TEST-2");
    (0, test_1.expect)(accounting.requirements.filter((r) => r.category === "prerequisite")).toHaveLength(0);
    const items = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting, [], "HU-TEST-2");
    (0, test_1.expect)(items.filter((i) => i.category === "prerequisite")).toHaveLength(0);
});
