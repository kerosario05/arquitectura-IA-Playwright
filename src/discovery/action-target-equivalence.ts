export type ActionTargetIdentityLike = {
  actionType?: string;
  recordingActionType?: string;
  target?: string;
  valueKey?: string;
  value?: string;
  valueSource?: string;
  entityScope?: string;
  associatedField?: string;
  selectionField?: string;
  technicalTargetRefs?: readonly string[];
  controlIdentity?: unknown;
  /**
   * Structured SOURCE-INTERACTION identity (e.g. the canonical `interactionId` /
   * `RecordingExecutionAction.interactionId`). Two representations that share it are projections of
   * the SAME logical user interaction; two DIFFERENT values are independent interactions that must
   * never be merged, however identical their target/operation/locator look.
   */
  sourceInteractionId?: string;
};

/**
 * Positive, structured proof that two actions are two representations of the SAME source event.
 * Requires BOTH to carry the same non-empty source-interaction identity. Absent identity is never
 * treated as a match (fail-safe: preserve multiplicity).
 */
export function shareSourceInteraction(
  left: ActionTargetIdentityLike,
  right: ActionTargetIdentityLike,
): boolean {
  const leftId = left.sourceInteractionId?.trim();
  const rightId = right.sourceInteractionId?.trim();
  return Boolean(leftId && rightId && leftId === rightId);
}

/**
 * True ONLY when two consecutive actions are two representations of the SAME source interaction:
 * a shared, non-empty source-interaction identity is REQUIRED, with structured equivalence as the
 * auxiliary confirmation. Similarity (target/operation/locator/surface/timing) is never authority.
 */
export function isTrueSourceDuplicate(
  left: ActionTargetIdentityLike,
  right: ActionTargetIdentityLike,
): boolean {
  return shareSourceInteraction(left, right) && areEquivalentActionTargets(left, right);
}

/**
 * Removes only consecutive projections of the same source interaction; every distinct source
 * interaction is preserved in order. `onDuplicateRemoved(removed, kept)` is diagnostic only.
 */
export function deduplicateActionTargetsBySource<T extends ActionTargetIdentityLike>(
  targets: readonly T[],
  onDuplicateRemoved?: (removed: T, kept: T) => void,
): T[] {
  const result: T[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    const current = targets[index];
    const next = targets[index + 1];
    if (next && isTrueSourceDuplicate(current, next)) {
      onDuplicateRemoved?.(current, next);
      continue;
    }
    result.push(current);
  }
  return result;
}

function normalizeIdentityText(value: string | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stableControlIdentity(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "object") return normalizeIdentityText(String(value));
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

/**
 * Semantic EQUIVALENCE of two consecutive actions (structured identity fields only). This is a
 * NECESSARY but NOT SUFFICIENT condition for deduplication: a target label alone is presentation
 * text, and even identical structured identity does NOT prove two independent user interactions
 * are the same event (e.g. a keypad "2" pressed twice). Callers MUST additionally require
 * `shareSourceInteraction` (same source-interaction lineage) before removing an action.
 */
export function areEquivalentActionTargets(
  left: ActionTargetIdentityLike,
  right: ActionTargetIdentityLike,
): boolean {
  const leftRefs = [...(left.technicalTargetRefs ?? [])].map(normalizeIdentityText).sort();
  const rightRefs = [...(right.technicalTargetRefs ?? [])].map(normalizeIdentityText).sort();
  return JSON.stringify({
    actionType: normalizeIdentityText(left.actionType) === normalizeIdentityText(right.actionType)
      ? normalizeIdentityText(left.actionType)
      : "__different__",
    recordingActionType: normalizeIdentityText(left.recordingActionType) === normalizeIdentityText(right.recordingActionType)
      ? normalizeIdentityText(left.recordingActionType)
      : "__different__",
    target: normalizeIdentityText(left.target) === normalizeIdentityText(right.target)
      ? normalizeIdentityText(left.target)
      : "__different__",
    valueKey: normalizeIdentityText(left.valueKey) === normalizeIdentityText(right.valueKey)
      ? normalizeIdentityText(left.valueKey)
      : "__different__",
    value: normalizeIdentityText(left.value) === normalizeIdentityText(right.value)
      ? normalizeIdentityText(left.value)
      : "__different__",
    valueSource: normalizeIdentityText(left.valueSource) === normalizeIdentityText(right.valueSource)
      ? normalizeIdentityText(left.valueSource)
      : "__different__",
    entityScope: normalizeIdentityText(left.entityScope) === normalizeIdentityText(right.entityScope)
      ? normalizeIdentityText(left.entityScope)
      : "__different__",
    associatedField: normalizeIdentityText(left.associatedField) === normalizeIdentityText(right.associatedField)
      ? normalizeIdentityText(left.associatedField)
      : "__different__",
    selectionField: normalizeIdentityText(left.selectionField) === normalizeIdentityText(right.selectionField)
      ? normalizeIdentityText(left.selectionField)
      : "__different__",
    technicalTargetRefs: JSON.stringify(leftRefs) === JSON.stringify(rightRefs) ? leftRefs : ["__different__"],
    controlIdentity: stableControlIdentity(left.controlIdentity) === stableControlIdentity(right.controlIdentity)
      ? stableControlIdentity(left.controlIdentity)
      : "__different__",
  }).includes('"__different__"') === false;
}
