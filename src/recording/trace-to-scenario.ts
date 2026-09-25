import type { MobileStep, MobileStepTarget, MobileLocatorStrategy } from "../mobile/mobile-step-types";
import type {
  RecordedLocator,
  RecordedEvent,
  RecordedEditingSession,
  RecordedScreen,
  SessionTrace,
  TraceSegment,
  RecordedValueConstraint,
} from "./session-trace.types";
import { aggregateTextUsedAsValue, buildSemanticRecordingModel, isSensitiveRecordedEvent, resolveRecordedField, classifySemanticEvent, normalizeRecordingDataPolicy } from "./semantic-recording";
import { reconstructLogicalInputBuffer, isGenericUnresolvedLabel } from "./trace-normalizer";
import { semanticIdentityFromFrameworkOwnerEvidence } from "./framework-owner-semantic-identity";
import { confirmedCompoundSelectionBefore, logicalCompoundChildValue } from "./compound-value";
import { quoteHumanValue, renderHumanStepValue } from "./human-step-renderer";
import type { RecordingAiScenarioProposal } from "./ai-scenario-contract";
import { buildCanonicalInteractions, enrichRecordedScenarioContract, evaluateRecordingReadiness, hasExecutionAuthority, isMaskActivation, materializedSemanticSignature, validateInteractionStateSequence, type CanonicalInteraction, type EntityActionBlock, type MutationOpportunity, type RecordingReadiness, type RuntimeInputRequirement, type ScenarioMutationProposal } from "./canonical-recording-contract";

/**
 * Builds executable scenarios from a recorded walkthrough — deterministically.
 *
 * This runs BEFORE any AI pass and produces a scenario on its own. That ordering is the
 * point: the happy path is not something to infer, it is literally what the human did, so it
 * must never depend on a model being reachable or on a prompt behaving. The AI layer that
 * runs afterwards only adds what genuinely requires judgement — the story the flow tells,
 * better wording, and the negative variants.
 */

/** A step in the web execution plan (`plan.json`), which the promoter turns into a spec. */
export type RecordedWebStep = {
  action: "navigate" | "click" | "fill" | "assert" | "wait";
  target?: { strategy: string; value: string };
  value?: string;
  valueKey?: string;
  description: string;
  entityScope?: string;
  interactionId?: string;
  screenBeforeRef?: string;
  screenAfterRef?: string;
  routeBefore?: string;
  routeAfter?: string;
  stateScope?: string;
};

export type RecordedScenarioStep = {
  /** Stable template retained for execution/runtime binding. */
  content: string;
  /** Human-facing materialization for QA Lab and TestRail preview. */
  renderedStep?: string;
  /** Explicit alias for callers that distinguish template from legacy `content`. */
  stepTemplate?: string;
  valueKey?: string;
  sensitive?: boolean;
  expected: string;
  expectedType?: "BUSINESS_ORACLE" | "TECHNICAL_STATE";
  classification?: "FUNCTIONAL_ACTION" | "FUNCTIONAL_ASSERTION" | "TECHNICAL_NOISE" | "FOCUS_ONLY" | "DYNAMIC_EDITOR_INTERNAL" | "SCREEN_TECHNICAL_TRANSITION";
  entityScope?: string;
  interactionId?: string;
  sourceEventRefs?: string[];
  /** Backend-owned display number. Consumers must not prepend a second number. */
  stepNumber?: number;
  /** Setup/navigation rows are visible but excluded from functionalActionCount. */
  isSetup?: boolean;
  screenBeforeRef?: string;
  screenAfterRef?: string;
  routeBefore?: string;
  routeAfter?: string;
  stateScope?: string;
};

export type ScenarioStepMetrics = {
  scenarioStepCount: number;
  functionalActionCount: number;
  nonUserSetupSteps: number;
  reasonForDifference: string;
};

export type RecordingScenarioQuality = {
  hasGoalContext: boolean;
  hasReachableSetup: boolean;
  hasScenarioSpecificIntent: boolean;
  hasEvidence: boolean;
  hasOracleAuthorityOrReview: boolean;
  noInventedControl: boolean;
  noUnsupportedExpectedResult: boolean;
  noGenericNegativeFromFieldOnly: boolean;
  finalDecision: "accepted" | "rejected";
  rejectionReason?: string;
};

/**
 * The identifier each executable step will act on, flattened for review.
 *
 * The step types belong to the executors and carry only `{strategy, value}`, which is all a
 * runner needs but not enough for a person deciding whether to trust the script: a locator
 * pinned to a position looks exactly like a solid one until you know it was pinned. This is
 * the recorder's own view of the same steps, so the reviewer sees what will be automated
 * before it is.
 */
export type RecordedStepTarget = {
  /** Position of the step within the scenario's executable steps. */
  stepIndex: number;
  description: string;
  strategy: string;
  value: string;
  /** The element's identity did not single it out; this locator rests on its position. */
  ambiguous?: boolean;
};

export type RecordedDataField = {
  key: string;
  label: string;
  /** Index of the step in this scenario the value feeds. */
  stepIndex: number;
  exampleValue?: string;
  sensitive: boolean;
  valueRole?: "action_input" | "secure_input" | "runtime_derived_oracle";
  source?: "RECORDED_CONFIRMED" | "secure" | "OBSERVED";
  semanticField?: string | null;
  confidence?: number;
  needsReview?: boolean;
  reviewReason?: string;
  formatHint?: string;
  constraints?: RecordedValueConstraint[];
  allowedValues?: string[];
  entityScope?: string;
  technicalTargetRefs?: string[];
  sourceEventRefs?: string[];
  validatedByInteraction?: boolean;
  /** Explicit field policy used by derived repeat scenarios; absent means role-based reuse. */
  repeatClonePolicy?: "CLONE_SAME_VALUE" | "REQUIRE_NEW_VALUE" | "DERIVE_FROM_ALLOWED_SOURCE" | "SYSTEM_GENERATED" | "NOT_APPLICABLE";
};

export type RecordedScenario = {
  scenarioId: string;
  title: string;
  /** The user story the walkthrough implies, reconstructed rather than read from Jira. */
  description: string;
  preconditions: string[];
  kind: "happy_path" | "negative";
  /**
   * Whether the walkthrough actually performed these steps.
   *
   * `observed` means every step was executed by the person being recorded, so the scenario
   * can be run back as-is. `derived` means the recording justifies the case but never walked
   * it — a control seen but not pressed, a gate seen but not forced — so its expected result
   * is a proposal a reviewer has to confirm before it is executed.
   */
  provenance: "observed" | "derived";
  /** `segment` scenarios cover the flow up to the end of one screen block, not the whole run. */
  scope?: "end_to_end" | "segment";
  /** Android execution steps. Empty for web recordings. */
  mobileSteps: MobileStep[];
  /** Web plan steps. Empty for Android recordings. */
  webSteps: RecordedWebStep[];
  /** Human-readable steps for TestRail (`custom_steps_separated`). */
  testRailSteps: RecordedScenarioStep[];
  requiredData: RecordedDataField[];
  /** The locator behind each executable step, for review before automating. */
  stepTargets: RecordedStepTarget[];
  /** Where each step came from, so a reviewer can trust or challenge it. */
  sourceRecordingId: string;
  /** Set once the scenario has been published as a TestRail case. */
  testRailCaseId?: number;
  /** True when at least one step rests on a fallback hit-test rather than a real locator. */
  hasUncertainSteps: boolean;
  /** Exactly one scenario per recording may be marked primary. */
  primary?: boolean;
  status?: "IN_PROGRESS" | "COMPLETED";
  sourceEventRefs?: string[];
  traceBacked?: boolean;
  containsUnexecutedActions?: boolean;
  replayEligible?: boolean;
  functionalReadiness?: boolean;
  technicalReadiness?: boolean;
  expectedResultCandidate?: string;
  oracleAuthority?: "observed_only" | "review_required";
  reviewStatus?: "PENDING" | "APPROVED" | "REJECTED";
  reviewedExpectedResult?: string;
  goalRelevanceScore?: number;
  goalRelevanceReasons?: string[];
  suggestionCategory?: "DERIVED_ALTERNATIVE" | "DERIVED_VALIDATION" | "AI_PROPOSED";
  confidence?: number;
  rationale?: string;
  sharedSetupRef?: string;
  sharedSetupSteps?: RecordedScenarioStep[];
  scenarioSpecificSteps?: RecordedScenarioStep[];
  quality?: RecordingScenarioQuality;
  canonicalInteractions?: CanonicalInteraction[];
  entityActionBlocks?: EntityActionBlock[];
  runtimeInputRequirements?: RuntimeInputRequirement[];
  readiness?: RecordingReadiness;
  technicalKnowledgeRefs?: string[];
  mutationOpportunities?: MutationOpportunity[];
  mutation?: ScenarioMutationProposal;
  mutationDiagnostics?: import("./canonical-recording-contract").MutationEffectDiagnostics;
  mutationPreconditionValidity?: import("./canonical-recording-contract").MutationPreconditionValidity;
  scenarioStepCount?: number;
  functionalActionCount?: number;
  nonUserSetupSteps?: number;
  reasonForDifference?: string;
  stateSequenceValid?: boolean;
  stateSequenceIssues?: string[];
  scenarioGoal?: string;
  goalContract?: { nonGeneric: boolean; goalCoherent: boolean; mutationIntentExpressed: boolean };
  postGoalObservations?: string[];
  runtimeDataset?: import("./canonical-recording-contract").ScenarioRuntimeDataset;
  negativeOracle?: import("./canonical-recording-contract").NegativeScenarioOracle;
  repeatConstraintResolutions?: import("./canonical-recording-contract").ConstraintResolution[];
  runtimeExecutionBlockedByData?: boolean;
  /** Set once this scenario's cases are filed in TestRail — the durable scenarioId → caseId mapping. */
  testRailCaseId?: number;
  /**
   * The exact TestRail destination `testRailCaseId` was published to. A caseId alone is not
   * enough to answer "does this scenario already exist in the destination the user just
   * picked?" — the same recording can be re-run against a different project/suite/section,
   * and a caseId that belongs elsewhere must never be reused as if it belonged here.
   */
  testRailDestination?: { projectId: string; suiteId?: string; sectionId: string };
  /**
   * Set once a promoted spec exists for this exact scenario — the durable scenarioId →
   * promotedSpecPath mapping. `specHash` is the sha256 of the spec text at promotion time,
   * so a later run can tell a physically-changed file apart from a still-fresh one without
   * relying on a timestamp.
   */
  promotedSpec?: {
    appSlug: string;
    specPath: string;
    specHash: string;
    automationId: string;
    sectionSlug?: string;
    generatedAt: string;
  };
};

