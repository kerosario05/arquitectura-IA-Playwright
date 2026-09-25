"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const workflow_runner_1 = require("./workflow-runner");
const workflow = {
    id: "workflow-test",
    name: "Workflow test",
    steps: [
        { id: "first", name: "First", instruction: "First instruction", type: "analysis", status: "pending" },
        { id: "second", name: "Second", instruction: "Second instruction", type: "validation", status: "pending" },
    ],
};
(0, node_test_1.test)("accepts a valid workflow definition", () => {
    strict_1.default.equal((0, workflow_runner_1.isValidWorkflowDefinition)(workflow), true);
});
(0, node_test_1.test)("executes workflow steps sequentially and stops on failure", async () => {
    const calls = [];
    const run = await (0, workflow_runner_1.runWorkflow)({
        ...workflow,
        steps: [...workflow.steps, { id: "never", name: "Never", instruction: "Never", type: "implementation", status: "pending" }],
    }, async (step) => {
        calls.push(step.id);
        if (step.id === "second")
            throw new Error("validation failed");
        return `${step.id} result`;
    }, { artifactDir: await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "ai-workflow-test-")) });
    strict_1.default.deepEqual(calls, ["first", "second"]);
    strict_1.default.equal(run.result, "failed");
    strict_1.default.equal(run.steps.length, 2);
    strict_1.default.equal(run.steps[0].result, "first result");
    strict_1.default.equal(run.steps[1].status, "failed");
    strict_1.default.equal(run.error, "validation failed");
});
(0, node_test_1.test)("persists workflow run results locally", async () => {
    const artifactDir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "ai-workflow-persist-"));
    const run = await (0, workflow_runner_1.runWorkflow)(workflow, async () => ({ ok: true }), { artifactDir });
    const saved = JSON.parse(await promises_1.default.readFile(node_path_1.default.join(artifactDir, "workflow-run.json"), "utf8"));
    strict_1.default.equal(saved.workflowId, "workflow-test");
    strict_1.default.equal(saved.result, "completed");
    strict_1.default.equal(saved.steps.length, 2);
    strict_1.default.equal(saved.steps[0].status, "completed");
    strict_1.default.equal(run.startedAt, saved.startedAt);
});
