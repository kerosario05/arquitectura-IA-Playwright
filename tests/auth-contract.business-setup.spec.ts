import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { isAuthenticationTestScenario, shouldPerformBusinessFlowAuthSetup, shouldInvokeAuthGateRecovery, getLoginStepsToConsume, loadProjectAuthProfile } from "../src/discovery/case-discovery";
import { parseScenarioStepsForDiscovery } from "../src/discovery/case-discovery";

test("parseScenarioStepsForDiscovery preserves structured requiredContext", () => {
  const structuredContext = {
    destinationIdentity: "screen-alpha",
    routeRole: "role-alpha",
    destinationRole: "role-beta",
  };
  const parsed: any = parseScenarioStepsForDiscovery({
    title: "Structured assertion",
    steps: [{
      action: 'Validar que se muestre "Arbitrary Alpha"',
      index: 0,
      requiredContext: structuredContext,
    }],
  } as any);
  expect(parsed.assertionTargets[0].requiredContext).toEqual(structuredContext);

  const textOnly: any = parseScenarioStepsForDiscovery({
    title: "Text only",
    steps: [{ action: 'Validar que se muestre "Arbitrary Beta"', index: 0 }],
  } as any);
  expect(textOnly.assertionTargets[0].requiredContext).toBeUndefined();

  const legacy: any = parseScenarioStepsForDiscovery({
    title: "Legacy",
    steps: [{ action: 'Validar que se muestre "Arbitrary Gamma"', index: 0 }],
  } as any);
  expect(legacy.assertionTargets[0]).toBeDefined();
  expect(legacy.assertionTargets[0].requiredContext).toBeUndefined();
});

function makeScenario(overrides: any = {}) {
  return {
    title: overrides.title ?? "Transferencia privada",
    steps: overrides.steps ?? [],
    preconditions: overrides.preconditions ?? "",
    raw: overrides.raw ?? {},
    authIntent: overrides.authIntent,
    ...overrides,
  } as any;
}

test.describe("auth contract business setup", () => {
  test("auth-test decision skips proactive auth recovery while business flows preserve it", () => {
    expect(shouldInvokeAuthGateRecovery(true)).toBe(false);
    expect(shouldInvokeAuthGateRecovery(false)).toBe(true);
    // gate_observation remains a separate contract and is not reclassified here.
  });

  test("CASE A: negative login with authIntent full + subject authentication_test + credenciales inválidas => no preAuth", () => {
    const scenario = makeScenario({
      title: "Ingresar credenciales incorrectas",
      authIntent: "full_authentication",
      type: "authentication_test",
      automationType: "authentication_test",
      steps: [
        { action: 'Clic en "Iniciar sesion".', index: 0 },
        { action: 'Validar que se muestre "Credenciales inválidas".', index: 1 },
      ],
    });
    const parsed: any = {
      actionTargets: [{ target: "Iniciar sesion", index: 0 }],
      assertionTargets: [{ target: "Credenciales inválidas" }],
    };
    // Authoritative subject signals should dominate over heuristic (assertion not login label but auth-related)
    expect(isAuthenticationTestScenario(scenario, parsed)).toBe(true);
    expect(shouldPerformBusinessFlowAuthSetup(scenario, parsed)).toBe(false);
  });

  test("CASE B: business_flow with login + Transferencias => preAuth true, login consumed", () => {
    const scenario = makeScenario({
      title: "Transferencia a cuenta propia",
      authIntent: "full_authentication",
      type: "transactional",
      functionalBranch: { actionIntent: "transfer", branchId: "transferencias" },
      steps: [
        { action: 'Clic en "Iniciar sesion".', index: 0 },
        { action: 'Clic en "Transferencias".', index: 1 },
        { action: 'Clic en "Cuentas Propias".', index: 2 },
      ],
    });
    const parsed: any = {
      actionTargets: [
        { target: "Iniciar sesion", index: 0, actionIntent: "authentication", targetRole: "authentication" },
        { target: "Transferencias", index: 1 },
        { target: "Cuentas Propias", index: 2 },
      ],
      assertionTargets: [{ target: "Transferencias" }],
    };
    expect(isAuthenticationTestScenario(scenario, parsed)).toBe(false);
    expect(shouldPerformBusinessFlowAuthSetup(scenario, parsed)).toBe(true);
    const consumed = getLoginStepsToConsume(parsed);
    expect(consumed.has(0)).toBe(true);
    expect(consumed.has(1)).toBe(false);
  });

  test("CASE C: gate_observation preserved", () => {
    const scenario = makeScenario({
      title: "Observar gate de autenticación",
      authIntent: "gate_observation",
      steps: [{ action: 'Validar que se muestre "Iniciar sesion".', index: 0 }],
    });
    const parsed: any = { actionTargets: [], assertionTargets: [{ target: "Iniciar sesion" }] };
    expect(shouldPerformBusinessFlowAuthSetup(scenario, parsed)).toBe(false);
    expect(isAuthenticationTestScenario(scenario, parsed)).toBe(false);
  });

  test("CASE D: no structured metadata does not classify authentication test", () => {
    const scenario = makeScenario({
      title: "Titulo generico sin metadata",
      authIntent: "full_authentication",
      steps: [{ action: 'Clic en "Iniciar sesion".', index: 0 }],
    });
    const parsed: any = {
      actionTargets: [{ target: "Iniciar sesion", index: 0 }],
      assertionTargets: [],
    };
    expect(isAuthenticationTestScenario(scenario, parsed)).toBe(false);
    expect(shouldPerformBusinessFlowAuthSetup(scenario, parsed)).toBe(true);
  });

  test("TEST4: project isolation variant A vs B", () => {
    const slugA = "auth-variant-a-test";
    const slugB = "auth-variant-b-test";
    const dirA = path.join(process.cwd(), "automations", "apps", slugA);
    const dirB = path.join(process.cwd(), "automations", "apps", slugB);
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    const cfgA = {
      name: "A",
      baseUrl: "https://a.example/",
      authProfiles: { custom: { variant: "variant-a", loginMode: "password" } },
      authProfile: "custom",
    };
    const cfgB = {
      name: "B",
      baseUrl: "https://b.example/",
      authProfiles: { custom: { variant: "variant-b", accountType: "business" } },
      authProfile: "custom",
    };
    fs.writeFileSync(path.join(dirA, "app.config.json"), JSON.stringify(cfgA, null, 2));
    fs.writeFileSync(path.join(dirB, "app.config.json"), JSON.stringify(cfgB, null, 2));
    try {
      const resA = loadProjectAuthProfile(slugA);
      const resB = loadProjectAuthProfile(slugB);
      expect(resA.source).toBe("app_config");
      expect(resB.source).toBe("app_config");
      expect((resA.profile as any).variant).toBe("variant-a");
      expect((resB.profile as any).variant).toBe("variant-b");
      expect((resA.profile as any).variant).not.toBe((resB.profile as any).variant);
    } finally {
      fs.rmSync(dirA, { recursive: true, force: true });
      fs.rmSync(dirB, { recursive: true, force: true });
    }
  });
});
