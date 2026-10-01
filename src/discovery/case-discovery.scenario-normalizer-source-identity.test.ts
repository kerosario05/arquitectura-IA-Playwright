import assert from "node:assert/strict";
import test from "node:test";
import { crossActionOwnerReadinessRequired, parseScenarioStepsForDiscovery } from "./case-discovery";
import { deduplicateActionTargetsBySource } from "./action-target-equivalence";
import type { TestScenario } from "../types/testrail.types";

/**
 * FIRST_LOSS (jobId d136588c-4af9-48bc-a67d-3e42f082c83c): the scenario normalizer removed two
 * independent keypad presses ("2" twice, "5" twice) as `consecutive_equivalent_action`, because the
 * RecordingExecutionContract's structured source-interaction identity (`interactionId`) was never
 * transported onto the parsed action targets -- so dedup could only look at target/operation, which
 * are identical for two independent presses of the same key. The identity is now transported
 * (`ActionTargetItem.sourceInteractionId`) and dedup requires it.
 */

function recordingScenario(actions: Array<{ interactionId: string; stepIndex: number; targetRef: string; technicalTargetRef: string }>): TestScenario {
  return {
    source: "testrail",
    externalId: "SYN-REC",
    caseId: 0,
    title: "synthetic recording",
    steps: [],
    recordingExecutionContract: {
      actions: actions.map((action) => ({
        actionType: "click" as const,
        interactionId: action.interactionId,
        stepIndex: action.stepIndex,
        targetRef: action.targetRef,
        technicalTargetRef: action.technicalTargetRef,
        technicalTargetRefs: [action.technicalTargetRef],
      })),
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;
}

test("contract source interaction identity reaches the parsed action targets", () => {
  const scenario = recordingScenario([
    { interactionId: "interaction-1", stepIndex: 1, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
    { interactionId: "interaction-2", stepIndex: 2, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
  ]);
  const parsed = parseScenarioStepsForDiscovery(scenario);
  assert.deepEqual(parsed.actionTargets.map((action) => action.sourceInteractionId), ["interaction-1", "interaction-2"]);
});

test("two independent presses of the same key (different interactionId) survive normalization", () => {
  const scenario = recordingScenario([
    { interactionId: "interaction-1", stepIndex: 1, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
    { interactionId: "interaction-2", stepIndex: 2, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
  ]);
  const parsed = parseScenarioStepsForDiscovery(scenario);
  const deduped = deduplicateActionTargetsBySource(parsed.actionTargets);
  assert.equal(deduped.length, 2, "an independent repeated press is never lost by similarity");
  assert.deepEqual(deduped.map((action) => action.target), ["2", "2"]);
});

test("a true same-source projection among independent repeats is deduplicated, the rest preserved", () => {
  const scenario = recordingScenario([
    { interactionId: "interaction-1", stepIndex: 1, targetRef: "s|4|role|button|4", technicalTargetRef: "role:button|4" },
    { interactionId: "interaction-2", stepIndex: 2, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
    { interactionId: "interaction-2", stepIndex: 3, targetRef: "s|2|role|button|2", technicalTargetRef: "role:button|2" },
    { interactionId: "interaction-4", stepIndex: 4, targetRef: "s|5|role|button|5", technicalTargetRef: "role:button|5" },
  ]);
  const parsed = parseScenarioStepsForDiscovery(scenario);
  const deduped = deduplicateActionTargetsBySource(parsed.actionTargets);
  assert.deepEqual(deduped.map((action) => action.target), ["4", "2", "5"]);
  assert.deepEqual(deduped.map((action) => action.sourceInteractionId), ["interaction-1", "interaction-2", "interaction-4"]);
});

test("the full kiosko-shaped recording sequence keeps both 2s and both 5s", () => {
  const digits = ["4", "0", "2", "2", "4", "6", "7", "9", "5", "5", "1"];
  const scenario = recordingScenario(digits.map((digit, index) => ({
    interactionId: `interaction-${index + 1}`,
    stepIndex: index + 1,
    targetRef: `s|${digit}|role|button|${digit}`,
    technicalTargetRef: `role:button|${digit}`,
  })));
  const parsed = parseScenarioStepsForDiscovery(scenario);
  const deduped = deduplicateActionTargetsBySource(parsed.actionTargets);
  assert.deepEqual(deduped.map((action) => action.target), digits);
  assert.equal(deduped.length, 11);
});

test("authored repeated button steps inherit distinct recording identities from a complete ordered contract", () => {
  const targets = ["Estados de cuenta", "4", "0", "2", "2", "4", "6", "7", "9", "5", "5", "1"];
  const scenario = {
    source: "testrail",
    externalId: "SYN-REC-ORDERED-LINEAGE",
    caseId: 0,
    title: "synthetic authored recording sequence",
    steps: [
      "Abrir la aplicación configurada del proyecto",
      ...targets.map((target) => `Presionar \"${target}\"`),
    ],
    recordingExecutionContract: {
      actions: targets.map((target, index) => ({
        actionType: "click",
        interactionId: `interaction-${index + 1}`,
        stepIndex: index + 1,
        humanStep: `Presionar \"${target}\"`,
        semanticField: target,
        associatedField: target,
        targetRef: `screen|${target}|role|button|${target}`,
        technicalTargetRef: `role:button|${target}`,
        technicalTargetRefs: [`role:button|${target}`],
      })),
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;

  const parsed = parseScenarioStepsForDiscovery(scenario);
  const digitActions = parsed.actionTargets.filter((action) => action.target !== "Estados de cuenta");
  assert.deepEqual(digitActions.map((action) => action.target), targets.slice(1));
  assert.deepEqual(digitActions.map((action) => action.sourceInteractionId), targets.slice(1).map((_, index) => `interaction-${index + 2}`));
  assert.deepEqual(digitActions.map((action) => action.technicalTargetRefs?.[0]), targets.slice(1).map((target) => `role:button|${target}`));
  assert.deepEqual(digitActions.map((action) => action.associatedField), targets.slice(1));
});

test("a fill field/valueKey pair corrects stale semantic field metadata when no technical target exists", () => {
  const scenario = {
    source: "testrail",
    externalId: "SYN-FILL",
    caseId: 0,
    title: "synthetic fill recording",
    steps: [],
    recordingExecutionContract: {
      actions: [{
        actionType: "fill",
        interactionId: "interaction-14",
        stepIndex: 1,
        humanStep: 'Ingresar [puesto] en "Puesto"',
        semanticField: "Colaborador",
        associatedField: "Colaborador",
        targetRef: "3e7b2674871e|Colaborador",
        valueKey: "puesto",
      }],
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;

  const [action] = parseScenarioStepsForDiscovery(scenario).actionTargets;
  assert.equal(action.target, "Puesto");
  assert.equal(action.associatedField, "Puesto");
});

test("fill field reconciliation fails closed without matching field and valueKey evidence", () => {
  const scenario = {
    source: "testrail",
    externalId: "SYN-FILL-AMBIGUOUS",
    caseId: 0,
    title: "synthetic ambiguous fill recording",
    steps: [],
    recordingExecutionContract: {
      actions: [{
        actionType: "fill",
        interactionId: "interaction-15",
        stepIndex: 1,
        humanStep: 'Ingresar [colaborador] en "Puesto"',
        semanticField: "Colaborador",
        associatedField: "Colaborador",
        targetRef: "screen|Colaborador",
        valueKey: "colaborador",
      }],
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;

  const [action] = parseScenarioStepsForDiscovery(scenario).actionTargets;
  assert.equal(action.target, "Colaborador");
  assert.equal(action.associatedField, "Colaborador");
});

test("a recorded runtime selection intent corrects a stale fill type and owner field", () => {
  const scenario = {
    source: "testrail",
    externalId: "SYN-SELECT-FIELD",
    caseId: 0,
    title: "synthetic selection recording",
    steps: [],
    recordingExecutionContract: {
      actions: [{
        actionType: "fill",
        interactionId: "interaction-18",
        stepIndex: 1,
        humanStep: 'Seleccionar [moneda_seleccion] en "Moneda"',
        semanticField: "Colaborador",
        associatedField: "Colaborador",
        targetRef: "3e7b2674871e|Colaborador",
        valueKey: "moneda_seleccion",
      }],
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;

  const [action] = parseScenarioStepsForDiscovery(scenario).actionTargets;
  assert.equal(action.actionType, "action_select");
  assert.equal(action.target, "Moneda");
  assert.equal(action.selectionField, "Moneda");
  assert.equal(action.associatedField, "Moneda");
  assert.equal(action.valueKey, "moneda_seleccion");
});

test("literal authored selection maps to its recorded runtime value through recordedValue", () => {
  const scenario = {
    source: "testrail",
    externalId: "SYN-SELECT-RECORDED-VALUE",
    caseId: 0,
    title: "synthetic selection mapping",
    steps: ['Seleccionar "DOP" en "Moneda"'],
    recordingExecutionContract: {
      actions: [
        {
          actionType: "click",
          interactionId: "interaction-option",
          stepIndex: 1,
          semanticField: "Moneda",
          associatedField: "Moneda",
          targetRef: "surface|DOP|role|option|DOP",
          technicalTargetRef: "role:option|DOP",
          technicalTargetRefs: ["role:option|DOP"],
          playwrightRecorderEvidence: { kind: "role", role: "option", normalizedName: "DOP", targetTag: "div" },
        },
        {
          actionType: "click",
          interactionId: "interaction-owner",
          stepIndex: 2,
          semanticField: "Moneda",
          associatedField: "Moneda",
          targetRef: "surface|Moneda|role|combobox|Moneda",
          technicalTargetRef: "role:combobox|Moneda",
          technicalTargetRefs: ["role:combobox|Moneda"],
          playwrightRecorderEvidence: { kind: "role", role: "combobox", normalizedName: "Moneda", targetTag: "button" },
        },
      ],
      runtimeInputRequirements: [{ valueKey: "moneda_seleccion", semanticField: "Moneda", value: "DOP", valueRole: "action_input" }],
    },
  } as unknown as TestScenario;

  const [action] = parseScenarioStepsForDiscovery(scenario).actionTargets;
  assert.equal(action.actionType, "action_select");
  assert.equal(action.selectionField, "Moneda");
  assert.equal(action.valueKey, "moneda_seleccion");
  assert.equal(action.recordingActionType, "click");
  assert.deepEqual(action.technicalTargetRefs, ["role:combobox|Moneda"]);
  assert.equal(action.sourceInteractionId, "interaction-owner");
});

test("a lazy recorded selection owner inherits its next same-state editable activation field", () => {
  const scenario = {
    source: "testrail",
    externalId: "SYN-LAZY-SELECTION",
    caseId: 0,
    title: "synthetic lazy selection recording",
    steps: [
      'Seleccionar "DOP" en "Moneda"',
      'Ingresar "5000" en "Ingresos"',
    ],
    recordingExecutionContract: {
      actions: [
        {
          actionType: "fill",
          interactionId: "interaction-selection-value",
          humanStep: 'Seleccionar [moneda_seleccion] en "Moneda"',
          semanticField: "Colaborador",
          targetRef: "row|Colaborador",
          valueKey: "moneda_seleccion",
          value: "DOP",
          expectedState: "row",
          expectedRouteBefore: "https://example.test/form",
          stepIndex: 1,
        },
        {
          actionType: "click",
          interactionId: "interaction-selection-owner",
          semanticField: "Moneda",
          associatedField: "Moneda",
          targetRef: "row|Moneda|role|combobox|Moneda",
          technicalTargetRef: "role:combobox|Moneda",
          technicalTargetRefs: ["role:combobox|Moneda"],
          playwrightRecorderEvidence: { kind: "role", role: "combobox", normalizedName: "Moneda", targetTag: "button", runtimeResolutionRequired: true },
          expectedState: "row",
          expectedRouteBefore: "https://example.test/form",
          stepIndex: 2,
        },
        {
          actionType: "click",
          interactionId: "interaction-selection-option",
          semanticField: "Moneda",
          targetRef: "row|DOP|role|option|DOP",
          technicalTargetRef: "role:option|DOP",
          technicalTargetRefs: ["role:option|DOP"],
          expectedState: "row",
          expectedRouteBefore: "https://example.test/form",
          stepIndex: 3,
        },
        {
          actionType: "fill",
          interactionId: "interaction-income",
          humanStep: 'Ingresar [ingresos] en "Ingresos"',
          semanticField: "Ingresos",
          targetRef: "row|Ingresos",
          valueKey: "ingresos",
          value: "5000",
          expectedState: "row",
          expectedRouteBefore: "https://example.test/form",
          stepIndex: 4,
        },
      ],
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;

  const parsed = parseScenarioStepsForDiscovery(scenario);
  const selection = parsed.actionTargets.find((action) => action.actionType === "action_select");
  assert.equal(selection?.selectionActivationField, "Ingresos");
  assert.equal(parsed.orderedSteps.find((step) => step.type === "action_select")?.selectionActivationField, "Ingresos");
});

test("an exact recorded button name repeated as associatedField is not treated as a lazy field owner", () => {
  const scenario = {
    source: "testrail",
    externalId: "SYN-SELF-OWNED-BUTTON",
    caseId: 0,
    title: "synthetic self-owned button recording",
    steps: ['Presionar "0"'],
    recordingExecutionContract: {
      actions: [{
        actionType: "click",
        interactionId: "interaction-digit",
        humanStep: 'Presionar "0"',
        semanticField: "0",
        associatedField: "0",
        targetRef: "screen|0|role|button|0",
        technicalTargetRef: "role:button|0",
        technicalTargetRefs: ["role:button|0"],
        expectedState: "screen",
        stepIndex: 1,
      }],
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;
  const [target] = parseScenarioStepsForDiscovery(scenario).actionTargets;
  assert.equal(target.recordingActionType, "click");
  assert.equal(target.associatedField, "0");
  assert.deepEqual(target.technicalTargetRefs, ["role:button|0"]);
  assert.equal(crossActionOwnerReadinessRequired(target), false);
  assert.equal(crossActionOwnerReadinessRequired({
    target: "Moneda",
    associatedField: "Moneda",
    recordingActionType: "click",
    technicalTargetRefs: ["role:combobox|Moneda"],
  }), true);
});

test("canonical business steps stay authoritative over lower-level recording projections", () => {
  const scenario = {
    source: "testrail",
    externalId: "SYN-BUSINESS-STEPS",
    caseId: 0,
    title: "synthetic mixed recording",
    steps: [
      'Ingresar "Analista" en "Puesto"',
      'Seleccionar "DOP" en "Moneda"',
      'Presionar "Solicitar Cuenta"',
    ],
    recordingExecutionContract: {
      actions: [
        {
          actionType: "fill",
          interactionId: "interaction-fill-position",
          humanStep: 'Ingresar [puesto] en "Puesto"',
          semanticField: "Colaborador",
          targetRef: "surface|Colaborador",
          valueKey: "puesto",
          value: "Analista",
          runtimeValueSource: "dataset",
          stepIndex: 1,
        },
        {
          actionType: "fill",
          interactionId: "interaction-select-currency",
          humanStep: 'Seleccionar [moneda_seleccion] en "Moneda"',
          semanticField: "Colaborador",
          targetRef: "surface|Colaborador",
          valueKey: "moneda_seleccion",
          value: "DOP",
          runtimeValueSource: "dataset",
          expectedState: "surface",
          expectedRouteBefore: "https://example.test/form",
          stepIndex: 2,
        },
        {
          actionType: "click",
          interactionId: "interaction-currency-owner",
          semanticField: "Moneda",
          targetRef: "surface|Moneda|role|combobox|Moneda",
          technicalTargetRef: "role:combobox|Moneda",
          technicalTargetRefs: ["role:combobox|Moneda"],
          expectedState: "surface",
          expectedRouteBefore: "https://example.test/form",
          stepIndex: 3,
        },
        {
          actionType: "click",
          interactionId: "interaction-currency-option",
          semanticField: "DOP",
          targetRef: "surface|DOP|role|option|DOP",
          technicalTargetRef: "role:option|DOP",
          stepIndex: 4,
        },
        {
          actionType: "fill",
          interactionId: "interaction-misprojected-submit",
          humanStep: 'Presionar "Solicitar Cuenta"',
          semanticField: "Ingresos",
          targetRef: "surface|Ingresos",
          valueKey: "ingresos",
          stepIndex: 5,
        },
        {
          actionType: "click",
          interactionId: "interaction-submit",
          semanticField: "Solicitar Cuenta",
          targetRef: "surface|Solicitar Cuenta|role|button|Solicitar Cuenta",
          technicalTargetRef: "role:button|Solicitar Cuenta",
          stepIndex: 6,
        },
      ],
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;

  const parsed = parseScenarioStepsForDiscovery(scenario);
  assert.deepEqual(parsed.actionTargets.map((action) => action.target), ["Puesto", "Moneda", "Solicitar Cuenta"]);
  assert.equal(parsed.actionTargets[0]?.valueKey, "puesto");
  assert.equal(parsed.actionTargets[1]?.actionType, "action_select");
  assert.equal(parsed.actionTargets[1]?.value, "DOP");
  assert.equal(parsed.actionTargets[1]?.technicalTargetRef, "role:combobox|Moneda");
  assert.equal(parsed.actionTargets[2]?.technicalTargetRef, "role:button|Solicitar Cuenta");
});
test("authored recording steps inherit route postconditions from their unique contract action", () => {
  const scenario = {
    source: "testrail",
    externalId: "SYN-REC-ROUTE",
    caseId: 0,
    title: "synthetic recorded route",
    steps: [{ index: 1, action: 'Presionar "Gestión de Nóminas"' }],
    recordingExecutionContract: {
      actions: [{
        actionType: "click",
        stepIndex: 1,
        humanStep: 'Presionar "Gestión de Nóminas"',
        semanticField: "Gestión de Nóminas",
        associatedField: "Gestión de Nóminas",
        rowScope: 1,
        technicalTargetRef: "role:button|Gestión de Nóminas",
        expectedRouteBefore: "https://example.test/dashboard",
        expectedRouteAfter: "https://example.test/payroll",
        expectedOutcomeKind: "route_transition",
      }],
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;

  const parsed = parseScenarioStepsForDiscovery(scenario);
  assert.equal(parsed.actionTargets[0].associatedField, "Gestión de Nóminas");
  assert.equal(parsed.actionTargets[0].rowScope, 1);
  assert.equal(parsed.orderedSteps[0].associatedField, "Gestión de Nóminas");
  assert.equal(parsed.orderedSteps[0].rowScope, 1);
  assert.equal(parsed.actionTargets[0].expectedRouteBefore, "https://example.test/dashboard");
  assert.equal(parsed.actionTargets[0].expectedRouteAfter, "https://example.test/payroll");
  assert.equal(parsed.orderedSteps[0].expectedRouteAfter, "https://example.test/payroll");
});
test("authored click steps use the unique recorded semantic target when technical refs are absent", () => {
  const scenario = {
    source: "testrail",
    externalId: "SYN-REC-TARGET",
    caseId: 0,
    title: "synthetic recorded control",
    steps: [{ index: 1, action: "Presionar el control indicado" }],
    recordingExecutionContract: {
      actions: [{
        actionType: "check",
        stepIndex: 1,
        humanStep: "Presionar el control indicado",
        targetRef: "surface|Seleccionar fila",
        technicalTargetCandidates: [{ targetType: "structural", confidence: 0.85, validatedByInteraction: true }],
        playwrightRecorderEvidence: { kind: "role", role: "checkbox", normalizedName: "Seleccionar fila", runtimeResolutionRequired: true },
      }],
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;

  const parsed = parseScenarioStepsForDiscovery(scenario);
  assert.equal(parsed.actionTargets[0].target, "Seleccionar fila");
  assert.equal(parsed.actionTargets[0].recordingActionType, "check");
  assert.equal(parsed.orderedSteps[0].target, "Seleccionar fila");
  assert.equal(parsed.orderedSteps[0].recordingActionType, "check");
  assert.equal((parsed.actionTargets[0].technicalTargetCandidates?.[0] as any).validatedByInteraction, true);
  assert.equal((parsed.actionTargets[0].playwrightRecorderEvidence as any).normalizedName, "Seleccionar fila");
});
