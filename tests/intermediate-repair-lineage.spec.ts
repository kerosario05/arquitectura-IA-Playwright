import { test, expect } from "@playwright/test";
import { repairMissingIntermediates } from "../src/scenarios/scenario-intermediate-repair";

test("intermediate repair exposes one origin entry per repaired step", () => {
  const result = repairMissingIntermediates(
    { steps: ["1. A", "2. B"] } as any,
    null,
    {} as any,
  );
  expect(result.stepOrigins).toEqual([0, 1]);
});
