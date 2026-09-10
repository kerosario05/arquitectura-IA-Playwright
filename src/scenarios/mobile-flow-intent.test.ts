import assert from "node:assert";
import { materializeFunctionalPrerequisite, type MobileGeneratedScenario } from "./mobile-scenario-generator";
import type { MobileRouteProfile } from "../mobile/mobile-route-profile.types";
import type { MobileStep } from "../mobile/mobile-step-types";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

/** Route profile whose FIRST flow is registration, as the learning JSON is meant to look. */
function profileWithRegistro(): MobileRouteProfile {
  return {
    appSlug: "test-app",
    packageName: "com.test",
    appName: "Test",
    platform: "android",
    mainActivity: "com.test.Main",
    updatedAt: "2026-09-02T00:00:00.000Z",
    screens: {},
    flows: {
      registro: {
        description: "Registro de un nuevo cliente desde la pantalla inicial",
        triggerKeywords: ["registro", "registrarse", "nuevo cliente", "onboarding"],
        entryFromScreen: "bienvenida",
        entrySteps: [
          { action: "click", description: "Iniciar registro", target: { strategy: "accessibilityId", value: "Registrarme" } },
          { action: "fill", description: "Documento", target: { strategy: "accessibilityId", value: "Numero de documento" }, value: "" },
          { action: "click", description: "Continuar", target: { strategy: "accessibilityId", value: "Continuar" } },
        ],
      },
      login: {
        description: "Ingreso de un cliente existente",
        triggerKeywords: ["iniciar sesion", "login", "cliente existente"],
        entrySteps: [{ action: "click", target: { strategy: "accessibilityId", value: "Ingresar" } }],
      },
    },
  };
}

function scenario(partial: Partial<MobileGeneratedScenario> & { title: string; steps: MobileStep[] }): MobileGeneratedScenario {
  return {
    scenarioId: "MOBILE-TEST-001",
    sourceIssueKey: "AA-94",
    expectedResult: "ok",
    preconditions: [],
    requiredData: [],
    ...partial,
  } as MobileGeneratedScenario;
}

describe("intent-driven flow materialization (no functional precondition)", () => {
  test("a registration HU starts at the beginning of the registro flow", () => {
    const s = scenario({
      title: "Confirmacion de Datos de Contacto en el registro",
      steps: [
        { action: "launchApp", description: "Abrir la app" },
        { action: "assertVisible", description: "Ver telefono", target: { strategy: "accessibilityId", value: "Numero de telefono" } },
      ],
    });
    const out = materializeFunctionalPrerequisite(s, profileWithRegistro());
    assert.ok(out.prerequisiteSteps, "should have prerequisiteSteps");
    assert.strictEqual(out.prerequisiteSteps!.length, 3);
    assert.deepStrictEqual(
      out.prerequisiteSteps!.map((st) => st.target?.value),
      ["Registrarme", "Numero de documento", "Continuar"],
    );
    assert.notStrictEqual(out.requiresRouteLearning, true);
  });

  test("matches the flow whose keywords fit, not the first one declared", () => {
    const s = scenario({
      title: "Ingreso de un cliente existente por login",
      steps: [{ action: "launchApp" }, { action: "assertVisible", target: { strategy: "accessibilityId", value: "Saldo" } }],
    });
    const out = materializeFunctionalPrerequisite(s, profileWithRegistro());
    assert.deepStrictEqual(out.prerequisiteSteps?.map((st) => st.target?.value), ["Ingresar"]);
  });

  test("the word 'cliente' alone does not drag a login story into registro", () => {
    // Regression: the loose morphological matcher scored "nuevo cliente" as hit by the
    // single token "cliente", routing every story mentioning a client into registration.
    const s = scenario({
      title: "El cliente consulta su saldo",
      steps: [{ action: "launchApp" }, { action: "assertVisible", target: { strategy: "accessibilityId", value: "Saldo" } }],
    });
    const out = materializeFunctionalPrerequisite(s, profileWithRegistro());
    assert.strictEqual(out.prerequisiteSteps, undefined, "'cliente' is not 'nuevo cliente'");
  });

  test("a story unrelated to any flow is left untouched", () => {
    const s = scenario({
      title: "Consultar el detalle de un prestamo",
      steps: [{ action: "launchApp" }, { action: "assertVisible", target: { strategy: "accessibilityId", value: "Prestamos" } }],
    });
    const out = materializeFunctionalPrerequisite(s, profileWithRegistro());
    assert.strictEqual(out.prerequisiteSteps, undefined, "no flow matched -> unchanged");
  });

  test("does not duplicate a prologue the scenario already walks", () => {
    const s = scenario({
      title: "Registro completo de nuevo cliente",
      steps: [
        { action: "launchApp" },
        { action: "click", target: { strategy: "accessibilityId", value: "Registrarme" } },
        { action: "fill", target: { strategy: "accessibilityId", value: "Numero de documento" }, value: "001" },
        { action: "click", target: { strategy: "accessibilityId", value: "Continuar" } },
      ],
    });
    const out = materializeFunctionalPrerequisite(s, profileWithRegistro());
    assert.strictEqual(out.prerequisiteSteps, undefined, "scenario already covers the entry path");
  });

  test("no route profile -> unchanged (no crash)", () => {
    const s = scenario({ title: "Registro de nuevo cliente", steps: [{ action: "launchApp" }] });
    assert.strictEqual(materializeFunctionalPrerequisite(s, null).prerequisiteSteps, undefined);
  });

  test("a scenario already flagged for route learning is untouched", () => {
    const s = scenario({ title: "Registro", steps: [{ action: "launchApp" }], requiresRouteLearning: true });
    const out = materializeFunctionalPrerequisite(s, profileWithRegistro());
    assert.strictEqual(out.prerequisiteSteps, undefined);
    assert.strictEqual(out.requiresRouteLearning, true);
  });
});

describe("existing precondition-driven behaviour is preserved", () => {
  test("functional precondition still materializes the matching flow", () => {
    const s = scenario({
      title: "Ver datos de contacto",
      preconditions: ["El cliente ya completo el registro previamente"],
      steps: [{ action: "launchApp" }, { action: "assertVisible", target: { strategy: "accessibilityId", value: "Telefono" } }],
    });
    const out = materializeFunctionalPrerequisite(s, profileWithRegistro());
    assert.ok(out.prerequisiteSteps, "precondition path must still work");
    assert.strictEqual(out.prerequisiteSteps!.length, 3);
  });

  test("functional precondition with no matching flow still marks route learning", () => {
    const emptyFlows: MobileRouteProfile = { ...profileWithRegistro(), flows: {} };
    const s = scenario({
      title: "Algo totalmente distinto",
      preconditions: ["El usuario ya supero las validaciones"],
      steps: [{ action: "launchApp" }, { action: "assertVisible", target: { strategy: "accessibilityId", value: "X" } }],
    });
    const out = materializeFunctionalPrerequisite(s, emptyFlows);
    assert.strictEqual(out.requiresRouteLearning, true);
  });
});
