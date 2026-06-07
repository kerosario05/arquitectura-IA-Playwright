import assert from "node:assert";
import { normalizeScenarioEntryStepsOrder, filterUnsupportedClickTargets, ensureDetailScenarioHasItemSelection, convertUnsupportedPreOrdinalClicks } from "./scenario-normalizer";
import type { EntryStepConfig } from "../server/services/entry-steps-learner";
import type { McpRouteProfile } from "../scenarios/scenario-types";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(_name: string, fn: () => void): void {
  console.log(`\n${_name}`);
  fn();
}

const iniciarStep: EntryStepConfig = { action: "click", target: "Iniciar" };
const aceptarStep: EntryStepConfig = { action: "click", target: "Aceptar términos" };

describe("normalizeScenarioEntryStepsOrder", () => {
  test("no entrySteps: returns steps unchanged", () => {
    const steps = ["1. Clic en \"Información de productos\".", "2. Clic en \"Guardar\"."];
    const result = normalizeScenarioEntryStepsOrder(steps, []);
    assert.deepStrictEqual(result.steps, steps);
    assert.strictEqual(result.inserted, 0);
    assert.strictEqual(result.moved, 0);
    assert.strictEqual(result.alreadyFirst, 0);
    assert.strictEqual(result.deduped, 0);
  });

  test("empty steps: returns empty", () => {
    const result = normalizeScenarioEntryStepsOrder([], [iniciarStep]);
    assert.deepStrictEqual(result.steps, []);
    assert.strictEqual(result.inserted, 0);
  });

  test("missing entryStep: inserts at beginning", () => {
    const steps = ["1. Clic en \"Información de productos\".", "2. Clic en \"Guardar\"."];
    const result = normalizeScenarioEntryStepsOrder(steps, [iniciarStep]);
    assert.strictEqual(result.steps.length, 3);
    assert.ok(result.steps[0].includes("Iniciar"));
    assert.ok(result.steps[1].includes("Información de productos"));
    assert.ok(result.steps[2].includes("Guardar"));
    assert.strictEqual(result.inserted, 1);
    assert.strictEqual(result.moved, 0);
    assert.strictEqual(result.alreadyFirst, 0);
    assert.strictEqual(result.deduped, 0);
  });

  test("entryStep in second position: moves to first", () => {
    const steps = ["1. Clic en \"Información de productos\".", "2. Clic en \"Iniciar\".", "3. Clic en \"Guardar\"."];
    const result = normalizeScenarioEntryStepsOrder(steps, [iniciarStep]);
    assert.strictEqual(result.steps.length, 3);
    assert.ok(result.steps[0].includes("Iniciar"));
    assert.ok(result.steps[1].includes("Información de productos"));
    assert.ok(result.steps[2].includes("Guardar"));
    assert.strictEqual(result.inserted, 0);
    assert.strictEqual(result.moved, 1);
    assert.strictEqual(result.alreadyFirst, 0);
    assert.strictEqual(result.deduped, 0);
  });

  test("multiple entrySteps in wrong order: reorders both to beginning", () => {
    const steps = [
      "1. Clic en \"Información de productos\".",
      "2. Clic en \"Aceptar términos\".",
      "3. Clic en \"Iniciar\".",
      "4. Clic en \"Guardar\".",
    ];
    const result = normalizeScenarioEntryStepsOrder(steps, [iniciarStep, aceptarStep]);
    assert.strictEqual(result.steps.length, 4);
    assert.ok(result.steps[0].includes("Iniciar"), `expected step 0 to be Iniciar, got: ${result.steps[0]}`);
    assert.ok(result.steps[1].includes("Aceptar términos"), `expected step 1 to be Aceptar términos, got: ${result.steps[1]}`);
    assert.ok(result.steps[2].includes("Información de productos"));
    assert.ok(result.steps[3].includes("Guardar"));
    assert.strictEqual(result.inserted, 0);
    assert.strictEqual(result.moved, 1);
    assert.strictEqual(result.alreadyFirst, 1);
    assert.strictEqual(result.deduped, 0);
  });

  test("entrySteps already at beginning in correct order: no changes", () => {
    const steps = ["1. Clic en \"Iniciar\".", "2. Clic en \"Información de productos\".", "3. Clic en \"Guardar\"."];
    const result = normalizeScenarioEntryStepsOrder(steps, [iniciarStep]);
    assert.strictEqual(result.steps.length, 3);
    assert.ok(result.steps[0].includes("Iniciar"));
    assert.ok(result.steps[1].includes("Información de productos"));
    assert.ok(result.steps[2].includes("Guardar"));
    assert.strictEqual(result.inserted, 0);
    assert.strictEqual(result.moved, 0);
    assert.strictEqual(result.alreadyFirst, 1);
    assert.strictEqual(result.deduped, 0);
  });

  test("duplicate entrySteps: keeps one, removes extras", () => {
    const steps = [
      "1. Clic en \"Iniciar\".",
      "2. Clic en \"Información de productos\".",
      "3. Clic en \"Iniciar\".",
      "4. Clic en \"Guardar\".",
    ];
    const result = normalizeScenarioEntryStepsOrder(steps, [iniciarStep]);
    assert.strictEqual(result.steps.length, 3);
    // Only one Iniciar at start
    assert.strictEqual(result.steps.filter((s) => s.includes("Iniciar")).length, 1);
    assert.ok(result.steps[0].includes("Iniciar"));
    assert.strictEqual(result.deduped, 1);
  });

  test("pair of entrySteps one inserted one moved: handles correctly", () => {
    const steps = ["1. Clic en \"Aceptar términos\".", "2. Clic en \"Información de productos\".", "3. Clic en \"Guardar\"."];
    const result = normalizeScenarioEntryStepsOrder(steps, [iniciarStep, aceptarStep]);
    assert.strictEqual(result.steps.length, 4);
    assert.ok(result.steps[0].includes("Iniciar"), `expected Iniciar first, got: ${result.steps[0]}`);
    assert.ok(result.steps[1].includes("Aceptar términos"), `expected Aceptar términos second, got: ${result.steps[1]}`);
    assert.ok(result.steps[2].includes("Información de productos"));
    assert.ok(result.steps[3].includes("Guardar"));
    assert.strictEqual(result.inserted, 1);
    assert.strictEqual(result.moved, 1);
    assert.strictEqual(result.deduped, 0);
  });

  test("similar text with different target: not treated as dup", () => {
    const steps = ["1. Clic en \"Información de productos\".", "2. Clic en \"Guardar\"."];
    const result = normalizeScenarioEntryStepsOrder(steps, [{ action: "click", target: "Información de pedidos" }]);
    assert.strictEqual(result.steps.length, 3);
    assert.ok(result.steps[0].includes("Información de pedidos"));
    assert.ok(result.steps[1].includes("Información de productos"));
    assert.strictEqual(result.inserted, 1);
    assert.strictEqual(result.moved, 0);
  });

  test("non-click entrySteps: handled with correct format", () => {
    const steps = ["1. Clic en \"Buscar\".", "2. Clic en \"Resultados\"."];
    const typeStep: EntryStepConfig = { action: "type", target: "username" };
    const result = normalizeScenarioEntryStepsOrder(steps, [typeStep]);
    assert.strictEqual(result.steps.length, 3);
    assert.ok(result.steps[0].includes('Escribir "username"'));
    assert.strictEqual(result.inserted, 1);
  });

  test("preserves original numbering of non-entry steps", () => {
    const steps = ["1. Clic en \"Iniciar\".", "2. Clic en \"Información de productos\".", "3. Clic en \"Guardar\"."];
    const result = normalizeScenarioEntryStepsOrder(steps, [iniciarStep]);
    assert.strictEqual(result.steps.length, 3);
    assert.ok(result.steps[0].includes("1.") || result.steps[0].includes("Iniciar"));
    // Non-entry steps preserve original text
    assert.ok(result.steps[1].includes("2. Clic"));
    assert.ok(result.steps[2].includes("3. Clic"));
  });

  test("real case: Información de productos before Iniciar → reorders", () => {
    const steps = [
      "1. Clic en \"Información de productos\".",
      "2. Clic en \"Iniciar\".",
      "3. Clic en \"Buscar producto\".",
      "4. Verificar que se muestren los resultados.",
    ];
    const result = normalizeScenarioEntryStepsOrder(steps, [iniciarStep]);
    assert.ok(result.steps[0].includes("Iniciar"), `expected Iniciar first, got: ${result.steps[0]}`);
    assert.ok(result.steps[1].includes("Información de productos"), `expected Información de productos second, got: ${result.steps[1]}`);
    assert.strictEqual(result.inserted, 0);
    assert.strictEqual(result.moved, 1);
    assert.strictEqual(result.alreadyFirst, 0);
    assert.strictEqual(result.deduped, 0);
  });
});

