import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalInteractions,
  enrichRecordedScenarioContract,
  toSharedMcpScenario,
} from "./canonical-recording-contract";

function materializeFreshScenario(events: unknown[]) {
  const interactions = buildCanonicalInteractions(events as never);
  const functional = interactions.filter((interaction) => !interaction.technicalOnly);
  const scenario = {
    scenarioId: "fresh-fixture",
    sourceRecordingId: "fresh-recording",
    title: "Fresh fixture",
    requiredData: [],
    testRailSteps: functional.map((interaction) => ({
      content: interaction.description ?? interaction.id,
      classification: "FUNCTIONAL_ACTION",
      interactionId: interaction.id,
    })),
    webSteps: functional.map((interaction) => ({
      action: interaction.action,
      interactionId: interaction.id,
      target: { strategy: "role", value: interaction.technicalTargetRefs[0] ?? interaction.id },
      description: interaction.description ?? interaction.id,
    })),
    canonicalInteractions: interactions,
    technicalReadiness: true,
    functionalReadiness: true,
    hasUncertainSteps: false,
    oracleAuthority: "observed_only",
    replayEligible: true,
  } as never;
  return enrichRecordedScenarioContract(scenario, interactions);
}

const target = (tag: string, role: string, ref: string, structuralContext: Record<string, unknown> = {}) => ({
  label: ref,
  tag,
  role,
  actionOwner: true,
  interactionType: "click",
  locators: [{ strategy: "role", value: `${role}|${ref}`, confidence: 0.9 }],
  technicalTargetCandidates: [{
    targetType: "display",
    locatorCandidates: [{ strategy: "role", value: `${role}|${ref}`, confidence: 0.9 }],
    structuralContext: { owner: { tag }, ...structuralContext },
    interactionEvidence: ["click"],
    confidence: 0.9,
    validatedByInteraction: true,
  }],
});

test("first recording readiness uses its own trace authority across generic project fixtures", () => {
  const fixtures = [
    [{ seq: 0, t: 1, kind: "tap", screenKey: "surface", url: "/", target: target("button", "button", "native-action") }],
    [
      { seq: 0, t: 1, kind: "fill", screenKey: "surface", url: "/", target: { ...target("input", "textbox", "field-a"), interactionType: "input", rawTypedValue: "a" } },
      { seq: 1, t: 2, kind: "fill", screenKey: "surface", url: "/", target: { ...target("input", "textbox", "field-b"), interactionType: "input", rawTypedValue: "b" } },
      { seq: 2, t: 3, kind: "fill", screenKey: "surface", url: "/", target: { ...target("input", "textbox", "field-c"), interactionType: "input", rawTypedValue: "c" } },
    ],
    [{ seq: 0, t: 1, kind: "tap", screenKey: "surface", url: "/", target: target("a", "link", "native-navigation") }],
    [{ seq: 0, t: 1, kind: "tap", screenKey: "surface", url: "/", target: target("div", "div", "framework-card", {
      stableDescendants: [{ relation: "descendant", tag: "img", stableAttributes: { alt: "fixture-card" } }],
      semanticShape: ["div", "h3"],
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
    }) }],
  ];

  for (const events of fixtures) {
    const scenario = materializeFreshScenario(events);
    const hydrated = JSON.parse(JSON.stringify(scenario));
    const contract = toSharedMcpScenario(hydrated, "fixture-project");
    const audit = contract.recordingExecutionContract?.actions ?? [];

    assert.equal(scenario.canonicalInteractions?.some((interaction) => !interaction.technicalOnly), true);
    assert.equal(scenario.technicalReadiness, true);
    assert.equal(scenario.stateSequenceValid, true);
    assert.equal(contract.executionReadiness, "ready");
    assert.equal(contract.mcpExecutable, true);
    assert.equal(audit.every((action) => Boolean(action.technicalTargetRef || action.technicalTargetCandidates?.length)), true);
  }
});
