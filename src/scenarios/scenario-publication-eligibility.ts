import type {
  FunctionalRequirementAccount,
  McpScenario,
  RequirementStatus,
} from "./scenario-types";

export type ScenarioRequirementAssociation = {
  requirementIds: string[];
  requirementStates: Record<string, RequirementStatus | "unknown">;
  hasUnknownRefs: boolean;
  hasNonAutomatable: boolean;
  hasExecutableRequirement: boolean;
};

export type ScenarioPublicationEligibility = ScenarioRequirementAssociation & {
  functionalRepresentationAllowed: boolean;
  publishableToTestManagement: boolean;
  standardExecutable: boolean;
  publicationClassification: "executable" | "documentation" | "blocked";
  launchClassification: "standard" | "adaptive" | "nonAutomatable";
};

export function classifyNonAutomatableRequirements(
  requirements: FunctionalRequirementAccount[],
): ReadonlyMap<string, "nonAutomatable" | "other"> {
  return new Map(
    requirements
      .map((requirement) => requirement.requirementId ?? requirement.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => {
        const requirement = requirements.find((candidate) => (candidate.requirementId ?? candidate.id) === id);
        return [id, requirement?.status === "nonAutomatable" ? "nonAutomatable" : "other"] as const;
      }),
  );
}

export function associateScenarioRequirements(
  scenario: Pick<McpScenario, "stepRequirementRefs">,
  requirements: FunctionalRequirementAccount[],
): ScenarioRequirementAssociation {
  const requirementById = new Map(
    requirements
      .map((requirement) => [requirement.requirementId ?? requirement.id, requirement.status] as const)
      .filter(([id]) => Boolean(id)),
  );
  const requirementIds = [...new Set(
    (scenario.stepRequirementRefs ?? [])
      .map((ref) => ref.requirementId)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  )];
  const requirementStates = Object.fromEntries(
    requirementIds.map((id) => [id, requirementById.get(id) ?? "unknown"]),
  ) as Record<string, RequirementStatus | "unknown">;
  const states = Object.values(requirementStates);
  return {
    requirementIds,
    requirementStates,
    hasUnknownRefs: states.some((status) => status === "unknown"),
    hasNonAutomatable: states.some((status) => status === "nonAutomatable"),
    hasExecutableRequirement: states.some((status) => status === "covered"),
  };
}

export function classifyScenarioPublicationEligibility(
  scenario: Pick<McpScenario, "stepRequirementRefs" | "mcpExecutable" | "executionReadiness" | "launchClassification">,
  requirements: FunctionalRequirementAccount[],
): ScenarioPublicationEligibility {
  const association = associateScenarioRequirements(scenario, requirements);
  const pureNonAutomatable = association.requirementIds.length > 0
    && association.hasNonAutomatable
    && !association.hasExecutableRequirement
    && !association.hasUnknownRefs;
  const blockedByMissingCanonicalAuthority = requirements.length > 0
    && (association.requirementIds.length === 0 || association.hasUnknownRefs || !association.hasExecutableRequirement);
  const standardExecutable = !pureNonAutomatable
    && !blockedByMissingCanonicalAuthority
    && scenario.mcpExecutable !== false
    && scenario.executionReadiness !== "requires_route_discovery";

  return {
    ...association,
    functionalRepresentationAllowed: true,
    publishableToTestManagement: true,
    standardExecutable,
    publicationClassification: standardExecutable ? "executable" : pureNonAutomatable ? "documentation" : "blocked",
    launchClassification: standardExecutable
      ? "standard"
      : pureNonAutomatable
        ? "nonAutomatable"
      : scenario.mcpExecutable === false || scenario.executionReadiness === "requires_route_discovery"
        ? "adaptive"
        : "nonAutomatable",
  };
}
