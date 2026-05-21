import type { DataContext } from "../data/data-context";
import { listSupportedActions } from "../registry";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { ObjectRegistry } from "../types/object-registry.types";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { TestScenario } from "../types/testrail.types";
import type { AgentHandoffKind, AgentHandoffRequest } from "../types/agent-handoff.types";
import type { SkillId } from "../types/agent-skill.types";
import { buildSafeDataContextSummary } from "./safe-data-context";

export function buildAgentHandoffRequest(input: {
  kind: AgentHandoffKind;
  goal: string;
  contextPackPath?: string;
  scenario?: TestScenario;
  currentPlan?: ExecutionPlan;
  snapshot?: PageSnapshot;
  objectRegistry?: ObjectRegistry;
  dataContext: DataContext;
  selectedSkill?: {
    skillId: SkillId;
    skillPath?: string;
  };
}): AgentHandoffRequest {
  return {
    version: "1.0",
    kind: input.kind,
    createdAt: new Date().toISOString(),
    goal: input.goal,
    contextPackPath: input.contextPackPath,
    scenario: input.scenario,
    currentPlan: input.currentPlan ? (JSON.parse(JSON.stringify(input.currentPlan)) as ExecutionPlan) : undefined,
    snapshot: input.snapshot,
    objectRegistry: input.objectRegistry,
    actionRegistry: {
      supportedActions: listSupportedActions()
    },
    dataContextSummary: buildSafeDataContextSummary(input.dataContext),
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
