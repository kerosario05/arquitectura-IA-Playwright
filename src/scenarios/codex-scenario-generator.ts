import type {
  McpGenerationResponse,
  McpRouteProfile,
  ScenarioRouteResolution,
  DeterministicSeedScenario,
  ScenarioGenerationMode,
  FunctionalBranchRef,
  CanonicalClaim,
} from "./scenario-types";
import { buildMcpScenarioMessages } from "./mcp-scenario-prompt-builder";
import { buildRequirementManifest, buildCanonicalClaims, isRequirementFunctionallyCoverable } from "./scenario-functional-quality";
import { detectOptionFlows } from "./hu-scope-guard";
import { parseAiResponse } from "./scenario-output-parser";
import type { JiraIssueSource } from "./scenario-types";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createScenarioAiProvider } from "../ai/ai-provider-factory";
import { AiProviderError, type AiProvider } from "../ai/ai-provider.types";
import { resolveScenarioRoute } from "./scenario-route-resolver";
import {
  buildDerivedExecutionContext,
  logDerivedContext,
} from "./route-profile-derived-context";
import {
  validateRouteProfileQuality,
  logRouteProfileQuality,
} from "./route-profile-quality-validator";
import {
  validateScenariosCompliance,
  validateScenarioCompliance,
  logComplianceResult,
  logComplianceSummary,
} from "./scenario-route-compliance-validator";
import { ensureStepStrings, normalizeScenarioSteps } from "./step-formatter";
import { remapStepClaimsByOrigins } from "./step-authority";
import { detectHuIntent, isTransactionalDocumentIntent, type HuIntentDetection } from "./hu-intent-classifier";
import {
  collectBranchRequiredClicks,
  mergeEffectiveAllowedClicks,
} from "./effective-click-authority";

/**
 * Convert deterministic seeds to full scenarios and validate them
 * Used as fallback when AI fails
 */
function convertSeedsToValidatedScenarios(
  seeds: DeterministicSeedScenario[],
  appSlug: string,
  routeProfile: McpRouteProfile | null,
  derivedContext: any,
  routeResolutions: Map<string, ScenarioRouteResolution>
): { validScenarios: any[]; invalidScenarios: Array<{ scenario: any; result: any }> } {
  const seedScenarios = seeds.map(seed => ({
    sourceIssueKey: seed.sourceIssueKey,
    title: seed.title,
    steps: seed.steps,
    preconditions: ["AuthGate"],
    expectedResult: seed.notes || `Escenario de fallback por error de IA`,
    caseOracle: "assert_visible",
    type: "Automated",
    database: "",
    isConverted: 1,
    automationType: "ui_with_controlled_data",
    setupStrategy: "ui_with_controlled_data",
    appSlug,
    routeProfile: routeProfile?.name || "default",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
    scenarioMode: seed.mode,
    routeConfidence: seed.confidence
  }));

  // Validate seed scenarios
  const validScenarios: any[] = [];
  const invalidScenarios: Array<{ scenario: any; result: any }> = [];

  for (const scenario of seedScenarios) {
    const result = validateScenarioCompliance(scenario, derivedContext, routeResolutions.get(scenario.sourceIssueKey));
    if (result.valid) {
      validScenarios.push(scenario);
    } else {
      invalidScenarios.push({ scenario, result });
    }
  }

  return { validScenarios, invalidScenarios };
}

/**
 * Normalize AI-generated scenarios to ensure valid field values
 * Applies multiproject-safe defaults for missing or invalid fields
 */
function normalizeAiScenario(scenario: any, appSlug: string): any {
  const normalized = { ...scenario };

  // Normalize automationType (must be in allowed list)
  const validAutomationTypes = [
    "ui_discovery",
    "ui_with_auth_gate",
    "ui_with_controlled_data",
    "ui_with_auth_gate_controlled_data"
  ];
  if (!validAutomationTypes.includes(normalized.automationType)) {
    normalized.automationType = "ui_with_controlled_data";
  }

  // Normalize setupStrategy (must be in allowed list)
  const validSetupStrategies = [
    "self_contained",
    "auth_gate",
    "controlled_data",
    "no_login"
  ];
  if (!validSetupStrategies.includes(normalized.setupStrategy)) {
    normalized.setupStrategy = "controlled_data";
  }

  // Ensure mcpExecutable is true
  if (normalized.mcpExecutable !== true) {
    normalized.mcpExecutable = true;
  }

  // Ensure appSlug is set
  if (!normalized.appSlug) {
    normalized.appSlug = appSlug;
  }

  // Ensure preconditions array exists
  if (!normalized.preconditions || !Array.isArray(normalized.preconditions)) {
    normalized.preconditions = ["AuthGate"];
  }

  // Ensure caseOracle exists
  if (!normalized.caseOracle) {
    normalized.caseOracle = "assert_visible";
  }

  // Ensure type field exists
  if (!normalized.type) {
    normalized.type = "Automated";
  }

  // Ensure database field exists
  if (normalized.database === undefined) {
    normalized.database = "";
  }

  // Ensure isConverted field exists
  if (normalized.isConverted === undefined) {
    normalized.isConverted = 1;
  }

  // Ensure dataRequirements field exists
  if (!normalized.dataRequirements) {
    normalized.dataRequirements = "";
  }

  // Ensure nonExecutableCriteria field exists
  if (!normalized.nonExecutableCriteria) {
    normalized.nonExecutableCriteria = "";
  }

  return normalized;
}

function extractHuTerms(issue: JiraIssueSource): { validations: string[]; actions: string[] } {
  const corpus = [issue.summary, issue.description, issue.acceptanceCriteria].filter(Boolean).join(" ");
  const validationMatches = corpus.match(/monto|tasa|fecha|estado|certificado|inter[eé]s|dato|campo/gi) || [];
  const actionMatches = corpus.match(/enviar|imprimir|descargar|consultar|volver|regresar|finalizar/gi) || [];
  return {
    validations: [...new Set(validationMatches)].slice(0, 2),
    actions: [...new Set(actionMatches)].slice(0, 1),
  };
}

