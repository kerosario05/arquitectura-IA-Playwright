import type { McpRouteProfile, McpScenario } from "../scenarios/scenario-types";
import { loadAppConfig, getRouteProfileFromConfig } from "./app-auto-resolver";
import type { VirtualCase } from "../types/scenario-preview.types";
import type { EntryStepConfig } from "../server/services/entry-steps-learner";

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

function entryStepToCanonicalText(entryStep: EntryStepConfig): string {
  const label = entryStep.target.trim();
  switch (entryStep.action) {
    case "click":
      return `Clic en "${label}".`;
    case "type":
      return `Escribir "${label}".`;
    case "select":
      return `Seleccionar "${label}".`;
    case "navigate":
      return `Ir a "${label}".`;
    default:
      return `Clic en "${label}".`;
  }
}

export function normalizeScenarioEntryStepsOrder(
  steps: string[],
  entrySteps: EntryStepConfig[],
): { steps: string[]; inserted: number; moved: number; alreadyFirst: number; deduped: number } {
  if (!entrySteps.length || !steps.length) {
    return { steps, inserted: 0, moved: 0, alreadyFirst: 0, deduped: 0 };
  }

  const canonicalTexts = entrySteps.map(entryStepToCanonicalText);
  const normalizedCanonical = canonicalTexts.map((t) => normalizeForComparison(stripStepNumbering(t)));

  let inserted = 0;
  let alreadyFirst = 0;
  let deduped = 0;
  const placed = new Array<boolean>(canonicalTexts.length).fill(false);
  const nonEntrySteps: string[] = [];

  for (const step of steps) {
    const ns = normalizeForComparison(stripStepNumbering(step));
    let matchedIdx = -1;
    for (let ci = 0; ci < normalizedCanonical.length; ci++) {
      if (ns === normalizedCanonical[ci]) {
        matchedIdx = ci;
        break;
      }
    }
    if (matchedIdx !== -1) {
      if (!placed[matchedIdx]) {
        placed[matchedIdx] = true;
        if (steps.indexOf(step) === matchedIdx) {
          alreadyFirst++;
        }
      } else {
        deduped++;
      }
    } else {
      nonEntrySteps.push(step);
    }
  }

  let moved = 0;
  for (let ci = 0; ci < placed.length; ci++) {
    if (placed[ci]) {
      const origIdx = steps.findIndex(
        (s) => normalizeForComparison(stripStepNumbering(s)) === normalizedCanonical[ci],
      );
      if (origIdx !== ci) moved++;
    }
  }

  for (let ci = 0; ci < placed.length; ci++) {
    if (!placed[ci]) inserted++;
  }

  const resultSteps: string[] = [];
  for (let ci = 0; ci < canonicalTexts.length; ci++) {
    if (placed[ci]) {
      const origIdx = steps.findIndex(
        (s) => normalizeForComparison(stripStepNumbering(s)) === normalizedCanonical[ci],
      );
      resultSteps.push(steps[origIdx]);
    } else {
      resultSteps.push(canonicalTexts[ci]);
    }
  }
  resultSteps.push(...nonEntrySteps);

  return { steps: resultSteps, inserted, moved, alreadyFirst, deduped };
}

export function buildCanonicalEntrySteps(
  routeProfile: McpRouteProfile | null,
  entrySteps?: EntryStepConfig[],
): string[] {
  if (entrySteps && entrySteps.length > 0) {
    return entrySteps
      .filter((es) => es.action === "click")
      .map((es) => `Clic en "${es.target}".`);
  }
  if (!routeProfile?.entry) return [];
  return routeProfile.entry
    .map((e) => e.visibleLabel)
    .filter(Boolean)
    .map((label) => `Clic en "${label}".`);
}

