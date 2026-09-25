"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAgentHandoffPackage = writeAgentHandoffPackage;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const handoff_instructions_1 = require("./handoff-instructions");
const agent_response_schema_1 = require("./agent-response.schema");
async function writeAgentHandoffPackage(input) {
    await (0, promises_1.mkdir)(input.outputDir, { recursive: true });
    const requestPath = node_path_1.default.join(input.outputDir, "handoff-request.json");
    const instructionsPath = node_path_1.default.join(input.outputDir, "handoff-instructions.md");
    const schemaPath = node_path_1.default.join(input.outputDir, "agent-response.schema.json");
    const responsePath = node_path_1.default.join(input.outputDir, "agent-response.json");
    const generatedAt = new Date().toISOString();
    await (0, promises_1.writeFile)(requestPath, JSON.stringify(input.request, null, 2), "utf-8");
    await (0, promises_1.writeFile)(instructionsPath, (0, handoff_instructions_1.buildAgentHandoffInstructions)(input.request), "utf-8");
    await (0, promises_1.writeFile)(schemaPath, JSON.stringify(agent_response_schema_1.agentHandoffResponseJsonSchema, null, 2), "utf-8");
    await (0, promises_1.writeFile)(responsePath, JSON.stringify({
        version: "1.0",
        generatedAt,
        recoveryDecision: "needs_more_context",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [
            {
                type: "missing_data",
                message: "Pending agent repair. Replace this placeholder after evaluating the handoff inputs."
            }
        ],
        rationale: [
            "Template response created by handoff writer. Replace this placeholder with the final agent rationale."
        ]
    }, null, 2), "utf-8");
    return { requestPath, instructionsPath, schemaPath, responsePath };
}