const MOBILE_STRATEGIES = new Set<MobileLocatorStrategy>([
  "accessibilityId",
  "id",
  "xpath",
  "androidUiAutomator",
  "className",
]);

function toMobileTarget(event: RecordedEvent): MobileStepTarget | undefined {
  const locator = event.target?.locators?.[0];
  if (!locator) return undefined;
  if (!MOBILE_STRATEGIES.has(locator.strategy as MobileLocatorStrategy)) return undefined;
  return { strategy: locator.strategy as MobileLocatorStrategy, value: locator.value };
}

function slugifyKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "campo";
}

/** Row identity is the recording's structural entity evidence; it is not a product label. */
function entityScopeForTarget(target: RecordedEvent["target"]): string | undefined {
  if (target?.entityScope?.trim()) return target.entityScope.trim();
  if (target?.gridRef && (target.rowIdentity || target.rowRef)) return "entity_1";
  return undefined;
}

function valueKeyFor(event: RecordedEvent, label: string): string {
  const explicit = event.redactedKey?.trim();
  const key = explicit ? slugifyKey(explicit) : slugifyKey(label);
  const entityScope = entityScopeForTarget(event.target);
  return entityScope && !key.startsWith(`${entityScope}.`)
    ? `${entityScope}.${key}`
    : key;
}

function isCompoundValueEditor(event: RecordedEvent): boolean {
  const target = event.target;
  if (target?.compoundRole !== "amount_or_text") return false;
  return Boolean(target.displayValue) || isGenericUnresolvedLabel(target.label);
}

function stableScenarioInstanceSuffix(event: RecordedEvent): string | undefined {
  const target = event.target;
  const structural = [target?.rowIdentity ?? target?.rowRef, target?.cellRef, target?.columnIdentity ?? target?.headerRef]
    .map((value) => value?.trim())
    .filter((value): value is string => typeof value === "string" && value.length <= 80 && !/\s{2,}/.test(value));
  return structural.length > 0 ? slugifyKey(structural.join(" ")).slice(0, 36) : undefined;
}

function fieldForEvent(event: RecordedEvent, ordinal: number) {
  const resolution = resolveRecordedField(event.target, ordinal);
  const suffix = event.target?.compoundRole === "selection"
    ? "selección"
    : isCompoundValueEditor(event)
      ? "valor"
      : undefined;
  const base = resolution.semanticField ?? event.target?.associatedField ?? event.target?.headerContext;
  if (!suffix || !base) return resolution;
  return {
    ...resolution,
    semanticField: base,
    displayLabel: base,
    valueKey: `${slugifyKey(base)}_${suffix}`,
  };
}

function uniqueValueKeyFor(event: RecordedEvent, label: string, fields: readonly RecordedDataField[]): string {
  const base = valueKeyFor(event, label);
  if (!fields.some((field) => field.key === base)) return base;
  const instance = stableScenarioInstanceSuffix(event);
  return instance && !fields.some((field) => field.key === `${base}_${instance}`)
    ? `${base}_${instance}`
    : base;
}

/**
 * The text that proves the app landed where the walkthrough went next.
 *
 * A screen's title is the strongest single assertion available, but a title that is only the
 * screen's internal key proves nothing to a reader, so a real visible text is preferred when
 * the title is not one.
 */
function assertionTextFor(screen: RecordedScreen | undefined): string | undefined {
  if (!screen) return undefined;
  const title = screen.title?.trim();
  if (title && title !== screen.screenKey && title.length > 2 && !isTechnicalTitle(title)) return title;
  return screen.texts.find((t) => t.trim().length > 3)?.trim();
}

function isTechnicalTitle(value: string): boolean {
  return /hash|fingerprint|^[a-f0-9]{8,}$/i.test(value.trim()) || /^(?:screen|pantalla)[-_ ]?[a-f0-9]{6,}$/i.test(value.trim());
}

function humanScreenTitle(screen: RecordedScreen | undefined, fallback: string): string {
  const title = screen?.title?.trim();
  return title && !isTechnicalTitle(title) ? title : fallback;
}

function describeTap(event: RecordedEvent): string {
  // FIRST_LOSS fix: `target.label` is never actually empty -- every capture path defaults it to
  // the literal sentinel "control" when no real accessible name exists, so checking mere
  // truthiness rendered that sentinel itself ('Presionar "control"') as if it were a real
  // button name. `isGenericUnresolvedLabel` is the same shared check every other admission/
  // display gate in this codebase already uses to recognize this exact sentinel.
  const label = event.target?.label?.trim();
  return label && !isGenericUnresolvedLabel(label) ? `Presionar "${label}"` : "Presionar el control indicado";
}

function describeFillTemplate(label: string, valueKey: string): string {
  return `Ingresar [${valueKey}] en "${label}"`;
}

/**
 * The key itself (Enter/Tab/Escape/...) is never secret -- only a field's own VALUE is.
 * `label` comes from `resolveRecordedField`, which already carries its own human fallback
 * ("Campo pendiente de identificar") for an unresolvable target -- never re-derived here.
 */
function describePressTemplate(key: string, label: string): string {
  return `Presionar "${key}" en "${label}"`;
}

function recordedLogicalValue(
  event: RecordedEvent,
  editingSession?: RecordedEditingSession,
  compoundSelectionValue?: string,
): string | undefined {
  const target = event.target;
  if (target?.compoundRole === "amount_or_text") {
    // The child editing session is authoritative. Parent display/formatting is evidence only;
    // it is never parsed to reconstruct the logical amount.
    const separateEditableEvidence = Boolean(
      target.deepestEditableTargetRef &&
      (target.eventTargetRef ?? editingSession?.eventTargetRef) &&
      target.deepestEditableTargetRef !== (target.currentTargetRef ?? editingSession?.currentTargetRef),
    ) || Boolean(editingSession?.deepestEditableTargetRef && editingSession.technicalTargetRefs.length > 0);
    if (!separateEditableEvidence) return undefined;
    const logicalBuffer = editingSession?.finalValue
      ?? editingSession?.rawTypedValue
      ?? editingSession?.logicalBuffer
      ?? (editingSession ? reconstructLogicalInputBuffer(editingSession) : undefined);
    if (logicalBuffer !== undefined) {
      return logicalCompoundChildValue(logicalBuffer, compoundSelectionValue)
        ?? (aggregateTextUsedAsValue(event) ? undefined : logicalBuffer);
    }
    const committedChildValue = target.committedValue
      ?? target.afterState?.committedValue
      ?? editingSession?.committedValue
      ?? editingSession?.finalValue;
    if (committedChildValue) {
      return logicalCompoundChildValue(committedChildValue, compoundSelectionValue)
        ?? (aggregateTextUsedAsValue(event) ? undefined : committedChildValue);
    }
    const childValue = target.rawTypedValue ?? editingSession?.rawTypedValue;
    if (childValue) {
      return logicalCompoundChildValue(childValue, compoundSelectionValue)
        ?? (aggregateTextUsedAsValue(event) ? undefined : childValue);
    }
    if (aggregateTextUsedAsValue(event)) return undefined;
    return target.inputValue ?? event.value;
  }
  return target?.committedValue
    ?? target?.afterState?.committedValue
    ?? target?.rawTypedValue
    ?? target?.inputValue
    ?? event.value;
}

function describeFillRendered(
  event: RecordedEvent,
  label: string,
  template: string,
  // FIRST_LEAK fix: `trace` was used only to read `recordingDataPolicy.persistQaCredentials` and
  // let a "yes, persist QA credentials" policy control this DISPLAY text -- but that policy
  // governs the EXECUTION channel (whether the runtime dataset may carry the real secret so a
  // live fill can use it), never the PRESENTATION channel. DISPLAY VALUE != EXECUTION VALUE: a
  // sensitive field's real value must never appear in human-readable step text, unconditionally,
  // regardless of that policy. Parameter kept for call-site compatibility, no longer read.
  _trace: SessionTrace,
  editingSession?: RecordedEditingSession,
  compoundSelectionValue?: string,
): string {
  const sensitive = isSensitiveRecordedEvent(event);
  if (sensitive) return `Ingresar el valor seguro asociado a "${label}"`;
  const logicalValue = recordedLogicalValue(event, editingSession, compoundSelectionValue);
  if (logicalValue !== undefined) return `Ingresar ${quoteHumanValue(logicalValue)} en "${label}"`;
  return template;
}

function selectionValueKey(event: RecordedEvent, label: string): string {
  const base = slugifyKey(event.target?.associatedField?.trim() || label);
  const key = event.target?.interactionType === "select" || event.target?.compoundRole === "selection"
    ? `${base}_seleccion`
    : base;
  const entityScope = entityScopeForTarget(event.target);
  return entityScope ? `${entityScope}.${key}` : key;
}

function describeSelectionRendered(event: RecordedEvent, label: string, template: string): string {
  return event.target?.afterValue === undefined
    ? template
    : `Seleccionar ${quoteHumanValue(event.target.afterValue)} en "${label}"`;
}