export function normalizeEntrySteps(
  steps: string[],
  routeProfile: McpRouteProfile | null,
  entrySteps?: EntryStepConfig[],
): { steps: string[]; deduped: number } {
  if (steps.length === 0) return { steps: [], deduped: 0 };

  const canonicalEntrySteps = buildCanonicalEntrySteps(routeProfile, entrySteps);
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
  entrySteps?: EntryStepConfig[],
): { scenario: McpScenario; stats: NormalizationStats } {
  const labelMap = buildCanonicalLabelMap(routeProfile, appConfig);

  let canonicalizedCount = 0;

  // Canonicalize title
  const newTitle = canonicalizeText(scenario.title, labelMap);
  if (newTitle !== scenario.title) canonicalizedCount++;

  // Canonicalize steps
  const canonicalizedSteps = scenario.steps.map((s) => canonicalizeText(s, labelMap));

  // Deduplicate entry steps
  const { steps: normalizedSteps, deduped } = normalizeEntrySteps(canonicalizedSteps, routeProfile, entrySteps);

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
  entrySteps?: EntryStepConfig[],
): { vc: VirtualCase; stats: NormalizationStats } {
  const labelMap = buildCanonicalLabelMap(routeProfile, appConfig);

  let canonicalizedCount = 0;

  const newTitle = canonicalizeText(vc.title, labelMap);
  if (newTitle !== vc.title) canonicalizedCount++;

  const canonicalizedSteps = vc.steps.map((s) => canonicalizeText(s, labelMap));
  const { steps: normalizedSteps, deduped } = normalizeEntrySteps(canonicalizedSteps, routeProfile, entrySteps);

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

// ── Unsupported target filtering ──

function computeProfileContextStrength(
  entryCount: number,
  visibleControlsCount: number,
  aliasCount: number,
  domainTermCount: number,
  entryStepsCount: number,
): "none" | "low" | "medium" | "high" {
  const total = entryCount + visibleControlsCount + aliasCount + domainTermCount + entryStepsCount;
  if (total === 0) return "none";
  if (visibleControlsCount >= 4 || (visibleControlsCount >= 2 && aliasCount + domainTermCount >= 2)) return "high";
  if (visibleControlsCount >= 1 || entryCount >= 1 || entryStepsCount >= 1) return "medium";
  return "low";
}

export function filterUnsupportedClickTargets(
  steps: string[],
  routeProfile: McpRouteProfile | null,
  entrySteps?: EntryStepConfig[],
): {
  steps: string[];
  convertedToAssertion: number;
  kept: number;
  skipped: number;
  skippedReason: string | null;
  allowlistSize: number;
  profileContextStrength: "none" | "low" | "medium" | "high";
  convertedTargets: string[];
} {
  if (!routeProfile) {
    return { steps, convertedToAssertion: 0, kept: 0, skipped: steps.length, skippedReason: "insufficient_profile_context", allowlistSize: 0, profileContextStrength: "none", convertedTargets: [] };
  }

  const allowedTargets = new Set<string>();

  const addTarget = (target: string) => {
    const normalized = normalizeForComparison(target);
    if (normalized.length > 0) allowedTargets.add(normalized);
  };

  let entryCount = 0;
  let visibleControlsCount = 0;
  let aliasCount = 0;
  let domainTermCount = 0;
  let entryStepsCount = 0;

  if (routeProfile.entry) {
    for (const e of routeProfile.entry) {
      if (e.visibleLabel) { addTarget(e.visibleLabel); entryCount++; }
    }
  }

  if (routeProfile.visibleControls) {
    for (const vc of routeProfile.visibleControls) {
      addTarget(vc);
      visibleControlsCount++;
    }
  }

  if (routeProfile.aliases) {
    for (const val of Object.values(routeProfile.aliases)) {
      if (typeof val === "string") { addTarget(val); aliasCount++; }
      else if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === "string") { addTarget(v); aliasCount++; }
        }
      }
    }
  }

  if (routeProfile.domainTerms) {
    for (const val of Object.values(routeProfile.domainTerms)) {
      if (typeof val === "string") { addTarget(val); domainTermCount++; }
      else if (Array.isArray(val)) {
        for (const v of val) {
          if (typeof v === "string") { addTarget(v); domainTermCount++; }
        }
      }
    }
  }

  if (entrySteps) {
    for (const es of entrySteps) {
      addTarget(es.target);
      entryStepsCount++;
    }
  }

  const allowlistSize = allowedTargets.size;
  const profileContextStrength = computeProfileContextStrength(entryCount, visibleControlsCount, aliasCount, domainTermCount, entryStepsCount);

  // If no useful profile context, skip filtering entirely
  if (allowlistSize === 0 || profileContextStrength === "none") {
    return { steps, convertedToAssertion: 0, kept: 0, skipped: steps.length, skippedReason: "insufficient_profile_context", allowlistSize, profileContextStrength, convertedTargets: [] };
  }

  let convertedToAssertion = 0;
  let kept = 0;
  const convertedTargets: string[] = [];

  const resultSteps: string[] = [];
  for (const step of steps) {
    const stripped = stripStepNumbering(step);
    const clickMatch = stripped.match(/^Clic en "(.+)"\.$/i);
    if (clickMatch) {
      const target = clickMatch[1];
      const normalizedTarget = normalizeForComparison(target);
      if (!allowedTargets.has(normalizedTarget)) {
        convertedTargets.push(target);
        resultSteps.push(`Validar que se muestre "${target}".`);
        convertedToAssertion++;
        continue;
      }
      kept++;
    }
    resultSteps.push(step);
  }

  return { steps: resultSteps, convertedToAssertion, kept, skipped: 0, skippedReason: null, allowlistSize, profileContextStrength, convertedTargets };
}

