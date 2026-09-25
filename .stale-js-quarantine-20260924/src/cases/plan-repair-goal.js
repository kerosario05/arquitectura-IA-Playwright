"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlanRepairGoal = buildPlanRepairGoal;
function buildPlanRepairGoal(input) {
    return `Repair the ExecutionPlan for case C${input.caseId} ("${input.scenarioTitle}"). The plan has ${input.pendingSteps.length} unresolved NOOP steps that need to be converted into executable actions. Use the snapshot, data context, and action registry to resolve targets and values. Return a valid AgentHandoffResponse JSON object with the repaired ExecutionPlan in the top-level plans array and all steps executable.`;
}
