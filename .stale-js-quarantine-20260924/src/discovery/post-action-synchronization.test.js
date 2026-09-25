"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const post_action_synchronization_1 = require("./post-action-synchronization");
(0, node_test_1.default)("immediate action response is accepted when the watcher was armed before click", () => {
    strict_1.default.deepEqual((0, post_action_synchronization_1.resolvePostActionSynchronization)({ actionNetworkObserved: true, actionNetworkResponse: true }), {
        completed: true,
        signal: "network_response",
    });
});
(0, node_test_1.default)("DOM transition plus next target is accepted without requiring HTTP response", () => {
    strict_1.default.deepEqual((0, post_action_synchronization_1.resolvePostActionSynchronization)({ domMutation: true, nextTargetAvailable: true }), {
        completed: true,
        signal: "next_target_visible",
    });
});
(0, node_test_1.default)("pending action with no transition reaches bounded timeout state", () => {
    strict_1.default.deepEqual((0, post_action_synchronization_1.resolvePostActionSynchronization)({ actionNetworkObserved: true }), { completed: false });
});
(0, node_test_1.default)("application error is terminal and does not request a retry", () => {
    strict_1.default.deepEqual((0, post_action_synchronization_1.resolvePostActionSynchronization)({ applicationError: true, actionNetworkObserved: true }), {
        completed: true,
        signal: "application_error",
    });
});
(0, node_test_1.default)("redirect chain is completed by the terminal action response", () => {
    strict_1.default.deepEqual((0, post_action_synchronization_1.resolvePostActionSynchronization)({ actionNetworkObserved: true, actionNetworkResponse: true }), {
        completed: true,
        signal: "network_response",
    });
});
(0, node_test_1.default)("unrelated network activity cannot satisfy action synchronization", () => {
    strict_1.default.deepEqual((0, post_action_synchronization_1.resolvePostActionSynchronization)({ actionNetworkObserved: false, actionNetworkResponse: false }), {
        completed: false,
    });
});