const testRouteProfile: McpRouteProfile = {
  name: "Test Route",
  entry: [{ visibleLabel: "Iniciar", businessLabel: "Login" }],
  visibleControls: ["Información de productos", "Guardar", "Buscar producto"],
  aliases: { iniciar: "Iniciar sesión" },
  domainTerms: { product: "producto" },
  intermediates: {},
  representativeFixture: {},
  notes: [],
};

const emptyProfile: McpRouteProfile = {
  name: "Empty Route",
  entry: [],
  visibleControls: [],
  aliases: {},
  domainTerms: {},
  intermediates: {},
  representativeFixture: {},
  notes: [],
};

describe("filterUnsupportedClickTargets", () => {
  test("no routeProfile: skips with insufficient_profile_context", () => {
    const steps = ["1. Clic en \"Iniciar\".", "2. Clic en \"Guardar\"."];
    const result = filterUnsupportedClickTargets(steps, null);
    assert.deepStrictEqual(result.steps, steps);
    assert.strictEqual(result.convertedToAssertion, 0);
    assert.strictEqual(result.kept, 0);
    assert.strictEqual(result.skipped, steps.length);
    assert.strictEqual(result.skippedReason, "insufficient_profile_context");
    assert.strictEqual(result.allowlistSize, 0);
    assert.strictEqual(result.profileContextStrength, "none");
  });

  test("empty profile with no data: skips all clicks", () => {
    const steps = ["1. Clic en \"Iniciar\".", "2. Clic en \"Pesos\"."];
    const result = filterUnsupportedClickTargets(steps, emptyProfile);
    assert.deepStrictEqual(result.steps, steps, "empty profile should not convert any clicks");
    assert.strictEqual(result.convertedToAssertion, 0);
    assert.strictEqual(result.kept, 0);
    assert.strictEqual(result.skipped, 2);
    assert.strictEqual(result.skippedReason, "insufficient_profile_context");
  });

  test("click on target in visibleControls: kept as action", () => {
    const steps = ["1. Clic en \"Información de productos\".", "2. Clic en \"Guardar\"."];
    const result = filterUnsupportedClickTargets(steps, testRouteProfile);
    assert.strictEqual(result.steps.length, 2);
    assert.ok(result.steps[0].includes("Clic en"));
    assert.ok(result.steps[1].includes("Clic en"));
    assert.strictEqual(result.convertedToAssertion, 0);
    assert.strictEqual(result.kept, 2);
    assert.strictEqual(result.skipped, 0);
    assert.ok(result.allowlistSize > 0);
  });

  test("click on target from entry visibleLabel: kept as action", () => {
    const steps = ["1. Clic en \"Iniciar\"."];
    const result = filterUnsupportedClickTargets(steps, testRouteProfile);
    assert.strictEqual(result.steps.length, 1);
    assert.ok(result.steps[0].includes("Clic en"));
    assert.strictEqual(result.convertedToAssertion, 0);
  });

  test("click on target from aliases values: kept as action", () => {
    const steps = ["1. Clic en \"Iniciar sesión\"."];
    const result = filterUnsupportedClickTargets(steps, testRouteProfile);
    assert.strictEqual(result.steps.length, 1);
    assert.ok(result.steps[0].includes("Clic en"));
    assert.strictEqual(result.convertedToAssertion, 0);
  });

  test("click on target from domainTerms: kept as action", () => {
    const steps = ["1. Clic en \"producto\"."];
    const result = filterUnsupportedClickTargets(steps, testRouteProfile);
    assert.strictEqual(result.steps.length, 1);
    assert.ok(result.steps[0].includes("Clic en"));
    assert.strictEqual(result.convertedToAssertion, 0);
  });

  test("click on target not in profile: converted to contextual assertion", () => {
    const steps = ["1. Clic en \"Pesos\".", "2. Clic en \"Dólares\"."];
    const result = filterUnsupportedClickTargets(steps, testRouteProfile);
    assert.strictEqual(result.steps.length, 2);
    assert.ok(result.steps[0].includes("Validar que se muestre"), `expected validation, got: ${result.steps[0]}`);
    assert.ok(result.steps[0].includes("Pesos"));
    assert.ok(result.steps[1].includes("Validar que se muestre"));
    assert.ok(result.steps[1].includes("Dólares"));
    assert.strictEqual(result.convertedToAssertion, 2);
    assert.strictEqual(result.kept, 0);
    assert.strictEqual(result.skipped, 0);
  });

  test("non-click steps are never converted", () => {
    const steps = [
      "1. Clic en \"Pesos\".",
      "2. Validar que se muestre \"Pesos\".",
      "3. Esperar que se muestre \"Pesos\".",
    ];
    const result = filterUnsupportedClickTargets(steps, testRouteProfile);
    assert.strictEqual(result.steps.length, 3);
    assert.ok(result.steps[0].includes("Validar que se muestre"));
    assert.ok(result.steps[1].includes("Validar que se muestre"));
    assert.ok(result.steps[2].includes("Esperar que se muestre"));
    assert.strictEqual(result.convertedToAssertion, 1);
    assert.strictEqual(result.skipped, 0);
  });

  test("entrySteps target kept even with empty profile", () => {
    const steps = ["1. Clic en \"Iniciar\"."];
    const result = filterUnsupportedClickTargets(steps, emptyProfile, [{ action: "click", target: "Iniciar" }]);
    assert.strictEqual(result.steps.length, 1);
    assert.ok(result.steps[0].includes("Clic en"));
    assert.strictEqual(result.convertedToAssertion, 0);
    assert.strictEqual(result.kept, 1);
    assert.strictEqual(result.skipped, 0);
  });

  test("convertedTargets contains the original target names", () => {
    const steps = ["1. Clic en \"Pesos\".", "2. Clic en \"Información de productos\"."];
    const result = filterUnsupportedClickTargets(steps, testRouteProfile);
    assert.deepStrictEqual(result.convertedTargets, ["Pesos"]);
    assert.strictEqual(result.skipped, 0);
  });

  test("multi-app isolation: another appSlug does not inherit visibleControls", () => {
    const steps = ["1. Clic en \"Información de productos\".", "2. Clic en \"Pesos\"."];
    const otherProfile: McpRouteProfile = {
      name: "Other App",
      entry: [],
      visibleControls: ["Login", "Logout"],
      aliases: {},
      domainTerms: {},
      intermediates: {},
      representativeFixture: {},
      notes: [],
    };
    const result = filterUnsupportedClickTargets(steps, otherProfile);
    assert.ok(result.steps[0].includes("Validar que se muestre"));
    assert.ok(result.steps[1].includes("Validar que se muestre"));
    assert.strictEqual(result.convertedToAssertion, 2);
    assert.strictEqual(result.skipped, 0);
  });

  test("profile only with entrySteps and no routeProfile data: uses entrySteps allowlist", () => {
    const steps = ["1. Clic en \"Iniciar\".", "2. Clic en \"Pesos\"."];
    const result = filterUnsupportedClickTargets(steps, emptyProfile, [{ action: "click", target: "Iniciar" }]);
    assert.strictEqual(result.steps.length, 2);
    assert.ok(result.steps[0].includes("Clic en"), "Iniciar in entrySteps → kept");
    assert.ok(result.steps[1].includes("Validar que se muestre"), "Pesos not in entrySteps → converted");
    assert.strictEqual(result.convertedToAssertion, 1);
    assert.strictEqual(result.kept, 1);
    assert.strictEqual(result.skipped, 0);
  });

  test("allowlistSize and profileContextStrength are reported correctly", () => {
    const steps = ["1. Clic en \"Iniciar\"."];
    const result = filterUnsupportedClickTargets(steps, testRouteProfile);
    assert.ok(result.allowlistSize > 0);
    assert.strictEqual(result.profileContextStrength, "high");
    assert.strictEqual(result.skippedReason, null);
  });
});

