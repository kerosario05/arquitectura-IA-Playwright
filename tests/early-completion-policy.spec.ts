import { test, expect } from "@playwright/test";
import {
  classifyPendingActionsForEarlyCompletion,
  evaluateEarlyCompletionPolicy,
  type ClassifiedPendingAction,
  type EarlyCompletionClassification
} from "../src/discovery/early-completion-policy";
import type { ActionTargetItem } from "../src/discovery/step-intent-parser";
import type { AuthGateState } from "../src/discovery/auth-step-classifier";

function makeActionTarget(index: number, target: string, action: string = "click", isOptional = false): ActionTargetItem {
  return {
    index,
    target,
    action,
    isOptional,
    priority: 5,
    originalText: target,
    normalizedText: target.toLowerCase(),
    semanticRole: "unknown",
    relationContext: ""
  } as ActionTargetItem;
}

function makeAuthGateState(): AuthGateState {
  return {
    completed: true,
    completedAtStepIndex: 0,
    completedAfterTarget: "transacciones y servicio",
    stagesCompleted: ["identification", "otp", "authenticated"],
    consumedAuthTargets: ["Cédula de identidad dominicana", "continuar"],
    skippedAuthSteps: [],
    authConsumedOpen: true,
    functionalStepSeenAfterAuth: false
  };
}

test("classifyPendingActions: functional actions are classified as functionalRequired", () => {
  const pending = [
    makeActionTarget(5, "Generar cartas"),
    makeActionTarget(6, "Carta de referencia"),
    makeActionTarget(7, "cuenta de ahorros"),
    makeActionTarget(8, "continuar")
  ];

  const result = classifyPendingActionsForEarlyCompletion({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: undefined,
    skippedSteps: []
  });

  expect(result.functionalRequired.length).toBe(4);
  expect(result.authConsumed.length).toBe(0);
  expect(result.optional.length).toBe(0);
  expect(result.functionalRequired.map(a => a.target)).toContain("Generar cartas");
  expect(result.functionalRequired.map(a => a.target)).toContain("Carta de referencia");
  expect(result.functionalRequired.map(a => a.target)).toContain("cuenta de ahorros");
});

test("classifyPendingActions: auth keywords are classified as authConsumed", () => {
  const pending = [
    makeActionTarget(2, "Cédula de identidad dominicana"),
    makeActionTarget(3, "codigo otp"),
    makeActionTarget(4, "confirmar codigo")
  ];

  const result = classifyPendingActionsForEarlyCompletion({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: undefined,
    skippedSteps: []
  });

  expect(result.authConsumed.length).toBe(3);
  expect(result.functionalRequired.length).toBe(0);
});

test("classifyPendingActions: auth continue variants with authConsumedOpen=true are authConsumed", () => {
  const pending = [
    makeActionTarget(3, "continuar"),
    makeActionTarget(4, "confirmar")
  ];

  const authState = makeAuthGateState();
  authState.authConsumedOpen = true;

  const result = classifyPendingActionsForEarlyCompletion({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: authState,
    skippedSteps: []
  });

  expect(result.authConsumed.length).toBe(2);
  expect(result.functionalRequired.length).toBe(0);
});

test("classifyPendingActions: auth continue variants with authConsumedOpen=false are functionalRequired", () => {
  const pending = [
    makeActionTarget(5, "continuar"),
    makeActionTarget(6, "confirmar")
  ];

  const authState = makeAuthGateState();
  authState.authConsumedOpen = false;
  authState.functionalStepSeenAfterAuth = true;

  const result = classifyPendingActionsForEarlyCompletion({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: authState,
    skippedSteps: []
  });

  expect(result.functionalRequired.length).toBe(2);
  expect(result.authConsumed.length).toBe(0);
});

test("classifyPendingActions: optional actions are classified as optional", () => {
  const pending = [
    makeActionTarget(5, "Seleccionar tarjeta preferida", "click", true)
  ];

  const result = classifyPendingActionsForEarlyCompletion({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: undefined,
    skippedSteps: []
  });

  expect(result.optional.length).toBe(1);
  expect(result.functionalRequired.length).toBe(0);
});

