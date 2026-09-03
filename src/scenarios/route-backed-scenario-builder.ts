/**
 * Route-Backed Scenario Builder
 *
 * Builds executable MCP steps from validated route profiles.
 * All navigation comes from route profile, not from HU text.
 */

import type { McpRouteProfile, ScenarioMode } from "./scenario-types";

/**
 * Normalize text for label matching (lowercase, no accents)
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Build entry steps from route profile
 */
function buildEntrySteps(routeProfile: McpRouteProfile): string[] {
  if (!routeProfile.entry || routeProfile.entry.length === 0) {
    return [];
  }

  return routeProfile.entry.map((entry, index) => {
    const stepNum = index + 1;
    return `${stepNum}. Clic en "${entry.visibleLabel}".`;
  });
}

/**
 * Extract list target from HU intent - only from backed navigation targets
 *
 * CRITICAL: Do NOT treat all visibleControls as navigation targets.
 * Only use targets that are backed by entry/intermediates/targetPaths.
 * Content terms should only be used for validations, not clicks.
 */
function extractListTarget(
  huIntent: string,
  routeProfile: McpRouteProfile,
  allowedNavigationTargets: string[]
): string | null {
  const normalized = normalizeText(huIntent);

  // Try to match against backed navigation targets only
  for (const target of allowedNavigationTargets) {
    if (normalized.includes(normalizeText(target))) {
      return target;
    }
  }

  // Try to match against intermediates (these are navigation targets)
  if (routeProfile.intermediates) {
    for (const hints of Object.values(routeProfile.intermediates)) {
      if (Array.isArray(hints)) {
        for (const hint of hints) {
          if (normalized.includes(normalizeText(hint))) {
            return hint;
          }
        }
      }
    }
  }

  // Fallback: use first backed navigation target if available
  if (allowedNavigationTargets.length > 0) {
    return allowedNavigationTargets[0];
  }

  return null;
}

/**
 * Extract domain term for ordinal selection
 */
function extractDomainTerm(routeProfile: McpRouteProfile): string {
  const domainTerms = routeProfile.domainTerms || {};

  // Prefer "producto" if available
  if (domainTerms.producto) {
    return "producto";
  }

  // Otherwise use first available domain term
  const firstKey = Object.keys(domainTerms)[0];
  if (firstKey) {
    return firstKey;
  }

  // Fallback to generic term
  return "elemento";
}

/**
 * Build listing validation steps
 */
function buildListingValidationSteps(
  routeProfile: McpRouteProfile,
  huIntent: string,
  allowedNavigationTargets: string[]
): string[] {
  const steps = buildEntrySteps(routeProfile);
  let stepNum = steps.length + 1;
  const visibleControls = Array.isArray(routeProfile.visibleControls)
    ? routeProfile.visibleControls
    : [];

  // Navigate to list target if identifiable (only backed targets)
  const listTarget = extractListTarget(huIntent, routeProfile, allowedNavigationTargets);
  if (listTarget) {
    steps.push(`${stepNum}. Clic en "${listTarget}".`);
    stepNum++;
  }

  // Add validations for visible controls that are NOT navigation targets
  visibleControls.forEach(control => {
    // Skip entry labels
    const isEntry = routeProfile.entry.some(e => e.visibleLabel === control);
    // Skip navigation targets (these can be clicked)
    const isNavTarget = allowedNavigationTargets.includes(control);
    // Skip list target (already used for navigation)
    if (!isEntry && !isNavTarget && control !== listTarget) {
      steps.push(`${stepNum}. Validar que se muestre "${control}".`);
      stepNum++;
    }
  });

  return steps;
}

/**
 * Build detail navigation steps
 */
function buildDetailNavigationSteps(
  routeProfile: McpRouteProfile,
  huIntent: string,
  allowedNavigationTargets: string[]
): string[] {
  const steps = buildEntrySteps(routeProfile);
  let stepNum = steps.length + 1;

  // Navigate to list target (only backed targets)
  const listTarget = extractListTarget(huIntent, routeProfile, allowedNavigationTargets);
  if (listTarget) {
    steps.push(`${stepNum}. Clic en "${listTarget}".`);
    stepNum++;
  }

  // Add intermediate navigation if present (e.g., category selection)
  const intermediates = routeProfile.intermediates || {};
  const firstIntermediate = Object.values(intermediates)[0];
  if (firstIntermediate && Array.isArray(firstIntermediate) && firstIntermediate.length > 0) {
    firstIntermediate.forEach(intermediate => {
      steps.push(`${stepNum}. Clic en "${intermediate}".`);
      stepNum++;
    });
  }

  // Add ordinal selection step
  const domainTerm = extractDomainTerm(routeProfile);
  steps.push(`${stepNum}. Seleccionar el primer ${domainTerm} visible del listado.`);
  stepNum++;

  // Add detail field validations (extract from HU intent and visibleControls, excluding nav targets)
  const detailFields = extractDetailFields(huIntent, routeProfile, allowedNavigationTargets);
  detailFields.forEach(field => {
    steps.push(`${stepNum}. Validar que se muestre "${field}".`);
    stepNum++;
  });

  return steps;
}

/**
 * Extract detail fields from HU intent for validation
 *
 * CRITICAL: These are assertion-only targets. Never generate click steps for these.
 * Extract from HU text and visibleControls, but filter out navigation targets.
 */
