import type { PageSnapshot } from "../types/page-snapshot.types";

export type AuthGateStage =
  | "credentials"
  | "identification_type_selection"
  | "identification_input"
  | "phone_confirmation"
  | "otp"
  | "pin"
  | "token"
  | "authenticated_landing"
  | "unknown";

export type AuthGateType =
  | "customer_identification_otp"
  | "classic_login"
  | "pin_gate"
  | "token_gate"
  | "unknown";

export type AuthGateDetection = {
  detected: boolean;
  gateType: AuthGateType;
  stage: AuthGateStage;
  requiredInputs: string[];
  confidence: number;
  evidence: string[];
  hasVirtualKeyboard: boolean;
  hasNativeInput: boolean;
  continueButtonPresent: boolean;
};

const CREDENTIALS_KEYWORDS = [
  "usuario",
  "username",
  "correo",
  "email",
  "contraseña",
  "password",
  "iniciar sesión",
  "iniciar sesion",
  "acceder",
  "log in",
  "login",
  "ingresar"
];

const IDENTIFICATION_TYPE_SELECTION_KEYWORDS = [
  "identificación del cliente",
  "identificacion del cliente",
  "seleccione su tipo de identificación",
  "seleccione su tipo de identificacion",
  "cédula de identidad dominicana",
  "cedula de identidad dominicana",
  "pasaporte extranjero",
  "tipo de documento",
  "tipo de identificacion",
  "tipo de identificación",
  "documento de identidad"
];

const IDENTIFICATION_INPUT_KEYWORDS = [
  "número de identificación",
  "numero de identificación",
  "numero de identificacion",
  "ingrese el número",
  "ingrese el numero",
  "ingrese su número",
  "ingrese su numero",
  "digite el número",
  "digite el numero",
  "número de cédula",
  "numero de cedula",
  "cédula",
  "cedula"
];

const PHONE_CONFIRMATION_KEYWORDS = [
  "confirmar número de teléfono",
  "confirmar numero de teléfono",
  "confirmar número de telefono",
  "confirmar numero de telefono",
  "estaremos enviándole un código",
  "estaremos enviandole un código",
  "estaremos enviandole un codigo",
  "número de teléfono registrado",
  "numero de teléfono registrado",
  "confirmar teléfono",
  "confirmar telefono",
  "reconoce este número",
  "reconoce este numero"
];

const OTP_KEYWORDS = [
  "código otp",
  "codigo otp",
  "confirmar código",
  "confirmar codigo",
  "reenviar código",
  "reenviar codigo",
  "digite el código",
  "digite el codigo",
  "ingrese el código",
  "ingrese el codigo",
  "código de un solo uso",
  "codigo de un solo uso",
  "código de verificación",
  "codigo de verificacion",
  "código de 6 dígitos",
  "codigo de 6 digitos",
  "código de seguridad",
  "codigo de seguridad"
];

const PIN_KEYWORDS = [
  "pin",
  "clave",
  "clave secreta",
  "ingrese su pin",
  "ingrese su clave",
  "pin de seguridad",
  "clave de acceso"
];

const TOKEN_KEYWORDS = [
  "token",
  "código token",
  "codigo token",
  "token de seguridad",
  "codigo de seguridad"
];

const AUTHENTICATED_LANDING_KEYWORDS = [
  "menú principal",
  "menu principal",
  "menú de operaciones",
  "menu de operaciones",
  "transacciones y servicios",
  "transacciones y services",
  "selecciona la operación",
  "selecciona la operacion",
  "estado de cuenta",
  "consulta de balance",
  "pago de productos",
  "generar cartas",
  "bienvenido",
  "hola"
];

const VIRTUAL_KEYBOARD_INDICATORS = [
  "teclado virtual",
  "teclado numérico",
  "teclado numerico",
  "keypad",
  "virtual-keyboard",
  "virtual_keyboard",
  "numeric-keypad",
  "numeric_keypad",
  "numeric-keyboard",
  "numeric_keyboard",
  "teclado",
  "keypad-container",
  "keypad_container"
];

const OTP_INPUT_INDICATORS = [
  "otp-input",
  "otp_input",
  "otpField",
  "otp-field",
  "pin-input",
  "pin_input",
  "one-time-code",
  "one_time_code"
];

