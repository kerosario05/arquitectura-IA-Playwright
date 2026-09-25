"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const click_retry_policy_1 = require("./click-retry-policy");
(0, node_test_1.default)("in-place click with no retry outcome does not escalate", () => {
    strict_1.default.deepEqual((0, click_retry_policy_1.resolveClickRetryPolicy)({
        recordingActionType: "click",
        actionType: "action_click",
        transitionDetected: false,
        selectionApplied: false,
        observableOutcome: true,
    }), { navigationExpected: false, retryRequired: false });
});
(0, node_test_1.default)("editor activation is accepted from an observable in-place outcome", () => {
    strict_1.default.equal((0, click_retry_policy_1.resolveClickRetryPolicy)({
        recordingActionType: "click",
        actionType: "action_click",
        transitionDetected: false,
        selectionApplied: false,
        observableOutcome: true,
    }).retryRequired, false);
});
(0, node_test_1.default)("force/JS fallback remains available when no outcome is observable", () => {
    strict_1.default.equal((0, click_retry_policy_1.resolveClickRetryPolicy)({
        recordingActionType: "click",
        actionType: "action_click",
        transitionDetected: false,
        selectionApplied: false,
        observableOutcome: false,
    }).retryRequired, true);
});
(0, node_test_1.default)("navigation still requires transition when no transition was observed", () => {
    strict_1.default.deepEqual((0, click_retry_policy_1.resolveClickRetryPolicy)({
        recordingActionType: "navigation",
        transitionDetected: false,
        selectionApplied: false,
        observableOutcome: true,
    }), { navigationExpected: true, retryRequired: true });
});
