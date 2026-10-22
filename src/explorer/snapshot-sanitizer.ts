const MAX_LENGTH = 200;

export function sanitizeVisibleText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function isPotentiallySensitiveText(value: string): boolean {
  const text = sanitizeVisibleText(value).toLowerCase();
  if (!text) {
    return false;
  }

  const sensitiveHints = [
    "password",
    "token",
    "otp",
    "pin",
    "api key",
    "apikey",
    "bearer",
    "secret",
    "contrasena",
    "contraseña",
    "clave"
  ];

  if (sensitiveHints.some((hint) => text.includes(hint))) {
    return true;
  }

  const digits = text.replace(/\D/g, "");
  return digits.length >= 12;
}

/**
 * Credential rejection copy is an outcome, not a credential. Preserve a safe canonical
 * phrase so discovery can assert the visible rejection without storing username/password
 * values that may appear elsewhere in the same modal text.
 */
function canonicalCredentialRejectionFeedback(value: string): string | undefined {
  const normalized = sanitizeVisibleText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const credentialSubject = /\b(?:credentials?|credenciales?)\b/.test(normalized)
    || /\b(?:usuario|username)\b[\s\S]{0,100}\b(?:contrasena|password)\b|\b(?:contrasena|password)\b[\s\S]{0,100}\b(?:usuario|username)\b/.test(normalized);
  const rejection = /\b(?:invalid\w*|incorrect\w*|not\s+valid|no\s+valid\w*|rechaz\w*|no\s+coincid\w*|invalido\w*)\b/.test(normalized);
  if (!credentialSubject || !rejection) return undefined;
  return /\b(?:credenciales?|contrasena|usuario)\b/.test(normalized)
    ? "Credenciales inválidas"
    : "Invalid credentials";
}

export function sanitizeSnapshotText(value: string): string {
  const cleaned = sanitizeVisibleText(value);
  if (!cleaned) {
    return "";
  }
  const safeCredentialOutcome = canonicalCredentialRejectionFeedback(cleaned);
  if (safeCredentialOutcome) return safeCredentialOutcome;
  if (isPotentiallySensitiveText(cleaned)) {
    return "[REDACTED]";
  }
  return cleaned.length > MAX_LENGTH ? `${cleaned.slice(0, MAX_LENGTH)}...` : cleaned;
}
