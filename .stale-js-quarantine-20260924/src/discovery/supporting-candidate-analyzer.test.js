"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const supporting_candidate_analyzer_1 = require("./supporting-candidate-analyzer");
const control_identity_1 = require("../types/control-identity");
const identity = (role, name) => (0, control_identity_1.buildRuntimeControlIdentity)({
    tagName: "input", inputType: role === "textbox" ? "email" : undefined, role, name,
    candidateLocator: { strategy: "role", role },
});
const requirement = (key, valuePolicy, kind) => ({
    key, source: "contract", valuePolicy, fieldCapability: { kind },
});
const observed = (name, overrides = {}) => ({
    visible: true, disabled: false, required: true, value: "", controlIdentity: identity("textbox", name), ...overrides,
});
const action = { causal: true };
(0, node_test_1.default)("classifies scenario-controlled and safe synthetic controls", () => {
    const documentIdentity = identity("textbox", "document-input");
    const result = (0, supporting_candidate_analyzer_1.analyzeSupportingCandidates)({
        runtimeRequirements: [requirement("document", "scenario_controlled", "text"), requirement("auxiliary", "safe_synthetic", "email")],
        observedControls: [
            observed("document-input", { requirementRef: "document", controlIdentity: documentIdentity }),
            observed("auxiliary-input", { requirementRef: "auxiliary", controlIdentity: identity("textbox", "auxiliary-input") }),
        ],
        executionPlan: [{ index: 1, action: "fill", controlIdentity: documentIdentity, valueKey: "document", requirementRefs: ["document"] }],
        dependentAction: action,
    });
    strict_1.default.deepEqual(result.map((item) => item.decision), ["scenario_controlled", "supporting_candidate"]);
});
(0, node_test_1.default)("protects every structured non-positive intent and never autofills it", () => {
    for (const mode of ["leave_unset", "invalid_value", "preserve_state"]) {
        const controlIdentity = identity("textbox", mode);
        const result = (0, supporting_candidate_analyzer_1.analyzeSupportingCandidates)({
            runtimeRequirements: [requirement(mode, "safe_synthetic", "email")],
            observedControls: [observed(mode, { controlIdentity })],
            executionPlan: [{ index: 1, action: "fill", controlIdentity, inputIntent: { mode }, requirementRefs: [mode] }],
            dependentAction: action,
        });
        strict_1.default.equal(result[0]?.decision, "protected_intent");
    }
});
(0, node_test_1.default)("handles trusted, unresolved, complete, identity and causal gates conservatively", () => {
    const cases = [
        [requirement("trusted", "trusted_required", "password"), observed("trusted"), "trusted_required"],
        [requirement("unknown", "unresolved", "unknown"), observed("unknown"), "unresolved"],
        [requirement("complete", "safe_synthetic", "email"), observed("complete", { value: "present" }), "already_satisfied"],
        [requirement("select", "safe_synthetic", "select"), observed("select", { value: "option" }), "already_satisfied"],
    ];
    for (const [runtimeRequirement, control, expected] of cases) {
        strict_1.default.equal((0, supporting_candidate_analyzer_1.analyzeSupportingCandidates)({ runtimeRequirements: [runtimeRequirement], observedControls: [control], executionPlan: [], dependentAction: action })[0]?.decision, expected);
    }
    const identityControl = identity("textbox", "same");
    strict_1.default.equal((0, supporting_candidate_analyzer_1.analyzeSupportingCandidates)({ runtimeRequirements: [requirement("same", "safe_synthetic", "email")], observedControls: [observed("same", { controlIdentity: identityControl })], executionPlan: [{ index: 1, action: "fill", controlIdentity: identityControl, inputIntent: { mode: "set_value" } }], dependentAction: action })[0]?.decision, "scenario_controlled");
    strict_1.default.equal((0, supporting_candidate_analyzer_1.analyzeSupportingCandidates)({ runtimeRequirements: [requirement("related", "safe_synthetic", "email")], observedControls: [observed("related", { controlIdentity: null })], executionPlan: [{ index: 1, action: "fill", controlIdentity: identity("textbox", "other"), value: "x" }], dependentAction: action })[0]?.decision, "unresolved");
    strict_1.default.equal((0, supporting_candidate_analyzer_1.analyzeSupportingCandidates)({ runtimeRequirements: [requirement("no-cause", "safe_synthetic", "email")], observedControls: [observed("no-cause")], executionPlan: [], dependentAction: undefined })[0]?.decision, "unresolved");
});
(0, node_test_1.default)("deduplicates supporting candidates by structural fingerprint and avoids text metadata", () => {
    const controlIdentity = identity("textbox", "duplicate");
    const result = (0, supporting_candidate_analyzer_1.analyzeSupportingCandidates)({
        runtimeRequirements: [requirement("duplicate", "safe_synthetic", "email")],
        observedControls: [observed("duplicate", { controlIdentity }), observed("duplicate", { controlIdentity })],
        executionPlan: [], dependentAction: action,
    });
    strict_1.default.equal(result.filter((item) => item.decision === "supporting_candidate").length, 1);
    strict_1.default.equal(JSON.stringify(result).includes('"label"'), false);
    strict_1.default.equal(JSON.stringify(result).includes('"text"'), false);
});