export function scenarioStepMetrics(steps: readonly RecordedScenarioStep[]): ScenarioStepMetrics {
  const nonUserSetupSteps = steps.filter((step) => step.isSetup === true).length;
  const functionalActionCount = steps.filter((step) => !step.isSetup && step.classification === "FUNCTIONAL_ACTION").length;
  return {
    scenarioStepCount: steps.length,
    functionalActionCount,
    nonUserSetupSteps,
    reasonForDifference: nonUserSetupSteps > 0
      ? "El contador funcional excluye filas de setup/navegación inicial visibles en el preview."
      : "Todas las filas del escenario son acciones funcionales.",
  };
}

function canonicalForStep(step: RecordedScenarioStep, interactions: readonly CanonicalInteraction[]): CanonicalInteraction | undefined {
  return step.interactionId ? interactions.find((interaction) => interaction.id === step.interactionId) : undefined;
}

function attachStateOwnership(
  steps: readonly RecordedScenarioStep[],
  interactions: readonly CanonicalInteraction[],
): RecordedScenarioStep[] {
  return steps.map((step) => {
    const interaction = canonicalForStep(step, interactions);
    if (!interaction) return step;
    return {
      ...step,
      ...(interaction.screenBeforeRef ? { screenBeforeRef: interaction.screenBeforeRef } : {}),
      ...(interaction.screenAfterRef ? { screenAfterRef: interaction.screenAfterRef } : {}),
      ...(interaction.routeBefore ? { routeBefore: interaction.routeBefore } : {}),
      ...(interaction.routeAfter ? { routeAfter: interaction.routeAfter } : {}),
      ...(interaction.stateScope ? { stateScope: interaction.stateScope } : {}),
    };
  });
}

function numberScenarioSteps(steps: readonly RecordedScenarioStep[]): RecordedScenarioStep[] {
  return steps.map((step, index) => ({ ...step, stepNumber: index + 1 }));
}

export type BuildScenarioOptions = {
  /** Title for the derived happy path. Defaults to the recording label or the last screen. */
  title?: string;
  scenarioIdPrefix?: string;
  /** Legacy test-only aliases; production goal authority comes from SessionTrace. */
  recordingId?: string;
  goal?: string;
};

function normalizeGoalToken(value: string): string[] {
  const stop = new Set(["el", "la", "los", "las", "un", "una", "de", "del", "en", "para", "por", "y", "a", "con"]);
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !stop.has(token));
}

export type GoalRelevance = { score: number; reasons: string[] };

/** Scores suggestions from structural evidence, never from an application-specific vocabulary. */
export function scoreGoalRelevance(
  goal: string | undefined,
  candidate: Pick<RecordedScenario, "title" | "description" | "requiredData" | "testRailSteps">,
): GoalRelevance {
  const goalTokens = new Set(normalizeGoalToken(goal ?? ""));
  if (goalTokens.size === 0) return { score: 0.5, reasons: ["goal_not_declared"] };
  const candidateText = [
    candidate.title,
    candidate.description,
    ...candidate.requiredData.map((field) => field.label),
    // The preamble is how a derived case reaches a screen, not what makes the candidate
    // relevant. Including it made an unrelated menu option inherit the goal vocabulary from
    // the happy path and pass on a misleading token overlap.
    candidate.testRailSteps.at(-1)?.content ?? "",
  ].join(" ");
  const candidateTokens = new Set(normalizeGoalToken(candidateText));
  const overlap = [...goalTokens].filter((token) => candidateTokens.has(token));
  const reasons = overlap.length > 0 ? [`shared_semantic_tokens:${overlap.length}`] : [];
  // One shared noun is not evidence that a candidate tests the declared operation. A
  // navigation item such as "Registro Digital Nuevos Colaboradores" shares "colaboradores"
  // with "Agregar varios colaboradores" but abandons the operation under test.
  const coverage = overlap.length / Math.max(goalTokens.size, 1);
  const operationEvidence = [...candidateTokens].some((token) => /^(crear|agregar|editar|validar|eliminar|registrar|actualizar|seleccionar|seleccionar|elegir|completar|consultar|gestionar|anadir)$/.test(token));
  const navigationOnly = [...candidateTokens].some((token) => /^(menu|inicio|registro|digital|ayuda|contacto|productos|configurar|navegar|volver)$/.test(token))
    && ![...candidateTokens].some((token) => /^(crear|agregar|editar|validar|eliminar|registrar|actualizar|completar|consultar|gestionar|anadir)$/.test(token));
  const score = navigationOnly ? 0.05 : overlap.length === 0 ? 0.05 : operationEvidence
    ? Math.min(0.95, 0.45 + coverage * 0.5)
    : Math.min(0.55, coverage * 0.55);
  if (candidate.requiredData.length > 0) reasons.push("candidate_has_observed_data");
  if (!operationEvidence && overlap.length > 0) reasons.push("shared_entity_without_operation_evidence");
  if (navigationOnly) reasons.push("navigation_alternative_abandons_declared_operation");
  return { score, reasons };
}

export function deduplicateGoalSuggestions(
  suggestions: readonly RecordedScenario[],
): { suggestions: RecordedScenario[]; duplicatesRemoved: number } {
  const seen = new Set<string>();
  const result: RecordedScenario[] = [];
  for (const suggestion of suggestions) {
    const identity = [
      suggestion.suggestionCategory ?? "DERIVED_ALTERNATIVE",
      suggestion.requiredData.map((field) => field.key).sort().join(","),
      suggestion.testRailSteps.map((step) => normalizeGoalToken(step.content).join(" ")).join("|"),
    ].join("::");
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(suggestion);
  }
  return { suggestions: result, duplicatesRemoved: suggestions.length - result.length };
}

const VAGUE_SETUP_STEP = /(?:completar|llenar|rellenar).*?(?:dem[aá]s|otros|resto|todos).*?(?:campos|datos)|datos +requeridos|continuar +normalmente/i;
const DEFINITIVE_UNSUPPORTED_ORACLE = /(?:el sistema|la aplicaci[oó]n).{0,40}(?:rechaza|solicita corregir|muestra un error|impide|bloquea)/i;

function proposalEvidenceRefsAreObserved(proposal: RecordingAiScenarioProposal, primary: RecordedScenario): boolean {
  const observed = new Set(primary.sourceEventRefs ?? []);
  return proposal.sourceEvidenceRefs.length > 0
    && proposal.sourceEvidenceRefs.every((ref) => /^event-\d+$/.test(ref) && observed.has(ref));
}

function hasReliableConstraintEvidence(trace: SessionTrace, proposal: RecordingAiScenarioProposal): boolean {
  const refs = new Set(proposal.sourceEvidenceRefs);
  const events = trace.events.filter((_, index) => refs.has(`event-${index + 1}`));
  if (events.some((event) => event.target?.enabled === false)) return true;
  if (events.some((event) => Object.keys(event.target?.attributes ?? {}).some((key) => /required|pattern|min|max|length|step/i.test(key)))) return true;
  const visibleEvidence = trace.screens.flatMap((screen) => screen.texts).join(" ");
  return /(?:error|inv[aá]lid|obligatorio|requerido|validaci[oó]n|formato incorrecto|debe completar)/i.test(visibleEvidence);
}

