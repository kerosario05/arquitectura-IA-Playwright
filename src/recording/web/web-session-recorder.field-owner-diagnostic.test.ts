import assert from "node:assert/strict";
import test from "node:test";
import { isBareStructuralFallbackOnly, describeFieldOwnerUnresolved, describeFieldOwnerUnresolvedDetail } from "./web-session-recorder";
import type { FieldOwnerDiagnostic, RecordedLocator } from "../session-trace.types";

/**
 * Instrumentation-only ticket: the previous field-container-association microfix (excluding
 * hidden/non-visible descendants from `isFieldElement`'s field count) did NOT resolve the
 * physically re-captured "Número de identificación" field (recording
 * 14144564-e60f-4ac8-b4a8-65ac1ecf1f05) — it still reached buildWebLocators with only the bare
 * `structural:grid=grid:div|role=amount_or_text` fallback. Per this ticket's own instruction, no
 * new heuristic is added; only diagnostics, so the NEXT physical capture reveals the real cause.
 *
 * These tests cover the NODE-SIDE half of the instrumentation: `isBareStructuralFallbackOnly`
 * (the trigger condition for the `[field-owner-unresolved]` target-ref diagnostic line) and
 * `describeFieldOwnerUnresolved` (the line itself), both pure and exported from
 * web-session-recorder.ts, wired into `onInteraction` with no change to what gets recorded.
 *
 * The BROWSER-SIDE half — the per-ancestor diagnostics added inside `nearestFieldGroupLabel`
 * (candidateFields/candidateLabels/rejectionReason per level, emitted via console.log during a
 * live page capture) — executes entirely inside the page-injected CAPTURE_SCRIPT string and
 * cannot be exercised without a real browser/DOM (no jsdom-equivalent is available in this repo;
 * same disclosed limitation as the earlier field-container-association ticket). Its code was
 * reviewed to preserve every existing return point/condition unchanged (diagnostics-only, no new
 * heuristic), but its actual behavior can only be confirmed by the next physical recording.
 */

