"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const control_identity_1 = require("./control-identity");
const control = (id, role = "textbox") => ({
    id,
    type: "input",
    tagName: "input",
    inputType: "email",
    role,
    name: "contact-input",
    visible: true,
    candidateLocators: [{ strategy: "role", role, name: "contact-input", confidence: 1 }],
    dataHints: [],
});
(0, node_test_1.default)("builds a deterministic structural identity independent of positional snapshot id", () => {
    const first = (0, control_identity_1.buildRuntimeControlIdentity)(control("el-1"));
    const second = (0, control_identity_1.buildRuntimeControlIdentity)(control("el-99"));
    strict_1.default.ok(first);
    strict_1.default.deepEqual(first, second);
    strict_1.default.equal(first?.source, "runtime");
});
(0, node_test_1.default)("matches equivalent controls and rejects structurally different controls without text fuzzy matching", () => {
    const first = (0, control_identity_1.buildRuntimeControlIdentity)(control("el-1"));
    const equivalent = (0, control_identity_1.buildRuntimeControlIdentity)(control("el-2"));
    const different = (0, control_identity_1.buildRuntimeControlIdentity)(control("el-3", "combobox"));
    strict_1.default.equal((0, control_identity_1.matchControlIdentity)(first, equivalent), "match");
    strict_1.default.equal((0, control_identity_1.matchControlIdentity)(first, different), "no_match");
    strict_1.default.equal((0, control_identity_1.matchControlIdentity)(first, null), "unknown");
});
(0, node_test_1.default)("returns null for insufficient metadata and preserves the identity bundle", () => {
    strict_1.default.equal((0, control_identity_1.buildRuntimeControlIdentity)({}), null);
    const identity = (0, control_identity_1.buildRuntimeControlIdentity)(control("el-1"));
    strict_1.default.ok(identity);
    const step = {
        index: 1,
        action: "fill",
        controlIdentity: identity,
        requirementRefs: ["req-1"],
        inputIntent: { mode: "leave_unset", requirementRefs: ["req-1"] },
    };
    strict_1.default.equal(step.controlIdentity?.fingerprint, identity.fingerprint);
    strict_1.default.deepEqual(JSON.parse(JSON.stringify(step)).controlIdentity, JSON.parse(JSON.stringify(identity)));
});
