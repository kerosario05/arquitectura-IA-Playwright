"use strict";
/**
 * Expected Result Mode Tests
 *
 * Tests for DISCOVERY_EXPECTED_RESULT_MODE configuration.
 * Verifies that mode=context treats expected results as non-blocking context.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const case_discovery_1 = require("../src/discovery/case-discovery");
test_1.test.describe("Expected Result Mode", () => {
    (0, test_1.test)("mode=context: expected results do not create assertion targets", () => {
        const scenario = {
            source: "testrail",
            externalId: "C38230",
            caseId: 38230,
            title: "Visualizar listado de depósitos a plazo",
            steps: [
                {
                    index: 0,
                    action: "Clic en 'Iniciar'.",
                    expected: "",
                    dataHints: []
                },
                {
                    index: 1,
                    action: "Clic en 'Transacciones y servicios'.",
                    expected: "",
                    dataHints: []
                },
                {
                    index: 2,
                    action: "Validar que se muestre 'Consulta de balance'.",
                    expected: "",
                    dataHints: []
                },
                {
                    index: 3,
                    action: "Clic en 'Consulta de balance'.",
                    expected: "",
                    dataHints: []
                },
                {
                    index: 4,
                    action: "Clic en 'Depósitos a plazos'.",
                    expected: "",
                    dataHints: []
                },
                {
                    index: 5,
                    action: "Validar que se muestre 'Volver al menú principal'.",
                    expected: "El cliente accede por Transacciones y servicios y AuthGate completa el login cuando aplique.\nSe muestra el listado de depósitos a plazo disponibles para consulta.\nLa pantalla permite seleccionar un depósito o volver al menú principal.",
                    dataHints: []
                }
            ]
        };
        const result = (0, case_discovery_1.parseScenarioStepsForDiscovery)(scenario);
        // Should have assertions from steps only
        const stepAssertions = result.assertionTargets.filter(a => a.source === "action");
        (0, test_1.expect)(stepAssertions).toHaveLength(2);
        (0, test_1.expect)(stepAssertions.map(a => a.target)).toEqual([
            "Consulta de balance",
            "Volver al menú principal"
        ]);
        // Should NOT have assertions from expected results
        const expectedAssertions = result.assertionTargets.filter(a => a.source === "expected");
        (0, test_1.expect)(expectedAssertions).toHaveLength(0);
        // Expected results should be stored as non-executable criteria
        (0, test_1.expect)(result.nonExecutableCriteria).toHaveLength(3);
        (0, test_1.expect)(result.expectedResultConsumption).toHaveLength(3);
        result.expectedResultConsumption?.forEach(consumption => {
            (0, test_1.expect)(consumption.classification).toBe("non_executable_criteria");
        });
    });
    (0, test_1.test)("mode=context: explicit step assertions are still created", () => {
        const scenario = {
            source: "testrail",
            externalId: "C38231",
            caseId: 38231,
            title: "Test with explicit step assertions",
            steps: [
                {
                    index: 0,
                    action: "Clic en 'Productos'.",
                    expected: "",
                    dataHints: []
                },
                {
                    index: 1,
                    action: "Validar que se muestre 'Tarjetas'.",
                    expected: "",
                    dataHints: []
                },
                {
                    index: 2,
                    action: "Clic en 'Tarjetas'.",
                    expected: "El cliente visualiza el detalle de tarjetas.",
                    dataHints: []
                }
            ]
        };
        const result = (0, case_discovery_1.parseScenarioStepsForDiscovery)(scenario);
        // Should have assertion from step
        const stepAssertions = result.assertionTargets.filter(a => a.source === "action");
        (0, test_1.expect)(stepAssertions).toHaveLength(1);
        (0, test_1.expect)(stepAssertions[0].target).toBe("Tarjetas");
        // Should NOT have assertion from expected result
        const expectedAssertions = result.assertionTargets.filter(a => a.source === "expected");
        (0, test_1.expect)(expectedAssertions).toHaveLength(0);
        // Expected result should be non-executable
        (0, test_1.expect)(result.nonExecutableCriteria).toHaveLength(1);
    });
    (0, test_1.test)("mode=context: ordered steps include only step assertions", () => {
        const scenario = {
            source: "testrail",
            externalId: "C38232",
            caseId: 38232,
            title: "Test ordered steps",
            steps: [
                {
                    index: 0,
                    action: "Clic en 'Inicio'.",
                    expected: "",
                    dataHints: []
                },
                {
                    index: 1,
                    action: "Validar 'Menu visible'.",
                    expected: "El sistema muestra el menu correctamente.",
                    dataHints: []
                }
            ]
        };
        const result = (0, case_discovery_1.parseScenarioStepsForDiscovery)(scenario);
        // Ordered steps should have 1 action and 1 assertion (from step, not expected)
        const actions = result.orderedSteps.filter(s => s.type === "action_click");
        const assertions = result.orderedSteps.filter(s => s.type === "assertion");
        (0, test_1.expect)(actions).toHaveLength(1);
        (0, test_1.expect)(assertions).toHaveLength(1);
        (0, test_1.expect)(assertions[0].source).toBe("action");
        (0, test_1.expect)(assertions[0].target).toBe("Menu visible");
    });
    (0, test_1.test)("mode=context: empty expected results handled correctly", () => {
        const scenario = {
            source: "testrail",
            externalId: "C38233",
            caseId: 38233,
            title: "Test with no expected results",
            steps: [
                {
                    index: 0,
                    action: "Clic en 'Login'.",
                    expected: "",
                    dataHints: []
                }
            ]
        };
        const result = (0, case_discovery_1.parseScenarioStepsForDiscovery)(scenario);
        (0, test_1.expect)(result.assertionTargets).toHaveLength(0);
        (0, test_1.expect)(result.nonExecutableCriteria).toBeUndefined();
        (0, test_1.expect)(result.expectedResultConsumption).toBeUndefined();
    });
    (0, test_1.test)("mode=context: abstract expected results do not block", () => {
        const scenario = {
            source: "testrail",
            externalId: "C38234",
            caseId: 38234,
            title: "Test abstract expected results",
            steps: [
                {
                    index: 0,
                    action: "Completar flujo de compra.",
                    expected: "La operación se realiza exitosamente.\nEl cliente puede consultar su historial.\nEl sistema muestra confirmación del pedido.",
                    dataHints: []
                }
            ]
        };
        const result = (0, case_discovery_1.parseScenarioStepsForDiscovery)(scenario);
        // No assertions should be created from expected results
        (0, test_1.expect)(result.assertionTargets).toHaveLength(0);
        // All expected results should be non-executable
        (0, test_1.expect)(result.nonExecutableCriteria).toHaveLength(3);
        result.expectedResultConsumption?.forEach(c => {
            (0, test_1.expect)(c.classification).toBe("non_executable_criteria");
            (0, test_1.expect)(c.reason).toContain("mode=context");
        });
    });
});
