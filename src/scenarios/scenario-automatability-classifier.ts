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
  /apagar.*kiosko/i,
  /reset.*hardware/i,

  // External website manipulation
  /alterar.*web.*oficial/i,
  /modificar.*sitio.*externo/i,
  /manipular.*p[aá]gina.*externa/i,
];

/**
 * Patterns that indicate manual or out-of-scope requirements
 *
 * These require:
 * - Human intervention
 * - Physical actions
 * - Out-of-scope validations
 */
const MANUAL_PATTERNS = [
  // Physical actions
  /tocar.*pantalla/i,
  /presionar.*bot[oó]n.*f[ií]sico/i,
  /insertar.*tarjeta.*f[ií]sica/i,

  // Manual validations
  /validar.*manualmente/i,
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
): {
  classification: AutomatabilityClassification;
  isAutomatable: boolean;
  reason?: string;
  detectedPatterns?: string[];
} {
  const detectedPatterns: string[] = [];

  // Build searchable text from scenario + HU context
  const scenarioText = [
    scenario.title,
    ...(scenario.steps || []),
    scenario.expectedResult,
    scenario.preconditions?.join(" ") || "",
    scenario.nonExecutableCriteria || "",
  ].join(" ");

  const huText = huContext
    ? [
        huContext.summary,
        huContext.description,
        huContext.acceptanceCriteria || "",
      ].join(" ")
    : "";

  const fullText = scenarioText + " " + huText;

  // Check backend patterns
  for (const pattern of BACKEND_PATTERNS) {
    if (pattern.test(fullText)) {
      detectedPatterns.push(pattern.source);
      return {
        classification: "non_automatable_backend",
        isAutomatable: false,
        reason: `Requires backend manipulation: pattern matched "${pattern.source}"`,
        detectedPatterns,
      };
    }
  }

  // Check infra patterns
  for (const pattern of INFRA_PATTERNS) {
    if (pattern.test(fullText)) {
      detectedPatterns.push(pattern.source);
      return {
        classification: "non_automatable_infra",
        isAutomatable: false,
        reason: `Requires infrastructure manipulation: pattern matched "${pattern.source}"`,
        detectedPatterns,
      };
    }
  }

  // Check manual patterns
  for (const pattern of MANUAL_PATTERNS) {
    if (pattern.test(fullText)) {
      detectedPatterns.push(pattern.source);
      return {
        classification: "non_automatable_manual",
        isAutomatable: false,
        reason: `Requires manual intervention: pattern matched "${pattern.source}"`,
        detectedPatterns,
      };
    }
  }

  // Check missing hook patterns
  for (const pattern of MISSING_HOOK_PATTERNS) {
    if (pattern.test(fullText)) {
      detectedPatterns.push(pattern.source);
      return {
        classification: "blocked_by_missing_test_hook",
        isAutomatable: false,
        reason: `Requires test hook that doesn't exist: pattern matched "${pattern.source}"`,
        detectedPatterns,
      };
    }
  }

  // If no blocking patterns found, classify as automatable
  return {
    classification: "automatable_ui",
    isAutomatable: true,
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
      });
    }
  }

  console.log(
    `[automatability-filter] total=${scenarios.length} automatable=${automatable.length} excluded=${excluded.length}`
  );

  return { automatable, excluded };
}
