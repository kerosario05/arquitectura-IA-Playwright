import type {
  McpScenario,
  JiraIssueSource,
  AutomatabilityClassification,
  ExcludedRequirement,
} from "./scenario-types";

/**
 * Patterns that indicate non-automatable backend requirements
 *
 * These require:
 * - Database manipulation
 * - Service corruption/mocking
 * - Backend state manipulation
 * - API response tampering
 */
const BACKEND_PATTERNS = [
  // Database manipulation
  /manipular.*base de datos/i,
  /alterar.*base de datos/i,
  /corromper.*base de datos/i,
  /modificar.*registro.*base de datos/i,
  /insertar.*dato.*corrupto/i,
  /actualizar.*dato.*inv[aá]lido/i,

  // Service/API manipulation
  /simular.*ca[ií]da.*servicio/i,
  /simular.*timeout.*backend/i,
  /simular.*error.*backend/i,
  /corromper.*respuesta.*servicio/i,
  /mock.*servicio/i,
  /stub.*api/i,
  /interceptar.*respuesta/i,
  /alterar.*respuesta.*api/i,

  // Backend state
  /crear.*producto.*descontinuado/i, // Artificial creation
  /generar.*error.*interno/i,
  /forzar.*excepci[oó]n.*backend/i,
  /validar.*log.*interno/i,
  /validar.*incidente.*interno/i,
  /validar.*auditor[ií]a.*interna/i,

  // Core banking manipulation
  /manipular.*core banking/i,
  /alterar.*core banking/i,
  /simular.*error.*core/i,
];

/**
 * Patterns that indicate non-automatable infrastructure requirements
 *
 * These require:
 * - Network manipulation
 * - Physical device restart
 * - Infrastructure-level changes
 */
const INFRA_PATTERNS = [
  // Network manipulation
  /simular.*p[eé]rdida.*red/i,
  /simular.*p[eé]rdida.*conexi[oó]n/i,
  /desconectar.*red/i,
  /interrumpir.*red/i,
  /manipular.*red/i,
  /cortar.*conexi[oó]n/i,

  // Physical device
  /reiniciar.*f[ií]sicamente/i,
  /reiniciar.*kiosko/i,
  /reiniciar.*dispositivo/i,
  /reinicio.*kiosko/i,
  /reinicio.*dispositivo/i,
  /p[eé]rdida.*energ[ií]a/i,
  /p[eé]rdida.*corriente/i,
  /apag[oó]n/i,
  /restaurar.*energ[ií]a/i,
  /power\s+(loss|failure|outage)/i,
  /apagar.*kiosko/i,
  /reset.*hardware/i,

  // External website manipulation
  /alterar.*web.*oficial/i,
  /modificar.*sitio.*externo/i,
  /manipular.*p[aá]gina.*externa/i,
];

function hasSupportedUiWaitStep(steps: string[]): boolean {
  return steps.some((step) =>
    /^(?:\d+[\.)]\s*)?(esperar|wait)/i.test(step)
    && /\b(\d+)\s*(segundos?|minutos?|ms|s|m)\b/i.test(step),
  );
}

type MatchedPattern = {
  rule: string;
  matchedText: string;
  source: "steps" | "metadata" | "context";
};

