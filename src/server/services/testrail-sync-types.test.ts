import assert from "node:assert/strict";
import test from "node:test";
import { buildScenarioPreviewScenarioId } from "./testrail-sync-types";
import type { McpScenario } from "../../scenarios/scenario-types";

const baseScenario = {
  sourceIssueKey: "HU-42",
  title: "Scenario",
  steps: ["Open page"],
} as McpScenario;

test("canonical Jira scenario IDs remain stable when published as separate TestRail requests", () => {
  const scenario = { ...baseScenario, scenarioId: "HU-42:jira:3" } as McpScenario & { scenarioId: string };
  assert.equal(buildScenarioPreviewScenarioId(scenario, 0, { cacheKey: "debug-HU-42-HU-42:jira:3" }), "HU-42:jira:3");
  assert.equal(buildScenarioPreviewScenarioId(scenario, 0, { sourceScenarioId: "HU-42:jira:3" }), "HU-42:jira:3");
});

test("launch identity and legacy preview fallback retain their existing contracts", () => {
  const scenario = { ...baseScenario, scenarioId: "HU-42:jira:3" } as McpScenario & { scenarioId: string };
  assert.equal(buildScenarioPreviewScenarioId(scenario, 1, { launchId: "12345678-aaaa" }), "L-12345678-002");
  assert.equal(buildScenarioPreviewScenarioId(baseScenario, 0), "PREVIEW-001");
});
