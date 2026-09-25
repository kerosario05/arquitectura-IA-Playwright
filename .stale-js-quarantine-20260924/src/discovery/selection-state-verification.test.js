"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const selection_state_verification_1 = require("./selection-state-verification");
(0, node_test_1.default)("check succeeds from checked state", () => {
    strict_1.default.deepEqual((0, selection_state_verification_1.verifySelectionState)("check", { checked: false }, { checked: true }).matches, true);
});
(0, node_test_1.default)("uncheck rejects a checked control", () => {
    strict_1.default.equal((0, selection_state_verification_1.verifySelectionState)("uncheck", { checked: true }, { checked: true }).matches, false);
});
(0, node_test_1.default)("select accepts a changed control value", () => {
    strict_1.default.equal((0, selection_state_verification_1.verifySelectionState)("select", { value: "" }, { value: "USD" }).matches, true);
});
(0, node_test_1.default)("unobservable click is not treated as a state assertion", () => {
    strict_1.default.equal((0, selection_state_verification_1.verifySelectionState)("click", {}, {}).observed, false);
});
