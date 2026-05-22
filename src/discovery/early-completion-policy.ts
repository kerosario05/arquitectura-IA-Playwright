import type { ActionTargetItem } from "./step-intent-parser";
import type { AuthGateState } from "./auth-step-classifier";

export type PendingActionClassification = "authConsumed" | "optional" | "duplicateAlreadyExecuted" | "functionalRequired";

export type ClassifiedPendingAction = {
  target: string;
  action: string;
  index: number;
  classification: PendingActionClassification;
  reason?: string;
};

export type EarlyCompletionClassification = {
  authConsumed: ClassifiedPendingAction[];
  optional: ClassifiedPendingAction[];
  duplicateAlreadyExecuted: ClassifiedPendingAction[];
  functionalRequired: ClassifiedPendingAction[];
};

export type EarlyCompletionPolicyResult = {
  allowed: boolean;
  reason: string;
  classification: EarlyCompletionClassification;
  pendingFunctionalTargets: string[];
  ignoredAuthConsumedTargets: string[];
  diagnostics: {
    evaluated: boolean;
    allowed: boolean;
    reason: string;
    pendingFunctionalTargets: string[];
    ignoredAuthConsumedTargets: string[];
    satisfiedAssertions: string[];
    pendingActions: string[];
    classifications: {
      authConsumed: string[];
      optional: string[];
      duplicateAlreadyExecuted: string[];
      functionalRequired: string[];
    };
    executedStepIndices: number[];
  };
};

const AUTH_CONSUMED_KEYWORDS = [
  "cédula de identidad dominicana",
  "cedula de identidad dominicana",
  "pasaporte extranjero",
  "tipo de identificación",
  "tipo de identificacion",
  "identificación del cliente",
  "identificacion del cliente",
  "número de identificación",
  "numero de identificación",
  "numero de identificacion",
  "ingrese el número",
  "ingrese el numero",
  "confirmar número de teléfono",
  "confirmar numero de teléfono",
  "confirmar numero de telefono",
  "teléfono registrado",
  "telefono registrado",
  "código otp",
  "codigo otp",
  "código de verificación",
  "codigo de verificacion",
  "confirmar código",
  "confirmar codigo",
  "reenviar código",
  "reenviar codigo",
  "usuario",
  "username",
  "contraseña",
  "password",
  "pin",
  "token",
  "código token",
  "codigo token",
  "iniciar sesión",
  "iniciar sesion",
  "acceder",
  "log in",
  "login",
  "correo",
  "email"
];

