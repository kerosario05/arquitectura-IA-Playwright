/**
 * Decides whether an open editing-session tracker (opened on a trusted focus of an editable
 * element, closed either by a real `input`/`change` event or by this flush) should emit a
 * fallback raw fill when the session closes (blur, a click/pointerdown on a different control, a
 * form submit, or page unload) without ever having seen a real `input`/`change` DOM event —
 * the exact gap observed physically: a componentized field whose framework updates its bound
 * value without dispatching native `input`/`change` events at all.
 *
 * Defined here, stringified via `.toString()`, and interpolated into the capture script (the
 * same pattern already used for `classifyActionability`, `normalizeStructuralOwnerIdentity`, and
 * `selectSemanticFieldOwnerLabel`) so the SAME decision is both real inside a live recording and
 * independently unit-testable in Node, without needing a browser/jsdom.
 *
 * Deliberately narrow: a fallback fill is warranted only when the focus that opened the session
 * was itself user-caused (`trusted`) AND the value observably changed between focus-in and
 * flush. Never fires merely because a field is non-empty (a prefilled/autofilled value that was
 * never touched produces no change and is never synthesized as an edit).
 *
 * Must stay self-contained: `.toString()` only captures the function body, not any outer
 * closure — it may not reference anything from web-session-recorder.ts's own scope.
 */
export function shouldFlushEditingSessionFill(session: {
  /** Whether the focus event that opened this session was user-caused (`event.isTrusted`). */
  trusted: boolean;
  /** The field's value observed at focus-in time (the session's baseline). */
  initialValue?: string | null;
}, finalValue: string | undefined | null): boolean {
  if (!session.trusted) return false;
  if (finalValue === undefined || finalValue === null) return false;
  const clean = (value: unknown): string => String(value || "").replace(/\s+/g, " ").trim();
  return clean(finalValue) !== clean(session.initialValue);
}

export const SHOULD_FLUSH_EDITING_SESSION_FILL_SOURCE = `(${shouldFlushEditingSessionFill.toString()})`;
