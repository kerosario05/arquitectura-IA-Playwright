import { test, expect } from "@playwright/test";
import { hasForbiddenRepairDecisionFields } from "../src/ai/repair/repair-decision.schema";

test("schema bloquea campos inventados css/xpath/locator/testId", () => {
  expect(hasForbiddenRepairDecisionFields({ decision: "no_safe_action", reason: "x", css: "#app" })).toBe(true);
  expect(hasForbiddenRepairDecisionFields({ decision: "no_safe_action", reason: "x", xpath: "//div" })).toBe(true);
  expect(hasForbiddenRepairDecisionFields({ decision: "no_safe_action", reason: "x", locator: "button" })).toBe(true);
  expect(hasForbiddenRepairDecisionFields({ decision: "no_safe_action", reason: "x", testId: "btn" })).toBe(true);
});

test("schema acepta solo campos permitidos", () => {
  expect(
    hasForbiddenRepairDecisionFields({
      decision: "no_safe_action",
      reason: "No safe candidate",
      questions: ["Need snapshot?"]
    })
  ).toBe(false);
});
