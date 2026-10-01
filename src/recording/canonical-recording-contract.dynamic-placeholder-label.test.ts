import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

test("container labels with unresolved object properties are dynamic, while captured structural replay identity is preserved", () => {
  const event: RecordedEvent = {
    seq: 1,
    t: 1,
    kind: "tap",
    screenKey: "any-screen",
    target: {
      label: "Seleccione una Cuenta / undefined Balance Disponible",
      tag: "div",
      locators: [],
      technicalTargetCandidates: [{
        targetType: "structural",
        locatorCandidates: [],
        structuralContext: {
          deterministicStructuralIdentity: true,
          owner: { tag: "div" },
          scopeIdentity: { strategy: "id", value: "selector-scope" },
        },
        interactionEvidence: ["v2_click_owner"],
        confidence: 0.85,
        validatedByInteraction: true,
      }],
    },
  };

  const [interaction] = buildCanonicalInteractions([event]);
  assert.equal(interaction.dynamicTargetLabel, true);
  assert.equal(interaction.resolutionState, "runtime_resolution_required");
  assert.equal(interaction.technicalTargetCandidates?.length, 1);
  assert.equal(interaction.technicalTargetRefs?.length, 0);

  const trace = {
    recordingId: "generic-recording",
    projectSlug: "generic-project",
    appSlug: "generic-project",
    platform: "web",
    status: "stopped",
    events: [event],
    screens: [],
  } as unknown as SessionTrace;
  const scenario = buildHappyPathScenario(trace, [event]);
  const step = scenario.testRailSteps.find((candidate) => candidate.interactionId === "interaction-1");
  assert.equal(step?.content, "Presionar el control grabado");
  assert.doesNotMatch(step?.content ?? "", /undefined|null/i);
});
