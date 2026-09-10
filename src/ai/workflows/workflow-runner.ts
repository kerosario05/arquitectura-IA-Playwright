import fs from "node:fs/promises";
import path from "node:path";

export type WorkflowStepType = "analysis" | "implementation" | "validation";
export type WorkflowStepStatus = "pending" | "running" | "completed" | "failed";

export type WorkflowStep = {
  id: string;
  name: string;
  instruction: string;
  type: WorkflowStepType;
  status: WorkflowStepStatus;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  steps: WorkflowStep[];
};

export type WorkflowRunStep = WorkflowStep & {
  result?: unknown;
  error?: string;
};

export type WorkflowRun = {
  workflowId: string;
  startedAt: string;
  steps: WorkflowRunStep[];
  result: "completed" | "failed";
  error?: string;
};

export type WorkflowStepExecutor = (step: WorkflowStep) => unknown | Promise<unknown>;

export type RunWorkflowOptions = {
  artifactDir?: string;
};

const WORKFLOW_STEP_TYPES = new Set<WorkflowStepType>(["analysis", "implementation", "validation"]);
const WORKFLOW_STEP_STATUSES = new Set<WorkflowStepStatus>(["pending", "running", "completed", "failed"]);

export function isValidWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  if (!value || typeof value !== "object") return false;
  const definition = value as Partial<WorkflowDefinition>;
  if (typeof definition.id !== "string" || !definition.id.trim()) return false;
  if (typeof definition.name !== "string" || !definition.name.trim() || !Array.isArray(definition.steps)) return false;

  const ids = new Set<string>();
  return definition.steps.every((step) => {
    if (!step || typeof step !== "object") return false;
    if (typeof step.id !== "string" || !step.id.trim() || ids.has(step.id)) return false;
    if (typeof step.name !== "string" || !step.name.trim()) return false;
    if (typeof step.instruction !== "string" || !step.instruction.trim()) return false;
    if (!WORKFLOW_STEP_TYPES.has(step.type) || !WORKFLOW_STEP_STATUSES.has(step.status)) return false;
    ids.add(step.id);
    return true;
  });
}

export async function saveWorkflowRun(run: WorkflowRun, artifactDir = path.resolve(".artifacts", "ai-workflows")): Promise<string> {
  await fs.mkdir(artifactDir, { recursive: true });
  const targetPath = path.join(artifactDir, "workflow-run.json");
  await fs.writeFile(targetPath, JSON.stringify(run, null, 2), "utf8");
  return targetPath;
}

export async function runWorkflow(
  workflow: WorkflowDefinition,
  executeStep: WorkflowStepExecutor,
  options: RunWorkflowOptions = {},
): Promise<WorkflowRun> {
  if (!isValidWorkflowDefinition(workflow)) {
    throw new Error(`Invalid workflow definition: ${workflow?.id ?? "unknown"}`);
  }

  const startedAt = new Date().toISOString();
  const run: WorkflowRun = {
    workflowId: workflow.id,
    startedAt,
    steps: [],
    result: "completed",
  };
  const artifactDir = options.artifactDir ?? path.resolve(".artifacts", "ai-workflows");

  for (const step of workflow.steps) {
    const runStep: WorkflowRunStep = { ...step, status: "running" };
    run.steps.push(runStep);
    await saveWorkflowRun(run, artifactDir);
    try {
      runStep.result = await executeStep(step);
      runStep.status = "completed";
    } catch (error) {
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
