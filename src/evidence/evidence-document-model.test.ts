import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceDocumentScreens } from "./evidence-document-model";
import type { EvidenceScenarioRecord } from "./evidence-types";

function scenario(evidenceKind: string): EvidenceScenarioRecord {
  const screenIds = ["screen-a", "screen-b", "screen-a", "screen-a"];
  return {
    scenarioId: "revisited-screen",
    scenarioTitle: "Revisitar una pantalla",
    requirement: "",
    analyst: "QA",
    date: "2026-10-16",
    status: "Exitoso",
    appSlug: "fixture",
    sectionSlug: "fixture",
    evidenceKind,
    steps: screenIds.map((screenId, index) => ({
      index: index + 1,
      stepIndex: index + 1,
      stepText: `Acción ${index + 1}`,
      screenId,
      screenTitle: screenId === "screen-a" ? "Pantalla A" : "Pantalla B",
      status: "passed",
      timestamp: "2026-10-16T00:00:00.000Z",
    })),
  };
}

test("Jira groups consecutive steps within a revisited screen occurrence", () => {
  const screens = buildEvidenceDocumentScreens(scenario("jira_semantic"), []);

  assert.equal(screens.length, 3);
  assert.deepEqual(screens[2].steps.map((step) => step.text), ["Acción 3", "Acción 4"]);
});

test("Recording keeps consecutive actions within the same revisited screen occurrence", () => {
  const screens = buildEvidenceDocumentScreens(scenario("recording_replay"), []);

  assert.equal(screens.length, 3);
  assert.equal(screens[2].steps.length, 2);
});

test("a shared legacy image stays with its observed screen instead of an earlier unclassified action", () => {
  const input = scenario("recording_replay");
  input.steps = input.steps.slice(0, 2);
  input.steps[0].screenId = undefined;
  input.steps[0].screenTitle = undefined;
  input.steps[0].screenshotPath = "fixture.png";
  input.steps[1].screenId = "screen-b";
  input.steps[1].screenshotPath = "fixture.png";
  const screens = buildEvidenceDocumentScreens(input, [{ path: "fixture.png", stepText: "Captured screen", screenId: "screen-b" }]);
  assert.equal(screens[0].images.length, 0);
  assert.equal(screens[1].images.length, 1);
});

test("framework verification of an authored action does not duplicate its step number", () => {
  const input = scenario("recording_replay");
  input.steps = input.steps.slice(0, 2);
  input.steps.forEach(step => { step.screenId = "same"; step.stepIndex = 18; });
  const screens = buildEvidenceDocumentScreens(input, []);
  assert.deepEqual(screens[0].steps.map(step => step.number), [18, 0]);
  assert.equal(screens[0].steps.length, 2);
});
