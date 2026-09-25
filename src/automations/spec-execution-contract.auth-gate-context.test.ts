import assert from "node:assert/strict";
import test from "node:test";
import { resolveAuthGateFillScenarioStepIndices, type ScenarioStepLike, type SpecExecutionContractAuth } from "./spec-execution-contract";

/**
 * FIRST_LOSS (jobId df8f6c09-c99c-40a1-820b-edcc203143ae): the promoted runtime's contextual guard
 * blocked the FIRST credential fill on the login/auth-gate screen with
 * `wrong_screen_before_contextual_action`. The contract DOES observe the gate
 * (`auth.gateDetected`), and its credential fills own explicit STRUCTURED auth authority:
 *   (a) the contract's per-step auth aggregate, or
 *   (b) the step's data-key credential ROLE (CORE `detectCredentialRole`).
 * Auth ownership is NEVER inferred from step order/position or field text -- a Recording whose
 * login surface also carries a business field is only marked for the steps that own that
 * structured authority, and everything else fails closed.
 */

const RECORDING_LIKE_STEPS: ScenarioStepLike[] = [
  { index: 1, action: "fill", recordingActionType: "fill" },
  { index: 2, action: "fill", recordingActionType: "fill" },
  { index: 3, action: "press", recordingActionType: "press" },
  { index: 4, action: "click", recordingActionType: "click" },
  { index: 13, action: "fill", recordingActionType: "fill" },
];

const CREDENTIAL_PLAN_STEPS = [
  { index: 1, valueKey: "usuario" },
  { index: 2, valueKey: "contrasena" },
  { index: 4, valueKey: "" },
  { index: 13, valueKey: "monto" },
];

test("1/structuredCredentialAuthority. only the steps owning a structured credential ROLE are marked", () => {
  const auth: SpecExecutionContractAuth = { gateDetected: true, required: false, stage: "identification_input" };
  const set = resolveAuthGateFillScenarioStepIndices(RECORDING_LIKE_STEPS, auth, CREDENTIAL_PLAN_STEPS);
  assert.deepEqual([...set].sort((a, b) => a - b), [1, 2], "the credential-role fills are auth-gate fields");
  assert.equal(set.has(3), false, "a non-fill step is never marked");
});

test("2/businessFill. a business fill (no credential role) is never an auth-gate credential field", () => {
  const auth: SpecExecutionContractAuth = { gateDetected: true, required: false };
  const set = resolveAuthGateFillScenarioStepIndices(RECORDING_LIKE_STEPS, auth, CREDENTIAL_PLAN_STEPS);
  assert.equal(set.has(13), false, "step13 carries a business data key, not a credential role");
});

test("3/partialAuthority. only the fills covered by auth authority are marked, siblings are not", () => {
  const auth: SpecExecutionContractAuth = { gateDetected: true, required: false };
  const steps: ScenarioStepLike[] = [
    { index: 1, action: "fill", recordingActionType: "fill" },
    { index: 2, action: "fill", recordingActionType: "fill" },
    { index: 3, action: "fill", recordingActionType: "fill" },
  ];
  const planSteps = [
    { index: 1, valueKey: "usuario" },
    { index: 2, valueKey: "sucursal" },
    { index: 3, valueKey: "contrasena" },
  ];
  const set = resolveAuthGateFillScenarioStepIndices(steps, auth, planSteps);
  assert.deepEqual([...set].sort((a, b) => a - b), [1, 3]);
  assert.equal(set.has(2), false, "a sibling fill without credential authority stays unmarked");
});

test("4/noAuthAuthority. a leading fill before the first click gains nothing without structured authority", () => {
  const auth: SpecExecutionContractAuth = { gateDetected: true, required: false };
  const steps: ScenarioStepLike[] = [
    { index: 1, action: "fill", recordingActionType: "fill" },
    { index: 2, action: "click", recordingActionType: "click" },
  ];
  const planSteps = [{ index: 1, valueKey: "monto" }];
  assert.equal(resolveAuthGateFillScenarioStepIndices(steps, auth, planSteps).size, 0, "position alone never grants auth ownership");
});

test("5/reorderedAuthSteps. structured authority is order-independent", () => {
  const auth: SpecExecutionContractAuth = { gateDetected: true, required: false };
  const reordered: ScenarioStepLike[] = [
    { index: 3, action: "fill", recordingActionType: "fill" },
    { index: 1, action: "fill", recordingActionType: "fill" },
    { index: 2, action: "fill", recordingActionType: "fill" },
  ];
  const planSteps = [
    { index: 1, valueKey: "usuario" },
    { index: 2, valueKey: "sucursal" },
    { index: 3, valueKey: "contrasena" },
  ];
  assert.deepEqual([...resolveAuthGateFillScenarioStepIndices(reordered, auth, planSteps)].sort((a, b) => a - b), [1, 3]);
});

test("6/missingAuthorityFailsClosed. no aggregate and no credential role means no auth ownership", () => {
  const auth: SpecExecutionContractAuth = { gateDetected: true, required: false };
  assert.equal(resolveAuthGateFillScenarioStepIndices(RECORDING_LIKE_STEPS, auth).size, 0, "no valueKey/plan valueKey -> fail closed");
  assert.equal(resolveAuthGateFillScenarioStepIndices(RECORDING_LIKE_STEPS, auth, CREDENTIAL_PLAN_STEPS.filter((s) => s.valueKey === "monto")).size, 0);
});

test("7/gateNotDetected. no gate observation means no auth-gate credential authority at all", () => {
  const auth: SpecExecutionContractAuth = { gateDetected: false, required: false };
  assert.equal(resolveAuthGateFillScenarioStepIndices(RECORDING_LIKE_STEPS, auth, CREDENTIAL_PLAN_STEPS).size, 0);
  assert.equal(resolveAuthGateFillScenarioStepIndices(RECORDING_LIKE_STEPS, undefined, CREDENTIAL_PLAN_STEPS).size, 0);
});

test("8/aggregatePreferred. an explicit per-step auth aggregate is used verbatim when present", () => {
  const auth: SpecExecutionContractAuth = {
    gateDetected: true,
    required: true,
    aggregate: { kind: "auth_flow", helper: "ensureAuthenticated", bindingId: "auth-flow-aggregate", coveredScenarioStepIndices: [5, 7] },
  };
  const steps: ScenarioStepLike[] = [
    { index: 5, action: "fill", recordingActionType: "fill" },
    { index: 6, action: "click", recordingActionType: "click" },
    { index: 7, action: "fill", recordingActionType: "fill" },
    { index: 8, action: "fill", recordingActionType: "fill" },
  ];
  assert.deepEqual([...resolveAuthGateFillScenarioStepIndices(steps, auth)].sort((a, b) => a - b), [5, 7]);
});
