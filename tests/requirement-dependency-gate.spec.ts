import { test, expect } from "@playwright/test";
import { evaluateRequirementDependencyGate } from "../src/scenarios/scenario-preview.service";

const scenario = (dependencies: any[], refs: any[]) => ({ requirementDependencies: dependencies, stepRequirementRefs: refs });
const dependency = (id: string, prerequisites: string[]) => ({ requirementId: id, prerequisiteRequirementIds: prerequisites });
const ref = (id: string, stepIndex: number) => ({ requirementId: id, stepIndex });

test("enforces canonical requirement dependency ordering", () => {
  const canonical = new Map([["R1", []], ["R2", ["R1"]], ["R3", ["R1", "R2"]]]);
  expect(evaluateRequirementDependencyGate(scenario([dependency("R2", ["R1"])], [ref("R1", 0), ref("R2", 2)]), canonical).dependencySatisfied).toBe(true);
  expect(evaluateRequirementDependencyGate(scenario([dependency("R2", ["R1"])], [ref("R2", 2)]), canonical).dependencySatisfied).toBe(false);
  expect(evaluateRequirementDependencyGate(scenario([dependency("R2", ["R1"])], [ref("R1", 3), ref("R2", 1)]), canonical).dependencySatisfied).toBe(false);
  expect(evaluateRequirementDependencyGate(scenario([dependency("R2", ["RX"])], [ref("R1", 0), ref("R2", 2)]), canonical).dependencySatisfied).toBe(true);
  expect(evaluateRequirementDependencyGate(scenario([], []), new Map()).dependencySatisfied).toBe(true);
  expect(evaluateRequirementDependencyGate(scenario([dependency("R3", ["R1", "R2"])], [ref("R1", 0), ref("R2", 1), ref("R3", 3)]), canonical).dependencySatisfied).toBe(true);
  expect(evaluateRequirementDependencyGate(scenario([dependency("R2", ["R1"])], [ref("R2", 1)]), new Map()).dependencySatisfied).toBe(false);
});
