export type ClickRetryPolicyInput = {
  recordingActionType?: string;
  actionType?: string;
  locatorStrategy?: string;
  transitionDetected: boolean;
  selectionApplied: boolean;
  observableOutcome: boolean;
};

export type ClickRetryPolicyResult = {
  navigationExpected: boolean;
  retryRequired: boolean;
};

/**
 * Decide whether a click needs a fallback without confusing an in-place UI
 * mutation with a failed navigation. The observable outcome is supplied by
 * the existing post-action/UI probes; this policy only classifies it.
 */
export function resolveClickRetryPolicy(input: ClickRetryPolicyInput): ClickRetryPolicyResult {
  const navigationExpected = input.recordingActionType === "navigation"
    || input.actionType === "navigation_path"
    || /(?:navigation|route[_-]?profile)/i.test(input.locatorStrategy ?? "");
  const inPlaceOutcomeAccepted = !navigationExpected && input.observableOutcome;

  return {
    navigationExpected,
    retryRequired: !input.transitionDetected
      && !input.selectionApplied
      && !inPlaceOutcomeAccepted,
  };
}
