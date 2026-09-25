"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const case_discovery_workflow_1 = require("./case-discovery-workflow");
const case_discovery_1 = require("./case-discovery");
function buildScenario(expected) {
    return {
        source: "testrail",
        externalId: "PREVIEW-001",
        caseId: 0,
        title: "Escenario de prueba",
        steps: [
            { index: 1, action: "Navigate", dataHints: [] },
            { index: 2, action: "Click Iniciar", dataHints: [] },
        ],
        raw: {
            custom_expected: expected,
        },
    };
}
function buildCaseResult(overrides) {
    return {
        version: "1.0",
        caseId: 0,
        caseTitle: "Escenario de prueba",
        discoveredAt: new Date().toISOString(),
        status: "discovered_partial",
        steps: [],
        discoveredObjects: [],
        ...overrides,
    };
}
(0, node_test_1.default)("backed consumed oracle reconciles its pending assertion before blocking calculation", () => {
    const steps = [{
            index: 2,
            action: "assert result",
            targetText: "result visible",
            status: "not_found",
            assertionClassification: "passive_visibility",
            pendingDiscovery: true,
            error: "assertion_not_found",
        }];
    const reconciled = (0, case_discovery_1.reconcilePendingAssertionsWithBackedOracles)(steps, [{
            backed: true,
            consumed: true,
            requirement: "result visible",
            stepIndex: 2,
        }]);
    node_assert_1.default.strictEqual(reconciled, 1);
    node_assert_1.default.strictEqual(steps[0].pendingDiscovery, false);
    node_assert_1.default.strictEqual(steps[0].status, "satisfied_by_previous_assertion");
    node_assert_1.default.strictEqual(steps[0].error, undefined);
    node_assert_1.default.strictEqual((0, case_discovery_1.calculateUnresolvedBlockingFailures)(steps, { detected: false }).length, 0);
});
(0, node_test_1.default)("observable oracle preserves exact single and multiple requirementRefs by structural step identity", () => {
    const oracles = [
        { id: "oracle-a", requirement: "A", type: "navigation_transition", backed: true, source: "discovery", stepIndex: 1, evidence: [] },
        { id: "oracle-b", requirement: "B", type: "navigation_transition", backed: true, source: "discovery", stepIndex: 2, evidence: [] },
    ];
    const linked = (0, case_discovery_workflow_1.attachObservableOracleRequirementRefs)(oracles, [
        { index: 1, requirementRefs: ["REQ-A", "REQ-B"] },
        { index: 2, requirementRefs: ["REQ-C"] },
    ]);
    node_assert_1.default.deepEqual(linked[0].requirementRefs, ["REQ-A", "REQ-B"]);
    node_assert_1.default.deepEqual(linked[1].requirementRefs, ["REQ-C"]);
});
(0, node_test_1.default)("observable oracle without requirementRefs remains undefined and never borrows another step", () => {
    const linked = (0, case_discovery_workflow_1.attachObservableOracleRequirementRefs)([
        { id: "oracle-x", requirement: "X", type: "literal_visible_text", backed: true, source: "discovery", stepIndex: 3, evidence: [] },
    ], [
        { index: 1, requirementRefs: ["REQ-A"] },
        { index: 2, requirementRefs: ["REQ-B"] },
    ]);
    node_assert_1.default.equal(linked[0].requirementRefs, undefined);
});
(0, node_test_1.default)("canonical requirements remain case-scoped and resolve only by exact requirementId", () => {
    const requirements = [
        { requirementId: "REQ-A", kind: "state", description: "A", origin: { originRef: "a" } },
        { requirementId: "REQ-B", kind: "state", description: "B", origin: { originRef: "b" } },
    ];
    node_assert_1.default.equal((0, case_discovery_workflow_1.resolveCanonicalRequirementById)(requirements, "REQ-B")?.requirementId, "REQ-B");
    node_assert_1.default.equal((0, case_discovery_workflow_1.resolveCanonicalRequirementById)(requirements, "REQ-X"), undefined);
    node_assert_1.default.equal((0, case_discovery_workflow_1.resolveCanonicalRequirementById)(requirements, "REQ-B")?.description, "B");
});
(0, node_test_1.default)("promotion source scenario carries the existing canonical requirement collection", () => {
    const scenario = {
        ...buildScenario("The result is visible"),
        canonicalRequirements: [{ requirementId: "REQ-A", kind: "state", description: "Result", origin: { originRef: "a" } }],
    };
    const source = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, buildCaseResult({}));
    node_assert_1.default.equal(source.requirements?.[0]?.requirementId, "REQ-A");
    node_assert_1.default.equal(source.requirements?.[0]?.description, "Result");
});
(0, node_test_1.default)("observable oracle polarity resolves only from exact requirement identities", () => {
    const requirements = [
        { requirementId: "REQ-A", kind: "state", description: "A", polarity: "negative", origin: { originRef: "a" } },
        { requirementId: "REQ-B", kind: "state", description: "B", polarity: "positive", origin: { originRef: "b" } },
        { requirementId: "REQ-C", kind: "state", description: "C", polarity: "negative", origin: { originRef: "c" } },
        { requirementId: "REQ-U", kind: "state", description: "U", origin: { originRef: "u" } },
    ];
    node_assert_1.default.equal((0, case_discovery_workflow_1.resolveObservableOraclePolarity)(["REQ-A"], requirements), "negative");
    node_assert_1.default.equal((0, case_discovery_workflow_1.resolveObservableOraclePolarity)(["REQ-B"], requirements), "positive");
    node_assert_1.default.equal((0, case_discovery_workflow_1.resolveObservableOraclePolarity)(["REQ-A", "REQ-C"], requirements), "negative");
    node_assert_1.default.equal((0, case_discovery_workflow_1.resolveObservableOraclePolarity)(["REQ-B", "REQ-B"], requirements), "positive");
    node_assert_1.default.equal((0, case_discovery_workflow_1.resolveObservableOraclePolarity)(["REQ-A", "REQ-B"], requirements), undefined);
    node_assert_1.default.equal((0, case_discovery_workflow_1.resolveObservableOraclePolarity)(["REQ-A", "REQ-U"], requirements), undefined);
    node_assert_1.default.equal((0, case_discovery_workflow_1.resolveObservableOraclePolarity)(["REQ-X"], requirements), undefined);
    node_assert_1.default.equal((0, case_discovery_workflow_1.resolveObservableOraclePolarity)([], requirements), undefined);
});
(0, node_test_1.default)("workflow closure reconciles every matching backed oracle before final blocking state", () => {
    const scenario = {
        ...buildScenario("La ruta pública dirige al resultado visible.\nLa ruta pública dirige al resultado visible."),
        steps: [
            { index: 1, action: "Hacer clic en Enviar", dataHints: [] },
            { index: 2, action: "Validar resultado", expected: "La ruta pública dirige al resultado visible.", dataHints: [] },
            { index: 3, action: "Validar resultado otra vez", expected: "La ruta pública dirige al resultado visible.", dataHints: [] },
        ],
    };
    const steps = [
        { index: 1, action: "click", targetText: "Enviar", status: "found", snapshotUrl: "/resultado" },
        { index: 2, action: "assert", targetText: "La ruta pública dirige al resultado visible.", status: "not_found", pendingDiscovery: true, error: "assertion_not_found" },
        { index: 3, action: "assert", targetText: "La ruta pública dirige al resultado visible.", status: "not_found", pendingDiscovery: true, error: "assertion_not_found" },
    ];
    const unresolvedPendingBlockers = () => steps.filter((step) => (step.status === "not_found" || step.status === "needs_assertion_resolution")
        && step.pendingDiscovery === true).length;
    const before = unresolvedPendingBlockers();
    node_assert_1.default.strictEqual(before, 2);
    const reconciled = (0, case_discovery_workflow_1.reconcileWorkflowAssertionsBeforeFinalStatus)(scenario, steps);
    node_assert_1.default.strictEqual(reconciled, 2);
    node_assert_1.default.strictEqual(unresolvedPendingBlockers(), 0);
    node_assert_1.default.ok(steps.slice(1).every((step) => step.pendingDiscovery === false));
});
(0, node_test_1.default)("workflow closure builds and reconciles both final assertions before blockers", () => {
    const scenario = {
        ...buildScenario("La autenticación finaliza correctamente, el formulario de acceso deja de ser la pantalla activa y se muestra la pantalla inicial autenticada del aplicativo."),
        steps: [
            { index: 1, action: "Ingresar identificador", dataHints: [] },
            { index: 4, action: "Hacer clic en el botón Continuar", dataHints: [] },
            { index: 6, action: "Clic en un control auxiliar", dataHints: [] },
            { index: 7, action: "Validar que el formulario de acceso ya no sea la pantalla activa", dataHints: [] },
            { index: 8, action: "Validar que se muestre la pantalla inicial autenticada del aplicativo", dataHints: [] },
        ],
    };
    const steps = [
        { index: 4, action: "click", targetText: "Continuar", status: "found", snapshotUrl: "/dashboard" },
        { index: 6, action: "click", targetText: "control auxiliar", status: "found", snapshotUrl: "/dashboard" },
        { index: 7, action: "assert", targetText: "que el formulario de acceso ya no sea la pantalla activa", status: "not_found", pendingDiscovery: true, functionalRequired: true, error: "assertion_not_found" },
        { index: 8, action: "assert", targetText: "que se muestre la pantalla inicial autenticada del aplicativo", status: "not_found", pendingDiscovery: true, functionalRequired: true, error: "assertion_not_found" },
    ];
    const reconciled = (0, case_discovery_workflow_1.reconcileWorkflowAssertionsBeforeFinalStatus)(scenario, steps);
    node_assert_1.default.strictEqual(reconciled, 2);
    node_assert_1.default.strictEqual((0, case_discovery_1.calculateUnresolvedBlockingFailures)(steps, { detected: false }).length, 0);
});
(0, node_test_1.default)("real TestRail assertion actions complete the oracle set before blockers", () => {
    const scenario = {
        ...buildScenario("La ruta pública dirige al resultado visible."),
        steps: [
            { index: 1, action: "Hacer clic en Enviar", dataHints: [] },
            { index: 2, action: "Validar que el formulario ya no esté visible", dataHints: [] },
            { index: 3, action: "Validar que se muestre el resultado", dataHints: [] },
        ],
    };
    const steps = [
        { index: 1, action: "Hacer clic en Enviar", status: "found", snapshotUrl: "/resultado" },
        { index: 2, action: "Validar que el formulario ya no esté visible", targetText: "que el formulario ya no esté visible", status: "not_found", pendingDiscovery: true, functionalRequired: true, error: "assertion_not_found" },
        { index: 3, action: "Validar que se muestre el resultado", targetText: "que se muestre el resultado", status: "not_found", pendingDiscovery: true, functionalRequired: true, error: "assertion_not_found" },
    ];
    node_assert_1.default.strictEqual((0, case_discovery_workflow_1.reconcileWorkflowAssertionsBeforeFinalStatus)(scenario, steps), 2);
    node_assert_1.default.strictEqual((0, case_discovery_1.calculateUnresolvedBlockingFailures)(steps, { detected: false }).length, 0);
});
(0, node_test_1.default)("unbacked or cross-assertion oracles do not reconcile pending assertions", () => {
    const steps = [{
            index: 2,
            action: "assert result",
            targetText: "result visible",
            status: "not_found",
            assertionClassification: "passive_visibility",
            pendingDiscovery: true,
            error: "assertion_not_found",
        }];
    node_assert_1.default.strictEqual((0, case_discovery_1.reconcilePendingAssertionsWithBackedOracles)(steps, [{
            backed: false, consumed: true, requirement: "result visible", stepIndex: 2
        }]), 0);
    node_assert_1.default.strictEqual((0, case_discovery_1.reconcilePendingAssertionsWithBackedOracles)(steps, [{
            backed: true, consumed: true, requirement: "other result", stepIndex: 9
        }]), 0);
    node_assert_1.default.strictEqual(steps[0].pendingDiscovery, true);
});
(0, node_test_1.default)("reconciliation requires consumption and preserves passed or unresolved assertions", () => {
    const pending = (index, targetText) => ({
        index,
        action: "assert result",
        targetText,
        status: "not_found",
        assertionClassification: "passive_visibility",
        pendingDiscovery: true,
        error: "assertion_not_found",
    });
    const steps = [pending(2, "result visible"), pending(3, "other result")];
    node_assert_1.default.strictEqual((0, case_discovery_1.reconcilePendingAssertionsWithBackedOracles)(steps, [{
            backed: true, consumed: false, requirement: "result visible", stepIndex: 2
        }]), 0);
    node_assert_1.default.strictEqual((0, case_discovery_1.reconcilePendingAssertionsWithBackedOracles)(steps, [{
            backed: true, consumed: true, requirement: "result visible", stepIndex: 2
        }]), 1);
    node_assert_1.default.strictEqual(steps[0].status, "satisfied_by_previous_assertion");
    node_assert_1.default.strictEqual(steps[1].pendingDiscovery, true);
    const passed = { ...pending(4, "already visible"), status: "found", pendingDiscovery: false };
    node_assert_1.default.strictEqual((0, case_discovery_1.reconcilePendingAssertionsWithBackedOracles)([passed], [{
            backed: true, consumed: true, requirement: "already visible", stepIndex: 4
        }]), 0);
    node_assert_1.default.strictEqual(passed.status, "found");
    const unresolved = pending(5, "never visible");
    node_assert_1.default.strictEqual((0, case_discovery_1.reconcilePendingAssertionsWithBackedOracles)([unresolved], []), 0);
    node_assert_1.default.strictEqual(unresolved.pendingDiscovery, true);
});
(0, node_test_1.default)("narrative expected result maps to navigation_transition oracle when discovery has transition evidence", () => {
    const scenario = buildScenario("La ruta pública dirige al módulo de información.");
    const caseResult = buildCaseResult({
        runtimeEvidenceTrace: {
            clickActions: [
                {
                    stepIndex: 4,
                    target: "Información de productos",
                    normalizedTarget: "informacion de productos",
                    resolvedTarget: "Explora nuestros productos",
                    actionType: "click",
                    success: true,
                    transitionDetected: true,
                }
            ],
            fillActions: [],
            formEvidence: [],
            confirmationEvidence: [],
            structuralEvidence: [],
            feedbackEvidence: [],
        },
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("ruta pública"));
    node_assert_1.default.ok(oracle);
    node_assert_1.default.strictEqual(oracle?.type, "navigation_transition");
    node_assert_1.default.strictEqual(oracle?.backed, true);
    node_assert_1.default.strictEqual(oracle?.target, "Explora nuestros productos");
});
(0, node_test_1.default)("auth gate evidence maps narrative expected result to auth_gate oracle", () => {
    const scenario = buildScenario("Debe iniciar el flujo de autenticación antes de operar.");
    const caseResult = buildCaseResult({
        steps: [
            {
                index: 4,
                action: "Click Transacciones",
                status: "found",
                authGateDiagnostics: {
                    detected: true,
                    stage: "identification_type_selection",
                    detectedBeforeStep: "4",
                },
            }
        ],
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("flujo de autenticación"));
    node_assert_1.default.ok(oracle);
    node_assert_1.default.strictEqual(oracle?.type, "auth_gate");
    node_assert_1.default.strictEqual(oracle?.backed, true);
    node_assert_1.default.strictEqual(oracle?.details?.stage, "identification_type_selection");
});
(0, node_test_1.default)("literal visible expected result stays as literal observable oracle", () => {
    const scenario = buildScenario("¿Qué deseas realizar hoy?");
    const caseResult = buildCaseResult({
        steps: [
            {
                index: 3,
                action: "assertVisible",
                status: "found",
                targetText: "¿Qué deseas realizar hoy?",
                assertionStatus: "passed",
            }
        ],
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("¿Qué deseas realizar hoy?"));
    node_assert_1.default.ok(oracle);
    node_assert_1.default.strictEqual(oracle?.type, "literal_visible_text");
    node_assert_1.default.strictEqual(oracle?.backed, true);
});
(0, node_test_1.default)("unresolved oracle is explicit when no observable evidence is available", () => {
    const scenario = buildScenario("Debe mostrarse una etiqueta no observada.");
    const caseResult = buildCaseResult({
        status: "discovered_partial",
        steps: [],
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("etiqueta no observada"));
    node_assert_1.default.ok(oracle);
    node_assert_1.default.strictEqual(oracle?.type, "unsupported_or_unresolved");
    node_assert_1.default.strictEqual(oracle?.backed, false);
});
(0, node_test_1.default)("historical target without canonical identity remains unresolved", () => {
    const scenario = buildScenario("Información de productos");
    const caseResult = buildCaseResult({
        status: "discovered_passed",
        steps: [
            {
                index: 2,
                action: "click",
                status: "found",
                targetText: "Información de productos",
                resolvedTargetName: "Explora nuestros productos",
                matchedText: "Catálogo oficial",
                confidence: 0.93,
            }
        ],
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("Información de productos"));
    node_assert_1.default.ok(oracle);
    node_assert_1.default.strictEqual(oracle?.type, "unsupported_or_unresolved");
    node_assert_1.default.strictEqual(oracle?.backed, false);
});
(0, node_test_1.default)("weak semantic overlap does not create unsupported alias reconciliation", () => {
    const scenario = buildScenario("Solicitar préstamo hipotecario empresarial");
    const caseResult = buildCaseResult({
        status: "discovered_passed",
        steps: [
            {
                index: 2,
                action: "click",
                status: "found",
                targetText: "Panel principal",
                resolvedTargetName: "Inicio",
                confidence: 0.9,
            }
        ],
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("préstamo hipotecario"));
    node_assert_1.default.ok(oracle);
    node_assert_1.default.strictEqual(oracle?.type, "unsupported_or_unresolved");
    node_assert_1.default.strictEqual(oracle?.backed, false);
});
(0, node_test_1.default)("negative no-transition requirement is not satisfied by a semantically similar control label", () => {
    const scenario = {
        ...buildScenario("No se permite continuar ahora"),
        steps: [
            { index: 1, action: "Navigate", dataHints: [] },
            { index: 2, action: "Click botón de continuación", dataHints: [] },
        ],
    };
    const caseResult = buildCaseResult({
        status: "discovered_passed",
        steps: [
            {
                index: 2,
                action: "click",
                status: "found",
                targetText: "Continuar",
                resolvedTargetName: "Continuar ahora",
                confidence: 0.95,
            },
        ],
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("No se permite continuar ahora"));
    node_assert_1.default.ok(oracle);
    node_assert_1.default.equal(oracle?.type, "unsupported_or_unresolved");
    node_assert_1.default.equal(oracle?.backed, false);
    node_assert_1.default.equal(oracle?.polarity, undefined);
    node_assert_1.default.equal(sourceScenario.observableOracles?.some((item) => item.details?.semanticEquivalent === true), false);
});
function buildTransitionTrace() {
    return {
        clickActions: [
            {
                stepIndex: 3,
                target: "Explora nuestros productos",
                normalizedTarget: "explora nuestros productos",
                resolvedTarget: "Explora nuestros productos",
                actionType: "click",
                success: true,
                transitionDetected: true,
            }
        ],
        fillActions: [],
        formEvidence: [],
        confirmationEvidence: [],
        structuralEvidence: [],
        feedbackEvidence: [],
    };
}
function buildPendingAssertionStep(assertionText) {
    return { index: 4, action: "assertVisible", status: "needs_assertion_resolution", targetText: assertionText };
}
(0, node_test_1.default)("A1 navigation narrative assertion is locally consumed via transition-backed click related to the narrative requirement", () => {
    const assertionText = "información";
    const trace = buildTransitionTrace();
    const caseResult = buildCaseResult({
        steps: [buildPendingAssertionStep(assertionText)],
        runtimeEvidenceTrace: trace,
    });
    const narrative = ["La opción pública redirige al módulo de información."];
    const result = (0, case_discovery_workflow_1.collectLocalPendingAssertionDiagnostics)(caseResult, trace, narrative);
    node_assert_1.default.ok(result.localClosureDiagnostics?.consumed.includes(assertionText));
    node_assert_1.default.strictEqual(result.pendingAssertions.length, 0);
});
(0, node_test_1.default)("A2 transition-backed click unrelated to the assertion does not consume it", () => {
    const assertionText = "Debe mostrarse el saldo de la cuenta.";
    const trace = buildTransitionTrace();
    const caseResult = buildCaseResult({
        steps: [buildPendingAssertionStep(assertionText)],
        runtimeEvidenceTrace: trace,
    });
    const narrative = ["La opción pública redirige al módulo de información."];
    const result = (0, case_discovery_workflow_1.collectLocalPendingAssertionDiagnostics)(caseResult, trace, narrative);
    node_assert_1.default.ok(!result.localClosureDiagnostics?.consumed.includes(assertionText));
    node_assert_1.default.ok(result.pendingAssertions.includes(assertionText));
});
(0, node_test_1.default)("A3 navigation assertion stays pending when no transition-backed click was observed", () => {
    const assertionText = "Debe redirigir al módulo de información.";
    const trace = buildTransitionTrace();
    trace.clickActions[0].transitionDetected = false;
    const caseResult = buildCaseResult({
        steps: [buildPendingAssertionStep(assertionText)],
        runtimeEvidenceTrace: trace,
    });
    const narrative = ["La opción pública redirige al módulo de información."];
    const result = (0, case_discovery_workflow_1.collectLocalPendingAssertionDiagnostics)(caseResult, trace, narrative);
    node_assert_1.default.ok(!result.localClosureDiagnostics?.consumed.includes(assertionText));
});
(0, node_test_1.default)("B4 auth signal without a backed auth gate stays pending", () => {
    const assertionText = "El sistema debe presentar el flujo de autenticación.";
    const caseResult = buildCaseResult({ steps: [buildPendingAssertionStep(assertionText)] });
    const result = (0, case_discovery_workflow_1.collectLocalPendingAssertionDiagnostics)(caseResult);
    node_assert_1.default.ok(!result.localClosureDiagnostics?.consumed.includes(assertionText));
    node_assert_1.default.ok(result.pendingAssertions.includes(assertionText));
});
(0, node_test_1.default)("B5 auth assertion is consumed when an auth gate was detected on a step", () => {
    const assertionText = "El sistema debe presentar el flujo de autenticación.";
    const caseResult = buildCaseResult({
        steps: [
            {
                index: 3,
                action: "Click Transacciones",
                status: "found",
                authGateDiagnostics: { detected: true, stage: "identification_input", detectedBeforeStep: "4" },
            },
            buildPendingAssertionStep(assertionText),
        ],
    });
    const result = (0, case_discovery_workflow_1.collectLocalPendingAssertionDiagnostics)(caseResult);
    node_assert_1.default.ok(result.localClosureDiagnostics?.consumed.includes(assertionText));
});
(0, node_test_1.default)("B6 auth assertion is consumed via plan metadata gate detection without literal autenticación text", () => {
    const assertionText = "Debe estar identificado el cliente antes de operar.";
    node_assert_1.default.ok(!assertionText.toLowerCase().includes("autenticaci"));
    const caseResult = buildCaseResult({
        steps: [buildPendingAssertionStep(assertionText)],
        candidatePlan: {
            version: "1.0",
            source: "discovery_generated",
            status: "draft",
            scenario: { source: "testrail", caseId: 0, title: "Escenario de prueba" },
            requiredData: [],
            steps: [],
            createdAt: new Date().toISOString(),
            metadata: { authGateDetectedDuringDiscovery: true, authGateStage: "identification_input" },
        },
    });
    const result = (0, case_discovery_workflow_1.collectLocalPendingAssertionDiagnostics)(caseResult);
    node_assert_1.default.ok(result.localClosureDiagnostics?.consumed.includes(assertionText));
});
(0, node_test_1.default)("A4 descriptive click action is classified into a transition-backed runtime click", () => {
    const caseResult = buildCaseResult({
        steps: [
            { index: 3, action: 'Clic en "explora nuestros productos".', status: "found", targetText: "explora nuestros productos" },
        ],
    });
    const trace = (0, case_discovery_workflow_1.buildRuntimeEvidenceTrace)(caseResult);
    node_assert_1.default.ok(trace);
    node_assert_1.default.strictEqual(trace.clickActions.length, 1);
    node_assert_1.default.strictEqual(trace.clickActions[0].target, "explora nuestros productos");
    node_assert_1.default.strictEqual(trace.clickActions[0].success, true);
    node_assert_1.default.strictEqual(trace.clickActions[0].transitionDetected, true);
});
(0, node_test_1.default)("A5 visible-text validation action is not classified as a click", () => {
    const caseResult = buildCaseResult({
        steps: [
            { index: 4, action: 'Validar que se muestre "¿Qué deseas realizar hoy?".', status: "found", targetText: "¿Qué deseas realizar hoy?" },
        ],
    });
    const trace = (0, case_discovery_workflow_1.buildRuntimeEvidenceTrace)(caseResult);
    node_assert_1.default.ok(trace);
    node_assert_1.default.strictEqual(trace.clickActions.length, 0);
});
(0, node_test_1.default)("A6 descriptive click closes a pending navigation narrative assertion end to end", () => {
    const assertionText = "información";
    const caseResult = buildCaseResult({
        steps: [
            { index: 3, action: 'Clic en "explora nuestros productos".', status: "found", targetText: "explora nuestros productos" },
            buildPendingAssertionStep(assertionText),
        ],
    });
    const trace = (0, case_discovery_workflow_1.buildRuntimeEvidenceTrace)(caseResult);
    const narrative = ["La opción pública redirige al módulo de información."];
    const result = (0, case_discovery_workflow_1.collectLocalPendingAssertionDiagnostics)(caseResult, trace, narrative);
    node_assert_1.default.ok(result.localClosureDiagnostics?.consumed.includes(assertionText));
    node_assert_1.default.strictEqual(result.pendingAssertions.length, 0);
});
(0, node_test_1.default)("satisfied_by_previous_assertion auth narrative reconciles to auth_gate, never literal_visible_text", () => {
    const scenario = buildScenario("Debe iniciarse el flujo de autenticación al operar.");
    const caseResult = buildCaseResult({
        status: "discovered_passed",
        steps: [
            {
                index: 3,
                action: "Click Transacciones y servicios",
                status: "found",
                targetText: "Transacciones y servicios",
                authGateDiagnostics: { detected: true, stage: "identification_type_selection", detectedBeforeStep: "4" },
            },
            {
                index: 4,
                action: 'Validar que se muestre "flujo de autenticación".',
                status: "satisfied_by_previous_assertion",
                assertionStatus: "satisfied_by_previous_assertion",
                targetText: "flujo de autenticación",
            },
        ],
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const narrative = sourceScenario.observableOracles?.find((item) => item.requirement.includes("flujo de autenticación"));
    node_assert_1.default.ok(narrative);
    node_assert_1.default.strictEqual(narrative?.type, "auth_gate");
    node_assert_1.default.strictEqual(narrative?.backed, true);
    node_assert_1.default.ok(!sourceScenario.observableOracles?.some((item) => item.type === "literal_visible_text" && item.requirement.includes("flujo de autenticación")), "narrative auth text must not become a literal_visible_text oracle");
    node_assert_1.default.ok(!sourceScenario.observedAssertions?.some((item) => item.toLowerCase().includes("flujo de autenticación")), "narrative auth text must not be reported as an observed literal assertion");
});
(0, node_test_1.default)("literally found assertion stays literal_visible_text backed=true", () => {
    const scenario = buildScenario("¿Qué deseas realizar hoy?");
    const caseResult = buildCaseResult({
        status: "discovered_passed",
        steps: [
            {
                index: 2,
                action: "assertVisible",
                status: "found",
                targetText: "¿Qué deseas realizar hoy?",
                matchedText: "¿Qué deseas realizar hoy?",
                assertionStatus: "passed",
            },
        ],
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("¿Qué deseas realizar hoy?"));
    node_assert_1.default.ok(oracle);
    node_assert_1.default.strictEqual(oracle?.type, "literal_visible_text");
    node_assert_1.default.strictEqual(oracle?.backed, true);
});
(0, node_test_1.default)("satisfied_by_previous_assertion without backed evidence is unsupported backed=false", () => {
    const scenario = buildScenario("Se muestra el estado de cuenta.");
    const caseResult = buildCaseResult({
        status: "discovered_partial",
        steps: [
            {
                index: 4,
                action: 'Validar que se muestre "estado de cuenta".',
                status: "satisfied_by_previous_assertion",
                assertionStatus: "satisfied_by_previous_assertion",
                targetText: "estado de cuenta",
            },
        ],
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("estado de cuenta"));
    node_assert_1.default.ok(oracle);
    node_assert_1.default.strictEqual(oracle?.type, "unsupported_or_unresolved");
    node_assert_1.default.strictEqual(oracle?.backed, false);
    node_assert_1.default.ok(!sourceScenario.observableOracles?.some((item) => item.type === "literal_visible_text" && item.requirement.includes("estado de cuenta")));
});
(0, node_test_1.default)("structural post-action assertions inherit only current transition state", () => {
    const scenario = {
        ...buildScenario("Se muestra la pantalla inicial autenticada del aplicativo."),
        steps: [
            { index: 6, action: "Clic en continuar", dataHints: [] },
            { index: 7, action: "Validar que el formulario de acceso ya no sea la pantalla activa", polarity: "negative", dataHints: [] },
            { index: 8, action: "Validar que se muestre la pantalla inicial autenticada del aplicativo", polarity: "positive", dataHints: [] },
        ],
    };
    const result = buildCaseResult({
        status: "discovered_passed",
        steps: [
            { index: 6, action: "click", targetText: "Continuar", status: "found", snapshotUrl: "/dashboard" },
            { index: 7, action: "assert", targetText: "formulario de acceso", status: "satisfied_by_previous_assertion", assertionStatus: "satisfied_by_previous_assertion" },
            { index: 8, action: "assert", targetText: "pantalla inicial autenticada del aplicativo", status: "satisfied_by_previous_assertion", assertionStatus: "satisfied_by_previous_assertion" },
        ],
        runtimeEvidenceTrace: {
            clickActions: [{ stepIndex: 6, target: "Continuar", actionType: "click", success: true, transitionDetected: true, afterUrl: "/dashboard" }],
            fillActions: [], formEvidence: [], confirmationEvidence: [], structuralEvidence: [], feedbackEvidence: [],
        },
    });
    const oracles = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, result).observableOracles ?? [];
    const step8 = oracles.find((oracle) => oracle.stepIndex === 8);
    node_assert_1.default.strictEqual(step8?.type, "navigation_transition");
    node_assert_1.default.strictEqual(step8?.backed, true);
    node_assert_1.default.strictEqual(step8?.details?.sourceActionStepIndex, 6);
    node_assert_1.default.strictEqual(step8?.polarity, "positive");
    const step7 = oracles.find((oracle) => oracle.stepIndex === 7);
    node_assert_1.default.strictEqual(step7?.polarity, "negative");
    const stale = buildCaseResult({
        ...result,
        runtimeEvidenceTrace: { ...result.runtimeEvidenceTrace, clickActions: [{ stepIndex: 6, target: "Continuar", actionType: "click", success: true, transitionDetected: false }] },
    });
    const staleOracle = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, stale).observableOracles?.find((oracle) => oracle.stepIndex === 8);
    node_assert_1.default.strictEqual(staleOracle?.backed, false);
    const arbitrary = (0, case_discovery_workflow_1.buildPromotionSourceScenario)({ ...scenario, raw: { custom_expected: "Debe mostrarse X" } }, result).observableOracles?.find((oracle) => oracle.requirement.includes("Debe mostrarse X"));
    node_assert_1.default.strictEqual(arbitrary?.backed, false);
});
(0, node_test_1.default)("satisfied_by_previous_assertion bookkeeping matchedText does not imply backed literal", () => {
    const scenario = buildScenario("Se muestra el catálogo de productos.");
    const caseResult = buildCaseResult({
        status: "discovered_partial",
        steps: [
            {
                index: 4,
                action: 'Validar que se muestre "catálogo de productos".',
                status: "satisfied_by_previous_assertion",
                assertionStatus: "satisfied_by_previous_assertion",
                targetText: "catálogo de productos",
                matchedText: "Catálogo de productos",
            },
        ],
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("catálogo de productos"));
    node_assert_1.default.ok(oracle);
    node_assert_1.default.strictEqual(oracle?.backed, false);
    node_assert_1.default.ok(!sourceScenario.observableOracles?.some((item) => item.type === "literal_visible_text" && item.requirement.includes("catálogo de productos")), "matchedText carried by status bookkeeping must not synthesize literal_visible_text backed=true");
});
(0, node_test_1.default)("satisfied_by_previous_assertion navigation reconciles to navigation_transition, not literal_visible_text", () => {
    const scenario = buildScenario("La opción pública redirige al módulo de información.");
    const caseResult = buildCaseResult({
        status: "discovered_partial",
        steps: [
            {
                index: 4,
                action: 'Validar que se muestre "redirige al módulo de información".',
                status: "satisfied_by_previous_assertion",
                assertionStatus: "satisfied_by_previous_assertion",
                targetText: "redirige al módulo de información",
            },
        ],
        runtimeEvidenceTrace: {
            clickActions: [
                {
                    stepIndex: 3,
                    target: "Explora nuestros productos",
                    normalizedTarget: "explora nuestros productos",
                    resolvedTarget: "Explora nuestros productos",
                    actionType: "click",
                    success: true,
                    transitionDetected: true,
                }
            ],
            fillActions: [],
            formEvidence: [],
            confirmationEvidence: [],
            structuralEvidence: [],
            feedbackEvidence: [],
        },
    });
    const sourceScenario = (0, case_discovery_workflow_1.buildPromotionSourceScenario)(scenario, caseResult);
    const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("redirige al módulo de información"));
    node_assert_1.default.ok(oracle);
    node_assert_1.default.strictEqual(oracle?.type, "navigation_transition");
    node_assert_1.default.strictEqual(oracle?.backed, true);
    node_assert_1.default.ok(!sourceScenario.observableOracles?.some((item) => item.type === "literal_visible_text" && item.requirement.includes("redirige al módulo de información")));
});
