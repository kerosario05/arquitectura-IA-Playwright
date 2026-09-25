"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveClickRetryPolicy = resolveClickRetryPolicy;
/**
 * Decide whether a click needs a fallback without confusing an in-place UI
 * mutation with a failed navigation. The observable outcome is supplied by
 * the existing post-action/UI probes; this policy only classifies it.
 */
function resolveClickRetryPolicy(input) {
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
