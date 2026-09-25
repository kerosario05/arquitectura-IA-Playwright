"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const auth_transient_retry_1 = require("./auth-transient-retry");
const pendingAttempt = {
    submitClicked: true,
    requestObserved: true,
    responseObserved: false,
    requestFailed: false,
    authSurfacePresent: true,
    protectedSurfaceDetected: false,
    terminalErrorVisible: false,
    absoluteDeadlineReached: true,
    events: [{ state: "pending" }],
};
(0, node_test_1.default)("classifies pending auth submit as transient no-response", () => {
    strict_1.default.equal((0, auth_transient_retry_1.isAuthTransientNoResponse)(pendingAttempt), true);
});
(0, node_test_1.default)("does not retry a terminal response or authenticated state", () => {
    strict_1.default.equal((0, auth_transient_retry_1.isAuthTransientNoResponse)({ ...pendingAttempt, responseObserved: true }), false);
    strict_1.default.equal((0, auth_transient_retry_1.isAuthTransientNoResponse)({ ...pendingAttempt, protectedSurfaceDetected: true }), false);
    strict_1.default.equal((0, auth_transient_retry_1.isAuthTransientNoResponse)({ ...pendingAttempt, events: [{ state: "completed", status: 401 }] }), false);
});
(0, node_test_1.default)("retry maximum is bounded to one attempt", () => {
    strict_1.default.equal((0, auth_transient_retry_1.resolveAuthTransientRetryMax)(undefined), 1);
    strict_1.default.equal((0, auth_transient_retry_1.resolveAuthTransientRetryMax)("4"), 1);
    strict_1.default.equal((0, auth_transient_retry_1.resolveAuthTransientRetryMax)("0"), 0);
    strict_1.default.equal((0, auth_transient_retry_1.resolveAuthTransientRetryMax)("invalid"), 1);
});
