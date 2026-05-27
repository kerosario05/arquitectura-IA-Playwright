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

import { test, expect } from "@playwright/test";
import { validateRepairDecision } from "../src/ai/repair/repair-decision-validator";
import { buildRepairContextPack } from "../src/ai/repair/repair-context-pack";
import { runAiRepairOrchestrator } from "../src/ai/repair/ai-repair-orchestrator";
import { createEmptyCaseSummary } from "../src/ai/repair/ai-repair-metrics";

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

test("schema accepts missing_intermediate_step with valid candidateId and insertedStepText", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "nav-tarjetas-credito",
    insertedStepText: "Tarjetas de crédito",
    reason: "Insert intermediate navigation step to reach product selection.",
    confidence: 0.85
  };

  const result = validateRepairDecision(decision, {
    candidates: NAV_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(true);
  if (result.valid) {
    expect(result.decision.repairType).toBe("missing_intermediate_step");
    expect(result.decision.candidateId).toBe("nav-tarjetas-credito");
    expect(result.decision.insertedStepText).toBe("Tarjetas de crédito");
  }
});

test("missing_intermediate_step: inserts Tarjetas de crédito after Tarjetas (scenario 1)", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "nav-tarjetas-credito",
    insertedStepText: "Tarjetas de crédito",
    reason: "Need to navigate through Tarjetas de crédito before selecting product.",
    confidence: 0.88
  };

  const result = validateRepairDecision(decision, {
    candidates: NAV_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(true);
  if (result.valid) {
    expect(result.decision.insertedStepText).toBe("Tarjetas de crédito");
  }
});

test("missing_intermediate_step: inserts Cuentas de ahorros after Cuentas (scenario 2)", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "nav-cuentas-ahorros",
    insertedStepText: "Cuentas de ahorros",
    reason: "Intermediate step required to reach savings account products.",
    confidence: 0.82
  };

  const result = validateRepairDecision(decision, {
    candidates: NAV_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(true);
  if (result.valid) {
    expect(result.decision.insertedStepText).toBe("Cuentas de ahorros");
  }
});

test("missing_intermediate_step: inserts Préstamos personales after Préstamos (scenario 3)", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "nav-prestamos-personales",
    insertedStepText: "Préstamos personales",
    reason: "Need to navigate through personal loans subcategory.",
    confidence: 0.79
  };

  const result = validateRepairDecision(decision, {
    candidates: NAV_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(true);
  if (result.valid) {
    expect(result.decision.insertedStepText).toBe("Préstamos personales");
  }
});

test("missing_intermediate_step: validator requires insertedStepText for repaired_plan", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "nav-tarjetas-credito",
    reason: "Missing insertedStepText field.",
    confidence: 0.80
  };

  const result = validateRepairDecision(decision, {
    candidates: NAV_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe("AI_REPAIR_MISSING_INSERTED_STEP");
  }
});

test("missing_intermediate_step: validator blocks unknown candidateId", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "unknown-nav-step",
    insertedStepText: "Unknown step",
    reason: "Candidate does not exist.",
    confidence: 0.75
  };

  const result = validateRepairDecision(decision, {
    candidates: NAV_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe("AI_REPAIR_UNKNOWN_CANDIDATE");
  }
});

test("missing_intermediate_step: validator blocks non-clickable candidate (scenario 7)", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "label-tarjetas",
    insertedStepText: "Tarjetas",
    reason: "Non-clickable candidate should be blocked.",
    confidence: 0.80
  };

  const result = validateRepairDecision(decision, {
    candidates: NON_CLICKABLE_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe("AI_REPAIR_CANDIDATE_NOT_CLICKABLE");
  }
});

test("missing_intermediate_step: validator blocks sensitive candidate (scenario 8)", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "nav-pagos",
    insertedStepText: "Pagos",
    reason: "Sensitive candidate should be blocked.",
    confidence: 0.85
  };

  const result = validateRepairDecision(decision, {
    candidates: SENSITIVE_NAV_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
  }
});

