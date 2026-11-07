import type { SemanticRecordingModel } from "./semantic-recording";
import type { SessionTrace } from "./session-trace.types";
import type { RecordedScenario } from "./trace-to-scenario";
import { labelActivationTapRefs, projectNativeSelectionOpeningTaps } from "./trace-to-scenario";
import { normalizeEvents } from "./trace-normalizer";
import {
  applyRuntimeDatasetValues,
  buildCanonicalInteractions,
  evaluateRecordedScenarioExecutionReadiness,
  hydrateCanonicalInteractionsFromSemanticModel,
  validateInteractionStateSequence,
} from "./canonical-recording-contract";

/**
 * Removes the steps a reviewer deleted (`excludedInteractionIds`) from every projection of the
 * scenario. Canonical interactions are rebuilt from the trace on each load, so the exclusion has
 * to be re-applied here rather than baked into the persisted arrays. A display projection (for
 * example a combined selection) also takes down the raw technical clicks it summarizes, which
 * hold the real execution authority -- found through the projection's `sourceTechnicalEventSeqs`.
 */
export function applyExcludedInteractions(
  scenario: RecordedScenario,
  normalizedEvents?: ReadonlyArray<{ seq?: number; target?: { sourceTechnicalEventSeqs?: number[] } }>,
  canonicalOverride?: RecordedScenario["canonicalInteractions"],
): RecordedScenario {
  const excluded = new Set(scenario.excludedInteractionIds ?? []);
  if (excluded.size === 0) return canonicalOverride ? { ...scenario, canonicalInteractions: canonicalOverride } : scenario;
  for (const id of [...excluded]) {
    const index = Number(/^interaction-(\d+)$/.exec(id)?.[1]) - 1;
    const sourceSeqs = normalizedEvents?.[index]?.target?.sourceTechnicalEventSeqs;
    if (!sourceSeqs?.length) continue;
    normalizedEvents!.forEach((event, i) => {
      if (event.seq !== undefined && sourceSeqs.includes(event.seq)) excluded.add(`interaction-${i + 1}`);
    });
  }
  const keep = <T extends { interactionId?: string }>(items: T[]) => items.filter((item) => !excluded.has(item.interactionId ?? ""));
  const removedStepValueKeys = new Set(scenario.testRailSteps.filter((step) => excluded.has(step.interactionId ?? "") && step.valueKey).map((step) => step.valueKey!));
  const testRailSteps = keep(scenario.testRailSteps);
  const stillUsedKeys = new Set(testRailSteps.map((step) => step.valueKey).filter(Boolean));
  const droppedKeys = new Set([...removedStepValueKeys].filter((key) => !stillUsedKeys.has(key)));
  const removedWebPositions = scenario.webSteps.flatMap((step, i) => excluded.has(step.interactionId ?? "") ? [i] : []);
  const shift = (stepIndex: number) => stepIndex - removedWebPositions.filter((position) => position < stepIndex).length;
  return {
    ...scenario,
    testRailSteps: testRailSteps.map((step, i) => ({ ...step, stepNumber: i + 1 })),
    webSteps: keep(scenario.webSteps),
    stepTargets: scenario.stepTargets.filter((target) => !removedWebPositions.includes(target.stepIndex)).map((target) => ({ ...target, stepIndex: shift(target.stepIndex) })),
    requiredData: scenario.requiredData.filter((field) => !droppedKeys.has(field.key)),
    runtimeInputRequirements: scenario.runtimeInputRequirements?.filter((requirement) => !droppedKeys.has(requirement.valueKey)),
    canonicalInteractions: (canonicalOverride ?? scenario.canonicalInteractions)?.filter((interaction) => !excluded.has(interaction.id)),
  };
}

/**
 * Deleting a step removes it from the persisted step arrays, so un-deleting it has to put it back:
 * rehydrating alone only restores the canonical interaction (the replay authority) and leaves the
 * step list without it. Click-like interactions only (no value to re-bind); inserted by interaction order.
 */
