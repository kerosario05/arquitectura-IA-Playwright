import { test, expect } from "@playwright/test";
import { buildRepairSystemPrompt } from "../src/ai/repair/repair-system-prompt";

test("system prompt respeta limites de seguridad", () => {
  const prompt = buildRepairSystemPrompt();
  expect(prompt).toContain("JSON only");
  expect(prompt).toContain("Never control browser");
  expect(prompt).toContain("Never invent selectors");
  expect(prompt).toContain("Never request or expose secrets");
  expect(prompt).toContain("payments, transfers");
});