function candidateMentionsOnlyObservedControls(
  proposal: RecordingAiScenarioProposal,
  trace: SessionTrace,
  primary: RecordedScenario,
): boolean {
  const observedText = [
    ...trace.events.flatMap((event) => [event.target?.label, event.target?.associatedField, event.target?.headerContext]),
    ...trace.screens.flatMap((screen) => screen.controls.map((control) => control.label)),
    ...primary.requiredData.map((field) => field.label),
    ...primary.testRailSteps.map((step) => step.content),
  ].filter((value): value is string => Boolean(value)).join(" ").toLocaleLowerCase();
  const candidateText = [...proposal.scenarioSpecificSteps, ...proposal.steps].map((step) => step.content).join(" ");
  const quoted = [...candidateText.matchAll(/["“]([^"”]+)["”]/g)].map((match) => match[1].trim()).filter((value) => value.length > 2);
  return quoted.every((value) => observedText.includes(value.toLocaleLowerCase()));
}

function sharedSetupForProposal(proposal: RecordingAiScenarioProposal, primary: RecordedScenario): RecordedScenarioStep[] {
  const evidenceIndexes = proposal.sourceEvidenceRefs
    .map((ref) => Number(ref.replace("event-", "")))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (evidenceIndexes.length === 0) return [...primary.testRailSteps];
  const ratio = Math.min(0.92, Math.max(0.2, (evidenceIndexes[0] - 1) / Math.max(primary.sourceEventRefs?.length ?? evidenceIndexes[0], 1)));
  const setupCount = Math.min(primary.testRailSteps.length, Math.max(1, Math.floor(primary.testRailSteps.length * ratio)));
  return primary.testRailSteps.slice(0, setupCount);
}

export function evaluateRecordingSuggestionQuality(
  goal: string | undefined,
  trace: SessionTrace,
  primary: RecordedScenario,
  proposal: RecordingAiScenarioProposal,
): RecordingScenarioQuality {
  const candidate: Pick<RecordedScenario, "title" | "description" | "requiredData" | "testRailSteps"> = {
    title: proposal.title,
    description: proposal.rationale,
    requiredData: [],
    testRailSteps: proposal.scenarioSpecificSteps,
  };
  const relevance = scoreGoalRelevance(goal, candidate);
  const hasGoalContext = proposal.goalRelated && relevance.score >= 0.6;
  const sharedSetup = sharedSetupForProposal(proposal, primary);
  const materialized = proposal.steps.length > 0 && proposal.steps.length >= sharedSetup.length
    ? proposal.steps
    : [...sharedSetup, ...proposal.scenarioSpecificSteps];
  const hasReachableSetup = proposal.sharedSetupRef === primary.scenarioId
    && sharedSetup.length > 0
    && materialized.slice(0, sharedSetup.length).every((step, index) => step.content === sharedSetup[index]?.content);
  const hasScenarioSpecificIntent = proposal.scenarioSpecificSteps.length > 0
    && proposal.scenarioSpecificSteps.every((step) => step.content.trim().length > 3 && !VAGUE_SETUP_STEP.test(step.content));
  const hasEvidence = proposalEvidenceRefsAreObserved(proposal, primary);
  const hasOracleAuthorityOrReview = proposal.oracleAuthority !== "MISSING" || proposal.needsReview;
  const noInventedControl = candidateMentionsOnlyObservedControls(proposal, trace, primary);
  const constraintEvidence = hasReliableConstraintEvidence(trace, proposal);
  const genericFieldNegative = proposal.type === "DERIVED_VALIDATION" && !constraintEvidence;
  const noGenericNegativeFromFieldOnly = !genericFieldNegative;
  const noUnsupportedExpectedResult = !DEFINITIVE_UNSUPPORTED_ORACLE.test(proposal.expectedResultCandidate)
    || (proposal.oracleAuthority !== "AI_HYPOTHESIS" && proposal.oracleAuthority !== "MISSING" && constraintEvidence)
    || (proposal.needsReview && (proposal.oracleAuthority === "AI_HYPOTHESIS" || proposal.oracleAuthority === "MISSING"));
  const critical = [
    hasGoalContext,
    hasReachableSetup,
    hasScenarioSpecificIntent,
    hasEvidence,
    hasOracleAuthorityOrReview,
    noInventedControl,
    noUnsupportedExpectedResult,
    noGenericNegativeFromFieldOnly,
  ];
  let rejectionReason: string | undefined;
  if (!hasGoalContext) rejectionReason = "goal_coherence_failed";
  else if (!hasReachableSetup) rejectionReason = "suggestion_not_materialized_from_primary_setup";
  else if (!hasScenarioSpecificIntent) rejectionReason = "vague_or_incomplete_scenario_specific_steps";
  else if (!hasEvidence) rejectionReason = "missing_observed_evidence_refs";
  else if (!noInventedControl) rejectionReason = "control_not_observed_in_recording";
  else if (!noGenericNegativeFromFieldOnly) rejectionReason = "generic_negative_without_constraint_or_validation_evidence";
  else if (!noUnsupportedExpectedResult) rejectionReason = "unsupported_authoritative_expected_result";
  return {
    hasGoalContext,
    hasReachableSetup,
    hasScenarioSpecificIntent,
    hasEvidence,
    hasOracleAuthorityOrReview,
    noInventedControl,
    noUnsupportedExpectedResult,
    noGenericNegativeFromFieldOnly,
    finalDecision: critical.every(Boolean) ? "accepted" : "rejected",
    ...(rejectionReason ? { rejectionReason } : {}),
  };
}

export function materializeRecordingSuggestion(
  primary: RecordedScenario,
  proposal: RecordingAiScenarioProposal,
  quality: RecordingScenarioQuality,
): RecordedScenario {
  const goal = primary.scenarioGoal?.trim() || primary.title.trim();
  const genericTitle = /^(?:comprobar varias entidades|opci[oó]n alternativa|repetir entidad|zero_entity|alternative_selection)$/i.test(proposal.title.trim());
  const humanTitle = genericTitle
    ? `${goal}: ${proposal.type === "DERIVED_VALIDATION" ? "comprobar el comportamiento de la variante observada" : "comprobar la alternativa observada"}`
    : proposal.title;
  const sharedSetupSteps = sharedSetupForProposal(proposal, primary);
  const materializedSteps = proposal.steps.length >= sharedSetupSteps.length
    && proposal.steps.slice(0, sharedSetupSteps.length).every((step, index) => step.content === sharedSetupSteps[index]?.content)
    ? proposal.steps
    : [...sharedSetupSteps, ...proposal.scenarioSpecificSteps];
  const hypothesis = proposal.oracleAuthority === "AI_HYPOTHESIS" || proposal.oracleAuthority === "MISSING" || proposal.hypothesis;
  const safeSteps = materializedSteps.map((step, index) => ({
    ...step,
    // Keep the observed setup oracle intact. Only the unexecuted variant is explicitly
    // marked for review when the provider cannot support its expected result.
    expected: hypothesis && index >= sharedSetupSteps.length
      ? "Resultado por confirmar: la grabación no observó esta variante"
      : step.expected,
  }));
  const numberedSafeSteps = numberScenarioSteps(safeSteps);
  return {
    ...primary,
    scenarioId: `${primary.scenarioId}-AI-${humanTitle.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 24) || "proposal"}`,
    title: capTitle(humanTitle),
    description: proposal.rationale,
    preconditions: [...primary.preconditions, `Setup común: ${primary.scenarioId}`],
    kind: proposal.type === "DERIVED_VALIDATION" ? "negative" : "happy_path",
    provenance: "derived",
    mobileSteps: [],
    webSteps: [],
    testRailSteps: numberedSafeSteps,
    requiredData: [],
    stepTargets: [],
    sourceRecordingId: primary.sourceRecordingId,
    hasUncertainSteps: true,
    primary: false,
    sourceEventRefs: proposal.sourceEvidenceRefs,
    traceBacked: true,
    containsUnexecutedActions: true,
    functionalReadiness: true,
    technicalReadiness: false,
    suggestionCategory: proposal.type,
    confidence: proposal.confidence,
    rationale: proposal.rationale,
    expectedResultCandidate: hypothesis ? "Resultado por confirmar; requiere revisión humana" : proposal.expectedResultCandidate,
    oracleAuthority: "review_required",
    sharedSetupRef: primary.scenarioId,
    sharedSetupSteps,
    scenarioSpecificSteps: proposal.scenarioSpecificSteps,
    quality,
    ...scenarioStepMetrics(numberedSafeSteps),
  };
}

export function filterGoalScopedSuggestions(
  goal: string | undefined,
  suggestions: readonly RecordedScenario[],
  threshold = 0.6,
  primary?: RecordedScenario,
): { suggestions: RecordedScenario[]; irrelevantCandidatesRejected: number; duplicatesRemoved: number; rejectedBecause: string[] } {
  const scored = suggestions.map((suggestion) => {
    const relevance = scoreGoalRelevance(goal, suggestion);
    return {
      ...suggestion,
      primary: false,
      goalRelevanceScore: relevance.score,
      goalRelevanceReasons: relevance.reasons,
      confidence: suggestion.confidence ?? (suggestion.hasUncertainSteps ? 0.6 : 0.85),
      rationale: suggestion.rationale ?? "Derivado de evidencia observada y separado del recorrido principal.",
      suggestionCategory: suggestion.suggestionCategory
        ?? (suggestion.kind === "negative" ? "DERIVED_VALIDATION" : "DERIVED_ALTERNATIVE"),
      traceBacked: true,
      containsUnexecutedActions: true,
      functionalReadiness: suggestion.testRailSteps.length > 0,
      technicalReadiness: !suggestion.hasUncertainSteps,
      oracleAuthority: "review_required" as const,
    };
  });
  const primarySignature = primary ? materializedSemanticSignature(primary) : undefined;
  const mutationNoEffect = primarySignature
    ? scored.filter((suggestion) => materializedSemanticSignature(suggestion) === primarySignature)
    : [];
  const noEffectIds = new Set(mutationNoEffect.map((suggestion) => suggestion.scenarioId));
  const relevant = scored.filter((suggestion) => !noEffectIds.has(suggestion.scenarioId) && (Boolean(suggestion.mutation) || (suggestion.goalRelevanceScore ?? 0) >= threshold));
  for (const suggestion of relevant) {
    if (!suggestion.runtimeInputRequirements) continue;
    const readiness = evaluateRecordingReadiness({
      functionalReadiness: suggestion.testRailSteps.length > 0,
      technicalReadiness: suggestion.technicalReadiness === true,
      oracleReadiness: (suggestion.oracleAuthority as string) === "observed_only",
      runtimeInputRequirements: suggestion.runtimeInputRequirements,
      publicationRequiresOracle: true,
    });
    Object.assign(suggestion, {
      readiness,
      functionalReadiness: readiness.functionalReadiness,
      technicalReadiness: readiness.technicalReadiness,
    });
  }
  const deduped = deduplicateGoalSuggestions(relevant);
  return {
    suggestions: deduped.suggestions,
    irrelevantCandidatesRejected: scored.length - relevant.length,
    duplicatesRemoved: deduped.duplicatesRemoved,
    rejectedBecause: mutationNoEffect.length > 0 ? ["MUTATION_NO_EFFECT"] : [],
  };
}

/**
 * Converts the normalized walkthrough into one happy-path scenario.
 *
 * Assertions are inserted at every screen transition rather than only at the end: a recording
 * of a five-screen flow that only asserts the final screen passes even when the app took a
 * completely different route to get there, which is exactly the failure a recorded test is
 * supposed to catch.
 */
export function buildHappyPathScenario(
  trace: SessionTrace,
  events: readonly RecordedEvent[],
  options: BuildScenarioOptions = {},
): RecordedScenario {
  const screenById = new Map(trace.screens.map((s) => [s.screenKey, s]));
  const mobileSteps: MobileStep[] = [];
  const webSteps: RecordedWebStep[] = [];
  const testRailSteps: RecordedScenarioStep[] = [];
  const requiredData: RecordedDataField[] = [];
  const stepTargets: RecordedStepTarget[] = [];
  let hasUncertainSteps = false;
  const segmentGroupValueKeys = new Map<string, string>();
  const semanticModel = buildSemanticRecordingModel(trace, events);
  const canonicalEvents = buildCanonicalInteractions(events, semanticModel.editingSessions);
  const editingSessionsByRef = new Map(semanticModel.editingSessions.map((session) => [session.editingSessionId, session]));
  const canonicalByEvent = new Map(canonicalEvents.flatMap((interaction) => interaction.sourceEventRefs.map((ref) => [ref, interaction] as const)));

  const isMobile = trace.platform === "android";
  const recordingDataPolicy = normalizeRecordingDataPolicy(trace.recordingDataPolicy);

  if (isMobile) {
    mobileSteps.push({
      action: "launchApp",
      description: `Abrir la aplicación ${trace.appPackage ?? trace.appSlug}`,
    });
  } else if (trace.baseUrl) {
    webSteps.push({
      action: "navigate",
      value: trace.baseUrl,
      description: `Navegar a ${trace.baseUrl}`,
    });
  }
  testRailSteps.push({
    content: isMobile ? "Abrir la aplicación configurada" : "Abrir la aplicación configurada del proyecto",
    expected: "La aplicación carga su pantalla inicial",
    classification: "FUNCTIONAL_ACTION",
    isSetup: true,
  });

  for (const [eventIndex, event] of events.entries()) {
    if (event.kind === "note" || event.kind === "launch") continue;
    const canonical = canonicalByEvent.get(`event-${eventIndex + 1}`);
    // Recording Stop is the boundary. A state transition can end one screen and open the
    // next one; it is not a reason to discard later user actions. Only evidence explicitly
    // classified as technical-only is omitted from the executable projection.
    if (canonical?.technicalOnly && event.kind !== "screen_change") continue;
    if (isMaskActivation(events, eventIndex)) continue;
    const nextMeaningful = events.slice(eventIndex + 1).find((candidate) => candidate.kind === "tap" || candidate.kind === "fill");
    const classification = classifySemanticEvent(event, nextMeaningful);
    if (classification === "FOCUS_ONLY" || classification === "DYNAMIC_EDITOR_INTERNAL") continue;

    if (event.kind === "screen_change") {
      const destination = screenById.get(event.toScreenKey ?? "");
      const text = assertionTextFor(destination);
      if (!text) continue;
      if (isMobile) {
        mobileSteps.push({
          action: "assertVisible",
          target: { strategy: "androidUiAutomator", value: `new UiSelector().textContains("${text.replace(/"/g, '\\"')}")` },
          description: `Verificar que se muestra "${text}"`,
        });
      } else {
        webSteps.push({
          action: "assert",
          target: { strategy: "text", value: text },
          description: `Verificar que se muestra "${text}"`,
        });
      }
      testRailSteps.push({
        content: `El sistema muestra "${text}"`,
        expected: `Se muestra "${text}"`,
        classification: "FUNCTIONAL_ASSERTION",
      });
      continue;
    }

    // A discrete keyboard command (Enter/Tab/Escape/...) is its own technical action -- see
    // `CanonicalInteraction.key` -- but it never gets a functional/TestRail step of its own, so
    // it silently disappeared from the human-facing narrative even though it stayed the
    // execution authority end to end. Display-only: no web/mobile step is created here, so the
    // technical press keeps being the sole executable authority (via RecordingExecutionContract).
    if (event.kind === "press") {
      const resolution = fieldForEvent(event, eventIndex + 1);
      const label = resolution.displayLabel;
      const key = canonical?.key?.trim() || event.note?.trim();
      if (key) {
        const description = describePressTemplate(key, label);
        testRailSteps.push({
          content: description,
          ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
          sourceEventRefs: [`event-${eventIndex + 1}`],
          renderedStep: description,
          interactionId: `interaction-${eventIndex + 1}`,
          sensitive: isSensitiveRecordedEvent(event),
          expected: "",
          classification: "FUNCTIONAL_ACTION",
        });
      }
      continue;
    }

    const target = event.target;
    if (!target) continue;
    if (!target.locators?.length) {
      // FIRST_LOSS fix (recordingId=efff98e2-...): canonical-recording-contract.ts's
      // collapseSegmentedInputs already merges N sibling segment-box fills into ONE canonical
      // interaction so the dataset/execution engine only ever holds ONE secure token value (never
      // one leaked value per box) -- but this loop iterates the RAW per-box events, and without
      // this branch each of the N raw fills below would independently re-enter the generic fill
      // branch and push its OWN requiredData entry, silently splitting one token into N stored
      // values again. Emit one narrative step per box ("dígito N de M") so the human-facing plan
      // still shows every box the user actually filled, but bind every one of them to the SAME
      // single valueKey and push the shared requiredData entry only once, on the first box.
      const segmentGroup = event.kind === "fill" && canonical?.playwrightRecorderEvidence?.kind === "segmented_input" && canonical.sourceEventRefs.length > 1
        ? canonical
        : undefined;
      if (segmentGroup) {
        const segmentCount = segmentGroup.playwrightRecorderEvidence!.segmentCount!;
        const groupKey = segmentGroup.sourceEventRefs[0];
        const position = segmentGroup.sourceEventRefs.indexOf(`event-${eventIndex + 1}`) + 1;
        const resolution = fieldForEvent(event, eventIndex + 1);
        const label = resolution.displayLabel;
        // Every box in the group must share the exact same valueKey (computed once, from the
        // first box) so all N narrative steps bind to the ONE requiredData entry below -- never
        // recomputed per box, which would otherwise mint a distinct key per position.
        const valueKey = position === 1
          ? uniqueValueKeyFor(event, resolution.valueKey, requiredData)
          : segmentGroupValueKeys.get(groupKey)!;
        if (position === 1) {
          segmentGroupValueKeys.set(groupKey, valueKey);
          requiredData.push({
            key: valueKey,
            label,
            ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
            stepIndex: testRailSteps.length,
            technicalTargetRefs: [],
            sourceEventRefs: segmentGroup.sourceEventRefs,
            exampleValue: undefined,
            sensitive: true,
            valueRole: "secure_input",
            source: "secure",
            confidence: 0.7,
            needsReview: false,
            formatHint: `segmented_${segmentCount}`,
          });
        }
        const description = `Ingresar dígito ${position} de ${segmentCount} en "${label}"`;
        testRailSteps.push({
          content: description,
          ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
          sourceEventRefs: [`event-${eventIndex + 1}`],
          renderedStep: description,
          valueKey,
          interactionId: `interaction-${eventIndex + 1}`,
          sensitive: true,
          expected: "",
          classification: "FUNCTIONAL_ACTION",
          // FIRST_LOSS fix (jobId 281a84ec-...): canonicalInteractions (used by discovery's own
          // action-target list) already carries playwrightRecorderEvidence/resolutionState for
          // the merged segmented group, but THIS testRailStep -- the shape spec generation reads
          // to build its ScenarioStepLike steps -- never did, so spec-execution-contract.ts's
          // authority resolver never saw resolutionState==="runtime_resolution_required" and fell
          // through to a generic field-scoped text-tier materialization instead, producing a
          // regular fillPromotedField call that could never find one editable "Campo pendiente de
          // identificar" element (there are 6, all sharing that same generic label). Carrying the
          // real evidence through here lets the compiler correctly emit the dedicated
          // fillSegmentedInput dispatch instead.
          resolutionState: "runtime_resolution_required",
          playwrightRecorderEvidence: segmentGroup.playwrightRecorderEvidence,
        });
        hasUncertainSteps = true;
        continue;
      }
      // A recorder may still have a confirmed value when the technical locator was lost during
      // a DOM replacement. Keep the human/TestRail evidence and its dataset binding, but do not
      // invent an executable web target. The missing locator remains visible through the
      // scenario's technical readiness flag.
      if (event.kind === "tap" && event.target?.compoundRole === "selection" && event.target.afterValue !== undefined) {
        const selectionResolution = fieldForEvent(event, eventIndex + 1);
        const selectionLabel = selectionResolution.semanticField ?? event.target.associatedField ?? event.target.label;
        const selectionKey = selectionValueKey(event, selectionLabel);
        const description = `Seleccionar [${selectionKey}] en "${selectionLabel}"`;
        if (!requiredData.some((field) => field.key === selectionKey)) requiredData.push({
          key: selectionKey,
          label: selectionLabel,
          ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
          stepIndex: testRailSteps.length,
          technicalTargetRefs: [],
          sourceEventRefs: [`event-${eventIndex + 1}`],
          exampleValue: event.target.afterValue,
          sensitive: false,
          valueRole: "action_input",
          source: "RECORDED_CONFIRMED",
        });
        testRailSteps.push({ content: description, stepTemplate: description, renderedStep: describeSelectionRendered(event, selectionLabel, description), valueKey: selectionKey, entityScope: entityScopeForTarget(event.target), interactionId: `interaction-${eventIndex + 1}`, sourceEventRefs: [`event-${eventIndex + 1}`], expected: "", classification: "FUNCTIONAL_ACTION" });
        hasUncertainSteps = true;
      } else if (event.kind === "tap") {
        // A plain click (never a selection, never a fill) whose target has no locator at all --
        // e.g. a genuinely icon-only button with no distinguishing attribute CaptureEngine V2
        // could turn into a locator -- was previously silently dropped here entirely: this
        // block only ever handled the selection-compound and fill shapes, so a real click that
        // fell through both simply never became a step, truncating the visible scenario right
        // after whatever preceded it. RAW TECHNICAL ACTION != DISPLAY LABEL: this never invents
        // an accessible name for the button -- it only says the click exists, referencing its
        // real structural field relation (`associatedField`, never a generic/unresolved one)
        // when one exists, or falling back to `describeTap`'s own honest neutral wording
        // ("Presionar el control indicado") when it does not. The click's execution authority
        // is unaffected by this display step either way: `buildCanonicalInteractions` already
        // always produces its own `CanonicalInteraction` for this event, independent of this
        // human-facing step list.
        // Priority: a REAL accessible name always wins (describeTap already renders it); only
        // when the button has none does the certified field relation become worth mentioning,
        // and only when that relation is itself real (never a generic "control"/"campo" value).
        // FIRST_LOSS fix: `target.label` is NEVER actually empty -- every capture path (V2's
        // adapter, the legacy recorder) defaults it to the literal sentinel "control" when no
        // real name exists (`label: action.identity.label ?? ... ?? "control"`), so checking
        // its mere truthiness always took this branch and rendered the sentinel itself
        // ('Presionar "control"') as if it were a real button name -- confirmed against a real
        // recording's persisted trace. `isGenericUnresolvedLabel` is the same shared check every
        // other admission/display gate in this codebase already uses for this exact sentinel.
        const realLabel = event.target?.label?.trim();
        const hasRealAccessibleName = Boolean(realLabel) && !isGenericUnresolvedLabel(realLabel!);
        const frameworkOwner = semanticIdentityFromFrameworkOwnerEvidence(event.target);
        const associatedField = event.target?.associatedField?.trim();
        const unresolvedSemanticDisplay = !event.target?.locators?.length
          && associatedField
          && !isGenericUnresolvedLabel(associatedField);
        const description = hasRealAccessibleName
          ? unresolvedSemanticDisplay
            ? `Presionar "${associatedField}"`
            : describeTap(event)
          : frameworkOwner.semanticIdentity
            ? `Presionar "${frameworkOwner.semanticIdentity}"`
            : frameworkOwner.isFrameworkOwner
              ? describeTap(event)
          : associatedField && !isGenericUnresolvedLabel(associatedField)
            ? `Presionar botón asociado a "${associatedField}"`
            : describeTap(event);
        testRailSteps.push({
          content: description,
          ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
          sourceEventRefs: [`event-${eventIndex + 1}`],
          renderedStep: description,
          interactionId: `interaction-${eventIndex + 1}`,
          expected: "",
          classification: "FUNCTIONAL_ACTION",
        });
        hasUncertainSteps = true;
      }
      if (event.kind === "fill") {
        const resolution = fieldForEvent(event, eventIndex + 1);
        const label = resolution.displayLabel;
        const stepIndex = testRailSteps.length;
        const sensitive = isSensitiveRecordedEvent(event);
        const valueKey = uniqueValueKeyFor(event, resolution.valueKey, requiredData);
        const stepTemplate = describeFillTemplate(label, valueKey);
        requiredData.push({
          key: valueKey,
          label,
           ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
          stepIndex,
          technicalTargetRefs: event.target?.locators?.map((locator) => `${locator.strategy}:${locator.value}`),
          sourceEventRefs: [`event-${eventIndex + 1}`],
          exampleValue: sensitive && !recordingDataPolicy.persistQaCredentials ? undefined : recordedLogicalValue(event, editingSessionsByRef.get(event.target?.editingSessionRef ?? ""), confirmedCompoundSelectionBefore(events, eventIndex, event.target)),
          sensitive,
          valueRole: sensitive ? "secure_input" : "action_input",
          source: sensitive ? "secure" : "RECORDED_CONFIRMED",
          validatedByInteraction: event.target?.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction) === true,
          confidence: resolution.needsReview ? 0.4 : 0.9,
          semanticField: resolution.semanticField,
          needsReview: resolution.needsReview || aggregateTextUsedAsValue(event),
          reviewReason: aggregateTextUsedAsValue(event) ? "aggregate_compound_text_without_separate_control_evidence" : resolution.reason,
          ...(resolution.formatHint ? { formatHint: resolution.formatHint } : {}),
        });
        testRailSteps.push({
          content: stepTemplate,
           ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
          sourceEventRefs: [`event-${eventIndex + 1}`],
          stepTemplate,
          renderedStep: describeFillRendered(event, label, stepTemplate, trace, editingSessionsByRef.get(event.target?.editingSessionRef ?? ""), confirmedCompoundSelectionBefore(events, eventIndex, event.target)),
          valueKey,
          interactionId: `interaction-${eventIndex + 1}`,
          sensitive,
          // Filling is an action, not an oracle. The control's state is retained in Technical
          // Knowledge; a functional TestRail step must not carry a tautological expectation.
          expected: "",
          classification: "FUNCTIONAL_ACTION",
        });
        hasUncertainSteps = true;
      }
      continue;
    }
    // Ambiguous is checked on its own and not left to the confidence it carries: a locator
    // pinned to a position is executable but positional, and a reviewer has to see that even
    // if the confidence scale is ever retuned.
    const best = target.locators[0];
    if (best.ambiguous || (best.confidence !== undefined && best.confidence < 0.7)) {
      hasUncertainSteps = true;
    }

    if (event.kind === "tap") {
      const label = target.label?.trim() || "el control";
      const selection = (target.interactionType === "select" && target.afterValue !== undefined) || target.afterValue !== undefined;
      const checkbox = target.role?.toLowerCase() === "checkbox";
      const checkboxChecked = target.afterState?.selected !== false && target.afterState?.aria?.["aria-checked"] !== "false" && target.stateDelta?.checked !== false;
      const selectionResolution = selection ? fieldForEvent(event, eventIndex + 1) : undefined;
      const selectionLabel = selectionResolution?.semanticField
        ? selectionResolution.semanticField
        : selection ? `${label} · selección` : label;
      const selectionKey = selection ? selectionValueKey(event, selectionResolution?.semanticField ?? label) : undefined;
      const description = selection ? `Seleccionar [${selectionKey}] en "${selectionLabel}"` : checkbox ? `${checkboxChecked ? "Marcar" : "Desmarcar"} "${label}"` : describeTap(event);
      const renderedStep = selection ? describeSelectionRendered(event, selectionLabel, description) : description;
      if (selection && selectionKey && !requiredData.some((field) => field.key === selectionKey)) {
        requiredData.push({
          key: selectionKey,
          label: selectionLabel,
           ...(entityScopeForTarget(target) ? { entityScope: entityScopeForTarget(target) } : {}),
          stepIndex: isMobile ? mobileSteps.length : webSteps.length,
          technicalTargetRefs: target.locators.map((locator) => `${locator.strategy}:${locator.value}`),
          sourceEventRefs: [`event-${eventIndex + 1}`],
          exampleValue: target.afterValue,
          sensitive: false,
          valueRole: "action_input",
          source: "RECORDED_CONFIRMED",
        });
      }
      if (isMobile) {
        const t = toMobileTarget(event);
        if (!t) continue;
        mobileSteps.push({ action: "click", target: t, description });
        stepTargets.push({ stepIndex: mobileSteps.length - 1, description, ...t, ambiguous: best.ambiguous });
      } else {
        webSteps.push({
          action: "click",
          target: { strategy: best.strategy, value: best.value },
          ...(selectionKey ? { valueKey: selectionKey } : {}),
          description,
           ...(entityScopeForTarget(target) ? { entityScope: entityScopeForTarget(target) } : {}),
          interactionId: `interaction-${eventIndex + 1}`,
        });
        stepTargets.push({
          stepIndex: webSteps.length - 1,
          description,
          strategy: best.strategy,
          value: best.value,
          ambiguous: best.ambiguous,
        });
      }
        testRailSteps.push({
        content: description,
         ...(entityScopeForTarget(target) ? { entityScope: entityScopeForTarget(target) } : {}),
        sourceEventRefs: [`event-${eventIndex + 1}`],
        stepTemplate: selection ? description : undefined,
        renderedStep: selection ? renderedStep : description,
        valueKey: selectionKey,
        interactionId: `interaction-${eventIndex + 1}`,
        sensitive: false,
        expected: target.enabled === false
          ? "El control permanece deshabilitado hasta cumplir su condición"
          : "",
        classification: "FUNCTIONAL_ACTION",
      });
      continue;
    }

    if (event.kind === "fill") {
      const resolution = fieldForEvent(event, eventIndex + 1);
      const label = resolution.displayLabel;
      const stepIndex = isMobile ? mobileSteps.length : webSteps.length;
      const sensitive = isSensitiveRecordedEvent(event);
      const applicationDerived = event.valueSource === "application";
      const valueKey = uniqueValueKeyFor(event, resolution.valueKey, requiredData);
      const stepTemplate = describeFillTemplate(label, valueKey);
      const compoundSelectionValue = confirmedCompoundSelectionBefore(events, eventIndex, event.target);
      const renderedStep = describeFillRendered(event, label, stepTemplate, trace, editingSessionsByRef.get(event.target?.editingSessionRef ?? ""), compoundSelectionValue);
      requiredData.push({
        key: valueKey,
        label,
         ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
        stepIndex,
        technicalTargetRefs: event.target?.locators?.map((locator) => `${locator.strategy}:${locator.value}`),
        sourceEventRefs: [`event-${eventIndex + 1}`],
        exampleValue: sensitive && !recordingDataPolicy.persistQaCredentials ? undefined : recordedLogicalValue(event, editingSessionsByRef.get(event.target?.editingSessionRef ?? ""), confirmedCompoundSelectionBefore(events, eventIndex, event.target)),
        sensitive,
        valueRole: applicationDerived ? "runtime_derived_oracle" : sensitive ? "secure_input" : "action_input",
        source: applicationDerived ? "OBSERVED" : sensitive ? "secure" : "RECORDED_CONFIRMED",
        validatedByInteraction: event.target?.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction) === true,
        confidence: resolution.needsReview || aggregateTextUsedAsValue(event) ? 0.4 : 0.9,
        semanticField: resolution.semanticField,
        needsReview: resolution.needsReview || aggregateTextUsedAsValue(event),
        reviewReason: aggregateTextUsedAsValue(event) ? "aggregate_compound_text_without_separate_control_evidence" : resolution.reason,
        ...(resolution.formatHint ? { formatHint: resolution.formatHint } : {}),
      });
      if (isMobile) {
        const t = toMobileTarget(event);
        if (!t) continue;
        mobileSteps.push({ action: "fill", target: t, value: recordedLogicalValue(event, editingSessionsByRef.get(event.target?.editingSessionRef ?? ""), compoundSelectionValue) ?? "", description: stepTemplate });
        stepTargets.push({ stepIndex: mobileSteps.length - 1, description: stepTemplate, ...t, ambiguous: best.ambiguous });
      } else {
        webSteps.push({
          action: "fill",
          target: { strategy: best.strategy, value: best.value },
          // Web execution must bind through the semantic key. The human materialization lives
          // only on the review/TestRail step and never becomes a literal in a generated spec.
          value: undefined,
          valueKey,
          description: stepTemplate,
           ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
          interactionId: `interaction-${eventIndex + 1}`,
        });
        stepTargets.push({
          stepIndex: webSteps.length - 1,
          description: stepTemplate,
          strategy: best.strategy,
          value: best.value,
          ambiguous: best.ambiguous,
        });
      }
      testRailSteps.push({
        content: stepTemplate,
        ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
        sourceEventRefs: [`event-${eventIndex + 1}`],
        stepTemplate,
        renderedStep,
        valueKey,
        interactionId: `interaction-${eventIndex + 1}`,
        sensitive,
        expected: "",
        classification: "FUNCTIONAL_ACTION",
      });
      continue;
    }

    if (event.kind === "navigate" && !isMobile && event.url) {
      webSteps.push({ action: "navigate", value: event.url, description: "Abrir la aplicación configurada del proyecto" });
      testRailSteps.push({ content: "Abrir la aplicación configurada del proyecto", expected: "La página carga correctamente", classification: "FUNCTIONAL_ACTION" });
    }
  }

  const lastScreen = trace.screens[trace.screens.length - 1];
  const title =
    trace.recordingGoal?.declaredGoal?.trim() ||
    trace.recordingGoal?.normalizedGoal?.trim() ||
    options.title?.trim() ||
    trace.label?.trim() ||
    (lastScreen ? `Recorrido ${trace.platform === "web" ? "web" : "móvil"} observado` : "Recorrido observado");

  const executableCanonical = canonicalEvents.filter((interaction) => hasExecutionAuthority(interaction) && interaction.action !== "system_observation");
  const ownedTestRailSteps = attachStateOwnership(testRailSteps, executableCanonical);
  const numberedTestRailSteps = numberScenarioSteps(ownedTestRailSteps);
  const stepMetrics = scenarioStepMetrics(numberedTestRailSteps);
  const stateValidation = validateInteractionStateSequence(executableCanonical);
  const scenario: RecordedScenario = {
    scenarioId: `${options.scenarioIdPrefix ?? "REC"}-${trace.recordingId.slice(0, 8).toUpperCase()}-01`,
    title: capTitle(title),
    description: buildFallbackStory(trace, events),
    preconditions: buildPreconditions(trace),
    kind: "happy_path",
    provenance: "observed",
    scope: "end_to_end",
    mobileSteps,
    webSteps,
        testRailSteps: numberedTestRailSteps,
    requiredData,
    stepTargets,
    sourceRecordingId: trace.recordingId,
    hasUncertainSteps,
    primary: true,
    sourceEventRefs: events.map((_, index) => `event-${index + 1}`),
    traceBacked: true,
    containsUnexecutedActions: false,
    functionalReadiness: testRailSteps.length > 0,
    technicalReadiness: !hasUncertainSteps && stateValidation.stateSequenceValid,
    expectedResultCandidate: [...testRailSteps].reverse().find((step) => step.expected.trim().length > 0)?.expected,
    oracleAuthority: "observed_only",
    confidence: 0.95,
    ...stepMetrics,
    scenarioGoal: trace.recordingGoal?.declaredGoal ?? trace.recordingGoal?.normalizedGoal,
    stateSequenceValid: stateValidation.stateSequenceValid,
    stateSequenceIssues: stateValidation.stateSequenceIssues,
    postGoalObservations: canonicalEvents.filter((interaction) => interaction.postGoalObservation).flatMap((interaction) => interaction.sourceEventRefs),
    goalContract: {
      nonGeneric: Boolean(trace.recordingGoal?.declaredGoal?.trim() || trace.recordingGoal?.normalizedGoal?.trim()),
      goalCoherent: Boolean(trace.recordingGoal?.declaredGoal?.trim() || trace.recordingGoal?.normalizedGoal?.trim()),
      mutationIntentExpressed: true,
    },
  };
  // Keep navigation/state-transition interactions in the contract so downstream
  // mutations can prove reachability. They remain technical-only and are not
  // rendered as user actions.
  return enrichRecordedScenarioContract(scenario, canonicalEvents, [], semanticModel);
}

