import { test, expect } from "@playwright/test";
import { isAuthenticationTestScenario, shouldPerformBusinessFlowAuthSetup } from "../src/discovery/case-discovery";

test("precondition usuario autenticado no convierte negocio en authentication_test", () => {
  const scenario: any = {
    authIntent: "full_authentication",
    intent: "transactional_document_flow",
    preconditions: ["Usuario autenticado"],
    steps: [{ action: 'Clic en "Transferencias".', index: 0 }, { action: 'Clic en "Cuentas Propias".', index: 1 }],
    type: "transactional",
    automationType: "business",
    title: "Flujo documental transaccional",
  };
  const parsed: any = {
    actionTargets: [{ target: "Transferencias", index: 0 }, { target: "Cuentas Propias", index: 1 }],
    assertionTargets: [],
  };
  expect(isAuthenticationTestScenario(scenario, parsed)).toBe(false);
  expect(shouldPerformBusinessFlowAuthSetup(scenario, parsed)).toBe(true);
});

test("authentication_test con credenciales invalidas no preautentica", () => {
  const scenario: any = {
    authIntent: "full_authentication",
    subject: "authentication_test",
    intent: "authentication_test",
    expected: "Credenciales inválidas",
    type: "authentication_test",
    steps: [{ action: 'Clic en "Iniciar sesion".', index: 0 }],
  };
  const parsed: any = {
    actionTargets: [{ target: "Iniciar sesion", index: 0 }],
    assertionTargets: [{ target: "Credenciales inválidas" }],
  };
  expect(isAuthenticationTestScenario(scenario, parsed)).toBe(true);
  expect(shouldPerformBusinessFlowAuthSetup(scenario, parsed)).toBe(false);
});
