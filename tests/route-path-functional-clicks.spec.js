"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const effective_click_authority_1 = require("../src/scenarios/effective-click-authority");
(0, test_1.test)("Caso 1: route path segments become functional click targets", () => {
    const hu = "Seleccionar en el menú: Operaciones > Consultas > Créditos";
    const targets = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(hu);
    (0, test_1.expect)(targets).toContain("Operaciones");
    (0, test_1.expect)(targets).toContain("Consultas");
    (0, test_1.expect)(targets).toContain("Créditos");
    (0, test_1.expect)(targets).not.toContain("en el menú");
    (0, test_1.expect)(targets).not.toContain("la siguiente ruta");
});
(0, test_1.test)("Caso 2: narrative fragments are not concrete functional click targets", () => {
    const hu = [
        "Seleccionar en el menú: Operaciones > Consultas > Créditos",
        "seleccione el que desea consultar",
        "seleccionar un crédito del listado",
        "elegir una de las siguientes opciones",
    ].join(". ");
    const targets = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(hu);
    (0, test_1.expect)(targets).toContain("Operaciones");
    (0, test_1.expect)(targets).toContain("Consultas");
    (0, test_1.expect)(targets).toContain("Créditos");
    (0, test_1.expect)(targets).not.toContain("que desea consultar");
    (0, test_1.expect)(targets).not.toContain("un crédito");
    (0, test_1.expect)(targets).not.toContain("crédito del listado");
    (0, test_1.expect)(targets).not.toContain("una de las siguientes opciones");
});
(0, test_1.test)("Caso 3: dynamic selections stay adaptive — not concrete click authority", () => {
    const hu = "Seleccionar un préstamo del listado para consultar detalles";
    const targets = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(hu);
    (0, test_1.expect)(targets).not.toContain("un préstamo");
    (0, test_1.expect)(targets).not.toContain("préstamo del listado");
});
(0, test_1.test)("Caso 4: explicit route path produces only route segments as functional targets", () => {
    const hu = "Seleccionar en el menú: Operaciones > Consultas > Créditos para continuar";
    const targets = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(hu);
    (0, test_1.expect)(targets).toEqual(["Operaciones", "Consultas", "Créditos"]);
});
(0, test_1.test)("route segments survive even when surrounded by narrative text", () => {
    const hu = "En el menú la siguiente ruta: Operaciones > Consultas. Debe seleccionar una opción para continuar";
    const targets = (0, effective_click_authority_1.extractHuFunctionalClickTargets)(hu);
    (0, test_1.expect)(targets).toContain("Operaciones");
    (0, test_1.expect)(targets).toContain("Consultas");
    (0, test_1.expect)(targets).not.toContain("la siguiente ruta");
    (0, test_1.expect)(targets).not.toContain("una opción");
});
