export type AuthReapplyPolicyInput = {
  authGateActive: boolean;
  authSurfacePresent: boolean;
  authAlreadySatisfied: boolean;
  rematerializationRelevant: boolean;
};

/**
 * Reapply credentials only while an active auth surface still needs them.
 * Business fills may rematerialize the DOM, but that alone is not evidence
 * that auth fields are applicable to the current action.
 */
export function shouldReapplyAuthFields(input: AuthReapplyPolicyInput): boolean {
  return input.authGateActive
    && input.authSurfacePresent
    && !input.authAlreadySatisfied
    && input.rematerializationRelevant;
}
