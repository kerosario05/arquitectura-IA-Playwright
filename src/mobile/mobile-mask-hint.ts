/**
 * A field "hint" (placeholder) counts as an input MASK only when it is a pattern of digits /
 * placeholders and separators ("402-0000000-7", "(809) 000-0000", "##/##/####"). Any other hint
 * with a symbol in it is plain text: an e-mail placeholder ("correo@dominio.com") has "@" and "."
 * but is not a mask, and treating it as one dropped those characters from the typed value.
 * A password placeholder ("*********", "••••••••") is not a mask either: it made the tool strip
 * the symbols out of the password.
 */
const MASK_PATTERN = /^[\d#xX_\s().\-/+:]+$/;

export function isMaskHint(hint: string): boolean {
  const trimmed = hint.trim();
  return trimmed.length > 0 && MASK_PATTERN.test(trimmed) && /[^a-zA-Z0-9]/.test(trimmed);
}

/** E-mail addresses and the like must always be typed exactly as given. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value.trim());
}
