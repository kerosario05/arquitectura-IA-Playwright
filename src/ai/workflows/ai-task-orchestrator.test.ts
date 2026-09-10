import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  isValidWorkflowDefinition,
  runWorkflow,
  type WorkflowDefinition,
} from "./workflow-runner";

const workflow: WorkflowDefinition = {
  id: "workflow-test",
  name: "Workflow test",
  steps: [
    { id: "first", name: "First", instruction: "First instruction", type: "analysis", status: "pending" },
    { id: "second", name: "Second", instruction: "Second instruction", type: "validation", status: "pending" },
  ],
};

test("accepts a valid workflow definition", () => {
  assert.equal(isValidWorkflowDefinition(workflow), true);
});

test("executes workflow steps sequentially and stops on failure", async () => {
  const calls: string[] = [];
  const run = await runWorkflow({
    ...workflow,
    steps: [...workflow.steps, { id: "never", name: "Never", instruction: "Never", type: "implementation", status: "pending" }],
  }, async (step) => {
    calls.push(step.id);
    if (step.id === "second") throw new Error("validation failed");
    return `${step.id} result`;
  }, { artifactDir: await fs.mkdtemp(path.join(os.tmpdir(), "ai-workflow-test-")) });

  assert.deepEqual(calls, ["first", "second"]);
  assert.equal(run.result, "failed");
  assert.equal(run.steps.length, 2);
  assert.equal(run.steps[0].result, "first result");
  assert.equal(run.steps[1].status, "failed");
  assert.equal(run.error, "validation failed");
});

test("persists workflow run results locally", async () => {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-workflow-persist-"));
  const run = await runWorkflow(workflow, async () => ({ ok: true }), { artifactDir });
  const saved = JSON.parse(await fs.readFile(path.join(artifactDir, "workflow-run.json"), "utf8"));

  assert.equal(saved.workflowId, "workflow-test");
  assert.equal(saved.result, "completed");
  assert.equal(saved.steps.length, 2);
  assert.equal(saved.steps[0].status, "completed");
  assert.equal(run.startedAt, saved.startedAt);
});