// ── Detail scenario guard ──

const DETAIL_KEYWORDS = [
  "nombre", "descripci", "detalle", "informaci", "beneficios",
  "requisitos", "condiciones", "estado", "resumen", "datos",
  "atributos", "acciones disponibles", "botón de retorno",
  "botón de solicitud", "name", "description", "detail",
  "information", "benefits", "requirements", "conditions",
  "status", "summary", "data", "attributes",
];

const SELECTION_PATTERNS = [
  /seleccionar\s+(el|la|un|una)?\s*primer/i,
  /select\s+(the\s+)?first/i,
  /primer\s+(elemento|producto|item|registro|tarjeta|opción) visible/i,
  /first\s+visible\s+(element|product|item|record|card|option)/i,
  /primer\s+(elemento|producto|item|registro|tarjeta|opción)\s+del\s+listado/i,
];

const SENSITIVE_ACTION_PATTERNS = [
  /pagar/i, /transferir/i, /contrato/i, /confirmar/i, /enviar/i,
  /solicitar/i, /eliminar/i, /cancelar/i, /formalizar/i,
  /desembolso/i, /aprobar/i, /debitar/i, /firmar/i,
];

// Known category nouns that can serve as parent list navigation.
// If a specific target like "Reportes mensuales" isn't backed but "Reportes" is,
// the guard can recover by clicking the parent category.
const CATEGORY_PARENT_CANDIDATES = new Set([
  "tarjetas", "cuentas", "prestamos", "préstamos", "depósitos", "depositos",
  "productos", "servicios", "categorías", "categorias", "solicitudes",
  "usuarios", "reportes", "documentos", "planes", "facturas", "ordenes", "órdenes",
  "sucursales", "beneficiarios", "registros", "resultados", "items", "elementos",
]);

function hasSensitiveExecutableAction(steps: string[]): boolean {
  return steps.some((step) => {
    const stripped = stripStepNumbering(step);
    // Only block if it's an executable click action, not a visible assertion
    if (!/^clic en /i.test(stripped)) return false;
    return SENSITIVE_ACTION_PATTERNS.some((p) => p.test(stripped));
  });
}

