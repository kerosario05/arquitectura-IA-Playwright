import type { Page } from "@playwright/test";
import { normalizeText, computeTokenScore, computeSemanticScore, tokenizeWithStopwords } from "../../discovery/target-resolver";

/**
 * Semantic candidate for target matching
 */
export type SemanticCandidate = {
  text: string;
  normalizedText: string;
  type: "button" | "link" | "heading" | "card" | "list_item" | "category" | "product" | "other";
  role?: string;
  tagName?: string;
  score: number;
  matchReason: string;
  locator: any;
  visible: boolean;
  enabled: boolean;
  clickable: boolean;
  ariaLabel?: string;
  title?: string;
  href?: string;
};

/**
 * Result of semantic target matching
 */
export type SemanticMatchResult = {
  status: "exact" | "semantic" | "not_found" | "ambiguous";
  target: string;
  candidate?: SemanticCandidate;
  candidates?: SemanticCandidate[];
  bestScore: number;
  reason: string;
  diagnostics: {
    targetTokens: string[];
    candidateScores: Array<{ text: string; score: number; type: string }>;
    rejectedCandidates: Array<{ text: string; score: number; reason: string }>;
  };
};

/**
 * Configuration for semantic matching
 */
export type SemanticMatchOptions = {
  timeoutMs?: number;
  actionIntent?: string;
  minScore?: number;
  allowAmbiguity?: boolean;
  preferTypes?: string[];
  excludeTypes?: string[];
  excludeSensitive?: boolean;
};

const SENSITIVE_PATTERNS = [
  "submit", "login", "signin", "sign in", "log in", "iniciar sesión",
  "continue", "continuar", "confirmar", "aceptar", "purchase", "comprar",
  "finalizar", "checkout", "place order", "pagar", "pay", "next", "siguiente",
  "transfer", "transferir", "payment", "pago", "loan", "prestamo", "crédito",
  "contract", "contrato", "delete", "eliminar", "borrar"
];

const STOPWORDS = new Set([
  "el", "la", "los", "las", "de", "del", "a", "al", "en", "un", "una", "unos", "unas",
  "y", "e", "o", "u", "pero", "que", "con", "por", "para", "se", "no", "su", "le", "lo",
  "the", "a", "an", "of", "to", "in", "on", "at", "by", "for", "with", "from", "is", "it",
  "and", "or", "but", "as", "be", "are", "was", "were", "this", "that", "has", "have"
]);

/**
 * Normalize text for semantic matching
 * - Removes accents
 * - Lowercase
 * - Removes stopwords
 * - Singular/plural normalization (simple)
 * - Normalizes whitespace
 */
