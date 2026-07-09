import type { McpScenario, ScenarioValidationResult, McpRouteProfile } from "./scenario-types";
import { detectMojibake } from "./target-normalization";
import { detectOptionFlows, type OptionFlow } from "./hu-scope-guard";

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
  /^(\d+[\.)]\s*)?Validar que no se muestre\s+"/i,
  /^(\d+[\.)]\s*)?Validar que se muestre\s+(la secci[oó]n|el texto)\s+"/i, // Sections and text
  /^(\d+[\.)]\s*)?Validar que no se muestre\s+(la secci[oó]n|el texto)\s+"/i,
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
  if (/Validar que no se muestre/i.test(trimmed)) {
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

/**
 * Validate that private/authenticated HUs do not jump from public entry to private content
 * without the required private/auth navigation path.
 */
function validatePrivateRouteJumps(
  scenario: McpScenario,
  huDrivenNavigationPath?: string[] | null,
): string | null {
  if (!scenario.steps || scenario.steps.length < 2) return null;

  const stepsLower = scenario.steps.map(s => s.normalize("NFC").toLowerCase());

  // Detect if scenario starts with an action step (click) that looks public/non-private
  // and then directly validates private content without intermediate private navigation
  if (huDrivenNavigationPath && huDrivenNavigationPath.length > 0) {
    // If a HU-driven path exists, the scenario should include its labels in the first steps
    const requiredLabels = huDrivenNavigationPath
      .map(s => s.match(/clic\s+en\s+"([^"]+)"/i))
      .filter(Boolean)
      .map(m => m![1].normalize("NFC").toLowerCase().trim());

    if (requiredLabels.length === 0) return null;

    // Check if the scenario starts with navigation that doesn't match any required label
    const firstClickStep = stepsLower.find(s => s.startsWith("clic en "));
    if (firstClickStep) {
      const firstClickLabel = firstClickStep.replace(/clic en "([^"]+)".*/, "$1").normalize("NFC").toLowerCase().trim();
      const matchesAnyRequired = requiredLabels.some(l => firstClickLabel.includes(l) || l.includes(firstClickLabel));
      if (!matchesAnyRequired) {
        return `rejectedInvalidRouteJump: Scenario starts with "${firstClickLabel}" which is not in the required private/auth navigation path.`;
      }
    }
  }

  return null;
}

