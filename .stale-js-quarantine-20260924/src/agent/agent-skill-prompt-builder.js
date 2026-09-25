"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSkillAwarePrompt = buildSkillAwarePrompt;
exports.enrichCodexInputWithSkill = enrichCodexInputWithSkill;
const node_path_1 = __importDefault(require("node:path"));
function buildSkillAwarePrompt(input) {
    if (input.promptMode === "verbose") {
        return buildVerboseSkillPrompt(input);
    }
    return buildCompactSkillPrompt(input);
}
function buildCompactSkillPrompt(input) {
    const absDir = node_path_1.default.resolve(input.handoffDir);
    const absRequest = node_path_1.default.resolve(input.requestPath);
    const absInstructions = node_path_1.default.resolve(input.instructionsPath);
    const absSchema = node_path_1.default.resolve(input.schemaPath);
    const absContext = input.contextPackPath ? node_path_1.default.resolve(input.contextPackPath) : undefined;
    const absSkillMd = node_path_1.default.join(absDir, "selected-skill.md");
    const absResponse = node_path_1.default.resolve(input.responsePath);
    return [
        `You are repairing an ExecutionPlan response for web-ai-automation-runner.`,
        ``,
        `Work only inside this handoff directory:`,
        `${absDir}`,
        ``,
        `Read these files first:`,
        `1. ${absRequest} (handoff-request.json)`,
        `2. ${absInstructions} (handoff-instructions.md)`,
        `3. ${absSchema} (agent-response.schema.json)`,
        ...(absContext ? [`4. ${absContext} (context-pack.json)`] : []),
        `${absContext ? "5" : "4"}. ${absSkillMd} (selected-skill.md)`,
        ``,
        `Then produce a valid agent-response.json at:`,
        `${absResponse}`,
        ``,
        `Task:`,
        `- Read the handoff request, instructions, schema, and context pack to understand the current state (snapshot, plan, failure reason).`,
        `- Read the selected skill and follow its constraints exactly.`,
        `- Write a valid AgentHandoffResponse JSON object to ${absResponse}.`,
        `- Always include recoveryDecision and keep it consistent with the response body.`,
        `- Put repaired ExecutionPlan objects inside the top-level plans array.`,
        ``,
        `Rules:`,
        `- Modify only agent-response.json.`,
        `- Do not modify files outside the handoff directory.`,
        `- Do not generate Playwright code.`,
        `- Do not modify Object Registry.`,
        `- Do not modify framework source files.`,
        `- Do not run tests.`,
        `- Do not run Playwright.`,
        `- Do not invent secrets or sensitive data.`,
        `- Use only the selected skill's allowed actions.`,
        `- The response must match the AgentHandoffResponse schema.`,
        `- The file must not be a bare ExecutionPlan.`,
        `- If the skill relies on snapshot candidates, use only IDs present in context-pack.json.`,
        `- If no safe repair is possible, keep the plan honest and explain the blocker in unresolvedQuestions or rationale.`,
        `- Finish immediately after writing agent-response.json.`,
        ``,
        `IMPORTANT: Write valid JSON to ${absResponse}. Do not output anything else.`
    ].join("\n");
}
function buildVerboseSkillPrompt(input) {
    const relDir = node_path_1.default.relative(input.projectRoot, input.handoffDir);
    const relRequest = node_path_1.default.relative(input.projectRoot, input.requestPath);
    const relInstructions = node_path_1.default.relative(input.projectRoot, input.instructionsPath);
    const relSchema = node_path_1.default.relative(input.projectRoot, input.schemaPath);
    const relContext = input.contextPackPath ? node_path_1.default.relative(input.projectRoot, input.contextPackPath) : undefined;
    const relResponse = node_path_1.default.relative(input.projectRoot, input.responsePath);
    const lines = [
        `You are repairing an ExecutionPlan response for web-ai-automation-runner.`,
        ``,
        `## Working Directory`,
        `${relDir}`,
        ``,
        `## Required Reading Order`,
        `1. READ: ${relRequest} - The handoff request.`,
        `2. READ: ${relInstructions} - The handoff instructions.`,
        `3. READ: ${relSchema} - The response schema.`,
        ...(relContext ? [`4. READ: ${relContext} - Contains the current state, snapshot, plan, and failure information.`] : []),
        `${relContext ? "5" : "4"}. READ: selected-skill.md - Contains the skill definition with constraints and allowed actions.`,
        ``,
        `## Task`,
        `Write a valid AgentHandoffResponse to: ${relResponse}`,
        ``,
        `The AgentHandoffResponse must include:`,
        `- version: "1.0"`,
        `- generatedAt: ISO timestamp`,
        `- recoveryDecision: repaired_plan | no_safe_action | needs_more_context`,
        `- plans: array containing the repaired ExecutionPlan`,
        `- proposedObjects: array for non-registry object proposals only`,
        `- unresolvedQuestions: array when data or UI ambiguity blocks a safe repair`,
        `- rationale: short array explaining the repair decisions`,
        ``,
        `## Critical Rules`,
        `- Only use actions allowed by the selected skill.`,
        `- Never output a bare ExecutionPlan; wrap it in the top-level plans array.`,
        `- Never use candidate-like references that don't exist in context-pack snapshotCandidates.`,
        `- Never propose free-form CSS/XPath selectors unless the skill explicitly allows it.`,
        `- Never modify framework code or stable registry.`,
        `- Never propose data not in availableDataKeys.`,
        `- If data is missing, reflect that in requiredData or unresolvedQuestions instead of inventing values.`,
        `- If no safe action is possible, keep the plan honest and explain the blocker in unresolvedQuestions or rationale.`,
        `- Write valid JSON only. Do not output anything else.`,
    ];
    return lines.join("\n");
}
function enrichCodexInputWithSkill(input, skillId) {
    const skillPrompt = buildSkillAwarePrompt({
        handoffDir: input.handoffDir,
        requestPath: input.requestPath,
        instructionsPath: input.instructionsPath,
        responsePath: input.responsePath,
        schemaPath: input.schemaPath,
        contextPackPath: input.contextPackPath,
        projectRoot: input.projectRoot,
        skillId,
        promptMode: input.promptMode
    });
    return {
        ...input,
        skillId,
        skillAwarePrompt: skillPrompt
    };
}
