export const MAX_SCENARIO_ATTEMPTS = 2;

export type PreBusinessFailureSignals = {
  businessSurfaceReached: boolean;
  failureClassification?: string;
  authRejected: boolean;
  applicationError: boolean;
  functionalBusinessExecutionStarted: boolean;
  oracleEvaluationStarted: boolean;
};

const TRANSIENT_PRE_BUSINESS_FAILURES = new Set([
  "POST_AUTH_NAVIGATION_FAILURE",
  "post_auth_navigation_failure",
]);

export function isTransientPreBusinessFailure(input: PreBusinessFailureSignals): boolean {
  const classification = input.failureClassification?.trim();
  return input.businessSurfaceReached === false
    && Boolean(classification && TRANSIENT_PRE_BUSINESS_FAILURES.has(classification))
    && input.authRejected === false
    && input.applicationError === false
    && input.functionalBusinessExecutionStarted === false
    && input.oracleEvaluationStarted === false;
}

export function shouldRetryScenario(input: PreBusinessFailureSignals & { attempt: number }): boolean {
  return input.attempt < MAX_SCENARIO_ATTEMPTS && isTransientPreBusinessFailure(input);
}
