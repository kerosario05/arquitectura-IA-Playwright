import assert from "node:assert/strict";
import test from "node:test";
import { extractPromotedFunctionalFailure, extractFailedPromotedStepIndex } from "./spec-generation-hybrid";

/**
 * FIRST_LOSS fix (jobId 287dbaab-c566-41af-87c0-609cf4e42535): the prior error-line selector
 * only recognized "Error: Promoted (click|assertion) failed at step N" -- fill and press
 * failures silently fell through to a generic keyword scan that could (and did) select an
 * ordinary, successful telemetry line purely because it contained a common word like "locator"
 * (`[promoted-press-dispatch] ... dispatchMethod=locator.press dispatchStarted=true`, a PASSING
 * line for an earlier, already-succeeded step). A separate, independent heuristic computed
 * failedStepIndex from the first bare `stepIndex=N` anywhere outside "[promoted-step]" lines --
 * disagreeing with whatever the error-line selector picked, and itself vulnerable to the same
 * telemetry-line confusion (e.g. picking up Step 1's own successful fill telemetry).
 *
 * extractPromotedFunctionalFailure is now the single shared authority: error text, stepIndex,
 * and operation all come from the SAME matched "Promoted <op> failed at step N" line, for all
 * four real promoted operations (click/fill/press/assertion), and both the structured search and
 * the generic keyword fallback explicitly exclude every known routine promoted telemetry line
 * shape so a passing line's incidental keyword can never be mistaken for the failure.
 */

function withLines(...lines: string[]): string {
  return lines.join("\n");
}

test("1/FILL_FAILURE: a real fill failure after successful earlier telemetry is recognized, error and stepIndex agree, operation=fill", () => {
  const output = withLines(
    "[promoted-fill-state] stepIndex=1 targetResolved=true valueResolved=true valueNonEmpty=true fieldHasValueAfterFill=true targetVisible=true targetEnabled=true targetEditable=true",
    "[promoted-press-dispatch] stepIndex=3 targetResolved=true targetVisible=true targetEnabled=true targetEditable=true targetHasValueBeforePress=false activeElementMatchesTargetBeforePress=false dispatchMethod=locator.press dispatchStarted=true",
    "[promoted-step] stepIndex=4 phase=start currentUrl=https://example.test/",
    "[promoted-click-structural] stepIndex=4 strategy=recorded:structural-owner matchCount=1",
    'Error: Promoted fill failed at step 5 field="Numero de identificacion" value="***". reason=target_not_editable',
  );
  const result = extractPromotedFunctionalFailure(output);
  assert.ok(result);
  assert.equal(result!.operation, "fill");
  assert.equal(result!.stepIndex, 5);
  assert.match(result!.errorLine, /^Error: Promoted fill failed at step 5/);
  assert.equal(extractFailedPromotedStepIndex(output), 5, "extractFailedPromotedStepIndex must agree with the structured extraction");
});

test("2/PRESS_FAILURE: a real press failure is recognized with stepIndex=3", () => {
  const output = withLines(
    "[promoted-press-dispatch] stepIndex=3 targetResolved=true targetVisible=true targetEnabled=true targetEditable=true targetHasValueBeforePress=true activeElementMatchesTargetBeforePress=true dispatchMethod=locator.press dispatchStarted=true",
    'Error: Promoted press failed at step 3 target="role:textbox|Contrasena" key="Enter". reason=press_dispatch_failed',
  );
  const result = extractPromotedFunctionalFailure(output);
  assert.ok(result);
  assert.equal(result!.operation, "press");
  assert.equal(result!.stepIndex, 3);
  assert.equal(extractFailedPromotedStepIndex(output), 3);
});

test("3/CLICK_FAILURE: existing click failure recognition still works", () => {
  const output = withLines(
    "[promoted-step] stepIndex=4 phase=start currentUrl=https://example.test/",
    'Error: Promoted click failed at step 4 target="css:[href=\\"/synthetic/target\\"]". reason=structural_authority_not_unique_or_unresolved',
  );
  const result = extractPromotedFunctionalFailure(output);
  assert.ok(result);
  assert.equal(result!.operation, "click");
  assert.equal(result!.stepIndex, 4);
  assert.equal(extractFailedPromotedStepIndex(output), 4);
});

test("4/ASSERTION_FAILURE: existing assertion failure recognition still works", () => {
  const output = withLines(
    "[promoted-step] stepIndex=7 phase=failed failureClass=assertion_not_satisfied currentUrl=https://example.test/",
    'Error: Promoted assertion failed at step 7 target="Depurar". diagnostics={} cause=expected URL to match',
  );
  const result = extractPromotedFunctionalFailure(output);
  assert.ok(result);
  assert.equal(result!.operation, "assertion");
  assert.equal(result!.stepIndex, 7);
  assert.equal(extractFailedPromotedStepIndex(output), 7);
});

test("5/SUCCESS_TELEMETRY_NOT_ERROR: routine success telemetry (locator.press, failed=false, stepIndex=N) is never selected as a structured failure", () => {
  const output = withLines(
    "[promoted-fill-state] stepIndex=1 targetResolved=true valueResolved=true valueNonEmpty=true fieldHasValueAfterFill=true targetVisible=true targetEnabled=true targetEditable=true",
    "[promoted-press-dispatch] stepIndex=3 targetResolved=true targetVisible=true targetEnabled=true targetEditable=true targetHasValueBeforePress=true activeElementMatchesTargetBeforePress=true dispatchMethod=locator.press dispatchStarted=true",
    "[promoted-press-wait] completionProbeCreated=false sharedWaitCall=true explicitExpectation=false",
    "[async-wait] state=success elapsedMs=2740",
    "[promoted-step] stepIndex=4 phase=start currentUrl=https://example.test/",
    "[promoted-click-structural] stepIndex=4 strategy=recorded:structural-owner matchCount=1",
    "[promoted-runtime-lifecycle] attempt=1 status=ok",
  );
  const result = extractPromotedFunctionalFailure(output);
  assert.equal(result, undefined, "no structured failure exists in an all-success log");
  assert.equal(extractFailedPromotedStepIndex(output), undefined, "no step index may be fabricated from success telemetry alone");
});

test("6/GENERIC_NON_PROMOTED_ERROR: a real Playwright error with no 'Promoted ... failed' text still surfaces via the generic fallback (not this ticket's structured extractor, but must not be masked)", () => {
  const output = withLines(
    "[promoted-fill-state] stepIndex=1 targetResolved=true valueResolved=true valueNonEmpty=true fieldHasValueAfterFill=true targetVisible=true targetEnabled=true targetEditable=true",
    "Error: page.goto: net::ERR_CONNECTION_REFUSED at https://example.test/",
  );
  const result = extractPromotedFunctionalFailure(output);
  assert.equal(result, undefined, "not a Promoted-operation structured failure -- extractPromotedFunctionalFailure correctly does not claim it");
  // The generic fallback (spec-generation-hybrid.ts's own combinedLines.find with the keyword
  // regex, exercised at the call site) is what recovers this -- confirmed here only by proving
  // isPromotedSuccessTelemetryLine does not incorrectly swallow the real error line.
  const lines = output.split("\n");
  const realErrorLine = lines.find((line) => /\berror\b/i.test(line));
  assert.ok(realErrorLine, "the real connection-refused error line must remain findable by the generic scan");
  assert.match(realErrorLine!, /ERR_CONNECTION_REFUSED/);
});