test("classifyPendingActions: already executed actions are duplicateAlreadyExecuted", () => {
  const pending = [
    makeActionTarget(5, "Generar cartas"),
    makeActionTarget(6, "Carta de referencia")
  ];

  const result = classifyPendingActionsForEarlyCompletion({
    pendingActions: pending,
    executedStepIndices: new Set([5]),
    authGateState: undefined,
    skippedSteps: []
  });

  expect(result.duplicateAlreadyExecuted.length).toBe(1);
  expect(result.duplicateAlreadyExecuted[0].target).toBe("Generar cartas");
  expect(result.functionalRequired.length).toBe(1);
});

test("classifyPendingActions: skipped steps from auth flow are authConsumed", () => {
  const pending = [
    makeActionTarget(3, "Cédula de identidad dominicana"),
    makeActionTarget(4, "continuar")
  ];

  const result = classifyPendingActionsForEarlyCompletion({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: undefined,
    skippedSteps: [
      { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow", index: 3 },
      { targetText: "continuar", status: "skipped", recoveredBy: "auth_flow", index: 4 }
    ]
  });

  expect(result.authConsumed.length).toBe(2);
  expect(result.functionalRequired.length).toBe(0);
});

test("evaluateEarlyCompletionPolicy: blocks when functionalRequired pending", () => {
  const pending = [
    makeActionTarget(5, "cuenta de ahorros"),
    makeActionTarget(6, "continuar"),
    makeActionTarget(7, "A quien pueda interesar"),
    makeActionTarget(8, "continuar")
  ];

  const authState = makeAuthGateState();
  authState.authConsumedOpen = false;

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: authState,
    skippedSteps: [],
    satisfiedAssertions: ["Vista previa de carta"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(false);
  expect(result.reason).toBe("functional_actions_pending");
  expect(result.pendingFunctionalTargets.length).toBe(4);
  expect(result.pendingFunctionalTargets).toContain("cuenta de ahorros");
  expect(result.pendingFunctionalTargets).toContain("continuar");
  expect(result.pendingFunctionalTargets).toContain("A quien pueda interesar");
  expect(result.diagnostics.allowed).toBe(false);
  expect(result.diagnostics.reason).toBe("functional_actions_pending");
});

test("evaluateEarlyCompletionPolicy: allows when only authConsumed pending", () => {
  const pending = [
    makeActionTarget(2, "Cédula de identidad dominicana"),
    makeActionTarget(3, "codigo otp")
  ];

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: undefined,
    skippedSteps: [],
    satisfiedAssertions: ["Operación completada"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(true);
  expect(result.reason).toBe("only_auth_optional_remaining");
  expect(result.pendingFunctionalTargets.length).toBe(0);
});

test("evaluateEarlyCompletionPolicy: allows when no actions pending and assertions satisfied", () => {
  const result = evaluateEarlyCompletionPolicy({
    pendingActions: [],
    executedStepIndices: new Set([1, 2, 3, 4, 5]),
    authGateState: undefined,
    skippedSteps: [],
    satisfiedAssertions: ["Resultado esperado"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(true);
  expect(result.reason).toBe("no_actions_remaining");
});

test("evaluateEarlyCompletionPolicy: does not count recoveredBy=auth_flow as functionalRequired", () => {
  const pending = [
    makeActionTarget(2, "Cédula de identidad dominicana"),
    makeActionTarget(5, "Generar cartas")
  ];

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: undefined,
    skippedSteps: [
      { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow" }
    ],
    satisfiedAssertions: [],
    pendingAssertions: []
  });

  expect(result.pendingFunctionalTargets).toContain("Generar cartas");
  expect(result.pendingFunctionalTargets).not.toContain("Cédula de identidad dominicana");
  expect(result.ignoredAuthConsumedTargets).toContain("Cédula de identidad dominicana");
});

test("evaluateEarlyCompletionPolicy: does not count metadata.authGateSkipped as functionalRequired", () => {
  const pending = [
    makeActionTarget(2, "confirmar codigo"),
    makeActionTarget(5, "Seleccionar producto")
  ];

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: undefined,
    skippedSteps: [
      { targetText: "confirmar codigo", status: "skipped", recoveredBy: "auth_flow" }
    ],
    satisfiedAssertions: [],
    pendingAssertions: []
  });

  expect(result.pendingFunctionalTargets).toContain("Seleccionar producto");
  expect(result.pendingFunctionalTargets).not.toContain("confirmar codigo");
});

test("evaluateEarlyCompletionPolicy: allows when only optional pending", () => {
  const pending = [
    makeActionTarget(5, "Seleccionar tarjeta preferida", "click", true)
  ];

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: undefined,
    skippedSteps: [],
    satisfiedAssertions: ["Operación exitosa"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(true);
  expect(result.reason).toBe("only_auth_optional_remaining");
});

test("C37869 scenario: does not cut after Carta de referencia", () => {
  const pending = [
    makeActionTarget(5, "cuenta de ahorros"),
    makeActionTarget(6, "continuar"),
    makeActionTarget(7, "A quien pueda interesar"),
    makeActionTarget(8, "continuar")
  ];

  const authState = makeAuthGateState();
  authState.authConsumedOpen = false;
  authState.functionalStepSeenAfterAuth = true;

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: pending,
    executedStepIndices: new Set([1, 2, 3, 4]),
    authGateState: authState,
    skippedSteps: [
      { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow" }
    ],
    satisfiedAssertions: ["Carta de referencia seleccionada"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(false);
  expect(result.reason).toBe("functional_actions_pending");
  expect(result.pendingFunctionalTargets).toEqual([
    "cuenta de ahorros",
    "continuar",
    "A quien pueda interesar",
    "continuar"
  ]);
});

test("C37869 scenario: maintains pending functional actions list", () => {
  const pending = [
    makeActionTarget(5, "cuenta de ahorros"),
    makeActionTarget(6, "continuar"),
    makeActionTarget(7, "A quien pueda interesar"),
    makeActionTarget(8, "continuar")
  ];

  const authState = makeAuthGateState();
  authState.authConsumedOpen = false;

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: authState,
    skippedSteps: [],
    satisfiedAssertions: [],
    pendingAssertions: []
  });

  expect(result.pendingFunctionalTargets).toEqual([
    "cuenta de ahorros",
    "continuar",
    "A quien pueda interesar",
    "continuar"
  ]);
  expect(result.pendingFunctionalTargets.length).toBe(4);
});

test("Early completion diagnostics includes pendingFunctionalTargets", () => {
  const pending = [
    makeActionTarget(5, "seleccionar producto"),
    makeActionTarget(6, "confirmar")
  ];

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: undefined,
    skippedSteps: [],
    satisfiedAssertions: ["Vista parcial"],
    pendingAssertions: []
  });

  expect(result.diagnostics.pendingFunctionalTargets).toEqual([
    "seleccionar producto",
    "confirmar"
  ]);
  expect(result.diagnostics.allowed).toBe(false);
  expect(result.diagnostics.reason).toBe("functional_actions_pending");
});

test("Logging indicates blocking reason", () => {
  const pending = [
    makeActionTarget(5, "seleccionar destinatario"),
    makeActionTarget(6, "enviar")
  ];

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: pending,
    executedStepIndices: new Set(),
    authGateState: undefined,
    skippedSteps: [],
    satisfiedAssertions: ["Formulario visible"],
    pendingAssertions: []
  });

  expect(result.diagnostics.reason).toBe("functional_actions_pending");
  expect(result.pendingFunctionalTargets.length).toBe(2);
});

