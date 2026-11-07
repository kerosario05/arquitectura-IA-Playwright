/**
 * The cédula goes to the OTP service exactly as the APP holds it. The app's field applies its own
 * mask (40224679551 -> 402-2467955-1) and the token is stored under that formatted identity, so a
 * bare 11-digit override must be formatted the same way before it reaches Oracle.
 */
const DOCUMENT_KEY = /documento|c[eé]dula|cedula|identidad|identificaci[oó]n/i;

export function formatBareCedulaForService(valueKey: string, value: string | undefined): string | undefined {
  if (value === undefined) return value;
  const trimmed = value.trim();
  if (!DOCUMENT_KEY.test(valueKey) || !/^\d{11}$/.test(trimmed)) return value;
  return `${trimmed.slice(0, 3)}-${trimmed.slice(3, 10)}-${trimmed.slice(10)}`;
}