type AutomatabilityDecision = {
  classification: AutomatabilityClassification;
  isAutomatable: boolean;
  reason?: string;
  detectedPatterns?: string[];
  reasonCode?: string;
  matchedRule?: string;
  matchedText?: string;
  matchedSource?: "steps" | "metadata" | "context" | "none";
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function findPatternMatch(
  patterns: RegExp[],
  sources: Array<{ text: string; source: "steps" | "metadata" | "context" }>,
): MatchedPattern | null {
  for (const pattern of patterns) {
    for (const sourceInfo of sources) {
      const match = sourceInfo.text.match(pattern);
      if (!match) continue;
      return {
        rule: pattern.source,
        matchedText: normalizeWhitespace(match[0]).slice(0, 120),
        source: sourceInfo.source,
      };
    }
  }
  return null;
}

/**
 * Patterns that indicate manual or out-of-scope requirements
 *
 * These require:
 * - Human intervention
 * - Physical actions
 * - Out-of-scope validations
 */
const MANUAL_PATTERNS = [
  // Explicit manual execution intent. Business controls may legitimately be
  // labelled "manual" or "manualmente" and must not match these rules.
  /\bmanual[-\s]?only\b/i,
  /\bmanual[_\s]+test\b/i,
  /\b(?:solo|exclusivamente)\s+(?:ejecuci[oó]n|prueba|caso|escenario)\s+manual(?:mente)?\b/i,
  /\b(?:validar|verificar|inspeccionar)\s+manualmente\b/i,
  /\b(?:prueba|caso|escenario|ejecuci[oó]n)\s+(?:debe\s+ser\s+)?manual(?:mente)?\b/i,
  // Physical actions
  /tocar.*pantalla/i,
  /presionar.*bot[oó]n.*f[ií]sico/i,
  /insertar.*tarjeta.*f[ií]sica/i,

  // Manual validations
  /inspecci[oó]n.*manual/i,
  /verificar.*con.*usuario.*real/i,

  // Out of scope
  /llamada.*telef[oó]nica/i,
  /env[ií]o.*correo.*real/i,
  /notificaci[oó]n.*sms.*real/i,
];

/**
 * Patterns that indicate missing test hooks
 *
 * These require test infrastructure that doesn't exist
 */
const MISSING_HOOK_PATTERNS = [
  // Test data hooks that don't exist
  /crear.*usuario.*con.*saldo.*cero/i, // Without data creation hook
  /generar.*transacci[oó]n.*pendiente/i, // Without transaction hook
  /configurar.*l[ií]mite.*especial/i, // Without config hook
];

/**
 * Patterns that indicate UI-automatable scenarios (allowed)
 *
 * These are safe for MCP UI automation
 */
const UI_AUTOMATABLE_PATTERNS = [
  // Navigation
  /navegar/i,
  /acceder/i,
  /ir a/i,
  /abrir/i,

  // Clicks (safe)
  /clic en/i,
  /seleccionar/i,
  /hacer clic/i,

  // Validations (visible)
  /validar que se muestre/i,
  /validar que.*est[eé].*visible/i,
  /validar que.*aparezca/i,
  /verificar que se muestre/i,
  /comprobar que.*visible/i,

  // Wait/Expect
  /esperar que se muestre/i,
  /esperar que.*visible/i,

  // Absence validation (if product doesn't exist in current catalog)
  /validar que no se muestre.*producto.*descontinuado/i, // OK if checking absence in current UI
  /validar ausencia.*enlace.*externo/i, // OK if checking DOM
];

/**
 * Classify a scenario's automatability
 *
 * Returns classification and reason for exclusion if not automatable
 */
export function classifyScenarioAutomatability(
  scenario: McpScenario,
  huContext?: JiraIssueSource
): AutomatabilityDecision {
  const detectedPatterns: string[] = [];

  const scenarioWithAuthority = scenario as McpScenario & {
    manualOnly?: boolean;
    nonAutomatable?: boolean;
  };
  const explicitManualOnly = scenarioWithAuthority.manualOnly === true
    || scenarioWithAuthority.nonAutomatable === true
    || scenario.executionMode === "nonAutomatable"
    || scenario.launchClassification === "nonAutomatable";
  if (explicitManualOnly) {
    detectedPatterns.push("explicit_manual_only_authority");
    return {
      classification: "non_automatable_manual",
      isAutomatable: false,
      reasonCode: "manual_only_metadata",
      reason: "Scenario is explicitly marked manual-only by structured execution authority",
      matchedRule: "explicit_manual_only_authority",
      matchedText: scenarioWithAuthority.manualOnly === true ? "manualOnly=true" : "structured_non_automatable_authority",
      matchedSource: "metadata",
      detectedPatterns,
    };
  }

  // Evaluate actionable scenario content first (steps + scenario metadata).
  const scenarioStepsText = normalizeWhitespace((scenario.steps || []).join(" "));
  const scenarioMetadataText = normalizeWhitespace([
    scenario.title,
    scenario.expectedResult,
    scenario.preconditions?.join(" ") || "",
    scenario.nonExecutableCriteria || "",
    scenario.automationType || "",
  ].join(" "));

  const huText = huContext
    ? [
        huContext.summary,
        huContext.description,
        huContext.acceptanceCriteria || "",
      ].join(" ")
    : "";

  const actionableSources: Array<{ text: string; source: "steps" | "metadata" }> = [
    { text: scenarioStepsText, source: "steps" },
    { text: scenarioMetadataText, source: "metadata" },
  ];
  const allSources: Array<{ text: string; source: "steps" | "metadata" | "context" }> = [
    ...actionableSources,
    { text: normalizeWhitespace(huText), source: "context" },
  ];

  const actionableText = `${scenarioStepsText} ${scenarioMetadataText}`;
  const hasPhysicalRestartSignal = /\b(reinicio|reiniciar|apag[oó]n|power\s+(loss|failure|outage)|p[eé]rdida\s+de\s+(energ[ií]a|corriente)|restauraci[oó]n\s+de\s+energ[ií]a)\b/i.test(actionableText);
  const hasExternalInfrastructureSignal = /\b(kiosko|dispositivo|terminal|equipo|hardware|infraestructura|energ[ií]a|corriente)\b/i.test(actionableText);
  const hasInactivitySignal = /\b(inactividad|sin\s+actividad|sin\s+interacci[oó]n|timeout|tiempo\s+de\s+espera)\b/i.test(actionableText);
  const hasExplicitSupportedWait = hasSupportedUiWaitStep(scenario.steps ?? []);
  if ((hasPhysicalRestartSignal && hasExternalInfrastructureSignal)
    || (hasInactivitySignal && !hasExplicitSupportedWait)) {
    detectedPatterns.push("physical_restart_or_inactivity_without_supported_wait");
    const matchedRule = hasInactivitySignal && !hasExplicitSupportedWait
      ? "inactivity_without_supported_wait"
      : "physical_restart_or_power_recovery";
    const matchedText = hasInactivitySignal && !hasExplicitSupportedWait
      ? "inactividad/timeout sin paso de espera soportado"
      : "reinicio físico o recuperación de energía";
    return {
      classification: "non_automatable_infra",
      isAutomatable: false,
      reasonCode: hasInactivitySignal && !hasExplicitSupportedWait
        ? "inactivity_without_supported_wait"
        : "physical_restart_or_power_recovery",
      reason: hasInactivitySignal && !hasExplicitSupportedWait
        ? "Requires infrastructure/manual inactivity trigger without supported wait step"
        : "Requires infrastructure manipulation for physical restart/power recovery",
      matchedRule,
      matchedText,
      matchedSource: "steps",
      detectedPatterns,
    };
  }

  // Check backend patterns (actionable sources only; context matches are diagnostic only).
  const backendMatch = findPatternMatch(BACKEND_PATTERNS, actionableSources);
  if (backendMatch) {
    detectedPatterns.push(backendMatch.rule);
    return {
      classification: "non_automatable_backend",
      isAutomatable: false,
      reasonCode: "backend_rule_match",
      reason: `Requires backend manipulation: pattern matched "${backendMatch.rule}"`,
      matchedRule: backendMatch.rule,
      matchedText: backendMatch.matchedText,
      matchedSource: backendMatch.source,
      detectedPatterns,
    };
  }

  // Check infra patterns (actionable sources only; context matches are diagnostic only).
  const infraMatch = findPatternMatch(INFRA_PATTERNS, actionableSources);
  if (infraMatch) {
    detectedPatterns.push(infraMatch.rule);
    return {
      classification: "non_automatable_infra",
      isAutomatable: false,
      reasonCode: "infrastructure_rule_match",
      reason: `Requires infrastructure manipulation: pattern matched "${infraMatch.rule}"`,
      matchedRule: infraMatch.rule,
      matchedText: infraMatch.matchedText,
      matchedSource: infraMatch.source,
      detectedPatterns,
    };
  }

  // Check manual patterns (actionable sources only; context matches are diagnostic only).
  const manualMatch = findPatternMatch(MANUAL_PATTERNS, actionableSources);
  if (manualMatch) {
    detectedPatterns.push(manualMatch.rule);
    return {
      classification: "non_automatable_manual",
      isAutomatable: false,
      reasonCode: "manual_rule_match",
      reason: `Requires manual intervention: pattern matched "${manualMatch.rule}"`,
      matchedRule: manualMatch.rule,
      matchedText: manualMatch.matchedText,
      matchedSource: manualMatch.source,
      detectedPatterns,
    };
  }

  // Check missing hook patterns (actionable sources only; context matches are diagnostic only).
  const missingHookMatch = findPatternMatch(MISSING_HOOK_PATTERNS, actionableSources);
  if (missingHookMatch) {
    detectedPatterns.push(missingHookMatch.rule);
    return {
      classification: "blocked_by_missing_test_hook",
      isAutomatable: false,
      reasonCode: "missing_test_hook_rule_match",
      reason: `Requires test hook that doesn't exist: pattern matched "${missingHookMatch.rule}"`,
      matchedRule: missingHookMatch.rule,
      matchedText: missingHookMatch.matchedText,
      matchedSource: missingHookMatch.source,
      detectedPatterns,
    };
  }

  const contextOnlyMatches: string[] = [];
  for (const patterns of [BACKEND_PATTERNS, INFRA_PATTERNS, MANUAL_PATTERNS, MISSING_HOOK_PATTERNS]) {
    const match = findPatternMatch(patterns, allSources);
    if (match && match.source === "context") {
      contextOnlyMatches.push(match.rule);
    }
  }
  if (contextOnlyMatches.length > 0) {
    console.log(
      `[automatability-filter] contextOnlySignals ignored rules=${contextOnlyMatches.slice(0, 3).join("|")} issue=${huContext?.key ?? "none"}`,
    );
  }

  // If no blocking patterns found, classify as automatable
  return {
    classification: "automatable_ui",
    isAutomatable: true,
    reasonCode: "automatable_ui",
    matchedRule: "none",
    matchedText: "",
    matchedSource: "none",
  };
}

/**
 * Filter scenarios by automatability
 *
 * Returns:
 * - automatable: scenarios that passed filter (UI-automatable)
 * - excluded: scenarios that failed filter (non-automatable)
 */
export function filterScenariosByAutomatability(
  scenarios: McpScenario[],
  huContext?: JiraIssueSource
): {
  automatable: McpScenario[];
  excluded: ExcludedRequirement[];
} {
  const automatable: McpScenario[] = [];
  const excluded: ExcludedRequirement[] = [];

  for (const scenario of scenarios) {
    const classification = classifyScenarioAutomatability(scenario, huContext);
    const scenarioId = scenario.scenarioId ?? `${scenario.sourceIssueKey}:${scenario.title}`;
    const safeTitle = String(scenario.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    console.log(
      `[automatability-filter] scenarioId="${scenarioId}" title="${safeTitle}" automatable=${classification.isAutomatable} ` +
      `reasonCode=${classification.reasonCode ?? "none"} matchedRule=${classification.matchedRule ?? "none"} ` +
      `matchedText="${classification.matchedText ?? ""}" matchedSource=${classification.matchedSource ?? "none"} ` +
      `automationType=${scenario.automationType ?? "unknown"} mcpExecutableBeforeFilter=${scenario.mcpExecutable !== false}`,
    );

    if (classification.isAutomatable) {
      automatable.push(scenario);
    } else {
      // Map classification to suggested handling
      let suggestedHandling = "skip";
      if (classification.classification === "non_automatable_backend") {
        suggestedHandling = "backend_unit_test";
      } else if (classification.classification === "non_automatable_infra") {
        suggestedHandling = "manual_test";
      } else if (classification.classification === "non_automatable_manual") {
        suggestedHandling = "manual_test";
      } else if (classification.classification === "blocked_by_missing_test_hook") {
        suggestedHandling = "implement_test_hook_then_retry";
      }

      excluded.push({
        sourceRequirement: scenario.title,
        sourceIssueKey: scenario.sourceIssueKey,
        reason: classification.reason || "Not automatable",
        classification: classification.classification,
        suggestedHandling,
        detectedPatterns: classification.detectedPatterns,
        scenarioId,
        reasonCode: classification.reasonCode,
        matchedRule: classification.matchedRule,
        matchedText: classification.matchedText,
        matchedSource: classification.matchedSource,
      });
    }
  }

  console.log(
    `[automatability-filter] total=${scenarios.length} automatable=${automatable.length} excluded=${excluded.length}`
  );

  return { automatable, excluded };
}