function hasPassiveSensitiveAssertion(steps: string[]): boolean {
  return steps.some((step) => {
    const stripped = stripStepNumbering(step);
    // Only match assertion-type steps (Validar que el botón X esté visible)
    if (!/^(validar|verificar|comprobar|esperar)\b/i.test(stripped)) return false;
    return SENSITIVE_ACTION_PATTERNS.some((p) => p.test(stripped));
  });
}

/**
 * Try to recover a parent category/list navigation from unsupported targets.
 * E.g., if "Pesos" was converted to a validation but "Cuentas de Efectivo"
 * is a valid clickable target, insert "Clic en Cuentas de Efectivo" before
 * the ordinal selection to navigate into the right section.
 */
function findRecoverableParentCategory(
  steps: string[],
  routeProfile?: McpRouteProfile | null,
  entrySteps?: EntryStepConfig[],
): { originalTarget: string; parentTarget: string; parentLabel: string } | null {
  // Build the clickable allowlist (same sources as convertUnsupportedPreOrdinalClicks)
  const allowedTargets = new Set<string>();
  const addTarget = (target: string) => {
    const normalized = normalizeForComparison(target);
    if (normalized.length > 0) allowedTargets.add(normalized);
  };

  if (routeProfile?.entry) {
    for (const e of routeProfile.entry) if (e.visibleLabel) addTarget(e.visibleLabel);
  }
  if (routeProfile?.visibleControls) {
    for (const vc of routeProfile.visibleControls) addTarget(vc);
  }
  if (routeProfile?.aliases) {
    for (const val of Object.values(routeProfile.aliases)) {
      if (typeof val === "string") addTarget(val);
      else if (Array.isArray(val)) for (const v of val) if (typeof v === "string") addTarget(v);
    }
  }
  if (entrySteps) for (const es of entrySteps) addTarget(es.target);

  // Check each step before the first detail assertion for a click target that was
  // converted to a validation (like "Pesos" → "Validar que se muestre Pesos").
  // Try to find a parent category for it in the allowlist.
  for (const step of steps) {
    const stripped = stripStepNumbering(step);
    // Look for validation steps that might have been converted click targets
    const validationMatch = stripped.match(/^Validar que se muestre "(.+)"\.$/i);
    if (!validationMatch) continue;

    const target = validationMatch[1];
    const normalizedTarget = normalizeForComparison(target);

    // Skip if target is short generic value (Pesos, Dólares, etc.)
    // Parent recovery only for multi-word or specific targets
    if (target.length <= 5) continue;

    // Try to find a parent category noun inside the target text
    // e.g., "Reportes mensuales" → "Reportes"
    const targetWords = normalizedTarget.split(/\s+/);
    for (const word of targetWords) {
      if (CATEGORY_PARENT_CANDIDATES.has(word)) {
        const parentLabel = word.charAt(0).toUpperCase() + word.slice(1);
        const normalizedParent = normalizeForComparison(parentLabel);
        if (allowedTargets.has(normalizedParent)) {
          return {
            originalTarget: target,
            parentTarget: parentLabel,
            parentLabel,
          };
        }
      }
    }
  }

  return null;
}

function hasDetailAssertions(steps: string[], expectedResult: string): boolean {
  // Only check assertion-type steps (Validar, Verificar, check) and expectedResult
  // Exclude click/navigation steps to avoid false positives from product names like "información de productos"
  const assertionText = [
    ...steps
      .map(stripStepNumbering)
      .filter((s) => /^(validar|verificar|comprobar|esperar|should|verify|check|assert)\b/i.test(s)),
    expectedResult,
  ].join(" ").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  return DETAIL_KEYWORDS.some((kw) => assertionText.includes(kw));
}

function hasItemSelection(steps: string[]): boolean {
  return steps.some((step) => {
    const stripped = stripStepNumbering(step);
    return SELECTION_PATTERNS.some((p) => p.test(stripped));
  });
}

function hasSensitiveAction(steps: string[]): boolean {
  return steps.some((step) => {
    const stripped = stripStepNumbering(step).toLowerCase();
    return SENSITIVE_ACTION_PATTERNS.some((p) => p.test(stripped));
  });
}

