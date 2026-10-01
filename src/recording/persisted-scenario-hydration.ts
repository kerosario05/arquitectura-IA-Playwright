import type { SemanticRecordingModel } from "./semantic-recording";
import type { SessionTrace } from "./session-trace.types";
import type { RecordedScenario } from "./trace-to-scenario";
import { normalizeEvents } from "./trace-normalizer";
import {
  applyRuntimeDatasetValues,
  buildCanonicalInteractions,
  evaluateRecordedScenarioExecutionReadiness,
  hydrateCanonicalInteractionsFromSemanticModel,
  validateInteractionStateSequence,
} from "./canonical-recording-contract";

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
  if (!semanticModel) return [...scenarios];
  const freshCanonicalInteractions = trace
    ? buildCanonicalInteractions(normalizeEvents(trace.events), semanticModel.editingSessions)
    : undefined;
  return scenarios.map((scenario) => {
    const withFreshCanonical = freshCanonicalInteractions && scenario.sourceRecordingId === trace?.recordingId
      ? { ...scenario, canonicalInteractions: freshCanonicalInteractions }
      : scenario;
    const repaired = applyRuntimeDatasetValues(
      hydrateCanonicalInteractionsFromSemanticModel(withFreshCanonical, semanticModel),
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
