import assert from "node:assert/strict";
import test from "node:test";
import { validateInteractionStateSequence, type CanonicalInteraction } from "./canonical-recording-contract";

const step = (id: string, pageKey: string | undefined, before: string, after: string, extra: Partial<CanonicalInteraction> = {}): CanonicalInteraction => ({
  id, action: "click", controlIdentity: id, sourceEventRefs: [], technicalTargetRefs: [], technicalOnly: false, confidence: 1,
  ...(pageKey ? { pageKey } : {}),
  screenBeforeRef: before, screenAfterRef: after, routeBefore: `https://${before}.example/`, routeAfter: `https://${after}.example/`,
  ...extra,
} as CanonicalInteraction);

test("a second tab does not break the state sequence of the first", () => {
  const result = validateInteractionStateSequence([
    step("interaction-1", "tab-1", "portal", "portal-request"),
    step("interaction-2", "tab-2", "bizagi-home", "bizagi-home"),
    step("interaction-3", "tab-2", "bizagi-home", "bizagi-case"),
    step("interaction-4", "tab-1", "portal-request", "portal-done"),
  ]);
  assert.deepEqual(result, { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("a real discontinuity inside one tab is still reported", () => {
  const result = validateInteractionStateSequence([
    step("interaction-1", "tab-1", "portal", "portal-request"),
    step("interaction-2", "tab-2", "bizagi-home", "bizagi-case"),
    step("interaction-3", "tab-1", "somewhere-else", "portal-done"),
  ]);
  assert.equal(result.stateSequenceValid, false);
  assert.match(result.stateSequenceIssues[0], /^interaction-1:.*->interaction-3:/);
});

test("without tabs the previous consecutive action is compared, exactly as before", () => {
  assert.equal(validateInteractionStateSequence([step("a", undefined, "s1", "s2"), step("b", undefined, "s2", "s3")]).stateSequenceValid, true);
  assert.equal(validateInteractionStateSequence([step("a", undefined, "s1", "s2"), step("b", undefined, "s9", "s3")]).stateSequenceValid, false);
});

test("a navigation opens its own route: it is never a jump from the previous action, but a click-to-click jump stays blocked", () => {
  const nav = (id: string, route: string): CanonicalInteraction => ({
    id, action: "navigation", controlIdentity: id, sourceEventRefs: [], technicalTargetRefs: [], technicalOnly: true, confidence: 1,
    screenBeforeRef: "s-nav", screenAfterRef: "s-nav", routeBefore: route,
  } as unknown as CanonicalInteraction);
  const withNavigation = validateInteractionStateSequence([
    step("a", undefined, "s1", "s2", { routeAfter: "https://s2.example/" }),
    nav("n", "https://deep.example/requests/9"),
    step("b", undefined, "s-nav", "s3", { routeBefore: "https://deep.example/requests/9" }),
  ]);
  assert.deepEqual(withNavigation, { stateSequenceValid: true, stateSequenceIssues: [] });
  assert.equal(validateInteractionStateSequence([step("a", undefined, "s1", "s2"), step("b", undefined, "s9", "s3")]).stateSequenceValid, false);
});
