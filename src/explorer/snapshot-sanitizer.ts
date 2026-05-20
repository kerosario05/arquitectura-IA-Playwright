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

export function sanitizeSnapshotText(value: string): string {
  const cleaned = sanitizeVisibleText(value);
  if (!cleaned) {
    return "";
  }
  if (isPotentiallySensitiveText(cleaned)) {
    return "[REDACTED]";
  }
  return cleaned.length > MAX_LENGTH ? `${cleaned.slice(0, MAX_LENGTH)}...` : cleaned;
}
