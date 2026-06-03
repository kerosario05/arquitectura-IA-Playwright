import type { McpRouteProfile, McpScenario } from "../scenarios/scenario-types";
import { loadAppConfig, getRouteProfileFromConfig } from "./app-auto-resolver";
import type { VirtualCase } from "../types/scenario-preview.types";

export { loadAppConfig };

// ── Comparison normalization (strips accents for matching only) ──

export function normalizeForComparison(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function stripStepNumbering(step: string): string {
  return step.replace(/^\d+[\.)]\s*/, "").trim();
}

// ── Canonical label map builder ──

export type CanonicalLabelMap = Map<string, string>;
export type CanonicalLabelSource = "entry" | "alias" | "visibleControl" | "domainTerm";
export type CanonicalLabelRegistryEntry = {
  canonical: string;
  source: CanonicalLabelSource;
  priority: number;
  visual: boolean;
};
export type CanonicalLabelRegistry = Map<string, CanonicalLabelRegistryEntry>;
export type CanonicalLabelBuildOptions = {
  visualOnly?: boolean;
  includeDomainTerms?: boolean;
};

const SOURCE_PRIORITY: Record<CanonicalLabelSource, number> = {
  entry: 1,
  alias: 2,
  visibleControl: 3,
  domainTerm: 4,
};

function shouldReplaceCanonicalEntry(
  current: CanonicalLabelRegistryEntry | undefined,
  next: CanonicalLabelRegistryEntry,
): boolean {
  if (!current) return true;
  if (next.priority !== current.priority) return next.priority < current.priority;
  if (next.visual !== current.visual) return next.visual && !current.visual;
  return next.canonical.length > current.canonical.length;
}

function registerCanonicalLabel(
  registry: CanonicalLabelRegistry,
  canonical: string,
  source: CanonicalLabelSource,
): void {
  const label = canonical.trim();
  if (!label) return;

  const entry: CanonicalLabelRegistryEntry = {
    canonical: label,
    source,
    priority: SOURCE_PRIORITY[source],
    visual: source !== "domainTerm",
  };

  const variants = new Set<string>();
  variants.add(normalizeForComparison(label));

  const stripped = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  variants.add(normalizeForComparison(stripped));

  const lower = label.toLowerCase();
  variants.add(normalizeForComparison(lower));

  const whitespaceNormalized = label.replace(/\s+/g, " ").trim();
  variants.add(normalizeForComparison(whitespaceNormalized));

  for (const variant of variants) {
    if (!variant) continue;
    const current = registry.get(variant);
    if (shouldReplaceCanonicalEntry(current, entry)) {
      registry.set(variant, entry);
    }
  }
}

export function buildCanonicalLabelRegistry(
  routeProfile: McpRouteProfile | null,
  appConfig: Record<string, unknown> | null,
  options: CanonicalLabelBuildOptions = {},
): CanonicalLabelRegistry {
  const registry: CanonicalLabelRegistry = new Map();
  const includeDomainTerms = options.includeDomainTerms ?? true;
  const visualOnly = options.visualOnly ?? false;

  if (routeProfile?.entry) {
    for (const e of routeProfile.entry) {
      if (e.visibleLabel) registerCanonicalLabel(registry, e.visibleLabel, "entry");
    }
  }

  if (routeProfile?.aliases) {
    for (const key of Object.keys(routeProfile.aliases)) {
      const val = (routeProfile.aliases as Record<string, unknown>)[key];
      if (typeof val === "string") registerCanonicalLabel(registry, val, "alias");
      else if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === "string") registerCanonicalLabel(registry, v, "alias");
        }
      }
    }
  }

  if (routeProfile?.visibleControls) {
    for (const vc of routeProfile.visibleControls) {
      if (typeof vc === "string") registerCanonicalLabel(registry, vc, "visibleControl");
    }
  }

  if (includeDomainTerms && routeProfile?.domainTerms) {
    for (const key of Object.keys(routeProfile.domainTerms)) {
      const val = (routeProfile.domainTerms as Record<string, unknown>)[key];
      if (typeof val === "string") registerCanonicalLabel(registry, val, "domainTerm");
      else if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === "string") registerCanonicalLabel(registry, v, "domainTerm");
        }
      }
    }
  }

  const appRouteProfile = getRouteProfileFromConfig(appConfig);
  if (appRouteProfile) {
    collectLabelsFromRouteProfile(appRouteProfile, registry, { includeDomainTerms });
  }

  if (appConfig?.routeProfiles && typeof appConfig.routeProfiles === "object") {
    const routeProfiles = appConfig.routeProfiles as Record<string, unknown>;
    const activeName = appConfig.activeRouteProfileName as string | undefined;
    if (activeName && routeProfiles[activeName]) {
      collectLabelsFromRouteProfile(routeProfiles[activeName] as Record<string, unknown>, registry, { includeDomainTerms });
    }
    if (!activeName) {
      for (const rpName of Object.keys(routeProfiles)) {
        collectLabelsFromRouteProfile(routeProfiles[rpName] as Record<string, unknown>, registry, { includeDomainTerms });
      }
    }
  }

  if (!visualOnly) {
    return registry;
  }

  const visualRegistry: CanonicalLabelRegistry = new Map();
  for (const [normalized, entry] of registry.entries()) {
    if (entry.visual) {
      visualRegistry.set(normalized, entry);
    }
  }

  return visualRegistry;
}

