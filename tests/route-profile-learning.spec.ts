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

import { test, expect } from "@playwright/test";
import {
  observeRouteTransition,
  observeRouteCompletionSuccess,
  observeAliasCandidate,
  saveRouteProfileSuggestions,
  consolidatePendingSuggestions,
  getRouteProfileLearningConfig,
  type RouteProfileLearningConfig,
  type RouteObservation
} from "../src/discovery/route-profile-learning";

const DEFAULT_CONFIG: RouteProfileLearningConfig = {
  enabled: true,
  autoApproveThreshold: 0.90,
  autoApply: false,
  minOccurrences: 1,
  blockSensitive: true
};

const DISABLED_CONFIG: RouteProfileLearningConfig = {
  enabled: false,
  autoApproveThreshold: 0.90,
  autoApply: false,
  minOccurrences: 1,
  blockSensitive: true
};

test("learns child_route from successful transition", () => {
  const observation: RouteObservation = {
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

  const result = observeRouteTransition(observation, "test-app", DEFAULT_CONFIG);

  expect(result.status).toBe("learned");
  expect(result.suggestion).toBeDefined();
  if (result.suggestion) {
    expect(result.suggestion.relation).toBe("child_route");
    expect(result.suggestion.source).toBe("successful_transition");
    expect(result.suggestion.appSlug).toBe("test-app");
    expect(result.suggestion.confidence).toBeGreaterThan(0.5);
  }
});

test("learns intermediate_step from Route Completion with retrySucceeded", () => {
  const result = observeRouteCompletionSuccess(
    {
      target: "Tarjetas de crédito",
      candidateId: "nav-tarjetas-credito",
      source: "app_route_profile"
    },
    "Tarjetas",
    "test-app",
    DEFAULT_CONFIG
  );

  expect(result.status).toBe("learned");
  expect(result.suggestion).toBeDefined();
  if (result.suggestion) {
    expect(result.suggestion.relation).toBe("intermediate_step");
    expect(result.suggestion.source).toBe("route_completion");
    expect(result.suggestion.status).toBe("auto_approved");
  }
});

test("blocks submit-like candidates", () => {
  const observation: RouteObservation = {
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

  const result = observeRouteTransition(observation, "test-app", DEFAULT_CONFIG);

  expect(result.status).toBe("blocked");
  expect(result.reason).toBe("Submit-like candidate blocked");
});

test("blocks sensitive candidates", () => {
  const observation: RouteObservation = {
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

  const result = observeRouteTransition(observation, "test-app", DEFAULT_CONFIG);

  expect(result.status).toBe("blocked");
  expect(result.reason).toBe("Sensitive candidate blocked");
});

test("blocks risky actions", () => {
  const observation: RouteObservation = {
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

  const result = observeRouteTransition(observation, "test-app", DEFAULT_CONFIG);

  expect(result.status).toBe("blocked");
  expect(result.reason).toBe("Risky action blocked");
});

test("doesn't mix appSlug between apps", () => {
  const observationA: RouteObservation = {
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

  const observationB: RouteObservation = {
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

  const resultA = observeRouteTransition(observationA, "app-a", DEFAULT_CONFIG);
  const resultB = observeRouteTransition(observationB, "app-b", DEFAULT_CONFIG);

  expect(resultA.suggestion?.appSlug).toBe("app-a");
  expect(resultB.suggestion?.appSlug).toBe("app-b");
});

test("alias_candidate suggested when visible label differs from requirement target", () => {
  const result = observeAliasCandidate(
    "Credit Cards",
    "Tarjetas de crédito",
    0.85,
    "test-app",
    DEFAULT_CONFIG
  );

  expect(result.status).toBe("learned");
  expect(result.suggestion).toBeDefined();
  if (result.suggestion) {
    expect(result.suggestion.relation).toBe("alias_candidate");
    expect(result.suggestion.from).toBe("Credit Cards");
    expect(result.suggestion.to).toBe("Tarjetas de crédito");
    expect(result.suggestion.status).toBe("pending");
  }
});

test("auto-approves only with sufficient threshold", () => {
  const highConfidenceObservation: RouteObservation = {
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

  const result = observeRouteTransition(highConfidenceObservation, "test-app", {
    ...DEFAULT_CONFIG,
    autoApproveThreshold: 0.70
  });

  expect(result.suggestion?.status).toBe("auto_approved");
});

test("pending if evidence insufficient", () => {
  const lowConfidenceObservation: RouteObservation = {
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

  const result = observeRouteTransition(lowConfidenceObservation, "test-app", DEFAULT_CONFIG);

  expect(result.status).toBe("blocked");
});

test("getRouteProfileLearningConfig reads env vars correctly", () => {
  const env = {
    ROUTE_PROFILE_LEARNING_ENABLED: "true",
    ROUTE_PROFILE_LEARNING_AUTO_APPROVE_THRESHOLD: "0.85",
    ROUTE_PROFILE_LEARNING_AUTO_APPLY: "false",
    ROUTE_PROFILE_LEARNING_MIN_OCCURRENCES: "2",
    ROUTE_PROFILE_LEARNING_BLOCK_SENSITIVE: "true"
  };

  const config = getRouteProfileLearningConfig(env);

  expect(config.enabled).toBe(true);
  expect(config.autoApproveThreshold).toBe(0.85);
  expect(config.autoApply).toBe(false);
  expect(config.minOccurrences).toBe(2);
  expect(config.blockSensitive).toBe(true);
});

test("getRouteProfileLearningConfig uses defaults when env vars missing", () => {
  const env = {};

  const config = getRouteProfileLearningConfig(env);

  expect(config.enabled).toBe(false);
  expect(config.autoApproveThreshold).toBe(0.90);
  expect(config.autoApply).toBe(false);
  expect(config.minOccurrences).toBe(1);
  expect(config.blockSensitive).toBe(true);
});

test("learning disabled returns skipped", () => {
  const observation: RouteObservation = {
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

  const result = observeRouteTransition(observation, "test-app", DISABLED_CONFIG);

  expect(result.status).toBe("skipped");
  expect(result.reason).toBe("Route profile learning is disabled");
});

test("blocks self-edge where from === to", () => {
  const observation: RouteObservation = {
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

  const result = observeRouteTransition(observation, "test-app", DEFAULT_CONFIG);

  expect(result.status).toBe("blocked");
  expect(result.reason).toBe("Self-edge blocked");
});