export function reinsertRestoredStep(scenario: RecordedScenario, interactionId: string): RecordedScenario {
  if (scenario.testRailSteps.some((step) => step.interactionId === interactionId)) return scenario;
  const interaction: any = scenario.canonicalInteractions?.find((item) => item.id === interactionId);
  if (!interaction || interaction.valueKey) return scenario;
  // The interaction carries no rendered text; the same control elsewhere in the scenario already has it.
  const sibling = scenario.canonicalInteractions?.find((item) => item.id !== interactionId && item.controlIdentity && item.controlIdentity === interaction.controlIdentity
    && scenario.testRailSteps.some((step) => step.interactionId === item.id));
  const description: string | undefined = interaction.description
    ?? scenario.testRailSteps.find((step) => step.interactionId === sibling?.id)?.content;
  if (!description) return scenario;
  const order = (id?: string) => Number(/^interaction-(\d+)$/.exec(id ?? "")?.[1] ?? 0);
  const at = (items: Array<{ interactionId?: string }>) => items.filter((item) => order(item.interactionId) < order(interactionId)).length;
  const ref = String(interaction.technicalTargetRefs?.[0] ?? "");
  const sep = ref.indexOf(":");
  const step = {
    content: description, sourceEventRefs: interaction.sourceEventRefs, renderedStep: description,
    interactionId, sensitive: false, expected: "", classification: "FUNCTIONAL_ACTION" as const,
    ...(interaction.pageKey ? { pageKey: interaction.pageKey } : {}),
    ...(interaction.screenBeforeRef ? { screenBeforeRef: interaction.screenBeforeRef } : {}),
    ...(interaction.screenAfterRef ? { screenAfterRef: interaction.screenAfterRef } : {}),
    ...(interaction.routeBefore ? { routeBefore: interaction.routeBefore } : {}),
    ...(interaction.stateScope ? { stateScope: interaction.stateScope } : {}),
  };
  const testRailSteps = [...scenario.testRailSteps];
  testRailSteps.splice(at(testRailSteps), 0, step as any);
  const webAt = at(scenario.webSteps);
  const webSteps = [...scenario.webSteps];
  const target = sep > 0 ? { strategy: ref.slice(0, sep), value: ref.slice(sep + 1) } : undefined;
  webSteps.splice(webAt, 0, { action: interaction.action, ...(target ? { target } : {}), description, interactionId, ...(interaction.pageKey ? { pageKey: interaction.pageKey } : {}) } as any);
  const stepTargets = scenario.stepTargets.map((item) => item.stepIndex >= webAt ? { ...item, stepIndex: item.stepIndex + 1 } : item);
  if (target) stepTargets.splice(webAt, 0, { stepIndex: webAt, description, ...target } as any);
  return { ...scenario, testRailSteps: testRailSteps.map((item, i) => ({ ...item, stepNumber: i + 1 })), webSteps, stepTargets };
}

/**
 * Restores persisted scenarios without deriving new suggestions or changing their IDs.
 * The persisted catalog remains authoritative; the semantic model is only used to repair
 * compatible runtime/presentation projections of each stored scenario.
 *
 * `stateSequenceValid`/`stateSequenceIssues` and `readiness.executionReadiness`/
 * `readiness.technicalReadiness` were computed ONCE, at derive time, from whatever
 * `canonicalInteractions` existed then -- an upstream fix to the canonical derivation itself
 * (e.g. navigation ownership) can make a FRESH `canonicalInteractions` built from the SAME
 * `trace`, with today's code, produce a different, more accurate verdict than what is still
 * sitting in the persisted projection. `trace`, when passed, is the closest available AUTHORITY
 * (recording-store.ts's own `loadTrace`) -- but the trace must pass through `normalizeEvents`
 * before canonicalization, exactly as it does at scenario derivation. Canonical interaction ids
 * and source-event ownership are based on that normalized stream; building from raw note/pointer
 * events can turn a diagnostic body tap into a new required action and shift the ids referenced
 * by the persisted scenario. Without a trace (older/legacy recordings that never persisted one),
 * the semantic model's own narrower field-lineage repair is all that is available -- fail closed
 * to the existing, unmodified behavior rather than fabricate freshness from less authority.
 *
 * `stateSequenceValid`/`stateSequenceIssues`/`readiness.executionReadiness`/
 * `readiness.technicalReadiness` are then refreshed in memory only, from the exact SAME shared
 * authorities every other boundary already trusts -- `validateInteractionStateSequence`
 * (buildHappyPathScenario's own validator) and `evaluateRecordedScenarioExecutionReadiness`
 * (the same execution audit `toSharedMcpScenario`/POST `/execute` already use) -- never a second
 * readiness implementation, and never written back to scenarios.json. `technicalReadiness`/
 * `promotionReadiness`/`publicationReadiness` elsewhere on `readiness` are left exactly as
 * persisted beyond this one field: the execution audit's own `runtime_resolution_required`
 * carve-out already keeps `executionReadiness` correctly separate from full technical
 * certification, so refreshing it here can never falsely elevate promotion/publication.
 */
