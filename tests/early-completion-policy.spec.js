"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const early_completion_policy_1 = require("../src/discovery/early-completion-policy");
function makeActionTarget(index, target, action = "click", isOptional = false) {
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
    };
}
function makeAuthGateState() {
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
(0, test_1.test)("classifyPendingActions: functional actions are classified as functionalRequired", () => {
    const pending = [
        makeActionTarget(5, "Generar cartas"),
        makeActionTarget(6, "Carta de referencia"),
        makeActionTarget(7, "cuenta de ahorros"),
        makeActionTarget(8, "continuar")
    ];
    const result = (0, early_completion_policy_1.classifyPendingActionsForEarlyCompletion)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: undefined,
        skippedSteps: []
    });
    (0, test_1.expect)(result.functionalRequired.length).toBe(4);
    (0, test_1.expect)(result.authConsumed.length).toBe(0);
    (0, test_1.expect)(result.optional.length).toBe(0);
    (0, test_1.expect)(result.functionalRequired.map(a => a.target)).toContain("Generar cartas");
    (0, test_1.expect)(result.functionalRequired.map(a => a.target)).toContain("Carta de referencia");
    (0, test_1.expect)(result.functionalRequired.map(a => a.target)).toContain("cuenta de ahorros");
});
(0, test_1.test)("classifyPendingActions: auth keywords are classified as authConsumed", () => {
    const pending = [
        makeActionTarget(2, "Cédula de identidad dominicana"),
        makeActionTarget(3, "codigo otp"),
        makeActionTarget(4, "confirmar codigo")
    ];
    const result = (0, early_completion_policy_1.classifyPendingActionsForEarlyCompletion)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: undefined,
        skippedSteps: []
    });
    (0, test_1.expect)(result.authConsumed.length).toBe(3);
    (0, test_1.expect)(result.functionalRequired.length).toBe(0);
});
(0, test_1.test)("classifyPendingActions: auth continue variants with authConsumedOpen=true are authConsumed", () => {
    const pending = [
        makeActionTarget(3, "continuar"),
        makeActionTarget(4, "confirmar")
    ];
    const authState = makeAuthGateState();
    authState.authConsumedOpen = true;
    const result = (0, early_completion_policy_1.classifyPendingActionsForEarlyCompletion)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: authState,
        skippedSteps: []
    });
    (0, test_1.expect)(result.authConsumed.length).toBe(2);
    (0, test_1.expect)(result.functionalRequired.length).toBe(0);
});
(0, test_1.test)("classifyPendingActions: auth continue variants with authConsumedOpen=false are functionalRequired", () => {
    const pending = [
        makeActionTarget(5, "continuar"),
        makeActionTarget(6, "confirmar")
    ];
    const authState = makeAuthGateState();
    authState.authConsumedOpen = false;
    authState.functionalStepSeenAfterAuth = true;
    const result = (0, early_completion_policy_1.classifyPendingActionsForEarlyCompletion)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: authState,
        skippedSteps: []
    });
    (0, test_1.expect)(result.functionalRequired.length).toBe(2);
    (0, test_1.expect)(result.authConsumed.length).toBe(0);
});
(0, test_1.test)("classifyPendingActions: optional actions are classified as optional", () => {
    const pending = [
        makeActionTarget(5, "Seleccionar tarjeta preferida", "click", true)
    ];
    const result = (0, early_completion_policy_1.classifyPendingActionsForEarlyCompletion)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: undefined,
        skippedSteps: []
    });
    (0, test_1.expect)(result.optional.length).toBe(1);
    (0, test_1.expect)(result.functionalRequired.length).toBe(0);
});
(0, test_1.test)("classifyPendingActions: already executed actions are duplicateAlreadyExecuted", () => {
    const pending = [
        makeActionTarget(5, "Generar cartas"),
        makeActionTarget(6, "Carta de referencia")
    ];
    const result = (0, early_completion_policy_1.classifyPendingActionsForEarlyCompletion)({
        pendingActions: pending,
        executedStepIndices: new Set([5]),
        authGateState: undefined,
        skippedSteps: []
    });
    (0, test_1.expect)(result.duplicateAlreadyExecuted.length).toBe(1);
    (0, test_1.expect)(result.duplicateAlreadyExecuted[0].target).toBe("Generar cartas");
    (0, test_1.expect)(result.functionalRequired.length).toBe(1);
});
(0, test_1.test)("classifyPendingActions: skipped steps from auth flow are authConsumed", () => {
    const pending = [
        makeActionTarget(3, "Cédula de identidad dominicana"),
        makeActionTarget(4, "continuar")
    ];
    const result = (0, early_completion_policy_1.classifyPendingActionsForEarlyCompletion)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: undefined,
        skippedSteps: [
            { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow", index: 3 },
            { targetText: "continuar", status: "skipped", recoveredBy: "auth_flow", index: 4 }
        ]
    });
    (0, test_1.expect)(result.authConsumed.length).toBe(2);
    (0, test_1.expect)(result.functionalRequired.length).toBe(0);
});
(0, test_1.test)("evaluateEarlyCompletionPolicy: blocks when functionalRequired pending", () => {
    const pending = [
        makeActionTarget(5, "cuenta de ahorros"),
        makeActionTarget(6, "continuar"),
        makeActionTarget(7, "A quien pueda interesar"),
        makeActionTarget(8, "continuar")
    ];
    const authState = makeAuthGateState();
    authState.authConsumedOpen = false;
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: authState,
        skippedSteps: [],
        satisfiedAssertions: ["Vista previa de carta"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(false);
    (0, test_1.expect)(result.reason).toBe("functional_actions_pending");
    (0, test_1.expect)(result.pendingFunctionalTargets.length).toBe(4);
    (0, test_1.expect)(result.pendingFunctionalTargets).toContain("cuenta de ahorros");
    (0, test_1.expect)(result.pendingFunctionalTargets).toContain("continuar");
    (0, test_1.expect)(result.pendingFunctionalTargets).toContain("A quien pueda interesar");
    (0, test_1.expect)(result.diagnostics.allowed).toBe(false);
    (0, test_1.expect)(result.diagnostics.reason).toBe("functional_actions_pending");
});
(0, test_1.test)("evaluateEarlyCompletionPolicy: allows when only authConsumed pending", () => {
    const pending = [
        makeActionTarget(2, "Cédula de identidad dominicana"),
        makeActionTarget(3, "codigo otp")
    ];
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: undefined,
        skippedSteps: [],
        satisfiedAssertions: ["Operación completada"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(true);
    (0, test_1.expect)(result.reason).toBe("only_auth_optional_remaining");
    (0, test_1.expect)(result.pendingFunctionalTargets.length).toBe(0);
});
(0, test_1.test)("evaluateEarlyCompletionPolicy: allows when no actions pending and assertions satisfied", () => {
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: [],
        executedStepIndices: new Set([1, 2, 3, 4, 5]),
        authGateState: undefined,
        skippedSteps: [],
        satisfiedAssertions: ["Resultado esperado"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(true);
    (0, test_1.expect)(result.reason).toBe("no_actions_remaining");
});
(0, test_1.test)("evaluateEarlyCompletionPolicy: does not count recoveredBy=auth_flow as functionalRequired", () => {
    const pending = [
        makeActionTarget(2, "Cédula de identidad dominicana"),
        makeActionTarget(5, "Generar cartas")
    ];
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: undefined,
        skippedSteps: [
            { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow" }
        ],
        satisfiedAssertions: [],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.pendingFunctionalTargets).toContain("Generar cartas");
    (0, test_1.expect)(result.pendingFunctionalTargets).not.toContain("Cédula de identidad dominicana");
    (0, test_1.expect)(result.ignoredAuthConsumedTargets).toContain("Cédula de identidad dominicana");
});
(0, test_1.test)("evaluateEarlyCompletionPolicy: does not count metadata.authGateSkipped as functionalRequired", () => {
    const pending = [
        makeActionTarget(2, "confirmar codigo"),
        makeActionTarget(5, "Seleccionar producto")
    ];
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: undefined,
        skippedSteps: [
            { targetText: "confirmar codigo", status: "skipped", recoveredBy: "auth_flow" }
        ],
        satisfiedAssertions: [],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.pendingFunctionalTargets).toContain("Seleccionar producto");
    (0, test_1.expect)(result.pendingFunctionalTargets).not.toContain("confirmar codigo");
});
(0, test_1.test)("evaluateEarlyCompletionPolicy: allows when only optional pending", () => {
    const pending = [
        makeActionTarget(5, "Seleccionar tarjeta preferida", "click", true)
    ];
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: undefined,
        skippedSteps: [],
        satisfiedAssertions: ["Operación exitosa"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(true);
    (0, test_1.expect)(result.reason).toBe("only_auth_optional_remaining");
});
(0, test_1.test)("C37869 scenario: does not cut after Carta de referencia", () => {
    const pending = [
        makeActionTarget(5, "cuenta de ahorros"),
        makeActionTarget(6, "continuar"),
        makeActionTarget(7, "A quien pueda interesar"),
        makeActionTarget(8, "continuar")
    ];
    const authState = makeAuthGateState();
    authState.authConsumedOpen = false;
    authState.functionalStepSeenAfterAuth = true;
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: pending,
        executedStepIndices: new Set([1, 2, 3, 4]),
        authGateState: authState,
        skippedSteps: [
            { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow" }
        ],
        satisfiedAssertions: ["Carta de referencia seleccionada"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(false);
    (0, test_1.expect)(result.reason).toBe("functional_actions_pending");
    (0, test_1.expect)(result.pendingFunctionalTargets).toEqual([
        "cuenta de ahorros",
        "continuar",
        "A quien pueda interesar",
        "continuar"
    ]);
});
(0, test_1.test)("C37869 scenario: maintains pending functional actions list", () => {
    const pending = [
        makeActionTarget(5, "cuenta de ahorros"),
        makeActionTarget(6, "continuar"),
        makeActionTarget(7, "A quien pueda interesar"),
        makeActionTarget(8, "continuar")
    ];
    const authState = makeAuthGateState();
    authState.authConsumedOpen = false;
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: authState,
        skippedSteps: [],
        satisfiedAssertions: [],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.pendingFunctionalTargets).toEqual([
        "cuenta de ahorros",
        "continuar",
        "A quien pueda interesar",
        "continuar"
    ]);
    (0, test_1.expect)(result.pendingFunctionalTargets.length).toBe(4);
});
(0, test_1.test)("Early completion diagnostics includes pendingFunctionalTargets", () => {
    const pending = [
        makeActionTarget(5, "seleccionar producto"),
        makeActionTarget(6, "confirmar")
    ];
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: undefined,
        skippedSteps: [],
        satisfiedAssertions: ["Vista parcial"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.diagnostics.pendingFunctionalTargets).toEqual([
        "seleccionar producto",
        "confirmar"
    ]);
    (0, test_1.expect)(result.diagnostics.allowed).toBe(false);
    (0, test_1.expect)(result.diagnostics.reason).toBe("functional_actions_pending");
});
(0, test_1.test)("Logging indicates blocking reason", () => {
    const pending = [
        makeActionTarget(5, "seleccionar destinatario"),
        makeActionTarget(6, "enviar")
    ];
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: pending,
        executedStepIndices: new Set(),
        authGateState: undefined,
        skippedSteps: [],
        satisfiedAssertions: ["Formulario visible"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.diagnostics.reason).toBe("functional_actions_pending");
    (0, test_1.expect)(result.pendingFunctionalTargets.length).toBe(2);
});
(0, test_1.test)("Case with AuthFlow + pending functional actions does not cut early", () => {
    const authState = makeAuthGateState();
    authState.authConsumedOpen = false;
    authState.functionalStepSeenAfterAuth = true;
    const pending = [
        makeActionTarget(5, "Generar cartas"),
        makeActionTarget(6, "Carta de referencia"),
        makeActionTarget(7, "cuenta de ahorros"),
        makeActionTarget(8, "continuar")
    ];
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: pending,
        executedStepIndices: new Set([1, 2, 3, 4]),
        authGateState: authState,
        skippedSteps: [
            { targetText: "Cédula de identidad dominicana", status: "skipped", recoveredBy: "auth_flow" }
        ],
        satisfiedAssertions: ["Menu visible"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(false);
    (0, test_1.expect)(result.pendingFunctionalTargets.length).toBe(4);
});
(0, test_1.test)("Case with only auth steps consumed can ignore them", () => {
    const authState = makeAuthGateState();
    const pending = [
        makeActionTarget(2, "Cédula de identidad dominicana"),
        makeActionTarget(3, "codigo otp"),
        makeActionTarget(4, "confirmar codigo")
    ];
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: pending,
        executedStepIndices: new Set([1]),
        authGateState: authState,
        skippedSteps: [],
        satisfiedAssertions: ["Autenticación completada"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(true);
    (0, test_1.expect)(result.pendingFunctionalTargets.length).toBe(0);
});
(0, test_1.test)("Case without pending actions can use early completion normally", () => {
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: [],
        executedStepIndices: new Set([1, 2, 3, 4, 5, 6]),
        authGateState: undefined,
        skippedSteps: [],
        satisfiedAssertions: ["Resultado final visible", "Operación exitosa"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(true);
    (0, test_1.expect)(result.reason).toBe("no_actions_remaining");
});
(0, test_1.test)("C37869 full scenario: after Carta de referencia, early completion blocked", () => {
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
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: remainingActions,
        executedStepIndices: executedIndices,
        authGateState: authState,
        skippedSteps,
        satisfiedAssertions: ["Carta seleccionada"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(false);
    (0, test_1.expect)(result.reason).toBe("functional_actions_pending");
    (0, test_1.expect)(result.pendingFunctionalTargets).toEqual([
        "cuenta de ahorros",
        "continuar",
        "A quien pueda interesar",
        "continuar"
    ]);
    (0, test_1.expect)(result.diagnostics.classifications.functionalRequired).toEqual([
        "cuenta de ahorros",
        "continuar",
        "A quien pueda interesar",
        "continuar"
    ]);
    (0, test_1.expect)(result.diagnostics.classifications.authConsumed).toEqual([]);
});
(0, test_1.test)("C37869 evaluation point before click on current target: current action remains functionalRequired", () => {
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
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions,
        executedStepIndices: executedIndices,
        authGateState: authState,
        skippedSteps,
        satisfiedAssertions: ["Flujo parcialmente visible"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(false);
    (0, test_1.expect)(result.reason).toBe("functional_actions_pending");
    (0, test_1.expect)(result.diagnostics.classifications.functionalRequired).toEqual([
        "Carta de referencia",
        "cuenta de ahorros",
        "continuar",
        "A quien pueda interesar",
        "continuar"
    ]);
});
(0, test_1.test)("C37869 evaluation point after click on Carta de referencia: next functional actions still block early completion", () => {
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
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions,
        executedStepIndices: executedIndices,
        authGateState: authState,
        skippedSteps,
        satisfiedAssertions: ["Carta seleccionada"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(false);
    (0, test_1.expect)(result.reason).toBe("functional_actions_pending");
    (0, test_1.expect)(result.diagnostics.classifications.functionalRequired).toEqual([
        "cuenta de ahorros",
        "continuar",
        "A quien pueda interesar",
        "continuar"
    ]);
});
(0, test_1.test)("C37869 full scenario: after final continuar, early completion allowed", () => {
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
    const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
        pendingActions: remainingActions,
        executedStepIndices: executedIndices,
        authGateState: authState,
        skippedSteps,
        satisfiedAssertions: ["Vista previa visible"],
        pendingAssertions: []
    });
    (0, test_1.expect)(result.allowed).toBe(true);
    (0, test_1.expect)(result.reason).toBe("no_actions_remaining");
    (0, test_1.expect)(result.pendingFunctionalTargets.length).toBe(0);
});
