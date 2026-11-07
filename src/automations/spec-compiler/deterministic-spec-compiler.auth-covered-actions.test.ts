import assert from "node:assert/strict";
import test from "node:test";
import { countRequiredActionSteps } from "./deterministic-spec-compiler";

const step = (scenarioStepIndex: number, operation: string, required?: boolean) =>
  ({ scenarioStepIndex, operation, ...(required === undefined ? {} : { required }) });
const contract = (steps: unknown[], covered?: number[]) =>
  ({ steps, ...(covered ? { auth: { required: true, aggregate: { bindingId: "b", coveredScenarioStepIndices: covered } } } : {}) }) as never;

test("a login-only scenario has no action step of its own once the auth flow covers the login", () => {
  const steps = [step(1, "fill"), step(2, "fill"), step(3, "press")];
  assert.equal(countRequiredActionSteps(contract(steps, [1, 2, 3])), 0);
});

test("steps outside the auth aggregate still count, and the aggregate only removes its own steps", () => {
  const steps = [step(1, "fill"), step(2, "fill"), step(3, "press"), step(4, "click"), step(5, "fill")];
  assert.equal(countRequiredActionSteps(contract(steps, [1, 2, 3])), 2);
});

test("without an auth aggregate every required fill/press/click counts, optional and other operations do not", () => {
  const steps = [step(1, "fill"), step(2, "click"), step(3, "press", false), step(4, "navigate"), step(5, "assert")];
  assert.equal(countRequiredActionSteps(contract(steps)), 2);
});
