import fs from "node:fs";
import path from "node:path";
import type { RecordedTechnicalTarget } from "../../recording/session-trace.types";

export type PromotedFieldTargetIdentity = {
  valueKey?: string;
  technicalTargetRefs: string[];
  /**
   * The full recorded structural authority (owner tag, stable descendants, semanticShape) for
   * this step, when the persisted contract came from a Recording — not just the flattened
   * string refs. Carrying the whole `RecordedTechnicalTarget` lets promoted-runtime hand it
   * straight to `resolveActionTarget`'s existing `recordedTechnicalTargets` option (the same
   * structural-owner resolver Recording replay itself uses), instead of re-deriving identity
   * from a display label that may span more than one DOM node.
   */
  recordedTechnicalTargets?: RecordedTechnicalTarget[];
  semanticType?: string;
  valueRole?: string;
  entityScope?: string;
  rowRelation?: string | null;
  targetIdentity?: string;
  surfaceIdentity?: string;
  containerIdentity?: string;
  fieldIdentity?: string;
  controlIdentity?: string;
  expectedOutcomeKind?: "route_transition" | "in_place_transition";
  expectedRouteTransition?: boolean;
  expectedInPlaceTransition?: boolean;
  expectedRouteAfter?: string;
};

type ContractStepLike = {
  scenarioStepIndex?: unknown;
  stepIndex?: unknown;
  target?: unknown;
  valueKey?: unknown;
  technicalTargetRefs?: unknown;
  entityScope?: unknown;
  rowRelation?: unknown;
  targetIdentity?: unknown;
  canonicalTargetIdentity?: unknown;
  recordingResolvedTargetIdentity?: unknown;
  surfaceIdentity?: unknown;
  containerIdentity?: unknown;
  fieldIdentity?: unknown;
  semanticType?: unknown;
  valueRole?: unknown;
  controlIdentity?: unknown;
  expectedOutcomeKind?: unknown;
  expectedRouteTransition?: unknown;
  expectedInPlaceTransition?: unknown;
  expectedRouteAfter?: unknown;
  operation?: unknown;
  /** CORE-materialized identity embedded directly in the persisted contract (see
   *  technical-target-materializer.ts / spec-execution-contract.ts). When present, this is
   *  authoritative and the live Recording-file lookup below is skipped entirely. */
  certifiedTechnicalTarget?: unknown;
};

