"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const testrail_normalizer_1 = require("./testrail-normalizer");
const case_discovery_1 = require("../discovery/case-discovery");
const explicitAuthSteps = [
    { content: "Ingresar el valor [credential.identifier] en el campo \"Identificador\"." },
    { content: "Ingresar el valor [credential.username] en el campo \"Usuario\"." },
    { content: "Ingresar el valor secreto [credential.password] en el campo \"Clave\"." },
    { content: "Hacer clic en el botón \"Continuar\"." },
    { content: "Validar que se muestre la pantalla autenticada." },
];
function rawCase(steps, extra = {}) {
    return {
        id: 1,
        title: "Caso estructural",
        custom_steps_separated: steps,
        ...extra,
    };
}
(0, node_test_1.default)("infers full_authentication for an explicit authentication flow", () => {
    const scenario = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase(explicitAuthSteps));
    strict_1.default.equal(scenario.authIntent, "full_authentication");
    strict_1.default.equal((0, case_discovery_1.isAuthenticationTestScenario)(scenario), true);
});
(0, node_test_1.default)("does not classify a business flow with authentication prerequisite as an auth test", () => {
    const scenario = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase([
        ...explicitAuthSteps.slice(0, 4),
        { content: "Navegar a la sección de reportes." },
        { content: "Validar que se muestre el reporte solicitado." },
    ]));
    strict_1.default.equal(scenario.authIntent, undefined);
    strict_1.default.equal((0, case_discovery_1.isAuthenticationTestScenario)(scenario), false);
});
(0, node_test_1.default)("preserves explicit gate_observation", () => {
    const scenario = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase(explicitAuthSteps, { authIntent: "gate_observation" }));
    strict_1.default.equal(scenario.authIntent, "gate_observation");
    strict_1.default.equal((0, case_discovery_1.isAuthenticationTestScenario)(scenario), false);
});
(0, node_test_1.default)("preserves explicit full_authentication", () => {
    const scenario = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase([], { authIntent: "full_authentication" }));
    strict_1.default.equal(scenario.authIntent, "full_authentication");
});
(0, node_test_1.default)("classifies a post-submit auxiliary action after an auth wait as full_authentication", () => {
    const scenario = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase([
        ...explicitAuthSteps.slice(0, 4),
        { content: "Esperar que finalice el proceso de autenticación." },
        { content: "Hacer clic en un control auxiliar." },
        { content: "Validar que el formulario de acceso ya no sea la pantalla activa." },
        { content: "Validar que se muestre la pantalla inicial autenticada." },
    ]));
    strict_1.default.equal(scenario.authIntent, "full_authentication");
});
(0, node_test_1.default)("does not classify a post-submit action as auxiliary without an auth wait", () => {
    const scenario = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase([
        ...explicitAuthSteps.slice(0, 4),
        { content: "Hacer clic en un control auxiliar." },
        { content: "Validar que se muestre la pantalla autenticada." },
    ]));
    strict_1.default.equal(scenario.authIntent, undefined);
});
(0, node_test_1.default)("keeps business actions after an auxiliary action outside full_authentication", () => {
    const scenario = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase([
        ...explicitAuthSteps.slice(0, 4),
        { content: "Esperar que finalice el proceso de autenticación." },
        { content: "Hacer clic en un control auxiliar." },
        { content: "Hacer clic en una función del negocio." },
        { content: "Validar que se muestre el resultado del negocio." },
    ]));
    strict_1.default.equal(scenario.authIntent, undefined);
});
