import assert from "node:assert/strict";
import test from "node:test";
import { resolveCompoundRejectionOracle } from "./case-discovery-workflow";
import { resolveAssertionTargets } from "./assertion-resolver";
import type { DiscoveryStepResult } from "../types/discovery.types";

const LINE = "Se muestra el mensaje de credenciales inválidas y no se muestra el comprobante de transferencia exitosa";

const scenarioSteps = [
  { index: 3, action: 'Validar que se muestre el mensaje de credenciales inválidas', polarity: "positive" as const },
  { index: 4, action: 'Validar que no se muestre el comprobante de transferencia exitosa', polarity: "negative" as const },
];

const rejectedOutcome = (overrides: { businessSurfaceReached?: boolean } = {}) => ({
  classification: "AUTH_REJECTED" as const,
  authRequestObserved: true,
  authResponseObserved: true,
  authHttpStatus: 403,
  redirectChain: [],
  postLoginUrlClass: "auth_surface" as const,
  postLoginSurface: "/login",
  loadingObserved: false,
  errorSurfaceObserved: true,
  businessSurfaceReached: false,
  ...overrides,
});

const evidenceSteps = (): DiscoveryStepResult[] => [
  { index: 2, action: 'Presionar "Ingresar"', status: "found", authenticationOutcome: rejectedOutcome() },
  {
    index: 3,
    action: scenarioSteps[0].action,
    status: "found",
    assertionStatus: "passed",
    canonicalAssertion: { intent: "validation_present", polarity: "positive" } as any,
  },
  { index: 4, action: scenarioSteps[1].action, status: "found", assertionStatus: "passed" },
];

const resolve = (steps: DiscoveryStepResult[], line = LINE) =>
  resolveCompoundRejectionOracle({ line, scenarioSteps, steps });

test("non-compound lines are not handled", () => {
  assert.equal(resolve(evidenceSteps(), "Se muestra el mensaje de credenciales inválidas"), undefined);
});

test("compound resolves when rejection feedback and negative assertion all bind", () => {
  assert.equal(resolve(evidenceSteps())?.backed, true);
});

test("HTTP rejection alone stays blocked", () => {
  const steps = evidenceSteps().filter((step) => step.index === 2);
  assert.equal(resolve(steps)?.backed, false);
});

test("terminal auth rejection can bind the positive rejection clause without a UI banner", () => {
  const steps = evidenceSteps().filter((step) => step.index !== 3);
  const result = resolve(steps);
  assert.equal(result?.backed, true);
  assert.equal(result?.evidence.includes("positive_rejection_clause_bound_to_auth_submission_outcome:true"), true);
});

test("generic positive clause cannot bind to auth rejection without rejection semantics", () => {
  assert.equal(resolve(evidenceSteps(), "El mensaje aparece y no se muestra el comprobante de transferencia exitosa")?.backed, false);
});

test("missing negative assertion stays blocked", () => {
  const steps = evidenceSteps().filter((step) => step.index !== 4);
  assert.equal(resolve(steps)?.backed, false);
});

test("failed negative assertion (success receipt present) stays blocked", () => {
  const steps = evidenceSteps().map((step) =>
    step.index === 4 ? { ...step, status: "not_found" as const, assertionStatus: undefined } : step);
  assert.equal(resolve(steps)?.backed, false);
});

test("bare found action status without a passing assertion status stays blocked", () => {
  const steps = evidenceSteps().map((step) =>
    step.index === 4 ? { ...step, status: "found" as const, assertionStatus: "needs_assertion_resolution" as const } : step);
  assert.equal(resolve(steps)?.backed, false);
  const feedbackOnlyFound = evidenceSteps().map((step) =>
    step.index === 3 ? { ...step, assertionStatus: undefined as undefined } : step);
  assert.equal(resolve(feedbackOnlyFound)?.backed, true, "the verified terminal auth rejection is independent of a bare feedback step");
});

test("negative step backed by the runtime resolver's absence verdict, not a hand-marked pass", () => {
  const snapshot = {
    title: "Login", url: "https://app/login",
    summary: { totalElements: 2, buttons: 1, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    elements: [
      { role: "alert", text: "Credenciales inválidas", visible: true },
      { role: "button", text: "Ingresar", visible: true },
    ],
  } as any;
  const [verdict] = resolveAssertionTargets(snapshot, [{
    index: 4,
    action: scenarioSteps[1].action,
    target: "comprobante de transferencia exitosa",
    source: "action",
    canonicalAssertion: { intent: "state_assertion", polarity: "negative" } as any,
  }], { negativeVisibility: { snapshotStable: false, authRejection: {
    classification: "AUTH_REJECTED",
    authHttpStatus: 403,
    errorSurfaceObserved: true,
    businessSurfaceReached: false,
    positiveFeedbackObserved: true,
  } } });
  assert.equal(verdict.status, "passed");
  assert.equal(verdict.reason, "negative_visibility_absent_terminal_auth_rejection");
  const steps = evidenceSteps().map((step) =>
    step.index === 4 ? { ...step, assertionStatus: verdict.status } : step);
  assert.equal(resolve(steps)?.backed, true);
});

test("business surface reached invalidates the rejection", () => {
  const steps = evidenceSteps().map((step) =>
    step.index === 2 ? { ...step, authenticationOutcome: rejectedOutcome({ businessSurfaceReached: true }) } : step);
  assert.equal(resolve(steps)?.backed, false);
});

test("unrelated extra clause fails closed", () => {
  assert.equal(resolve(evidenceSteps(), `${LINE} y el saldo disponible se actualiza`)?.backed, false);
});
