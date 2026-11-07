import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness } from "./canonical-recording-contract";
import type { RecordedEvent } from "./session-trace.types";

test("direct user navigation is executable and persists a sanitized URL", () => {
  const interactions = buildCanonicalInteractions([{
    seq: 1,
    t: 1,
    kind: "navigate",
    screenKey: "portal",
    url: "https://user:password@ejemplo.com/solicitudes?token=private#session=private",
    pageKey: "tab-1",
    directUserNavigation: true,
  } as RecordedEvent]);

  const navigation = interactions.find((interaction) => interaction.action === "navigation");
  assert.equal(navigation?.executionAuthority, true);
  assert.equal(navigation?.navigationUrl, "https://ejemplo.com/solicitudes");
  assert.equal(navigation?.pageKey, "tab-1");
});

test("a manual tab switch carries page identity without becoming a locator-based action", () => {
  const interactions = buildCanonicalInteractions([{
    seq: 1,
    t: 1,
    kind: "tab_switch",
    screenKey: "approval-queue",
    url: "https://aprobaciones.example",
    pageKey: "tab-2",
  } as RecordedEvent]);

  const tabSwitch = interactions.find((interaction) => interaction.action === "tab_switch");
  assert.equal(tabSwitch?.executionAuthority, true);
  assert.equal(tabSwitch?.pageKey, "tab-2");
  assert.deepEqual(tabSwitch?.technicalTargetRefs, []);

  const readiness = evaluateRecordedScenarioExecutionReadiness({
    canonicalInteractions: interactions,
    runtimeInputRequirements: [],
    testRailSteps: [],
    stateSequenceValid: true,
  } as never);
  assert.equal(readiness.actions.length, 0, "the explicit tab step must not be reported as a missing UI locator");
});
