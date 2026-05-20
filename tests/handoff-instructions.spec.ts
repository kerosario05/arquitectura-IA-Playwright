import { expect, test } from "@playwright/test";
import { buildAgentHandoffInstructions } from "../src/agent/handoff-instructions";
import type { AgentHandoffRequest } from "../src/types/agent-handoff.types";

const request: AgentHandoffRequest = {
  version: "1.0",
  kind: "plan_repair",
  createdAt: new Date().toISOString(),
  goal: "Improve unresolved steps",
  actionRegistry: { supportedActions: ["click", "fill"] },
  dataContextSummary: { totalEntries: 0, sensitiveEntries: 0, nonSensitiveEntries: 0, availableKeys: [] },
  constraints: {
    noApiKey: true,
    noPlaywrightExecution: true,
    doNotModifyStableRegistry: true,
    useOnlyAvailableDataKeys: true,
    outputMustMatchSchema: true
  }
};

test("contains no playwright execution rule", () => {
  const md = buildAgentHandoffInstructions(request);
  expect(md).toContain("Do not execute Playwright");
});

test("contains no modify stable registry rule", () => {
  const md = buildAgentHandoffInstructions(request);
  expect(md).toContain("Do not modify stable Object Registry");
});

test("contains response file requirement", () => {
  const md = buildAgentHandoffInstructions(request);
  expect(md).toContain("agent-response.json");
});

test("contains no invent data rule", () => {
  const md = buildAgentHandoffInstructions(request);
  expect(md).toContain("Do not invent data");
});

test("requires AgentHandoffResponse wrapper", () => {
  const md = buildAgentHandoffInstructions(request);
  expect(md).toContain("AgentHandoffResponse JSON object");
  expect(md).toContain("top-level `plans` array");
});
