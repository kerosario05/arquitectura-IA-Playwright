import { test, expect } from "@playwright/test";
import { resolveScenarioIntent } from "../src/scenarios/scenario-preview.service";

test("resolved specific intent wins over huModel reclassification and clears conflicting subIntent", () => {
  const { intent, subIntent } = resolveScenarioIntent("A", "B", "B1");
  expect(intent).toBe("A");
  expect(subIntent).toBeUndefined();
});

test("unknown resolved intent falls back to huModel and preserves compatible subIntent", () => {
  const { intent, subIntent } = resolveScenarioIntent("B", "B", "B1");
  expect(intent).toBe("B");
  expect(subIntent).toBe("B1");
});

test("resolved intent matching huModel keeps existing subIntent", () => {
  const { intent, subIntent } = resolveScenarioIntent("A", "A", "A1");
  expect(intent).toBe("A");
  expect(subIntent).toBe("A1");
});

test("fallback to huModel mainIntent when resolved intent is unknown", () => {
  const { intent, subIntent } = resolveScenarioIntent("unknown_flow", "B", "B1");
  expect(intent).toBe("B");
  expect(subIntent).toBe("B1");
});