"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const controlled_advance_probe_1 = require("./controlled-advance-probe");
const control_identity_1 = require("../types/control-identity");
const control = (overrides = {}) => ({
    identity: "button|submit",
    tagName: "button",
    role: "button",
    type: "submit",
    visible: true,
    disabled: false,
    formAssociated: true,
    submitSemantics: true,
    ...overrides,
});
const snapshot = (overrides = {}) => ({
    urlPath: "/form",
    controls: [{
            identity: "input|name=document",
            tagName: "input",
            ariaInvalid: "false",
            disabled: false,
            required: true,
            focused: false,
            validity: { valid: true, valueMissing: false, typeMismatch: false, patternMismatch: false },
            validationNodeIds: [],
        }],
    validationNodes: [],
    forms: [{ identity: "form|id=main", valid: true }],
    fingerprint: "before",
    ...overrides,
});
(0, node_test_1.default)("A structured submit semantic resolves the advance candidate", () => {
    const candidate = (0, controlled_advance_probe_1.resolveAdvanceCandidate)([control()]);
    strict_1.default.equal(candidate?.resolutionSource, "structured_submit_semantics");
});
(0, node_test_1.default)("a visible action label alone has no authority", () => {
    strict_1.default.equal((0, controlled_advance_probe_1.resolveAdvanceCandidate)([control({ type: "button", formAssociated: false, submitSemantics: false })]), undefined);
});
(0, node_test_1.default)("invalid input plus submit plus validation and preserved form backs both outcomes", () => {
    const before = snapshot();
    const after = snapshot({
        fingerprint: "after",
        controls: [
            { ...before.controls[0], ariaInvalid: "true", validity: { ...before.controls[0].validity, valid: false, patternMismatch: true }, validationNodeIds: ["error-1"] },
            { ...control(), disabled: true },
        ],
        validationNodes: [{ identity: "div|id=error-1", role: "alert", id: "error-1" }],
        forms: [{ identity: "form|id=main", valid: false }],
    });
    const result = (0, controlled_advance_probe_1.compareControlledAdvanceSnapshots)({
        before: { ...before, controls: [...before.controls, control()] },
        after,
        attemptObserved: true,
        networkEvents: [],
        subjectIdentities: ["input|name=document"],
        advanceActionIdentity: "button|submit",
    });
    strict_1.default.equal(result.validationObserved, true);
    strict_1.default.equal(result.transitionOccurred, false);
    strict_1.default.equal(result.blockedObserved, true);
    strict_1.default.equal(result.advanceCausality, "causal");
});
(0, node_test_1.default)("invalid input plus submit plus transition is not a blocked result", () => {
    const result = (0, controlled_advance_probe_1.compareControlledAdvanceSnapshots)({
        before: snapshot(),
        after: snapshot({ urlPath: "/next", forms: [] }),
        attemptObserved: true,
        networkEvents: [],
    });
    strict_1.default.equal(result.validationObserved, false);
    strict_1.default.equal(result.transitionOccurred, true);
    strict_1.default.equal(result.blockedObserved, false);
});
(0, node_test_1.default)("no deterministic advance candidate fails closed", () => {
    strict_1.default.equal((0, controlled_advance_probe_1.resolveAdvanceCandidate)([control(), control({ identity: "button|submit-2" })]), undefined);
});
(0, node_test_1.default)("canonical advance relation narrows structurally eligible controls without positional fallback", () => {
    const controls = [
        control({ identity: "button|upload", type: "button", accessibleName: "Cargar archivo" }),
        control({ identity: "button|advance", type: "button", disabled: true, accessibleName: "advance" }),
    ];
    const resolution = (0, controlled_advance_probe_1.resolveAdvanceControl)(controls, "advance");
    strict_1.default.equal(resolution.state, "found_disabled");
    strict_1.default.equal(resolution.candidate?.identity, "button|advance");
});
(0, node_test_1.default)("unchanged URL without an attempt is not blocked evidence", () => {
    const result = (0, controlled_advance_probe_1.compareControlledAdvanceSnapshots)({ before: snapshot(), after: snapshot(), attemptObserved: false, networkEvents: [] });
    strict_1.default.equal(result.transitionOccurred, false);
    strict_1.default.equal(result.blockedObserved, false);
});
(0, node_test_1.default)("disabled structural advance is found but never treated as an attempt", () => {
    const resolution = (0, controlled_advance_probe_1.resolveAdvanceControl)([control({ type: "button", formAssociated: false, submitSemantics: false, actionPriority: "primary", disabled: true })]);
    strict_1.default.equal(resolution.state, "found_disabled");
    strict_1.default.equal(resolution.candidate?.disabled, true);
});
(0, node_test_1.default)("subject validation is required before validation oracle is backed", () => {
    const result = (0, controlled_advance_probe_1.compareControlledAdvanceSnapshots)({
        before: snapshot(),
        after: snapshot({ urlPath: "/form" }),
        attemptObserved: true,
        networkEvents: [],
        subjectIdentities: ["input|name=document"],
        advanceActionIdentity: "button|submit",
    });
    strict_1.default.equal(result.subjectFound, true);
    strict_1.default.equal(result.validationObserved, false);
    strict_1.default.equal(result.functionalDefectAssertion13, false);
});
(0, node_test_1.default)("validation-region mutation is associated with the structural subject", () => {
    const before = snapshot({
        controls: [{
                ...snapshot().controls[0],
                validationContext: { ancestorTag: "body", nodeCount: 1, textLength: 0, structure: "section::polite:1:0" },
            }],
    });
    const after = snapshot({
        controls: [{
                ...before.controls[0],
                validationContext: { ancestorTag: "body", nodeCount: 1, textLength: 24, structure: "section::polite:2:24" },
            }],
    });
    const result = (0, controlled_advance_probe_1.compareControlledAdvanceSnapshots)({
        before,
        after,
        attemptObserved: false,
        networkEvents: [],
        subjectIdentities: ["input|name=document"],
        triggerObservation: { before, after },
        subjectInputApplied: true,
    });
    strict_1.default.equal(result.subjectFound, true);
    strict_1.default.equal(result.subjectValidationMutation, true);
    strict_1.default.equal(result.validationObserved, true);
});
(0, node_test_1.default)("an independent invalid required control makes disabled causality ambiguous", () => {
    const before = snapshot({
        controls: [
            ...snapshot().controls,
            { ...control(), disabled: false },
            { ...snapshot().controls[0], identity: "input|name=other", validity: { valid: true, valueMissing: false, typeMismatch: false, patternMismatch: false } },
        ],
    });
    const after = snapshot({
        controls: [
            { ...before.controls[0], ariaInvalid: "true", validity: { ...before.controls[0].validity, valid: false, patternMismatch: true } },
            { ...control(), disabled: true },
            { ...before.controls[2], ariaInvalid: "true", validity: { ...before.controls[2].validity, valid: false, valueMissing: true } },
        ],
        forms: [{ identity: "form|id=main", valid: false }],
    });
    const result = (0, controlled_advance_probe_1.compareControlledAdvanceSnapshots)({
        before,
        after,
        attemptObserved: true,
        networkEvents: [],
        subjectIdentities: ["input|name=document"],
        advanceActionIdentity: "button|submit",
    });
    strict_1.default.equal(result.otherInvalidRequiredControls, 1);
    strict_1.default.equal(result.advanceCausality, "ambiguous");
    strict_1.default.equal(result.blockedObserved, false);
});
(0, node_test_1.default)("rerendered subject is re-resolved by structural runtime identity", () => {
    const subjectIdentity = (0, control_identity_1.buildRuntimeControlIdentity)({ tagName: "input", inputType: "text", name: "document", id: "el-1" });
    strict_1.default.ok(subjectIdentity);
    const before = snapshot({
        controls: [
            { ...snapshot().controls[0], identity: "input|id=el-1|name=document|type=text", id: "el-1", name: "document", inputType: "text" },
            { ...control(), identity: "button|id=advance|type=submit" },
        ],
    });
    const after = snapshot({
        controls: [
            { ...before.controls[0], identity: "input|id=el-2|name=document|type=text", id: "el-2", ariaInvalid: "true", validity: { ...before.controls[0].validity, valid: false, patternMismatch: true } },
            { ...before.controls[1], disabled: true },
        ],
        forms: [{ identity: "form|id=main", valid: false }],
    });
    const result = (0, controlled_advance_probe_1.compareControlledAdvanceSnapshots)({
        before,
        after,
        attemptObserved: true,
        networkEvents: [],
        subjectControlIdentities: [subjectIdentity],
        advanceActionIdentity: "button|id=advance|type=submit",
    });
    strict_1.default.equal(result.subjectFound, true);
    strict_1.default.equal(result.subjectValidationMutation, true);
    strict_1.default.equal(result.advanceCausality, "causal");
});
(0, node_test_1.default)("no subject validation after an observed trigger is reported as assertion-13 defect evidence", () => {
    const before = { ...snapshot(), controls: [...snapshot().controls, control()] };
    const after = { ...snapshot(), controls: [...snapshot().controls, control({ disabled: true })] };
    const result = (0, controlled_advance_probe_1.compareControlledAdvanceSnapshots)({
        before,
        after,
        attemptObserved: false,
        networkEvents: [],
        subjectIdentities: ["input|name=document"],
        subjectInputApplied: true,
        advanceActionIdentity: "button|submit",
        triggerObservation: { before, after },
    });
    strict_1.default.equal(result.functionalDefectAssertion13, true);
    strict_1.default.equal(result.validationObserved, false);
    strict_1.default.equal(result.blockedObserved, false);
});
(0, node_test_1.default)("negative polarity is preserved for the transition intent oracle", () => {
    const oracles = (0, controlled_advance_probe_1.buildControlledAdvanceProbeOracles)({
        result: { intent: ["validation_present", "transition_blocked"], candidateFound: true, candidateEnabled: true, attemptPossible: true, resolutionState: "found_enabled", subjectFound: true, subjectValidationMutation: true, subjectInputApplied: true, advanceCausality: "causal", otherInvalidRequiredControls: 0, otherEmptyRequiredControls: 0, functionalDefectAssertion13: false, attemptObserved: true, beforeCaptured: true, afterCaptured: true, networkEvents: [], validationMutation: true, transitionOccurred: false, blockedObserved: true, validationObserved: true, evidence: [] },
        assertions: [{ index: 14, requirement: "blocked", requirementRefs: ["REQ-14"], intent: "transition_blocked", polarity: "negative" }],
    });
    strict_1.default.equal(oracles.find((oracle) => oracle.id.includes("blocked"))?.polarity, "negative");
});
(0, node_test_1.default)("probe does not invent polarity when canonical authority is unresolved", () => {
    const oracles = (0, controlled_advance_probe_1.buildControlledAdvanceProbeOracles)({
        result: { intent: ["transition_blocked"], candidateFound: true, candidateEnabled: false, attemptPossible: false, resolutionState: "found_disabled", subjectFound: true, subjectValidationMutation: true, subjectInputApplied: true, advanceCausality: "causal", otherInvalidRequiredControls: 0, otherEmptyRequiredControls: 0, functionalDefectAssertion13: false, attemptObserved: false, beforeCaptured: true, afterCaptured: true, networkEvents: [], validationMutation: true, transitionOccurred: false, blockedObserved: false, validationObserved: true, evidence: [] },
        assertions: [{ index: 14, requirement: "blocked", requirementRefs: ["REQ-14"], intent: "transition_blocked" }],
    });
    strict_1.default.equal(oracles[0]?.polarity, undefined);
});
(0, node_test_1.default)("structured probe remains project agnostic", () => {
    strict_1.default.equal((0, controlled_advance_probe_1.resolveAdvanceCandidate)([control({ identity: "synthetic-project-submit" })])?.identity, "synthetic-project-submit");
});