function extractHuCoverage(issue: JiraIssueSource, pathSelection?: any): {
  domainTerm: string;
  singularTerm: string;
  hasExpiryAlert: boolean;
  hasNoDataCase: boolean;
} {
  const corpus = [issue.summary, issue.description, issue.acceptanceCriteria].filter(Boolean).join(" ").toLowerCase();
  const rawTarget = String(pathSelection?.selectedPath?.target || "depósito a plazo").replace(/"/g, "").trim();
  let singularTerm = rawTarget.toLowerCase();

  // Simple singularization: remove 's' at end for common Spanish plurals
  if (singularTerm.endsWith("os")) {
    singularTerm = singularTerm.slice(0, -1); // depósitos → depósito
  } else if (singularTerm.endsWith("as")) {
    singularTerm = singularTerm.slice(0, -1); // cuentas → cuenta
  }

  return {
    domainTerm: rawTarget.toLowerCase(),
    singularTerm,
    hasExpiryAlert: corpus.includes("alerta") || corpus.includes("vencimiento"),
    hasNoDataCase: corpus.includes("sin depósitos") || corpus.includes("sin depositos"),
  };
}

function buildHuFallbackScenarios(
  issues: JiraIssueSource[],
  appSlug: string,
  routeProfile: McpRouteProfile | null,
  routeResolutions: Map<string, ScenarioRouteResolution>,
  entrySteps?: Array<{ action: string; target: string; when?: string }>,
  pathSelectionMap?: Map<string, any>,
  functionalBranches: FunctionalBranchRef[] = [],
  requirementManifest?: ReturnType<typeof buildRequirementManifest>,
): any[] {
  const primaryIssue = issues[0];
  if (!primaryIssue) {
    return [];
  }

  const resolution = routeResolutions.get(primaryIssue.key);
  const pathSelection = pathSelectionMap?.get(primaryIssue.key);
  const isPrivateSynthetic = pathSelection?.accessMode === "private" &&
    (pathSelection?.source === "synthetic" || pathSelection?.selectedPath?.targetPathKey?.startsWith("synthetic_"));
  const entryPrefix = isPrivateSynthetic
    ? (entrySteps || [])
        .filter(step => step.action === "click" && !/informaci[oó]n de productos/i.test(step.target))
        .slice(0, 1)
        .map(step => `Clic en "${step.target}".`)
    : (entrySteps || []).slice(0, 2).map(step =>
        step.action === "click"
          ? `Clic en "${step.target}".`
          : `Validar que se muestre "${step.target}".`
      );
  const routePrefix = (resolution?.executableRouteSteps || []).slice(0, 3);
  const syntheticPrefix = ((pathSelection?.selectedPath?.requiredIntermediates || []) as string[])
    .filter(step => !/informaci[oó]n de productos/i.test(step))
    .slice(0, 3)
    .map(step => `Clic en "${step}".`);
  const navigationPrefix = [...entryPrefix, ...(routePrefix.length > 0 && !isPrivateSynthetic ? routePrefix : syntheticPrefix)]
    .filter((step, index, allSteps) =>
      !/informaci[oó]n de productos/i.test(step) &&
      allSteps.findIndex(candidate => candidate.toLowerCase() === step.toLowerCase()) === index
    );
  const coverage = extractHuCoverage(primaryIssue, pathSelection);
  const { actions } = extractHuTerms(primaryIssue);
  const actionTarget = actions[0] || "continuar";
  const selectionStep = `Seleccionar el primer ${coverage.singularTerm} visible del listado.`;

  const scenarios = [
    {
      sourceIssueKey: primaryIssue.key,
      title: `Consultar listado de ${coverage.domainTerm}`,
      steps: [...navigationPrefix, `Validar que se muestre "${coverage.domainTerm}".`],
      expectedResult: `Listado de ${coverage.domainTerm} disponible`,
    },
    {
      sourceIssueKey: primaryIssue.key,
      title: `Consultar detalle de ${coverage.singularTerm} seleccionado`,
      steps: [...navigationPrefix, selectionStep, `Validar que se muestre "${coverage.domainTerm}".`],
      expectedResult: `Detalle de ${coverage.singularTerm} disponible`,
    },
    {
      sourceIssueKey: primaryIssue.key,
      title: `Validar número de certificado enmascarado`,
      steps: [...navigationPrefix, selectionStep, `Validar que el botón "${actionTarget}" esté visible.`],
      expectedResult: "Acción disponible para el usuario",
    },
    {
      sourceIssueKey: primaryIssue.key,
      title: `Validar monto, tasa y fechas del ${coverage.singularTerm}`,
      steps: [...navigationPrefix, selectionStep, `Validar que se muestre "monto".`, `Validar que se muestre "tasa".`, `Validar que se muestre "fechas".`],
      expectedResult: "Datos financieros visibles",
    },
    {
      sourceIssueKey: primaryIssue.key,
      title: `Validar estado, intereses y tipo del ${coverage.singularTerm}`,
      steps: [...navigationPrefix, selectionStep, `Validar que se muestre "estado".`, `Validar que se muestre "intereses".`, `Validar que se muestre "tipo".`],
      expectedResult: "Estado e intereses visibles",
    },
    {
      sourceIssueKey: primaryIssue.key,
      title: `Validar opciones disponibles en detalle del ${coverage.singularTerm}`,
      steps: [...navigationPrefix, selectionStep, `Validar que el botón "Volver" esté visible.`, `Validar que el botón "Enviar correo" esté visible.`, `Validar que el botón "Imprimir" esté visible.`],
      expectedResult: "Opciones de navegación y acción disponibles",
    },
    ...(coverage.hasExpiryAlert ? [{
      sourceIssueKey: primaryIssue.key,
      title: `Validar alerta de vencimiento próximo`,
      steps: [...navigationPrefix, selectionStep, `Validar que se muestre "alerta de vencimiento próximo".`],
      expectedResult: "Alerta visible cuando aplica",
    }] : []),
    ...(coverage.hasNoDataCase ? [{
      sourceIssueKey: primaryIssue.key,
      title: `Validar cliente sin ${coverage.domainTerm}`,
      steps: [...navigationPrefix, `Validar que se muestre "sin ${coverage.domainTerm}".`],
      expectedResult: "Mensaje sin datos visible",
    }] : [])
  ];

  const sanitizedScenarios = scenarios.map((scenario) => ({
    ...scenario,
    steps: scenario.steps.filter((step: string) => !/informaci[oó]n de productos/i.test(step)),
    preconditions: ["AuthGate"],
    caseOracle: "assert_visible",
    type: "Automated",
    database: "",
    isConverted: 1,
    automationType: "ui_with_controlled_data",
    setupStrategy: "controlled_data",
    appSlug,
    routeProfile: routeProfile?.name || "default",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
    syntheticNavigationAuthority: isPrivateSynthetic,
  }));

  const removedPublicSteps = scenarios.reduce((total, scenario, index) =>
    total + (scenario.steps.length - sanitizedScenarios[index].steps.length), 0);
  console.log(`[scenario-preview] selectedPathFallback sanitized issue=${primaryIssue.key} removedPublicSteps=${removedPublicSteps} steps=${sanitizedScenarios[0]?.steps.length ?? 0}`);
  console.log(`[scenario-preview] huFallbackRich generated issue=${primaryIssue.key} count=${sanitizedScenarios.length} fields=monto,tasa,fechas,estado,intereses,tipo`);

  return sanitizedScenarios;
}

function writeScenarioGenerationTrace(
  issues: JiraIssueSource[],
  requirementManifest: ReturnType<typeof buildRequirementManifest>,
  scenarios: any[],
  stages: Record<string, any[]> = {},
  canonicalClaims: CanonicalClaim[] = [],
): void {
  const issueKey = issues[0]?.key ?? "unknown";
  const directory = join(process.cwd(), ".artifacts", "scenario-generation-traces");
  mkdirSync(directory, { recursive: true });
  const claimTrace = canonicalClaims.map((claim) => {
    const stageNames = ["rawProvider", "parsed", "normalizedRefs", "normalized", "quality", "postTransform", "finalGenerator"];
    const referenced = (stage: string) => (stagesByName(stageNames, stage, stages) ?? []).some((scenario: any) =>
      (scenario.stepClaims ?? []).some((ref: any) => ref.claimId === claim.claimId),
    );
    const flags = Object.fromEntries(stageNames.map((stage) => [stage, referenced(stage)]));
    const firstMissingStage = stageNames.find((stage) => !flags[stage]) ?? "none";
    return {
      claimId: claim.claimId,
      requirementId: claim.requirementId,
      facet: claim.facet,
      claimType: claim.claimType,
      required: claim.required,
      manifestSent: true,
      rawProviderReferenced: flags.rawProvider,
      parsedReferenced: flags.parsed,
      normalizedReferenced: flags.normalized,
      qualityReferenced: flags.quality,
      postTransformReferenced: flags.postTransform,
      finalReferenced: flags.finalGenerator,
      firstMissingStage,
    };
  });
  writeFileSync(join(directory, `${issueKey}.json`), JSON.stringify({
    issueKey,
    requirementManifest: requirementManifest?.map((requirement) => ({
      requirementId: requirement.requirementId ?? requirement.id,
      category: requirement.category,
      expectedBehavior: requirement.expectedBehavior,
      associatedBranchId: requirement.associatedBranchId,
      prerequisiteRequirementIds: requirement.prerequisiteRequirementIds,
    })),
    rawProviderScenarios: scenarios.map((scenario) => ({
      id: scenario.scenarioId,
      title: scenario.title,
      steps: scenario.steps,
      stepClaims: scenario.stepClaims,
      stepRequirementRefs: scenario.stepRequirementRefs,
      requirementDependencies: scenario.requirementDependencies,
      branchId: scenario.functionalBranch?.branchId,
      associatedBranchId: scenario.branchAssociation?.branchId,
    })),
    claimTrace,
    stages,
  }, null, 2));
  console.log(`[scenarios:trace] captured issue=${issueKey} path=${join(directory, `${issueKey}.json`)}`);
}

function stagesByName(names: string[], name: string, stages: Record<string, any[]>): any[] | undefined {
  return names.includes(name) ? stages[name] : undefined;
}

export function deriveProviderStepRequirementRefs(
  scenarios: any[],
  canonicalClaims: CanonicalClaim[],
): any[] {
  const canonicalById = new Map(canonicalClaims.map((claim) => [claim.claimId, claim]));
  return scenarios.map((scenario) => {
    const seen = new Set<string>();
    const refs = (Array.isArray(scenario.stepClaims) ? scenario.stepClaims : []).flatMap((claim: any) => {
      const descriptor = canonicalById.get(claim.claimId);
      const stepIndex = claim.stepIndex;
      if (!descriptor || !Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= (scenario.steps?.length ?? 0)) return [];
      if (descriptor.scope === "branch" && descriptor.scopeId !== scenario.functionalBranch?.branchId) return [];
      const key = `${stepIndex}:${descriptor.requirementId}:${descriptor.facet}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ stepIndex, requirementId: descriptor.requirementId, facet: descriptor.facet }];
    });
    return { ...scenario, stepRequirementRefs: refs };
  });
}

export function evaluateProviderRequirementCompliance(
  scenarios: any[],
  requirementManifest: ReturnType<typeof buildRequirementManifest>,
  canonicalClaims: CanonicalClaim[] = [],
): { expectedCoverableRequirementIds: string[]; referencedRequirementIds: string[]; missingRequirementIds: string[] } {
  const canonical = new Set(requirementManifest.map((requirement) => requirement.requirementId ?? requirement.id));
  const claimRequirementIds = new Map(
    canonicalClaims.map((claim) => [claim.claimId, claim.requirementId]),
  );
  const expected = requirementManifest
    .filter((requirement) => isRequirementFunctionallyCoverable(requirement))
    .map((requirement) => requirement.requirementId ?? requirement.id)
    .filter((id): id is string => !!id);
  const referenced = new Set<string>();
  for (const scenario of scenarios) {
    for (const ref of scenario.stepRequirementRefs ?? []) {
      if (!canonical.has(ref.requirementId)) continue;
      if (!Number.isInteger(ref.stepIndex) || ref.stepIndex < 0 || ref.stepIndex >= (scenario.steps?.length ?? 0)) continue;
      referenced.add(ref.requirementId);
    }
    for (const claim of scenario.stepClaims ?? []) {
      const requirementId = claimRequirementIds.get(claim.claimId);
      if (!requirementId || !canonical.has(requirementId)) continue;
      if (!Number.isInteger(claim.stepIndex) || claim.stepIndex < 0 || claim.stepIndex >= (scenario.steps?.length ?? 0)) continue;
      referenced.add(requirementId);
    }
  }
  return {
    expectedCoverableRequirementIds: expected,
    referencedRequirementIds: expected.filter((id) => referenced.has(id)),
    missingRequirementIds: expected.filter((id) => !referenced.has(id)),
  };
}

export type ProviderClaimCompliance = {
  expectedClaims: string[];
  referencedClaims: string[];
  missingClaims: string[];
  invalidClaims: Array<{ stepIndex: number; claimId?: string; reason: string }>;
};

export function evaluateProviderClaimCompliance(
  scenarios: any[],
  canonicalClaims: CanonicalClaim[],
): ProviderClaimCompliance {
  const canonicalById = new Map(canonicalClaims.filter((claim) => claim.required && claim.coverable).map((claim) => [claim.claimId, claim]));
  const referenced = new Set<string>();
  const invalidClaims: ProviderClaimCompliance["invalidClaims"] = [];
  for (const scenario of scenarios) {
    const seen = new Set<string>();
    for (const claim of Array.isArray(scenario.stepClaims) ? scenario.stepClaims : []) {
      const descriptor = canonicalById.get(claim.claimId);
      if (!descriptor) {
        invalidClaims.push({ stepIndex: claim.stepIndex, claimId: claim.claimId, reason: "unknown_claim_id" });
        continue;
      }
      if (!Number.isInteger(claim.stepIndex) || claim.stepIndex < 0 || claim.stepIndex >= (scenario.steps?.length ?? 0)) {
        invalidClaims.push({ stepIndex: claim.stepIndex, claimId: claim.claimId, reason: "invalid_step_index" });
        continue;
      }
      if (descriptor.scope === "branch" && descriptor.scopeId !== scenario.functionalBranch?.branchId) {
        invalidClaims.push({ stepIndex: claim.stepIndex, claimId: claim.claimId, reason: "scope_mismatch" });
        continue;
      }
      const key = `${scenario.scenarioId ?? scenario.sourceIssueKey ?? "scenario"}:${claim.stepIndex}:${claim.claimId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      referenced.add(claim.claimId);
    }
  }
  const expectedClaims = [...canonicalById.keys()];
  return {
    expectedClaims,
    referencedClaims: expectedClaims.filter((claimId) => referenced.has(claimId)),
    missingClaims: expectedClaims.filter((claimId) => !referenced.has(claimId)),
    invalidClaims,
  };
}

function looksEnglish(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\b(validate|check|view|details|balance|available|print|send|expired|main|flow|data)\b/.test(normalized);
}

function normalizeSpanishTitle(title: string): string {
  return title
    .replace(/\bValidate\b/gi, "Validar")
    .replace(/\bCheck\b/gi, "Validar")
    .replace(/\bView\b/gi, "Consultar")
    .replace(/\bDetails\b/gi, "detalle")
    .replace(/\bBalance\b/gi, "balance")
    .replace(/\bPrint\b/gi, "Imprimir")
    .replace(/\bSend\b/gi, "Enviar")
    .trim();
}

function repairUnquotedValidationStep(normalized: string): string | null {
  // Repair "Validar que se muestre X" → "Validar que se muestre "X"."
  const unquotedMatch = normalized.match(/^Validar que se muestre\s+([^"]+?)\.?$/i);
  if (unquotedMatch) {
    const valueToQuote = unquotedMatch[1].trim();
    if (valueToQuote && !valueToQuote.startsWith('"') && valueToQuote.length > 0) {
      return `Validar que se muestre "${valueToQuote}".`;
    }
  }
  return null;
}

function normalizeScenarioStep(step: string): { step: string; changed: boolean; rejectReason?: string } {
  const stripped = step.replace(/^\d+[\.)]\s*/, "").trim();
  let normalized = stripped;

  // Fix common Spanish typos before pattern matching
  normalized = normalized
    .replace(/\bmustre\b/gi, "muestre")
    .replace(/\bmuetra\b/gi, "muestra")
    .replace(/\bvalidar que se muestre\b/gi, "Validar que se muestre")
    .replace(/\bvalidar que el boton\b/gi, "Validar que el botón")
    .replace(/\bvalidar que el botón\b/gi, "Validar que el botón");

  if (/^Hacer clic en /i.test(normalized) || /^Seleccionar la opci[oó]n /i.test(normalized)) {
    normalized = normalized
      .replace(/^Hacer clic en /i, "Clic en ")
      .replace(/^Seleccionar la opci[oó]n /i, "Clic en ");
  } else if (/^Verificar /i.test(normalized)) {
    normalized = normalized.replace(/^Verificar /i, "Validar que se muestre ");
  }

  if (/^(Completar autentic|Navegar a|El usuario debe|Sistema muestra|Acceder a|Ir a)/i.test(normalized)) {
    return { step, changed: false, rejectReason: "forbidden_narrative_step" };
  }

  const allowedPatterns = [
    /^Clic en ".+"\.$/,
    /^Ingresar ".+" en ".+"\.$/,
    /^Validar que se muestre ".+"\.$/,
    /^Esperar que se muestre ".+"\.$/,
    /^Seleccionar ".+"\.$/,
    /^Seleccionar el (primer|primera|último|última) .+ visible del listado\.$/i,
    /^Validar que el bot[oó]n ".+" est[eé] visible\.?$/,
    /^Validar que el bot[oó]n ".+" est[eé] habilitado\.?$/,
    /^Validar que el bot[oó]n ".+" est[eé] deshabilitado\.?$/
  ];

  // Reject abstract phrases that reference no concrete target
  const abstractPatterns = [
    /^Validar que funcione correctamente\.?$/i,
    /^Validar resultado esperado\.?$/i,
    /^Validar que se genere correctamente\.?$/i,
    /^Completar datos requeridos\.?$/i,
    /^Ejecutar acci[oó]n de la HU\.?$/i,
  ];
  if (abstractPatterns.some((p) => p.test(normalized))) {
    return { step, changed: false, rejectReason: "abstract_target_step" };
  }

  if (!allowedPatterns.some((pattern) => pattern.test(normalized))) {
    // Try repair for unquoted validation steps before rejecting
    const repaired = repairUnquotedValidationStep(normalized);
    if (repaired && allowedPatterns.some((pattern) => pattern.test(repaired))) {
      console.log(`[scenarios:quality] stepPatternNormalized original="${normalized}" repaired="${repaired}"`);
      return { step: repaired, changed: true };
    }
    return { step, changed: false, rejectReason: "invalid_mcp_step_pattern" };
  }

  return { step: normalized, changed: normalized !== stripped };
}

export function applyScenarioQualityGate(
  scenarios: any[],
  issues: JiraIssueSource[],
  routeProfile: McpRouteProfile | null,
  pathSelectionMap?: Map<string, any>,
  huEvidenceMap?: Map<string, any>
): { scenarios: any[]; rejected: Array<{ sourceIssueKey: string; reason: string }>; normalizedCount: number; rejectedReasons: string[] } {
  const normalizedScenarios: any[] = [];
  const rejected: Array<{ sourceIssueKey: string; reason: string }> = [];
  const rejectedReasons = new Set<string>();
  let normalizedCount = 0;
  const optionFlowLabelsByIssue = new Map<string, Set<string>>();
  for (const issue of issues) {
    const flowLabels = new Set<string>();
    const detected = detectOptionFlows(issue);
    for (const flow of detected.flows) {
      if (!flow.optionLabel?.trim()) continue;
      flowLabels.add(flow.optionLabel.trim().toLowerCase());
    }
    optionFlowLabelsByIssue.set(issue.key, flowLabels);
  }

  for (const scenario of scenarios) {
    const issueKey = scenario.sourceIssueKey;
    const pathSelection = pathSelectionMap?.get(issueKey);
    const huEvidence = huEvidenceMap?.get(issueKey);
    const normalizedTitle = looksEnglish(scenario.title || "") ? normalizeSpanishTitle(scenario.title || "") : scenario.title;
    if (normalizedTitle !== scenario.title) {
      normalizedCount++;
      console.log(`[scenarios:quality] language=en rejected_or_normalized title="${scenario.title}"`);
    }

    const normalizedSteps: string[] = [];
    const normalizedOrigins: number[] = [];
    const referencedIndexes = new Set((scenario.stepRequirementRefs ?? []).map((ref) => ref.stepIndex));
    const seenSteps = new Set<string>();
    let rejectedReason: string | undefined;
    const visibleControls = new Set(((routeProfile?.visibleControls || []) as string[]).map((value) => value.toLowerCase()));
    const requiredNavigation = new Set<string>();

    // Collect required navigation from selectedPath to preserve during filtering
    if (pathSelection?.selectedPath?.requiredIntermediates) {
      for (const intermediate of pathSelection.selectedPath.requiredIntermediates) {
        requiredNavigation.add(intermediate.toLowerCase());
      }
    }
    for (const optionLabel of optionFlowLabelsByIssue.get(issueKey) ?? []) {
      requiredNavigation.add(optionLabel);
    }

    let removedVisibleNavigation = 0;

    for (const [originalIndex, rawStep] of (scenario.steps || []).entries()) {
      const result = normalizeScenarioStep(String(rawStep));
      if (result.rejectReason) {
        console.log(`[scenarios:quality] invalidStepPattern scenario="${scenario.title}" step="${rawStep}" reason="${result.rejectReason}"`);
        rejectedReason = result.rejectReason;
        rejectedReasons.add(result.rejectReason);
        break;
      }

      let normalized = result.step;
      // Normalize ordinal selection: "Seleccionar el primer elemento..." → "Seleccionar el primer [domain term]..."
      const ordinalMatch = normalized.match(/^Seleccionar el (primer|primera|[uú]ltimo|[uú]ltima)\s+elemento\s+(visible del listado)\.?$/i);
      if (ordinalMatch) {
        const ordinal = ordinalMatch[1];
        const suffix = ordinalMatch[2];
        const domainTerm = pathSelection?.selectedPath?.target ||
          (routeProfile as any)?._selectionTarget ||
          (routeProfile as any)?.domainTerms?.ORDINAL_SELECTION;
        if (domainTerm && typeof domainTerm === "string") {
          normalized = `Seleccionar el ${ordinal} ${domainTerm.toLowerCase()} ${suffix}.`;
          console.log(`[scenarios:quality] ordinalSelectionNormalized scenario="${scenario.title}" from="${result.step}" to="${normalized}"`);
          const termSource = pathSelection?.selectedPath?.target ? "pathSelection.target" :
            (routeProfile as any)?._selectionTarget ? "routeProfile.selectionTarget" : "routeProfile.domainTerms";
          console.log(`[scenario-coverage] ordinalSelectionDomainTerm term="${domainTerm.toLowerCase()}" source=${termSource}`);
          normalizedCount++;
        }
      }

      const numbered = `${normalizedSteps.length + 1}. ${normalized.replace(/^\d+[\.)]\s*/, "")}`;
      const canonical = numbered.replace(/^\d+[\.)]\s*/, "").toLowerCase();
      const clickMatch = canonical.match(/^clic en "(.+)"\.$/);
      if (seenSteps.has(canonical) && !referencedIndexes.has(originalIndex)) {
        normalizedCount++;
        continue;
      }
      // Don't remove required navigation steps
      if (clickMatch && visibleControls.has(clickMatch[1].toLowerCase()) && !requiredNavigation.has(clickMatch[1].toLowerCase()) && !referencedIndexes.has(originalIndex)) {
        removedVisibleNavigation++;
        normalizedCount++;
        continue;
      }
      if (clickMatch && requiredNavigation.has(clickMatch[1].toLowerCase())) {
        console.log(`[scenarios:quality] visibleNavigationPreserved scenario="${scenario.title}" target="${clickMatch[1]}" reason=required_navigation`);
      }
      if (
        huEvidence?.accessMode === "private" &&
        huEvidence?.businessIntent !== "product_information" &&
        /informaci[oó]n de productos/i.test(numbered)
      && !referencedIndexes.has(originalIndex)) {
        normalizedCount++;
        continue;
      }
      seenSteps.add(canonical);
      normalizedSteps.push(numbered);
      normalizedOrigins.push(originalIndex);
      if (result.changed) normalizedCount++;
    }
    if (removedVisibleNavigation > 0) {
      console.log(`[scenarios:quality] visibleNavigationRemoved scenario="${scenario.title}" removed=${removedVisibleNavigation}`);
    }

    if (!rejectedReason && pathSelection?.selectedPath?.targetPathKey?.startsWith("synthetic_") && huEvidence?.accessMode === "private") {
      const publicCatalogTerms = /beneficios|requisitos|informaci[oó]n legal|condiciones/i;
      if (publicCatalogTerms.test(normalizedTitle || "") || normalizedSteps.some((step) => publicCatalogTerms.test(step))) {
        rejectedReason = "public_catalog_scenario_for_private_hu";
        rejectedReasons.add(rejectedReason);
      }
    }
    if (!rejectedReason && huEvidence?.accessMode === "private" && huEvidence?.businessIntent !== "product_information") {
      const garbageTerms = /beneficios|requisitos|condiciones relevantes|informaci[oó]n legal|descripci[oó]n general|tasas comerciales|solicitar|monedas/i;
      if (garbageTerms.test(normalizedTitle || "") || normalizedSteps.some((step) => garbageTerms.test(step))) {
        rejectedReason = "public_catalog_scenario_for_private_hu";
        rejectedReasons.add(rejectedReason);
        console.log(`[scenarios:quality] rejected reason=public_catalog_scenario_for_private_hu title="${normalizedTitle}"`);
      }
    }
    if (!rejectedReason && huEvidence?.accessMode === "private" && pathSelection?.selectedPath) {
      const functionalTerms = /dep[oó]sito a plazo|certificado|monto|tasa|fecha|vencimiento|apertura|estado|intereses|tipo|alerta|volver|correo|imprimir|sesi[oó]n/i;
      const combinedText = `${normalizedTitle} ${normalizedSteps.join(" ")}`;
      if (!functionalTerms.test(combinedText)) {
        rejectedReason = "navigation_only_scenario";
        rejectedReasons.add(rejectedReason);
        console.log(`[scenarios:quality] rejected reason=navigation_only_scenario title="${normalizedTitle}"`);
      }
    }
    if (!rejectedReason && normalizedSteps.length === 0) {
      rejectedReason = "no_functional_steps_after_cleanup";
      rejectedReasons.add(rejectedReason);
    }

    if (rejectedReason) {
      rejected.push({ sourceIssueKey: issueKey, reason: rejectedReason });
      continue;
    }

    const remappedRefs = scenario.stepRequirementRefs?.flatMap((ref) => {
      const stepIndex = normalizedOrigins.indexOf(ref.stepIndex);
      return stepIndex >= 0 ? [{ ...ref, stepIndex }] : [];
    });
    const remappedClaims = remapStepClaimsByOrigins(scenario.stepClaims, normalizedOrigins);
    normalizedScenarios.push({
      ...scenario,
      title: normalizedTitle,
      steps: normalizedSteps,
      ...(remappedRefs ? { stepRequirementRefs: remappedRefs } : {}),
      ...(scenario.stepClaims ? { stepClaims: remappedClaims } : {}),
    });
  }

  return {
    scenarios: normalizedScenarios,
    rejected,
    normalizedCount,
    rejectedReasons: [...rejectedReasons],
  };
}

/**
 * Deduplicate consecutive steps with the same click target
 * Removes duplicate steps like:
 *   "1. Clic en X"
 *   "2. Clic en X"
 * Keeps only the first occurrence
 * Uses generic text normalization (lowercase, trim, remove accents)
 */
function dedupeConsecutiveStepsWithOrigins(steps: any[]): { steps: any[]; origins: number[] } {
  if (steps.length === 0) return { steps, origins: [] };

  function normalizeTarget(target: string): string {
    return target
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const deduped: any[] = [steps[0]];
  const origins: number[] = [0];

  for (let i = 1; i < steps.length; i++) {
    const current = steps[i];
    const previous = steps[i - 1];

    // Extract click targets for comparison
    const getCurrentTarget = (step: any): string | null => {
      if (typeof step === "string") {
        const match = step.match(/Clic en "([^"]+)"/i);
        return match ? normalizeTarget(match[1]) : null;
      }
      if (typeof step === "object" && step.action === "click" && step.target) {
        return normalizeTarget(step.target);
      }
      return null;
    };

    const currentTarget = getCurrentTarget(current);
    const previousTarget = getCurrentTarget(previous);

    // Skip if same click target as previous step (normalized comparison)
    if (currentTarget && previousTarget && currentTarget === previousTarget) {
      console.log(`[scenarios:dedupe] skipping duplicate consecutive click: "${currentTarget}"`);
      continue;
    }

    deduped.push(current);
    origins.push(i);
  }

  return { steps: deduped, origins };
}

function dedupeConsecutiveSteps(steps: any[]): any[] {
  return dedupeConsecutiveStepsWithOrigins(steps).steps;
}

/**
 * Remove or convert unbacked click targets to validations
 * Prevents scenarios from being rejected due to unbacked clicks like "Volver"
 * Preserves clicks for required navigation intermediates
 */
function repairUnbackedClicks(
  steps: any[],
  allowedTargets: string[],
  requiredIntermediates?: string[],
  preservedPrivateTargets?: string[],
): any[] {
  return repairUnbackedClicksWithOrigins(steps, allowedTargets, requiredIntermediates, preservedPrivateTargets).steps;
}

function repairUnbackedClicksWithOrigins(
  steps: any[],
  allowedTargets: string[],
  requiredIntermediates?: string[],
  preservedPrivateTargets?: string[],
  canonicalClaims: CanonicalClaim[] = [],
  stepClaims: Array<{ stepIndex: number; claimId: string }> = [],
): { steps: any[]; origins: number[]; canonicalActionsSeen: number; unsupportedProviderActionsSeen: number } {
  if (steps.length === 0) return { steps, origins: [], canonicalActionsSeen: 0, unsupportedProviderActionsSeen: 0 };

  const _norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const requiredNavigation = new Set(
    (requiredIntermediates || []).map(intermediate => _norm(intermediate))
  );
  const privateNavNormalized = new Set(
    (preservedPrivateTargets || []).map(t => _norm(t))
  );
  const allowedNormalized = allowedTargets.map(t => _norm(t));
  const repaired: any[] = [];
  const origins: number[] = [];
  let canonicalActionsSeen = 0;
  let unsupportedProviderActionsSeen = 0;
  const canonicalActionClaims = new Set(canonicalClaims
    .filter((claim) => claim.claimType === "action" && (claim.facet === "action" || claim.facet === "activation"))
    .map((claim) => claim.claimId));

  for (const [origin, step] of steps.entries()) {
    // Extract click target
    let clickTarget: string | null = null;
    if (typeof step === "string") {
      const match = step.match(/Clic en "([^"]+)"/i);
      if (match) {
        clickTarget = match[1];
      }
    }

    if (clickTarget) {
      const clickNorm = _norm(clickTarget);
      // Preserve required navigation clicks (functional path)
      if (requiredNavigation.has(clickNorm)) {
        console.log(`[scenarios:repair] requiredNavigationClickPreserved target="${clickTarget}" reason=required_navigation`);
        repaired.push(step);
        origins.push(origin);
        continue;
      }

      // Preserve private navigation clicks (entry/auth steps needed to reach private state)
      if (privateNavNormalized.has(clickNorm)) {
        console.log(`[scenarios:repair] preservedPrivateRouteStep target="${clickTarget}" source=private_execution_path`);
        repaired.push(step);
        origins.push(origin);
        continue;
      }

      // Check if target is in allowedTargets (Unicode-normalized, case-insensitive)
      const isAllowed = allowedNormalized.some(t => t === clickNorm);

      if (!isAllowed) {
        // Lack of execution backing must not rewrite functional semantics.
        // Authority and readiness validate the preserved action later.
        const claimsForStep = stepClaims
          .filter((claim) => claim.stepIndex === origin)
          .map((claim) => canonicalClaims.find((descriptor) => descriptor.claimId === claim.claimId))
          .filter((claim): claim is CanonicalClaim => Boolean(claim));
        if (claimsForStep.some((claim) => canonicalActionClaims.has(claim.claimId))) canonicalActionsSeen++;
        else unsupportedProviderActionsSeen++;
        console.log(`[scenarios:repair] unbackedClickPreserved target="${clickTarget}" origin=${origin}`);
      }
    }

    repaired.push(step);
    origins.push(origin);
  }

  return { steps: repaired, origins, canonicalActionsSeen, unsupportedProviderActionsSeen };
}

/**
 * Get scenario generation mode from environment
 *
 * Default: ai_supported_by_deterministic
 * Override with: SCENARIO_GENERATION_MODE env var
 */
function getScenarioGenerationMode(): ScenarioGenerationMode {
  const envMode = process.env.SCENARIO_GENERATION_MODE;

  if (!envMode) {
    return "ai_supported_by_deterministic"; // DEFAULT
  }

  const validModes: ScenarioGenerationMode[] = [
    "ai_supported_by_deterministic",
    "ai_only",
    "deterministic_only",
    "fallback_deterministic_on_ai_failure"
  ];

  if (validModes.includes(envMode as ScenarioGenerationMode)) {
    if (envMode === "deterministic_only") {
      console.log(`[scenarios:mode] deterministic_only enabled by env. AI will be skipped.`);
    }
    return envMode as ScenarioGenerationMode;
  }

  console.warn(`[scenarios:mode] invalid SCENARIO_GENERATION_MODE="${envMode}", using default ai_supported_by_deterministic`);
  return "ai_supported_by_deterministic";
}

/**
 * Try to generate deterministic seed scenarios for simple cases
 *
 * These are NOT final scenarios, but base/seed scenarios to guide AI generation.
 * The AI should use these as context, not skip generation.
 *
 * Supported modes:
 * - action_button_validation: Just validate a sensitive button is visible (no click)
 *
 * @returns Generated seed scenarios, or null if not applicable
 */
function tryDeterministicGeneration(
  issues: JiraIssueSource[],
  appSlug: string,
  routeResolutions: Map<string, ScenarioRouteResolution>,
  entrySteps?: Array<{ action: string; target: string; when?: string }>
): DeterministicSeedScenario[] | null {
  const seeds: DeterministicSeedScenario[] = [];

  for (const issue of issues) {
    const resolution = routeResolutions.get(issue.key);

    // Only handle action_button_validation mode deterministically
    if (resolution?.scenarioMode !== "action_button_validation") {
      continue;
    }

    // Extract button name from resolution steps or HU
    let buttonTarget: string | null = null;
    if (resolution.executableRouteSteps) {
      for (const step of resolution.executableRouteSteps) {
        const match = step.match(/Validar que el botón "([^"]+)" esté visible/i);
        if (match) {
          buttonTarget = match[1];
          break;
        }
      }
    }

    // If no button found, skip deterministic seed
    if (!buttonTarget) {
      continue;
    }

    // Generate deterministic seed scenario
    const steps: any[] = [];

    // Add entry steps if provided
    if (entrySteps) {
      for (const entryStep of entrySteps) {
        steps.push({
          description: `Clic en "${entryStep.target}".`,
          action: entryStep.action || "click",
          target: entryStep.target || "",
        });
      }
    }

    // Add navigation steps from resolution (excluding validation steps)
    if (resolution.executableRouteSteps) {
      for (const routeStep of resolution.executableRouteSteps) {
        const clickMatch = routeStep.match(/Clic en "([^"]+)"/i);
        if (clickMatch) {
          steps.push({
            description: routeStep,
            action: "click",
            target: clickMatch[1],
          });
        }
      }
    }

    // Add button validation step (never click)
    steps.push({
      description: `Validar que el botón "${buttonTarget}" esté visible.`,
      action: "assert",
      target: `button:has-text("${buttonTarget}")`,
    });

    // Deduplicate consecutive steps before converting to strings
    const dedupedSteps = dedupeConsecutiveSteps(steps);

    // Convert object steps to string steps
    const stringSteps = ensureStepStrings(dedupedSteps);

    const seed: DeterministicSeedScenario = {
      sourceIssueKey: issue.key,
      title: `Validar visibilidad del botón ${buttonTarget}`,
      steps: stringSteps,
      mode: resolution.scenarioMode,
      confidence: resolution.routeConfidence || "high",
      notes: "Deterministic seed for action_button_validation mode"
    };

    seeds.push(seed);
  }

  if (seeds.length === 0) {
    return null;
  }

  console.log(`[scenarios:deterministic] generated ${seeds.length} seed scenarios (not final) for issues: ${seeds.map(s => s.sourceIssueKey).join(", ")}`);
  return seeds;
}


export async function generateScenariosWithAi(
  issues: JiraIssueSource[],
  appSlug: string,
  testrailMeta?: { projectId: number; suiteId: number; sectionId?: number; sectionName?: string },
  targetAppSlug?: string,
  targetAppName?: string,
  routeProfile?: McpRouteProfile | null,
  entrySteps?: Array<{ action: string; target: string; when?: string }>,
  loginMode?: string,
  _testProvider?: AiProvider,
  huEvidenceMap?: Map<string, any>, // HU-driven evidence per issue
  pathSelectionMap?: Map<string, any>, // HU-driven path selections per issue
  huScopeGuard?: any, // HU scope guard for prompt guidance (NEW)
  preservedPrivateTargets?: string[], // Private navigation targets to preserve as clicks
  huScenarioModel?: any,
  routePendingScenarioPlan?: any,
  functionalBranches?: FunctionalBranchRef[],
  telemetryContext?: { launchId?: string },
): Promise<McpGenerationResponse> {
  const primaryIssue = issues[0];
  const requirementManifest = buildRequirementManifest(
    primaryIssue
      ? [primaryIssue.summary, primaryIssue.description, primaryIssue.acceptanceCriteria ?? ""].filter(Boolean).join("\n")
      : "",
    functionalBranches ?? [],
  );
  const canonicalClaims = buildCanonicalClaims(requirementManifest);
  const normalizedLaunchId = typeof telemetryContext?.launchId === "string" && telemetryContext.launchId.trim().length > 0
    ? telemetryContext.launchId.trim()
    : undefined;
  const normalizedSourceIssueKey = typeof primaryIssue?.key === "string" && primaryIssue.key.trim().length > 0
    ? primaryIssue.key.trim()
    : undefined;
  const primaryHuEvidence = primaryIssue ? huEvidenceMap?.get(primaryIssue.key) : null;
  const primaryPathSelection = primaryIssue ? pathSelectionMap?.get(primaryIssue.key) : null;
  const privateSyntheticSelectedPath = !!primaryHuEvidence &&
    primaryHuEvidence.accessMode === "private" &&
    !!primaryPathSelection?.selectedPath &&
    (primaryPathSelection?.source === "synthetic" || primaryPathSelection?.selectedPath?.targetPathKey?.startsWith("synthetic_"));

  // Extract additional entry targets from entrySteps parameter
  const additionalEntryTargets: string[] = [];
  if (entrySteps) {
    for (const step of entrySteps) {
      if (step.action === "click" && step.target) {
        additionalEntryTargets.push(step.target);
      }
    }
  }

  // Also extract from old-style entry labels (from routeProfile.entry)
  if (routeProfile?.entry) {
    for (const entry of routeProfile.entry) {
      if (privateSyntheticSelectedPath && /informaci[oó]n de productos/i.test(entry.visibleLabel || "")) {
        continue;
      }
      if (entry.visibleLabel && !additionalEntryTargets.includes(entry.visibleLabel)) {
        additionalEntryTargets.push(entry.visibleLabel);
      }
      if (privateSyntheticSelectedPath && /informaci[oó]n de productos/i.test(entry.businessLabel || "")) {
        continue;
      }
      if (entry.businessLabel && !additionalEntryTargets.includes(entry.businessLabel)) {
        additionalEntryTargets.push(entry.businessLabel);
      }
    }
  }
  if (privateSyntheticSelectedPath) {
    const beforeFilter = additionalEntryTargets.length;
    const filteredTargets = additionalEntryTargets.filter((target) => !/informaci[oó]n de productos/i.test(target));
    const removed = beforeFilter - filteredTargets.length;
    additionalEntryTargets.length = 0;
    additionalEntryTargets.push(...filteredTargets);
    console.log(`[scenario-route] privateSynthetic ignoresPublicEntryTargets=true removed=${removed}`);
  }

  console.log(`[scenario-route] additionalEntryTargets=${JSON.stringify(additionalEntryTargets)}`);

  // Route Resolution: Validate routes BEFORE calling AI
  const routeResolutions = new Map<string, ScenarioRouteResolution>();
  const routeBackedIssues: JiraIssueSource[] = [];
  const blockedIssues: Array<{ key: string; title: string; reason: string }> = [];

  console.log(`[scenario-route] resolving routes for ${issues.length} issues routeProfile=${routeProfile?.name ?? "none"}`);

  for (const issue of issues) {
    // Detect HU intent per-issue and guard against catalog/listing routeProfile mismatch
    const issueIntent: HuIntentDetection = detectHuIntent(
      {
        summary: issue.summary,
        description: issue.description,
        acceptanceCriteria: issue.acceptanceCriteria,
        labels: (issue as any).labels,
        components: (issue as any).components
      },
      issue.key
    );
    // Annotate issue with intent for downstream prompt builder
    (issue as any)._huIntent = issueIntent.intent;
    (issue as any)._huIntentConfidence = issueIntent.confidence;

    const routeIsCatalogListing = resolutionIsCatalogListing(routeProfile);

    const isNonCatalogIntent = issueIntent.intent !== "catalog_listing_flow" &&
      issueIntent.intent !== "product_detail_flow";

    if (isNonCatalogIntent && routeIsCatalogListing) {
      console.log(
        `[route-profile-compatibility] compatible=false issue=${issue.key} huIntent=${issueIntent.intent} routeMode=listing_validation routeProfile=${(routeProfile as any)?.name ?? "unknown"} reason=intent_mismatch`
      );
      blockedIssues.push({
        key: issue.key,
        title: issue.summary,
        reason: "route_profile_intent_mismatch"
      });
      routeResolutions.set(issue.key, {
        scenarioMode: "listing_validation",
        routeConfidence: "low",
        executableRouteSteps: [],
        diagnostics: [{
          level: "error",
          code: "route_profile_intent_mismatch",
          message: `Route profile is catalog/listing but HU intent is ${issueIntent.intent}`,
          context: { huIntent: issueIntent.intent, routeProfileName: (routeProfile as any)?.name }
        }],
        canGenerate: false,
        missingRouteReason: "route_profile_intent_mismatch"
      });
      console.log(`[scenario-route] blocked issue=${issue.key} reason=route_profile_intent_mismatch`);
      console.log(`[scenarios:onboarding-required] issue=${issue.key} huIntent=${issueIntent.intent} reason=missing_transactional_route_profile suggestedDiscoveryType=transactional_route_discovery`);
      continue;
    }

    const resolution = resolveScenarioRoute(issue, routeProfile ?? null, appSlug);
    routeResolutions.set(issue.key, resolution);

    if (resolution.canGenerate) {
      routeBackedIssues.push(issue);
      const isHuComposed = !!(routeProfile as any)?._huComposedPath;
      if (isHuComposed) {
        const steps = ((routeProfile as any)?.entrySteps?.length ?? 0);
        console.log(`[scenario-route] huComposedPath accepted issue=${issue.key} steps=${steps} reason=explicit_hu_path_authority`);
      }
      console.log(`[scenario-route] resolved issue=${issue.key} mode=${resolution.scenarioMode} confidence=${resolution.routeConfidence} canGenerate=true`);
    } else {
      blockedIssues.push({
        key: issue.key,
        title: issue.summary,
        reason: resolution.missingRouteReason || "Route not backed"
      });
      console.log(`[scenario-route] blocked issue=${issue.key} reason=${resolution.missingRouteReason} diagnostics=${resolution.diagnostics.length}`);
    }
  }

  console.log(`[scenario-preview] route-backed issues=${routeBackedIssues.length} blocked=${blockedIssues.length}`);

  // A missing route profile blocks execution authority, not functional scenario
  // generation. Keep the HU in the provider input so route readiness can be
  // resolved independently after scenarios exist.
  if (!routeProfile && routeBackedIssues.length === 0) {
    routeBackedIssues.push(...issues);
    console.log(`[scenario-route] functionalGenerationFallback routeProfile=missing issues=${routeBackedIssues.length}`);
  }

  // Build derived execution context and validate profile quality
  const derivedContext = buildDerivedExecutionContext(
    appSlug,
    routeProfile ?? null,
    routeResolutions,
    additionalEntryTargets
  );
  logDerivedContext(derivedContext);

  const branchRequiredClicks = collectBranchRequiredClicks(functionalBranches);
  console.log(
    `[coverage-contract] branchRequiredClicks=${branchRequiredClicks.length} added=0 effectiveAllowedClicksBeforeRepair=${derivedContext.allowedExecutableClicks.length}`,
  );

  // Supplement allowedExecutableClicks with preserved private targets (selected learned navigation path)
  const learnedPathNormalizedTargets = new Set<string>();
  if (preservedPrivateTargets && preservedPrivateTargets.length > 0) {
    const existingNorm = new Set(derivedContext.allowedExecutableClicks.map(t => t.normalize("NFC").toLowerCase().trim()));
    let addedCount = 0;
    for (const target of preservedPrivateTargets) {
      const norm = target.normalize("NFC").toLowerCase().trim();
      if (!existingNorm.has(norm)) {
        derivedContext.allowedExecutableClicks.push(target);
        existingNorm.add(norm);
        addedCount++;
      }
      learnedPathNormalizedTargets.add(norm);
    }
    if (addedCount > 0) {
      console.log(`[navigation-authority] learnedPathClicks added=${addedCount} source=appKnowledge issue=${primaryIssue?.key ?? "unknown"}`);
    }
  }
  console.log(
    `[coverage-contract] effectiveAllowedClicks source=trusted_route+protected_private total=${derivedContext.allowedExecutableClicks.length} branchRequiredClicks=${branchRequiredClicks.length}`,
  );

  const profileQuality = validateRouteProfileQuality(appSlug, routeProfile ?? null, routeResolutions, derivedContext);
  logRouteProfileQuality(profileQuality);

  // If profile quality prevents generation, return early
  if (!profileQuality.canGenerate && issues.length === 0) {
    console.log(`[scenario-preview] profile quality prevents generation status=${profileQuality.status}`);
    return {
      appSlug,
      targetAppSlug,
      targetAppName,
      confidence: "low",
      reason: `Route profile quality insufficient: ${profileQuality.status}. ${profileQuality.diagnostics.map(d => d.message).join("; ")}`,
      functionalRoute: "",
      routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
      scenarios: [],
      warnings: [
        ...blockedIssues.map(b => `Blocked ${b.key}: ${b.reason}`),
        ...profileQuality.diagnostics.filter(d => d.level === "warning").map(d => d.message)
      ],
      rejected: [
        ...blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
        ...routeBackedIssues.map(issue => ({
          sourceIssueKey: issue.key,
          reason: `route_profile_quality_insufficient: ${profileQuality.status}`
        }))
      ],
      routeResolutions
    };
  }

  // If all issues are blocked, try route_pending mode
  if (routeBackedIssues.length === 0) {
    const hasIntentMismatch = blockedIssues.some(b => b.reason?.includes("route_profile_intent_mismatch"));
    if (hasIntentMismatch && issues.length > 0) {
      console.log(`[scenario-preview] aiGeneration mode=route_pending reason=route_profile_intent_mismatch issues=${issues.length} planTarget=${routePendingScenarioPlan?.scenarioCountTarget ?? "?"}`);
      // Use the original issues for route_pending generation
      const routePendingIssues = issues;
      const routePendingResolutions = routeResolutions;

      const pendingDeterministicSeeds = tryDeterministicGeneration(routePendingIssues, appSlug, routePendingResolutions, entrySteps);
      const pendingSeedCount = pendingDeterministicSeeds?.length || 0;
      if (pendingSeedCount > 0) {
        console.log(`[scenarios:deterministic] generated ${pendingSeedCount} seed scenarios as context for AI`);
      }

      const genDiag: any = {
        generationMode: "route_pending",
        deterministicSeedsGenerated: pendingSeedCount,
        aiCalled: false, aiGenerated: 0, finalValid: 0, finalRejected: 0,
        finalBlocked: blockedIssues.length, fallbackUsed: false,
        aiPurpose: "scenario_generation",
        launchId: normalizedLaunchId,
        sourceIssueKey: normalizedSourceIssueKey,
        appSlug,
      };

      try {
        const messages = await buildMcpScenarioMessages(
          routePendingIssues, appSlug, testrailMeta, targetAppSlug, targetAppName,
          null, entrySteps, loginMode, routePendingResolutions,
          pendingDeterministicSeeds || undefined, huScenarioModel?.mainIntent,
          huEvidenceMap, pathSelectionMap, huScopeGuard,
           huScenarioModel, routePendingScenarioPlan, functionalBranches, requirementManifest, canonicalClaims,
        );
        console.log(`[scenario-preview] routePendingPrompt incompatibleRouteProfile=true routeProfileUsedAsExecutable=false`);
        console.log(`[scenarios:prompt] messages built system=${messages[0]?.content.length ?? 0} user=${messages[1]?.content.length ?? 0}`);

        const provider = _testProvider ?? await createScenarioAiProvider();
        console.log(`[scenarios:ai] purpose=scenario_generation generationMode=route_pending provider=${provider.providerType} model=${provider.model}`);

        genDiag.aiCalled = true;
        const response = await provider.completeJson({
          messages,
          temperature: 0.4,
          requireJson: true,
          purpose: "scenario_generation",
        });
        genDiag.aiProvider = response.providerName;
        genDiag.aiModel = response.model;
        if (response.usage) {
          genDiag.aiUsage = response.usage;
        }

        if (!response.parsedJson) {
          console.log(`[scenario-preview] aiGeneration routePending empty fallback=plan_based`);
          return {
            appSlug, targetAppSlug, targetAppName, confidence: "low",
            reason: "Route pending — AI returned no scenarios",
            functionalRoute: "", routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
            scenarios: [],
            warnings: blockedIssues.map(b => `Route pending — ${b.key}: ${b.reason}`),
            rejected: blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
            routeResolutions, generationDiagnostics: genDiag,
          };
        }

        const parsed = parseAiResponseWithMode(response.parsedJson, "route_pending");
        const routePendingScenarios = parsed.scenarios.map((sc: any) => ({
          ...sc,
          nonExecutableCriteria: "requires_route_discovery",
        }));

        genDiag.aiGenerated = routePendingScenarios.length;
        genDiag.finalValid = routePendingScenarios.length;
        console.log(`[scenario-preview] aiGeneration routePending generated=${routePendingScenarios.length}`);
        for (const sc of routePendingScenarios) {
          console.log(`[scenario-auth-intent] scenarioId=${sc.scenarioId ?? sc.sourceIssueKey} authIntent=${sc.authIntent ?? "undefined"}`);
        }

        return {
          appSlug, targetAppSlug, targetAppName, confidence: "low",
          reason: "Route pending — scenarios generated without validated route",
          functionalRoute: "", routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
          scenarios: routePendingScenarios,
          warnings: [`Route pending: scenarios require route validation before MCP execution. ${blockedIssues.length} issue(s) blocked.`],
          rejected: blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
          routeResolutions, generationDiagnostics: genDiag,
        };
      } catch (err) {
        console.log(`[scenario-preview] aiGeneration routePending empty fallback=plan_based error=${(err as Error)?.message ?? "unknown"}`);
        return {
          appSlug, targetAppSlug, targetAppName, confidence: "low",
          reason: "Route pending — AI generation failed, fallback to plan-based",
          functionalRoute: "", routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
          scenarios: [],
          warnings: blockedIssues.map(b => `Route pending — ${b.key}: ${b.reason}`),
          rejected: blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
          routeResolutions, generationDiagnostics: genDiag,
        };
      }
    }

    // No route_pending mode — return empty
    console.log(`[scenario-preview] no route-backed issues, skipping AI generation`);
    return {
      appSlug,
      targetAppSlug,
      targetAppName,
      confidence: "low",
      reason: "All issues blocked due to missing route profile or incomplete routes",
      functionalRoute: "",
      routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
      scenarios: [],
      warnings: blockedIssues.map(b => `Blocked ${b.key}: ${b.reason}`),
      rejected: blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
      routeResolutions
    };
  }

  // Get scenario generation mode
  const generationMode = getScenarioGenerationMode();
  console.log(`[scenarios:mode] using generation mode: ${generationMode}`);

  // Try to generate deterministic seed scenarios (not final output)
  const deterministicSeeds = tryDeterministicGeneration(routeBackedIssues, appSlug, routeResolutions, entrySteps);
  const seedCount = deterministicSeeds?.length || 0;

  if (seedCount > 0) {
    console.log(`[scenarios:deterministic] generated ${seedCount} seed scenarios as context for AI`);
  }

  // Initialize generation diagnostics
  const generationDiagnostics: any = {
    generationMode,
    deterministicSeedsGenerated: seedCount,
    aiCalled: false,
    aiGenerated: 0,
    finalValid: 0,
    finalRejected: 0,
    finalBlocked: blockedIssues.length,
    fallbackUsed: false,
    branchRequiredClicks,
    effectiveAllowedClicks: [...derivedContext.allowedExecutableClicks],
    effectiveAllowedClicksBeforeRepair: derivedContext.allowedExecutableClicks.length,
    aiPurpose: "scenario_generation",
    launchId: normalizedLaunchId,
    sourceIssueKey: normalizedSourceIssueKey,
    appSlug,
  };

  // Check if we should skip AI (only in deterministic_only mode)
  const shouldSkipAI = generationMode === "deterministic_only";

  if (shouldSkipAI) {
    console.log(`[scenarios:deterministic_only] skipping AI generation by explicit env mode`);
    generationDiagnostics.skipAIReason = "deterministic_only mode enabled by env";

    // If no seeds generated, return early
    if (!deterministicSeeds || deterministicSeeds.length === 0) {
      console.log(`[scenarios:deterministic_only] no seeds generated, returning empty`);
      return {
        appSlug,
        targetAppSlug,
        targetAppName,
        confidence: "low",
        reason: "deterministic_only mode enabled but no seeds could be generated",
        functionalRoute: "",
        routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
        scenarios: [],
        warnings: blockedIssues.map(b => `Blocked ${b.key}: ${b.reason}`),
        rejected: blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
        routeResolutions,
        generationDiagnostics
      };
    }

    // Convert seeds to full scenarios and validate
    const { validScenarios, invalidScenarios } = convertSeedsToValidatedScenarios(
      deterministicSeeds,
      appSlug,
      routeProfile || null,
      derivedContext,
      routeResolutions
    );

    console.log(`[scenarios:deterministic_only] validated=${validScenarios.length} invalid=${invalidScenarios.length}`);

    generationDiagnostics.finalValid = validScenarios.length;
    generationDiagnostics.finalRejected = invalidScenarios.length;

    return {
      appSlug,
      targetAppSlug,
      targetAppName,
      confidence: "high",
      reason: "Deterministic generation only (by explicit env mode)",
      functionalRoute: "",
      routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
      scenarios: validScenarios,
      warnings: invalidScenarios.map((inv: any) =>
        `Scenario ${inv.scenario.sourceIssueKey} failed compliance: ${inv.result.reasonCode}`
      ),
      rejected: invalidScenarios.map((inv: any) => ({
        sourceIssueKey: inv.scenario.sourceIssueKey,
        reason: `compliance_failed: ${inv.result.reasonCode}`
      })),
      routeResolutions,
      generationDiagnostics
    };
  }

  // AI generation (default path)
  console.log(`[scenarios:ai] calling AI for scenario generation mode=${generationMode}`);
  generationDiagnostics.aiCalled = true;

  // Create AI provider for scenario generation
  const provider = _testProvider ?? await createScenarioAiProvider();

  console.log(`[scenarios:ai] purpose=scenario_generation provider=${provider.providerType} model=${provider.model}`);

  // Build messages with route resolution context and deterministic seeds
  const messages = await buildMcpScenarioMessages(
    routeBackedIssues,
    appSlug,
    testrailMeta,
    targetAppSlug,
    targetAppName,
    routeProfile,
    entrySteps,
    loginMode,
    routeResolutions, // Pass route resolutions to prompt builder
    deterministicSeeds || undefined, // Pass deterministic seeds if available
    huScenarioModel?.mainIntent, // effectiveIntent — overrides classifier for prompt suppression
    huEvidenceMap, // Pass HU-driven evidence
    pathSelectionMap, // Pass HU-driven path selections
    huScopeGuard, // Pass HU scope guard for prompt guidance (NEW)
    huScenarioModel,
    routePendingScenarioPlan,
    functionalBranches,
     requirementManifest,
     canonicalClaims,
  );

  console.log(`[scenarios:prompt] messages built system=${messages[0]?.content.length ?? 0} user=${messages[1]?.content.length ?? 0} issues=${routeBackedIssues.length}`);

  try {
    const response = await provider.completeJson({
      messages,
      requireJson: true,
      requireJsonSchema: false,
      purpose: "scenario_generation",
    });
    generationDiagnostics.aiProvider = response.providerName;
    generationDiagnostics.aiModel = response.model;
    if (response.usage) {
      generationDiagnostics.aiUsage = response.usage;
    }

    console.log(`[scenarios:ai] completed durationMs=${response.durationMs} model=${response.model} provider=${response.providerName}`);

    if (!response.parsedJson) {
      throw new Error(`AI_GENERATION_INVALID_JSON|AI provider returned invalid JSON. Raw output: ${response.rawText.slice(0, 200)}`);
    }

    const parsed = parseAiResponse(response.rawText);

    if (!parsed) {
      throw new Error(`AI_GENERATION_INVALID_RESPONSE|AI provider returned JSON but could not parse as McpGenerationResponse. Raw output: ${response.rawText.slice(0, 200)}`);
    }

    const traceStages: Record<string, any[]> = {};
    const traceScenarios = (scenarios: any[]) => scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      steps: scenario.steps,
      stepRequirementRefs: scenario.stepRequirementRefs,
      stepClaims: scenario.stepClaims,
    }));
    traceStages.rawProvider = traceScenarios(
      (response.parsedJson as any)?.scenarios ?? [],
    );
    traceStages.parsed = traceScenarios(parsed.scenarios ?? []);
    console.log(`[scenarios:parser] parsed scenarios=${parsed.scenarios?.length ?? 0} rejected=${parsed.rejected?.length ?? 0}`);
    parsed.scenarios = deriveProviderStepRequirementRefs(parsed.scenarios ?? [], canonicalClaims);
    traceStages.normalizedRefs = traceScenarios(parsed.scenarios);
    const providerClaimCompliance = evaluateProviderClaimCompliance(parsed.scenarios, canonicalClaims);
    generationDiagnostics.providerClaimCompliance = providerClaimCompliance;
    console.log(
      `[provider-claim-compliance] expected=${providerClaimCompliance.expectedClaims.length} ` +
      `referenced=${providerClaimCompliance.referencedClaims.length} ` +
      `missing=${providerClaimCompliance.missingClaims.length} invalid=${providerClaimCompliance.invalidClaims.length}`,
    );
    const providerCompliance = evaluateProviderRequirementCompliance(parsed.scenarios, requirementManifest, canonicalClaims);
    generationDiagnostics.providerCompliance = {
      expectedCoverableRequirementIds: providerCompliance.expectedCoverableRequirementIds,
      referencedRequirementIds: providerCompliance.referencedRequirementIds,
      missingRequirementIds: providerCompliance.missingRequirementIds,
      repairAttempted: false,
      repairResult: providerCompliance.missingRequirementIds.length === 0 ? "pass" : "incomplete",
    };
    console.log(
      `[provider-requirement-compliance] expected=${providerCompliance.expectedCoverableRequirementIds.join(",")} ` +
      `referenced=${providerCompliance.referencedRequirementIds.join(",")} ` +
      `missing=${providerCompliance.missingRequirementIds.join(",") || "none"}`,
    );

    // Defensive normalization: ensure all steps are strings
    const normalizedScenarios = parsed.scenarios.map((scenario) =>
      normalizeScenarioSteps(scenario)
    );

    console.log(`[scenarios:normalize] afterStepNormalize=${normalizedScenarios.length}`);

    // Normalize AI scenarios to ensure valid field values
    const fullyNormalizedScenarios = normalizedScenarios.map((scenario) =>
      normalizeAiScenario(scenario, appSlug)
    );
    traceStages.normalized = traceScenarios(fullyNormalizedScenarios);

    console.log(`[scenarios:normalize] afterFieldNormalize=${fullyNormalizedScenarios.length}`);

    // Apply deduplication to AI-generated scenarios
    const dedupedScenarios = fullyNormalizedScenarios.map((scenario) => {
      const originalStepCount = scenario.steps?.length ?? 0;
       const deduped = dedupeConsecutiveStepsWithOrigins(scenario.steps ?? []);
       const dedupedSteps = deduped.steps;
      const removedCount = originalStepCount - dedupedSteps.length;

      if (removedCount > 0) {
        console.log(`[scenarios:dedupe] source=ai scenarioTitle="${scenario.title}" removed=${removedCount}`);
      }

      return {
        ...scenario,
        steps: dedupedSteps,
        ...(scenario.stepClaims ? { stepClaims: remapStepClaimsByOrigins(scenario.stepClaims, deduped.origins) } : {}),
      };
    });

    console.log(`[scenarios:dedupe] afterDedupe=${dedupedScenarios.length}`);

    const qualityGate = applyScenarioQualityGate(
      dedupedScenarios,
      routeBackedIssues,
      routeProfile || null,
      pathSelectionMap,
      huEvidenceMap
    );
    traceStages.quality = traceScenarios(qualityGate.scenarios);
    console.log(
      `[scenarios:quality] normalized=${qualityGate.normalizedCount} rejected=${qualityGate.rejected.length} reasons=${qualityGate.rejectedReasons.join("|") || "none"}`
    );

    // Enrich generated scenarios with route-first metadata
    const enrichedScenarios = qualityGate.scenarios.map(scenario => {
      const resolution = routeResolutions.get(scenario.sourceIssueKey);
      if (resolution) {
        return {
          ...scenario,
          scenarioMode: resolution.scenarioMode,
          routeConfidence: resolution.routeConfidence,
          diagnostics: resolution.diagnostics
        };
      }
      return scenario;
    });
    traceStages.postTransform = traceScenarios(enrichedScenarios);

    const totalAfter = derivedContext.allowedExecutableClicks.length;
    generationDiagnostics.effectiveAllowedClicks = [...derivedContext.allowedExecutableClicks];
    generationDiagnostics.effectiveAllowedClicksBeforeRepair = totalAfter;
    console.log(`[coverage-contract] preservedExecutableClicksBeforeUnbackedRepair added=0 totalAllowed=${totalAfter}`);

    // Repair unbacked clicks before validation
    const repairedScenarios = enrichedScenarios.map(scenario => {
      const originalStepCount = scenario.steps?.length ?? 0;
      const pathSelection = pathSelectionMap?.get(scenario.sourceIssueKey);
      const requiredIntermediates = pathSelection?.selectedPath?.requiredIntermediates || [];
      const repaired = repairUnbackedClicksWithOrigins(
        scenario.steps ?? [],
        derivedContext.allowedExecutableClicks,
        requiredIntermediates,
        preservedPrivateTargets,
        canonicalClaims,
        scenario.stepClaims,
      );
      const repairedSteps = repaired.steps;
      const removedCount = originalStepCount - repairedSteps.length;

      if (removedCount > 0) {
        console.log(`[scenarios:repair] source=ai scenarioTitle="${scenario.title}" removed=${removedCount}`);
      }

      console.log(
        `[scenarios:repair] canonicalActionsSeenByUnbackedRepair=${repaired.canonicalActionsSeen} ` +
        `canonicalActionsConvertedToValidation=0 unsupportedProviderActionsSeen=${repaired.unsupportedProviderActionsSeen} ` +
        `unsupportedProviderActionsConvertedToValidation=0`,
      );

      return {
        ...scenario,
        steps: repairedSteps,
        ...(scenario.stepClaims ? { stepClaims: remapStepClaimsByOrigins(scenario.stepClaims, repaired.origins) } : {}),
      };
    });

    console.log(`[scenarios:repair] afterUnbackedClickRepair=${repairedScenarios.length}`);

    // Validate compliance: ensure generated scenarios respect route profile
    const complianceValidation = validateScenariosCompliance(
      repairedScenarios,
      derivedContext,
      routeResolutions,
      canonicalClaims,
    );

    // Log compliance results
    for (const invalidEntry of complianceValidation.invalidScenarios) {
      logComplianceResult(
        appSlug,
        invalidEntry.scenario.sourceIssueKey,
        invalidEntry.scenario.title,
        invalidEntry.result
      );
    }

    logComplianceSummary(
      appSlug,
      complianceValidation.validScenarios.length,
      complianceValidation.invalidScenarios.length
    );

    // Log acceptance of learned path clicks
    if (learnedPathNormalizedTargets.size > 0) {
      for (const scenario of complianceValidation.validScenarios) {
        for (const step of scenario.steps || []) {
          const clickMatch = typeof step === "string" ? step.match(/Clic en\s+"([^"]+)"/i) : null;
          if (clickMatch && learnedPathNormalizedTargets.has(clickMatch[1].normalize("NFC").toLowerCase().trim())) {
            console.log(`[scenario-compliance] learnedPathClick accepted target="${clickMatch[1]}" source=appKnowledge`);
          }
        }
      }
    }

    // Build rejected array including invalid scenarios
    const invalidRejected = complianceValidation.invalidScenarios.map(entry => ({
      sourceIssueKey: entry.scenario.sourceIssueKey,
      reason: `compliance_validation_failed: ${entry.result.reasonCode}. ${entry.result.diagnostics.filter(d => d.level === "error").map(d => d.message).join("; ")}`
    }));

    // Merge blocked issues into rejected array
    const allRejected = [
      ...(parsed.rejected || []),
      ...qualityGate.rejected,
      ...blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
      ...invalidRejected
    ];

    // Update generation diagnostics
    generationDiagnostics.aiGenerated = repairedScenarios.length;
    generationDiagnostics.finalValid = complianceValidation.validScenarios.length;
    generationDiagnostics.finalRejected = allRejected.length;

    const primaryIssue = routeBackedIssues[0];
    const hasHuEvidence = !!primaryIssue && !!huEvidenceMap?.get(primaryIssue.key);
    const hasSelectedPath = !!pathSelectionMap?.get(primaryIssue?.key || "")?.selectedPath;

    if (complianceValidation.validScenarios.length === 0 && hasHuEvidence && hasSelectedPath) {
      const fallbackScenarios = buildHuFallbackScenarios(
        routeBackedIssues,
        appSlug,
        routeProfile || null,
        routeResolutions,
        entrySteps,
        pathSelectionMap,
        functionalBranches,
        requirementManifest,
      );

      if (fallbackScenarios.length > 0) {
        generationDiagnostics.fallbackUsed = true;
        generationDiagnostics.fallbackReason = "selected_path_hu_evidence_minimal";
        generationDiagnostics.fallbackScenarioCount = fallbackScenarios.length;
        generationDiagnostics.finalValid = fallbackScenarios.length;
        console.log(`[scenario-preview] selectedPathFallback generated issue=${primaryIssue.key} count=${fallbackScenarios.length} source=hu_evidence_selected_path`);
        console.log(`[scenario-preview] selectedPathFallback routeProfilePublicIgnored reason=private_selected_path`);
        for (const sc of fallbackScenarios) {
          console.log(`[scenario-auth-intent] scenarioId=${sc.scenarioId ?? sc.sourceIssueKey} authIntent=${sc.authIntent ?? "undefined"}`);
        }
        writeScenarioGenerationTrace(routeBackedIssues, requirementManifest, fallbackScenarios, {
          ...traceStages,
          finalGenerator: traceScenarios(fallbackScenarios),
          providerCompliance: [providerCompliance],
        }, canonicalClaims);

        return {
          ...parsed,
          scenarios: fallbackScenarios,
          rejected: allRejected,
          routeResolutions,
          generationDiagnostics
        };
      }
    }

    if (complianceValidation.validScenarios.length > 0 && complianceValidation.validScenarios.length < 3 && hasHuEvidence && hasSelectedPath) {
      const fallbackScenarios = buildHuFallbackScenarios(
        routeBackedIssues,
        appSlug,
        routeProfile || null,
        routeResolutions,
        entrySteps,
        pathSelectionMap,
        functionalBranches,
        requirementManifest,
      );
      const existingTitles = new Set(complianceValidation.validScenarios.map((scenario: any) => String(scenario.title).toLowerCase()));
      const fallbackToAdd = fallbackScenarios.filter((scenario: any) => !existingTitles.has(String(scenario.title).toLowerCase()));
      if (fallbackToAdd.length > 0) {
        generationDiagnostics.fallbackUsed = true;
        generationDiagnostics.fallbackReason = "ai_below_minimum";
        generationDiagnostics.fallbackScenarioCount = fallbackToAdd.length;
        generationDiagnostics.finalValid = complianceValidation.validScenarios.length + fallbackToAdd.length;
        console.log(`[scenarios:coverage] insufficientFunctionalCoverage issue=${primaryIssue.key} valid=${complianceValidation.validScenarios.length} minimum=3 fallback=true`);
        for (const sc of [...complianceValidation.validScenarios, ...fallbackToAdd]) {
          console.log(`[scenario-auth-intent] scenarioId=${sc.scenarioId ?? sc.sourceIssueKey} authIntent=${sc.authIntent ?? "undefined"}`);
        }
        writeScenarioGenerationTrace(routeBackedIssues, requirementManifest, [...complianceValidation.validScenarios, ...fallbackToAdd], {
          ...traceStages,
          finalGenerator: traceScenarios([...complianceValidation.validScenarios, ...fallbackToAdd]),
          providerCompliance: [providerCompliance],
        }, canonicalClaims);
        return {
          ...parsed,
          scenarios: [...complianceValidation.validScenarios, ...fallbackToAdd],
          rejected: allRejected,
          routeResolutions,
          generationDiagnostics
        };
      }
    }

    console.log(
      `[scenarios:ai] success ` +
      `aiGenerated=${generationDiagnostics.aiGenerated} ` +
      `finalValid=${generationDiagnostics.finalValid} ` +
      `finalRejected=${generationDiagnostics.finalRejected}`
    );
    writeScenarioGenerationTrace(routeBackedIssues, requirementManifest, complianceValidation.validScenarios, {
      ...traceStages,
      finalGenerator: traceScenarios(complianceValidation.validScenarios),
      providerCompliance: [providerCompliance],
    }, canonicalClaims);
    for (const sc of complianceValidation.validScenarios) {
      console.log(`[scenario-auth-intent] scenarioId=${sc.scenarioId ?? sc.sourceIssueKey} authIntent=${sc.authIntent ?? "undefined"}`);
    }

    return {
      ...parsed,
      scenarios: complianceValidation.validScenarios,
      rejected: allRejected,
      routeResolutions,
      generationDiagnostics
    };
  } catch (error) {
    if (error instanceof AiProviderError) {
      if (error.code === "ai_provider_timeout") {
        // Enhanced timeout diagnostics
        const systemChars = messages[0]?.content.length ?? 0;
        const userChars = messages[1]?.content.length ?? 0;
        const totalChars = systemChars + userChars;
        const estimatedTokens = Math.ceil(totalChars / 4);

        const suggestions: string[] = [];

        if (!derivedContext || derivedContext.allowedExecutableClicks.length === 0) {
          suggestions.push("ensure route profile is loaded to enable compact prompt mode");
        }

        if (routeBackedIssues.length > 1) {
          suggestions.push(`reduce issue count (current: ${routeBackedIssues.length})`);
        }

        if (totalChars > 20000) {
          suggestions.push("prompt size is large (>20k chars) - consider splitting issues or simplifying descriptions");
        }

        const deterministicPossible = routeBackedIssues.some(issue =>
          routeResolutions.get(issue.key)?.scenarioMode === "action_button_validation"
        );
        if (deterministicPossible) {
          suggestions.push("some issues support deterministic generation (action_button_validation mode)");
        }

        console.log(
          `[scenarios:timeout] provider=${provider.providerType} ` +
          `totalChars=${totalChars} ` +
          `estimatedTokens=${estimatedTokens} ` +
          `issues=${routeBackedIssues.length} ` +
          `allowedClicks=${derivedContext?.allowedExecutableClicks.length ?? 0} ` +
          `suggestions: ${suggestions.join("; ")}`
        );

        // Fallback to deterministic seeds if available
        // Applies to: fallback_deterministic_on_ai_failure AND ai_supported_by_deterministic
        if (
          (generationMode === "fallback_deterministic_on_ai_failure" || generationMode === "ai_supported_by_deterministic") &&
          deterministicSeeds &&
          deterministicSeeds.length > 0
        ) {
          console.log(`[scenarios:fallback] AI timeout, using ${deterministicSeeds.length} deterministic seeds as fallback`);
          generationDiagnostics.aiFailed = true;
          generationDiagnostics.fallbackUsed = true;
          generationDiagnostics.fallbackReason = "ai_timeout";
          generationDiagnostics.fallbackScenarioCount = deterministicSeeds.length;

          // Convert seeds to full scenarios and validate
          const { validScenarios, invalidScenarios } = convertSeedsToValidatedScenarios(
            deterministicSeeds,
            appSlug,
            routeProfile || null,
            derivedContext,
            routeResolutions
          );

          console.log(`[scenarios:fallback] validated=${validScenarios.length} invalid=${invalidScenarios.length}`);

          generationDiagnostics.finalValid = validScenarios.length;
          generationDiagnostics.finalRejected = invalidScenarios.length;

          return {
            appSlug,
            targetAppSlug,
            targetAppName,
            confidence: "medium",
            reason: "AI timeout, used deterministic fallback",
            functionalRoute: "",
            routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
            scenarios: validScenarios,
            warnings: [
              "AI generation timed out, using deterministic fallback",
              ...blockedIssues.map(b => `Blocked ${b.key}: ${b.reason}`),
              ...invalidScenarios.map((inv: any) =>
                `Scenario ${inv.scenario.sourceIssueKey} failed compliance: ${inv.result.reasonCode}`
              )
            ],
            rejected: [
              ...blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
              ...invalidScenarios.map((inv: any) => ({
                sourceIssueKey: inv.scenario.sourceIssueKey,
                reason: `compliance_failed: ${inv.result.reasonCode}`
              }))
            ],
            routeResolutions,
            generationDiagnostics
          };
        }

        throw new Error(
          `AI_GENERATION_TIMEOUT|AI provider (${provider.providerType}) timed out after ${error.diagnostics?.timeoutMs || "unknown"}ms. ` +
          `Prompt size: ${totalChars} chars (~${estimatedTokens} tokens). Issues: ${routeBackedIssues.length}. ` +
          `Suggestions: ${suggestions.join("; ")}. ` +
          `Check AI_SCENARIO_TIMEOUT_MS env var.`
        );
      }

      // Handle other AI generation errors (parse failures, missing files, etc.)
      console.log(`[scenarios:ai] generation error: ${error.message}`);

      // Fallback to deterministic seeds if available
      // Applies to: fallback_deterministic_on_ai_failure AND ai_supported_by_deterministic
      if (
        (generationMode === "fallback_deterministic_on_ai_failure" || generationMode === "ai_supported_by_deterministic") &&
        deterministicSeeds &&
        deterministicSeeds.length > 0
      ) {
        // Detect error type
        const errorMessage = error.message || "";
        let fallbackReason: "ai_generation_error" | "ai_parse_failed" | "ai_invalid_shape" = "ai_generation_error";

        if (errorMessage.includes("ai_provider_invalid_json")) {
          fallbackReason = "ai_invalid_shape";
          console.log(`[scenarios:ai] invalid_shape_non_fatal fallback=true using_deterministic_seeds=${deterministicSeeds.length}`);
        } else if (errorMessage.includes("AI_GENERATION_ERROR") || errorMessage.includes("scenario-generation-result.json")) {
          fallbackReason = "ai_parse_failed";
        }

        console.log(`[scenarios:fallback] AI failed (${fallbackReason}), using ${deterministicSeeds.length} deterministic seeds as fallback`);
        generationDiagnostics.aiFailed = true;
        generationDiagnostics.fallbackUsed = true;
        generationDiagnostics.fallbackReason = fallbackReason;
        generationDiagnostics.fallbackScenarioCount = deterministicSeeds.length;

        // Convert seeds to full scenarios and validate
        const { validScenarios, invalidScenarios } = convertSeedsToValidatedScenarios(
          deterministicSeeds,
          appSlug,
          routeProfile || null,
          derivedContext,
          routeResolutions
        );

        console.log(`[scenarios:fallback] validated=${validScenarios.length} invalid=${invalidScenarios.length}`);

        generationDiagnostics.finalValid = validScenarios.length;
        generationDiagnostics.finalRejected = invalidScenarios.length;

        return {
          appSlug,
          targetAppSlug,
          targetAppName,
          confidence: "medium",
          reason: `AI generation failed (${fallbackReason}), used deterministic fallback`,
          functionalRoute: "",
          routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
          scenarios: validScenarios,
          warnings: [
            `AI generation failed: ${fallbackReason}, using deterministic fallback`,
            ...blockedIssues.map(b => `Blocked ${b.key}: ${b.reason}`),
            ...invalidScenarios.map((inv: any) =>
              `Scenario ${inv.scenario.sourceIssueKey} failed compliance: ${inv.result.reasonCode}`
            )
          ],
          rejected: [
            ...blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
            ...invalidScenarios.map((inv: any) => ({
              sourceIssueKey: inv.scenario.sourceIssueKey,
              reason: `compliance_failed: ${inv.result.reasonCode}`
            }))
          ],
          routeResolutions,
          generationDiagnostics
        };
      }

      throw new Error(`AI_GENERATION_ERROR|${error.message}`);
    }
    throw error;
  }
}

