import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, enrichRecordedScenarioContract, evaluateRecordedScenarioExecutionReadiness, toSharedMcpScenario } from "./canonical-recording-contract";
import { semanticIdentityFromFrameworkOwnerEvidence } from "./framework-owner-semantic-identity";
import type { RecordedEvent, RecordedTarget, SessionTrace } from "./session-trace.types";
import { buildHappyPathScenario } from "./trace-to-scenario";

function frameworkTarget(overrides: Partial<RecordedTarget> = {}): RecordedTarget {
  return {
    label: "control",
    tag: "div",
    associatedField: "contextual relation",
    locators: [],
    technicalTargetCandidates: [{
      targetType: "structural",
      locatorCandidates: [],
      structuralContext: {
        owner: { tag: "div" },
        stableDirectAttributes: {},
        stableDescendants: [{ relation: "descendant", tag: "img", stableAttributes: { alt: "Functional identity" } }],
        semanticShape: ["div", "h3"],
        deterministicStructuralIdentity: true,
        structuralIdentityMatchCount: 1,
      },
      interactionEvidence: ["v2_click_owner", "v2_framework_actionable_owner"],
      confidence: 0.85,
      validatedByInteraction: true,
    }],
    ...overrides,
  };
}

function event(target: RecordedTarget): RecordedEvent {
  return { seq: 0, t: 1, kind: "tap", screenKey: "screen", url: "https://fixture.test", target };
}

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "recording",
    projectSlug: "project",
    appSlug: "app",
    platform: "web",
    baseUrl: "https://fixture.test",
    startedAt: new Date().toISOString(),
    status: "completed",
    events,
    screens: [{ screenKey: "screen", url: "https://fixture.test" } as never],
  } as SessionTrace;
}

test("framework owner uses its unique same-owner descendant semantic identity without changing structural execution evidence", () => {
  const target = frameworkTarget();
  const identity = semanticIdentityFromFrameworkOwnerEvidence(target);
  assert.deepEqual(identity, { isFrameworkOwner: true, hasDeterministicStructuralAuthority: true, semanticIdentity: "Functional identity" });

  const interactions = buildCanonicalInteractions([event(target)]);
  assert.equal(interactions[0].semanticField, "Functional identity");
  assert.deepEqual(interactions[0].technicalTargetCandidates, target.technicalTargetCandidates);
  assert.equal(interactions[0].technicalTargetRefs.length, 0);

  const scenario = buildHappyPathScenario(trace([event(target)]), [event(target)]);
  assert.ok(scenario.testRailSteps.some((step) => step.content === 'Presionar "Functional identity"'));
  assert.ok(!scenario.testRailSteps.some((step) => step.content.includes("contextual relation")));
});

test("framework owner semantics fail closed for absent or ambiguous descendant evidence while ordinary controls retain associatedField precedence", () => {
  assert.deepEqual(
    semanticIdentityFromFrameworkOwnerEvidence(frameworkTarget({ technicalTargetCandidates: [{
      ...frameworkTarget().technicalTargetCandidates![0],
      structuralContext: { ...frameworkTarget().technicalTargetCandidates![0].structuralContext!, stableDescendants: [{ relation: "descendant", tag: "img", stableAttributes: { alt: "" } }] },
    }] })),
    { isFrameworkOwner: true, hasDeterministicStructuralAuthority: true },
  );
  assert.deepEqual(
    semanticIdentityFromFrameworkOwnerEvidence(frameworkTarget({ technicalTargetCandidates: [{
      ...frameworkTarget().technicalTargetCandidates![0],
      structuralContext: { ...frameworkTarget().technicalTargetCandidates![0].structuralContext!, stableDescendants: [
        { relation: "descendant", tag: "img", stableAttributes: { alt: "One" } },
        { relation: "descendant", tag: "img", stableAttributes: { alt: "Two" } },
      ] },
    }] })),
    { isFrameworkOwner: true, hasDeterministicStructuralAuthority: true },
  );
  assert.equal(
    semanticIdentityFromFrameworkOwnerEvidence(frameworkTarget({ technicalTargetCandidates: [{
      ...frameworkTarget().technicalTargetCandidates![0],
      structuralContext: { ...frameworkTarget().technicalTargetCandidates![0].structuralContext!, stableDescendants: [
        { relation: "descendant", tag: "img", stableAttributes: { alt: "Same label" } },
        { relation: "descendant", tag: "span", stableAttributes: { "aria-label": " same   label " } },
      ] },
    }] })).semanticIdentity,
    "same label",
  );

  const ordinary = event({ label: "ordinary control", tag: "button", associatedField: "field relation", locators: [] });
  assert.equal(buildCanonicalInteractions([ordinary])[0].semanticField, "field relation");
});

test("unique framework structural authority is replay-eligible but remains technically and promotion unready", () => {
  const events = [event(frameworkTarget())];
  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical[0].resolutionState, "runtime_resolution_required");
  assert.deepEqual(canonical[0].technicalTargetCandidates, events[0].target!.technicalTargetCandidates);

  const enriched = enrichRecordedScenarioContract(buildHappyPathScenario(trace(events), events), canonical);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  assert.equal(readiness.executionReady, true);
  assert.equal(readiness.technicalReady, false);
  assert.equal(readiness.promotionReady, false);
  assert.equal(readiness.actions[0].runtimeResolutionRequired, true);
  const replayAction = toSharedMcpScenario(enriched, "app").recordingExecutionContract!.actions.find((step) => step.actionType === "click");
  assert.deepEqual(replayAction!.technicalTargetCandidates, events[0].target!.technicalTargetCandidates);
});

test("ambiguous or absent framework structural authority remains replay-blocked", () => {
  const ambiguous = frameworkTarget({ technicalTargetCandidates: [{
    ...frameworkTarget().technicalTargetCandidates![0],
    structuralContext: { ...frameworkTarget().technicalTargetCandidates![0].structuralContext!, deterministicStructuralIdentity: false, identityAmbiguous: true, structuralIdentityMatchCount: 2 },
  }] });
  const absent = frameworkTarget({ technicalTargetCandidates: undefined });
  for (const target of [ambiguous, absent]) {
    const events = [event(target)];
    const enriched = enrichRecordedScenarioContract(buildHappyPathScenario(trace(events), events), buildCanonicalInteractions(events));
    assert.equal(evaluateRecordedScenarioExecutionReadiness(enriched).executionReady, false);
  }
});
