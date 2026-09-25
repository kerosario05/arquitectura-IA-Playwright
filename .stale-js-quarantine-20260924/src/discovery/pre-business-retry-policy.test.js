"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const pre_business_retry_policy_1 = require("./pre-business-retry-policy");
const transientFailure = {
    businessSurfaceReached: false,
    failureClassification: "POST_AUTH_NAVIGATION_FAILURE",
    authRejected: false,
    applicationError: false,
    functionalBusinessExecutionStarted: false,
    oracleEvaluationStarted: false,
};
(0, node_test_1.default)("pre-business post-auth navigation failure retries once", () => {
    strict_1.default.equal((0, pre_business_retry_policy_1.shouldRetryScenario)({ ...transientFailure, attempt: 1 }), true);
    strict_1.default.equal((0, pre_business_retry_policy_1.shouldRetryScenario)({ ...transientFailure, attempt: 2 }), false);
});
(0, node_test_1.default)("second transient failure is terminal", () => {
    strict_1.default.equal((0, pre_business_retry_policy_1.isTransientPreBusinessFailure)(transientFailure), true);
    strict_1.default.equal((0, pre_business_retry_policy_1.shouldRetryScenario)({ ...transientFailure, attempt: 2 }), false);
});
(0, node_test_1.default)("auth rejection never retries", () => {
    strict_1.default.equal((0, pre_business_retry_policy_1.isTransientPreBusinessFailure)({ ...transientFailure, authRejected: true }), false);
});
(0, node_test_1.default)("business failure never retries", () => {
    strict_1.default.equal((0, pre_business_retry_policy_1.isTransientPreBusinessFailure)({ ...transientFailure, businessSurfaceReached: true }), false);
});
(0, node_test_1.default)("application and functional failures never retry", () => {
    strict_1.default.equal((0, pre_business_retry_policy_1.isTransientPreBusinessFailure)({ ...transientFailure, applicationError: true }), false);
    strict_1.default.equal((0, pre_business_retry_policy_1.isTransientPreBusinessFailure)({ ...transientFailure, functionalBusinessExecutionStarted: true }), false);
    strict_1.default.equal((0, pre_business_retry_policy_1.isTransientPreBusinessFailure)({ ...transientFailure, oracleEvaluationStarted: true }), false);
});
