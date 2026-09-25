import type { McpScenario, McpRouteProfile, AutomatabilityClassification, RecordingExecutionContract } from "../scenarios/scenario-types";

export type VirtualCaseSource = "scenario_preview";

export type VirtualCase = {
  id: string;
  displayId: string;
  testRailCaseId?: number;
  title: string;
  sourceIssueKey: string;
  steps: string[];
  expectedResult: string;
  caseOracle?: string;
  negativeOracle?: NonNullable<McpScenario["negativeOracle"]>;
  authIntent?: "gate_observation" | "full_authentication";
  preconditions: string[];
  appSlug: string;
  routeProfile: string;
  dataRequirements: string;
  mcpExecutable: boolean;
  source: VirtualCaseSource;
  targetAppSlug?: string;
  targetAppName?: string;
  navigationPrefix?: string;
  routeEvidence?: string;
  type: string;
  automationType: string;
  setupStrategy: string;
  executionReadiness?: string;
  semanticValidity?: string;
  publicationClassification?: "executable" | "documentation" | "blocked";
  launchClassification?: "standard" | "adaptive" | "nonAutomatable";
  nonAutomatable?: boolean;
  sectionSlug?: string;
  sectionName?: string;
  sectionId?: string | number;
  recordingId?: string;
  recordedScenarioId?: string;
  functionalBranch?: McpScenario["functionalBranch"];
  requirementDependencies?: McpScenario["requirementDependencies"];
  stepRequirementRefs?: McpScenario["stepRequirementRefs"];
  stepAuthority?: McpScenario["stepAuthority"];
  stepClaimTypes?: McpScenario["stepClaimTypes"];
  stepClaims?: McpScenario["stepClaims"];
  unsupportedFunctionalSteps?: McpScenario["unsupportedFunctionalSteps"];
  missingPrerequisiteRequirementIds?: McpScenario["missingPrerequisiteRequirementIds"];
  validation?: McpScenario["validation"];
  repeatConstraintResolutions?: McpScenario["repeatConstraintResolutions"];
  runtimeExecutionBlockedByData?: McpScenario["runtimeExecutionBlockedByData"];
  canonicalRequirements?: McpScenario["canonicalRequirements"];
  canonicalInputRequirements?: McpScenario["canonicalInputRequirements"];
  expectedResultRequirementRefs?: McpScenario["expectedResultRequirementRefs"];
  canonicalInteractions?: Array<Record<string, unknown>>;
  entityActionBlocks?: Array<Record<string, unknown>>;
  runtimeInputRequirements?: Array<Record<string, unknown>>;
  technicalKnowledgeRefs?: string[];
  executionReadinessAudit?: Record<string, unknown>;
  recordingExecutionContract?: RecordingExecutionContract;
  stateSequenceValid?: boolean;
  stateSequenceIssues?: string[];
};

export type CatalogOptions = {
  useDiscoveredCatalog?: boolean;
  catalogMode?: "existing" | "refresh";
  coverageMode?: "representative" | "exhaustive";
  maxProductsPerCategory?: number;
};

export type CatalogDiagnostics = {
  catalogUsed: boolean;
  discoveryRefreshed: boolean;
  discoveredProductCount: number;
  representativeProductCount: number;
  discoveryTimestamp?: string;
  warnings: string[];
  fallbackReason?: string;
  // HU scope filtering diagnostics
  issueAlignedTargetCount?: number; // Number of products aligned with HU scope
  issueAlignedCategories?: string[]; // Categories aligned with HU scope
  explicitlyMentionedCategories?: string[]; // Categories explicitly mentioned in HU
  // Scenario budget diagnostics
  scenarioBudgetResolved?: number; // Dynamic scenario limit calculated for this HU
  scenarioBudgetSource?: "env_override" | "dynamic_broad_hu" | "dynamic_failure_scenarios" | "default"; // How limit was determined
  // Seed context diagnostics
  seedContextCount?: number; // Number of deterministic seeds generated as context
  seedContextByCategory?: Record<string, number>; // Seeds per category
  seedGeneratedCount?: number; // Total seeds generated
  seedValidCount?: number; // Valid seeds (passed validation)
  seedInvalidCount?: number; // Invalid seeds (failed validation)
  seedInvalidReasons?: Array<{ title: string; errors: string[] }>; // Why seeds failed
  // Coverage diagnostics
  categoryCoverage?: Record<string, { total: number; covered: number; seeded: number }>; // Coverage per category
  // Failure scenario diagnostics
  failureScenarioCountDetected?: number; // Number of failure scenarios detected in HU
  failureScenarioCountGenerated?: number; // Number of failure scenarios actually generated
  // Automatability filtering diagnostics
  excludedRequirements?: Array<{
    sourceRequirement: string;
    sourceIssueKey: string;
    reason: string;
    classification: AutomatabilityClassification;
    suggestedHandling: string;
    detectedPatterns?: string[];
  }>;
  nonAutomatableRequirementCount?: number;
  uiAutomatableRequirementCount?: number;
};

export type ScenarioPreviewRequest = {
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  sectionName?: string;
  sectionSlug?: string;
  sectionId?: string | number;
  testrailProjectId?: number;
  testrailSuiteId?: number;
  testrailSectionId?: number;
  publishToTestRail?: boolean;
  createTestRun?: boolean;
  reportResults?: boolean;
  source?: {
    projectKey: string;
    sprintId?: number;
    status?: string;
  };
  routeProfile?: McpRouteProfile;
  scenarios: McpScenario[];
  catalogOptions?: CatalogOptions;
  options?: {
    overwrite?: boolean;
    autoPromote?: boolean;
    autoPom?: boolean;
    rerunActive?: boolean;
    headed?: boolean;
  };
  recordingId?: string;
  requestedScenarioIds?: string[];
  rejectedScenarios?: ReplayAdmissionRejection[];
  requestedRejectedCount?: number;
  requestedRejectedScenarioIds?: string[];
  nonRequestedRejectedCandidates?: ReplayAdmissionRejection[];
};

export type ReplayAdmissionRejection = {
  scenarioId: string;
  reasons: string[];
};

export type ScenarioPreviewResponse = {
  ok: true;
  jobId: string;
  status: string;
  mode: "scenario-preview";
  scenarioCount: number;
  catalogDiagnostics?: CatalogDiagnostics;
};

export type ScenarioPreviewError = {
  ok: false;
  error: string;
  message: string;
};

export function normalizeStep(step: string): string {
  return step.replace(/^\d+[\.)]\s*/, "").trim();
}

export function toVirtualCase(scenario: McpScenario, index: number, sectionSlug?: string, sectionName?: string, sectionId?: string | number): VirtualCase {
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