test("Case with AuthFlow + pending functional actions does not cut early", () => {
  const authState = makeAuthGateState();
  authState.authConsumedOpen = false;
  authState.functionalStepSeenAfterAuth = true;

  const pending = [
    makeActionTarget(5, "Generar cartas"),
    makeActionTarget(6, "Carta de referencia"),
    makeActionTarget(7, "cuenta de ahorros"),
    makeActionTarget(8, "continuar")
  ];

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: pending,
    executedStepIndices: new Set([1, 2, 3, 4]),
    authGateState: authState,
    skippedSteps: [
      { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow" }
    ],
    satisfiedAssertions: ["Menu visible"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(false);
  expect(result.pendingFunctionalTargets.length).toBe(4);
});

test("Case with only auth steps consumed can ignore them", () => {
  const authState = makeAuthGateState();

  const pending = [
    makeActionTarget(2, "Cédula de identidad dominicana"),
    makeActionTarget(3, "codigo otp"),
    makeActionTarget(4, "confirmar codigo")
  ];

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: pending,
    executedStepIndices: new Set([1]),
    authGateState: authState,
    skippedSteps: [],
    satisfiedAssertions: ["Autenticación completada"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(true);
  expect(result.pendingFunctionalTargets.length).toBe(0);
});

test("Case without pending actions can use early completion normally", () => {
  const result = evaluateEarlyCompletionPolicy({
    pendingActions: [],
    executedStepIndices: new Set([1, 2, 3, 4, 5, 6]),
    authGateState: undefined,
    skippedSteps: [],
    satisfiedAssertions: ["Resultado final visible", "Operación exitosa"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(true);
  expect(result.reason).toBe("no_actions_remaining");
});

test("C37869 full scenario: after Carta de referencia, early completion blocked", () => {
  const allActionTargets = [
    makeActionTarget(1, "iniciar"),
    makeActionTarget(2, "transacciones y servicio"),
    makeActionTarget(3, "Cédula de identidad dominicana"),
    makeActionTarget(4, "continuar"),
    makeActionTarget(5, "Generar cartas"),
    makeActionTarget(6, "Carta de referencia"),
    makeActionTarget(7, "cuenta de ahorros"),
    makeActionTarget(8, "continuar"),
    makeActionTarget(9, "A quien pueda interesar"),
    makeActionTarget(10, "continuar")
  ];

  const authState = makeAuthGateState();
  authState.authConsumedOpen = false;
  authState.functionalStepSeenAfterAuth = true;

  const skippedSteps = [
    { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow", index: 3 },
    { targetText: "continuar", status: "skipped", recoveredBy: "auth_flow", index: 4 }
  ];

  const executedIndices = new Set([1, 2, 5, 6]);
  const remainingActions = allActionTargets.filter(a => a.index > 6);

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: remainingActions,
    executedStepIndices: executedIndices,
    authGateState: authState,
    skippedSteps,
    satisfiedAssertions: ["Carta seleccionada"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(false);
  expect(result.reason).toBe("functional_actions_pending");
  expect(result.pendingFunctionalTargets).toEqual([
    "cuenta de ahorros",
    "continuar",
    "A quien pueda interesar",
    "continuar"
  ]);
  expect(result.diagnostics.classifications.functionalRequired).toEqual([
    "cuenta de ahorros",
    "continuar",
    "A quien pueda interesar",
    "continuar"
  ]);
  expect(result.diagnostics.classifications.authConsumed).toEqual([]);
});

test("C37869 evaluation point before click on current target: current action remains functionalRequired", () => {
  const allActionTargets = [
    makeActionTarget(0, "iniciar"),
    makeActionTarget(1, "transacciones y servicio"),
    makeActionTarget(2, "Cédula de identidad dominicana"),
    makeActionTarget(3, "continuar"),
    makeActionTarget(4, "Generar cartas"),
    makeActionTarget(5, "Carta de referencia"),
    makeActionTarget(6, "cuenta de ahorros"),
    makeActionTarget(7, "continuar"),
    makeActionTarget(8, "A quien pueda interesar"),
    makeActionTarget(9, "continuar")
  ];

  const authState = makeAuthGateState();
  authState.authConsumedOpen = false;
  authState.functionalStepSeenAfterAuth = true;

  const pendingActions = allActionTargets.filter(a => a.index >= 5);
  const executedIndices = new Set([0, 1, 4]);
  const skippedSteps = [
    { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow", index: 2 },
    { targetText: "continuar", status: "skipped", recoveredBy: "auth_flow", index: 3 }
  ];

  const result = evaluateEarlyCompletionPolicy({
    pendingActions,
    executedStepIndices: executedIndices,
    authGateState: authState,
    skippedSteps,
    satisfiedAssertions: ["Flujo parcialmente visible"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(false);
  expect(result.reason).toBe("functional_actions_pending");
  expect(result.diagnostics.classifications.functionalRequired).toEqual([
    "Carta de referencia",
    "cuenta de ahorros",
    "continuar",
    "A quien pueda interesar",
    "continuar"
  ]);
});

test("C37869 evaluation point after click on Carta de referencia: next functional actions still block early completion", () => {
  const allActionTargets = [
    makeActionTarget(0, "iniciar"),
    makeActionTarget(1, "transacciones y servicio"),
    makeActionTarget(2, "Cédula de identidad dominicana"),
    makeActionTarget(3, "continuar"),
    makeActionTarget(4, "Generar cartas"),
    makeActionTarget(5, "Carta de referencia"),
    makeActionTarget(6, "cuenta de ahorros"),
    makeActionTarget(7, "continuar"),
    makeActionTarget(8, "A quien pueda interesar"),
    makeActionTarget(9, "continuar")
  ];

  const authState = makeAuthGateState();
  authState.authConsumedOpen = false;
  authState.functionalStepSeenAfterAuth = true;

  const pendingActions = allActionTargets.filter(a => a.index > 5);
  const executedIndices = new Set([0, 1, 4, 5]);
  const skippedSteps = [
    { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow", index: 2 },
    { targetText: "continuar", status: "skipped", recoveredBy: "auth_flow", index: 3 }
  ];

  const result = evaluateEarlyCompletionPolicy({
    pendingActions,
    executedStepIndices: executedIndices,
    authGateState: authState,
    skippedSteps,
    satisfiedAssertions: ["Carta seleccionada"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(false);
  expect(result.reason).toBe("functional_actions_pending");
  expect(result.diagnostics.classifications.functionalRequired).toEqual([
    "cuenta de ahorros",
    "continuar",
    "A quien pueda interesar",
    "continuar"
  ]);
});

test("C37869 full scenario: after final continuar, early completion allowed", () => {
  const allActionTargets = [
    makeActionTarget(1, "iniciar"),
    makeActionTarget(2, "transacciones y servicio"),
    makeActionTarget(3, "Cédula de identidad dominicana"),
    makeActionTarget(4, "continuar"),
    makeActionTarget(5, "Generar cartas"),
    makeActionTarget(6, "Carta de referencia"),
    makeActionTarget(7, "cuenta de ahorros"),
    makeActionTarget(8, "continuar"),
    makeActionTarget(9, "A quien pueda interesar"),
    makeActionTarget(10, "continuar")
  ];

  const authState = makeAuthGateState();
  authState.authConsumedOpen = false;
  authState.functionalStepSeenAfterAuth = true;

  const skippedSteps = [
    { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow", index: 3 },
    { targetText: "continuar", status: "skipped", recoveredBy: "auth_flow", index: 4 }
  ];

  const executedIndices = new Set([1, 2, 5, 6, 7, 8, 9, 10]);
  const remainingActions = allActionTargets.filter(a => a.index > 10);

  const result = evaluateEarlyCompletionPolicy({
    pendingActions: remainingActions,
    executedStepIndices: executedIndices,
    authGateState: authState,
    skippedSteps,
    satisfiedAssertions: ["Vista previa visible"],
    pendingAssertions: []
  });

  expect(result.allowed).toBe(true);
  expect(result.reason).toBe("no_actions_remaining");
  expect(result.pendingFunctionalTargets.length).toBe(0);
});
