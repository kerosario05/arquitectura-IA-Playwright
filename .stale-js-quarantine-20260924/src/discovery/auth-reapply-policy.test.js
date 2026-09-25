"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const auth_reapply_policy_1 = require("./auth-reapply-policy");
(0, node_test_1.default)("active auth surface with rematerialized auth fields reapplies", () => {
    strict_1.default.equal((0, auth_reapply_policy_1.shouldReapplyAuthFields)({
        authGateActive: true,
        authSurfacePresent: true,
        authAlreadySatisfied: false,
        rematerializationRelevant: true,
    }), true);
});
(0, node_test_1.default)("completed auth on a business surface skips reapply", () => {
    strict_1.default.equal((0, auth_reapply_policy_1.shouldReapplyAuthFields)({
        authGateActive: false,
        authSurfacePresent: false,
        authAlreadySatisfied: true,
        rematerializationRelevant: false,
    }), false);
});
(0, node_test_1.default)("business DOM rematerialization without auth applicability skips reapply", () => {
    strict_1.default.equal((0, auth_reapply_policy_1.shouldReapplyAuthFields)({
        authGateActive: false,
        authSurfacePresent: false,
        authAlreadySatisfied: true,
        rematerializationRelevant: true,
    }), false);
});
(0, node_test_1.default)("actual auth rematerialization remains eligible", () => {
    strict_1.default.equal((0, auth_reapply_policy_1.shouldReapplyAuthFields)({
        authGateActive: true,
        authSurfacePresent: true,
        authAlreadySatisfied: false,
        rematerializationRelevant: true,
    }), true);
});
(0, node_test_1.default)("stale auth detection without a current auth surface does not reapply", () => {
    strict_1.default.equal((0, auth_reapply_policy_1.shouldReapplyAuthFields)({
        authGateActive: true,
        authSurfacePresent: false,
        authAlreadySatisfied: false,
        rematerializationRelevant: true,
    }), false);
});
