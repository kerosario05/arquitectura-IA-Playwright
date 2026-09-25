"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const mobile_scenario_generator_1 = require("./mobile-scenario-generator");
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}
/** Route profile whose FIRST flow is registration, as the learning JSON is meant to look. */
function profileWithRegistro() {
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
function scenario(partial) {
    return {
        scenarioId: "MOBILE-TEST-001",
        sourceIssueKey: "AA-94",
        expectedResult: "ok",
        preconditions: [],
        requiredData: [],
        ...partial,
    };
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
        const out = (0, mobile_scenario_generator_1.materializeFunctionalPrerequisite)(s, profileWithRegistro());
        node_assert_1.default.ok(out.prerequisiteSteps, "should have prerequisiteSteps");
        node_assert_1.default.strictEqual(out.prerequisiteSteps.length, 3);
        node_assert_1.default.deepStrictEqual(out.prerequisiteSteps.map((st) => st.target?.value), ["Registrarme", "Numero de documento", "Continuar"]);
        node_assert_1.default.notStrictEqual(out.requiresRouteLearning, true);
    });
    test("matches the flow whose keywords fit, not the first one declared", () => {
        const s = scenario({
            title: "Ingreso de un cliente existente por login",
            steps: [{ action: "launchApp" }, { action: "assertVisible", target: { strategy: "accessibilityId", value: "Saldo" } }],
        });
        const out = (0, mobile_scenario_generator_1.materializeFunctionalPrerequisite)(s, profileWithRegistro());
        node_assert_1.default.deepStrictEqual(out.prerequisiteSteps?.map((st) => st.target?.value), ["Ingresar"]);
    });
    test("the word 'cliente' alone does not drag a login story into registro", () => {
        // Regression: the loose morphological matcher scored "nuevo cliente" as hit by the
        // single token "cliente", routing every story mentioning a client into registration.
        const s = scenario({
            title: "El cliente consulta su saldo",
            steps: [{ action: "launchApp" }, { action: "assertVisible", target: { strategy: "accessibilityId", value: "Saldo" } }],
        });
        const out = (0, mobile_scenario_generator_1.materializeFunctionalPrerequisite)(s, profileWithRegistro());
        node_assert_1.default.strictEqual(out.prerequisiteSteps, undefined, "'cliente' is not 'nuevo cliente'");
    });
    test("a story unrelated to any flow is left untouched", () => {
        const s = scenario({
            title: "Consultar el detalle de un prestamo",
            steps: [{ action: "launchApp" }, { action: "assertVisible", target: { strategy: "accessibilityId", value: "Prestamos" } }],
        });
        const out = (0, mobile_scenario_generator_1.materializeFunctionalPrerequisite)(s, profileWithRegistro());
        node_assert_1.default.strictEqual(out.prerequisiteSteps, undefined, "no flow matched -> unchanged");
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
        const out = (0, mobile_scenario_generator_1.materializeFunctionalPrerequisite)(s, profileWithRegistro());
        node_assert_1.default.strictEqual(out.prerequisiteSteps, undefined, "scenario already covers the entry path");
    });
    test("no route profile -> unchanged (no crash)", () => {
        const s = scenario({ title: "Registro de nuevo cliente", steps: [{ action: "launchApp" }] });
        node_assert_1.default.strictEqual((0, mobile_scenario_generator_1.materializeFunctionalPrerequisite)(s, null).prerequisiteSteps, undefined);
    });
    test("a scenario already flagged for route learning is untouched", () => {
        const s = scenario({ title: "Registro", steps: [{ action: "launchApp" }], requiresRouteLearning: true });
        const out = (0, mobile_scenario_generator_1.materializeFunctionalPrerequisite)(s, profileWithRegistro());
        node_assert_1.default.strictEqual(out.prerequisiteSteps, undefined);
        node_assert_1.default.strictEqual(out.requiresRouteLearning, true);
    });
});
describe("existing precondition-driven behaviour is preserved", () => {
    test("functional precondition still materializes the matching flow", () => {
        const s = scenario({
            title: "Ver datos de contacto",
            preconditions: ["El cliente ya completo el registro previamente"],
            steps: [{ action: "launchApp" }, { action: "assertVisible", target: { strategy: "accessibilityId", value: "Telefono" } }],
        });
        const out = (0, mobile_scenario_generator_1.materializeFunctionalPrerequisite)(s, profileWithRegistro());
        node_assert_1.default.ok(out.prerequisiteSteps, "precondition path must still work");
        node_assert_1.default.strictEqual(out.prerequisiteSteps.length, 3);
    });
    test("functional precondition with no matching flow still marks route learning", () => {
        const emptyFlows = { ...profileWithRegistro(), flows: {} };
        const s = scenario({
            title: "Algo totalmente distinto",
            preconditions: ["El usuario ya supero las validaciones"],
            steps: [{ action: "launchApp" }, { action: "assertVisible", target: { strategy: "accessibilityId", value: "X" } }],
        });
        const out = (0, mobile_scenario_generator_1.materializeFunctionalPrerequisite)(s, emptyFlows);
        node_assert_1.default.strictEqual(out.requiresRouteLearning, true);
    });
});
