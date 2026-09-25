import assert from "node:assert/strict";
import test from "node:test";
import { diffAssertionObservation, diffStateCandidates, type AssertionObservationSnapshot } from "./assertion-observation";

/**
 * FIRST_LOSS (jobId 39b2b129-09c3-4d87-8cbd-d514ae92d6d4, step=7 target="4"): a same-surface tap was
 * dispatched (click_dispatch_end) and the app changed its functional state, but
 * `captureAssertionObservationSnapshot`/`diffAssertionObservation` reported NO mutation
 * (no `[dom-mutation-diagnostic]`, `changedPaths=[]`, post-action `signal=none`, stalled). The
 * affected state does NOT live in a `controls`-selected element (the physical surface reports
 * `Native input: false` and the tap buttons' own `value` never changes), so the existing model
 * cannot name it.
 *
 * These tests cover the DIAGNOSTIC-ONLY redacted state-candidate channel used to identify the exact
 * node kind/property on the next physical run. It must never carry a value and must never change the
 * existing control/validation diff behavior.
 */

type Candidate = NonNullable<AssertionObservationSnapshot["stateCandidates"]>[number];

function snapshot(overrides: Partial<AssertionObservationSnapshot> = {}): AssertionObservationSnapshot {
  return {
    urlPath: "/amount",
    controls: [{ identity: "button|role=button|type=button", tagName: "button", disabled: false, required: false, focused: false, valueFingerprint: "0:2166136261", validationNodeIds: [] }],
    validationNodes: [],
    forms: [],
    fingerprint: "synthetic",
    ...overrides,
  };
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    tag: "div",
    role: "textbox",
    contentEditable: false,
    propertyFingerprints: { textContent: "1:100" },
    ...overrides,
  };
}

test("1/stateMutationDetected. a changed structured property yields a named mutation", () => {
  const before = snapshot({ stateCandidates: [candidate()] });
  const after = snapshot({ stateCandidates: [candidate({ propertyFingerprints: { textContent: "2:200" } })] });
  const mutations = diffStateCandidates(before, after);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].tag, "div");
  assert.equal(mutations[0].role, "textbox");
  assert.deepEqual(mutations[0].changedProperties, ["textContent"]);
});

test("2/unchangedStateRejected. identical candidates produce no mutation", () => {
  const before = snapshot({ stateCandidates: [candidate()] });
  const after = snapshot({ stateCandidates: [candidate()] });
  assert.deepEqual(diffStateCandidates(before, after), []);
});

test("3/secretRedaction. neither the diff nor the snapshot fingerprint carries the real value", () => {
  const secret = "40229999999";
  const before = snapshot({ stateCandidates: [candidate({ propertyFingerprints: { textContent: "11:A" } })] });
  const after = snapshot({ stateCandidates: [candidate({ propertyFingerprints: { textContent: `12:${secret.length}` } })] });
  const mutations = diffStateCandidates(before, after);
  assert.equal(JSON.stringify(mutations).includes(secret), false);
  assert.equal(JSON.stringify(after).includes(secret), false);
});

test("4/unrelatedCandidateRejected. a changed candidate of a different node kind is not conflated", () => {
  const before = snapshot({ stateCandidates: [candidate({ tag: "span", role: undefined })] });
  const after = snapshot({ stateCandidates: [candidate({ tag: "div", role: "textbox", propertyFingerprints: { textContent: "2:200" } })] });
  const mutations = diffStateCandidates(before, after);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].fingerprintBefore, "", "the appeared node has no before fingerprint");
});

test("5/focusOnlyRejected. a focus-only identity change never produces a state mutation", () => {
  const before = snapshot({ focusedIdentity: "input|name=a", stateCandidates: [candidate()] });
  const after = snapshot({ focusedIdentity: "input|name=b", stateCandidates: [candidate()] });
  assert.deepEqual(diffStateCandidates(before, after), []);
});

test("6/stateCandidatesDoNotAffectControlsDiff. the diagnostic channel never changes completion behavior", () => {
  const before = snapshot({ stateCandidates: [candidate()] });
  const after = snapshot({ stateCandidates: [candidate({ propertyFingerprints: { textContent: "9:900" } })] });
  const diff = diffAssertionObservation(before, after);
  assert.equal(diff.changed, false, "the tracked control/validation/forms diff is untouched");
  assert.deepEqual(diff.changedPaths, []);
});

test("7/inputValueRegression. an input value change is still detected through the existing controls bucket", () => {
  const base = snapshot();
  const before = snapshot({ controls: [{ ...base.controls[0], valueFingerprint: "3:100" }] });
  const after = snapshot({ controls: [{ ...base.controls[0], valueFingerprint: "4:200" }] });
  const diff = diffAssertionObservation(before, after);
  assert.deepEqual(diff.changedPaths, ["controls"]);
});

test("8/modalControlRegression. a newly appeared control is still detected", () => {
  const before = snapshot();
  const after = snapshot({ controls: [...before.controls, { identity: "button|role=button|type=button|x", tagName: "button", disabled: false, required: false, focused: false, valueFingerprint: "0:2166136261", validationNodeIds: [] }] });
  assert.deepEqual(diffAssertionObservation(before, after).changedPaths, ["controls"]);
});

test("9/repeatedStateMutation. successive A->B->C transitions each report their own mutation", () => {
  const a = snapshot({ stateCandidates: [candidate({ propertyFingerprints: { textContent: "1:1" } })] });
  const b = snapshot({ stateCandidates: [candidate({ propertyFingerprints: { textContent: "1:2" } })] });
  const c = snapshot({ stateCandidates: [candidate({ propertyFingerprints: { textContent: "1:3" } })] });
  assert.deepEqual(diffStateCandidates(a, b)[0].changedProperties, ["textContent"]);
  assert.deepEqual(diffStateCandidates(b, c)[0].changedProperties, ["textContent"]);
  assert.deepEqual(diffStateCandidates(a, b)[0].fingerprintAfter, diffStateCandidates(b, c)[0].fingerprintBefore);
});

test("10/multipleChannelsNamed. an ARIA value channel and a text channel are each named by property", () => {
  const before = snapshot({ stateCandidates: [candidate({ propertyFingerprints: { ariaValueText: "3:aaa", textContent: "1:x" } })] });
  const after = snapshot({ stateCandidates: [candidate({ propertyFingerprints: { ariaValueText: "3:bbb", textContent: "1:x" } })] });
  assert.deepEqual(diffStateCandidates(before, after)[0].changedProperties, ["ariaValueText"]);
});
