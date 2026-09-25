import test from "node:test";
import assert from "node:assert/strict";
import { describeTestRailRecordingPayload, validateTestRailRecordingPayload } from "./testrail-recording-payload";

test("shared TestRail payload accepts the configured text and separated step representations", () => {
  const payload = { title: "Scenario", custom_steps_separated: [{ content: "Abrir", expected: "" }] };
  assert.deepEqual(validateTestRailRecordingPayload(payload), []);
  assert.equal(describeTestRailRecordingPayload(payload).stepsFieldType, "array<object{content:string,expected:string}>");
});

test("shared TestRail payload blocks malformed step entries locally", () => {
  assert.ok(validateTestRailRecordingPayload({
    title: "Scenario",
    custom_steps_separated: [{ content: "Abrir", expected: null }],
  }).some((error) => error.includes("expected must be a string")));
});
