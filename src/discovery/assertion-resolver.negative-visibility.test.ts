import assert from "node:assert/strict";
import test from "node:test";
import { classifyNegativeVisibility, resolveAssertionTargets, type AssertionTargetInput, type NegativeVisibilityEvidence } from "./assertion-resolver";
import type { PageSnapshot } from "../types/page-snapshot.types";

const snapshot = (elements: Array<Record<string, unknown>>): PageSnapshot => ({
  version: "1.0",
  url: "https://example.test/login",
  title: "t",
  capturedAt: "now",
  elements: elements.map((el, i) => ({ id: `e${i}`, visible: true, candidateLocators: [], dataHints: [], ...el })) as any,
  summary: { totalElements: elements.length, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
});

const FORBIDDEN = "comprobante de transacción exitosa";
const negativeInput = (overrides: Partial<AssertionTargetInput> = {}): AssertionTargetInput => ({
  index: 4,
  action: `Validar que no se muestre el ${FORBIDDEN}`,
  target: FORBIDDEN,
  source: "action",
  canonicalAssertion: { intent: "state_assertion", polarity: "negative" } as any,
  ...overrides,
});

const loginPage = [
  { role: "alert", type: "text", text: "Credenciales inválidas" },
  { role: "button", type: "button", text: "Ingresar" },
];
const stable: NegativeVisibilityEvidence = { snapshotStable: true };
const run = (elements: Array<Record<string, unknown>>, input = negativeInput(), negativeVisibility?: NegativeVisibilityEvidence) =>
  resolveAssertionTargets(snapshot(elements), [input], { negativeVisibility })[0];

test("explicit negative absent from a stable nonblank snapshot passes", () => {
  const result = run(loginPage, negativeInput(), stable);
  assert.equal(result.status, "passed");
  assert.equal(result.reason, "negative_visibility_absent_stable_snapshot");
  assert.equal(result.matchedText, undefined);
});

test("explicit negative whose target is present fails and never reports a matched text", () => {
  const result = run([...loginPage, { role: "heading", type: "heading", text: "Comprobante de transacción exitosa" }], negativeInput(), stable);
  assert.equal(result.status, "failed");
  assert.equal(result.reason, "negative_visibility_target_present");
  assert.equal(result.matchedText, undefined);
});

test("hidden forbidden element does not count as present", () => {
  const result = run([...loginPage, { role: "heading", text: FORBIDDEN, visible: false }], negativeInput(), stable);
  assert.equal(result.status, "passed");
});

test("blank snapshot blocks", () => {
  const result = run([{ role: "generic", text: "  " }], negativeInput(), stable);
  assert.equal(result.status, "needs_assertion_resolution");
  assert.equal(result.reason, "negative_visibility_blank_snapshot");
});

test("unstable or unproven snapshot blocks", () => {
  assert.equal(run(loginPage, negativeInput(), { snapshotStable: false }).reason, "negative_visibility_snapshot_unstable");
  const noEvidence = run(loginPage, negativeInput());
  assert.equal(noEvidence.status, "needs_assertion_resolution");
  assert.equal(noEvidence.reason, "negative_visibility_snapshot_unstable");
});

test("no explicit negative polarity is not an absence pass", () => {
  const positive = negativeInput({ action: `Validar que se muestre el ${FORBIDDEN}`, canonicalAssertion: { intent: "state_assertion", polarity: "positive" } as any });
  assert.equal(classifyNegativeVisibility(positive), undefined);
  const result = run(loginPage, positive, stable);
  assert.notEqual(result.status, "passed");
  const unmarked = negativeInput({ action: `Validar el ${FORBIDDEN}`, canonicalAssertion: undefined });
  assert.equal(classifyNegativeVisibility(unmarked), undefined);
  assert.notEqual(run(loginPage, unmarked, stable).status, "passed");
  const noMatchSnapshot = snapshot([{ role: "heading", text: "t" }, ...loginPage]);
  const positiveTarget = resolveAssertionTargets(noMatchSnapshot, [{
    ...unmarked,
    action: `Validar el ${FORBIDDEN}`,
    target: FORBIDDEN,
  }], { negativeVisibility: stable })[0];
  assert.notEqual(positiveTarget.status, "passed", "a page title must not satisfy an absent validation target");
});

test("unambiguous action language is explicit polarity without canonical metadata", () => {
  const input = negativeInput({ canonicalAssertion: undefined, target: `Validar que no se muestre el ${FORBIDDEN}` });
  assert.match(classifyNegativeVisibility(input)?.target ?? "", /^comprobante de transacci.n exitosa$/);
  assert.equal(run(loginPage, input, stable).status, "passed");
});

test("blocked-transition intent is not a visibility assertion", () => {
  const input = negativeInput({ canonicalAssertion: { intent: "transition_blocked", polarity: "negative" } as any });
  assert.equal(classifyNegativeVisibility(input), undefined);
});

test("terminal auth rejection plus fresh absence passes without requiring a stable spinner state or UI banner", () => {
  const boundary = { classification: "AUTH_REJECTED", authHttpStatus: 403, errorSurfaceObserved: true, businessSurfaceReached: false, positiveFeedbackObserved: false };
  assert.equal(run(loginPage, negativeInput(), { snapshotStable: true, authRejection: boundary }).status, "passed");
  assert.equal(run(loginPage, negativeInput(), { snapshotStable: true, authRejection: { ...boundary, errorSurfaceObserved: false } }).reason, "negative_visibility_auth_rejection_boundary_unmet");
  assert.equal(run(loginPage, negativeInput(), { snapshotStable: true, authRejection: { ...boundary, businessSurfaceReached: true } }).status, "needs_assertion_resolution");
  const terminal = run(loginPage, negativeInput(), { snapshotStable: false, authRejection: boundary });
  assert.equal(terminal.status, "passed", "a fresh nonblank snapshot plus a terminal auth rejection remains valid while a stale spinner is mounted");
  assert.equal(terminal.reason, "negative_visibility_absent_terminal_auth_rejection");
  assert.equal(run(loginPage, negativeInput(), { snapshotStable: false, authRejection: { ...boundary, authHttpStatus: 503 } }).status, "needs_assertion_resolution");
});

test("auth rejection absence does not require any visible credential banner", () => {
  const result = run([{ role: "button", type: "button", text: "Ingresar" }], negativeInput(), {
    snapshotStable: true,
    authRejection: { classification: "AUTH_REJECTED", authHttpStatus: 403, errorSurfaceObserved: true, businessSurfaceReached: false },
  });
  assert.equal(result.status, "passed");
  assert.equal(result.reason, "negative_visibility_absent_terminal_auth_rejection");
});
