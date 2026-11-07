import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.resolve(__dirname, "case-discovery.ts"), "utf8");
const workflowSource = fs.readFileSync(path.resolve(__dirname, "case-discovery-workflow.ts"), "utf8");
const promotionSource = fs.readFileSync(path.resolve(__dirname, "../automations/promote-plan.ts"), "utf8");

test("case discovery binds an observed created route only after adjacent route continuity and next-target visibility", () => {
  assert.match(source, /import \{[^}]*matchesObservedRecordedDestination[^}]*\} from "\.\/post-action-synchronization"/);
  assert.match(source, /matchesObservedRecordedDestination\(\{[\s\S]*?nextTargetVisible,[\s\S]*?expectedRouteAfter: recordedPostActionExpected,[\s\S]*?nextExpectedRouteBefore: nextActionTarget\?\.expectedRouteBefore/);
  assert.match(source, /observedRecordedDestinationUrl = page\.url\(\)/);
  assert.match(source, /observedRecordedDestinationUrl && page\.url\(\) === observedRecordedDestinationUrl/);
});

test("case discovery re-observes a late destination without re-dispatching a failed business click", () => {
  const handlingStart = source.indexOf("const rootRegressionDetected =");
  const lateObservation = source.indexOf("await postActionCompletionProbe().catch(() => ({ completed: false }));", handlingStart);
  const failureGate = source.indexOf('failedReason = "RECORDED_POSTCONDITION_NOT_REACHED";', lateObservation);
  const failureHandling = source.slice(handlingStart, failureGate);

  assert.ok(handlingStart >= 0, "expected recorded post-action failure handling");
  assert.ok(lateObservation > handlingStart, "expected a read-only late post-action probe");
  assert.ok(failureGate > lateObservation, "late observation must run before declaring the recorded route failed");
  assert.doesNotMatch(failureHandling, /clickResolvedTarget\(finalLocator/,
    "a click whose destination was not reached must not be dispatched again");
  assert.doesNotMatch(failureHandling, /POST_ACTION_CLICK_RETRY_LIMIT|retrying click attempt=/,
    "recorded business clicks must not be retried after dispatch");
  assert.match(failureHandling, /observedRecordedDestinationUrl/);
  assert.match(failureHandling, /postActionSyncSignal !== "application_error"/);
  assert.match(failureHandling, /stable: true/);
});

test("cleanup receives the stable initial app URL after navigation, not the pre-navigation blank page", () => {
  const initialGoto = source.indexOf("await page.goto(appBaseUrl");
  const readinessComplete = source.indexOf('console.log(`[initial-readiness] phase=complete ready=true');
  const callback = source.indexOf("options.onInitialNavigationCompleted?.(page.url())", readinessComplete);
  assert.ok(initialGoto >= 0 && initialGoto < readinessComplete, "expected initial app navigation before readiness");
  assert.ok(readinessComplete >= 0, "expected initial app readiness boundary");
  assert.ok(callback > readinessComplete, "initial URL must be sampled after the app reaches a stable page");

  assert.match(workflowSource, /onInitialNavigationCompleted:\s*\(url\)\s*=>\s*\{\s*discoveryInitialUrl\s*=\s*url;\s*\}/);
  assert.match(workflowSource, /beforeUrl:\s*discoveryInitialUrl\s*\?\?\s*""/);
  assert.doesNotMatch(workflowSource, /discoveryInitialUrl\s*=\s*page\.url\(\)/,
    "the cleanup baseline must not be read before runCaseDiscovery navigates to the app");
});

test("verified selection successor keeps its unique enabled owner as a non-dispatching continuation locator", () => {
  const acceptedSelection = source.indexOf("const verifiedContinuationAnchor = (verifiedBySuccessorControl ? successorOwnerAfter.locator : undefined)");
  const acceptedSelectionEnd = source.indexOf("// A custom selection popup can close", acceptedSelection);
  assert.ok(acceptedSelection >= 0, "expected a uniquely resolved recorded successor control to become the continuation anchor");
  assert.ok(acceptedSelectionEnd > acceptedSelection, "expected the selection continuation branch boundary");
  const branch = source.slice(acceptedSelection, acceptedSelectionEnd);
  assert.match(branch, /verifiedContinuationAnchor\s*&&\s*selectionDiagnostics\s*&&\s*\(verifiedBySuccessorControl\s*\|\|\s*verifiedBySuccessorDialog\s*\|\|\s*verifiedByDialogTransition\)/);
  assert.match(branch, /locator:\s*verifiedContinuationAnchor/);
  assert.match(branch, /selectionApplied:\s*true/);
  assert.match(source, /successorOwnerReadyBefore:\s*successorOwnerBefore\.unique\s*&&\s*successorOwnerBefore\.enabled/);
  assert.match(source, /successorOwnerUniqueAfter:\s*successorOwnerAfter\.unique/);
});

test("enabled Portal cleanup runs after successful Discovery and before spec replay", () => {
  const promotion = workflowSource.indexOf("const promotedEntry = await promoteExecutionPlan(");
  const discoveryStatus = workflowSource.indexOf("const discoveryPassed = caseResult.status");
  const cleanup = workflowSource.indexOf("cancelDiscoveredPortalRequestBeforeReplay({", discoveryStatus);
  assert.ok(discoveryStatus >= 0 && cleanup > discoveryStatus && promotion > cleanup,
    "cleanup must run after the Discovery result and before candidate spec replay begins");
  const conditionStart = workflowSource.lastIndexOf("if (options.autoPromote", cleanup);
  const condition = workflowSource.slice(conditionStart, cleanup);
  assert.match(condition, /gate\.allowed/);
  assert.match(condition, /discoveryPassed/);
  assert.match(condition, /portalRequestCancellationEnabled/);
  assert.match(workflowSource.slice(cleanup, promotion), /status=cancelled_before_spec_replay/);
  assert.doesNotMatch(promotionSource, /beforePromotionGate/,
    "cleanup must not wait until after spec replay, which is blocked by the active case created during Discovery");
});

test("a failed Portal discovery cleans only an identity-matched active-case modal and stops without retry", () => {
  const failedDiscovery = workflowSource.indexOf('if (caseResult.status !== "discovered_passed" && caseResult.status !== "repaired_passed")');
  const discoveryPassed = workflowSource.indexOf("const discoveryPassed = caseResult.status", failedDiscovery);
  assert.ok(failedDiscovery >= 0 && discoveryPassed > failedDiscovery);
  const branch = workflowSource.slice(failedDiscovery, discoveryPassed);
  assert.match(branch, /workflowAppSlug !== "portal-comercial" \|\| !portalRequestCancellationEnabled/);
  assert.match(branch, /extractPortalActiveCaseRequestCode\(snapshot\)/);
  assert.match(branch, /isPortalActiveCaseBlockerEvidence\(snapshot, preDiscoveryRequestCode\)/);
  assert.match(branch, /identity,\s*requestContext: session\.context\.request/);
  assert.match(branch, /discoveryRetried=false promotionSkipped=true/);
  assert.match(branch, /active_qa_request_cancelled; rerun_discovery_explicitly/);
});

test("successful click persistence marks the resolver certificate observed only after completion", () => {
  const end = source.indexOf("const planControlIdentity =", source.indexOf("const completedActionUrl ="));
  const start = source.lastIndexOf("steps.push(withObservedAuthenticationOutcome({", end);
  assert.ok(start >= 0 && end > start);
  const success = source.slice(start, end);
  assert.match(success, /status: "found"/);
  assert.match(success, /technicalTargetCandidates:\s*\[\{\s*\.\.\.resolution\.certifiedTechnicalTarget,\s*validatedByInteraction:\s*true/);
  assert.ok(source.indexOf("const completedActionUrl =") < start);
});
