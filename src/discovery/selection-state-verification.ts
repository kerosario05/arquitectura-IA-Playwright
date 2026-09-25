export type InteractiveState = {
  checked?: boolean;
  ariaChecked?: string | null;
  selected?: boolean;
  ariaPressed?: string | null;
  value?: string | null;
};

export type SelectionStateVerification = {
  observed: boolean;
  matches: boolean;
  expected?: string;
  actual?: string;
  reason: string;
};

export function booleanState(state: InteractiveState): boolean | undefined {
  if (typeof state.checked === "boolean") return state.checked;
  if (typeof state.ariaChecked === "string" && /^(true|false)$/i.test(state.ariaChecked)) {
    return state.ariaChecked.toLowerCase() === "true";
  }
  if (typeof state.selected === "boolean") return state.selected;
  if (typeof state.ariaPressed === "string" && /^(true|false)$/i.test(state.ariaPressed)) {
    return state.ariaPressed.toLowerCase() === "true";
  }
  return undefined;
}

function describe(state: InteractiveState): string {
  const value = booleanState(state);
  if (value !== undefined) return String(value);
  return state.value == null ? "unobservable" : `value:${state.value}`;
}

/** Verify a check/select/toggle by control state, never by visible checkbox text. */
export function verifySelectionState(
  actionKind: string | undefined,
  before: InteractiveState | undefined,
  after: InteractiveState | undefined,
): SelectionStateVerification {
  const kind = String(actionKind ?? "").toLowerCase();
  if (!["check", "uncheck", "radio", "select", "toggle"].includes(kind)) {
    return { observed: false, matches: false, reason: "action_not_state_verifiable" };
  }
  const beforeValue = before ? booleanState(before) : undefined;
  const afterValue = after ? booleanState(after) : undefined;
  const hasSelectionState = afterValue !== undefined;
  const valueChanged = Boolean(before && after && before.value !== after.value && after.value != null);
  const observed = hasSelectionState || valueChanged;
  if (!observed) return { observed: false, matches: false, reason: "control_state_unobservable" };

  if (kind === "select") {
    const matches = valueChanged || afterValue === true || (after?.value != null && String(after.value).length > 0);
    return { observed: true, matches, expected: "selected", actual: describe(after ?? {}), reason: matches ? "selected_state_changed" : "selected_state_not_changed" };
  }
  if (kind === "toggle") {
    const expected = beforeValue === undefined ? true : !beforeValue;
    const matches = afterValue === expected;
    return { observed: true, matches, expected: String(expected), actual: describe(after ?? {}), reason: matches ? "toggle_state_changed" : "toggle_state_not_changed" };
  }
  const expected = kind === "uncheck" ? false : true;
  const matches = afterValue === expected;
  return { observed: true, matches, expected: String(expected), actual: describe(after ?? {}), reason: matches ? "state_matches_action" : "state_does_not_match_action" };
}

/**
 * A strict CAUSAL transition on the SAME already-resolved technical target -- never a new
 * resolver, never re-derived from target text. Used to feed a completion signal (unlike
 * `verifySelectionState`, which serves post-hoc failure diagnostics and accepts `after=true`
 * alone as a match): `after=true` while `before` was ALREADY true is not evidence this action
 * caused anything, so it never counts here. A value transition (e.g. a select's committed value
 * appearing where none existed) is treated the same way -- causal only when it actually changed.
 */
export function hasCausalSelectionTransition(
  before: InteractiveState | undefined,
  after: InteractiveState | undefined,
): boolean {
  if (!after) return false;
  const beforeValue = before ? booleanState(before) : undefined;
  const afterValue = booleanState(after);
  if (afterValue === true && beforeValue !== true) return true;
  const valueChanged = Boolean(before && before.value !== after.value && after.value != null && after.value !== "");
  return valueChanged && beforeValue !== true;
}