export function normalizeTextForMatching(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokenize text for semantic matching
 * - Removes stopwords
 * - Filters short tokens
 */
export function tokenizeForSemanticMatch(text: string): string[] {
  const normalized = normalizeTextForMatching(text);
  return normalized
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Check if text matches sensitive patterns
 */
function isSensitiveTarget(text: string): boolean {
  const normalized = normalizeText(text);
  return SENSITIVE_PATTERNS.some(pattern =>
    normalized === pattern ||
    normalized.includes(pattern) ||
    pattern.includes(normalized)
  );
}

/**
 * Score semantic text match between target and candidate
 * Returns score 0-1 and reason
 */
export function scoreSemanticTextMatch(
  target: string,
  candidate: string,
  options?: { aliases?: string[] }
): { score: number; reason: string } {
  const targetTokens = tokenizeForSemanticMatch(target);
  if (targetTokens.length === 0) {
    return { score: 0, reason: "no_target_tokens" };
  }

  const candidateTokens = tokenizeForSemanticMatch(candidate);
  if (candidateTokens.length === 0) {
    return { score: 0, reason: "no_candidate_tokens" };
  }

  // Exact match after normalization
  const normalizedTarget = normalizeTextForMatching(target);
  const normalizedCandidate = normalizeTextForMatching(candidate);
  
  if (normalizedCandidate === normalizedTarget) {
    return { score: 1.0, reason: "exact_normalized_match" };
  }

  // Check aliases if provided
  if (options?.aliases) {
    for (const alias of options.aliases) {
      const normalizedAlias = normalizeTextForMatching(alias);
      if (normalizedAlias === normalizedTarget) {
        return { score: 0.95, reason: "alias_match" };
      }
      if (normalizedAlias.includes(normalizedTarget) || normalizedTarget.includes(normalizedAlias)) {
        return { score: 0.85, reason: "alias_partial_match" };
      }
    }
  }

  // Contains match (target in candidate or vice versa)
  if (normalizedCandidate.includes(normalizedTarget)) {
    const ratio = normalizedTarget.length / normalizedCandidate.length;
    if (ratio > 0.5) {
      return { score: 0.85 + 0.15 * ratio, reason: "candidate_contains_target" };
    }
  }
  
  if (normalizedTarget.includes(normalizedCandidate)) {
    const ratio = normalizedCandidate.length / normalizedTarget.length;
    if (ratio > 0.5) {
      return { score: 0.75 + 0.15 * ratio, reason: "target_contains_candidate" };
    }
  }

  // Token overlap score
  let matchedTokens = 0;
  for (const targetToken of targetTokens) {
    for (const candidateToken of candidateTokens) {
      if (candidateToken.includes(targetToken) || targetToken.includes(candidateToken)) {
        matchedTokens++;
        break;
      }
    }
  }

  const tokenScore = matchedTokens / targetTokens.length;
  
  if (tokenScore >= 0.8) {
    return { score: 0.7 + 0.2 * tokenScore, reason: "high_token_overlap" };
  }
  
  if (tokenScore >= 0.5) {
    return { score: 0.5 + 0.2 * tokenScore, reason: "moderate_token_overlap" };
  }
  
  if (tokenScore > 0) {
    return { score: 0.3 + 0.2 * tokenScore, reason: "low_token_overlap" };
  }

  return { score: 0, reason: "no_token_overlap" };
}

/**
 * Collect visible clickable elements from page
 */
export async function collectVisibleClickableElements(
  page: Page,
  options?: { timeoutMs?: number }
): Promise<SemanticCandidate[]> {
  const timeoutMs = options?.timeoutMs ?? 3000;
  const candidates: SemanticCandidate[] = [];

  try {
    // Collect buttons
    const buttons = page.getByRole("button");
    const buttonCount = await buttons.count();
    for (let i = 0; i < buttonCount; i++) {
      const button = buttons.nth(i);
      try {
        const visible = await button.isVisible({ timeout: timeoutMs }).catch(() => false);
        if (!visible) continue;
        
        const text = await button.textContent().catch(() => "") || "";
        const ariaLabel = await button.getAttribute("aria-label").catch(() => undefined) || undefined;
        const enabled = await button.isEnabled().catch(() => false);
        
        candidates.push({
          text: text.trim() || ariaLabel || "",
          normalizedText: normalizeText(text.trim() || ariaLabel || ""),
          type: "button",
          role: "button",
          tagName: "button",
          score: 0,
          matchReason: "",
          locator: button,
          visible: true,
          enabled,
          clickable: true,
          ariaLabel: ariaLabel || undefined
        });
      } catch {
        continue;
      }
    }

    // Collect links
    const links = page.getByRole("link");
    const linkCount = await links.count();
    for (let i = 0; i < linkCount; i++) {
      const link = links.nth(i);
      try {
        const visible = await link.isVisible({ timeout: timeoutMs }).catch(() => false);
        if (!visible) continue;
        
        const text = await link.textContent().catch(() => "") || "";
        const ariaLabel = await link.getAttribute("aria-label").catch(() => undefined) || undefined;
        const href = await link.getAttribute("href").catch(() => undefined) || undefined;
        const enabled = await link.isEnabled().catch(() => true);
        
        candidates.push({
          text: text.trim() || ariaLabel || "",
          normalizedText: normalizeText(text.trim() || ariaLabel || ""),
          type: "link",
          role: "link",
          tagName: "a",
          score: 0,
          matchReason: "",
          locator: link,
          visible: true,
          enabled,
          clickable: true,
          ariaLabel: ariaLabel || undefined,
          href: href || undefined
        });
      } catch {
        continue;
      }
    }

    // Collect headings (often clickable in cards)
    const headings = page.locator("h1, h2, h3, h4, h5, h6");
    const headingCount = await headings.count();
    for (let i = 0; i < headingCount; i++) {
      const heading = headings.nth(i);
      try {
        const visible = await heading.isVisible({ timeout: timeoutMs }).catch(() => false);
        if (!visible) continue;
        
        const text = await heading.textContent().catch(() => "") || "";
        if (!text.trim()) continue;
        
        const enabled = await heading.isEnabled().catch(() => true);
        const tagName = await heading.evaluate(el => el.tagName.toLowerCase()).catch(() => "h") || "h";
        
        candidates.push({
          text: text.trim(),
          normalizedText: normalizeText(text.trim()),
          type: "heading",
          role: "heading",
          tagName: tagName,
          score: 0,
          matchReason: "",
          locator: heading,
          visible: true,
          enabled,
          clickable: true,
        });
      } catch {
        continue;
      }
    }

    // Collect cards/list items
    const cards = page.locator('[class*="card"], article, [role="listitem"], [class*="item"]');
    const cardCount = await cards.count();
    for (let i = 0; i < Math.min(cardCount, 20); i++) {
      const card = cards.nth(i);
      try {
        const visible = await card.isVisible({ timeout: timeoutMs }).catch(() => false);
        if (!visible) continue;
        
        const text = await card.textContent().catch(() => "") || "";
        const trimmedText = text.trim().split("\n")[0]?.substring(0, 100) || "";
        if (!trimmedText) continue;
        
        const enabled = await card.isEnabled().catch(() => true);
        
        candidates.push({
          text: trimmedText,
          normalizedText: normalizeText(trimmedText),
          type: "card",
          role: "listitem",
          tagName: "div",
          score: 0,
          matchReason: "",
          locator: card,
          visible: true,
          enabled,
          clickable: true,
        });
      } catch {
        continue;
      }
    }
  } catch {
    // Return whatever we collected
  }

  return candidates;
}

/**
 * Find best semantic match for target among candidates
 */
export function findBestSemanticMatch(
  target: string,
  candidates: SemanticCandidate[],
  options?: SemanticMatchOptions
): SemanticMatchResult {
  const minScore = options?.minScore ?? 0.6;
  const preferTypes = options?.preferTypes;
  const excludeTypes = options?.excludeTypes;
  const actionIntent = options?.actionIntent;

  const targetTokens = tokenizeForSemanticMatch(target);
  const scoredCandidates: Array<{ candidate: SemanticCandidate; score: number; reason: string }> = [];

  for (const candidate of candidates) {
    // Skip excluded types
    if (excludeTypes?.includes(candidate.type)) {
      continue;
    }

    // Skip sensitive targets if required
    if (options?.excludeSensitive && isSensitiveTarget(candidate.text)) {
      continue;
    }

    // Score the match
    const { score, reason } = scoreSemanticTextMatch(target, candidate.text);
    
    // Apply type preference bonus
    let finalScore = score;
    if (preferTypes?.includes(candidate.type)) {
      finalScore = Math.min(1.0, score + 0.1);
    }

    // Special handling for category vs product
    if (actionIntent === "select_category" && candidate.type === "card") {
      // Downgrade product cards when looking for categories
      finalScore = score * 0.7;
    }
    
    if (actionIntent === "select_product" && candidate.type === "button" && !candidate.text.toLowerCase().includes("ver") && !candidate.text.toLowerCase().includes("detalle")) {
      // Buttons without "ver/detalle" are less likely to be product selectors
      finalScore = score * 0.6;
    }

    if (finalScore >= minScore) {
      scoredCandidates.push({ candidate, score: finalScore, reason });
    }
  }

  // Sort by score descending
  scoredCandidates.sort((a, b) => b.score - a.score);

  // No matches
  if (scoredCandidates.length === 0) {
    return {
      status: "not_found",
      target,
      bestScore: 0,
      reason: "no_candidates_above_threshold",
      diagnostics: {
        targetTokens,
        candidateScores: candidates.map(c => ({ text: c.text, score: 0, type: c.type })),
        rejectedCandidates: []
      }
    };
  }

  // Check for ambiguity (top 2 candidates with similar scores)
  if (scoredCandidates.length >= 2 && !options?.allowAmbiguity) {
    const topScore = scoredCandidates[0].score;
    const secondScore = scoredCandidates[1].score;
    if (topScore - secondScore < 0.1 && topScore > 0.7) {
      return {
        status: "ambiguous",
        target,
        candidates: scoredCandidates.slice(0, 3).map(sc => sc.candidate),
        bestScore: topScore,
        reason: `ambiguous_match: top candidates "${scoredCandidates[0].candidate.text}" (${topScore.toFixed(2)}) and "${scoredCandidates[1].candidate.text}" (${secondScore.toFixed(2)}) have similar scores`,
        diagnostics: {
          targetTokens,
          candidateScores: scoredCandidates.slice(0, 5).map(sc => ({ text: sc.candidate.text, score: sc.score, type: sc.candidate.type })),
          rejectedCandidates: scoredCandidates.slice(1).map(sc => ({ text: sc.candidate.text, score: sc.score, reason: "lower_score" }))
        }
      };
    }
  }

  const best = scoredCandidates[0];
  
  return {
    status: best.score >= 0.95 ? "exact" : "semantic",
    target,
    candidate: { ...best.candidate, score: best.score, matchReason: best.reason },
    bestScore: best.score,
    reason: best.reason,
    diagnostics: {
      targetTokens,
      candidateScores: scoredCandidates.slice(0, 5).map(sc => ({ text: sc.candidate.text, score: sc.score, type: sc.candidate.type })),
      rejectedCandidates: scoredCandidates.slice(1).map(sc => ({ text: sc.candidate.text, score: sc.score, reason: "lower_score" }))
    }
  };
}

/**
 * Main entry point: find semantic match for target on page
 */
export async function findSemanticTargetMatch(
  page: Page,
  target: string,
  options?: SemanticMatchOptions
): Promise<SemanticMatchResult> {
  const timeoutMs = options?.timeoutMs ?? 3000;

  // Collect visible elements
  const candidates = await collectVisibleClickableElements(page, { timeoutMs });
  
  if (candidates.length === 0) {
    return {
      status: "not_found",
      target,
      bestScore: 0,
      reason: "no_visible_clickable_elements",
      diagnostics: {
        targetTokens: tokenizeForSemanticMatch(target),
        candidateScores: [],
        rejectedCandidates: []
      }
    };
  }

  // Find best match
  return findBestSemanticMatch(target, candidates, options);
}
