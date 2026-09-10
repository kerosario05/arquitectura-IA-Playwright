import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTestRailCase } from "./testrail-normalizer";

test("does not assign custom_expected global to a free-text step", () => {
  const parsed = normalizeTestRailCase({
    id: 9901,
    title: "Normal case",
    custom_steps: "1. Step one\n2. Step two\n3. Step three",
    custom_expected: "The flow succeeds",
  });

  assert.deepEqual(parsed.steps.map((step) => step.expected), [undefined, undefined, undefined]);
});

test("preserves expected values structurally attached to separated steps", () => {
  const parsed = normalizeTestRailCase({
    id: 9902,
    title: "Separated case",
    custom_steps_separated: [
      { content: "Step one", expected: "First result" },
      { content: "Step two" },
      { content: "Step three", expected: "Third result" },
    ],
  });

  assert.deepEqual(parsed.steps.map((step) => step.expected), ["First result", undefined, "Third result"]);
});
