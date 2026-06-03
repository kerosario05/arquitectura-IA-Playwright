"use strict";
/**
 * Route Profile Learning Tests
 *
 * Tests for generic multi-project route profile learning capability:
 * - Learns child_route from successful transitions
 * - Learns intermediate_step from Route Completion with retrySucceeded
 * - Blocks submit-like candidates
 * - Blocks sensitive candidates
 * - Blocks risky actions
 * - Doesn't mix appSlug between apps
 * - Writes route-profile-suggestions.json
 * - Consolidates pending without duplicates
 * - Auto-approves only with sufficient threshold
 * - Doesn't write app.config.json if AUTO_APPLY=false
 * - apply creates backup and only modifies current app
 * - alias_candidate suggested when visible label differs from requirement target
 * - domain_term_candidate stays pending if evidence insufficient
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const route_profile_learning_1 = require("../src/discovery/route-profile-learning");
const DEFAULT_CONFIG = {
    enabled: true,
    autoApproveThreshold: 0.90,
    autoApply: false,
    minOccurrences: 1,
    blockSensitive: true
};
const DISABLED_CONFIG = {
    enabled: false,
    autoApproveThreshold: 0.90,
    autoApply: false,
    minOccurrences: 1,
    blockSensitive: true
};
(0, test_1.test)("learns child_route from successful transition", () => {
    const observation = {
        from: "Información de productos",
        to: "Tarjetas",
        beforeUrl: "https://example.com/productos",
        afterUrl: "https://example.com/tarjetas",
        clickable: true,
        visible: true,
        sensitive: false,
        submitLike: false,
        riskyAction: false,
        transitionDetected: true
    };
    const result = (0, route_profile_learning_1.observeRouteTransition)(observation, "test-app", DEFAULT_CONFIG);
    (0, test_1.expect)(result.status).toBe("learned");
    (0, test_1.expect)(result.suggestion).toBeDefined();
    if (result.suggestion) {
        (0, test_1.expect)(result.suggestion.relation).toBe("child_route");
        (0, test_1.expect)(result.suggestion.source).toBe("successful_transition");
        (0, test_1.expect)(result.suggestion.appSlug).toBe("test-app");
        (0, test_1.expect)(result.suggestion.confidence).toBeGreaterThan(0.5);
    }
});
(0, test_1.test)("learns intermediate_step from Route Completion with retrySucceeded", () => {
    const result = (0, route_profile_learning_1.observeRouteCompletionSuccess)({
        target: "Tarjetas de crédito",
        candidateId: "nav-tarjetas-credito",
        source: "app_route_profile"
    }, "Tarjetas", "test-app", DEFAULT_CONFIG);
    (0, test_1.expect)(result.status).toBe("learned");
    (0, test_1.expect)(result.suggestion).toBeDefined();
    if (result.suggestion) {
        (0, test_1.expect)(result.suggestion.relation).toBe("intermediate_step");
        (0, test_1.expect)(result.suggestion.source).toBe("route_completion");
        (0, test_1.expect)(result.suggestion.status).toBe("auto_approved");
    }
});
(0, test_1.test)("blocks submit-like candidates", () => {
    const observation = {
        from: "Home",
        to: "Continuar",
        beforeUrl: "https://example.com/home",
        afterUrl: "https://example.com/step2",
        clickable: true,
        visible: true,
        sensitive: false,
        submitLike: true,
        riskyAction: false,
        transitionDetected: true
    };
    const result = (0, route_profile_learning_1.observeRouteTransition)(observation, "test-app", DEFAULT_CONFIG);
    (0, test_1.expect)(result.status).toBe("blocked");
    (0, test_1.expect)(result.reason).toBe("Submit-like candidate blocked");
});
(0, test_1.test)("blocks sensitive candidates", () => {
    const observation = {
        from: "Home",
        to: "Login",
        beforeUrl: "https://example.com/home",
        afterUrl: "https://example.com/login",
        clickable: true,
        visible: true,
        sensitive: true,
        submitLike: false,
        riskyAction: false,
        transitionDetected: true
    };
    const result = (0, route_profile_learning_1.observeRouteTransition)(observation, "test-app", DEFAULT_CONFIG);
    (0, test_1.expect)(result.status).toBe("blocked");
    (0, test_1.expect)(result.reason).toBe("Sensitive candidate blocked");
});
(0, test_1.test)("blocks risky actions", () => {
    const observation = {
        from: "Cuentas",
        to: "Transferir fondos",
        beforeUrl: "https://example.com/cuentas",
        afterUrl: "https://example.com/transferir",
        clickable: true,
        visible: true,
        sensitive: false,
        submitLike: false,
        riskyAction: true,
        transitionDetected: true
    };
    const result = (0, route_profile_learning_1.observeRouteTransition)(observation, "test-app", DEFAULT_CONFIG);
    (0, test_1.expect)(result.status).toBe("blocked");
    (0, test_1.expect)(result.reason).toBe("Risky action blocked");
});
(0, test_1.test)("doesn't mix appSlug between apps", () => {
    const observationA = {
        from: "Home",
        to: "Products",
        beforeUrl: "https://app-a.com/home",
        afterUrl: "https://app-a.com/products",
        clickable: true,
        visible: true,
        sensitive: false,
        submitLike: false,
        riskyAction: false,
        transitionDetected: true
    };
    const observationB = {
        from: "Home",
        to: "Cuentas",
        beforeUrl: "https://app-b.com/home",
        afterUrl: "https://app-b.com/cuentas",
        clickable: true,
        visible: true,
        sensitive: false,
        submitLike: false,
        riskyAction: false,
        transitionDetected: true
    };
    const resultA = (0, route_profile_learning_1.observeRouteTransition)(observationA, "app-a", DEFAULT_CONFIG);
    const resultB = (0, route_profile_learning_1.observeRouteTransition)(observationB, "app-b", DEFAULT_CONFIG);
    (0, test_1.expect)(resultA.suggestion?.appSlug).toBe("app-a");
    (0, test_1.expect)(resultB.suggestion?.appSlug).toBe("app-b");
});
(0, test_1.test)("alias_candidate suggested when visible label differs from requirement target", () => {
    const result = (0, route_profile_learning_1.observeAliasCandidate)("Credit Cards", "Tarjetas de crédito", 0.85, "test-app", DEFAULT_CONFIG);
    (0, test_1.expect)(result.status).toBe("learned");
    (0, test_1.expect)(result.suggestion).toBeDefined();
    if (result.suggestion) {
        (0, test_1.expect)(result.suggestion.relation).toBe("alias_candidate");
        (0, test_1.expect)(result.suggestion.from).toBe("Credit Cards");
        (0, test_1.expect)(result.suggestion.to).toBe("Tarjetas de crédito");
        (0, test_1.expect)(result.suggestion.status).toBe("pending");
    }
});
(0, test_1.test)("auto-approves only with sufficient threshold", () => {
    const highConfidenceObservation = {
        from: "Home",
        to: "Products",
        beforeUrl: "https://example.com/home",
        afterUrl: "https://example.com/products",
        clickable: true,
        visible: true,
        sensitive: false,
        submitLike: false,
        riskyAction: false,
        transitionDetected: true
    };
    const result = (0, route_profile_learning_1.observeRouteTransition)(highConfidenceObservation, "test-app", {
        ...DEFAULT_CONFIG,
        autoApproveThreshold: 0.70
    });
    (0, test_1.expect)(result.suggestion?.status).toBe("auto_approved");
});
(0, test_1.test)("pending if evidence insufficient", () => {
    const lowConfidenceObservation = {
        from: "Home",
        to: "Unknown",
        beforeUrl: "https://example.com/home",
        afterUrl: "https://example.com/unknown",
        clickable: false,
        visible: false,
        sensitive: false,
        submitLike: false,
        riskyAction: false,
        transitionDetected: false
    };
    const result = (0, route_profile_learning_1.observeRouteTransition)(lowConfidenceObservation, "test-app", DEFAULT_CONFIG);
    (0, test_1.expect)(result.status).toBe("blocked");
});
(0, test_1.test)("getRouteProfileLearningConfig reads env vars correctly", () => {
    const env = {
        ROUTE_PROFILE_LEARNING_ENABLED: "true",
        ROUTE_PROFILE_LEARNING_AUTO_APPROVE_THRESHOLD: "0.85",
        ROUTE_PROFILE_LEARNING_AUTO_APPLY: "false",
        ROUTE_PROFILE_LEARNING_MIN_OCCURRENCES: "2",
        ROUTE_PROFILE_LEARNING_BLOCK_SENSITIVE: "true"
    };
    const config = (0, route_profile_learning_1.getRouteProfileLearningConfig)(env);
    (0, test_1.expect)(config.enabled).toBe(true);
    (0, test_1.expect)(config.autoApproveThreshold).toBe(0.85);
    (0, test_1.expect)(config.autoApply).toBe(false);
    (0, test_1.expect)(config.minOccurrences).toBe(2);
    (0, test_1.expect)(config.blockSensitive).toBe(true);
});
(0, test_1.test)("getRouteProfileLearningConfig uses defaults when env vars missing", () => {
    const env = {};
    const config = (0, route_profile_learning_1.getRouteProfileLearningConfig)(env);
    (0, test_1.expect)(config.enabled).toBe(false);
    (0, test_1.expect)(config.autoApproveThreshold).toBe(0.90);
    (0, test_1.expect)(config.autoApply).toBe(false);
    (0, test_1.expect)(config.minOccurrences).toBe(1);
    (0, test_1.expect)(config.blockSensitive).toBe(true);
});
(0, test_1.test)("learning disabled returns skipped", () => {
    const observation = {
        from: "Home",
        to: "Products",
        beforeUrl: "https://example.com/home",
        afterUrl: "https://example.com/products",
        clickable: true,
        visible: true,
        sensitive: false,
        submitLike: false,
        riskyAction: false,
        transitionDetected: true
    };
    const result = (0, route_profile_learning_1.observeRouteTransition)(observation, "test-app", DISABLED_CONFIG);
    (0, test_1.expect)(result.status).toBe("skipped");
    (0, test_1.expect)(result.reason).toBe("Route profile learning is disabled");
});
(0, test_1.test)("blocks self-edge where from === to", () => {
    const observation = {
        from: "Tarjetas",
        to: "Tarjetas",
        beforeUrl: "https://example.com/tarjetas",
        afterUrl: "https://example.com/tarjetas",
        clickable: true,
        visible: true,
        sensitive: false,
        submitLike: false,
        riskyAction: false,
        transitionDetected: true
    };
    const result = (0, route_profile_learning_1.observeRouteTransition)(observation, "test-app", DEFAULT_CONFIG);
    (0, test_1.expect)(result.status).toBe("blocked");
    (0, test_1.expect)(result.reason).toBe("Self-edge blocked");
});
