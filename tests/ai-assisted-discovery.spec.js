"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const ai_explorer_1 = require("../src/ai/ai-explorer");
const ai_assisted_discovery_1 = require("../src/discovery/ai-assisted-discovery");
const target_resolver_1 = require("../src/discovery/target-resolver");
function makeElement(overrides = {}) {
    return {
        id: "candidate-1",
        type: "button",
        text: "Continue",
        role: "button",
        tagName: "BUTTON",
        visible: true,
        candidateLocators: [{ strategy: "text", value: "Continue", confidence: 0.9 }],
        dataHints: [],
        ...overrides
    };
}
function makeSnapshot(elements) {
    return {
        version: "1.0",
        url: "https://example.com",
        title: "Example",
        capturedAt: new Date().toISOString(),
        elements,
        summary: {
            totalElements: elements.length,
            buttons: elements.filter((element) => element.type === "button").length,
            links: elements.filter((element) => element.type === "link").length,
            inputs: elements.filter((element) => element.type === "input").length,
            selects: elements.filter((element) => element.type === "select").length,
            tables: 0,
            dialogs: 0,
            headings: elements.filter((element) => element.type === "heading").length
        }
    };
}
function makeResolution(overrides = {}) {
    return {
        status: "resolved",
        target: "Continue",
        confidence: 0.92,
        matchReason: "exact_match",
        candidateText: "Continue",
        candidates: [
            {
                elementId: "candidate-1",
                text: "Continue",
                normalizedText: "continue",
                type: "button",
                role: "button",
                tagName: "BUTTON",
                isClickable: true,
                matchScore: 0.92,
                matchReason: "exact_match",
                locatorStrategy: "role:button"
            }
        ],
        ...overrides
    };
}
function makeExplorer(output) {
    return new ai_explorer_1.AIExplorer("custom", {
        name: "test-provider",
        async propose() {
            return output;
        }
    });
}
const baseConfig = {
    enabled: true,
    confidenceThreshold: 0.85,
    requireApprovalThreshold: 0.7,
    maxAttempts: 3
};
(0, test_1.test)("IA no se invoca si el resolver deterministico resuelve", () => {
    const result = (0, target_resolver_1.shouldInvokeAiAssistedDiscovery)({
        resolution: makeResolution(),
        confidenceThreshold: 0.85
    });
    (0, test_1.expect)(result.shouldInvoke).toBe(false);
});
(0, test_1.test)("IA no se invoca si AI_DISCOVERY_ENABLED=false aunque resolver haya fallado", () => {
    const result = (0, target_resolver_1.shouldInvokeAiAssistedDiscovery)({
        resolution: makeResolution({ status: "not_found", confidence: 0 }),
        confidenceThreshold: 0.85,
        enabled: false
    });
    (0, test_1.expect)(result.shouldInvoke).toBe(false);
});
(0, test_1.test)("IA no se invoca si deterministico resuelve con alta confianza y AI habilitado", () => {
    const result = (0, target_resolver_1.shouldInvokeAiAssistedDiscovery)({
        resolution: makeResolution({ status: "resolved", confidence: 0.95 }),
        confidenceThreshold: 0.85,
        enabled: true
    });
    (0, test_1.expect)(result.shouldInvoke).toBe(false);
});
(0, test_1.test)("IA se invoca si resolver retorna ambiguous y AI habilitado", () => {
    const result = (0, target_resolver_1.shouldInvokeAiAssistedDiscovery)({
        resolution: makeResolution({ status: "ambiguous", confidence: 0.82 }),
        confidenceThreshold: 0.85,
        enabled: true
    });
    (0, test_1.expect)(result.shouldInvoke).toBe(true);
    (0, test_1.expect)(result.reason).toBe("resolver_ambiguous");
});
(0, test_1.test)("IA se invoca si resolver retorna not_found y AI habilitado", () => {
    const result = (0, target_resolver_1.shouldInvokeAiAssistedDiscovery)({
        resolution: makeResolution({ status: "not_found", confidence: 0 }),
        confidenceThreshold: 0.85,
        enabled: true
    });
    (0, test_1.expect)(result.shouldInvoke).toBe(true);
    (0, test_1.expect)(result.reason).toBe("resolver_not_found");
});
(0, test_1.test)("locator_resolution_failed activa AI-assisted discovery si habilitado", () => {
    const result = (0, target_resolver_1.shouldInvokeAiAssistedDiscovery)({
        resolution: makeResolution({
            status: "locator_resolution_failed",
            confidence: 0.92,
            attemptedLocators: ["getByRole(button, candidateText:Continue)"]
        }),
        confidenceThreshold: 0.85,
        enabled: true
    });
    (0, test_1.expect)(result.shouldInvoke).toBe(true);
    (0, test_1.expect)(result.reason).toBe("locator_resolution_failed");
});
(0, test_1.test)("propuesta con candidateId inexistente se rechaza", () => {
    const validation = (0, ai_assisted_discovery_1.validateAiProposal)({
        action: "click",
        candidateId: "missing",
        target: "Continue",
        confidence: 0.91,
        reason: "Try this button",
        alternatives: [],
        risk: "Low",
        requiresHumanApproval: false
    }, {
        currentGoal: "Navigate",
        currentStep: "Click continue",
        target: "Continue",
        snapshot: makeSnapshot([makeElement({ id: "candidate-1" })]),
        resolution: makeResolution({ status: "not_found" }),
        previousSteps: [],
        allowedActions: ["click"],
        constraints: [],
        triggerReason: "resolver_not_found"
    }, baseConfig);
    (0, test_1.expect)(validation.valid).toBe(false);
    (0, test_1.expect)(validation.requiresApproval).toBe(false);
    (0, test_1.expect)(validation.reason).toContain("was not found");
});
(0, test_1.test)("propuesta con accion no permitida se rechaza", () => {
    const validation = (0, ai_assisted_discovery_1.validateAiProposal)({
        action: "fill",
        candidateId: "candidate-1",
        target: "Continue",
        confidence: 0.91,
        reason: "Fill the field",
        alternatives: [],
        risk: "Low",
        requiresHumanApproval: false
    }, {
        currentGoal: "Navigate",
        currentStep: "Click continue",
        target: "Continue",
        snapshot: makeSnapshot([makeElement()]),
        resolution: makeResolution({ status: "ambiguous" }),
        previousSteps: [],
        allowedActions: ["click"],
        constraints: [],
        triggerReason: "resolver_ambiguous"
    }, baseConfig);
    (0, test_1.expect)(validation.valid).toBe(false);
    (0, test_1.expect)(validation.reason).toContain("not allowed");
});
(0, test_1.test)("propuesta valida se ejecuta via framework, no por IA", async () => {
    let executed = false;
    const outcome = await (0, ai_assisted_discovery_1.runAiAssistedDiscovery)({
        currentGoal: "Navigate",
        currentStep: "Click continue",
        target: "Continue",
        snapshot: makeSnapshot([makeElement()]),
        resolution: makeResolution({ status: "ambiguous", confidence: 0.83 }),
        previousSteps: [],
        allowedActions: ["click", "wait", "stop"],
        constraints: [],
        triggerReason: "resolver_ambiguous"
    }, {
        explorer: makeExplorer({
            action: "click",
            candidateId: "candidate-1",
            target: "Continue",
            confidence: 0.91,
            reason: "Primary CTA is the best match",
            alternatives: [],
            risk: "Low",
            requiresHumanApproval: false
        }),
        config: baseConfig,
        async executeProposal() {
            executed = true;
            return {
                success: true,
                transitionDetected: true,
                evidencePath: ".artifacts/discovery/step-1-ai-assisted.json"
            };
        }
    });
    (0, test_1.expect)(executed).toBe(true);
    (0, test_1.expect)(outcome.status).toBe("executed");
});
(0, test_1.test)("attemptedLocators y candidate diagnostics se pasan a la IA", async () => {
    let receivedAttemptedLocators;
    let receivedDiagnostics;
    const outcome = await (0, ai_assisted_discovery_1.runAiAssistedDiscovery)({
        currentGoal: "Navigate",
        currentStep: "Click continue",
        target: "Continue",
        snapshot: makeSnapshot([makeElement()]),
        resolution: {
            ...makeResolution({
                status: "locator_resolution_failed",
                confidence: 0.91,
                attemptedLocators: ["getByRole(button, candidateText:Continue)"]
            }),
            _diagnosis: [{ rejectionReason: "locator_resolution_failed" }]
        },
        previousSteps: [],
        allowedActions: ["click"],
        constraints: [],
        triggerReason: "locator_resolution_failed"
    }, {
        explorer: new ai_explorer_1.AIExplorer("custom", {
            name: "capture-provider",
            async propose(input) {
                receivedAttemptedLocators = input.attemptedLocators;
                receivedDiagnostics = input.candidateDiagnostics;
                return {
                    action: "click",
                    candidateId: "candidate-1",
                    target: "Continue",
                    confidence: 0.91,
                    reason: "Use the existing button",
                    alternatives: [],
                    risk: "Low",
                    requiresHumanApproval: false
                };
            }
        }),
        config: baseConfig,
        async executeProposal() {
            return { success: true };
        }
    });
    (0, test_1.expect)(outcome.status).toBe("executed");
    (0, test_1.expect)(receivedAttemptedLocators).toEqual(["getByRole(button, candidateText:Continue)"]);
    (0, test_1.expect)(receivedDiagnostics).toEqual([{ rejectionReason: "locator_resolution_failed" }]);
});
(0, test_1.test)("IA no modifica registry estable", async () => {
    const outcome = await (0, ai_assisted_discovery_1.runAiAssistedDiscovery)({
        currentGoal: "Navigate",
        currentStep: "Click continue",
        target: "Continue",
        snapshot: makeSnapshot([makeElement()]),
        resolution: makeResolution({ status: "not_found" }),
        previousSteps: [],
        allowedActions: ["click"],
        constraints: ["forbid stable registry mutation"],
        triggerReason: "resolver_not_found"
    }, {
        explorer: makeExplorer({
            action: "click",
            candidateId: "candidate-1",
            target: "Continue",
            confidence: 0.9,
            reason: "Use the button",
            alternatives: [],
            risk: "Low",
            requiresHumanApproval: false
        }),
        config: baseConfig,
        async executeProposal() {
            return {
                success: true
            };
        }
    });
    (0, test_1.expect)(outcome.status).toBe("executed");
});
(0, test_1.test)("objetos descubiertos quedan en pending", async () => {
    const outcome = await (0, ai_assisted_discovery_1.runAiAssistedDiscovery)({
        currentGoal: "Navigate",
        currentStep: "Click continue",
        target: "Continue",
        snapshot: makeSnapshot([makeElement()]),
        resolution: makeResolution({ status: "not_found" }),
        previousSteps: [],
        allowedActions: ["click"],
        constraints: [],
        triggerReason: "resolver_not_found"
    }, {
        explorer: makeExplorer({
            action: "click",
            candidateId: "candidate-1",
            target: "Continue",
            confidence: 0.95,
            reason: "Use the CTA button",
            alternatives: [],
            risk: "Low",
            requiresHumanApproval: false
        }),
        config: baseConfig,
        async executeProposal() {
            return {
                success: true,
                transitionDetected: true
            };
        }
    });
    (0, test_1.expect)(outcome.status).toBe("executed");
    if (outcome.status === "executed") {
        (0, test_1.expect)(outcome.pending).toBe(true);
    }
});
(0, test_1.test)("C37750 como regresion: si resolver falla, IA puede proponer el boton accionable correcto a partir del snapshot", async () => {
    const outcome = await (0, ai_assisted_discovery_1.runAiAssistedDiscovery)({
        currentGoal: "Consulta listado de tarjetas de credito",
        currentStep: "Clic en 'Tarjeta de Credito'.",
        target: "Tarjeta de Credito",
        snapshot: makeSnapshot([
            makeElement({
                id: "heading-1",
                type: "heading",
                text: "Tarjeta de Credito",
                tagName: "H2",
                role: undefined
            }),
            makeElement({
                id: "button-1",
                text: "Tarjeta de Credito Ver detalle",
                role: "button",
                tagName: "BUTTON"
            })
        ]),
        resolution: makeResolution({
            status: "not_found",
            confidence: 0,
            candidates: [
                {
                    elementId: "heading-1",
                    text: "Tarjeta de Credito",
                    normalizedText: "tarjeta de credito",
                    type: "heading",
                    tagName: "H2",
                    isClickable: false,
                    matchScore: 1,
                    matchReason: "exact_match",
                    locatorStrategy: "text"
                },
                {
                    elementId: "button-1",
                    text: "Tarjeta de Credito Ver detalle",
                    normalizedText: "tarjeta de credito ver detalle",
                    type: "button",
                    role: "button",
                    tagName: "BUTTON",
                    isClickable: true,
                    matchScore: 0.88,
                    matchReason: "contains_match",
                    locatorStrategy: "role:button"
                }
            ]
        }),
        previousSteps: [],
        allowedActions: ["click"],
        constraints: [],
        triggerReason: "resolver_not_found"
    }, {
        explorer: makeExplorer({
            action: "click",
            candidateId: "button-1",
            target: "Tarjeta de Credito",
            confidence: 0.9,
            reason: "The heading is not actionable; the button is.",
            alternatives: [],
            risk: "Low",
            requiresHumanApproval: false
        }),
        config: baseConfig,
        async executeProposal(_proposal, element) {
            return {
                success: element?.id === "button-1",
                transitionDetected: true
            };
        }
    });
    (0, test_1.expect)(outcome.status).toBe("executed");
});