function validateEntrySteps(
  scenario: McpScenario,
  routeProfile: McpRouteProfile | null,
  huDrivenNavigationPath?: string[] | null,
  functionalScope?: string,
  optionFlows?: OptionFlow[],
  authenticatedPrecondition?: boolean,
  effectiveIntent?: string,
): string | null {
  // If HU has multiple option flows, entry validation is option-dependent, not global
  if (optionFlows && optionFlows.length > 1) {
    return null; // No global entry requirement when options vary outcomes
  }

  // Skip catalog entry validation for non-catalog intents
  // RouteProfile entries like "Información de productos" belong to catalog domains
  // and must not be enforced for transactional/private/balance HUs
  const isNonCatalog = effectiveIntent
    && effectiveIntent !== "catalog_listing_flow"
    && effectiveIntent !== "product_detail_flow";
  if (isNonCatalog) {
    console.log(`[scenario-validation] skippedEntryStep reason=non_catalog_intent effectiveIntent=${effectiveIntent} requiredEntrySource=none_catalogRouteProfileEntrySkipped`);
    return null;
  }

  if (huDrivenNavigationPath) {
    // Use HU-driven navigation path if available (e.g., for private HU with selectedPath)
    if (!scenario.steps || scenario.steps.length === 0) return null;

    const requiredEntryLabels: string[] = [];
    for (const navStep of huDrivenNavigationPath) {
      const match = navStep.match(/[""]([^""]+)[""]|['']([^'']+)['']/);
      if (match) {
        const label = match[1] || match[2];
        if (label && label.length > 0) {
          requiredEntryLabels.push(label);
        }
      }
    }

    if (requiredEntryLabels.length === 0) return null;

    // Verify all required entry labels appear in the first N steps
    const firstNSteps = scenario.steps.slice(0, requiredEntryLabels.length + 2).join(" ");

    const missingLabels: string[] = [];
    for (const label of requiredEntryLabels) {
      if (!firstNSteps.includes(`"${label}"`) && !firstNSteps.includes(`'${label}'`)) {
        missingLabels.push(label);
      }
    }

    if (missingLabels.length > 0) {
      return `missing_required_entry_step: Faltan los pasos obligatorios iniciales: ${missingLabels.map((l) => `Clic en "${l}"`).join(", ")}.`;
    }

    return null;
  }

  // Skip routeProfile-based entry validation for private/authenticated HUs
  // Private HUs have their own navigation context (authenticated session, selected path)
  // Forcing public entry steps from another HU or routeProfile would corrupt the flow
  if (authenticatedPrecondition) {
    console.log(`[scenario-validation] skippedEntryStep reason=private_or_authenticated_scope source=authenticatedPrecondition`);
    return null;
  }
  if (functionalScope === "private_transactional") {
    console.log(`[scenario-validation] skippedEntryStep reason=private_or_authenticated_scope source=functionalScope`);
    return null;
  }

  // Fallback to routeProfile validation if no HU-driven path
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

  // NEW: For entry_navigation scope, do NOT require all routeProfile.entry labels
  // Only require them if explicitly needed for this scenario
  if (functionalScope !== "entry_navigation" && routeProfile.entry && routeProfile.entry.length > 0) {
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

/**
 * NEW: Validate scenario against HU scope - reject if uses blocked expansion terms.
 * @param scenario - Scenario to validate
 * @param blockedTerms - Terms from HU scope guard that should NOT appear in scenario
 * @returns error message if scenario violates scope, null if valid
 */
function validateAgainstHuScope(scenario: McpScenario, blockedTerms?: string[]): string | null {
  if (!blockedTerms || blockedTerms.length === 0) {
    return null; // No blocked terms = no scope validation
  }

  const scenarioText = [
    scenario.title,
    scenario.expectedResult,
    ...(scenario.steps || []).map(s => String(s)),
    ...(scenario.preconditions || []),
    scenario.type,
    scenario.routeProfile,
  ]
    .join(" ")
    .toLowerCase();

  for (const term of blockedTerms) {
    if (scenarioText.includes(term.toLowerCase())) {
      return `Scenario uses blocked expansion term: "${term}" not mentioned in HU scope`;
    }
  }

  return null;
}

/**
 * Validate scenario against detected option flows.
 * Checks if scenario covers an option and validates coherence between title/steps/result.
 */
function validateOptionCoverage(scenario: McpScenario, optionFlows?: OptionFlow[]): string | null {
  if (!optionFlows || optionFlows.length <= 1) {
    return null; // No option coverage validation needed for single-option HUs
  }

  const scenarioText = [scenario.title, scenario.expectedResult, ...(scenario.steps || [])]
    .join(" ")
    .toLowerCase();

  // Find which options have actual click steps (not just mentions in title/result)
  const optionLabelsLower = optionFlows.map(f => f.optionLabel.toLowerCase());
  const clickedOptions = optionFlows.filter(flow => {
    const label = flow.optionLabel.toLowerCase();
    return (scenario.steps || []).some(step => {
      const stepLower = step.toLowerCase();
      return /clic\s+en/i.test(stepLower) && stepLower.includes(label);
    });
  });

  // Branch exclusivity: if more than one option flow is clicked, reject
  if (clickedOptions.length > 1) {
    const clickedNames = clickedOptions.map(o => o.optionLabel).join(", ");
    return `branch_conflict: Scenario has clicks on multiple alternative options: ${clickedNames}. Each scenario must target a single option.`;
  }

  // Prohibition: if explicit optionLabels exist, must NOT use ordinal/generic selection like
  // "Seleccionar el primer elemento visible del listado" as a substitute for clicking a named option
  const hasOrdinalSelection = (scenario.steps || []).some(step =>
    /^(\d+[\.)]\s*)?Seleccionar\s+(el\s+)?(primer|primera|[uú]ltimo|[uú]ltima)\s+/i.test(step)
  );
  if (hasOrdinalSelection && optionFlows.some(f => f.optionLabel && f.optionLabel.length > 0)) {
    return `ordinal_selection_prohibited: Scenario uses ordinal selection (e.g., "Seleccionar el primer elemento visible") but explicit option labels exist in the HU. Use "Clic en '<optionLabel>'" instead.`;
  }

  // Find which options are mentioned anywhere in the scenario
  const mentionedOptions = optionFlows.filter(flow =>
    scenarioText.includes(flow.optionLabel.toLowerCase())
  );

  if (mentionedOptions.length === 0) {
    return null; // Scenario doesn't target a specific option
  }

  // If multiple options mentioned but none clicked → it's an options-screen validation scenario (no selection)
  if (mentionedOptions.length > 1 && clickedOptions.length === 0) {
    return null; // Scenario describes the options menu itself, not a selection
  }

  const targetOption = clickedOptions.length > 0 ? clickedOptions[0] : mentionedOptions[0];

  // Validation: if scenario mentions an option specifically in title/result, it must CLICK it
  if (clickedOptions.length === 0) {
    return `option_coverage_missing_click: Scenario mentions option "${targetOption.optionLabel}" in title/result but steps don't contain a Clic en "${targetOption.optionLabel}" step.`;
  }

  // Validation: if option requires auth, scenario must validate auth appearance
  if (targetOption.requiresAuth) {
    const hasAuthValidation = (scenario.steps || []).some(step =>
      /validar\s+que\s+se\s+muestre/i.test(step) &&
      /autenticaci[óo]n|identificaci[óo]n|login|flujo/i.test(step)
    );

    if (!hasAuthValidation) {
      return `option_coverage_missing_auth_validation: Option "${targetOption.optionLabel}" requires authentication but scenario doesn't validate auth/identification flow appearance.`;
    }
  }

  return null;
}

/**
 * Detect missing option flow coverage in scenario batch
 */
export function findMissingOptionFlowCoverage(scenarios: McpScenario[], optionFlows?: OptionFlow[]): Array<{
  option: OptionFlow;
  shouldHaveSceario: boolean;
}> {
  if (!optionFlows || optionFlows.length <= 1) {
    return [];
  }

  const missing = optionFlows
    .filter(flow => {
      const hasCoverage = scenarios.some(scenario => {
        const text = [scenario.title, ...(scenario.steps || [])]
          .join(" ")
          .toLowerCase();
        return text.includes(flow.optionLabel.toLowerCase()) && /clic\s+en/i.test(text);
      });
      return !hasCoverage;
    })
    .map(flow => ({
      option: flow,
      shouldHaveSceario: true,
    }));

  if (missing.length > 0) {
    console.log(`[scenario-coverage] missingOptionFlows count=${missing.length}`);
    for (const m of missing) {
      console.log(`[scenario-coverage] missingOptionFlow option="${m.option.optionLabel}" action=create_fallback`);
    }
  }

  return missing;
}

export function validateScenario(
  scenario: McpScenario,
  routeProfile?: McpRouteProfile | null,
  huDrivenNavigationPath?: string[] | null,
  functionalScope?: string,
  optionFlows?: OptionFlow[],
  authenticatedPrecondition?: boolean,
  effectiveIntent?: string,
): ScenarioValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!scenario.title || scenario.title.trim().length === 0) {
    errors.push("title is required");
  }

  // Entry step validation (prefers HU-driven path if available)
  if (huDrivenNavigationPath && huDrivenNavigationPath.length > 0) {
    console.log(`[scenario-validator] using hu_driven_navigation_path entries=${huDrivenNavigationPath.length} ignoring_public_route_profile`);
  }
  const entryError = validateEntrySteps(scenario, routeProfile ?? null, huDrivenNavigationPath, functionalScope, optionFlows, authenticatedPrecondition, effectiveIntent);
  if (entryError) {
    errors.push(entryError);
  }

  // Product-specific validation
  const productError = validateProductRules(scenario, routeProfile ?? null);
  if (productError) {
    errors.push(productError);
  }

  // Validate against invalid public-to-private jumps
  // For private/authenticated HUs, scenarios should not jump from public entry directly to private content
  if (authenticatedPrecondition || functionalScope === "private_transactional") {
    const jumpError = validatePrivateRouteJumps(scenario, huDrivenNavigationPath);
    if (jumpError) {
      errors.push(jumpError);
    }
  }

  // Option flow coverage validation (for multi-option HUs)
  const optionError = validateOptionCoverage(scenario, optionFlows);
  if (optionError) {
    errors.push(optionError);
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