describe("ensureDetailScenarioHasItemSelection", () => {
  test("detail scenario with category navigation: inserts ordinal selection step", () => {
    const steps = [
      "1. Clic en \"Informaci�n de productos\".",
      "2. Clic en \"Tarjetas\".",
      "3. Validar que se muestre \"Nombre del producto\".",
      "4. Validar que se muestre \"Descripci�n\".",
    ];
    const result = ensureDetailScenarioHasItemSelection(steps, "Ver detalles del producto");
    assert.ok(result.inserted);
    assert.strictEqual(result.steps.length, 5);
    assert.ok(result.steps[2].includes("Seleccionar el primer elemento visible del listado"), `expected selection at index 2, got: ${JSON.stringify(result.steps)}`);
    assert.strictEqual(result.reason, "detail_assertions_after_listing");
  });

  test("scenario already has selection: does not duplicate", () => {
    const steps = [
      "1. Clic en \"Informaci�n de productos\".",
      "2. Clic en \"Tarjetas\".",
      "3. Seleccionar el primer elemento visible del listado.",
      "4. Validar que se muestre \"Nombre del producto\".",
    ];
    const result = ensureDetailScenarioHasItemSelection(steps, "Ver detalles");
    assert.ok(!result.inserted);
    assert.strictEqual(result.reason, "already_has_selection");
  });

  test("scenario with selection via ordinal pattern: does not duplicate", () => {
    const steps = [
      "1. Clic en \"Informaci�n de productos\".",
      "2. Clic en \"Tarjetas\".",
      "3. Seleccionar el primer producto visible del listado.",
      "4. Validar que se muestre \"Nombre\".",
    ];
    const result = ensureDetailScenarioHasItemSelection(steps, "Ver detalles");
    assert.ok(!result.inserted);
    assert.strictEqual(result.reason, "already_has_selection");
  });

  test("listing scenario without detail assertions: does not insert", () => {
    const steps = [
      "1. Clic en \"Informaci�n de productos\".",
      "2. Clic en \"Categor�a A\".",
    ];
    const result = ensureDetailScenarioHasItemSelection(steps, "Navegar a categor�as");
    assert.ok(!result.inserted);
    assert.strictEqual(result.reason, "no_detail_assertions");
  });

  test("scenario with only general assertions: does not insert", () => {
    const steps = [
      "1. Clic en \"Iniciar\".",
      "2. Validar que se muestre \"Bienvenido\".",
    ];
    const result = ensureDetailScenarioHasItemSelection(steps, "Validar inicio de sesi�n");
    assert.ok(!result.inserted);
  });

  test("uses domainTerm from routeProfile when available", () => {
    const steps = [
      "1. Clic en \"Informaci�n de productos\".",
      "2. Clic en \"Tarjetas\".",
      "3. Validar que se muestre \"Nombre del producto\".",
    ];
    const profile: McpRouteProfile = {
      name: "Test",
      entry: [],
      visibleControls: ["Tarjetas", "Cuentas", "Pr�stamos"],
      aliases: { producto: "Producto" },
      domainTerms: { main: "producto" },
      intermediates: {},
      representativeFixture: {},
      notes: [],
    };
    const result = ensureDetailScenarioHasItemSelection(steps, "Ver detalle", profile);
    assert.ok(result.inserted);
    assert.ok(result.steps[2].includes("producto"), `expected producto in step, got: ${result.steps[2]}`);
  });

  test("without domainTerm uses generic 'elemento'", () => {
    const steps = [
      "1. Clic en \"Informaci�n de productos\".",
      "2. Clic en \"Tarjetas\".",
      "3. Validar que se muestre \"Nombre del producto\".",
    ];
    const result = ensureDetailScenarioHasItemSelection(steps, "Ver detalles");
    assert.ok(result.inserted);
    assert.ok(result.steps[2].includes("elemento"), `expected elemento at index 2, got: ${JSON.stringify(result.steps)}`);
  });

    test("root-only navigation (no list category): does NOT insert", () => {
    const steps = [
      "1. Clic en \"Inicio\".",
      "2. Validar que se muestre \"Nombre del producto\".",
    ];
    const entrySteps: EntryStepConfig[] = [{ action: "click", target: "Inicio" }];
    const result = ensureDetailScenarioHasItemSelection(steps, "Ver detalles", null, entrySteps);
    assert.ok(!result.inserted);
    assert.strictEqual(result.reason, "missing_supported_list_navigation");
  });test("sensitive executable click blocks insertion", () => {
    const steps = [
      "1. Clic en \"Informaci�n de productos\".",
      "2. Clic en \"Tarjetas\".",
      "3. Clic en \"Pagar\".",
      "4. Validar que se muestre \"Nombre\".",
    ];
    const result = ensureDetailScenarioHasItemSelection(steps, "Ver detalle");
    assert.ok(!result.inserted);
    assert.strictEqual(result.reason, "sensitive_action_blocked");
  });

  test("sensitive visible assertion does NOT block insertion", () => {
    const steps = [
      "1. Clic en \"Informaci�n de productos\".",
      "2. Clic en \"Tarjetas\".",
      "3. Validar que el bot�n \"Solicitar\" est� visible.",
      "4. Validar que se muestre \"Nombre del producto\".",
    ];
    const result = ensureDetailScenarioHasItemSelection(steps, "Ver detalle");
    assert.ok(result.inserted, "passive sensitive assertion should not block");
    assert.ok(result.steps.some((s) => s.includes("Seleccionar el primer elemento")), "should insert ordinal selection");
  });

  test("sensitive visible assertion (Verificar que se muestre) does NOT block", () => {
    const steps = [
      "1. Clic en \"Informaci�n de productos\".",
      "2. Clic en \"Tarjetas\".",
      "3. Verificar que se muestre \"Solicitar\".",
      "4. Validar que se muestre \"Descripci�n\".",
    ];
    const result = ensureDetailScenarioHasItemSelection(steps, "Ver detalles");
    assert.ok(result.inserted, "Verificar that a sensitive button is visible is passive, not executable");
  });

  test("no hardcoded project-specific names", () => {
    const steps = [
      "1. Clic en \"Men� principal\".",
      "2. Clic en \"Secci�n A\".",
      "3. Validar que se muestre \"T�tulo\".",
    ];
    const result = ensureDetailScenarioHasItemSelection(steps, "Ver informaci�n");
    assert.ok(result.inserted);
    assert.ok(!result.steps[2].includes("Pesos"));
    assert.ok(!result.steps[2].includes("D�lares"));
  });
});describe("convertUnsupportedPreOrdinalClicks", () => {
  test("converts Clic en Pesos before ordinal selection", () => {
    const steps = [
      "1. Clic en \"Cuentas de Efectivo\".",
      "2. Clic en \"Pesos\".",
      "3. Seleccionar el primer producto visible del listado.",
    ];
    const result = convertUnsupportedPreOrdinalClicks(steps);
    assert.strictEqual(result.converted, 1);
    assert.ok(result.steps[1].includes("Validar que se muestre"), `expected validation, got: ${result.steps[1]}`);
    assert.strictEqual(result.diagnostics[0].target, "Pesos");
    assert.strictEqual(result.diagnostics[0].reason, "unsupported_contextual_target_before_ordinal");
  });

  test("converts Clic en Dólares before ordinal selection", () => {
    const steps = [
      "1. Clic en \"Cuentas de Efectivo\".",
      "2. Clic en \"Dólares\".",
      "3. Seleccionar el primer producto visible del listado.",
    ];
    const result = convertUnsupportedPreOrdinalClicks(steps);
    assert.strictEqual(result.converted, 1);
    assert.ok(result.steps[1].includes("Validar que se muestre"));
  });

  test("converts Clic en Euros before ordinal selection", () => {
    const steps = [
      "1. Clic en \"Cuentas de Efectivo\".",
      "2. Clic en \"Euros\".",
      "3. Seleccionar el primer producto visible del listado.",
    ];
    const result = convertUnsupportedPreOrdinalClicks(steps);
    assert.strictEqual(result.converted, 1);
    assert.ok(result.steps[1].includes("Validar que se muestre"));
  });

  test("does NOT convert if target is in visibleControls", () => {
    const profile: McpRouteProfile = {
      name: "Test",
      entry: [],
      visibleControls: ["Pesos"],
      aliases: {},
      domainTerms: {},
      intermediates: {},
      representativeFixture: {},
      notes: [],
    };
    const steps = [
      "1. Clic en \"Cuentas de Efectivo\".",
      "2. Clic en \"Pesos\".",
      "3. Seleccionar el primer producto visible del listado.",
    ];
    const result = convertUnsupportedPreOrdinalClicks(steps, profile);
    assert.strictEqual(result.converted, 0);
    assert.ok(result.steps[1].includes("Clic en"), "Pesos is a known control, should stay as click");
  });

  test("does NOT convert functional long targets like Cuentas de Efectivo", () => {
    const steps = [
      "1. Clic en \"Información de productos\".",
      "2. Clic en \"Cuentas de Efectivo\".",
      "3. Seleccionar el primer producto visible del listado.",
    ];
    const result = convertUnsupportedPreOrdinalClicks(steps);
    assert.strictEqual(result.converted, 0);
    assert.ok(result.steps[1].includes("Clic en"), "Cuentas de Efectivo is a functional category, should stay");
  });

  test("does NOT convert if no ordinal follows", () => {
    const steps = [
      "1. Clic en \"Cuentas de Efectivo\".",
      "2. Clic en \"Pesos\".",
      "3. Validar que se muestre \"Algo\".",
    ];
    const result = convertUnsupportedPreOrdinalClicks(steps);
    assert.strictEqual(result.converted, 0);
  });

  test("does NOT convert backed categories like Tarjetas, Depósitos a Plazo, Préstamos", () => {
    for (const category of ["Tarjetas", "Depósitos a Plazo", "Préstamos"]) {
      const steps = [
        "1. Clic en \"Información de productos\".",
        `2. Clic en "${category}".`,
        "3. Seleccionar el primer producto visible del listado.",
      ];
      const result = convertUnsupportedPreOrdinalClicks(steps);
      assert.strictEqual(result.converted, 0, `Should not convert ${category}`);
      assert.ok(result.steps[1].includes(category), `${category} should remain as click`);
    }
  });

  test("ordinal selection preserved as-is", () => {
    const steps = [
      "1. Clic en \"Cuentas de Efectivo\".",
      "2. Clic en \"Pesos\".",
      "3. Seleccionar el primer producto visible del listado.",
    ];
    const result = convertUnsupportedPreOrdinalClicks(steps);
    assert.ok(result.steps[2].includes("Seleccionar el primer producto"), "ordinal selection preserved");
  });

  test("multi-app isolation: another appSlug visibleControls not used", () => {
    const otherProfile: McpRouteProfile = {
      name: "Other",
      entry: [],
      visibleControls: ["Pesos", "Dólares"],
      aliases: {},
      domainTerms: {},
      intermediates: {},
      representativeFixture: {},
      notes: [],
    };
    const steps = [
      "1. Clic en \"Cuentas de Efectivo\".",
      "2. Clic en \"Pesos\".",
      "3. Seleccionar el primer producto visible del listado.",
    ];
    // With this profile, Pesos IS backed → should NOT convert
    const result = convertUnsupportedPreOrdinalClicks(steps, otherProfile);
    assert.strictEqual(result.converted, 0, "Pesos is backed by this app's visibleControls");
  });

  test("empty steps returns no conversion", () => {
    const result = convertUnsupportedPreOrdinalClicks([]);
    assert.strictEqual(result.converted, 0);
  });
});
