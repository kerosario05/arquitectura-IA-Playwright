import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTaskSteps, selectTaskSteps } from "./task-steps";

test("normalizes intake that collapsed explicit semicolon-separated steps into one item", () => {
  assert.deepEqual(normalizeTaskSteps([
    "navigate https://example.test/; click «Explore»; click «Cards»; click «Classic Visa»; click «Request»",
  ]), [
    "navigate https://example.test/",
    "click «Explore»",
    "click «Cards»",
    "click «Classic Visa»",
    "click «Request»",
  ]);
});

test("preserves already structured steps and does not split punctuation inside labels", () => {
  assert.deepEqual(normalizeTaskSteps(["click «Terms; conditions»", "click «Continue»"]), ["click «Terms; conditions»", "click «Continue»"]);
});

test("recording reference steps outrank operational prose misclassified by intake", () => {
  const recorded = ["navigate https://example.test/", "click \"Continue\""];
  const misclassified = ["start QA Lab", "capture diagnostics", "rerun physical validation"];
  assert.deepEqual(selectTaskSteps(misclassified, recorded, true), recorded);
  assert.deepEqual(selectTaskSteps(misclassified, [], true), misclassified);
  assert.deepEqual(selectTaskSteps(misclassified, recorded, false), misclassified);
});
