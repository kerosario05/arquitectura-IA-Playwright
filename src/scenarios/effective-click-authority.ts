import type { FunctionalBranchRef } from "./scenario-types";

/** Extract concrete, user-authored UI targets that a generated path may mention.
 * This is descriptive evidence only; it does not grant runtime execution authority. */
export function extractHuFunctionalClickTargets(huText: string, branches: FunctionalBranchRef[] = []): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const target = raw.trim().replace(/[.。;:,]+$/, "").trim();
    if (!target || /^(?:un|una|uno|este|esta|estos|estas|el que|la que|una de|uno de)\b/i.test(target)) return;
    const normalized = normalizeClickTarget(target);
    if (target.length < 2 || seen.has(normalized)) return;
    if (branches.some((branch) => normalizeClickTarget(branch.sourceLabel ?? "").includes(normalized)
      && normalizeClickTarget(branch.sourceLabel ?? "") !== normalized)) return;
    seen.add(normalized);
    result.push(target);
  };
  for (const branch of branches) if (branch.sourceLabel) add(branch.sourceLabel);
  const text = huText.normalize("NFC");
  for (const pathMatch of text.matchAll(/(?:ruta|men[uú]|camino)\s*:\s*([^\r\n.]+)/gi)) {
    for (const segment of pathMatch[1].split(/\s*>\s*/)) add(segment);
  }
  for (const match of text.matchAll(/\b(?:seleccionar|seleccione|selecciona|presionar|presione|presiona|hacer clic en|haga clic en|clic en)\s+["“]([^"”]+)["”]/gi)) add(match[1]);
  for (const match of text.matchAll(/\b(?:seleccionar|seleccione|selecciona|presionar|presione|presiona|hacer clic en|haga clic en|clic en)\s+(?!un\b|una\b|uno\b|este\b|esta\b|el que\b|la que\b)([\p{L}\p{N}][\p{L}\p{N} _-]{1,60}?)(?=\s+(?:del men[uú]|de la lista|del listado|para continuar|para consultar|que desea)|[.;,]|$)/giu)) add(match[1]);
  for (const match of text.matchAll(/\b(?:sin que se seleccione|seleccionar)\s+([\p{L}\p{N}][\p{L}\p{N} _-]{1,50}?)(?=[.;,]|$)/giu)) add(match[1]);
  return result;
}

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
  _branchRequiredClicks: string[],
  protectedClicks: string[] = [],
): {
  effectiveAllowedClicks: string[];
  addedFromBranchRequired: number;
  addedFromProtected: number;
} {
  const effectiveAllowedClicks = [...baseAllowedClicks];
  const seen = new Set(effectiveAllowedClicks.map((target) => normalizeClickTarget(target)));
  let addedFromProtected = 0;

  for (const target of protectedClicks) {
    const normalized = normalizeClickTarget(target);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    effectiveAllowedClicks.push(target);
    addedFromProtected++;
  }

  return {
    effectiveAllowedClicks,
    addedFromBranchRequired: 0,
    addedFromProtected,
  };
}