function extractDetailFields(
  huIntent: string,
  routeProfile: McpRouteProfile,
  allowedNavigationTargets: string[]
): string[] {
  const fields: string[] = [];
  const normalized = normalizeText(huIntent);
  const visibleControls = Array.isArray(routeProfile.visibleControls)
    ? routeProfile.visibleControls
    : [];

  // Common detail field keywords (content terms, not navigation)
  const fieldKeywords = [
    "nombre",
    "descripción",
    "beneficios",
    "requisitos",
    "condiciones",
    "tasa de interés",
    "tasa de interes",
    "plazo",
    "monto",
    "fecha",
    "saldo",
    "información",
    "informacion"
  ];

  // Extract from HU text
  for (const keyword of fieldKeywords) {
    if (normalized.includes(keyword)) {
      // Capitalize first letter
      const capitalized = keyword.charAt(0).toUpperCase() + keyword.slice(1);
      if (!fields.includes(capitalized)) {
        fields.push(capitalized);
      }
    }
  }

  // Extract from visibleControls that are NOT navigation targets
  for (const control of visibleControls) {
    // Skip if it's a backed navigation target
    if (allowedNavigationTargets.includes(control)) {
      continue;
    }

    // Skip entry labels
    const isEntry = routeProfile.entry.some(e => e.visibleLabel === control);
    if (isEntry) {
      continue;
    }

    // Add as validation target
    if (!fields.includes(control)) {
      fields.push(control);
    }
  }

  // If no specific fields found, add generic validations
  if (fields.length === 0) {
    fields.push("Nombre del producto", "Descripción general");
  }

  return fields;
}

/**
 * Build return navigation steps
 */
function buildReturnNavigationSteps(
  routeProfile: McpRouteProfile,
  huIntent: string,
  allowedNavigationTargets: string[]
): string[] {
  // Start with detail navigation steps
  const steps = buildDetailNavigationSteps(routeProfile, huIntent, allowedNavigationTargets);
  let stepNum = steps.length + 1;

  // Add return button validation
  steps.push(`${stepNum}. Validar que el botón "Volver" esté visible.`);
  stepNum++;

  // Add return click
  steps.push(`${stepNum}. Clic en "Volver".`);
  stepNum++;

  // Add list validation after return
  const listTarget = extractListTarget(huIntent, routeProfile, allowedNavigationTargets);
  if (listTarget) {
    steps.push(`${stepNum}. Validar que se muestre "${listTarget}".`);
  }

  return steps;
}

/**
 * Build subcategory navigation steps
 */
function buildSubcategoryNavigationSteps(
  routeProfile: McpRouteProfile,
  huIntent: string,
  allowedNavigationTargets: string[]
): string[] {
  const steps = buildEntrySteps(routeProfile);
  let stepNum = steps.length + 1;

  // Navigate through intermediates
  const intermediates = routeProfile.intermediates || {};
  const firstIntermediate = Object.values(intermediates)[0];
  if (firstIntermediate && Array.isArray(firstIntermediate) && firstIntermediate.length > 0) {
    firstIntermediate.forEach(intermediate => {
      steps.push(`${stepNum}. Clic en "${intermediate}".`);
      stepNum++;
    });
  }

  // Validate final category reached
  const listTarget = extractListTarget(huIntent, routeProfile, allowedNavigationTargets);
  if (listTarget) {
    steps.push(`${stepNum}. Validar que se muestre "${listTarget}".`);
  }

  return steps;
}

/**
 * Build action button validation steps
 */
function buildActionButtonValidationSteps(
  routeProfile: McpRouteProfile,
  huIntent: string,
  allowedNavigationTargets: string[]
): string[] {
  const steps = buildEntrySteps(routeProfile);
  let stepNum = steps.length + 1;

  // Navigate to context where button is visible (only backed targets)
  const listTarget = extractListTarget(huIntent, routeProfile, allowedNavigationTargets);
  if (listTarget) {
    steps.push(`${stepNum}. Clic en "${listTarget}".`);
    stepNum++;
  }

  // Extract sensitive action from HU
  const normalized = normalizeText(huIntent);
  const sensitiveActions = ["Solicitar", "Pagar", "Transferir", "Confirmar", "Autorizar"];
  let actionButton = "Acción";

  for (const action of sensitiveActions) {
    if (normalized.includes(normalizeText(action))) {
      actionButton = action;
      break;
    }
  }

  // Validate button visible (no click)
  steps.push(`${stepNum}. Validar que el botón "${actionButton}" esté visible.`);

  return steps;
}

/**
 * Build executable steps from validated route profile
 *
 * @param mode - Classified scenario mode
 * @param routeProfile - App route profile with backing evidence
 * @param huIntent - HU/Jira description text (for assertion targets only)
 * @param allowedNavigationTargets - Backed targets that can be clicked (from derivedContext)
 * @returns Array of numbered, executable MCP steps
 */
export function buildExecutableSteps(
  mode: ScenarioMode,
  routeProfile: McpRouteProfile,
  huIntent: string,
  allowedNavigationTargets: string[] = []
): string[] {
  switch (mode) {
    case "listing_validation":
      return buildListingValidationSteps(routeProfile, huIntent, allowedNavigationTargets);

    case "detail_navigation":
      return buildDetailNavigationSteps(routeProfile, huIntent, allowedNavigationTargets);

    case "return_navigation":
      return buildReturnNavigationSteps(routeProfile, huIntent, allowedNavigationTargets);

    case "subcategory_navigation":
      return buildSubcategoryNavigationSteps(routeProfile, huIntent, allowedNavigationTargets);

    case "action_button_validation":
      return buildActionButtonValidationSteps(routeProfile, huIntent, allowedNavigationTargets);

    case "unknown":
      // Cannot build steps for unknown mode
      return [];
  }
}
