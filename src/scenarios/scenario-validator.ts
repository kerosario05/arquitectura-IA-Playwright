import type { McpScenario, ScenarioValidationResult, McpRouteProfile } from "./scenario-types";
import { detectMojibake } from "./target-normalization";

const ALLOWED_AUTOMATION_TYPES = [
  "ui_discovery",
  "ui_with_auth_gate",
  "ui_with_controlled_data",
  "ui_with_auth_gate_controlled_data",
];

const ALLOWED_SETUP_STRATEGIES = [
  "self_contained",
  "auth_gate",
  "controlled_data",
  "no_login",
];

const FORBIDDEN_PHRASES = [
  /otp/i,
  /password/i,
  /contrase/i,
  /pin\b/i,
  /c[eé]dula literal/i,
  /\btoken\b/i,
  /base de datos/i,
  /core banking/i,
  /backend/i,
  /\bapi\b/i,
  /\blog\b/i,
  /auditor/i,
  /c[aá]lculo exacto/i,
  /validar backend/i,
  /validar core banking/i,
  /validar base de datos/i,
  /validar c[aá]lculo exacto/i,
  /validar reglas de negocio/i,
  /validar integraci[oó]n/i,
  /validar auditor/i,
  /validar que se registr[oó]/i,
  /el sistema permite/i,
  /el cliente accede/i,
  /validar correctamente/i,
  /verificar que funcione/i,
  /se procesa exitosamente/i,
  /seg[uú]n configuraci[oó]n/i,
  /cuando aplique/i,
];

const SENSITIVE_ACTION_VERBS = [
  /\bSolicitar\b/i,
  /\bPagar\b/i,
  /\bTransferir\b/i,
  /\bContratar\b/i,
  /\bConfirmar\b/i,
  /\bAutorizar\b/i,
  /\bAprobar\b/i,
  /\bFirmar\b/i,
  /\bEnviar\b/i,
  /\bAceptar contrato\b/i,
  /\bDebitar\b/i,
  /\bEliminar\b/i,
  /\bCancelar producto\b/i,
];

const MCP_STEP_VERBS = [
  /^(\d+[\.)]\s*)?Clic en\s+"/i,
  /^(\d+[\.)]\s*)?Validar que se muestre\s+"/i,
  /^(\d+[\.)]\s*)?Validar que se muestre\s+(la secci[oó]n|el texto)\s+"/i, // Sections and text
  /^(\d+[\.)]\s*)?Validar que el bot[oó]n\s+".*"\s+est[eé]\s+(visible|habilitado|deshabilitado)/i,
  /^(\d+[\.)]\s*)?Validar que la opci[oó]n\s+".*"\s+est[eé]\s+disponible/i,
  /^(\d+[\.)]\s*)?Esperar que se muestre\s+"/i,
  /^(\d+[\.)]\s*)?Seleccionar el (primer|primera|[uú]ltimo|[uú]ltima)\s+[\w\u00C0-\u024F\s]+?\s+visible del listado/i,
  /^(\d+[\.)]\s*)?Seleccionar la (primera|[uú]ltima)\s+[\w\u00C0-\u024F\s]+?\s+visible del listado/i,
  /^(\d+[\.)]\s*)?Ingresar\s+\S+\s+usando\s+\S+/i,
  /^(\d+[\.)]\s*)?Volver/i,
  /^(\d+[\.)]\s*)?Regresar/i,
  /^(\d+[\.)]\s*)?Atr[aá]s/i,
];

function isNumbered(step: string): boolean {
  return /^\d+[\.)]\s+/.test(step.trim());
}

function containsForbiddenPhrase(text: string): string | null {
  for (const pattern of FORBIDDEN_PHRASES) {
    if (pattern.test(text)) {
      return `Contains forbidden phrase matching: ${pattern.source}`;
    }
  }
  return null;
}