/**
 * Materializes only the primary path that the user actually walked.
 *
 * This is intentionally a separate deterministic lane from `deriveScenarios`: it builds from
 * the persisted trace/semantic authority and never calls an AI provider or creates suggestions.
 * Incomplete recordings return null instead of becoming falsely executable scenarios.
 */
export function materializeObservedPrimaryScenario(
  trace: SessionTrace,
  events: readonly RecordedEvent[] = trace.events,
): RecordedScenario | null {
  const primary = buildHappyPathScenario(trace, events);
  const functionalActionCount = primary.functionalActionCount
    ?? primary.testRailSteps.filter((step) => step.classification === "FUNCTIONAL_ACTION" && !step.isSetup).length;
  // PERSISTED != CERTIFIED. An action whose `resolutionState` is `runtime_resolution_required`
  // (real, non-generic field/owner identity was observed, just no technical locator captured
  // for it yet) is not a missing-evidence gap the way a truly unresolved/ambiguous action is --
  // the EXISTING live/runtime resolver (`resolveActionTarget`) is what re-verifies it at replay
  // time. Requiring full technical certification here, before the observed primary is even
  // persisted, wrongly coupled "replay the walkthrough I recorded" to "generate scenarios",
  // since only `deriveScenarios`'s own richer pipeline (`enrichRecordedScenarioContract`)
  // carried this carve-out before. Mirrors the identical carve-out already applied in
  // `evaluateRecordedScenarioExecutionReadiness` (canonical-recording-contract.ts) and
  // `recording-readiness.ts` (frontend) -- never relaxed for a truly unresolved/ambiguous action.
  const hasSufficientTechnicalEvidence = (interaction: CanonicalInteraction) =>
    interaction.resolutionState === "runtime_resolution_required"
    || interaction.technicalTargetRefs.length > 0
    || (interaction.technicalTargetCandidates?.length ?? 0) > 0;
  // Persistence records the observed path even when one action remains non-executable.
  // Readiness is evaluated separately downstream; a certified-looking action with no
  // technical refs is therefore retained for review but never made executable here.
  const technicalTargetRefs = (primary.canonicalInteractions ?? [])
    .filter((interaction) => hasExecutionAuthority(interaction) && interaction.action !== "system_observation" && interaction.action !== "navigation")
    .every((interaction) => interaction.resolutionState === "certified" || hasSufficientTechnicalEvidence(interaction));
  const hasTerminalOracle = primary.oracleAuthority === "observed_only"
    && Boolean(primary.expectedResultCandidate?.trim())
    && (primary.testRailSteps.some((step) => step.classification === "FUNCTIONAL_ASSERTION" && step.expected.trim().length > 0)
      || primary.testRailSteps.at(-1)?.expected.trim().length);
  const hasObservedTerminalAuthority = (primary.canonicalInteractions ?? []).some((interaction) =>
    interaction.postTerminalAction === true
    || interaction.causedTransition === true
    || interaction.transitionObserved === true
  ) || Boolean([...(primary.canonicalInteractions ?? [])].reverse().find((interaction) =>
    hasExecutionAuthority(interaction)
    && interaction.action !== "system_observation"
    && interaction.action !== "navigation"
    && hasSufficientTechnicalEvidence(interaction)
  ));
  const hasLineage = primary.sourceRecordingId === trace.recordingId
    && primary.traceBacked === true
    && (primary.sourceEventRefs?.length ?? 0) > 0;

  // Persistence of the path the QA actually walked must not depend on a generated
  // oracle. A directly observed terminal action/transition is sufficient authority
  // to materialize the Primary; oracle readiness remains a separate replay gate.
  if (functionalActionCount <= 0 || !technicalTargetRefs || (!hasTerminalOracle && !hasObservedTerminalAuthority) || !hasLineage) return null;
  return materializeRecordedScenario(primary, primary.runtimeDataset?.resolvedValues ?? {});
}

