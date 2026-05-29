/**
 * Expected Result Mode Tests
 * 
 * Tests for DISCOVERY_EXPECTED_RESULT_MODE configuration.
 * Verifies that mode=context treats expected results as non-blocking context.
 */

import { test, expect } from "@playwright/test";
import { parseScenarioStepsForDiscovery } from "../src/discovery/case-discovery";
import type { TestScenario } from "../src/types/testrail.types";

test.describe("Expected Result Mode", () => {
  test("mode=context: expected results do not create assertion targets", () => {
    const scenario: TestScenario = {
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

    const result = parseScenarioStepsForDiscovery(scenario);

    // Should have assertions from steps only
    const stepAssertions = result.assertionTargets.filter(a => a.source === "action");
    expect(stepAssertions).toHaveLength(2);
    expect(stepAssertions.map(a => a.target)).toEqual([
      "Consulta de balance",
      "Volver al menú principal"
    ]);

    // Should NOT have assertions from expected results
    const expectedAssertions = result.assertionTargets.filter(a => a.source === "expected");
    expect(expectedAssertions).toHaveLength(0);

    // Expected results should be stored as non-executable criteria
    expect(result.nonExecutableCriteria).toHaveLength(3);
    expect(result.expectedResultConsumption).toHaveLength(3);
    result.expectedResultConsumption?.forEach(consumption => {
      expect(consumption.classification).toBe("non_executable_criteria");
    });
  });

  test("mode=context: explicit step assertions are still created", () => {
    const scenario: TestScenario = {
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

    const result = parseScenarioStepsForDiscovery(scenario);

    // Should have assertion from step
    const stepAssertions = result.assertionTargets.filter(a => a.source === "action");
    expect(stepAssertions).toHaveLength(1);
    expect(stepAssertions[0].target).toBe("Tarjetas");

    // Should NOT have assertion from expected result
    const expectedAssertions = result.assertionTargets.filter(a => a.source === "expected");
    expect(expectedAssertions).toHaveLength(0);

    // Expected result should be non-executable
    expect(result.nonExecutableCriteria).toHaveLength(1);
  });

  test("mode=context: ordered steps include only step assertions", () => {
    const scenario: TestScenario = {
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

    const result = parseScenarioStepsForDiscovery(scenario);

    // Ordered steps should have 1 action and 1 assertion (from step, not expected)
    const actions = result.orderedSteps.filter(s => s.type === "action_click");
    const assertions = result.orderedSteps.filter(s => s.type === "assertion");

    expect(actions).toHaveLength(1);
    expect(assertions).toHaveLength(1);
    expect(assertions[0].source).toBe("action");
    expect(assertions[0].target).toBe("Menu visible");
  });

  test("mode=context: empty expected results handled correctly", () => {
    const scenario: TestScenario = {
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

    const result = parseScenarioStepsForDiscovery(scenario);

    expect(result.assertionTargets).toHaveLength(0);
    expect(result.nonExecutableCriteria).toBeUndefined();
    expect(result.expectedResultConsumption).toBeUndefined();
  });

  test("mode=context: abstract expected results do not block", () => {
    const scenario: TestScenario = {
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

    const result = parseScenarioStepsForDiscovery(scenario);

    // No assertions should be created from expected results
    expect(result.assertionTargets).toHaveLength(0);

    // All expected results should be non-executable
    expect(result.nonExecutableCriteria).toHaveLength(3);
    result.expectedResultConsumption?.forEach(c => {
      expect(c.classification).toBe("non_executable_criteria");
      expect(c.reason).toContain("mode=context");
    });
  });
});