function containsSensitiveAction(step: string): string | null {
  const trimmed = step.trim();

  // Allow if it's a validation context (checking visibility/state of a sensitive button)
  if (/Validar que.*est[eé]\s+(visible|habilitado|deshabilitado|disponible)/i.test(trimmed)) {
    return null;
  }
  if (/Validar que se muestre/i.test(trimmed)) {
    return null;
  }
  if (/Esperar que se muestre/i.test(trimmed)) {
    return null;
  }

  // Block imperative sensitive actions (Clic en "Solicitar", Seleccionar "Solicitar", etc.)
  // Only check if it's an executable action, NOT a validation/assertion
  const isExecutableAction = /^(\d+[\.)]\s*)?(Clic en|Seleccionar|Hacer clic en)\s+["']/i.test(trimmed);

  if (isExecutableAction) {
    for (const verb of SENSITIVE_ACTION_VERBS) {
      if (verb.test(trimmed)) {
        return `sensitive_action_not_allowed: No se permite ejecutar "${trimmed.slice(0, 80)}" por defecto. Use validación de visibilidad (e.g., "Validar que el botón esté visible").`;
      }
    }
  }

  return null;
}

function matchesMcpPattern(step: string): boolean {
  const trimmed = step.trim();
  return MCP_STEP_VERBS.some((re) => re.test(trimmed));
}

function validateEntrySteps(scenario: McpScenario, routeProfile: McpRouteProfile | null): string | null {
  if (!routeProfile) return null;
  if (!scenario.steps || scenario.steps.length === 0) return null;

  const requiredEntryLabelsSet = new Set<string>();

  // Collect entry steps (optional pre-functional steps)
  if (routeProfile.entrySteps) {
    for (const entryStep of routeProfile.entrySteps) {
      if (entryStep.action === "click" && entryStep.target) {
        requiredEntryLabelsSet.add(entryStep.target);
      }
    }
  }

  // Collect entry labels (required navigation entry points)
  if (routeProfile.entry && routeProfile.entry.length > 0) {
    for (const entryPoint of routeProfile.entry) {
      if (entryPoint.visibleLabel) {
        requiredEntryLabelsSet.add(entryPoint.visibleLabel);
      }
    }
  }

  const requiredEntryLabels = Array.from(requiredEntryLabelsSet);

  if (requiredEntryLabels.length === 0) return null;

  // Verify all required entry labels appear in the first N steps of the scenario
  // where N = number of required entry labels
  const firstNSteps = scenario.steps.slice(0, requiredEntryLabels.length + 2).join(" ");

  const missingLabels: string[] = [];
  for (const label of requiredEntryLabels) {
    // Check with quotes (standard MCP format)
    if (!firstNSteps.includes(`"${label}"`) && !firstNSteps.includes(`'${label}'`)) {
      missingLabels.push(label);
    }
  }

  if (missingLabels.length > 0) {
    return `missing_required_entry_step: Faltan los pasos obligatorios iniciales: ${missingLabels.map((l) => `Clic en "${l}"`).join(", ")}.`;
  }

  return null;
}

/**
 * Validate product-specific rules against discovered products in routeProfile
 *
 * Checks:
 * - Clicks on product cards respect clickableToDetail flag
 * - Product navigation follows discovered paths
 * - Product names match discovered catalog
 */
function validateProductRules(scenario: McpScenario, routeProfile: McpRouteProfile | null): string | null {
  if (!routeProfile || !routeProfile.targetPaths) {
    return null; // No validation if no route profile
  }

  // Extract discovered products from targetPaths
  const discoveredProducts = Object.entries(routeProfile.targetPaths)
    .filter(([_, tp]: [string, any]) => tp.productMetadata && tp.source === "runtime_discovery")
    .map(([target, tp]: [string, any]) => ({
      target,
      normalizedTarget: target.toLowerCase(),
      presentationType: tp.productMetadata?.presentationType || "unknown",
      clickableToDetail: tp.productMetadata?.clickableToDetail ?? true, // Default true for backward compat
      validationStatus: tp.productMetadata?.validationStatus,
    }));

  if (discoveredProducts.length === 0) {
    return null; // No products to validate against
  }

  // Check each step for product clicks
  for (const step of scenario.steps || []) {
    const clickMatch = step.match(/Clic en [""]([^""]+)[""]|Clic en ['']([^'']+)['']/i);
    if (!clickMatch) continue;

    const clickTarget = (clickMatch[1] || clickMatch[2]).trim();
    const normalizedTarget = clickTarget.toLowerCase();

    // Find matching product
    const matchedProduct = discoveredProducts.find(
      (p) => p.normalizedTarget === normalizedTarget || p.target === clickTarget
    );

    if (!matchedProduct) continue; // Not a product click

    // Check if it's a product_card that's not clickable
    if (
      matchedProduct.presentationType === "product_card" &&
      matchedProduct.clickableToDetail === false
    ) {
      return `Cannot click on product card "${matchedProduct.target}" - it's marked as not clickable (clickableToDetail=false). Use validation instead: "Validar que se muestre \\"${matchedProduct.target}\\""`;
    }
  }

  return null;
}

