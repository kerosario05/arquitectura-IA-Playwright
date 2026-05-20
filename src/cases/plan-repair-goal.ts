import type { ExecutionPlanStep } from "../types/execution-plan.types";

export function buildPlanRepairGoal(input: {
  caseId: number;
  scenarioTitle: string;
  pendingSteps: ExecutionPlanStep[];
}): string {
  return `Repair the ExecutionPlan for case C${input.caseId} ("${input.scenarioTitle}"). The plan has ${input.pendingSteps.length} unresolved NOOP steps that need to be converted into executable actions. Use the snapshot, data context, and action registry to resolve targets and values. Return a valid AgentHandoffResponse JSON object with the repaired plan in the top-level plans array and all steps executable.`;
}