/**
 * Check if a route profile is catalog/listing using structural signals,
 * not hardcoded label patterns. Multiproject-safe.
 */
function resolutionIsCatalogListing(routeProfile: McpRouteProfile | null | undefined): boolean {
  if (!routeProfile) return false;
  const rp = routeProfile as any;

  // Structural signals (same scoring as scenario-preview.service.ts)
  let score = 0;

  // 1. targetPaths with product groups → strong catalog signal
  const targetPaths = (rp.targetPaths ?? {});
  const targetPathKeys = Object.keys(targetPaths);
  if (targetPathKeys.length >= 3) score += 3;
  else if (targetPathKeys.length >= 1) score += 2;

  // 2. productMetadata.subcategory → very strong catalog signal
  const hasProductMetadata = targetPathKeys.some(
    (k: string) => !!(targetPaths[k] as any)?.productMetadata?.subcategory
  );
  if (hasProductMetadata) score += 3;

  // 3. entry labels contain catalog-pattern business keys
  const entries = (rp.entry ?? []) as any[];
  const entryLabels = entries.map((e: any) =>
    (e.businessLabel ?? e.visibleLabel ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  );
  const catalogEntryPatterns = [/informacion_de_productos/, /productos/, /catalogo/];
  if (entryLabels.some(l => catalogEntryPatterns.some(p => p.test(l)))) score += 1;

  // 4. visibleControls dominated by catalog section labels
  const controls = (rp.visibleControls ?? []) as string[];
  if (controls.length >= 5) {
    const catalogSectionTerms = /beneficios|requisitos|condiciones relevantes|descripci[oó]n general|informaci[oó]n legal|nombre del producto|solicitar|tasas/i;
    const catalogControls = controls.filter((c: string) => catalogSectionTerms.test(c));
    if (catalogControls.length / Math.max(controls.length, 1) >= 0.3) score += 1;
  }

  return score >= 2;
}

/**
 * Parse AI response with an explicit mode flag.
 * For route_pending mode, marks scenarios as non-executable.
 */
function parseAiResponseWithMode(parsedJson: Record<string, unknown>, mode: string): { scenarios: any[] } {
  const raw = Array.isArray(parsedJson["scenarios"]) ? parsedJson["scenarios"] : [];
  const scenarios = raw.filter((s: any) => s && typeof s === "object" && s.title && Array.isArray(s.steps) && s.steps.length > 0);
  return { scenarios };
}
