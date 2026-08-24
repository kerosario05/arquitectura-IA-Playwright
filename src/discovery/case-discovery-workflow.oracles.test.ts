import assert from "node:assert";
import test from "node:test";
import { buildPromotionSourceScenario, buildRuntimeEvidenceTrace, collectLocalPendingAssertionDiagnostics } from "./case-discovery-workflow";
import type { CaseDiscoveryResult } from "../types/discovery.types";
import type { TestScenario } from "../types/testrail.types";

function buildScenario(expected: string): TestScenario {
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

function buildCaseResult(overrides: Partial<CaseDiscoveryResult>): CaseDiscoveryResult {
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

test("narrative expected result maps to navigation_transition oracle when discovery has transition evidence", () => {
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

  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("ruta pública"));
  assert.ok(oracle);
  assert.strictEqual(oracle?.type, "navigation_transition");
  assert.strictEqual(oracle?.backed, true);
  assert.strictEqual(oracle?.target, "Explora nuestros productos");
});

test("auth gate evidence maps narrative expected result to auth_gate oracle", () => {
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

  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("flujo de autenticación"));
  assert.ok(oracle);
  assert.strictEqual(oracle?.type, "auth_gate");
  assert.strictEqual(oracle?.backed, true);
  assert.strictEqual(oracle?.details?.stage, "identification_type_selection");
});

test("literal visible expected result stays as literal observable oracle", () => {
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

  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("¿Qué deseas realizar hoy?"));
  assert.ok(oracle);
  assert.strictEqual(oracle?.type, "literal_visible_text");
  assert.strictEqual(oracle?.backed, true);
});

test("unresolved oracle is explicit when no observable evidence is available", () => {
  const scenario = buildScenario("Debe mostrarse una etiqueta no observada.");
  const caseResult = buildCaseResult({
    status: "discovered_partial",
    steps: [],
  });

  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("etiqueta no observada"));
  assert.ok(oracle);
  assert.strictEqual(oracle?.type, "unsupported_or_unresolved");
  assert.strictEqual(oracle?.backed, false);
});

test("historical target can be reconciled to observed runtime control without hardcoded aliases", () => {
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

  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("Información de productos"));
  assert.ok(oracle);
  assert.strictEqual(oracle?.type, "heading_or_control");
  assert.strictEqual(oracle?.backed, true);
  assert.strictEqual(oracle?.target, "Explora nuestros productos");
  assert.strictEqual(oracle?.details?.semanticEquivalent, true);
});

test("weak semantic overlap does not create unsupported alias reconciliation", () => {
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

  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("préstamo hipotecario"));
  assert.ok(oracle);
  assert.strictEqual(oracle?.type, "unsupported_or_unresolved");
  assert.strictEqual(oracle?.backed, false);
});

