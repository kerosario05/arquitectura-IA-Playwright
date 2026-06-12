/**
 * Target Normalization Utilities
 *
 * Provides robust string normalization for matching click targets across encoding issues,
 * accent variations, and whitespace differences.
 *
 * This is app-agnostic and works with any target strings.
 */

/**
 * Common mojibake patterns and their corrections
 *
 * These patterns fix UTF-8 encoding issues where Spanish accented characters
 * are incorrectly displayed as mojibake (e.g., "Ã³" instead of "ó").
 *
 * Strategy: Start with word-specific patterns for common terms, then add
 * generic character-level patterns to catch all cases.
 */
const MOJIBAKE_CORRECTIONS: Array<[RegExp, string]> = [
  // Word-specific corrections (most common terms)
  [/InformaciÃ³n/gi, "Información"],
  [/DepÃ³sitos/gi, "Depósitos"],
  [/PrÃ©stamos/gi, "Préstamos"],
  [/CrÃ©dito/gi, "Crédito"],
  [/TarjetacrÃ©dito/gi, "Tarjeta de crédito"],
  [/CategorÃ­as/gi, "Categorías"],
  [/ValidaciÃ³n/gi, "Validación"],
  [/ComisiÃ³n/gi, "Comisión"],
  [/TransacciÃ³n/gi, "Transacción"],
  [/OperaciÃ³n/gi, "Operación"],
  [/SituaciÃ³n/gi, "Situación"],
  [/DescripciÃ³n/gi, "Descripción"],
  [/TÃ©rmino/gi, "Término"],
  [/PerÃ­odo/gi, "Período"],
  [/DÃ­as/gi, "Días"],
  [/botÃ³n/gi, "botón"],
  [/estÃ©/gi, "esté"],
  [/estÃ¡/gi, "está"],
  [/serÃ¡/gi, "será"],
  [/podrÃ¡/gi, "podrá"],
  [/mÃ¡s/gi, "más"],
  [/tambiÃ©n/gi, "también"],
  [/ademÃ¡s/gi, "además"],
  [/despuÃ©s/gi, "después"],
  [/segÃºn/gi, "según"],

  // Generic character-level corrections (catch-all for any remaining cases)
  [/Ã³/g, "ó"],
  [/Ã©/g, "é"],
  [/Ã¡/g, "á"],
  [/Ã­/g, "í"],
  [/Ãº/g, "ú"],
  [/Ã±/g, "ñ"],
  [/Ã"/g, "Ó"],
  [/Ã‰/g, "É"],
  [/Ã/g, "Á"],
  [/Ã/g, "Í"],
  [/Ãš/g, "Ú"],
  [/Ã'/g, "Ñ"],
];

/**
 * Normalize a target string for robust matching
 *
 * Steps:
 * 1. Fix common mojibake patterns
 * 2. Trim whitespace
 * 3. Normalize unicode (NFD decomposition)
 * 4. Remove combining diacritical marks (accents)
 * 5. Lowercase
 * 6. Collapse multiple spaces to single space
 */
export function normalizeTarget(target: string): string {
  if (!target) return "";

  let normalized = target;

  // Fix common mojibake
  for (const [pattern, replacement] of MOJIBAKE_CORRECTIONS) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Trim
  normalized = normalized.trim();

  // NFD normalization (decompose accents) + remove combining marks
  normalized = normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Lowercase
  normalized = normalized.toLowerCase();

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, " ");

  return normalized;
}

/**
 * Check if two targets match after normalization
 */
export function targetsMatch(a: string, b: string): boolean {
  return normalizeTarget(a) === normalizeTarget(b);
}

/**
 * Find a target in a list using normalized matching
 *
 * Returns the matched canonical form if found, null otherwise
 */
export function findTargetInList(
  target: string,
  allowedTargets: string[]
): string | null {
  const normalizedTarget = normalizeTarget(target);

  for (const allowed of allowedTargets) {
    if (normalizeTarget(allowed) === normalizedTarget) {
      return allowed; // Return canonical form
    }
  }

  return null;
}

/**
 * Detect if mojibake correction was applied
 */
export function detectMojibake(target: string): {
  hasMojibake: boolean;
  corrected: string;
} {
  let corrected = target;
  let hasMojibake = false;

  for (const [pattern, replacement] of MOJIBAKE_CORRECTIONS) {
    const before = corrected;
    corrected = corrected.replace(pattern, replacement);
    if (corrected !== before) {
      hasMojibake = true;
    }
  }

  return { hasMojibake, corrected };
}

/**
 * Build normalized lookup map for fast matching
 *
 * Returns: Map<normalizedTarget, canonicalTarget>
 */
export function buildNormalizedLookup(
  targets: string[]
): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const target of targets) {
    const normalized = normalizeTarget(target);
    if (!lookup.has(normalized)) {
      lookup.set(normalized, target);
    }
  }

  return lookup;
}
