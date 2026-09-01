/**
 * Target Alias Resolver
 *
 * Resolves long/descriptive target texts to shorter visible alternatives
 * using routeProfile aliases defined per appSlug.
 *
 * Multi-project: no hardcoded labels. Each appSlug uses its own aliases.
 */

import type { AppRouteProfile } from "../types/env.types";

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['""«»]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export type AliasResolutionResult = {
  resolved: boolean;
  resolvedTarget?: string;
  originalTarget: string;
  matchedKey?: string;
  matchedValue?: string;
  source: "routeProfile" | "none";
  confidence: number;
};

/**
 * Try to resolve a target using routeProfile aliases.
 *
 * Strategy:
 * 1. Exact match: target matches an alias value → use the matching key (canonical form)
 * 2. Contains match: target text contains an alias key (long form) → use the alias value (short form)
 * 3. Partial match: significant tokens of target match an alias key → use the alias value
 */
export function resolveTargetWithAliases(
  target: string,
  routeProfile?: AppRouteProfile,
): AliasResolutionResult {
  if (!routeProfile?.aliases || Object.keys(routeProfile.aliases).length === 0) {
    return { resolved: false, originalTarget: target, source: "none", confidence: 0 };
  }

  const normalizedTarget = normalizeText(target);
  const aliases = Object.entries(routeProfile.aliases as Record<string, unknown>).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value])
      .filter((alias): alias is string => typeof alias === "string")
      .map((alias) => ({ key, value: alias }))
  );

  // Strategy 1: target exactly matches an alias value → already in short form
  for (const { key, value } of aliases) {
    const normalizedValue = normalizeText(value);
    if (normalizedTarget === normalizedValue) {
      return {
        resolved: true,
        resolvedTarget: value,
        originalTarget: target,
        matchedKey: key,
        matchedValue: value,
        source: "routeProfile",
        confidence: 0.95,
      };
    }
  }

  // Strategy 2: target text contains a long-form alias key → use the short value
  for (const { key, value } of aliases) {
    const normalizedKey = normalizeText(key);
    if (normalizedTarget.includes(normalizedKey)) {
      return {
        resolved: true,
        resolvedTarget: value,
        originalTarget: target,
        matchedKey: key,
        matchedValue: value,
        source: "routeProfile",
        confidence: 0.85,
      };
    }
  }

  // Strategy 3: significant token overlap between target and an alias key
  const targetTokens = extractTokens(normalizedTarget);
  for (const { key, value } of aliases) {
    const normalizedKey = normalizeText(key);
    const keyTokens = extractTokens(normalizedKey);
    const overlap = targetTokens.filter((t) => keyTokens.some((kt) => kt.includes(t) || t.includes(kt)));
    if (overlap.length >= Math.min(2, Math.min(targetTokens.length, keyTokens.length))) {
      return {
        resolved: true,
        resolvedTarget: value,
        originalTarget: target,
        matchedKey: key,
        matchedValue: value,
        source: "routeProfile",
        confidence: 0.7 + (overlap.length / Math.max(targetTokens.length, keyTokens.length)) * 0.25,
      };
    }
  }

  return { resolved: false, originalTarget: target, source: "none", confidence: 0 };
}

function extractTokens(text: string): string[] {
  const stopwords = new Set([
    "el", "la", "los", "las", "un", "una", "unos", "unas",
    "de", "del", "al", "en", "con", "sin", "por", "para",
    "the", "a", "an", "and", "or", "in", "on", "with", "for", "to",
    "al", "del", "de", "la", "lo", "las", "los", "un", "una",
  ]);
  return text.split(/[\s\-_]+/).filter((t) => t.length > 2 && !stopwords.has(t));
}