/** Applies current reviewer values to human-facing steps without changing execution templates. */
export function materializeRecordedScenario(
  scenario: RecordedScenario,
  values: Readonly<Record<string, string | undefined>> = {},
): RecordedScenario {
  return {
    ...scenario,
    testRailSteps: scenario.testRailSteps.map((step) => {
      if (!step.valueKey || values[step.valueKey] === undefined) return step;
      const template = step.stepTemplate ?? step.content;
      const marker = `[${step.valueKey}]`;
      return {
        ...step,
        renderedStep: renderHumanStepValue(template, step.valueKey, values[step.valueKey]!),
      };
    }),
  };
}

function buildPreconditions(trace: SessionTrace): string[] {
  const preconditions: string[] = [];
  if (trace.platform === "android") {
    preconditions.push(`Aplicación ${trace.appPackage ?? trace.appSlug} instalada en el dispositivo`);
  } else if (trace.baseUrl) {
    preconditions.push("Acceso a la aplicación configurada del proyecto");
  }
  preconditions.push("Datos de prueba válidos disponibles para el proyecto");
  return preconditions;
}

/** The functional story a recording tells, without leaking technical route identity. */
function buildFallbackStory(trace: SessionTrace, events: readonly RecordedEvent[]): string {
  const goal = trace.recordingGoal?.declaredGoal?.trim() || trace.recordingGoal?.normalizedGoal?.trim();
  const actionCount = events.filter((event, index) => classifySemanticEvent(event, events[index + 1]) === "FUNCTIONAL_ACTION").length;
  if (goal) {
    return `Recorrido observado para completar "${goal}". Se registraron ${actionCount} acciones funcionales.`;
  }
  return `Recorrido funcional observado en la aplicación. Se registraron ${actionCount} acciones funcionales.`;
}

