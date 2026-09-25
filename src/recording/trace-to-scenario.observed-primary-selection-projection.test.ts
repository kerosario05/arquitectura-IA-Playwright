import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, hasExecutionAuthority, evaluateRecordedScenarioExecutionReadiness } from "./canonical-recording-contract";
import { buildHappyPathScenario, materializeObservedPrimaryScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

/**
 * FIRST_LOSS (recordingId c70d4e5d-6ea1-4570-8f1e-de90d5547da6): a completed functional selection
 * produces a display-only synthesized `select` projection (`target.sourceTechnicalEventSeqs`
 * present, `locators: []`, never captured against a real DOM target) plus its two authoritative
 * technical clicks. The canonical contract already encodes "shown but NOT executable" as
 * `executionAuthority: false` and `hasExecutionAuthority` already excludes it from the readiness
 * accounting and the RecordingExecutionContract. But `materializeObservedPrimaryScenario` /
 * `buildHappyPathScenario` still filtered executable interactions by `!technicalOnly`, so the
 * non-executable projection was treated as an executable-required action with zero technical
 * authority -> `hasSufficientTechnicalEvidence=false` -> the Observed Primary was never persisted
 * (scenarios.json missing). Fixed by reusing the SAME existing `hasExecutionAuthority` contract
 * flag in the materializer -- never by relaxing the fail-closed evidence gate.
 */

function optionClickEvent(): RecordedEvent {
  return {
    seq: 0, t: 100, kind: "tap", screenKey: "s", url: "/x",
    target: {
      label: "Option A", role: "option", tag: "li", interactionType: "click",
      locators: [{ strategy: "role", value: "option|Option A", confidence: 0.9 }],
      technicalTargetCandidates: [{
        targetType: "structural",
        locatorCandidates: [{ strategy: "role", value: "option|Option A", confidence: 0.9 }],
        structuralContext: { owner: { tag: "li", role: "option" }, stableDirectAttributes: { role: "option" }, stableDescendants: [], semanticShape: [], deterministicStructuralIdentity: true },
        interactionEvidence: ["v2_click_owner"], validatedByInteraction: true,
      }],
      coveredByFunctionalSelection: true,
    },
  } as unknown as RecordedEvent;
}

function derivedSelectEvent(lineage: number[]): RecordedEvent {
  return {
    seq: 1, t: 110, kind: "tap", screenKey: "s", url: "/x",
    target: {
      label: "Option A", role: "option", interactionType: "select", afterValue: "Option A",
      compoundRole: "selection", associatedField: "Field X", locators: [],
      ...(lineage.length ? { sourceTechnicalEventSeqs: lineage } : {}),
    },
  } as unknown as RecordedEvent;
}

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-projection", projectSlug: "p", appSlug: "app", platform: "web",
    baseUrl: "http://contract-fixture.test", startedAt: new Date().toISOString(), status: "stopped",
    events, screens: [{ screenKey: "s", url: "/x" } as any],
  } as unknown as SessionTrace;
}

test("1/derivedSelectIsNonExecutableAndKeepsLineage. the display-only select projection is excluded from execution authority but keeps its structured lineage", () => {
  const events = [optionClickEvent(), derivedSelectEvent([0])];
  const canonical = buildCanonicalInteractions(events);
  const click = canonical.find((interaction) => interaction.action === "click");
  const select = canonical.find((interaction) => interaction.action === "select");
  assert.equal(hasExecutionAuthority(click!), true, "the authoritative option click stays executable");
  assert.equal(hasExecutionAuthority(select!), false, "the display-only projection is never executable");
  assert.equal(select!.executionAuthority, false, "the projection is marked executionAuthority:false by the existing contract flag");
  assert.deepEqual((events[1].target as any)?.sourceTechnicalEventSeqs, [0], "lineage to the authoritative click is preserved on the raw event");
});

test("2/observedPrimaryMaterializes. the Observed Primary is persisted once the non-executable projection is excluded", () => {
  const events = [optionClickEvent(), derivedSelectEvent([0])];
  const scenario = materializeObservedPrimaryScenario(trace(events), events);
  assert.ok(scenario, "the Observed Primary must materialize when every executable action has authority");
  const audit = evaluateRecordedScenarioExecutionReadiness(scenario as any);
  assert.deepEqual(audit.actions.map((action) => action.actionId), ["interaction-1"], "only the authoritative click is executable-required; the projection is not");
  assert.equal(audit.actions[0].technicalTargetCount > 0, true);
});

test("3/authoritylessStandaloneSelectStillFailsClosed. a real select with no authority and no lineage keeps blocking the Observed Primary", () => {
  const events = [derivedSelectEvent([])];
  const canonical = buildCanonicalInteractions(events);
  const select = canonical.find((interaction) => interaction.action === "select");
  assert.equal(hasExecutionAuthority(select!), true, "a standalone select is executable-required (no executionAuthority override)");
  const scenario = materializeObservedPrimaryScenario(trace(events), events);
  assert.equal(scenario, null, "a genuinely authority-less select must still fail closed -- the gate is never relaxed");
});

test("4/duplicateAmbiguousOptionStillFailsClosed. an option click whose target is ambiguous is not silently accepted", () => {
  const ambiguous = optionClickEvent();
  (ambiguous.target as any).technicalTargetCandidates = [];
  (ambiguous.target as any).locators = [];
  (ambiguous.target as any).ambiguous = true;
  const events = [ambiguous];
  const scenario = materializeObservedPrimaryScenario(trace(events), events);
  assert.equal(scenario, null, "no technical authority on an executable click must still fail closed");
});

test("5/nonSelectionClickUnaffected. an ordinary click with a certified technical target is unchanged", () => {
  const events = [{
    seq: 0, t: 100, kind: "tap", screenKey: "s", url: "/x",
    target: { label: "Guardar", role: "button", tag: "button", interactionType: "click", locators: [{ strategy: "role", value: "button|Guardar", confidence: 0.9 }] },
  } as unknown as RecordedEvent];
  const scenario = materializeObservedPrimaryScenario(trace(events), events);
  assert.ok(scenario, "ordinary click with a technical target still materializes");
  const canonical = buildCanonicalInteractions(events);
  assert.equal(hasExecutionAuthority(canonical[0]), true);
});
