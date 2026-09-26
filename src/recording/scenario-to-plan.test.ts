import assert from "node:assert";
import { toExecutionPlan } from "./scenario-to-plan";
import type { RecordedScenario, RecordedWebStep } from "./trace-to-scenario";

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

const BASE_URL = "https://portal.qa.test";

function scenarioWith(
  webSteps: RecordedWebStep[],
  requiredData: RecordedScenario["requiredData"] = [],
): RecordedScenario {
  return {
    scenarioId: "REC-AABBCCDD-01",
    title: "Consulta de cliente",
    description: "",
    preconditions: [`Acceso a ${BASE_URL}`],
    kind: "happy_path",
    provenance: "observed",
    scope: "end_to_end",
    mobileSteps: [],
    webSteps,
    testRailSteps: [],
    requiredData,
    stepTargets: [],
    sourceRecordingId: "aabbccdd-1111-2222-3333-444455556666",
    hasUncertainSteps: false,
  };
}

describe("toExecutionPlan · acciones", () => {
  const { plan } = toExecutionPlan(
    scenarioWith([
      { action: "navigate", value: BASE_URL, description: `Navegar a ${BASE_URL}` },
      { action: "click", target: { strategy: "text", value: "Consultar" }, description: 'Presionar "Consultar"' },
      { action: "assert", target: { strategy: "text", value: "Resultado" }, description: 'Verificar "Resultado"' },
      { action: "wait", target: { strategy: "css", value: "#spinner" }, description: "Esperar" },
    ]),
    { baseUrl: BASE_URL },
  );

  test("la navegación inicial apunta a la baseUrl del proyecto, no a una URL fija", () => {
    assert.strictEqual(plan.steps[0].action, "navigate");
    assert.strictEqual(plan.steps[0].target, "APP_BASE_URL");
  });

  test("traduce a las acciones que el ejecutor conoce", () => {
    assert.deepStrictEqual(
      plan.steps.map((s) => s.action),
      ["navigate", "click", "assertVisible", "waitFor"],
    );
  });

  // El validador del plan rechaza el índice 0: la numeración de un plan empieza en 1.
  test("numera los pasos desde 1, como exige el validador", () => {
    assert.deepStrictEqual(plan.steps.map((s) => s.index), [1, 2, 3, 4]);
  });

  test("nace en draft: un plan se promueve por haber corrido, no por estar escrito", () => {
    assert.strictEqual(plan.status, "draft");
  });
});

describe("toExecutionPlan · navegaciones posteriores", () => {
  // El recorder web las emite desde `framenavigated`: son consecuencia de un clic, no una
  // acción de la persona. Reejecutarlas saltaría el flujo.
  const { plan } = toExecutionPlan(
    scenarioWith([
      { action: "navigate", value: BASE_URL, description: "Navegar" },
      { action: "click", target: { strategy: "text", value: "Entrar" }, description: "Presionar" },
      { action: "navigate", value: `${BASE_URL}/clientes/detalle?token=abc123`, description: "Navegar" },
    ]),
    { baseUrl: BASE_URL },
  );

  test("se convierten en una verificación de URL, no en otra navegación", () => {
    assert.strictEqual(plan.steps[2].action, "assertUrl");
  });

  test("afirman la ruta y no el token, que cambia en cada corrida", () => {
    assert.strictEqual(plan.steps[2].expected, "/clientes/detalle");
  });
});

describe("toExecutionPlan · localizadores", () => {
  const { plan } = toExecutionPlan(
    scenarioWith([
      { action: "click", target: { strategy: "data-testid", value: "submit" }, description: "a" },
      { action: "click", target: { strategy: "aria-label", value: "Cerrar" }, description: "b" },
      { action: "click", target: { strategy: "role", value: "button|Continuar" }, description: "c" },
      { action: "click", target: { strategy: "css", value: "#id" }, description: "d" },
    ]),
  );

  test("mapea las estrategias del recorder a las del ejecutor", () => {
    assert.deepStrictEqual(
      plan.steps.map((s) => (s.target && s.target !== "APP_BASE_URL" ? s.target.strategy : null)),
      ["testId", "label", "role", "css"],
    );
  });

  // El recorder empaqueta rol y nombre en un solo valor porque un locator grabado es un
  // valor; getByRole los necesita separados.
  test("parte el rol y el nombre accesible en dos campos", () => {
    const target = plan.steps[2].target;
    assert.ok(target && target !== "APP_BASE_URL");
    assert.strictEqual(target.role, "button");
    assert.strictEqual(target.name, "Continuar");
  });
});

describe("toExecutionPlan · datos", () => {
  const scenario = scenarioWith(
    [
      { action: "fill", target: { strategy: "css", value: "#cedula" }, value: "402-1234567-8", description: "a" },
      { action: "fill", target: { strategy: "css", value: "#clave" }, value: "", description: "b" },
    ],
    [
      { key: "cedula", label: "Cédula", stepIndex: 0, exampleValue: "402-1234567-8", sensitive: false },
      { key: "clave", label: "Clave", stepIndex: 1, sensitive: true },
    ],
  );
  const { plan, suggestedData } = toExecutionPlan(scenario);

  test("cada campo se resuelve por clave, para que el revisor pueda sustituir el valor", () => {
    assert.deepStrictEqual(plan.steps.map((s) => s.valueKey), ["cedula", "clave"]);
    assert.ok(plan.steps.every((s) => s.value === undefined));
  });

  test("el valor grabado viaja como sugerencia, no incrustado en el paso", () => {
    assert.deepStrictEqual(suggestedData, { cedula: "402-1234567-8" });
  });

  test("un campo sensible no aporta valor: nunca se grabó", () => {
    assert.strictEqual(suggestedData.clave, undefined);
    assert.strictEqual(plan.requiredData.find((d) => d.key === "clave")?.resolved, false);
  });

  test("declara los datos que el plan necesita", () => {
    assert.deepStrictEqual(
      plan.requiredData.map((d) => [d.key, d.required, d.sensitive]),
      [["cedula", true, false], ["clave", true, true]],
    );
  });
});

describe("toExecutionPlan · identidad", () => {
  test("el plan apunta a la grabación y al caso de TestRail cuando existe", () => {
    const scenario = { ...scenarioWith([]), testRailCaseId: 4321 };
    const { plan } = toExecutionPlan(scenario);
    assert.strictEqual(plan.scenario.externalId, "REC-AABBCCDD-01");
    assert.strictEqual(plan.scenario.caseId, 4321);
    assert.match(plan.notes?.[0] ?? "", /aabbccdd/);
  });
});
