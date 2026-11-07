import assert from "node:assert/strict";
import test from "node:test";
import { buildHappyPathScenario } from "./trace-to-scenario";
import { buildCanonicalInteractions, toSharedMcpScenario } from "./canonical-recording-contract";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

function keyEvents(fieldLabel?: string): RecordedEvent[] {
  return Array.from("12345678901", (label, index) => ({
    seq: index, t: index * 100, kind: "tap", screenKey: "form", pageKey: "tab-1",
    target: { label, role: "button", tag: "button", locators: [{ strategy: "role", value: `button|${label}`, confidence: 0.9 }],
      playwrightRecorderEvidence: { kind: "virtual_keyboard", runtimeResolutionRequired: true,
        buttonCount: 12, keyLabels: Array.from("0123456789"), ...(fieldLabel ? { fieldLabel } : {}) } },
  } as RecordedEvent));
}

function scenario(events: RecordedEvent[], appSlug = "fixture-one") {
  const trace: SessionTrace = { recordingId: "keyboard-fixture", projectSlug: appSlug, appSlug, platform: "web", baseUrl: "https://fixture.test", status: "stopped", startedAt: "2026-01-01T00:00:00Z", events, screens: [{ screenKey: "form", title: "Form", fingerprint: "fixture", firstSeenAt: 0, controls: [], texts: [], url: "https://fixture.test/form" }] };
  return buildHappyPathScenario(trace, events);
}

test("one labelled keyboard sequence produces one editable value and keeps its ordered key actions", () => {
  for (const appSlug of ["fixture-one", "fixture-two"]) {
    const result = scenario(keyEvents("Número de identificación"), appSlug);
    assert.equal(result.requiredData.length, 1);
    assert.equal(result.requiredData[0].label, "Número de identificación");
    assert.equal(result.requiredData[0].formatHint, "virtual_keyboard_11");
    const segmented = result.testRailSteps.filter((step) => step.segmentPosition !== undefined);
    assert.deepEqual(segmented.map((step) => step.segmentPosition), Array.from({ length: 11 }, (_, index) => index + 1));
    assert.equal(new Set(segmented.map((step) => step.valueKey)).size, 1);
    const shared = toSharedMcpScenario(result, appSlug);
    assert.equal(shared.runtimeInputRequirements?.length, 1);
    assert.equal(shared.runtimeInputRequirements?.[0].semanticField, "Número de identificación");
    const actions = shared.recordingExecutionContract?.actions.filter((action) => action.playwrightRecorderEvidence?.kind === "virtual_keyboard") ?? [];
    assert.equal(actions.length, 11);
    assert.ok(actions.every((action) => action.valueKey === result.requiredData[0].key));
    assert.deepEqual(actions.map((action) => action.segmentPosition), Array.from({ length: 11 }, (_, index) => index + 1));
  }
});

test("unlabelled virtual keys never become separate fields named after repeated digits", () => {
  const events = keyEvents();
  const canonical = buildCanonicalInteractions(events);
  assert.ok(canonical.every((interaction) => interaction.semanticField === undefined && interaction.valueKey === undefined));
  const result = scenario(events);
  assert.equal(result.requiredData.length, 0);
  assert.equal(result.canonicalInteractions?.filter((interaction) => interaction.action === "click").length, 11);
});

test("ordinary numeric buttons keep their original click meaning", () => {
  const events = keyEvents().map((event) => ({ ...event, target: { ...event.target!, playwrightRecorderEvidence: undefined } }));
  const result = scenario(events);
  assert.equal(result.requiredData.length, 0);
  assert.ok(result.testRailSteps.every((step) => step.segmentPosition === undefined));
});