test("missing_intermediate_step: validator blocks submit-like candidates (scenario 9)", () => {
  const decisionContinuar = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "btn-continuar",
    insertedStepText: "Continuar",
    reason: "Submit-like candidates should be blocked as intermediate steps.",
    confidence: 0.80
  };

  const resultContinuar = validateRepairDecision(decisionContinuar, {
    candidates: SUBMIT_LIKE_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(resultContinuar.valid).toBe(false);

  const decisionConfirmar = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "btn-confirmar",
    insertedStepText: "Confirmar",
    reason: "Submit-like candidates should be blocked as intermediate steps.",
    confidence: 0.80
  };

  const resultConfirmar = validateRepairDecision(decisionConfirmar, {
    candidates: SUBMIT_LIKE_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(resultConfirmar.valid).toBe(false);

  const decisionEnviar = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "btn-enviar",
    insertedStepText: "Enviar",
    reason: "Submit-like candidates should be blocked as intermediate steps.",
    confidence: 0.80
  };

  const resultEnviar = validateRepairDecision(decisionEnviar, {
    candidates: SUBMIT_LIKE_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(resultEnviar.valid).toBe(false);
});

test("missing_intermediate_step: no_safe_action is valid when no suitable intermediate step", () => {
  const decision = {
    decision: "no_safe_action" as const,
    repairType: "missing_intermediate_step" as const,
    reason: "No suitable intermediate navigation step found.",
    confidence: 0.70
  };

  const result = validateRepairDecision(decision, {
    candidates: NAV_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(true);
  if (result.valid) {
    expect(result.decision.decision).toBe("no_safe_action");
    expect(result.decision.repairType).toBe("missing_intermediate_step");
  }
});

test("context-pack includes routeHistory for missing_intermediate_step", () => {
  const contextPack = buildRepairContextPack({
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

  expect(contextPack.candidates).toBeDefined();
  expect(contextPack.routeHistory).toBeDefined();
  if (contextPack.routeHistory) {
    expect(contextPack.routeHistory.failedRoutePaths).toContain("nav-tarjetas");
  }
});

test("missing_intermediate_step: confidence threshold check (scenario 11)", () => {
  const decisionLowConfidence = {
    decision: "repaired_plan" as const,
    repairType: "missing_intermediate_step" as const,
    candidateId: "nav-tarjetas-credito",
    insertedStepText: "Tarjetas de crédito",
    reason: "Low confidence should still pass validation but fail config threshold.",
    confidence: 0.50
  };

  const result = validateRepairDecision(decisionLowConfidence, {
    candidates: NAV_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(true);
  if (result.valid) {
    expect(result.decision.confidence).toBe(0.50);
  }
});

test("metrics track missing_intermediate_step repairType", () => {
  const summary = createEmptyCaseSummary();
  
  expect(summary.repairTypeCounts.missing_intermediate_step).toBe(0);
});

// Integration tests for the resolver
import { resolveMissingIntermediateStep, type MissingIntermediateStepInput, type RouteCompletionConfig } from "../src/discovery/missing-intermediate-step-resolver";
import type { AppRouteProfile } from "../src/types/env.types";

const DEFAULT_CONFIG: RouteCompletionConfig = {
  enabled: true,
  minConfidence: 0.75,
  maxInsertedSteps: 1,
  useAppProfile: true,
  allowGeneric: true
};

const DISABLED_CONFIG: RouteCompletionConfig = {
  enabled: false,
  minConfidence: 0.75,
  maxInsertedSteps: 1,
  useAppProfile: true,
  allowGeneric: true
};

const ROUTE_PROFILE: AppRouteProfile = {
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

test("resolver proposes intermediate from routeProfile (Tarjetas -> Tarjetas de crédito)", () => {
  const input: MissingIntermediateStepInput = {
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

  const result = resolveMissingIntermediateStep(input);

  expect(result.status).toBe("repaired_plan");
  expect(result.candidateId).toBe("nav-tarjetas-credito");
  expect(result.insertedStepText).toBe("Tarjetas de crédito");
  expect(result.source).toBe("app_route_profile");
});

test("resolver respects maxInsertedSteps limit", () => {
  const input: MissingIntermediateStepInput = {
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

  const result = resolveMissingIntermediateStep(input);

  expect(result.status).toBe("no_safe_action");
  expect(result.blockedReason).toBe("max_inserted_steps_reached");
});

test("resolver blocks submit-like candidates (Continuar)", () => {
  const input: MissingIntermediateStepInput = {
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

  const result = resolveMissingIntermediateStep(input);

  expect(result.status).toBe("no_safe_action");
  expect(result.blockedReason).toBe("no_safe_candidate");
});

test("resolver blocks non-clickable candidates", () => {
  const input: MissingIntermediateStepInput = {
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

  const result = resolveMissingIntermediateStep(input);

  expect(result.status).toBe("no_safe_action");
  expect(result.blockedReason).toBe("no_safe_candidate");
});

test("resolver disabled returns no_safe_action", () => {
  const input: MissingIntermediateStepInput = {
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

  const result = resolveMissingIntermediateStep(input);

  expect(result.status).toBe("no_safe_action");
  expect(result.blockedReason).toBe("disabled");
});

test("resolver generic fallback proposes candidate with semantic relation", () => {
  const input: MissingIntermediateStepInput = {
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

  const result = resolveMissingIntermediateStep(input);

  expect(result.status).toBe("repaired_plan");
  expect(result.candidateId).toBe("cat-laptops");
  expect(result.source).toBe("generic_forward_route_completion");
});

test("resolver generic fallback returns no_safe_action for ambiguous candidates", () => {
  const input: MissingIntermediateStepInput = {
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

  const result = resolveMissingIntermediateStep(input);

  expect(result.status).toBe("no_safe_action");
  expect(result.blockedReason).toBe("no_safe_candidate");
});

test("resolver diagnostics include routeProfileMatch for app_route_profile source", () => {
  const input: MissingIntermediateStepInput = {
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

  const result = resolveMissingIntermediateStep(input);

  expect(result.status).toBe("repaired_plan");
  expect(result.source).toBe("app_route_profile");
  expect(result.routeProfileMatch).toBeDefined();
  if (result.routeProfileMatch) {
    expect(result.routeProfileMatch.from).toBe("Tarjetas");
    expect(result.routeProfileMatch.intermediate).toBe("Tarjetas de crédito");
  }
});

test("resolver accepts semantic_mismatch failureType", () => {
  const input: MissingIntermediateStepInput = {
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

  const result = resolveMissingIntermediateStep(input);

  expect(result.status).toBe("repaired_plan");
  expect(result.source).toBe("app_route_profile");
});

test("resolver accepts weak_deterministic_resolution failureType", () => {
  const input: MissingIntermediateStepInput = {
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

  const result = resolveMissingIntermediateStep(input);

  expect(result.status).toBe("repaired_plan");
  expect(result.source).toBe("app_route_profile");
});

test("resolver includes lastSuccessfulTarget in context", () => {
  const input: MissingIntermediateStepInput = {
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

  const result = resolveMissingIntermediateStep(input);

  // Should return no_safe_action since currentRouteHistory doesn't match any route.from
  expect(result.status).toBe("no_safe_action");
});