export function buildCanonicalLabelMap(
  routeProfile: McpRouteProfile | null,
  appConfig: Record<string, unknown> | null,
  options: CanonicalLabelBuildOptions = {},
): CanonicalLabelMap {
  const registry = buildCanonicalLabelRegistry(routeProfile, appConfig, options);
  const map: CanonicalLabelMap = new Map();
  for (const [normalized, entry] of registry.entries()) {
    map.set(normalized, entry.canonical);
  }
  return map;
}

function collectLabelsFromRouteProfile(
  rp: Record<string, unknown>,
  registry: CanonicalLabelRegistry,
  options: { includeDomainTerms: boolean },
): void {
  if (Array.isArray(rp.entry)) {
    for (const e of rp.entry) {
      if (e && typeof e === "object" && "visibleLabel" in e) {
        const vl = (e as Record<string, unknown>).visibleLabel;
        if (typeof vl === "string") registerCanonicalLabel(registry, vl, "entry");
      }
    }
  }

  if (rp.aliases && typeof rp.aliases === "object") {
    for (const key of Object.keys(rp.aliases)) {
      const val = (rp.aliases as Record<string, unknown>)[key];
      if (typeof val === "string") registerCanonicalLabel(registry, val, "alias");
      else if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === "string") registerCanonicalLabel(registry, v, "alias");
        }
      }
    }
  }

  if (Array.isArray(rp.visibleControls)) {
    for (const vc of rp.visibleControls) {
      if (typeof vc === "string") registerCanonicalLabel(registry, vc, "visibleControl");
    }
  }

  if (options.includeDomainTerms && rp.domainTerms && typeof rp.domainTerms === "object") {
    for (const key of Object.keys(rp.domainTerms)) {
      const val = (rp.domainTerms as Record<string, unknown>)[key];
      if (typeof val === "string") registerCanonicalLabel(registry, val, "domainTerm");
      else if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === "string") registerCanonicalLabel(registry, v, "domainTerm");
        }
      }
    }
  }
}

// ── Canonicalize text using label map ──

interface Match {
  start: number;
  end: number;
  replacement: string;
}

export function canonicalizeText(text: string, labelMap: CanonicalLabelMap): string {
  if (!text || labelMap.size === 0) return text;

  // Build normalized text and position mapping
  const normToOrig: number[] = [];
  let normPos = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const normCh = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    for (let j = 0; j < normCh.length; j++) {
      normToOrig.push(i);
    }
    normPos += normCh.length;
  }
  const normalizedText = normalizeForComparison(text);

  // Find all matches
  const matches: Match[] = [];
  for (const [normalizedForm, canonical] of labelMap) {
    if (normalizedForm.length < 3) continue;

    let idx = 0;
    while (true) {
      const found = normalizedText.indexOf(normalizedForm, idx);
      if (found === -1) break;

      const origStart = normToOrig[found] ?? found;
      const origEnd = (normToOrig[found + normalizedForm.length - 1] ?? found + normalizedForm.length - 1) + 1;

      matches.push({ start: origStart, end: origEnd, replacement: canonical });
      idx = found + normalizedForm.length;
    }
  }

  // Sort by length (longest first), then by position
  matches.sort((a, b) => {
    const lenDiff = (b.end - b.start) - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    return a.start - b.start;
  });

  // Remove overlapping matches (keep longer/earlier ones)
  const filtered: Match[] = [];
  for (const match of matches) {
    const overlaps = filtered.some(
      (f) => match.start < f.end && match.end > f.start,
    );
    if (!overlaps) {
      filtered.push(match);
    }
  }

  // Sort by position for replacement
  filtered.sort((a, b) => a.start - b.start);

  // Build result
  let result = "";
  let lastEnd = 0;
  for (const match of filtered) {
    result += text.slice(lastEnd, match.start);
    result += match.replacement;
    lastEnd = match.end;
  }
  result += text.slice(lastEnd);

  return result;
}

