"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAgentHandoffRequest = buildAgentHandoffRequest;
const registry_1 = require("../registry");
const safe_data_context_1 = require("./safe-data-context");
function buildAgentHandoffRequest(input) {
    return {
        version: "1.0",
        kind: input.kind,
        createdAt: new Date().toISOString(),
        goal: input.goal,
        contextPackPath: input.contextPackPath,
        scenario: input.scenario,
        currentPlan: input.currentPlan ? JSON.parse(JSON.stringify(input.currentPlan)) : undefined,
        snapshot: input.snapshot,
        objectRegistry: input.objectRegistry,
        actionRegistry: {
            supportedActions: (0, registry_1.listSupportedActions)()
        },
        dataContextSummary: (0, safe_data_context_1.buildSafeDataContextSummary)(input.dataContext),
        selectedSkill: input.selectedSkill,
        constraints: {
            noApiKey: true,
            noPlaywrightExecution: true,
            doNotModifyStableRegistry: true,
            useOnlyAvailableDataKeys: true,
            outputMustMatchSchema: true
        }
    };
}
