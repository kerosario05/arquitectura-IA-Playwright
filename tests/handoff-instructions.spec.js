"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const handoff_instructions_1 = require("../src/agent/handoff-instructions");
const request = {
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
(0, test_1.test)("contains no playwright execution rule", () => {
    const md = (0, handoff_instructions_1.buildAgentHandoffInstructions)(request);
    (0, test_1.expect)(md).toContain("Do not execute Playwright");
});
(0, test_1.test)("contains no modify stable registry rule", () => {
    const md = (0, handoff_instructions_1.buildAgentHandoffInstructions)(request);
    (0, test_1.expect)(md).toContain("Do not modify stable Object Registry");
});
(0, test_1.test)("contains response file requirement", () => {
    const md = (0, handoff_instructions_1.buildAgentHandoffInstructions)(request);
    (0, test_1.expect)(md).toContain("agent-response.json");
});
(0, test_1.test)("contains no invent data rule", () => {
    const md = (0, handoff_instructions_1.buildAgentHandoffInstructions)(request);
    (0, test_1.expect)(md).toContain("Do not invent data");
});
(0, test_1.test)("requires AgentHandoffResponse wrapper", () => {
    const md = (0, handoff_instructions_1.buildAgentHandoffInstructions)(request);
    (0, test_1.expect)(md).toContain("AgentHandoffResponse JSON object");
    (0, test_1.expect)(md).toContain("top-level `plans` array");
});