// ── Entry step canonicalization ──

export function buildCanonicalEntrySteps(routeProfile: McpRouteProfile | null): string[] {
  if (!routeProfile?.entry) return [];
  return routeProfile.entry
    .map((e) => e.visibleLabel)
    .filter(Boolean)
    .map((label) => `Clic en "${label}".`);
}

export function normalizeEntrySteps(
  steps: string[],
  routeProfile: McpRouteProfile | null,
): { steps: string[]; deduped: number } {
  if (!routeProfile?.entry || steps.length === 0) {
    return { steps: steps.map(stripStepNumbering), deduped: 0 };
  }

  const canonicalEntrySteps = buildCanonicalEntrySteps(routeProfile);
  if (canonicalEntrySteps.length === 0) {
    return { steps: steps.map(stripStepNumbering), deduped: 0 };
  }

  // Strip numbering from all steps
  const strippedSteps = steps.map(stripStepNumbering);

  // Start with all canonical entry steps (prepend all, in order)
  const result: string[] = [...canonicalEntrySteps];

  // Count entry steps in original input
  let entryCountInInput = 0;
  for (const step of strippedSteps) {
    let isEntry = false;
    for (const canonical of canonicalEntrySteps) {
      if (normalizeForComparison(step) === normalizeForComparison(canonical)) {
        isEntry = true;
        break;
      }
    }
    if (isEntry) {
      entryCountInInput++;
    } else {
      result.push(step);
    }
  }

  // deduped = how many excess entry steps were removed (never negative)
  const deduped = Math.max(0, entryCountInInput - canonicalEntrySteps.length);

  return { steps: result, deduped };
}

// ── Full scenario normalization ──

export type NormalizationStats = {
  beforeSteps: number;
  afterSteps: number;
  entryDeduped: number;
  canonicalizedLabels: number;
};

export function normalizeScenario(
  scenario: McpScenario,
  routeProfile: McpRouteProfile | null,
  appConfig: Record<string, unknown> | null,
): { scenario: McpScenario; stats: NormalizationStats } {
  const labelMap = buildCanonicalLabelMap(routeProfile, appConfig);

  let canonicalizedCount = 0;

  // Canonicalize title
  const newTitle = canonicalizeText(scenario.title, labelMap);
  if (newTitle !== scenario.title) canonicalizedCount++;

  // Canonicalize steps
  const canonicalizedSteps = scenario.steps.map((s) => canonicalizeText(s, labelMap));

  // Deduplicate entry steps
  const { steps: normalizedSteps, deduped } = normalizeEntrySteps(canonicalizedSteps, routeProfile);

  for (let i = 0; i < canonicalizedSteps.length; i++) {
    if (canonicalizedSteps[i] !== scenario.steps[i]) canonicalizedCount++;
  }

  // Canonicalize expectedResult
  const newExpected = canonicalizeText(scenario.expectedResult, labelMap);
  if (newExpected !== scenario.expectedResult) canonicalizedCount++;

  // Canonicalize preconditions
  const newPreconditions = scenario.preconditions.map((p) => canonicalizeText(p, labelMap));

  const normalizedScenario: McpScenario = {
    ...scenario,
    title: newTitle,
    steps: normalizedSteps,
    expectedResult: newExpected,
    preconditions: newPreconditions,
  };

  return {
    scenario: normalizedScenario,
    stats: {
      beforeSteps: scenario.steps.length,
      afterSteps: normalizedSteps.length,
      entryDeduped: deduped,
      canonicalizedLabels: canonicalizedCount,
    },
  };
}

