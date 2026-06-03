import type { McpScenario, ScenarioValidationResult, McpRouteProfile } from "./scenario-types";

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

  // Block imperative sensitive actions (Clic en "Solicitar", etc.)
  for (const verb of SENSITIVE_ACTION_VERBS) {
    if (verb.test(trimmed)) {
      return `sensitive_action_not_allowed: No se permite ejecutar "${trimmed.slice(0, 80)}" por defecto. Use validación de visibilidad (e.g., "Validar que el botón esté visible").`;
    }
  }

  return null;
}

function matchesMcpPattern(step: string): boolean {
  const trimmed = step.trim();
  return MCP_STEP_VERBS.some((re) => re.test(trimmed));
}

function validateEntrySteps(scenario: McpScenario, routeProfile: McpRouteProfile | null): string | null {
  if (!routeProfile || !routeProfile.entry || routeProfile.entry.length === 0) return null;
  if (!scenario.steps || scenario.steps.length === 0) return null;

  const firstStep = scenario.steps[0].trim();
  const firstEntryLabel = routeProfile.entry[0]?.visibleLabel;

  if (!firstEntryLabel) return null;

  // Check if the first step references the first entry label
  if (!firstStep.includes(`"${firstEntryLabel}"`)) {
    return `missing_required_entry_step: Falta el paso obligatorio inicial: Clic en "${firstEntryLabel}".`;
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

  if (!scenario.steps || scenario.steps.length === 0) {
    errors.push("steps must not be empty");
  } else {
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];

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