function buildTransitionTrace(): NonNullable<CaseDiscoveryResult["runtimeEvidenceTrace"]> {
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

function buildPendingAssertionStep(assertionText: string) {
  return { index: 4, action: "assertVisible", status: "needs_assertion_resolution", targetText: assertionText } as any;
}

test("A1 navigation narrative assertion is locally consumed via transition-backed click related to the narrative requirement", () => {
  const assertionText = "información";
  const trace = buildTransitionTrace();
  const caseResult = buildCaseResult({
    steps: [buildPendingAssertionStep(assertionText)],
    runtimeEvidenceTrace: trace,
  });
  const narrative = ["La opción pública redirige al módulo de información."];

  const result = collectLocalPendingAssertionDiagnostics(caseResult, trace, narrative);
  assert.ok(result.localClosureDiagnostics?.consumed.includes(assertionText));
  assert.strictEqual(result.pendingAssertions.length, 0);
});

test("A2 transition-backed click unrelated to the assertion does not consume it", () => {
  const assertionText = "Debe mostrarse el saldo de la cuenta.";
  const trace = buildTransitionTrace();
  const caseResult = buildCaseResult({
    steps: [buildPendingAssertionStep(assertionText)],
    runtimeEvidenceTrace: trace,
  });
  const narrative = ["La opción pública redirige al módulo de información."];

  const result = collectLocalPendingAssertionDiagnostics(caseResult, trace, narrative);
  assert.ok(!result.localClosureDiagnostics?.consumed.includes(assertionText));
  assert.ok(result.pendingAssertions.includes(assertionText));
});

test("A3 navigation assertion stays pending when no transition-backed click was observed", () => {
  const assertionText = "Debe redirigir al módulo de información.";
  const trace = buildTransitionTrace();
  trace.clickActions[0].transitionDetected = false;
  const caseResult = buildCaseResult({
    steps: [buildPendingAssertionStep(assertionText)],
    runtimeEvidenceTrace: trace,
  });
  const narrative = ["La opción pública redirige al módulo de información."];

  const result = collectLocalPendingAssertionDiagnostics(caseResult, trace, narrative);
  assert.ok(!result.localClosureDiagnostics?.consumed.includes(assertionText));
});

test("B4 auth signal without a backed auth gate stays pending", () => {
  const assertionText = "El sistema debe presentar el flujo de autenticación.";
  const caseResult = buildCaseResult({ steps: [buildPendingAssertionStep(assertionText)] });

  const result = collectLocalPendingAssertionDiagnostics(caseResult);
  assert.ok(!result.localClosureDiagnostics?.consumed.includes(assertionText));
  assert.ok(result.pendingAssertions.includes(assertionText));
});

test("B5 auth assertion is consumed when an auth gate was detected on a step", () => {
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

  const result = collectLocalPendingAssertionDiagnostics(caseResult);
  assert.ok(result.localClosureDiagnostics?.consumed.includes(assertionText));
});

test("B6 auth assertion is consumed via plan metadata gate detection without literal autenticación text", () => {
  const assertionText = "Debe estar identificado el cliente antes de operar.";
  assert.ok(!assertionText.toLowerCase().includes("autenticaci"));
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

  const result = collectLocalPendingAssertionDiagnostics(caseResult);
  assert.ok(result.localClosureDiagnostics?.consumed.includes(assertionText));
});

test("A4 descriptive click action is classified into a transition-backed runtime click", () => {
  const caseResult = buildCaseResult({
    steps: [
      { index: 3, action: 'Clic en "explora nuestros productos".', status: "found", targetText: "explora nuestros productos" } as any,
    ],
  });

  const trace = buildRuntimeEvidenceTrace(caseResult);
  assert.ok(trace);
  assert.strictEqual(trace.clickActions.length, 1);
  assert.strictEqual(trace.clickActions[0].target, "explora nuestros productos");
  assert.strictEqual(trace.clickActions[0].success, true);
  assert.strictEqual(trace.clickActions[0].transitionDetected, true);
});

test("A5 visible-text validation action is not classified as a click", () => {
  const caseResult = buildCaseResult({
    steps: [
      { index: 4, action: 'Validar que se muestre "¿Qué deseas realizar hoy?".', status: "found", targetText: "¿Qué deseas realizar hoy?" } as any,
    ],
  });

  const trace = buildRuntimeEvidenceTrace(caseResult);
  assert.ok(trace);
  assert.strictEqual(trace.clickActions.length, 0);
});

test("A6 descriptive click closes a pending navigation narrative assertion end to end", () => {
  const assertionText = "información";
  const caseResult = buildCaseResult({
    steps: [
      { index: 3, action: 'Clic en "explora nuestros productos".', status: "found", targetText: "explora nuestros productos" } as any,
      buildPendingAssertionStep(assertionText),
    ],
  });
  const trace = buildRuntimeEvidenceTrace(caseResult);
  const narrative = ["La opción pública redirige al módulo de información."];

  const result = collectLocalPendingAssertionDiagnostics(caseResult, trace, narrative);
  assert.ok(result.localClosureDiagnostics?.consumed.includes(assertionText));
  assert.strictEqual(result.pendingAssertions.length, 0);
});

test("satisfied_by_previous_assertion auth narrative reconciles to auth_gate, never literal_visible_text", () => {
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

  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const narrative = sourceScenario.observableOracles?.find((item) => item.requirement.includes("flujo de autenticación"));
  assert.ok(narrative);
  assert.strictEqual(narrative?.type, "auth_gate");
  assert.strictEqual(narrative?.backed, true);
  assert.ok(
    !sourceScenario.observableOracles?.some(
      (item) => item.type === "literal_visible_text" && item.requirement.includes("flujo de autenticación")
    ),
    "narrative auth text must not become a literal_visible_text oracle"
  );
  assert.ok(
    !sourceScenario.observedAssertions?.some((item) => item.toLowerCase().includes("flujo de autenticación")),
    "narrative auth text must not be reported as an observed literal assertion"
  );
});

test("literally found assertion stays literal_visible_text backed=true", () => {
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

  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("¿Qué deseas realizar hoy?"));
  assert.ok(oracle);
  assert.strictEqual(oracle?.type, "literal_visible_text");
  assert.strictEqual(oracle?.backed, true);
});

test("satisfied_by_previous_assertion without backed evidence is unsupported backed=false", () => {
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

  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("estado de cuenta"));
  assert.ok(oracle);
  assert.strictEqual(oracle?.type, "unsupported_or_unresolved");
  assert.strictEqual(oracle?.backed, false);
  assert.ok(
    !sourceScenario.observableOracles?.some(
      (item) => item.type === "literal_visible_text" && item.requirement.includes("estado de cuenta")
    )
  );
});

test("satisfied_by_previous_assertion bookkeeping matchedText does not imply backed literal", () => {
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

  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("catálogo de productos"));
  assert.ok(oracle);
  assert.strictEqual(oracle?.backed, false);
  assert.ok(
    !sourceScenario.observableOracles?.some(
      (item) => item.type === "literal_visible_text" && item.requirement.includes("catálogo de productos")
    ),
    "matchedText carried by status bookkeeping must not synthesize literal_visible_text backed=true"
  );
});

test("satisfied_by_previous_assertion navigation reconciles to navigation_transition, not literal_visible_text", () => {
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

  const sourceScenario = buildPromotionSourceScenario(scenario, caseResult);
  const oracle = sourceScenario.observableOracles?.find((item) => item.requirement.includes("redirige al módulo de información"));
  assert.ok(oracle);
  assert.strictEqual(oracle?.type, "navigation_transition");
  assert.strictEqual(oracle?.backed, true);
  assert.ok(
    !sourceScenario.observableOracles?.some(
      (item) => item.type === "literal_visible_text" && item.requirement.includes("redirige al módulo de información")
    )
  );
});
