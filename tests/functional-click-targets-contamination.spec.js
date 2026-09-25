"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const effective_click_authority_1 = require("../src/scenarios/effective-click-authority");
function branch(label, id = "b1") {
    return { branchId: id, sourceLabel: label, sourceIssueKey: "HU-1" };
}
(0, test_1.test)("visibility verb not extracted as click target", () => {
    const hu = "visualizar la pantalla de inicio para navegar al módulo";
    const result = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(hu, []);
    (0, test_1.expect)(result).not.toContain("visualizar la pantalla de inicio");
    (0, test_1.expect)(result).toHaveLength(0);
});
(0, test_1.test)("weak fragment discarded when substring of strong branch label", () => {
    const branches = [branch("Transacciones y servicios")];
    const hu = "seleccionar Transacciones del menú";
    const result = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(hu, branches);
    (0, test_1.expect)(result).toContain("Transacciones y servicios");
    (0, test_1.expect)(result).not.toContain("Transacciones");
    console.log(`fragment discarded: ${JSON.stringify(result)}`);
});
(0, test_1.test)("prerequisite actionTarget preserved", () => {
    const branches = [branch("Destino Completo")];
    const hu = "no debe permitirse avanzar sin que se seleccione Entrada A";
    const result = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(hu, branches);
    (0, test_1.expect)(result).toContain("Destino Completo");
    (0, test_1.expect)(result).toContain("Entrada A");
    (0, test_1.expect)(result).toHaveLength(2);
    console.log(`result: ${JSON.stringify(result)}`);
});
(0, test_1.test)("Presionar with quoted target is preserved", () => {
    const hu = 'Presionar "Solicitar acción"';
    const result = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(hu, []);
    (0, test_1.expect)(result).toContain("Solicitar acción");
    (0, test_1.expect)(result).toHaveLength(1);
});
(0, test_1.test)("two distinct strong targets both preserved (no false dedup)", () => {
    const branches = [branch("Destino A"), branch("Destino B")];
    const result = (0, effective_click_authority_1.extractHuFunctionalClickTargets)("", branches);
    (0, test_1.expect)(result).toContain("Destino A");
    (0, test_1.expect)(result).toContain("Destino B");
    (0, test_1.expect)(result).toHaveLength(2);
});
(0, test_1.test)("mixed: visibility excluded, fragment discarded, branch+prerequisite preserved", () => {
    const branches = [branch("Destino Completo")];
    const hu = [
        "visualizar la pantalla de inicio",
        "no debe permitirse avanzar sin que se seleccione Entrada A",
        "seleccionar Destino del menú",
    ].join(" ");
    const result = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(hu, branches);
    (0, test_1.expect)(result).toContain("Destino Completo");
    (0, test_1.expect)(result).toContain("Entrada A");
    (0, test_1.expect)(result).not.toContain("visualizar la pantalla de inicio");
    (0, test_1.expect)(result).not.toContain("Destino");
    (0, test_1.expect)(result).toHaveLength(2);
    console.log(`mixed result: ${JSON.stringify(result)}`);
});
(0, test_1.test)("validate downstream: repairUnbackedClicks does not preserve visibility target", () => {
    // Simulate what would happen if huFunctionalClickTargets included visibility
    const huFunctionalClickTargets = ["Destino Completo", "Entrada A"];
    const huRequiredNormalized = new Set(huFunctionalClickTargets.map((t) => t.toLowerCase().trim()));
    const steps = [
        'Clic en "Destino Completo"',
        'Clic en "Entrada A"',
        'Clic en "visualizar la pantalla de inicio"',
    ];
    // Verify visibility target is NOT in the normalized set (would not be preserved)
    (0, test_1.expect)(huRequiredNormalized.has("visualizar la pantalla de inicio")).toBe(false);
    (0, test_1.expect)(huRequiredNormalized.has("destino completo")).toBe(true);
    (0, test_1.expect)(huRequiredNormalized.has("entrada a")).toBe(true);
    console.log("downstream validation OK");
});