// ── Virtual case normalization ──

export function normalizeVirtualCase(
  vc: VirtualCase,
  routeProfile: McpRouteProfile | null,
  appConfig: Record<string, unknown> | null,
): { vc: VirtualCase; stats: NormalizationStats } {
  const labelMap = buildCanonicalLabelMap(routeProfile, appConfig);

  let canonicalizedCount = 0;

  const newTitle = canonicalizeText(vc.title, labelMap);
  if (newTitle !== vc.title) canonicalizedCount++;

  const canonicalizedSteps = vc.steps.map((s) => canonicalizeText(s, labelMap));
  const { steps: normalizedSteps, deduped } = normalizeEntrySteps(canonicalizedSteps, routeProfile);

  for (let i = 0; i < canonicalizedSteps.length; i++) {
    if (canonicalizedSteps[i] !== vc.steps[i]) canonicalizedCount++;
  }

  const newExpected = canonicalizeText(vc.expectedResult, labelMap);
  if (newExpected !== vc.expectedResult) canonicalizedCount++;

  const newPreconditions = vc.preconditions.map((p) => canonicalizeText(p, labelMap));

  const normalizedVc: VirtualCase = {
    ...vc,
    title: newTitle,
    steps: normalizedSteps,
    expectedResult: newExpected,
    preconditions: newPreconditions,
  };

  return {
    vc: normalizedVc,
    stats: {
      beforeSteps: vc.steps.length,
      afterSteps: normalizedSteps.length,
      entryDeduped: deduped,
      canonicalizedLabels: canonicalizedCount,
    },
  };
}

// ── Validation ──

export type ValidationIssue = {
  type: "duplicate_entry_step" | "damaged_label" | "empty_steps" | "missing_field" | "sensitive_action";
  scenarioId: string;
  message: string;
  fixable: boolean;
};

const SENSITIVE_PATTERNS = [
  /delete\s+all/i,
  /drop\s+table/i,
  /truncate\s+table/i,
  /format\s+disk/i,
  /rm\s+-rf/i,
  /sudo\s+rm/i,
];

export function validateVirtualCases(
  cases: VirtualCase[],
  routeProfile: McpRouteProfile | null,
  appConfig: Record<string, unknown> | null,
): { valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];

  for (const vc of cases) {
    if (!vc.id) {
      issues.push({ type: "missing_field", scenarioId: vc.displayId, message: "Missing id", fixable: false });
    }
    if (!vc.title) {
      issues.push({ type: "missing_field", scenarioId: vc.displayId, message: "Missing title", fixable: false });
    }
    if (!vc.steps || vc.steps.length === 0) {
      issues.push({ type: "empty_steps", scenarioId: vc.displayId, message: "No steps", fixable: false });
    }
    if (!vc.appSlug) {
      issues.push({ type: "missing_field", scenarioId: vc.displayId, message: "Missing appSlug", fixable: false });
    }
    if (!vc.mcpExecutable) {
      issues.push({ type: "missing_field", scenarioId: vc.displayId, message: "mcpExecutable is false", fixable: false });
    }

    // Check for sensitive actions
    for (const step of vc.steps) {
      if (SENSITIVE_PATTERNS.some((p) => p.test(step))) {
        issues.push({ type: "sensitive_action", scenarioId: vc.displayId, message: `Sensitive action in step: ${step}`, fixable: false });
      }
    }

    // Check for duplicate entry steps
    if (routeProfile?.entry) {
      const canonicalEntry = buildCanonicalEntrySteps(routeProfile);
      const presentCounts = new Map<string, number>();
      for (const step of vc.steps) {
        for (const ce of canonicalEntry) {
          if (normalizeForComparison(step) === normalizeForComparison(ce)) {
            presentCounts.set(ce, (presentCounts.get(ce) ?? 0) + 1);
          }
        }
      }
      for (const [ce, count] of presentCounts) {
        if (count > 1) {
          issues.push({
            type: "duplicate_entry_step",
            scenarioId: vc.displayId,
            message: `Duplicate entry step: "${ce}" appears ${count} times`,
            fixable: true,
          });
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
