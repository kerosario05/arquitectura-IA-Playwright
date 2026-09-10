import assert from "node:assert/strict";
import test from "node:test";
import { buildControlledAdvanceProbeOracles, compareControlledAdvanceSnapshots, resolveAdvanceCandidate, resolveAdvanceControl, type AdvanceControlObservation } from "./controlled-advance-probe";
import type { AssertionObservationSnapshot } from "./assertion-observation";
import { buildRuntimeControlIdentity } from "../types/control-identity";

const control = (overrides: Partial<AdvanceControlObservation> = {}): AdvanceControlObservation => ({
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

const snapshot = (overrides: Partial<AssertionObservationSnapshot> = {}): AssertionObservationSnapshot => ({
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

test("A structured submit semantic resolves the advance candidate", () => {
  const candidate = resolveAdvanceCandidate([control()]);
  assert.equal(candidate?.resolutionSource, "structured_submit_semantics");
});

test("a visible action label alone has no authority", () => {
  assert.equal(resolveAdvanceCandidate([control({ type: "button", formAssociated: false, submitSemantics: false })]), undefined);
});

test("invalid input plus submit plus validation and preserved form backs both outcomes", () => {
  const before = snapshot();
  const after = snapshot({
    fingerprint: "after",
    controls: [
      { ...before.controls[0], ariaInvalid: "true", validity: { ...before.controls[0].validity!, valid: false, patternMismatch: true }, validationNodeIds: ["error-1"] },
      { ...control(), disabled: true },
    ],
    validationNodes: [{ identity: "div|id=error-1", role: "alert", id: "error-1" }],
    forms: [{ identity: "form|id=main", valid: false }],
  });
  const result = compareControlledAdvanceSnapshots({
    before: { ...before, controls: [...before.controls, control()] },
    after,
    attemptObserved: true,
    networkEvents: [],
    subjectIdentities: ["input|name=document"],
    advanceActionIdentity: "button|submit",
  });
  assert.equal(result.validationObserved, true);
  assert.equal(result.transitionOccurred, false);
  assert.equal(result.blockedObserved, true);
  assert.equal(result.advanceCausality, "causal");
});

test("invalid input plus submit plus transition is not a blocked result", () => {
  const result = compareControlledAdvanceSnapshots({
    before: snapshot(),
    after: snapshot({ urlPath: "/next", forms: [] }),
    attemptObserved: true,
    networkEvents: [],
  });
  assert.equal(result.validationObserved, false);
  assert.equal(result.transitionOccurred, true);
  assert.equal(result.blockedObserved, false);
});

test("no deterministic advance candidate fails closed", () => {
  assert.equal(resolveAdvanceCandidate([control(), control({ identity: "button|submit-2" })]), undefined);
});

test("canonical advance relation narrows structurally eligible controls without positional fallback", () => {
  const controls = [
    control({ identity: "button|upload", type: "button", accessibleName: "Cargar archivo" }),
    control({ identity: "button|advance", type: "button", disabled: true, accessibleName: "advance" }),
  ];
  const resolution = resolveAdvanceControl(controls, "advance");
  assert.equal(resolution.state, "found_disabled");
  assert.equal(resolution.candidate?.identity, "button|advance");
});

test("unchanged URL without an attempt is not blocked evidence", () => {
  const result = compareControlledAdvanceSnapshots({ before: snapshot(), after: snapshot(), attemptObserved: false, networkEvents: [] });
  assert.equal(result.transitionOccurred, false);
  assert.equal(result.blockedObserved, false);
});

test("disabled structural advance is found but never treated as an attempt", () => {
  const resolution = resolveAdvanceControl([control({ type: "button", formAssociated: false, submitSemantics: false, actionPriority: "primary", disabled: true })]);
  assert.equal(resolution.state, "found_disabled");
  assert.equal(resolution.candidate?.disabled, true);
});

test("subject validation is required before validation oracle is backed", () => {
  const result = compareControlledAdvanceSnapshots({
    before: snapshot(),
    after: snapshot({ urlPath: "/form" }),
    attemptObserved: true,
    networkEvents: [],
    subjectIdentities: ["input|name=document"],
    advanceActionIdentity: "button|submit",
  });
  assert.equal(result.subjectFound, true);
  assert.equal(result.validationObserved, false);
  assert.equal(result.functionalDefectAssertion13, false);
});

test("validation-region mutation is associated with the structural subject", () => {
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
  const result = compareControlledAdvanceSnapshots({
    before,
    after,
    attemptObserved: false,
    networkEvents: [],
    subjectIdentities: ["input|name=document"],
    triggerObservation: { before, after },
    subjectInputApplied: true,
  });
  assert.equal(result.subjectFound, true);
  assert.equal(result.subjectValidationMutation, true);
  assert.equal(result.validationObserved, true);
});

test("an independent invalid required control makes disabled causality ambiguous", () => {
  const before = snapshot({
    controls: [
      ...snapshot().controls,
      { ...control(), disabled: false },
      { ...snapshot().controls[0], identity: "input|name=other", validity: { valid: true, valueMissing: false, typeMismatch: false, patternMismatch: false } },
    ],
  });
  const after = snapshot({
    controls: [
      { ...before.controls[0], ariaInvalid: "true", validity: { ...before.controls[0].validity!, valid: false, patternMismatch: true } },
      { ...control(), disabled: true },
      { ...before.controls[2], ariaInvalid: "true", validity: { ...before.controls[2].validity!, valid: false, valueMissing: true } },
    ],
    forms: [{ identity: "form|id=main", valid: false }],
  });
  const result = compareControlledAdvanceSnapshots({
    before,
    after,
    attemptObserved: true,
    networkEvents: [],
    subjectIdentities: ["input|name=document"],
    advanceActionIdentity: "button|submit",
  });
  assert.equal(result.otherInvalidRequiredControls, 1);
  assert.equal(result.advanceCausality, "ambiguous");
  assert.equal(result.blockedObserved, false);
});

test("rerendered subject is re-resolved by structural runtime identity", () => {
  const subjectIdentity = buildRuntimeControlIdentity({ tagName: "input", inputType: "text", name: "document", id: "el-1" });
  assert.ok(subjectIdentity);
  const before = snapshot({
    controls: [
      { ...snapshot().controls[0], identity: "input|id=el-1|name=document|type=text", id: "el-1", name: "document", inputType: "text" },
      { ...control(), identity: "button|id=advance|type=submit" },
    ],
  });
  const after = snapshot({
    controls: [
      { ...before.controls[0], identity: "input|id=el-2|name=document|type=text", id: "el-2", ariaInvalid: "true", validity: { ...before.controls[0].validity!, valid: false, patternMismatch: true } },
      { ...before.controls[1], disabled: true },
    ],
    forms: [{ identity: "form|id=main", valid: false }],
  });
  const result = compareControlledAdvanceSnapshots({
    before,
    after,
    attemptObserved: true,
    networkEvents: [],
    subjectControlIdentities: [subjectIdentity],
    advanceActionIdentity: "button|id=advance|type=submit",
  });
  assert.equal(result.subjectFound, true);
  assert.equal(result.subjectValidationMutation, true);
  assert.equal(result.advanceCausality, "causal");
});

test("no subject validation after an observed trigger is reported as assertion-13 defect evidence", () => {
  const before = { ...snapshot(), controls: [...snapshot().controls, control()] };
  const after = { ...snapshot(), controls: [...snapshot().controls, control({ disabled: true })] };
  const result = compareControlledAdvanceSnapshots({
    before,
    after,
    attemptObserved: false,
    networkEvents: [],
    subjectIdentities: ["input|name=document"],
    subjectInputApplied: true,
    advanceActionIdentity: "button|submit",
    triggerObservation: { before, after },
  });
  assert.equal(result.functionalDefectAssertion13, true);
  assert.equal(result.validationObserved, false);
  assert.equal(result.blockedObserved, false);
});

test("negative polarity is preserved for the transition intent oracle", () => {
  const oracles = buildControlledAdvanceProbeOracles({
    result: { intent: ["validation_present", "transition_blocked"], candidateFound: true, candidateEnabled: true, attemptPossible: true, resolutionState: "found_enabled", subjectFound: true, subjectValidationMutation: true, subjectInputApplied: true, advanceCausality: "causal", otherInvalidRequiredControls: 0, otherEmptyRequiredControls: 0, functionalDefectAssertion13: false, attemptObserved: true, beforeCaptured: true, afterCaptured: true, networkEvents: [], validationMutation: true, transitionOccurred: false, blockedObserved: true, validationObserved: true, evidence: [] },
    assertions: [{ index: 14, requirement: "blocked", requirementRefs: ["REQ-14"], intent: "transition_blocked", polarity: "negative" }],
  });
  assert.equal(oracles.find((oracle) => oracle.id.includes("blocked"))?.polarity, "negative");
});

test("probe does not invent polarity when canonical authority is unresolved", () => {
  const oracles = buildControlledAdvanceProbeOracles({
    result: { intent: ["transition_blocked"], candidateFound: true, candidateEnabled: false, attemptPossible: false, resolutionState: "found_disabled", subjectFound: true, subjectValidationMutation: true, subjectInputApplied: true, advanceCausality: "causal", otherInvalidRequiredControls: 0, otherEmptyRequiredControls: 0, functionalDefectAssertion13: false, attemptObserved: false, beforeCaptured: true, afterCaptured: true, networkEvents: [], validationMutation: true, transitionOccurred: false, blockedObserved: false, validationObserved: true, evidence: [] },
    assertions: [{ index: 14, requirement: "blocked", requirementRefs: ["REQ-14"], intent: "transition_blocked" }],
  });
  assert.equal(oracles[0]?.polarity, undefined);
});

test("structured probe remains project agnostic", () => {
  assert.equal(resolveAdvanceCandidate([control({ identity: "synthetic-project-submit" })])?.identity, "synthetic-project-submit");
});
