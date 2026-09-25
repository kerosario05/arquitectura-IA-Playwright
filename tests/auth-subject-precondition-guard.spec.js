"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const case_discovery_1 = require("../src/discovery/case-discovery");
(0, test_1.test)("precondition usuario autenticado no convierte negocio en authentication_test", () => {
    const scenario = {
        authIntent: "full_authentication",
        intent: "transactional_document_flow",
        preconditions: ["Usuario autenticado"],
        steps: [{ action: 'Clic en "Transferencias".', index: 0 }, { action: 'Clic en "Cuentas Propias".', index: 1 }],
        type: "transactional",
        automationType: "business",
        title: "Flujo documental transaccional",
    };
    const parsed = {
        actionTargets: [{ target: "Transferencias", index: 0 }, { target: "Cuentas Propias", index: 1 }],
        assertionTargets: [],
    };
    (0, test_1.expect)((0, case_discovery_1.isAuthenticationTestScenario)(scenario, parsed)).toBe(false);
    (0, test_1.expect)((0, case_discovery_1.shouldPerformBusinessFlowAuthSetup)(scenario, parsed)).toBe(true);
});
(0, test_1.test)("authentication_test con credenciales invalidas no preautentica", () => {
    const scenario = {
        authIntent: "full_authentication",
        subject: "authentication_test",
        intent: "authentication_test",
        expected: "Credenciales inválidas",
        type: "authentication_test",
        steps: [{ action: 'Clic en "Iniciar sesion".', index: 0 }],
    };
    const parsed = {
        actionTargets: [{ target: "Iniciar sesion", index: 0 }],
        assertionTargets: [{ target: "Credenciales inválidas" }],
    };
    (0, test_1.expect)((0, case_discovery_1.isAuthenticationTestScenario)(scenario, parsed)).toBe(true);
    (0, test_1.expect)((0, case_discovery_1.shouldPerformBusinessFlowAuthSetup)(scenario, parsed)).toBe(false);
});
