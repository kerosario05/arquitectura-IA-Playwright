/**
 * Some recorded clicks resolve to a semantic option, and the shared resolver
 * applies and verifies that option while finding it. Dispatching the same click
 * again can toggle or reopen the selection surface. Skip only with explicit
 * state-verification evidence from that causal option resolver.
 */
export function shouldSkipClickAfterVerifiedSelection(input: {
  selectionApplied?: boolean;
  selectionStateVerified?: boolean;
  locatorStrategy?: string;
}): boolean {
  return input.selectionApplied === true
    && input.selectionStateVerified === true
    && input.locatorStrategy === "selection_option_causal_surface";
}