export function validateScenario(scenario: McpScenario, routeProfile?: McpRouteProfile | null): ScenarioValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!scenario.title || scenario.title.trim().length === 0) {
    errors.push("title is required");
  }

  // Entry step validation
  const entryError = validateEntrySteps(scenario, routeProfile ?? null);
  if (entryError) {
    errors.push(entryError);
  }

  // Product-specific validation
  const productError = validateProductRules(scenario, routeProfile ?? null);
  if (productError) {
    errors.push(productError);
  }

  if (!scenario.steps || scenario.steps.length === 0) {
    errors.push("steps must not be empty");
  } else {
    for (let i = 0; i < scenario.steps.length; i++) {
      // CRITICAL: Apply mojibake correction before validation
      const rawStep = scenario.steps[i];
      const mojibakeResult = detectMojibake(rawStep);
      const step = mojibakeResult.corrected;

      if (mojibakeResult.hasMojibake) {
        console.log(
          `[validator:mojibake] corrected step ${i + 1}: "${rawStep.substring(0, 50)}" → "${step.substring(0, 50)}"`
        );
      }

      if (!isNumbered(step)) {
        errors.push(`Step ${i + 1} is not numbered: "${step.slice(0, 60)}..."`);
      }

      if (!matchesMcpPattern(step)) {
        errors.push(`Step ${i + 1} does not match MCP pattern: "${step.slice(0, 60)}..."`);
      }

      const forbidden = containsForbiddenPhrase(step);
      if (forbidden) {
        errors.push(`Step ${i + 1}: ${forbidden}`);
      }

      const sensitive = containsSensitiveAction(step);
      if (sensitive) {
        errors.push(`Step ${i + 1}: ${sensitive}`);
      }
    }
  }

  if (!ALLOWED_AUTOMATION_TYPES.includes(scenario.automationType)) {
    errors.push(`Invalid automationType: "${scenario.automationType}". Allowed: ${ALLOWED_AUTOMATION_TYPES.join(", ")}`);
  }

  if (!ALLOWED_SETUP_STRATEGIES.includes(scenario.setupStrategy)) {
    errors.push(`Invalid setupStrategy: "${scenario.setupStrategy}". Allowed: ${ALLOWED_SETUP_STRATEGIES.join(", ")}`);
  }

  if (scenario.mcpExecutable !== true) {
    errors.push("mcpExecutable must be true");
  }

  if (scenario.expectedResult && scenario.expectedResult.length > 300) {
    warnings.push("expectedResult is unusually long (may introduce new targets)");
  }

  if (scenario.preconditions && scenario.preconditions.length > 0) {
    const hasAuthGate = scenario.preconditions.some((p) => /AuthGate|AuthFlow/i.test(p));
    if (scenario.automationType.includes("auth_gate") && !hasAuthGate) {
      warnings.push("AuthGate/AuthFlow not mentioned in preconditions for auth_gate scenario");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateScenarios(scenarios: McpScenario[], routeProfile?: McpRouteProfile | null): Array<{ scenario: McpScenario; validation: ScenarioValidationResult }> {
  return scenarios.map((s) => ({
    scenario: s,
    validation: validateScenario(s, routeProfile),
  }));
}
