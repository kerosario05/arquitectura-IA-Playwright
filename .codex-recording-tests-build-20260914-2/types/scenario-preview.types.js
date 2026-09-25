"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeStep = normalizeStep;
exports.toVirtualCase = toVirtualCase;
function normalizeStep(step) {
    return step.replace(/^\d+[\.)]\s*/, "").trim();
}
function toVirtualCase(scenario, index, sectionSlug, sectionName, sectionId) {
    const displayId = `PREVIEW-${String(index + 1).padStart(3, "0")}`;
    return {
        id: `preview-${String(index + 1).padStart(3, "0")}`,
        displayId,
        title: scenario.title,
        sourceIssueKey: scenario.sourceIssueKey,
        steps: scenario.steps.map(normalizeStep),
        expectedResult: scenario.expectedResult,
        authIntent: scenario.authIntent,
        negativeOracle: scenario.negativeOracle,
        preconditions: scenario.preconditions,
        appSlug: scenario.targetAppSlug ?? scenario.appSlug,
        routeProfile: scenario.routeProfile,
        dataRequirements: scenario.dataRequirements,
        mcpExecutable: scenario.mcpExecutable,
        source: "scenario_preview",
        targetAppSlug: scenario.targetAppSlug,
        targetAppName: scenario.targetAppName,
        type: scenario.type,
        automationType: scenario.automationType,
        setupStrategy: scenario.setupStrategy,
        executionReadiness: scenario.executionReadiness,
        semanticValidity: scenario.semanticValidity,
        publicationClassification: scenario.publicationClassification,
        launchClassification: scenario.launchClassification,
        nonAutomatable: scenario.publicationClassification === "blocked",
        recordingId: scenario.recordingId,
        recordedScenarioId: scenario.recordedScenarioId,
        functionalBranch: scenario.functionalBranch,
        requirementDependencies: scenario.requirementDependencies,
        stepRequirementRefs: scenario.stepRequirementRefs,
        stepAuthority: scenario.stepAuthority,
        stepClaimTypes: scenario.stepClaimTypes,
        stepClaims: scenario.stepClaims,
        unsupportedFunctionalSteps: scenario.unsupportedFunctionalSteps,
        missingPrerequisiteRequirementIds: scenario.missingPrerequisiteRequirementIds,
        validation: scenario.validation,
        repeatConstraintResolutions: scenario.repeatConstraintResolutions,
        runtimeExecutionBlockedByData: scenario.runtimeExecutionBlockedByData,
        canonicalRequirements: scenario.canonicalRequirements,
        canonicalInputRequirements: scenario.canonicalInputRequirements,
        expectedResultRequirementRefs: scenario.expectedResultRequirementRefs,
        canonicalInteractions: scenario.canonicalInteractions,
        entityActionBlocks: scenario.entityActionBlocks,
        runtimeInputRequirements: scenario.runtimeInputRequirements,
        technicalKnowledgeRefs: scenario.technicalKnowledgeRefs,
        executionReadinessAudit: scenario.executionReadinessAudit,
        recordingExecutionContract: scenario.recordingExecutionContract,
        stateSequenceValid: scenario.stateSequenceValid,
        stateSequenceIssues: scenario.stateSequenceIssues,
        sectionSlug,
        sectionName,
        sectionId,
    };
}
