/**
 * Scenario Mode Classifier
 *
 * Analyzes HU/Jira intent text and validates backing against route profile
 * to classify the scenario mode and determine if generation can proceed.
 */

import type { McpRouteProfile, ScenarioMode, ScenarioModeClassification, RouteConfidence } from "./scenario-types";

/**
 * Intent detection keywords for each scenario mode
 */
const MODE_KEYWORDS: Record<ScenarioMode, string[]> = {
  // Priority: Check return_navigation before detail_navigation
  return_navigation: [
    "volver",
    "regresar",
    "retornar al listado",
    "volver a la lista",
    "retornar a",
    "volver atras",
    "volver después",
    "después de ver"
  ],
  detail_navigation: [
    "detalle",
    "información del producto",
    "información de la tarjeta",
    "información del préstamo",
    "información del producto",
    "información de la cuenta",
    "visualizar campos",
    "ver datos del producto",
    "ver información",
    "información detallada",
    "visualizar información"
  ],
  listing_validation: [
    "validar que se muestre",
    "validar que se muestren",
    "listar",
    "listado de",
    "opciones disponibles",
    "categorías disponibles",
    "productos disponibles",
    "ver opciones",
    "mostrar categorías"
  ],
  subcategory_navigation: [
    "navegar",
    "acceder a",
    "ir a",
    "entrar a",
    "abrir"
  ],
  action_button_validation: [
    "botón solicitar",
    "botón pagar",
    "botón transferir",
    "botón confirmar",
    "validar botón",
    "verificar botón",
    "verificar que el botón"
  ],
  unknown: []
};

/**
 * Sensitive action keywords that indicate validation-only scenarios
 */
const SENSITIVE_ACTIONS = [
  "solicitar",
  "pagar",
  "transferir",
  "contratar",
  "confirmar",
  "autorizar",
  "aprobar",
  "firmar",
  "enviar",
  "debitar",
  "eliminar"
];

/**
 * Normalize text for keyword matching (lowercase, no accents)
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Detect scenario mode from HU text intent
 * Priority order matters: check return_navigation before detail_navigation
 */
function detectModeFromIntent(huText: string): ScenarioMode {
  const normalized = normalizeText(huText);

  // Check sensitive actions first → action_button_validation
  for (const action of SENSITIVE_ACTIONS) {
    if (normalized.includes(action) && normalized.includes("boton")) {
      return "action_button_validation";
    }
  }

  // Check modes in priority order
  const orderedModes: ScenarioMode[] = [
    "return_navigation",  // Check first (more specific)
    "detail_navigation",
    "listing_validation",
    "subcategory_navigation",
    "action_button_validation"
  ];

  for (const mode of orderedModes) {
    const keywords = MODE_KEYWORDS[mode];
    for (const keyword of keywords) {
      if (normalized.includes(normalizeText(keyword))) {
        return mode;
      }
    }
  }

  return "unknown";
}

/**
 * Calculate required route depth for a scenario mode
 */
function getRequiredRouteDepth(mode: ScenarioMode): number {
  switch (mode) {
    case "listing_validation":
      return 1; // Entry + list
    case "subcategory_navigation":
      return 2; // Entry + intermediates
    case "detail_navigation":
      return 3; // Entry + list + detail
    case "return_navigation":
      return 3; // Entry + list + detail (+ return)
    case "action_button_validation":
      return 1; // Entry + context
    case "unknown":
      return 0;
  }
}

/**
 * Validate if route profile has backing for the required mode
 */
function validateRouteBacking(
  mode: ScenarioMode,
  routeProfile: McpRouteProfile | null
): { hasBacking: boolean; missingSteps: string[] } {
  const missingSteps: string[] = [];

  if (!routeProfile) {
    return { hasBacking: false, missingSteps: ["routeProfile"] };
  }

  // Check entry steps exist
  if (!routeProfile.entry || routeProfile.entry.length === 0) {
    missingSteps.push("entry");
  }

  switch (mode) {
    case "listing_validation":
      // Need entry + list target
      if (routeProfile.visibleControls.length === 0) {
        missingSteps.push("list_target");
      }
      break;

    case "subcategory_navigation":
      // Need entry + intermediates
      if (Object.keys(routeProfile.intermediates || {}).length === 0) {
        missingSteps.push("intermediates");
      }
      break;

    case "detail_navigation":
      // Need entry + list + detail (domainTerm for selection)
      if (routeProfile.visibleControls.length === 0) {
        missingSteps.push("list_target");
      }
      if (Object.keys(routeProfile.domainTerms || {}).length === 0) {
        missingSteps.push("domainTerm_for_selection");
      }
      break;

    case "return_navigation":
      // Need entry + list + detail + return control
      if (routeProfile.visibleControls.length === 0) {
        missingSteps.push("list_target");
      }
      if (Object.keys(routeProfile.domainTerms || {}).length === 0) {
        missingSteps.push("domainTerm_for_selection");
      }
      const hasReturnControl = routeProfile.visibleControls.some(
        control => normalizeText(control).includes("volver")
      );
      if (!hasReturnControl) {
        missingSteps.push("return_control");
      }
      break;

    case "action_button_validation":
      // Need entry + sensitive button in visibleControls
      const hasSensitiveButton = routeProfile.visibleControls.some(control => {
        const normalized = normalizeText(control);
        return SENSITIVE_ACTIONS.some(action => normalized.includes(action));
      });
      if (!hasSensitiveButton) {
        missingSteps.push("sensitive_button");
      }
      break;

    case "unknown":
      // Cannot validate unknown mode
      missingSteps.push("unclear_intent");
      break;
  }

  return {
    hasBacking: missingSteps.length === 0,
    missingSteps
  };
}

/**
 * Assign confidence level based on backing completeness
 */
function assignConfidence(
  mode: ScenarioMode,
  hasBacking: boolean,
  missingSteps: string[]
): RouteConfidence {
  if (mode === "unknown") {
    return "low";
  }

  if (hasBacking) {
    return "high";
  }

  // Entry exists but missing some elements
  if (missingSteps.includes("routeProfile") || missingSteps.includes("entry")) {
    return "low";
  }

  // Missing intermediate or domainTerm → medium confidence
  if (
    missingSteps.includes("intermediates") ||
    missingSteps.includes("domainTerm_for_selection")
  ) {
    return "medium";
  }

  // Missing critical elements → low confidence
  return "low";
}

/**
 * Classify scenario mode from HU text and route profile
 *
 * @param huText - HU/Jira description text (functional intent)
 * @param routeProfile - App route profile with backing evidence
 * @returns ScenarioModeClassification with mode, confidence, and backing info
 */
export function classifyScenarioMode(
  huText: string,
  routeProfile: McpRouteProfile | null
): ScenarioModeClassification {
  // Detect mode from intent
  const mode = detectModeFromIntent(huText);

  // Calculate required depth
  const requiredRouteDepth = getRequiredRouteDepth(mode);

  // Validate backing
  const { hasBacking, missingSteps } = validateRouteBacking(mode, routeProfile);

  // Assign confidence
  const confidence = assignConfidence(mode, hasBacking, missingSteps);

  return {
    mode,
    confidence,
    requiredRouteDepth,
    hasBacking,
    missingSteps
  };
}