function findDominantDomainTerm(routeProfile: McpRouteProfile | null): string | null {
  if (!routeProfile?.domainTerms) return null;
  const counts = new Map<string, number>();
  for (const val of Object.values(routeProfile.domainTerms)) {
    const items = typeof val === "string" ? [val] : Array.isArray(val) ? val : [];
    for (const item of items) {
      if (typeof item === "string" && item.length > 0) {
        counts.set(item, (counts.get(item) ?? 0) + 1);
      }
    }
  }
  if (counts.size === 0) return null;
  let best = "";
  let bestCount = 0;
  for (const [term, count] of counts) {
    if (count > bestCount) {
      best = term;
      bestCount = count;
    }
  }
  return best;
}

export function ensureDetailScenarioHasItemSelection(
  steps: string[],
  expectedResult: string,
  routeProfile?: McpRouteProfile | null,
  entrySteps?: EntryStepConfig[],
): { steps: string[]; inserted: boolean; reason?: string } {
  // Conditions for insertion:
  // 1. Has detail assertions
  // 2. No item selection yet
  // 3. No sensitive executable actions (passive assertions like "Validar que el botón X esté visible" are OK)
  if (!hasDetailAssertions(steps, expectedResult)) {
    return { steps, inserted: false, reason: "no_detail_assertions" };
  }

  if (hasItemSelection(steps)) {
    return { steps, inserted: false, reason: "already_has_selection" };
  }

  if (hasSensitiveExecutableAction(steps)) {
    return { steps, inserted: false, reason: "sensitive_action_blocked" };
  }

  // Log passive sensitive assertions (they don't block)
  if (hasPassiveSensitiveAssertion(steps)) {
    for (const step of steps) {
      const stripped = stripStepNumbering(step);
      if (/^(validar|verificar|comprobar|esperar)\b/i.test(stripped)) {
        const match = stripped.match(/"(.+)"/)
        if (match) {
          // Log handled in runner context
        }
      }
    }
  }

  const result = [...steps];

  // STEP A: Try to recover parent category/list navigation for unsupported detail targets
  let parentRecovery = findRecoverableParentCategory(steps, routeProfile, entrySteps);
  if (parentRecovery) {
    let insertIdx = result.length;
    for (let i = result.length - 1; i >= 0; i--) {
      const stripped = stripStepNumbering(result[i]);
      if (/^(validar|verificar|comprobar|esperar|should|verify|check|assert)\b/i.test(stripped)) {
        insertIdx = i;
      } else {
        break;
      }
    }
    const parentStep = `Clic en "${parentRecovery.parentLabel}".`;
    result.splice(insertIdx, 0, parentStep);
  }

  // STEP B: Build the clickable allowlist to identify supported list navigation
  const allowedClickTargets = new Set<string>();
  const addTarget = (t: string) => { const n = normalizeForComparison(t); if (n.length > 0) allowedClickTargets.add(n); };
  if (routeProfile?.entry) for (const e of routeProfile.entry) if (e.visibleLabel) addTarget(e.visibleLabel);
  if (routeProfile?.visibleControls) for (const vc of routeProfile.visibleControls) addTarget(vc);
  if (routeProfile?.aliases) for (const val of Object.values(routeProfile.aliases)) {
    if (typeof val === "string") addTarget(val);
    else if (Array.isArray(val)) for (const v of val) if (typeof v === "string") addTarget(v);
  }
  if (entrySteps) for (const es of entrySteps) addTarget(es.target);

  // Identify which steps are root entry-level navigation (e.g., "Información de productos") vs
  // supported list/category navigation (e.g., "Tarjetas", "Reportes").
  const entryLabels = new Set<string>();
  if (routeProfile?.entry) for (const e of routeProfile.entry) if (e.visibleLabel) entryLabels.add(normalizeForComparison(e.visibleLabel));
  if (entrySteps) for (const es of entrySteps) entryLabels.add(normalizeForComparison(es.target));

  // STEP C: Examine the last click step before assertions to see if we have list navigation.
  // Find the last non-assertion step (click/navigation) before detail assertions.
  let lastClickStep: string | null = null;
  let lastClickNormalized: string | null = null;
  for (let i = 0; i < result.length; i++) {
    const stripped = stripStepNumbering(result[i]);
    if (/^(validar|verificar|comprobar|esperar|should|verify|check|assert)\b/i.test(stripped)) break;
    const clickMatch = stripped.match(/^Clic en "(.+)"\.$/i);
    if (clickMatch) {
      lastClickStep = clickMatch[1];
      lastClickNormalized = normalizeForComparison(lastClickStep);
    }
  }

  const isRootOnly = lastClickNormalized !== null && entryLabels.has(lastClickNormalized);

  // STEP D: Only insert ordinal selection if there's list navigation beyond root module.
  // Any click target that is NOT a root entry step counts as supported list navigation.
  if (!parentRecovery && isRootOnly) {
    return {
      steps: result,
      inserted: false,
      reason: "missing_supported_list_navigation",
    };
  }

  if (!parentRecovery && lastClickNormalized === null) {
    return {
      steps: result,
      inserted: false,
      reason: "no_list_navigation_before_detail",
    };
  }

  // Build ordinal selection step text
  const domainTerm = routeProfile ? findDominantDomainTerm(routeProfile) : null;
  const itemText = domainTerm
    ? `Seleccionar el primer ${domainTerm} visible del listado.`
    : "Seleccionar el primer elemento visible del listado.";

  // Find insertion point: before the first detail assertion step, after click/navigation steps
  let insertIdx = result.length;

  for (let i = result.length - 1; i >= 0; i--) {
    const stripped = stripStepNumbering(result[i]);
    if (/^(validar|verificar|comprobar|esperar|should|verify|check|assert)\b/i.test(stripped)) {
      insertIdx = i;
    } else {
      break;
    }
  }

  result.splice(insertIdx, 0, itemText);

  return { steps: result, inserted: true, reason: parentRecovery ? "detail_assertions_after_listing_with_parent_recovery" : "detail_assertions_after_listing" };
}

