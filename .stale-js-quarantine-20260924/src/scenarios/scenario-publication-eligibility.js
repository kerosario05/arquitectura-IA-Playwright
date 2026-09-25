"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyNonAutomatableRequirements = classifyNonAutomatableRequirements;
exports.associateScenarioRequirements = associateScenarioRequirements;
exports.classifyScenarioPublicationEligibility = classifyScenarioPublicationEligibility;
function classifyNonAutomatableRequirements(requirements) {
    return new Map(requirements
        .map((requirement) => requirement.requirementId ?? requirement.id)
        .filter((id) => Boolean(id))
        .map((id) => {
        const requirement = requirements.find((candidate) => (candidate.requirementId ?? candidate.id) === id);
        return [id, requirement?.status === "nonAutomatable" ? "nonAutomatable" : "other"];
    }));
}
function associateScenarioRequirements(scenario, requirements) {
    const requirementById = new Map(requirements
        .map((requirement) => [requirement.requirementId ?? requirement.id, requirement.status])
        .filter(([id]) => Boolean(id)));
    const requirementIds = [...new Set((scenario.stepRequirementRefs ?? [])
            .map((ref) => ref.requirementId)
            .filter((id) => typeof id === "string" && id.length > 0))];
    const requirementStates = Object.fromEntries(requirementIds.map((id) => [id, requirementById.get(id) ?? "unknown"]));
    const states = Object.values(requirementStates);
    return {
        requirementIds,
        requirementStates,
        hasUnknownRefs: states.some((status) => status === "unknown"),
        hasNonAutomatable: states.some((status) => status === "nonAutomatable"),
        hasExecutableRequirement: states.some((status) => status === "covered"),
    };
}
function classifyScenarioPublicationEligibility(scenario, requirements) {
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