const AUTH_CONTINUE_VARIANTS = [
  "continuar",
  "confirmar",
  "siguiente",
  "entrar",
  "enviar"
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAuthConsumedKeyword(target: string): boolean {
  const normalized = normalizeText(target);

  for (const keyword of AUTH_CONSUMED_KEYWORDS) {
    if (normalized.includes(normalizeText(keyword))) {
      return true;
    }
  }

  return false;
}

function isAuthContinueVariant(target: string): boolean {
  const normalized = normalizeText(target);
  return AUTH_CONTINUE_VARIANTS.some(v => normalized === normalizeText(v));
}

function isAuthConsumedStep(
  target: string,
  authGateState?: AuthGateState
): boolean {
  if (!authGateState?.completed) {
    return isAuthConsumedKeyword(target);
  }

  if (isAuthConsumedKeyword(target)) {
    return true;
  }

  if (authGateState.authConsumedOpen && isAuthContinueVariant(target)) {
    return true;
  }

  return false;
}

function isAlreadyExecuted(
  action: ActionTargetItem,
  executedStepIndices: Set<number>
): boolean {
  return executedStepIndices.has(action.index);
}

export function classifyPendingActionsForEarlyCompletion(input: {
  pendingActions: ActionTargetItem[];
  executedStepIndices: Set<number>;
  authGateState?: AuthGateState;
  skippedSteps: Array<{ targetText: string; status: string; recoveredBy?: string; index?: number }>;
}): EarlyCompletionClassification {
  const result: EarlyCompletionClassification = {
    authConsumed: [],
    optional: [],
    duplicateAlreadyExecuted: [],
    functionalRequired: []
  };

  const skippedStepIndices = new Set(
    input.skippedSteps
      .filter(s => s.status === "skipped" || s.status === "recovered" || s.recoveredBy === "auth_flow")
      .map(s => s.index)
      .filter((idx): idx is number => idx !== undefined)
  );

  for (const action of input.pendingActions) {
    if (isAlreadyExecuted(action, input.executedStepIndices)) {
      result.duplicateAlreadyExecuted.push({
        target: action.target,
        action: action.action,
        index: action.index,
        classification: "duplicateAlreadyExecuted",
        reason: "already_executed"
      });
      continue;
    }

    if (skippedStepIndices.has(action.index)) {
      result.authConsumed.push({
        target: action.target,
        action: action.action,
        index: action.index,
        classification: "authConsumed",
        reason: "skipped_by_auth_flow"
      });
      continue;
    }

    if (isAuthConsumedStep(action.target, input.authGateState)) {
      result.authConsumed.push({
        target: action.target,
        action: action.action,
        index: action.index,
        classification: "authConsumed",
        reason: "auth_consumed_keyword"
      });
      continue;
    }

    if ((action as any).isOptional === true) {
      result.optional.push({
        target: action.target,
        action: action.action,
        index: action.index,
        classification: "optional",
        reason: "explicitly_optional"
      });
      continue;
    }

    result.functionalRequired.push({
      target: action.target,
      action: action.action,
      index: action.index,
      classification: "functionalRequired",
      reason: "default_functional_action"
    });
  }

  return result;
}

export function evaluateEarlyCompletionPolicy(input: {
  pendingActions: ActionTargetItem[];
  executedStepIndices: Set<number>;
  authGateState?: AuthGateState;
  skippedSteps: Array<{ targetText: string; status: string; recoveredBy?: string; index?: number }>;
  satisfiedAssertions: string[];
  pendingAssertions: string[];
}): EarlyCompletionPolicyResult {
  const classification = classifyPendingActionsForEarlyCompletion({
    pendingActions: input.pendingActions,
    executedStepIndices: input.executedStepIndices,
    authGateState: input.authGateState,
    skippedSteps: input.skippedSteps
  });

  const hasFunctionalRequired = classification.functionalRequired.length > 0;

  if (hasFunctionalRequired) {
    const pendingFunctionalTargets = classification.functionalRequired.map(a => a.target);

    return {
      allowed: false,
      reason: "functional_actions_pending",
      classification,
      pendingFunctionalTargets,
      ignoredAuthConsumedTargets: classification.authConsumed.map(a => a.target),
      diagnostics: {
        evaluated: true,
        allowed: false,
        reason: "functional_actions_pending",
        pendingFunctionalTargets,
        ignoredAuthConsumedTargets: classification.authConsumed.map(a => a.target),
        satisfiedAssertions: input.satisfiedAssertions,
        pendingActions: input.pendingActions.map(a => a.target),
        classifications: {
          authConsumed: classification.authConsumed.map(a => a.target),
          optional: classification.optional.map(a => a.target),
          duplicateAlreadyExecuted: classification.duplicateAlreadyExecuted.map(a => a.target),
          functionalRequired: classification.functionalRequired.map(a => a.target)
        },
        executedStepIndices: Array.from(input.executedStepIndices)
      }
    };
  }

  const onlyAuthAndOptionalRemaining =
    classification.authConsumed.length > 0 ||
    classification.optional.length > 0 ||
    classification.duplicateAlreadyExecuted.length > 0;

  const noActionsRemaining =
    classification.authConsumed.length === 0 &&
    classification.optional.length === 0 &&
    classification.functionalRequired.length === 0 &&
    classification.duplicateAlreadyExecuted.length === 0;

  if (noActionsRemaining || onlyAuthAndOptionalRemaining) {
    return {
      allowed: true,
      reason: noActionsRemaining ? "no_actions_remaining" : "only_auth_optional_remaining",
      classification,
      pendingFunctionalTargets: [],
      ignoredAuthConsumedTargets: classification.authConsumed.map(a => a.target),
      diagnostics: {
        evaluated: true,
        allowed: true,
        reason: noActionsRemaining ? "no_actions_remaining" : "only_auth_optional_remaining",
        pendingFunctionalTargets: [],
        ignoredAuthConsumedTargets: classification.authConsumed.map(a => a.target),
        satisfiedAssertions: input.satisfiedAssertions,
        pendingActions: input.pendingActions.map(a => a.target),
        classifications: {
          authConsumed: classification.authConsumed.map(a => a.target),
          optional: classification.optional.map(a => a.target),
          duplicateAlreadyExecuted: classification.duplicateAlreadyExecuted.map(a => a.target),
          functionalRequired: classification.functionalRequired.map(a => a.target)
        },
        executedStepIndices: Array.from(input.executedStepIndices)
      }
    };
  }

  return {
    allowed: false,
    reason: "unknown_blocking_condition",
    classification,
    pendingFunctionalTargets: classification.functionalRequired.map(a => a.target),
    ignoredAuthConsumedTargets: classification.authConsumed.map(a => a.target),
    diagnostics: {
      evaluated: true,
      allowed: false,
      reason: "unknown_blocking_condition",
      pendingFunctionalTargets: classification.functionalRequired.map(a => a.target),
      ignoredAuthConsumedTargets: classification.authConsumed.map(a => a.target),
      satisfiedAssertions: input.satisfiedAssertions,
      pendingActions: input.pendingActions.map(a => a.target),
      classifications: {
        authConsumed: classification.authConsumed.map(a => a.target),
        optional: classification.optional.map(a => a.target),
        duplicateAlreadyExecuted: classification.duplicateAlreadyExecuted.map(a => a.target),
        functionalRequired: classification.functionalRequired.map(a => a.target)
      },
      executedStepIndices: Array.from(input.executedStepIndices)
    }
  };
}
