export type AuthGateState = {
  completed: boolean;
  completedAtStepIndex: number;
  completedAfterTarget: string;
  stagesCompleted: string[];
  consumedAuthTargets: string[];
  skippedAuthSteps: Array<{ target: string; reason: string }>;
  authConsumedOpen: boolean;
  functionalStepSeenAfterAuth: boolean;
};

const AUTH_KEYWORDS = [
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
  "correo",
  "email",
  "pin",
  "token",
  "código token",
  "codigo token",
  "iniciar sesión",
  "iniciar sesion",
  "acceder",
  "log in",
  "login"
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

export function isAuthRelatedStep(target: string, authGateState?: AuthGateState): boolean {
  const normalizedTarget = normalizeText(target);

  for (const keyword of AUTH_KEYWORDS) {
    if (normalizedTarget.includes(normalizeText(keyword))) {
      return true;
    }
  }

  if (authGateState?.completed && authGateState.authConsumedOpen) {
    for (const variant of AUTH_CONTINUE_VARIANTS) {
      if (normalizedTarget === normalizeText(variant)) {
        return true;
      }
    }
  }

  return false;
}

export function isAuthContinueStep(target: string, authGateState?: AuthGateState): boolean {
  if (!authGateState?.completed || !authGateState.authConsumedOpen) {
    return false;
  }

  const normalizedTarget = normalizeText(target);
  return AUTH_CONTINUE_VARIANTS.some(v => normalizedTarget === normalizeText(v));
}

export function createAuthGateState(
  completedAfterTarget: string,
  completedAtStepIndex: number,
  stagesCompleted: string[]
): AuthGateState {
  return {
    completed: true,
    completedAtStepIndex,
    completedAfterTarget,
    stagesCompleted,
    consumedAuthTargets: [
      "Cédula de identidad dominicana",
      "continuar",
      "confirmar",
      "confirmar código",
      "confirmar codigo",
      "siguiente",
      "entrar",
      "enviar"
    ],
    skippedAuthSteps: [],
    authConsumedOpen: true,
    functionalStepSeenAfterAuth: false
  };
}

export function shouldSkipStepAsAuthConsumed(
  target: string,
  authGateState?: AuthGateState
): boolean {
  if (!authGateState?.completed) {
    return false;
  }

  if (!authGateState.authConsumedOpen) {
    return false;
  }

  return isAuthRelatedStep(target, authGateState);
}

export function markFunctionalStepAfterAuth(
  target: string,
  authGateState?: AuthGateState
): void {
  if (!authGateState?.completed) {
    return;
  }

  const normalizedTarget = normalizeText(target);
  const isAuthKeyword = AUTH_KEYWORDS.some(keyword =>
    normalizedTarget.includes(normalizeText(keyword))
  );

  if (!isAuthKeyword) {
    authGateState.authConsumedOpen = false;
    authGateState.functionalStepSeenAfterAuth = true;
  }
}