// ── Pre-ordinal click guard ──

const ORDINAL_SELECTION_PATTERNS = [
  /^seleccionar\s+(el|la|un|una)?\s*primer/i,
  /^seleccionar\s+(el|la|un|una)?\s*segund/i,
  /^seleccionar\s+(el|la|un|una)?\s*tercer/i,
  /^seleccionar\s+(el|la|un|una)?\s*últim/i,
  /^seleccionar\s+(el|la|un|una)?\s*ultim/i,
  /^select\s+(the\s+)?(first|second|third|last)/i,
];

function isOrdinalSelectionStep(step: string): boolean {
  const stripped = stripStepNumbering(step);
  return ORDINAL_SELECTION_PATTERNS.some((p) => p.test(stripped));
}

/**
 * Determine if a target looks like a contextual qualifier rather than a navigational control.
 * Uses general heuristics (not hardcoded business values):
 * - Very short single word → likely a filter/attribute value
 * - Target that doesn't contain structure words (de, del, para, en) → likely not a navigation label
 * - Target content after NFD is short → likely a generic value
 */
function isLikelyContextualTarget(target: string): boolean {
  const t = target.trim();
  if (t.length > 20) return false;
  
  const lower = t.toLowerCase();
  const afterNfd = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const wordCount = lower.split(/\s+/).length;
  
  // Single word, short (<= 7 chars) with no prepositions → likely attribute/filter value
  if (wordCount === 1 && afterNfd.length <= 7 && !/\b(de|del|para|por|en|con|sin|al)\b/i.test(lower)) return true;
  
  // Two words, short total (<= 10 chars), no prepositions → likely flat qualifier
  if (wordCount === 2 && afterNfd.length <= 10 && !/\b(de|del|para|por|en|con|sin|al)\b/i.test(lower)) return true;
  
  return false;
}

