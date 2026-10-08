import assert from "node:assert/strict";
import test from "node:test";
import { parseStepIntent } from "../discovery/step-intent-parser";
import type { SessionTrace } from "./session-trace.types";
import { buildHappyPathScenario } from "./trace-to-scenario";

function fixture(events: SessionTrace["events"]): SessionTrace {
  return {
    recordingId: "conditional-list-recovery",
    projectSlug: "fixture",
    appSlug: "fixture",
    platform: "web",
    baseUrl: "https://app.test",
    label: "Select an instrument",
    recordingGoal: { declaredGoal: "Select an instrument", normalizedGoal: "select an instrument", provenance: "USER_DECLARED", needsReview: false },
    recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: true, includeQaCredentialsInTestRail: false },
    startedAt: "2026-10-07T00:00:00.000Z",
    status: "stopped",
    events,
    screens: [{ screenKey: "form", title: "Form", fingerprint: "form", firstSeenAt: 0, controls: [], texts: ["Instrument"] }],
  } as SessionTrace;
}

test("projects an observed list retry as a conditional action while retaining the actual selection", () => {
  const trace = fixture([
    { seq: 1, t: 100, kind: "tap", screenKey: "form", target: { label: "control", role: "button", associatedField: "Reintentar buscar lista", locators: [] } },
    { seq: 2, t: 200, kind: "tap", screenKey: "form", target: { label: "Efectivo", role: "option", interactionType: "select", afterValue: "Efectivo", associatedField: "Instrumento", locators: [{ strategy: "role", value: "option|Efectivo", confidence: 0.95 }] } },
  ] as SessionTrace["events"]);

  const scenario = buildHappyPathScenario(trace, trace.events);
  const retry = scenario.testRailSteps.find((step) => step.conditionalAction);
  const selection = scenario.testRailSteps.find((step) => step.valueKey === "instrumento_seleccion");

  assert.ok(retry);
  assert.equal(retry.conditionalAction?.operation, "click");
  assert.equal(retry.conditionalAction?.condition.target, "Reintentar buscar lista");
  assert.equal(retry.conditionalAction?.skipAllowedWhenConditionFalse, true);
  assert.ok(parseStepIntent(retry.content)[0]?.conditionalAction, "review text should preserve conditional intent through parsing");
  assert.ok(selection, "the observed selected value remains a separate functional selection");
  assert.equal(scenario.webSteps.find((step) => step.conditionalAction)?.conditionalAction?.operation, "click");
});

test("does not mark an ordinary button or selection action as recovery", () => {
  const trace = fixture([
    { seq: 1, t: 100, kind: "tap", screenKey: "form", target: { label: "Buscar", role: "button", associatedField: "Search", locators: [{ strategy: "role", value: "button|Buscar", confidence: 0.95 }] } },
  ] as SessionTrace["events"]);
  const scenario = buildHappyPathScenario(trace, trace.events);
  assert.equal(scenario.testRailSteps.some((step) => step.conditionalAction), false);
});