/**
 * Derives negative scenarios from what the recording proved about the app's gates.
 *
 * A control observed DISABLED during the walkthrough is direct evidence of a precondition
 * the app enforces, so a scenario that reaches it without satisfying that precondition is a
 * real test — not an invented one. Nothing is generated for gates the recording never saw.
 */
export function buildGateNegatives(
  trace: SessionTrace,
  segments: readonly TraceSegment[],
  happyPath: RecordedScenario,
): RecordedScenario[] {
  const seen = new Set<string>();
  const negatives: RecordedScenario[] = [];

  for (const segment of segments) {
    for (const event of segment.events) {
      const target = event.target;
      if (!target || target.enabled !== false) continue;
      const label = target.label?.trim();
      if (!label || seen.has(label)) continue;
      seen.add(label);

      const upToGate = happyPath.testRailSteps.slice(
        0,
        Math.max(1, happyPath.testRailSteps.findIndex((s) => s.content.includes(label))),
      );

      negatives.push({
        scenarioId: `${happyPath.scenarioId}-NEG-${negatives.length + 1}`,
        title: capTitle(`${segment.title}: "${label}" permanece deshabilitado sin cumplir su condición`),
        description:
          `Durante la grabación el control "${label}" se observó deshabilitado en la pantalla ` +
          `"${segment.title}". Este escenario verifica que la aplicación mantiene ese bloqueo.`,
        preconditions: buildPreconditions(trace),
        kind: "negative",
        // The steps up to the gate were walked, but forcing the gate was not: nobody tried.
        provenance: "derived",
        mobileSteps: [],
        webSteps: [],
        testRailSteps: [
          ...upToGate,
          {
            content: `Intentar continuar sin completar los requisitos de "${label}"`,
            expected: `El control "${label}" permanece deshabilitado y el flujo no avanza`,
          },
        ],
        requiredData: [],
        stepTargets: [],
        sourceRecordingId: trace.recordingId,
        hasUncertainSteps: false,
        suggestionCategory: "DERIVED_VALIDATION",
      });
    }
  }

  return negatives;
}