type PlanLike = {
  scenario?: { externalId?: unknown; title?: unknown };
  executionContract?: { steps?: unknown };
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function entityScopeFromValueKey(valueKey?: string): string | undefined {
  const match = valueKey?.match(/^(entity_\d+)\./i);
  return match?.[1];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function stepTarget(step: ContractStepLike): string | undefined {
  if (typeof step.target === "string") return nonEmptyString(step.target);
  if (step.target && typeof step.target === "object") {
    const target = step.target as { value?: unknown; text?: unknown; label?: unknown };
    return nonEmptyString(target.value) ?? nonEmptyString(target.text) ?? nonEmptyString(target.label);
  }
  return undefined;
}

export function identityFromContractStep(step: ContractStepLike): PromotedFieldTargetIdentity | undefined {
  const technicalTargetRefs = stringArray(step.technicalTargetRefs);
  const valueKey = nonEmptyString(step.valueKey);
  const targetIdentity = nonEmptyString(step.targetIdentity)
    ?? nonEmptyString(step.canonicalTargetIdentity)
    ?? nonEmptyString(step.recordingResolvedTargetIdentity);
  const certifiedTechnicalTarget = step.certifiedTechnicalTarget && typeof step.certifiedTechnicalTarget === "object"
    ? step.certifiedTechnicalTarget as RecordedTechnicalTarget
    : undefined;
  if (technicalTargetRefs.length === 0 && !targetIdentity && !valueKey && !certifiedTechnicalTarget) return undefined;
  return {
    valueKey,
    technicalTargetRefs,
    recordedTechnicalTargets: certifiedTechnicalTarget ? [certifiedTechnicalTarget] : undefined,
    entityScope: nonEmptyString(step.entityScope) ?? entityScopeFromValueKey(valueKey),
    rowRelation: typeof step.rowRelation === "string" || step.rowRelation === null ? step.rowRelation : undefined,
    targetIdentity,
    surfaceIdentity: nonEmptyString(step.surfaceIdentity),
    containerIdentity: nonEmptyString(step.containerIdentity),
    fieldIdentity: nonEmptyString(step.fieldIdentity),
    semanticType: nonEmptyString(step.semanticType) ?? (step.operation === "select" ? "selection" : undefined),
    valueRole: nonEmptyString(step.valueRole),
    controlIdentity: nonEmptyString(step.controlIdentity),
    expectedOutcomeKind: step.expectedOutcomeKind === "route_transition" || step.expectedOutcomeKind === "in_place_transition"
      ? step.expectedOutcomeKind
      : undefined,
    expectedRouteTransition: step.expectedRouteTransition === true,
    expectedInPlaceTransition: step.expectedInPlaceTransition === true,
    expectedRouteAfter: nonEmptyString(step.expectedRouteAfter),
  };
}

/**
 * `stepIndex` is unique by construction within one scenario's persisted steps — it is
 * sufficient on its own. The target-text comparison used to also gate on an exact
 * (post-normalizeAlias) match against `target`, but `target` can be a mojibake-corrupted
 * display label (introduced during spec materialization, not in the persisted plan) while
 * `candidateTarget` here (read straight from plan.json) is correctly encoded — an exact-match
 * requirement between the two would reject the right step for a reason that has nothing to do
 * with whether the step's own identity is correct. Kept as a log-only corroboration instead of
 * a veto.
 */
// A mismatched target is acceptable only when the current compiled call names
// the same valueKey; ordinal equality alone is never data-binding authority.
function isMatchingStep(
  step: ContractStepLike,
  stepIndex: number,
  target: string,
  suppliedValueKey?: string,
): boolean {
  const candidateIndex = Number(step.scenarioStepIndex ?? step.stepIndex);
  if (!Number.isFinite(candidateIndex) || candidateIndex !== stepIndex) return false;
  const candidateTarget = stepTarget(step);
  if (candidateTarget && normalizeAlias(candidateTarget) !== normalizeAlias(target)) {
    if (!suppliedValueKey || nonEmptyString(step.valueKey) !== suppliedValueKey) return false;
    console.log(`[promoted-field-target-contract] stepIndex=${stepIndex} matched by index; target text differs from persisted plan (encoding or display-only difference) — not treated as a mismatch.`);
  }
  return true;
}

function planMatchesScenario(plan: PlanLike, scenarioId: string | undefined): boolean {
  if (!scenarioId) return true;
  const externalId = nonEmptyString(plan.scenario?.externalId);
  return !externalId || normalizeAlias(externalId) === normalizeAlias(scenarioId);
}

function caseDirectoryCandidates(): string[] {
  const appSlug = nonEmptyString(process.env.APP_SLUG);
  if (!appSlug) return [];
  const sectionSlug = nonEmptyString(process.env.SECTION_SLUG) ?? "default-section";
  const root = path.resolve(process.cwd(), "automations", "apps", appSlug, "sections", sectionSlug, "cases");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "plan.json"))
    .filter((planPath) => fs.existsSync(planPath));
}

function recordingCandidates(): string[] {
  const appSlug = nonEmptyString(process.env.APP_SLUG);
  if (!appSlug) return [];
  const root = path.resolve(process.cwd(), "automations", "apps", appSlug, "recordings");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "semantic-recording.json"))
    .filter((recordingPath) => fs.existsSync(recordingPath));
}

function structuralRefFromRecordingCandidate(candidate: unknown): string | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const item = candidate as { strategy?: unknown; value?: unknown };
  if (item.strategy !== "structural" || typeof item.value !== "string" || item.value.trim() === "") return undefined;
  return `structural:${item.value.trim()}`;
}

