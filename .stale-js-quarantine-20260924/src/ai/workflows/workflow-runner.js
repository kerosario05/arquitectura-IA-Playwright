"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidWorkflowDefinition = isValidWorkflowDefinition;
exports.saveWorkflowRun = saveWorkflowRun;
exports.runWorkflow = runWorkflow;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const WORKFLOW_STEP_TYPES = new Set(["analysis", "implementation", "validation"]);
const WORKFLOW_STEP_STATUSES = new Set(["pending", "running", "completed", "failed"]);
function isValidWorkflowDefinition(value) {
    if (!value || typeof value !== "object")
        return false;
    const definition = value;
    if (typeof definition.id !== "string" || !definition.id.trim())
        return false;
    if (typeof definition.name !== "string" || !definition.name.trim() || !Array.isArray(definition.steps))
        return false;
    const ids = new Set();
    return definition.steps.every((step) => {
        if (!step || typeof step !== "object")
            return false;
        if (typeof step.id !== "string" || !step.id.trim() || ids.has(step.id))
            return false;
        if (typeof step.name !== "string" || !step.name.trim())
            return false;
        if (typeof step.instruction !== "string" || !step.instruction.trim())
            return false;
        if (!WORKFLOW_STEP_TYPES.has(step.type) || !WORKFLOW_STEP_STATUSES.has(step.status))
            return false;
        ids.add(step.id);
        return true;
    });
}
async function saveWorkflowRun(run, artifactDir = node_path_1.default.resolve(".artifacts", "ai-workflows")) {
    await promises_1.default.mkdir(artifactDir, { recursive: true });
    const targetPath = node_path_1.default.join(artifactDir, "workflow-run.json");
    await promises_1.default.writeFile(targetPath, JSON.stringify(run, null, 2), "utf8");
    return targetPath;
}
async function runWorkflow(workflow, executeStep, options = {}) {
    if (!isValidWorkflowDefinition(workflow)) {
        throw new Error(`Invalid workflow definition: ${workflow?.id ?? "unknown"}`);
    }
    const startedAt = new Date().toISOString();
    const run = {
        workflowId: workflow.id,
        startedAt,
        steps: [],
        result: "completed",
    };
    const artifactDir = options.artifactDir ?? node_path_1.default.resolve(".artifacts", "ai-workflows");
    for (const step of workflow.steps) {
        const runStep = { ...step, status: "running" };
        run.steps.push(runStep);
        await saveWorkflowRun(run, artifactDir);
        try {
            runStep.result = await executeStep(step);
            runStep.status = "completed";
        }
        catch (error) {
            runStep.status = "failed";
            runStep.error = error instanceof Error ? error.message : String(error);
            run.result = "failed";
            run.error = runStep.error;
            await saveWorkflowRun(run, artifactDir);
            return run;
        }
        await saveWorkflowRun(run, artifactDir);
    }
    return run;
}