export function convertUnsupportedPreOrdinalClicks(
  steps: string[],
  routeProfile?: McpRouteProfile | null,
  entrySteps?: EntryStepConfig[],
): { steps: string[]; converted: number; diagnostics: Array<{ target: string; stepIndex: number; reason: string }> } {
  if (steps.length < 2) return { steps, converted: 0, diagnostics: [] };

  // Build allowlist of known clickable targets from profile metadata
  const allowedTargets = new Set<string>();

  const addTarget = (target: string) => {
    const normalized = normalizeForComparison(target);
    if (normalized.length > 0) allowedTargets.add(normalized);
  };

  if (routeProfile?.entry) {
    for (const e of routeProfile.entry) if (e.visibleLabel) addTarget(e.visibleLabel);
  }
  if (routeProfile?.visibleControls) {
    for (const vc of routeProfile.visibleControls) addTarget(vc);
  }
  if (routeProfile?.aliases) {
    for (const val of Object.values(routeProfile.aliases)) {
      if (typeof val === "string") addTarget(val);
      else if (Array.isArray(val)) for (const v of val) if (typeof v === "string") addTarget(v);
    }
  }
  // intermediates/navigationHints also represent navigable targets
  if (routeProfile?.intermediates) {
    for (const steps of Object.values(routeProfile.intermediates)) {
      if (Array.isArray(steps)) for (const step of steps) addTarget(step);
    }
  }
  if (entrySteps) {
    for (const es of entrySteps) addTarget(es.target);
  }

  const diagnostics: Array<{ target: string; stepIndex: number; reason: string }> = [];
  const resultSteps = [...steps];
  let converted = 0;

  for (let i = 0; i < resultSteps.length - 1; i++) {
    const currentStripped = stripStepNumbering(resultSteps[i]);
    const nextStripped = stripStepNumbering(resultSteps[i + 1]);

    // Check if current is a click step and next is ordinal selection
    const clickMatch = currentStripped.match(/^Clic en "(.+)"\.$/i);
    if (!clickMatch) continue;
    if (!isOrdinalSelectionStep(nextStripped)) continue;

    const target = clickMatch[1];
    const normalizedTarget = normalizeForComparison(target);

    // CASE 1: Target is in the allowlist (known clickable) → keep it
    if (allowedTargets.has(normalizedTarget)) continue;

    // CASE 2: Target looks like a specific navigation label (multi-word, has structure) → keep it
    if (!isLikelyContextualTarget(target)) continue;

    // CASE 3: Unsupported contextual target before ordinal → convert to validation
    // Avoid creating duplicate assertions if one already exists
    const validationStep = `Validar que se muestre "${target}".`;
    const alreadyHasAssertion = resultSteps.some(
      (s) => stripStepNumbering(s) === stripStepNumbering(validationStep)
    );

    if (!alreadyHasAssertion) {
      resultSteps[i] = validationStep;
      diagnostics.push({ target, stepIndex: i, reason: "unsupported_contextual_target_before_ordinal" });
      converted++;
    } else {
      // Remove the click step entirely since a validation already exists
      resultSteps.splice(i, 1);
      diagnostics.push({ target, stepIndex: i, reason: "removed_duplicate_contextual_click" });
      converted++;
      // Adjust loop because we removed an element
      i--;
    }
  }

  return { steps: resultSteps, converted, diagnostics };
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

// ── Final canonicalization (post-guards) ──

export type FinalCanonicalizationDiagnostic = {
  scenarioId: string;
  stepIndex: number;
  field: "title" | "step" | "expectedResult" | "precondition";
  originalText: string;
  canonicalText: string;
  matchedSource: CanonicalLabelSource | "multiple";
  phase: "final";
};

export type FinalCanonicalizationResult = {
  cases: VirtualCase[];
  diagnostics: FinalCanonicalizationDiagnostic[];
  totalCanonicalized: number;
};

/**
 * Apply final canonicalization to all virtual cases after guards have run.
 * This ensures that any steps inserted or modified by guards use canonical labels.
 *
 * This function is generic and configurable:
 * - Uses routeProfile, appConfig, domainTerms, aliases, visibleControls
 * - No hardcoded labels or app-specific rules
 * - Works for any app/profile using their own canonical sources
 */
export function applyFinalCanonicalization(
  cases: VirtualCase[],
  routeProfile: McpRouteProfile | null,
  appConfig: Record<string, unknown> | null,
): FinalCanonicalizationResult {
  const labelMap = buildCanonicalLabelMap(routeProfile, appConfig);
  const labelRegistry = buildCanonicalLabelRegistry(routeProfile, appConfig);
  const diagnostics: FinalCanonicalizationDiagnostic[] = [];
  let totalCanonicalized = 0;

  const findMatchedSource = (normalizedText: string): CanonicalLabelSource | "multiple" | null => {
    const matches = new Set<CanonicalLabelSource>();
    for (const [normalizedForm, entry] of labelRegistry.entries()) {
      if (normalizedForm.length >= 3 && normalizedText.includes(normalizedForm)) {
        matches.add(entry.source);
      }
    }
    if (matches.size === 0) return null;
    if (matches.size === 1) return Array.from(matches)[0];
    return "multiple";
  };

  const canonicalizedCases = cases.map((vc) => {
    // Canonicalize title
    const newTitle = canonicalizeText(vc.title, labelMap);
    if (newTitle !== vc.title) {
      const source = findMatchedSource(normalizeForComparison(vc.title));
      if (source) {
        diagnostics.push({
          scenarioId: vc.displayId,
          stepIndex: -1,
          field: "title",
          originalText: vc.title,
          canonicalText: newTitle,
          matchedSource: source,
          phase: "final",
        });
        totalCanonicalized++;
      }
    }

    // Canonicalize steps
    const newSteps = vc.steps.map((step, index) => {
      const canonicalized = canonicalizeText(step, labelMap);
      if (canonicalized !== step) {
        const source = findMatchedSource(normalizeForComparison(step));
        if (source) {
          diagnostics.push({
            scenarioId: vc.displayId,
            stepIndex: index,
            field: "step",
            originalText: step,
            canonicalText: canonicalized,
            matchedSource: source,
            phase: "final",
          });
          totalCanonicalized++;
        }
      }
      return canonicalized;
    });

    // Canonicalize expectedResult
    const newExpected = canonicalizeText(vc.expectedResult, labelMap);
    if (newExpected !== vc.expectedResult) {
      const source = findMatchedSource(normalizeForComparison(vc.expectedResult));
      if (source) {
        diagnostics.push({
          scenarioId: vc.displayId,
          stepIndex: -1,
          field: "expectedResult",
          originalText: vc.expectedResult,
          canonicalText: newExpected,
          matchedSource: source,
          phase: "final",
        });
        totalCanonicalized++;
      }
    }

    // Canonicalize preconditions
    const newPreconditions = vc.preconditions.map((precond, index) => {
      const canonicalized = canonicalizeText(precond, labelMap);
      if (canonicalized !== precond) {
        const source = findMatchedSource(normalizeForComparison(precond));
        if (source) {
          diagnostics.push({
            scenarioId: vc.displayId,
            stepIndex: index,
            field: "precondition",
            originalText: precond,
            canonicalText: canonicalized,
            matchedSource: source,
            phase: "final",
          });
          totalCanonicalized++;
        }
      }
      return canonicalized;
    });

    return {
      ...vc,
      title: newTitle,
      steps: newSteps,
      expectedResult: newExpected,
      preconditions: newPreconditions,
    };
  });

  return {
    cases: canonicalizedCases,
    diagnostics,
    totalCanonicalized,
  };
}