export function hydratePersistedScenarios(
  scenarios: readonly RecordedScenario[],
  semanticModel?: SemanticRecordingModel | null,
  trace?: SessionTrace | null,
): RecordedScenario[] {
  // The runtime dataset renderer also owns sensitive-step presentation. Run it even for
  // legacy recordings without a semantic model so opening their step list cannot surface a
  // previously persisted rendered password value.
  if (!semanticModel) return scenarios.map((scenario) => applyRuntimeDatasetValues(scenario, {}));
  const normalizedTraceEvents = trace ? normalizeEvents(trace.events) : undefined;
  const freshCanonicalInteractions = trace && normalizedTraceEvents
    ? projectNativeSelectionOpeningTaps(
      normalizedTraceEvents,
      buildCanonicalInteractions(normalizedTraceEvents, semanticModel.editingSessions),
    )
    : undefined;
  // The synthetic control click a label tap triggers has no step of its own (the label tap is the step). Scenarios
  // persisted before that rule still list it, so it is dropped here in memory, the same way a user-removed step is, without
  // recording it as a user exclusion.
  const labelTapRefs = normalizedTraceEvents ? labelActivationTapRefs(normalizedTraceEvents) : new Set<string>();
  const projectedAway = (freshCanonicalInteractions ?? [])
    .filter((interaction) => interaction.sourceEventRefs.some((ref) => labelTapRefs.has(ref)))
    .map((interaction) => interaction.id);
  return scenarios.map((persisted) => {
    const original = projectedAway.length > 0 && persisted.sourceRecordingId === trace?.recordingId
      ? { ...persisted, excludedInteractionIds: [...new Set([...(persisted.excludedInteractionIds ?? []), ...projectedAway])] }
      : persisted;
    const scenario = original === persisted
      ? applyExcludedInteractions(original, normalizedTraceEvents)
      : { ...applyExcludedInteractions(original, normalizedTraceEvents), excludedInteractionIds: persisted.excludedInteractionIds };
    const withFreshCanonical = freshCanonicalInteractions && scenario.sourceRecordingId === trace?.recordingId
      ? { ...scenario, canonicalInteractions: applyExcludedInteractions(original, normalizedTraceEvents, freshCanonicalInteractions).canonicalInteractions }
      : scenario;
    const repaired = applyRuntimeDatasetValues(
      hydrateCanonicalInteractionsFromSemanticModel(withFreshCanonical, withFreshCanonical !== scenario
        ? { ...semanticModel, canonicalInteractions: freshCanonicalInteractions! }
        : semanticModel),
      {},
    );
    const { stateSequenceValid, stateSequenceIssues } = validateInteractionStateSequence(repaired.canonicalInteractions ?? []);
    const refreshed: RecordedScenario = { ...repaired, stateSequenceValid, stateSequenceIssues };
    const executionAudit = evaluateRecordedScenarioExecutionReadiness(refreshed);
    const reusableStructuralClickIds = new Set(
      refreshed.sourceRecordingId === trace?.recordingId
        ? (refreshed.canonicalInteractions ?? [])
          .filter((interaction) => interaction.dynamicTargetLabel === true)
          .map((interaction) => interaction.id)
        : [],
    );
    return {
      ...refreshed,
      ...(reusableStructuralClickIds.size > 0 ? {
        testRailSteps: refreshed.testRailSteps.map((step) => reusableStructuralClickIds.has(step.interactionId ?? "")
          ? { ...step, content: "Presionar el control grabado", renderedStep: "Presionar el control grabado" }
          : step),
        webSteps: refreshed.webSteps.map((step) => reusableStructuralClickIds.has(step.interactionId ?? "")
          ? { ...step, description: "Presionar el control grabado" }
          : step),
      } : {}),
      ...(refreshed.readiness ? {
        readiness: {
          ...refreshed.readiness,
          executionReadiness: executionAudit.executionReady,
          technicalReadiness: executionAudit.technicalReady,
        },
      } : {}),
    };
  });
}
