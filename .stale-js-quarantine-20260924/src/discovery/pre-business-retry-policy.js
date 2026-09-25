"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SCENARIO_ATTEMPTS = void 0;
exports.isTransientPreBusinessFailure = isTransientPreBusinessFailure;
exports.shouldRetryScenario = shouldRetryScenario;
exports.MAX_SCENARIO_ATTEMPTS = 2;
const TRANSIENT_PRE_BUSINESS_FAILURES = new Set([
    "POST_AUTH_NAVIGATION_FAILURE",
    "post_auth_navigation_failure",
]);
function isTransientPreBusinessFailure(input) {
    const classification = input.failureClassification?.trim();
    return input.businessSurfaceReached === false
        && Boolean(classification && TRANSIENT_PRE_BUSINESS_FAILURES.has(classification))
        && input.authRejected === false
        && input.applicationError === false
        && input.functionalBusinessExecutionStarted === false
        && input.oracleEvaluationStarted === false;
}
function shouldRetryScenario(input) {
    return input.attempt < exports.MAX_SCENARIO_ATTEMPTS && isTransientPreBusinessFailure(input);
}