const CONTINUE_BUTTON_KEYWORDS = [
  "continuar",
  "confirmar",
  "confirmar código",
  "confirmar codigo",
  "acceder",
  "iniciar sesión",
  "iniciar sesion",
  "siguiente",
  "entrar",
  "enviar",
  "submit"
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function extractVisibleTexts(snapshot: PageSnapshot): string[] {
  const texts: string[] = [];

  if ((snapshot as any).elements) {
    for (const el of (snapshot as any).elements) {
      if (el.text) texts.push(el.text);
      if (el.nearbyText) texts.push(el.nearbyText);
      if (el.alt) texts.push(el.alt);
      if (el.placeholder) texts.push(el.placeholder);
      if (el.label) texts.push(el.label);
      if (el.value) texts.push(String(el.value));
    }
  }

  if ((snapshot as any).summary) {
    const summary = (snapshot as any).summary;
    if (summary.buttons !== undefined) texts.push(`buttons:${summary.buttons}`);
    if (summary.inputs !== undefined) texts.push(`inputs:${summary.inputs}`);
  }

  return texts;
}

function extractClassNames(snapshot: PageSnapshot): string[] {
  const classes: string[] = [];

  if ((snapshot as any).elements) {
    for (const el of (snapshot as any).elements) {
      if (el.className) {
        classes.push(el.className);
      }
    }
  }

  return classes;
}

function countInputs(snapshot: PageSnapshot): number {
  if ((snapshot as any).summary?.inputs !== undefined) {
    return (snapshot as any).summary.inputs;
  }
  if ((snapshot as any).elements) {
    return (snapshot as any).elements.filter((el: any) => el.tagName === "input").length;
  }
  return 0;
}

function hasMatchingKeyword(texts: string[], keywords: string[]): string[] {
  const matched: string[] = [];
  const normalizedTexts = texts.map(normalizeText);

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);
    for (const text of normalizedTexts) {
      if (text.includes(normalizedKeyword)) {
        matched.push(keyword);
        break;
      }
    }
  }

  return matched;
}

function hasMatchingClass(classes: string[], indicators: string[]): boolean {
  const normalizedClasses = classes.map(normalizeText);
  return indicators.some((indicator) =>
    normalizedClasses.some((cls) => cls.includes(normalizeText(indicator)))
  );
}

function hasContinueButton(texts: string[]): boolean {
  const normalizedTexts = texts.map(normalizeText);
  return CONTINUE_BUTTON_KEYWORDS.some((keyword) =>
    normalizedTexts.some((text) => text.includes(normalizeText(keyword)))
  );
}

function countNumericButtons(snapshot: PageSnapshot): number {
  if (!(snapshot as any).elements) return 0;
  let count = 0;
  for (const el of (snapshot as any).elements) {
    if (el.tagName === "button") {
      const text = normalizeText(el.text || "");
      if (/^[0-9]$/.test(text)) {
        count++;
      }
    }
  }
  return count;
}

