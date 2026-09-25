"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const supporting_autofill_1 = require("./supporting-autofill");
const control_identity_1 = require("../types/control-identity");
const identity = (name, role = "textbox") => (0, control_identity_1.buildRuntimeControlIdentity)({
    tagName: role === "listbox" ? "div" : "input",
    inputType: role === "textbox" ? "email" : undefined,
    role,
    name,
    candidateLocator: { strategy: "role", role },
});
const requirement = (key, valuePolicy, kind) => ({
    key, source: "contract", valuePolicy, fieldCapability: { kind },
});
const control = (requirementRef, controlIdentity, overrides = {}) => ({
    requirementRef, visible: true, disabled: false, required: true, value: "", controlIdentity, ...overrides,
});
(0, node_test_1.default)("fills only the auxiliary safe synthetic control and retries the causal action once", async () => {
    const functionalIdentity = identity("functional");
    const auxiliaryIdentity = identity("auxiliary");
    const filled = [];
    let retries = 0;
    const locators = new Map([
        [auxiliaryIdentity.fingerprint, { fill: async (value) => filled.push(value) }],
        [functionalIdentity.fingerprint, { fill: async () => filled.push("functional") }],
    ]);
    const result = await (0, supporting_autofill_1.resolveSupportingAutofill)({
        page: {},
        executionPlan: [{ index: 1, action: "fill", controlIdentity: functionalIdentity, valueKey: "functional", requirementRefs: ["functional"] }],
        runtimeRequirements: [requirement("functional", "scenario_controlled", "text"), requirement("auxiliary", "safe_synthetic", "email")],
        observedControls: [
            control("functional", functionalIdentity),
            control("auxiliary", auxiliaryIdentity),
            control("auxiliary", auxiliaryIdentity),
        ].map((item) => ({ ...item, locator: locators.get(item.controlIdentity.fingerprint) })),
        dependentAction: { causal: true },
        executionSeed: "run-seed",
        retryDependentAction: async () => { retries += 1; },
    });
    strict_1.default.equal(result.retryAttempted, true);
    strict_1.default.equal(retries, 1);
    strict_1.default.equal(filled.length, 1);
    strict_1.default.match(filled[0], /@example\.test$/);
    strict_1.default.equal(result.resolutions.filter((item) => item.decision === "supporting_candidate").length, 1);
});
(0, node_test_1.default)("does not modify protected, trusted, unresolved, complete, or non-causal controls", async () => {
    const protectedIdentity = identity("protected");
    const trustedIdentity = identity("trusted");
    const unresolvedIdentity = identity("unresolved");
    const completeIdentity = identity("complete");
    const calls = [];
    const observedControls = [
        control("protected", protectedIdentity),
        control("trusted", trustedIdentity),
        control("unresolved", null, { controlIdentity: null }),
        control("complete", completeIdentity, { value: "present" }),
    ].map((item) => ({ ...item, locator: { fill: async () => { calls.push(item.requirementRef); } } }));
    const result = await (0, supporting_autofill_1.resolveSupportingAutofill)({
        page: {},
        executionPlan: [{ index: 1, action: "fill", controlIdentity: protectedIdentity, inputIntent: { mode: "leave_unset" }, requirementRefs: ["protected"] }],
        runtimeRequirements: [
            requirement("protected", "safe_synthetic", "email"),
            requirement("trusted", "trusted_required", "password"),
            requirement("unresolved", "unresolved", "unknown"),
            requirement("complete", "safe_synthetic", "email"),
        ],
        observedControls,
        dependentAction: { causal: false },
        executionSeed: "run-seed",
        retryDependentAction: async () => { calls.push("retry"); },
    });
    strict_1.default.equal(calls.length, 0);
    strict_1.default.equal(result.retryAttempted, false);
    strict_1.default.equal(result.resolutions.find((item) => item.requirementRef === "protected")?.decision, "protected_intent");
    strict_1.default.equal(result.resolutions.find((item) => item.requirementRef === "trusted")?.decision, "trusted_required");
    strict_1.default.equal(result.resolutions.find((item) => item.requirementRef === "complete")?.decision, "already_satisfied");
    for (const mode of ["invalid_value", "preserve_state"]) {
        const modeIdentity = identity(mode);
        const protectedResult = await (0, supporting_autofill_1.resolveSupportingAutofill)({
            page: {},
            executionPlan: [{ index: 1, action: "fill", controlIdentity: modeIdentity, inputIntent: { mode }, requirementRefs: [mode] }],
            runtimeRequirements: [requirement(mode, "safe_synthetic", "email")],
            observedControls: [{ ...control(mode, modeIdentity), locator: { fill: async () => { calls.push(mode); } } }],
            dependentAction: { causal: true },
            executionSeed: "run-seed",
        });
        strict_1.default.equal(protectedResult.resolutions[0]?.decision, "protected_intent");
    }
});
(0, node_test_1.default)("uses the existing runtime select strategy without materializing options", async () => {
    const selectIdentity = identity("dynamic", "listbox");
    let selected = "";
    const locator = {
        evaluate: async () => ({ observedAtRuntime: true, kind: "select", required: true, disabled: false, native: true, options: [{ value: "runtime-option", disabled: false, selected: false }] }),
        selectOption: async (value) => { selected = value; },
    };
    const result = await (0, supporting_autofill_1.resolveSupportingAutofill)({
        page: {},
        executionPlan: [],
        runtimeRequirements: [requirement("dynamic", "safe_synthetic", "select")],
        observedControls: [{ ...control("dynamic", selectIdentity), locator: locator }],
        dependentAction: { causal: true },
        executionSeed: "run-seed",
    });
    strict_1.default.equal(selected, "runtime-option");
    strict_1.default.equal(result.resolutions[0]?.source, "runtime_strategy");
    strict_1.default.equal(JSON.stringify(result).includes("runtime-option"), false);
});