function identityFromRecordingForValueKey(
  plan: PlanLike,
  valueKey: string,
  target: string,
): PromotedFieldTargetIdentity | undefined {
  const title = nonEmptyString(plan.scenario?.title);
  const recordingId = nonEmptyString(process.env.RECORDING_ID);
  for (const recordingPath of recordingCandidates()) {
    try {
      const recording = JSON.parse(fs.readFileSync(recordingPath, "utf8")) as {
        recordingId?: unknown;
        primaryScenario?: { title?: unknown };
        canonicalInteractions?: unknown;
      };
      if (recordingId && nonEmptyString(recording.recordingId) !== recordingId) continue;
      const recordingTitle = nonEmptyString(recording.primaryScenario?.title);
      if (!recordingId && title && recordingTitle && normalizeAlias(title) !== normalizeAlias(recordingTitle)) continue;
      // `valueKey` is already the authoritative technical identity here — it is the same
      // slugified key the persisted plan step was matched on to even reach this function, and
      // slugification is encoding-independent. `semanticField` is display corroboration only:
      // requiring it to also exact-match `target` would let a corrupted display label (e.g.
      // mojibake introduced upstream in spec materialization) veto a valueKey match that is
      // otherwise correct — exactly the failure this resolver exists to avoid. It is not
      // consulted as a filter for that reason; ambiguity is instead resolved by valueKey
      // uniqueness, and downstream by `resolveRecordedStructuralOwner`'s own
      // deterministicStructuralIdentity / structuralIdentityMatchCount gate (fail-closed on
      // zero or ambiguous DOM matches).
      const interactions = Array.isArray(recording.canonicalInteractions) ? recording.canonicalInteractions as Array<Record<string, unknown>> : [];
      const interaction = interactions.find((candidate) =>
        nonEmptyString(candidate.valueKey) === valueKey
        && (candidate.action === "select" || candidate.action === "fill" || candidate.action === "click"),
      );
      if (!interaction) continue;
      const routeBefore = nonEmptyString(interaction.routeBefore);
      const routeAfter = nonEmptyString(interaction.routeAfter);
      const expectedRouteTransition = Boolean(routeBefore && routeAfter && routeBefore !== routeAfter);
      const expectedInPlaceTransition = interaction.transitionObserved === true && !expectedRouteTransition;
      const candidates = Array.isArray(interaction.technicalTargetCandidates)
        ? interaction.technicalTargetCandidates as Array<Record<string, unknown>>
        : [];
      const locatorCandidates = candidates.flatMap((candidate) =>
        Array.isArray(candidate.locatorCandidates) ? candidate.locatorCandidates : []
      );
      const technicalTargetRefs = locatorCandidates
        .map(structuralRefFromRecordingCandidate)
        .filter((ref): ref is string => Boolean(ref));
      const persistedTechnicalTargetRefs = stringArray(interaction.technicalTargetRefs);
      const effectiveTechnicalTargetRefs = technicalTargetRefs.length > 0
        ? technicalTargetRefs
        : persistedTechnicalTargetRefs;
      // The flat string refs above only ever capture a `structural:` prefixed
      // locatorCandidate (grid/table authority) — they never carry the recorded
      // owner/stableDescendants/semanticShape structural context, because that context lives
      // on the candidate object itself, not on any of its locatorCandidates. Passing the raw
      // candidates through lets promoted-runtime reuse `resolveActionTarget`'s own
      // `recordedTechnicalTargets` resolution (the same one Recording replay already resolves
      // this exact click with) instead of losing that authority here.
      const recordedTechnicalTargets = candidates as unknown as RecordedTechnicalTarget[];
      if (effectiveTechnicalTargetRefs.length === 0 && recordedTechnicalTargets.length === 0) continue;
      return {
        valueKey,
        technicalTargetRefs: Array.from(new Set(effectiveTechnicalTargetRefs)),
        recordedTechnicalTargets: recordedTechnicalTargets.length > 0 ? recordedTechnicalTargets : undefined,
        semanticType: nonEmptyString(interaction.action === "select" ? "selection" : "amount_or_text"),
        valueRole: nonEmptyString(interaction.valueRole),
        entityScope: nonEmptyString(interaction.entityScope),
        surfaceIdentity: nonEmptyString(interaction.optionSurfaceId),
        containerIdentity: nonEmptyString(interaction.gridRef),
        controlIdentity: nonEmptyString(interaction.controlIdentity),
        expectedOutcomeKind: expectedRouteTransition ? "route_transition" : expectedInPlaceTransition ? "in_place_transition" : undefined,
        expectedRouteTransition,
        expectedInPlaceTransition,
        expectedRouteAfter: routeAfter,
      };
    } catch {
      // A malformed recording must not break promoted execution.
    }
  }
  return undefined;
}

