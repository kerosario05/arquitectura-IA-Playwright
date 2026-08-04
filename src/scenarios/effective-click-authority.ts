import type { FunctionalBranchRef } from "./scenario-types";

function normalizeClickTarget(target: string): string {
  return target.normalize("NFC").toLowerCase().trim();
}

export function collectBranchRequiredClicks(functionalBranches?: FunctionalBranchRef[]): string[] {
  if (!functionalBranches || functionalBranches.length === 0) return [];
  const unique = new Set<string>();
  const clicks: string[] = [];
  for (const branch of functionalBranches) {
    const sourceLabel = branch.sourceLabel?.trim();
    if (!sourceLabel) continue;
    const normalized = normalizeClickTarget(sourceLabel);
    if (unique.has(normalized)) continue;
    unique.add(normalized);
    clicks.push(sourceLabel);
  }
  return clicks;
}

export function mergeEffectiveAllowedClicks(
  baseAllowedClicks: string[],
  branchRequiredClicks: string[],
  protectedClicks: string[] = [],
): {
  effectiveAllowedClicks: string[];
  addedFromBranchRequired: number;
  addedFromProtected: number;
} {
  const effectiveAllowedClicks = [...baseAllowedClicks];
  const seen = new Set(effectiveAllowedClicks.map((target) => normalizeClickTarget(target)));
  let addedFromBranchRequired = 0;
  let addedFromProtected = 0;

  for (const target of branchRequiredClicks) {
    const normalized = normalizeClickTarget(target);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    effectiveAllowedClicks.push(target);
    addedFromBranchRequired++;
  }

  for (const target of protectedClicks) {
    const normalized = normalizeClickTarget(target);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    effectiveAllowedClicks.push(target);
    addedFromProtected++;
  }

  return {
    effectiveAllowedClicks,
    addedFromBranchRequired,
    addedFromProtected,
  };
}