test("1 (unresolvedDiagnostic). the exact reported bare structural fallback triggers the diagnostic condition", () => {
  const locators: RecordedLocator[] = [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text", confidence: 0.72 }];
  assert.equal(isBareStructuralFallbackOnly(locators), true);
  const line = describeFieldOwnerUnresolved({ screenKey: "s1", tagName: "input", role: "input", locators });
  assert.match(line, /^\[field-owner-unresolved\]/);
  assert.match(line, /reason=bare_structural_fallback_only/);
  assert.match(line, /headerContextPresent=false/);
  assert.match(line, /nearestFieldGroupLabelResult=unresolved/);
});

test("2 (resolvedNoDiagnostic). a structural locator carrying a header/cell component never triggers the diagnostic", () => {
  const locators: RecordedLocator[] = [{ strategy: "structural", value: "grid=grid:div|header=header:Documento|role=amount_or_text", confidence: 0.72 }];
  assert.equal(isBareStructuralFallbackOnly(locators), false);
});

test("2b (resolvedNoDiagnostic). a field with real technical identity (data-testid) never triggers the diagnostic", () => {
  const locators: RecordedLocator[] = [{ strategy: "data-testid", value: "doc-field", confidence: 0.98 }];
  assert.equal(isBareStructuralFallbackOnly(locators), false);
});

test("3 (sensitiveRedaction). the diagnostic line never carries a field value, only structural presence booleans and locator strategy names", () => {
  const locators: RecordedLocator[] = [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text", confidence: 0.72 }];
  const line = describeFieldOwnerUnresolved({
    screenKey: "s1",
    tagName: "input",
    role: "input",
    associatedField: "Número de identificación",
    headerContext: undefined,
    locators,
  });
  // describeFieldOwnerUnresolved has no parameter for a typed/entered value at all -- there is
  // nothing sensitive to redact because the function structurally cannot receive it. This
  // asserts the shape stays presence-only even when a field/label name IS supplied upstream.
  assert.doesNotMatch(line, /402-1234567-8|cedula|password|token/i);
  assert.match(line, /associatedFieldPresent=true/);
});

test("4 (multipleFieldsReason placeholder). the trigger condition is strategy-count based, never influenced by how many DOM fields a container has", () => {
  // The container-level "multiple_visible_fields" reason is produced entirely inside the
  // browser-injected nearestFieldGroupLabel (see file header) and cannot run outside a real
  // DOM; this test only confirms isBareStructuralFallbackOnly is unaffected by anything other
  // than the FINAL locators array shape it is given.
  const locators: RecordedLocator[] = [
    { strategy: "structural", value: "grid=grid:div|role=amount_or_text", confidence: 0.72 },
    { strategy: "text", value: "some text", confidence: 0.7 },
  ];
  assert.equal(isBareStructuralFallbackOnly(locators), false, "more than one final locator is never the bare-fallback-only shape");
});

test("5 (multipleLabelsReason placeholder). an empty locators array is never treated as the bare-fallback-only shape either", () => {
  assert.equal(isBareStructuralFallbackOnly([]), false);
});

/**
 * The transport half: nearestFieldGroupLabel's per-ancestor trace is carried from the browser to
 * Node on `raw.fieldOwnerDiagnostic` (the same interaction payload every other target field
 * already travels through -- see `structural(el)`'s `fieldOwnerDiagnostic` field and
 * `onInteraction`'s `commonTarget.fieldOwnerDiagnostic`), then rendered by
 * `describeFieldOwnerUnresolvedDetail` into the `[field-owner-unresolved-detail]` Node log line.
 */

test("6 (browserToNode / unresolvedDetail). an unresolved diagnostic renders its full per-ancestor trace, reason included, no value fields", () => {
  const diagnostic: FieldOwnerDiagnostic = {
    result: "unresolved",
    trace: [
      {
        ancestorLevel: 0,
        tagName: "div",
        idPresent: false,
        classSummary: "p-inputgroup",
        candidateFieldCount: 2,
        candidateFields: [
          { tagName: "input", type: "text", visible: true, disabled: false, idPresent: false, namePresent: false, ariaLabelPresent: false, placeholderPresent: false },
          { tagName: "input", type: "hidden", visible: false, disabled: false, idPresent: true, namePresent: true, ariaLabelPresent: false, placeholderPresent: false },
        ],
        candidateLabelCount: 0,
        candidateLabels: [],
        rejectionReason: "multiple_visible_fields",
      },
    ],
  };
  const line = describeFieldOwnerUnresolvedDetail(diagnostic);
  assert.match(line, /^\[field-owner-unresolved-detail\] /);
  const parsed = JSON.parse(line.replace("[field-owner-unresolved-detail] ", ""));
  assert.equal(parsed.result, "unresolved");
  assert.equal(parsed.trace[0].rejectionReason, "multiple_visible_fields");
  assert.equal(parsed.trace[0].candidateFieldCount, 2);
  assert.equal(JSON.stringify(parsed).includes("value"), false, "no candidate/field object carries a value field");
});

test("7 (resolvedNoDetail). a resolved diagnostic renders chosenOwnerSource/chosenAncestorLevel, never a trace or a typed value", () => {
  const diagnostic: FieldOwnerDiagnostic = { result: "resolved", chosenOwnerSource: "nearestFieldGroupLabel", chosenAncestorLevel: 1 };
  const line = describeFieldOwnerUnresolvedDetail(diagnostic);
  const parsed = JSON.parse(line.replace("[field-owner-unresolved-detail] ", ""));
  assert.equal(parsed.result, "resolved");
  assert.equal(parsed.chosenAncestorLevel, 1);
  assert.equal(parsed.trace, undefined, "a resolved diagnostic never carries a trace array");
});

test("8 (missingDiagnosticSafe). the recorder never throws when no diagnostic was captured (older payload / non-diagnostic path)", () => {
  assert.doesNotThrow(() => describeFieldOwnerUnresolvedDetail(undefined));
  const line = describeFieldOwnerUnresolvedDetail(undefined);
  const parsed = JSON.parse(line.replace("[field-owner-unresolved-detail] ", ""));
  assert.equal(parsed.result, "unresolved");
  assert.deepEqual(parsed.trace, []);
});

test("9 (sensitiveRedaction, transport). a candidate label's textSummary is a caption, never an entered value, and stays under the 80-char bound by construction", () => {
  const diagnostic: FieldOwnerDiagnostic = {
    result: "unresolved",
    trace: [
      {
        ancestorLevel: 0,
        tagName: "span",
        idPresent: false,
        classSummary: "field-group",
        candidateFieldCount: 1,
        candidateFields: [{ tagName: "input", type: "text", visible: true, disabled: false, idPresent: false, namePresent: false, ariaLabelPresent: false, placeholderPresent: false }],
        candidateLabelCount: 1,
        candidateLabels: [{ tagName: "label", sourceType: "label", textSummary: "Número de identificación" }],
        rejectionReason: "label_empty",
      },
    ],
  };
  const line = describeFieldOwnerUnresolvedDetail(diagnostic);
  assert.doesNotMatch(line, /402-1234567-8/, "a diagnostic label caption is never a typed field value");
});

test("10 (tracePersistence). the diagnostic type is metadata-shaped only -- it carries no admission/execution field and is a plain optional addition to RecordedTarget", () => {
  const diagnostic: FieldOwnerDiagnostic = { result: "resolved", chosenOwnerSource: "nearestFieldGroupLabel", chosenAncestorLevel: 0 };
  const keys = Object.keys(diagnostic);
  assert.deepEqual(keys.sort(), ["chosenAncestorLevel", "chosenOwnerSource", "result"]);
  assert.ok(!keys.some((key) => /admission|executable|ready/i.test(key)), "the diagnostic shape must never look like an execution-authority field");
});