export function resolvePromotedFieldIdentityFromPersistedContract(
  stepIndex: number,
  target: string,
  options?: { technicalTargetRefs?: string[]; valueKey?: string },
): PromotedFieldTargetIdentity | undefined {
  const scenarioId = nonEmptyString(process.env.SCENARIO_ID);
  const suppliedRefs = stringArray(options?.technicalTargetRefs);
  const suppliedValueKey = nonEmptyString(options?.valueKey);
  for (const planPath of caseDirectoryCandidates()) {
    try {
      const plan = JSON.parse(fs.readFileSync(planPath, "utf8")) as PlanLike;
      if (!planMatchesScenario(plan, scenarioId)) continue;
      const steps = Array.isArray(plan.executionContract?.steps) ? plan.executionContract.steps as ContractStepLike[] : [];
      const step = steps.find((candidate) => isMatchingStep(candidate, stepIndex, target, suppliedValueKey));
      const identity = step ? identityFromContractStep(step) : undefined;
      // New specs: the contract already carries the CORE-materialized identity — no live
      // Recording-file lookup needed (newSpecDependsOnRecordingLookup=false).
      if (identity?.recordedTechnicalTargets?.length) {
        console.log(`[technical-target-propagation] stepIndex=${stepIndex} source=contract recordingLookupSkipped=true`);
        return identity;
      }
      // Legacy specs: the persisted contract predates the materializer wiring and only has a
      // valueKey — fall back to the live Recording file the way promoted execution always has.
      if (identity?.valueKey) {
        const recordingIdentity = identityFromRecordingForValueKey(plan, identity.valueKey, target);
        if (recordingIdentity) {
          console.log(`[technical-target-propagation] stepIndex=${stepIndex} source=recording_lookup_fallback legacy=true`);
          return {
            ...identity,
            ...recordingIdentity,
            entityScope: recordingIdentity.entityScope ?? identity.entityScope,
          };
        }
        return identity;
      }
      if (identity?.technicalTargetRefs.length) return identity;
    } catch {
      // A malformed or transient plan must not break legacy promoted execution.
    }
  }
  if (suppliedRefs.length > 0 || suppliedValueKey) {
    return { technicalTargetRefs: suppliedRefs, valueKey: suppliedValueKey };
  }
  return undefined;
}

export type ParsedTechnicalTargetRefs = {
  inputHint?: string;
  gridRef?: string;
  rowRef?: string;
  cellRef?: string;
  headerRef?: string;
  semanticRole?: string;
};

export function parseTechnicalTargetRefs(refs: string[]): ParsedTechnicalTargetRefs {
  const parsed: ParsedTechnicalTargetRefs = {};
  for (const ref of refs) {
    if (ref.startsWith("role:input|")) {
      parsed.inputHint = ref.slice("role:input|".length);
      continue;
    }
    if (!ref.startsWith("structural:")) continue;
    for (const part of ref.slice("structural:".length).split("|")) {
      const separator = part.indexOf("=");
      if (separator < 0) continue;
      const key = part.slice(0, separator);
      const value = part.slice(separator + 1);
      if (key === "grid") parsed.gridRef = value;
      if (key === "row") parsed.rowRef = value;
      if (key === "cell") parsed.cellRef = value;
      if (key === "header") parsed.headerRef = value;
      if (key === "role") parsed.semanticRole = value;
    }
  }
  return parsed;
}

export function semanticNameFromRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const normalizedRef = ref.trim();
  const roleName = normalizedRef.match(/^role:[^|]+\|(.+)$/)?.[1]?.trim();
  if (roleName) return roleName;
  const colon = normalizedRef.indexOf(":");
  if (colon < 0) return undefined;
  const name = normalizedRef.slice(colon + 1).split(":row:")[0].trim();
  return name || undefined;
}
