import type { ExecutionPlan } from "./execution-plan.types";
import type { TestScenario } from "./testrail.types";
import type { PageSnapshot } from "./page-snapshot.types";
import type { ObjectRegistry } from "./object-registry.types";
import type { SafeDataContextSummary } from "./agent-safe-context.types";

export type AgentHandoffKind = "plan_generation" | "plan_repair" | "discovery_assistance" | "object_proposal";

export type AgentHandoffRequest = {
  version: "1.0";
  kind: AgentHandoffKind;
  createdAt: string;
  goal: string;
  scenario?: TestScenario;
  currentPlan?: ExecutionPlan;
  snapshot?: PageSnapshot;
  objectRegistry?: ObjectRegistry;
  actionRegistry: {
    supportedActions: string[];
  };
  dataContextSummary: SafeDataContextSummary;
  constraints: {
    noApiKey: true;
    noPlaywrightExecution: true;
    doNotModifyStableRegistry: true;
    useOnlyAvailableDataKeys: true;
    outputMustMatchSchema: true;
  };
};

export type AgentUnresolvedQuestion = {
  type: "missing_data" | "missing_element" | "ambiguous_step" | "unsupported" | "needs_user_approval";
  message: string;
  suggestedAction?: string;
};

export type AgentProposedRegistryObject = {
  key: string;
  name: string;
  description?: string;
  type: string;
  locator: unknown;
  aliases?: string[];
  reason: string;
  confidence: number;
};

export type AgentHandoffResponse = {
  version: "1.0";
  generatedAt: string;
  plans: ExecutionPlan[];
  proposedObjects: AgentProposedRegistryObject[];
  unresolvedQuestions: AgentUnresolvedQuestion[];
  rationale: string[];
};