export function detectAuthGate(snapshot: PageSnapshot): AuthGateDetection {
  const texts = extractVisibleTexts(snapshot);
  const classes = extractClassNames(snapshot);
  const evidence: string[] = [];
  const requiredInputs: string[] = [];

  if (texts.length === 0) {
    return {
      detected: false,
      gateType: "unknown",
      stage: "unknown",
      requiredInputs: [],
      confidence: 0,
      evidence: [],
      hasVirtualKeyboard: false,
      hasNativeInput: false,
      continueButtonPresent: false
    };
  }

  const credentialsMatches = hasMatchingKeyword(texts, CREDENTIALS_KEYWORDS);
  const typeSelectionMatches = hasMatchingKeyword(texts, IDENTIFICATION_TYPE_SELECTION_KEYWORDS);
  const inputMatches = hasMatchingKeyword(texts, IDENTIFICATION_INPUT_KEYWORDS);
  const phoneMatches = hasMatchingKeyword(texts, PHONE_CONFIRMATION_KEYWORDS);
  const otpMatches = hasMatchingKeyword(texts, OTP_KEYWORDS);
  const pinMatches = hasMatchingKeyword(texts, PIN_KEYWORDS);
  const tokenMatches = hasMatchingKeyword(texts, TOKEN_KEYWORDS);
  const landingMatches = hasMatchingKeyword(texts, AUTHENTICATED_LANDING_KEYWORDS);
  const hasVirtualKeyboard = hasMatchingClass(classes, VIRTUAL_KEYBOARD_INDICATORS);
  const hasOtpInputs = hasMatchingClass(classes, OTP_INPUT_INDICATORS);
  const inputCount = countInputs(snapshot);
  const numericButtonCount = countNumericButtons(snapshot);
  const continueButtonPresent = hasContinueButton(texts);
  const hasNativeInput = inputCount > 0;

  let stage: AuthGateStage = "unknown";
  let confidence = 0;
  let gateType: AuthGateType = "unknown";

  if (landingMatches.length >= 2) {
    stage = "authenticated_landing";
    confidence = Math.min(0.95, 0.5 + landingMatches.length * 0.15);
    gateType = "unknown";
    evidence.push(...landingMatches.slice(0, 3));
    return {
      detected: false,
      gateType: "unknown",
      stage: "authenticated_landing",
      requiredInputs: [],
      confidence,
      evidence,
      hasVirtualKeyboard,
      hasNativeInput,
      continueButtonPresent
    };
  }

  if (credentialsMatches.length > 0) {
    stage = "credentials";
    confidence = Math.min(0.95, 0.5 + credentialsMatches.length * 0.15);
    gateType = "classic_login";
    evidence.push(...credentialsMatches);
    if (credentialsMatches.some(k => normalizeText(k).includes("usuario") || normalizeText(k).includes("username") || normalizeText(k).includes("correo"))) {
      requiredInputs.push("username");
    }
    if (credentialsMatches.some(k => normalizeText(k).includes("contraseña") || normalizeText(k).includes("password"))) {
      requiredInputs.push("password");
    }
  }

  if (typeSelectionMatches.length > 0) {
    stage = "identification_type_selection";
    confidence = Math.min(0.95, 0.6 + typeSelectionMatches.length * 0.1);
    gateType = "customer_identification_otp";
    evidence.push(...typeSelectionMatches);
    requiredInputs.push("identificationType");
  }

  if (inputMatches.length > 0) {
    const inputConfidence = Math.min(0.95, 0.7 + inputMatches.length * 0.1);
    const hasInputIndicators = hasVirtualKeyboard || numericButtonCount >= 8 || hasNativeInput;
    if (hasInputIndicators && (inputConfidence > confidence || stage === "identification_type_selection")) {
      stage = "identification_input";
      confidence = inputConfidence;
      gateType = "customer_identification_otp";
      evidence.push(...inputMatches);
      requiredInputs.length = 0;
      requiredInputs.push("identificationNumber");
      if (hasVirtualKeyboard) evidence.push("virtual keyboard detected");
      if (continueButtonPresent) evidence.push("continue button present");
    }
  }

  if (phoneMatches.length > 0) {
    stage = "phone_confirmation";
    confidence = Math.max(confidence, Math.min(0.95, 0.6 + phoneMatches.length * 0.15));
    gateType = "customer_identification_otp";
    evidence.push(...phoneMatches);
    requiredInputs.push("phoneConfirmation");
  }

  if (otpMatches.length > 0 || hasOtpInputs) {
    const otpScore = otpMatches.length * 0.15 + (hasOtpInputs ? 0.2 : 0) + (hasVirtualKeyboard ? 0.1 : 0);
    const otpConfidence = Math.min(0.95, 0.5 + otpScore);

    if (stage !== "phone_confirmation" || otpConfidence > confidence + 0.2) {
      stage = "otp";
      confidence = Math.max(confidence, otpConfidence);
      gateType = "customer_identification_otp";
      evidence.push(...otpMatches);
      requiredInputs.length = 0;
      requiredInputs.push("otp");
      if (hasOtpInputs) evidence.push("otp-input elements detected");
      if (hasVirtualKeyboard) evidence.push("virtual keyboard detected");
    }
  }

  if (pinMatches.length > 0 && stage !== "otp") {
    stage = "pin";
    confidence = Math.max(confidence, Math.min(0.95, 0.5 + pinMatches.length * 0.2));
    gateType = "pin_gate";
    evidence.push(...pinMatches);
    requiredInputs.length = 0;
    requiredInputs.push("pin");
  }

  if (tokenMatches.length > 0 && stage !== "otp" && stage !== "pin") {
    stage = "token";
    confidence = Math.max(confidence, Math.min(0.95, 0.5 + tokenMatches.length * 0.2));
    gateType = "token_gate";
    evidence.push(...tokenMatches);
    requiredInputs.length = 0;
    requiredInputs.push("token");
  }

  if (stage === "unknown" && hasVirtualKeyboard && numericButtonCount >= 8) {
    stage = "identification_input";
    confidence = 0.65;
    gateType = "customer_identification_otp";
    evidence.push("virtual numeric keyboard detected");
    requiredInputs.push("identificationNumber");
    if (continueButtonPresent) evidence.push("continue button present");
  }

  if (stage === "unknown" && hasVirtualKeyboard && inputCount >= 4 && numericButtonCount >= 8) {
    stage = "otp";
    confidence = 0.6;
    gateType = "customer_identification_otp";
    evidence.push("virtual keyboard with multiple inputs");
    requiredInputs.push("otp");
  }

  const detected = confidence >= 0.5 && (stage as string) !== "authenticated_landing";

  return {
    detected,
    gateType,
    stage,
    requiredInputs,
    confidence: Math.round(confidence * 100) / 100,
    evidence,
    hasVirtualKeyboard,
    hasNativeInput,
    continueButtonPresent
  };
}
