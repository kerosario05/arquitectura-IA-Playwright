import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * Resolves a logical child from a compound control only when the recording also
 * confirmed the parent selection. The selection is data authority; the visible
 * aggregate is never parsed by shape or by a business-specific label.
 */
export function logicalCompoundChildValue(value: string | undefined, selectionValue: string | undefined): string | undefined {
  const candidate = value?.trim();
  const selection = selectionValue?.trim();
  if (!candidate || !selection) return undefined;
  const prefix = `${selection} `;
  if (!candidate.startsWith(prefix)) return undefined;
  const child = candidate.slice(prefix.length).trim();
  if (!child) return undefined;
  // A compound amount editor may expose the currency prefix and an intermediate mask value
  // together (for example, a separator placed before the final digit group). The selected
  // option is already represented by its own interaction; keep only the numeric child and
  // remove separators that cannot be a valid thousands group. This is deliberately based on
  // the observed numeric shape, never on a specific currency or business value.
  if (/^[-+]?\d[\d,]*$/.test(child) && /,\d{4,}$/.test(child)) return child.replace(/,/g, "");
  return child;
}

function sameCompoundContext(source: RecordedTarget, target: RecordedTarget): boolean {
  if (source.entityScope && target.entityScope && source.entityScope !== target.entityScope) return false;
  if (source.cellRef && target.cellRef) return source.cellRef === target.cellRef;
  if (source.gridRef && target.gridRef && source.rowIdentity && target.rowIdentity) {
    return source.gridRef === target.gridRef
      && source.rowIdentity === target.rowIdentity
      && (source.associatedField ?? source.headerContext) === (target.associatedField ?? target.headerContext);
  }
  return Boolean(
    source.entityScope === target.entityScope
      && (source.associatedField ?? source.headerContext)
      && (source.associatedField ?? source.headerContext) === (target.associatedField ?? target.headerContext),
  );
}

/** Finds the latest confirmed selection for the same compound structural context. */
export function confirmedCompoundSelectionBefore(
  events: readonly RecordedEvent[],
  index: number,
  target: RecordedTarget | undefined,
): string | undefined {
  if (!target?.associatedField && !target?.headerContext) return undefined;
  for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
    const candidate = events[candidateIndex];
    const candidateTarget = candidate?.target;
    if (candidate?.kind !== "tap"
      || candidateTarget?.compoundRole !== "selection"
      || candidateTarget.afterValue === undefined
      || !candidateTarget
      || !sameCompoundContext(candidateTarget, target)) continue;
    return candidateTarget.afterValue.trim() || undefined;
  }
  return undefined;
}