/**
 * The longest title TestRail accepts on a case.
 *
 * Enforced here rather than at publish time because a title this long is unreadable in the
 * panel too — and because the alternative is what actually happened: a case rejected with
 * `:title es demasiado largo` after the other eleven had already been created.
 */
const MAX_TITLE_LENGTH = 250;

/**
 * Caps a scenario title at what TestRail accepts.
 *
 * The overflow comes from control labels: Android concatenates a container's children into
 * one `content-desc`, so a single "label" can be a whole screen's worth of text, and every
 * title that interpolates one is unbounded.
 */
export function capTitle(title: string): string {
  const clean = title.trim().replace(/\s+/g, " ");
  if (clean.length <= MAX_TITLE_LENGTH) return clean;
  return `${clean.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/** Shortens a screen title so it reads as a scenario name rather than a paragraph. */
function shortTitle(title: string, max = 48): string {
  const clean = title.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function isAction(event: RecordedEvent): boolean {
  return event.kind === "tap" || event.kind === "fill";
}

/**
 * One scenario per block of the walkthrough, on top of the end-to-end one.
 *
 * A single recording usually covers several things a QA would file separately — reaching the
 * contact-data screen is one case, completing it is another — and a suite made of one long
 * case can only ever fail as a whole. Each scenario is the run TRUNCATED at the end of a
 * block, not the block in isolation, because the steps that got there are what make it
 * executable; every step in it was still performed by the person recorded.
 *
 * The last block is skipped: truncating there reproduces the end-to-end scenario exactly.
 */
export function buildSegmentScenarios(
  trace: SessionTrace,
  events: readonly RecordedEvent[],
  segments: readonly TraceSegment[],
  happyPath: RecordedScenario,
): RecordedScenario[] {
  if (segments.length < 2) return [];

  const scenarios: RecordedScenario[] = [];
  let consumed = 0;

  segments.forEach((segment, index) => {
    consumed += segment.events.length;
    if (index === segments.length - 1) return;
    if (!segment.events.some(isAction)) return;

    const upToHere = events.slice(0, consumed);
    const scenario = buildHappyPathScenario(trace, upToHere, {
      title: `${trace.label?.trim() || "Bloque observado"} ${index + 1}`,
    });
    // A truncation that kept every step is the end-to-end scenario under another name.
    if (scenario.testRailSteps.length >= happyPath.testRailSteps.length) return;

    scenarios.push({
      ...scenario,
      scenarioId: `${happyPath.scenarioId}-SEG-${scenarios.length + 1}`,
      description:
        `Bloque del recorrido que termina en "${isTechnicalTitle(segment.title) ? "la pantalla observada" : shortTitle(segment.title, 80)}". ` +
        `Cubre ${scenario.testRailSteps.length} de los ${happyPath.testRailSteps.length} pasos del flujo completo.`,
      scope: "segment",
      provenance: "observed",
    });
  });

  return scenarios;
}

/** Labels the walkthrough actually pressed, per screen. */
function tappedLabelsByScreen(events: readonly RecordedEvent[]): Map<string, Set<string>> {
  const byScreen = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.kind !== "tap") continue;
    const label = event.target?.label?.trim();
    if (!label) continue;
    const set = byScreen.get(event.screenKey) ?? new Set<string>();
    set.add(label);
    byScreen.set(event.screenKey, set);
  }
  return byScreen;
}

function toStepTarget(locators: readonly RecordedLocator[]): MobileStepTarget | undefined {
  const locator = locators[0];
  if (!locator || !MOBILE_STRATEGIES.has(locator.strategy as MobileLocatorStrategy)) return undefined;
  return { strategy: locator.strategy as MobileLocatorStrategy, value: locator.value };
}

/** How many alternative paths one screen may contribute, and the whole recording. */
const MAX_ALTERNATIVES_PER_SCREEN = 3;
const MAX_ALTERNATIVES_TOTAL = 6;

/**
 * Scenarios for the controls the recording SAW but the person never pressed.
 *
 * A walkthrough is one path through a screen that offered several. The other options are
 * real — they were captured with their own locators, on a screen the recording actually
 * reached — and they are the cases a QA writes next. What the recording cannot supply is
 * what they DO, so the expected result is left explicitly open and the scenario is marked
 * `derived`: it must not be run automatically as if it had been observed.
 */
export function buildAlternativePathScenarios(
  trace: SessionTrace,
  events: readonly RecordedEvent[],
  happyPath: RecordedScenario,
): RecordedScenario[] {
  const tapped = tappedLabelsByScreen(events);
  const isMobile = trace.platform === "android";
  const scenarios: RecordedScenario[] = [];

  for (const screen of trace.screens) {
    if (scenarios.length >= MAX_ALTERNATIVES_TOTAL) break;

    const firstIndex = events.findIndex((e) => e.screenKey === screen.screenKey);
    if (firstIndex < 0) continue;

    const exercised = tapped.get(screen.screenKey) ?? new Set<string>();
    const untouched = screen.controls
      .filter((c) => c.enabled !== false)
      .filter((c) => c.label.trim().length > 2 && !exercised.has(c.label.trim()))
      .slice(0, MAX_ALTERNATIVES_PER_SCREEN);

    for (const control of untouched) {
      if (scenarios.length >= MAX_ALTERNATIVES_TOTAL) break;

      // Everything the person did before arriving here is what makes the case reachable.
      const preamble = buildHappyPathScenario(trace, events.slice(0, firstIndex), {
        title: control.label,
      });
      const target = toStepTarget(control.locators);
      const locator = control.locators[0];
      const description = `Seleccionar "${control.label}"`;

      const mobileSteps = [...preamble.mobileSteps];
      const webSteps = [...preamble.webSteps];
      if (isMobile && target) {
        mobileSteps.push({ action: "click", target, description });
      } else if (!isMobile && locator) {
        webSteps.push({
          action: "click",
          target: { strategy: locator.strategy, value: locator.value },
          description,
        });
      }

      scenarios.push({
        scenarioId: `${happyPath.scenarioId}-ALT-${scenarios.length + 1}`,
        title: capTitle(`Alternativa observada ${scenarios.length + 1}: ${control.label}`),
        description:
          `La pantalla "${humanScreenTitle(screen, "la pantalla observada")}" ofrece "${control.label}", que el recorrido grabado ` +
          `no ejercitó. El resultado esperado debe confirmarse antes de automatizar este caso.`,
        preconditions: preamble.preconditions,
        kind: "happy_path",
        provenance: "derived",
        mobileSteps,
        webSteps,
        testRailSteps: [
          ...preamble.testRailSteps,
          { content: description, expected: "Por confirmar: la grabación no recorrió esta opción" },
        ],
        requiredData: preamble.requiredData,
        stepTargets: locator
          ? [
              ...preamble.stepTargets,
              {
                stepIndex: (isMobile ? mobileSteps.length : webSteps.length) - 1,
                description,
                strategy: locator.strategy,
                value: locator.value,
                ambiguous: locator.ambiguous,
              },
            ]
          : preamble.stepTargets,
        sourceRecordingId: trace.recordingId,
      hasUncertainSteps: true,
      suggestionCategory: "DERIVED_ALTERNATIVE",
      });
    }
  }

  return scenarios;
}
