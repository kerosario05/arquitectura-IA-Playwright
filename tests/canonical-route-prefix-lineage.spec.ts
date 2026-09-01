import { test, expect } from "@playwright/test";
import { applyCanonicalRoutePrefix } from "../src/scenarios/scenario-preview.service";

test("preserves referenced origins through canonical prefix changes", () => {
  const result = applyCanonicalRoutePrefix(
    ['Clic en "A".', 'Clic en "B".', 'Clic en "B".'],
    ["B", "NEW"],
    [],
    [{ stepIndex: 1 }, { stepIndex: 2 }],
  );

  expect(result.steps).toEqual(['1. Clic en "NEW".', 'Clic en "A".', 'Clic en "B".', 'Clic en "B".']);
  expect(result.stepOrigins).toEqual([undefined, 0, 1, 2]);
});
