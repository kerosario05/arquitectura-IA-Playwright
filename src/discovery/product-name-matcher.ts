/**
 * Semantic product name matching for detail oracle.
 *
 * Handles cases where the expected target name differs from the actual
 * detail page heading (e.g., "Depósitos a plazo en Pesos" vs
 * "Depósito a Plazo Digital en Pesos").
 */

export type ProductNameMatchResult = {
  matches: boolean;
  mode: "exact" | "normalized" | "semantic_alias" | "none";
  score: number;
  expectedTokens: string[];
  actualTokens: string[];
  matchedTokens: string[];
  extraTokens: string[];
  actualText?: string;
};

const STOP_WORDS = new Set([
  "de", "del", "la", "el", "en", "a", "y", "para", "con", "por",
  "los", "las", "un", "una", "al", "su", "es", "se",
]);

function normalizeAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizePlural(token: string): string {
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
}

function tokenize(text: string): string[] {
  return normalizeAccents(text)
    .toLowerCase()
    .split(/[\s\-_/]+/)
    .map(t => t.replace(/[^a-z0-9]/g, ""))
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
    .map(normalizePlural);
}

/**
 * Check if expected product name matches actual text using progressive matching:
 * 1. Exact substring match (case-insensitive)
 * 2. Normalized match (accents + plural stripped)
 * 3. Semantic alias (token overlap with high coverage of expected tokens)
 */
export function matchProductName(
  expected: string,
  actual: string,
  options?: { minSemanticScore?: number }
): ProductNameMatchResult {
  const minScore = options?.minSemanticScore ?? 0.7;

  // 1. Exact substring match (case-insensitive)
  if (actual.toLowerCase().includes(expected.toLowerCase())) {
    return {
      matches: true,
      mode: "exact",
      score: 1.0,
      expectedTokens: tokenize(expected),
      actualTokens: tokenize(actual),
      matchedTokens: tokenize(expected),
      extraTokens: [],
      actualText: actual,
    };
  }

  // 2. Normalized match (accents stripped, case insensitive)
  const normalizedExpected = normalizeAccents(expected).toLowerCase();
  const normalizedActual = normalizeAccents(actual).toLowerCase();
  if (normalizedActual.includes(normalizedExpected)) {
    return {
      matches: true,
      mode: "normalized",
      score: 0.95,
      expectedTokens: tokenize(expected),
      actualTokens: tokenize(actual),
      matchedTokens: tokenize(expected),
      extraTokens: [],
      actualText: actual,
    };
  }

  // 3. Semantic alias: token overlap scoring
  const expectedTokens = tokenize(expected);
  const actualTokens = tokenize(actual);

  if (expectedTokens.length === 0) {
    return { matches: false, mode: "none", score: 0, expectedTokens, actualTokens, matchedTokens: [], extraTokens: actualTokens };
  }

  const matchedTokens: string[] = [];
  for (const et of expectedTokens) {
    if (actualTokens.includes(et)) {
      matchedTokens.push(et);
    }
  }

  const extraTokens = actualTokens.filter(t => !expectedTokens.includes(t));

  // Score: proportion of expected tokens covered
  const score = matchedTokens.length / expectedTokens.length;

  return {
    matches: score >= minScore,
    mode: score >= minScore ? "semantic_alias" : "none",
    score,
    expectedTokens,
    actualTokens,
    matchedTokens,
    extraTokens,
    actualText: actual,
  };
}

/**
 * Scan snapshot elements for the best semantic match to expected product name.
 * Returns the best matching element text and match result.
 */
export function findBestProductNameMatch(
  expected: string,
  elements: Array<{ text?: string; label?: string; name?: string; role?: string; tagName?: string }>,
  options?: { minSemanticScore?: number; preferHeadings?: boolean }
): ProductNameMatchResult {
  const minScore = options?.minSemanticScore ?? 0.7;
  const preferHeadings = options?.preferHeadings ?? true;

  let bestResult: ProductNameMatchResult = {
    matches: false,
    mode: "none",
    score: 0,
    expectedTokens: tokenize(expected),
    actualTokens: [],
    matchedTokens: [],
    extraTokens: [],
  };

  for (const el of elements) {
    const text = (el.text || el.label || el.name || "").trim();
    if (!text || text.length < 3 || text.length > 200) continue;

    const result = matchProductName(expected, text, { minSemanticScore: minScore });

    // Prefer headings for product name identification
    const isHeading = preferHeadings && (
      el.role === "heading" || el.tagName === "h1" || el.tagName === "h2" || el.tagName === "h3"
    );
    const headingBonus = isHeading ? 0.05 : 0;
    const effectiveScore = result.score + headingBonus;

    if (effectiveScore > bestResult.score + (bestResult.actualText ? 0 : -1)) {
      bestResult = { ...result, score: Math.min(1.0, effectiveScore) };
    }
  }

  return bestResult;
}
