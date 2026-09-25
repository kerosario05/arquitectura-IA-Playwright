"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldReapplyAuthFields = shouldReapplyAuthFields;
/**
 * Reapply credentials only while an active auth surface still needs them.
 * Business fills may rematerialize the DOM, but that alone is not evidence
 * that auth fields are applicable to the current action.
 */
function shouldReapplyAuthFields(input) {
    return input.authGateActive
        && input.authSurfacePresent
        && !input.authAlreadySatisfied
        && input.rematerializationRelevant;
}
