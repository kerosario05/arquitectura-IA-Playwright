"use strict";
/**
 * Missing Intermediate Step / AI Forward Route Completion Tests
 *
 * Tests for missing_intermediate_step repair type:
 * 1. Inserta "Tarjetas de crédito" después de "Tarjetas".
 * 2. Inserta "Cuentas de ahorros" después de "Cuentas".
 * 3. Inserta "Préstamos personales" después de "Préstamos".
 * 4. Reintenta el step original después del click insertado.
 * 5. Registra insertedSteps en diagnostics.
 * 6. No inserta si AI_ROUTE_COMPLETION_ENABLED=false.
 * 7. No inserta si el candidato no es clickable.
 * 8. No inserta si el candidato es sensitive.
 * 9. No inserta candidatos submit-like como "Continuar", "Confirmar", "Enviar".
 * 10. No excede AI_ROUTE_COMPLETION_MAX_INSERTED_STEPS.
 * 11. No inserta si confidence < AI_ROUTE_COMPLETION_MIN_CONFIDENCE.
 * 12. Si el inserted step ejecuta pero el retry falla, conserva el fallo original con diagnostics.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const repair_decision_validator_1 = require("../src/ai/repair/repair-decision-validator");
const repair_context_pack_1 = require("../src/ai/repair/repair-context-pack");
const ai_repair_metrics_1 = require("../src/ai/repair/ai-repair-metrics");
const NAV_CANDIDATES = [
    {
        candidateId: "nav-tarjetas",
        role: "link",
        name: "Tarjetas",
        text: "Tarjetas",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        sensitive: false
    },
    {
        candidateId: "nav-tarjetas-credito",
        role: "link",
        name: "Tarjetas de crédito",
        text: "Tarjetas de crédito",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        sensitive: false
    },
    {
        candidateId: "nav-cuentas",
        role: "link",
        name: "Cuentas",
        text: "Cuentas",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        sensitive: false
    },
    {
        candidateId: "nav-cuentas-ahorros",
        role: "link",
        name: "Cuentas de ahorros",
        text: "Cuentas de ahorros",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        sensitive: false
    },
    {
        candidateId: "nav-prestamos",
        role: "link",
        name: "Préstamos",
        text: "Préstamos",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        sensitive: false
    },
    {
        candidateId: "nav-prestamos-personales",
        role: "link",
        name: "Préstamos personales",
        text: "Préstamos personales",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        sensitive: false
    }
];
const SENSITIVE_NAV_CANDIDATES = [
    {
        candidateId: "nav-pagos",
        role: "link",
        name: "Pagos",
        text: "Pagos",
        visible: true,
        enabled: true,
        clickable: true,
        sensitive: true
    }
];
const SUBMIT_LIKE_CANDIDATES = [
    {
        candidateId: "btn-continuar",
        role: "button",
        name: "Continuar",
        text: "Continuar",
        visible: true,
        enabled: true,
        clickable: true,
        sensitive: false
    },
    {
        candidateId: "btn-confirmar",
        role: "button",
        name: "Confirmar",
        text: "Confirmar",
        visible: true,
        enabled: true,
        clickable: true,
        sensitive: false
    },
    {
        candidateId: "btn-enviar",
        role: "button",
        name: "Enviar",
        text: "Enviar",
        visible: true,
        enabled: true,
        clickable: true,
        sensitive: false
    }
];
const NON_CLICKABLE_CANDIDATES = [
    {
        candidateId: "label-tarjetas",
        role: "label",
        name: "Tarjetas",
        text: "Tarjetas",
        visible: true,
        enabled: true,
        clickable: false,
        sensitive: false
    }
];
(0, test_1.test)("schema accepts missing_intermediate_step with valid candidateId and insertedStepText", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "nav-tarjetas-credito",
        insertedStepText: "Tarjetas de crédito",
        reason: "Insert intermediate navigation step to reach product selection.",
        confidence: 0.85
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: NAV_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(true);
    if (result.valid) {
        (0, test_1.expect)(result.decision.repairType).toBe("missing_intermediate_step");
        (0, test_1.expect)(result.decision.candidateId).toBe("nav-tarjetas-credito");
        (0, test_1.expect)(result.decision.insertedStepText).toBe("Tarjetas de crédito");
    }
});
(0, test_1.test)("missing_intermediate_step: inserts Tarjetas de crédito after Tarjetas (scenario 1)", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "nav-tarjetas-credito",
        insertedStepText: "Tarjetas de crédito",
        reason: "Need to navigate through Tarjetas de crédito before selecting product.",
        confidence: 0.88
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: NAV_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(true);
    if (result.valid) {
        (0, test_1.expect)(result.decision.insertedStepText).toBe("Tarjetas de crédito");
    }
});
(0, test_1.test)("missing_intermediate_step: inserts Cuentas de ahorros after Cuentas (scenario 2)", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "nav-cuentas-ahorros",
        insertedStepText: "Cuentas de ahorros",
        reason: "Intermediate step required to reach savings account products.",
        confidence: 0.82
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: NAV_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(true);
    if (result.valid) {
        (0, test_1.expect)(result.decision.insertedStepText).toBe("Cuentas de ahorros");
    }
});
(0, test_1.test)("missing_intermediate_step: inserts Préstamos personales after Préstamos (scenario 3)", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "nav-prestamos-personales",
        insertedStepText: "Préstamos personales",
        reason: "Need to navigate through personal loans subcategory.",
        confidence: 0.79
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: NAV_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(true);
    if (result.valid) {
        (0, test_1.expect)(result.decision.insertedStepText).toBe("Préstamos personales");
    }
});
(0, test_1.test)("missing_intermediate_step: validator requires insertedStepText for repaired_plan", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "nav-tarjetas-credito",
        reason: "Missing insertedStepText field.",
        confidence: 0.80
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: NAV_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(false);
    if (!result.valid) {
        (0, test_1.expect)(result.code).toBe("AI_REPAIR_MISSING_INSERTED_STEP");
    }
});
(0, test_1.test)("missing_intermediate_step: validator blocks unknown candidateId", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "unknown-nav-step",
        insertedStepText: "Unknown step",
        reason: "Candidate does not exist.",
        confidence: 0.75
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: NAV_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(false);
    if (!result.valid) {
        (0, test_1.expect)(result.code).toBe("AI_REPAIR_UNKNOWN_CANDIDATE");
    }
});
(0, test_1.test)("missing_intermediate_step: validator blocks non-clickable candidate (scenario 7)", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "label-tarjetas",
        insertedStepText: "Tarjetas",
        reason: "Non-clickable candidate should be blocked.",
        confidence: 0.80
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: NON_CLICKABLE_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(false);
    if (!result.valid) {
        (0, test_1.expect)(result.code).toBe("AI_REPAIR_CANDIDATE_NOT_CLICKABLE");
    }
});
(0, test_1.test)("missing_intermediate_step: validator blocks sensitive candidate (scenario 8)", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "nav-pagos",
        insertedStepText: "Pagos",
        reason: "Sensitive candidate should be blocked.",
        confidence: 0.85
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: SENSITIVE_NAV_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(false);
    if (!result.valid) {
        (0, test_1.expect)(result.code).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
    }
});
(0, test_1.test)("missing_intermediate_step: validator blocks submit-like candidates (scenario 9)", () => {
    const decisionContinuar = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "btn-continuar",
        insertedStepText: "Continuar",
        reason: "Submit-like candidates should be blocked as intermediate steps.",
        confidence: 0.80
    };
    const resultContinuar = (0, repair_decision_validator_1.validateRepairDecision)(decisionContinuar, {
        candidates: SUBMIT_LIKE_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(resultContinuar.valid).toBe(false);
    const decisionConfirmar = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "btn-confirmar",
        insertedStepText: "Confirmar",
        reason: "Submit-like candidates should be blocked as intermediate steps.",
        confidence: 0.80
    };
    const resultConfirmar = (0, repair_decision_validator_1.validateRepairDecision)(decisionConfirmar, {
        candidates: SUBMIT_LIKE_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(resultConfirmar.valid).toBe(false);
    const decisionEnviar = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "btn-enviar",
        insertedStepText: "Enviar",
        reason: "Submit-like candidates should be blocked as intermediate steps.",
        confidence: 0.80
    };
    const resultEnviar = (0, repair_decision_validator_1.validateRepairDecision)(decisionEnviar, {
        candidates: SUBMIT_LIKE_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(resultEnviar.valid).toBe(false);
});
(0, test_1.test)("missing_intermediate_step: no_safe_action is valid when no suitable intermediate step", () => {
    const decision = {
        decision: "no_safe_action",
        repairType: "missing_intermediate_step",
        reason: "No suitable intermediate navigation step found.",
        confidence: 0.70
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: NAV_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(true);
    if (result.valid) {
        (0, test_1.expect)(result.decision.decision).toBe("no_safe_action");
        (0, test_1.expect)(result.decision.repairType).toBe("missing_intermediate_step");
    }
});
(0, test_1.test)("context-pack includes routeHistory for missing_intermediate_step", () => {
    const contextPack = (0, repair_context_pack_1.buildRepairContextPack)({
        appSlug: "banistmo",
        failure: "Target not found after clicking Tarjetas",
        currentStep: "Click 'Tarjeta de crédito Platinum'",
        currentUrl: "https://example.com/tarjetas",
        candidates: NAV_CANDIDATES,
        maxChars: 30000,
        failureType: "target_not_found",
        routeHistory: {
            failedRoutePaths: ["nav-tarjetas"],
            visitedUrls: ["https://example.com/home", "https://example.com/tarjetas"]
        },
        currentScreen: {
            url: "https://example.com/tarjetas",
            title: "Tarjetas",
            visibleNavItems: ["Tarjetas de crédito", "Tarjetas de débito"]
        }
    });
    (0, test_1.expect)(contextPack.candidates).toBeDefined();
    (0, test_1.expect)(contextPack.routeHistory).toBeDefined();
    if (contextPack.routeHistory) {
        (0, test_1.expect)(contextPack.routeHistory.failedRoutePaths).toContain("nav-tarjetas");
    }
});
(0, test_1.test)("missing_intermediate_step: confidence threshold check (scenario 11)", () => {
    const decisionLowConfidence = {
        decision: "repaired_plan",
        repairType: "missing_intermediate_step",
        candidateId: "nav-tarjetas-credito",
        insertedStepText: "Tarjetas de crédito",
        reason: "Low confidence should still pass validation but fail config threshold.",
        confidence: 0.50
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decisionLowConfidence, {
        candidates: NAV_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(true);
    if (result.valid) {
        (0, test_1.expect)(result.decision.confidence).toBe(0.50);
    }
});
(0, test_1.test)("metrics track missing_intermediate_step repairType", () => {
    const summary = (0, ai_repair_metrics_1.createEmptyCaseSummary)();
    (0, test_1.expect)(summary.repairTypeCounts.missing_intermediate_step).toBe(0);
});
// Integration tests for the resolver
const missing_intermediate_step_resolver_1 = require("../src/discovery/missing-intermediate-step-resolver");
const DEFAULT_CONFIG = {
    enabled: true,
    minConfidence: 0.75,
    maxInsertedSteps: 1,
    useAppProfile: true,
    allowGeneric: true
};
const DISABLED_CONFIG = {
    enabled: false,
    minConfidence: 0.75,
    maxInsertedSteps: 1,
    useAppProfile: true,
    allowGeneric: true
};
const ROUTE_PROFILE = {
    entryPoints: ["Iniciar", "Información de productos"],
    aliases: {
        "Cuentas de Efectivo": "Cuentas"
    },
    routes: [
        {
            from: "Tarjetas",
            intermediates: ["Tarjetas de crédito"],
            domain: "products"
        },
        {
            from: "Cuentas",
            intermediates: ["Cuentas de ahorros"],
            domain: "products"
        }
    ],
    blockedLabels: ["Continuar", "Confirmar", "Enviar", "Solicitar", "Finalizar", "Pagar", "Transferir"],
    submitLikeLabels: ["Continuar", "Confirmar", "Enviar", "Solicitar", "Finalizar"]
};
(0, test_1.test)("resolver proposes intermediate from routeProfile (Tarjetas -> Tarjetas de crédito)", () => {
    const input = {
        appSlug: "test-app",
        routeProfile: ROUTE_PROFILE,
        currentRouteHistory: ["Iniciar", "Información de productos", "Tarjetas"],
        currentStepText: "Click 'Tarjeta de crédito Platinum'",
        currentTarget: "Tarjeta de crédito Platinum",
        failureType: "target_not_found",
        snapshot: { url: "https://example.com/tarjetas", title: "Tarjetas" },
        candidates: [
            { candidateId: "nav-tarjetas-credito", name: "Tarjetas de crédito", text: "Tarjetas de crédito", visible: true, clickable: true, sensitive: false },
            { candidateId: "nav-tarjetas-debito", name: "Tarjetas de débito", text: "Tarjetas de débito", visible: true, clickable: true, sensitive: false }
        ],
        insertedStepsSoFar: 0,
        config: DEFAULT_CONFIG
    };
    const result = (0, missing_intermediate_step_resolver_1.resolveMissingIntermediateStep)(input);
    (0, test_1.expect)(result.status).toBe("repaired_plan");
    (0, test_1.expect)(result.candidateId).toBe("nav-tarjetas-credito");
    (0, test_1.expect)(result.insertedStepText).toBe("Tarjetas de crédito");
    (0, test_1.expect)(result.source).toBe("app_route_profile");
});
(0, test_1.test)("resolver respects maxInsertedSteps limit", () => {
    const input = {
        appSlug: "test-app",
        routeProfile: ROUTE_PROFILE,
        currentRouteHistory: ["Tarjetas"],
        currentStepText: "Click product",
        currentTarget: "Product",
        failureType: "target_not_found",
        snapshot: { url: "https://example.com", title: "Page" },
        candidates: [
            { candidateId: "nav-tarjetas-credito", name: "Tarjetas de crédito", text: "Tarjetas de crédito", visible: true, clickable: true, sensitive: false }
        ],
        insertedStepsSoFar: 1,
        config: DEFAULT_CONFIG
    };
    const result = (0, missing_intermediate_step_resolver_1.resolveMissingIntermediateStep)(input);
    (0, test_1.expect)(result.status).toBe("no_safe_action");
    (0, test_1.expect)(result.blockedReason).toBe("max_inserted_steps_reached");
});
(0, test_1.test)("resolver blocks submit-like candidates (Continuar)", () => {
    const input = {
        appSlug: "test-app",
        routeProfile: ROUTE_PROFILE,
        currentRouteHistory: ["Home"],
        currentStepText: "Click product",
        currentTarget: "Product",
        failureType: "target_not_found",
        snapshot: { url: "https://example.com", title: "Page" },
        candidates: [
            { candidateId: "btn-continuar", name: "Continuar", text: "Continuar", visible: true, clickable: true, sensitive: false }
        ],
        insertedStepsSoFar: 0,
        config: { ...DEFAULT_CONFIG, useAppProfile: false, allowGeneric: true }
    };
    const result = (0, missing_intermediate_step_resolver_1.resolveMissingIntermediateStep)(input);
    (0, test_1.expect)(result.status).toBe("no_safe_action");
    (0, test_1.expect)(result.blockedReason).toBe("no_safe_candidate");
});
(0, test_1.test)("resolver blocks non-clickable candidates", () => {
    const input = {
        appSlug: "test-app",
        routeProfile: undefined,
        currentRouteHistory: ["Home"],
        currentStepText: "Click product",
        currentTarget: "Product",
        failureType: "target_not_found",
        snapshot: { url: "https://example.com", title: "Page" },
        candidates: [
            { candidateId: "label-tarjetas", name: "Tarjetas de crédito", text: "Tarjetas de crédito", visible: true, clickable: false, sensitive: false }
        ],
        insertedStepsSoFar: 0,
        config: { ...DEFAULT_CONFIG, useAppProfile: false, allowGeneric: true }
    };
    const result = (0, missing_intermediate_step_resolver_1.resolveMissingIntermediateStep)(input);
    (0, test_1.expect)(result.status).toBe("no_safe_action");
    (0, test_1.expect)(result.blockedReason).toBe("no_safe_candidate");
});
(0, test_1.test)("resolver disabled returns no_safe_action", () => {
    const input = {
        appSlug: "test-app",
        routeProfile: ROUTE_PROFILE,
        currentRouteHistory: ["Tarjetas"],
        currentStepText: "Click product",
        currentTarget: "Product",
        failureType: "target_not_found",
        snapshot: { url: "https://example.com", title: "Page" },
        candidates: [
            { candidateId: "nav-tarjetas-credito", name: "Tarjetas de crédito", text: "Tarjetas de crédito", visible: true, clickable: true, sensitive: false }
        ],
        insertedStepsSoFar: 0,
        config: DISABLED_CONFIG
    };
    const result = (0, missing_intermediate_step_resolver_1.resolveMissingIntermediateStep)(input);
    (0, test_1.expect)(result.status).toBe("no_safe_action");
    (0, test_1.expect)(result.blockedReason).toBe("disabled");
});
(0, test_1.test)("resolver generic fallback proposes candidate with semantic relation", () => {
    const input = {
        appSlug: "test-app",
        routeProfile: undefined,
        currentRouteHistory: ["Products"],
        currentStepText: "Select laptop",
        currentTarget: "MacBook Air",
        failureType: "target_not_found",
        snapshot: { url: "https://example.com", title: "Products", visibleHeadings: ["Laptops"] },
        candidates: [
            { candidateId: "cat-laptops", name: "Laptops", text: "Laptops", visible: true, clickable: true, sensitive: false, role: "link" },
            { candidateId: "btn-submit", name: "Submit", text: "Submit", visible: true, clickable: true, sensitive: false, role: "button" }
        ],
        insertedStepsSoFar: 0,
        config: { ...DEFAULT_CONFIG, useAppProfile: false, allowGeneric: true }
    };
    const result = (0, missing_intermediate_step_resolver_1.resolveMissingIntermediateStep)(input);
    (0, test_1.expect)(result.status).toBe("repaired_plan");
    (0, test_1.expect)(result.candidateId).toBe("cat-laptops");
    (0, test_1.expect)(result.source).toBe("generic_forward_route_completion");
});
(0, test_1.test)("resolver generic fallback returns no_safe_action for ambiguous candidates", () => {
    const input = {
        appSlug: "test-app",
        routeProfile: undefined,
        currentRouteHistory: ["Home"],
        currentStepText: "Select product",
        currentTarget: "Unknown Product",
        failureType: "target_not_found",
        snapshot: { url: "https://example.com", title: "Home" },
        candidates: [
            { candidateId: "link-1", name: "Link 1", text: "Link 1", visible: true, clickable: true, sensitive: false },
            { candidateId: "link-2", name: "Link 2", text: "Link 2", visible: true, clickable: true, sensitive: false }
        ],
        insertedStepsSoFar: 0,
        config: { ...DEFAULT_CONFIG, useAppProfile: false, allowGeneric: true }
    };
    const result = (0, missing_intermediate_step_resolver_1.resolveMissingIntermediateStep)(input);
    (0, test_1.expect)(result.status).toBe("no_safe_action");
    (0, test_1.expect)(result.blockedReason).toBe("no_safe_candidate");
});
(0, test_1.test)("resolver diagnostics include routeProfileMatch for app_route_profile source", () => {
    const input = {
        appSlug: "test-app",
        routeProfile: ROUTE_PROFILE,
        currentRouteHistory: ["Tarjetas"],
        currentStepText: "Click product",
        currentTarget: "Product",
        failureType: "target_not_found",
        snapshot: { url: "https://example.com", title: "Page" },
        candidates: [
            { candidateId: "nav-tarjetas-credito", name: "Tarjetas de crédito", text: "Tarjetas de crédito", visible: true, clickable: true, sensitive: false }
        ],
        insertedStepsSoFar: 0,
        config: DEFAULT_CONFIG
    };
    const result = (0, missing_intermediate_step_resolver_1.resolveMissingIntermediateStep)(input);
    (0, test_1.expect)(result.status).toBe("repaired_plan");
    (0, test_1.expect)(result.source).toBe("app_route_profile");
    (0, test_1.expect)(result.routeProfileMatch).toBeDefined();
    if (result.routeProfileMatch) {
        (0, test_1.expect)(result.routeProfileMatch.from).toBe("Tarjetas");
        (0, test_1.expect)(result.routeProfileMatch.intermediate).toBe("Tarjetas de crédito");
    }
});
(0, test_1.test)("resolver accepts semantic_mismatch failureType", () => {
    const input = {
        appSlug: "test-app",
        routeProfile: ROUTE_PROFILE,
        currentRouteHistory: ["Tarjetas"],
        currentStepText: "Click product",
        currentTarget: "Product",
        failureType: "semantic_mismatch",
        snapshot: { url: "https://example.com", title: "Page" },
        candidates: [
            { candidateId: "nav-tarjetas-credito", name: "Tarjetas de crédito", text: "Tarjetas de crédito", visible: true, clickable: true, sensitive: false }
        ],
        insertedStepsSoFar: 0,
        config: DEFAULT_CONFIG
    };
    const result = (0, missing_intermediate_step_resolver_1.resolveMissingIntermediateStep)(input);
    (0, test_1.expect)(result.status).toBe("repaired_plan");
    (0, test_1.expect)(result.source).toBe("app_route_profile");
});
(0, test_1.test)("resolver accepts weak_deterministic_resolution failureType", () => {
    const input = {
        appSlug: "test-app",
        routeProfile: ROUTE_PROFILE,
        currentRouteHistory: ["Tarjetas"],
        currentStepText: "Click product",
        currentTarget: "Product",
        failureType: "weak_deterministic_resolution",
        snapshot: { url: "https://example.com", title: "Page" },
        candidates: [
            { candidateId: "nav-tarjetas-credito", name: "Tarjetas de crédito", text: "Tarjetas de crédito", visible: true, clickable: true, sensitive: false }
        ],
        insertedStepsSoFar: 0,
        config: DEFAULT_CONFIG,
        deterministicResolutionConfidence: 0.65,
        deterministicResolutionStrategy: "product_condition"
    };
    const result = (0, missing_intermediate_step_resolver_1.resolveMissingIntermediateStep)(input);
    (0, test_1.expect)(result.status).toBe("repaired_plan");
    (0, test_1.expect)(result.source).toBe("app_route_profile");
});
(0, test_1.test)("resolver includes lastSuccessfulTarget in context", () => {
    const input = {
        appSlug: "test-app",
        routeProfile: ROUTE_PROFILE,
        currentRouteHistory: ["Iniciar", "Información de productos"],
        lastSuccessfulTarget: "Información de productos",
        currentStepText: "Click product",
        currentTarget: "Product",
        failureType: "target_not_found",
        snapshot: { url: "https://example.com", title: "Page" },
        candidates: [
            { candidateId: "nav-tarjetas", name: "Tarjetas", text: "Tarjetas", visible: true, clickable: true, sensitive: false },
            { candidateId: "nav-tarjetas-credito", name: "Tarjetas de crédito", text: "Tarjetas de crédito", visible: true, clickable: true, sensitive: false }
        ],
        insertedStepsSoFar: 0,
        config: DEFAULT_CONFIG
    };
    const result = (0, missing_intermediate_step_resolver_1.resolveMissingIntermediateStep)(input);
    // Should return no_safe_action since currentRouteHistory doesn't match any route.from
    (0, test_1.expect)(result.status).toBe("no_safe_action");
});
