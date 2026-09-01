import { config, requireJiraConfig } from "../config/env";
import type { LoginMode } from "../types/env.types";
import { JiraClient } from "../clients/jira.client";
import { loadJiraIssues } from "./jira-scenario-source";
import { generateScenariosWithAi, evaluateProviderClaimCompliance } from "./codex-scenario-generator";
import { validateScenario } from "./scenario-validator";
import { buildCanonicalClaims, buildRequirementAccounting, evaluateFunctionalCoverageInvariant } from "./scenario-functional-quality";
import { classifyScenarioPublicationEligibility } from "./scenario-publication-eligibility";
import {
  resolveAppForPreview,
  ensureFunctionalAppProfile,
  loadAppConfig,
  getRouteProfileFromConfig,
  buildEntrySteps,
  detectKioskoInfoProductos,
  seedKioskoInfoProductosRouteProfile,
} from "../automations/app-auto-resolver";
import { buildDerivedExecutionContext } from "./route-profile-derived-context";
import { repairMissingIntermediates, logIntermediateRepair } from "./scenario-intermediate-repair";
import {
  collectBranchRequiredClicks,
  mergeEffectiveAllowedClicks,
} from "./effective-click-authority";
import { loadOrCreateKnowledgeContext, buildKnowledgeContextForScenarioGeneration, type KnowledgeContext } from "./knowledge-context-resolver";
import { detectHuIntent, isCatalogListingIntent, isTransactionalDocumentIntent, type HuIntentDetection } from "./hu-intent-classifier";
import { resolveCanonicalHuIntent, type CanonicalHuIntentResolution } from "./canonical-hu-intent";
import { evaluateDestinationEvidence } from "./destination-evidence";
import { evaluateStepAuthority, remapStepClaimsByOrigins, resolveRequirementFacet, resolveStepClaimType } from "./step-authority";
import { detectOptionFlows, type OptionFlow } from "./hu-scope-guard";
import {
  classifySemanticObject,
  resolveFunctionalObject,
  validateSemanticScenarioTitle,
  repairSemanticScenarioTitle,
  resolveBackedObjectForTitle,
  inferFunctionalAction,
  mapBusinessEntityLabel,
  normalizeObjText,
  type ObjectResolutionContext,
} from "./functional-object-resolver";
import type {
  ScenarioPreviewRequest,
  ScenarioPreviewResponse,
  ScenarioPreviewError,
  ValidatedScenario,
  McpRejectedScenario,
  McpScenario,
  McpRouteProfile,
  FunctionalBranchRef,
  BranchAccessIntent,
  FunctionalBranchEvidenceSource,
  IntermediateRepairResult,
} from "./scenario-types";

export function evaluateRequirementDependencyGate(
  scenario: Pick<McpScenario, "requirementDependencies" | "stepRequirementRefs">,
  canonicalDependencies: ReadonlyMap<string, readonly string[]> | undefined,
): { dependencySatisfied: boolean; reason?: string } {
  const dependencies = scenario.requirementDependencies ?? [];
  if (dependencies.length === 0) return { dependencySatisfied: true };
  if (!canonicalDependencies || canonicalDependencies.size === 0) {
    return { dependencySatisfied: false, reason: "dependency_canonical_authority_unavailable" };
  }
  const refsByRequirement = new Map<string, number[]>();
  for (const ref of scenario.stepRequirementRefs ?? []) {
    const indexes = refsByRequirement.get(ref.requirementId) ?? [];
    indexes.push(ref.stepIndex);
    refsByRequirement.set(ref.requirementId, indexes);
  }
  for (const dependency of dependencies) {
    const prerequisites = canonicalDependencies.get(dependency.requirementId);
    if (!prerequisites) {
      return { dependencySatisfied: false, reason: "dependency_requirement_not_canonical" };
    }
    const dependentIndexes = refsByRequirement.get(dependency.requirementId) ?? [];
    if (dependentIndexes.length === 0) return { dependencySatisfied: false, reason: "dependency_dependent_ref_missing" };
    for (const prerequisiteId of prerequisites) {
      if (!canonicalDependencies.has(prerequisiteId)) return { dependencySatisfied: false, reason: "dependency_prerequisite_not_canonical" };
      const prerequisiteIndexes = refsByRequirement.get(prerequisiteId) ?? [];
      if (prerequisiteIndexes.length === 0) return { dependencySatisfied: false, reason: "dependency_prerequisite_ref_missing" };
      if (!prerequisiteIndexes.some((pre) => dependentIndexes.some((dependent) => pre < dependent))) {
        return { dependencySatisfied: false, reason: "dependency_order_invalid" };
      }
    }
  }
  return { dependencySatisfied: true };
}

function resolveAppSlug(requestAppSlug?: string): string {
  if (requestAppSlug?.trim()) return requestAppSlug.trim();
  const envSlug = process.env.APP_SLUG?.trim();
  if (envSlug) return envSlug;
  return "arquitectura-automatizacion";
}

function normalizeScenariosToTargetApp(scenarios: McpScenario[], targetAppSlug: string): McpScenario[] {
  if (!targetAppSlug) return scenarios;
  return scenarios.map((sc) => ({
    ...sc,
    appSlug: targetAppSlug,
    targetAppSlug,
  }));
}

function formatEntryStep(label: string, index: number): string {
  return `${index + 1}. Clic en "${label}".`;
}

function stepsMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/^\d+[\.)]\s*/, "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return norm(a) === norm(b);
}

function stepIsClickOnLabel(step: string, label: string): boolean {
  const normalized = step.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return normalized.includes(`clic en "${label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")}"`);
}

function isEntryClickStep(step: string, entryLabels: string[]): boolean {
  const stripped = step.replace(/^\d+[\.)]\s*/, "").trim();
  if (!/^clic en "/i.test(stripped)) return false;
  return entryLabels.some((label) => stepIsClickOnLabel(step, label));
}

/** Route data resolves implementation, but cannot create functional authority. */
export function isEntryStepInsertionAuthorized(
  scenario: Pick<McpScenario, "stepRequirementRefs" | "requirementDependencies">,
  functionalBranches: FunctionalBranchRef[] = [],
): boolean {
  const canonicalPrerequisiteIds = new Set(
    functionalBranches.flatMap((branch) => branch.prerequisiteRequirementIds ?? []),
  );
  const canonicalActionIds = new Set(
    (scenario.requirementDependencies ?? []).map((dependency) => dependency.requirementId),
  );
  return (scenario.stepRequirementRefs ?? []).some((ref) =>
    (ref.facet === "action" || ref.facet === "activation")
    && (
      canonicalPrerequisiteIds.has(ref.requirementId)
      || canonicalActionIds.has(ref.requirementId)
      || ref.requirementId.startsWith("prerequisite:")
    ),
  );
}

export function insertEntrySteps(
  scenario: McpScenario,
  entrySteps: string[],
  entryStepConfigs?: EntryStepConfig[],
): McpScenario {
  const labels: string[] = [];

  // Prefer new entrySteps format (action/target) over old entry labels
  if (entryStepConfigs && entryStepConfigs.length > 0) {
    for (const es of entryStepConfigs) {
      if (es.action === "click" && es.target) labels.push(es.target);
    }
  }

  // Fallback to old format (string labels from entry visibleLabels)
  if (labels.length === 0) labels.push(...entrySteps);

  if (!labels.length || !scenario.steps || scenario.steps.length === 0) return scenario;

  const existingSteps = scenario.steps.map((s) => s.trim());
  const referencedIndexes = new Set(
    (scenario.stepRequirementRefs ?? []).map((ref) => ref.stepIndex),
  );
  const protectedEntryLabels = new Set(
    labels.filter((label) => existingSteps.some((step, index) =>
      referencedIndexes.has(index) && isEntryClickStep(step, [label]),
    )),
  );
  const formattedEntry = labels
    .filter((label) => !protectedEntryLabels.has(label))
    .map((label, i) => ({ text: formatEntryStep(label, i), originalIndex: undefined as number | undefined }));

  // Remove ALL existing entry click steps (damaged or canonical) from anywhere in the list
  const nonEntrySteps = existingSteps
    .map((text, originalIndex) => ({ text, originalIndex }))
    .filter(({ text, originalIndex }) => referencedIndexes.has(originalIndex) || !isEntryClickStep(text, labels));

  // Prepend canonical entry steps
  const protectedPrefixCount = nonEntrySteps.findIndex(({ originalIndex, text }) =>
    !referencedIndexes.has(originalIndex) || !isEntryClickStep(text, labels),
  );
  const insertionIndex = protectedPrefixCount < 0 ? nonEntrySteps.length : protectedPrefixCount;
  const newSteps = [
    ...nonEntrySteps.slice(0, insertionIndex),
    ...formattedEntry,
    ...nonEntrySteps.slice(insertionIndex),
  ];
  const oldToNewIndex = new Map<number, number>();
  newSteps.forEach((step, index) => {
    if (step.originalIndex !== undefined) oldToNewIndex.set(step.originalIndex, index);
  });
  const stepRequirementRefs = scenario.stepRequirementRefs
    ?.map((ref) => {
      const stepIndex = oldToNewIndex.get(ref.stepIndex);
      return stepIndex === undefined ? undefined : { ...ref, stepIndex };
    })
    .filter((ref): ref is NonNullable<typeof ref> => ref !== undefined);

  // Re-number all steps
  const renumbered = newSteps.map((step, idx) => {
    return step.text.replace(/^\d+[\.)]\s*/, `${idx + 1}. `);
  });

  return {
    ...scenario,
    steps: renumbered,
    ...(stepRequirementRefs ? { stepRequirementRefs } : {}),
    ...(scenario.stepClaims ? { stepClaims: remapStepClaimsByOrigins(scenario.stepClaims, newSteps.map((step) => step.originalIndex)) } : {}),
  };
}

export type BranchRouteCandidate = {
  routeId: string;
  clickTargets: string[];
  accessIntent: BranchAccessIntent;
  source: "knowledge" | "hu_route";
  destination?: string;
  destinationSignals?: string[];
  destinationUrl?: string;
};

export type BranchCoverageCheck = {
  required: number;
  covered: number;
  missing: string[];
  pending: string[];
  unexpected: string[];
  requiredBranchIds: string[];
  coveredBranchIds: string[];
  pendingBranchIds: string[];
  insufficientEvidenceBranchIds?: string[];
  reasonCode?: "branch_extraction_mismatch" | "coverage_requirements_unavailable";
  valid: boolean;
};

export type GenerationSuccessCheck = {
  generationSuccess: boolean;
  blockedReasons: Array<
    "response_visibility_mismatch"
    | "branch_coverage_invalid"
    | "coverage_requirements_unavailable"
    | "omitted_invalid"
    | "category_overlap_detected"
    | "provider_claim_compliance_invalid"
  >;
};

const GENERIC_ROUTE_TOKENS = new Set([
  "iniciar", "continuar", "siguiente", "menu", "opcion", "opciones", "informacion",
  "servicio", "servicios", "pantalla", "modulo", "seccion", "seleccionar", "validar",
  "mostrar", "acceder", "navegar", "ir", "volver", "aceptar",
]);

function normalizeBranchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeBranchText(value: string): string[] {
  return normalizeBranchText(value)
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function nonGenericTokens(value: string): string[] {
  return tokenizeBranchText(value).filter((token) => !GENERIC_ROUTE_TOKENS.has(token));
}

const ACTION_OPERATIONAL_TOKENS = new Set([
  "clic", "click", "hacer", "pulsar", "pulse", "presionar", "seleccionar", "selecciona", "seleccione",
  "opcion", "opciones", "boton", "menu", "ir", "acceder", "navegar", "abrir",
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "a", "en", "por", "para",
]);

function normalizeActionIdentity(value: string): string {
  const tokens = tokenizeBranchText(value)
    .filter((token) => !ACTION_OPERATIONAL_TOKENS.has(token))
    .filter((token) => token.length > 2);
  return tokens.join(" ");
}

function actionIdentityIsDistinctive(identity: string): boolean {
  const tokens = identity.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  if (tokens.length > 1) return true;
  return tokens[0].length >= 4 && !GENERIC_ROUTE_TOKENS.has(tokens[0]);
}

function extractExecutedClickTarget(step: string): string | undefined {
  const normalizedStep = step.replace(/^\d+[\.)]\s*/, "").trim();
  const clickMatch = normalizedStep.match(/^clic en\s+"([^"]+)"/i);
  return clickMatch?.[1]?.trim();
}

function inferAccessIntentFromText(value: string): BranchAccessIntent {
  const normalized = normalizeBranchText(value);
  const authSignals = /\b(auth|autentic(?:ad[oa]|acion)?|login|sesion|otp|password|clave|token|identificacion|privad[oa]?)\b/i.test(normalized);
  const publicSignals = /\b(public[oa]?|catalog|informativ[oa]?|consulta|ayuda|contacto|about)\b/i.test(normalized);
  if (authSignals && !publicSignals) return "authenticated";
  if (publicSignals && !authSignals) return "public";
  return "unknown";
}

function inferEvidenceSource(line: string): FunctionalBranchEvidenceSource {
  if (/^\s*(?:\d+[\).\s-]|[-*•])/i.test(line) || /\b(criterio|acceptance|entonces|dado|cuando)\b/i.test(line)) {
    return "acceptance_criteria";
  }
  return "user_story";
}

function stableBranchSlug(value: string): string {
  const normalized = normalizeBranchText(value).replace(/[^a-z0-9]+/g, "-");
  return normalized.replace(/^-+|-+$/g, "").slice(0, 64) || "branch";
}

function branchIdFromParts(base: string, seen: Map<string, number>): string {
  const slug = stableBranchSlug(base);
  const current = (seen.get(slug) ?? 0) + 1;
  seen.set(slug, current);
  return current === 1 ? `branch-${slug}` : `branch-${slug}-${current}`;
}

function extractExpectedDestination(label: string, huText: string): string | undefined {
  const quoted = `"${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`;
  const direct = new RegExp(`${quoted}[^\\n.]{0,120}(?:conduce a|dirige a|lleva a|accede a|navega a|abre|muestra)\\s+"?([^"\\n.]+)"?`, "i");
  const inverse = new RegExp(`(?:conduce a|dirige a|lleva a|accede a|navega a|abre|muestra)\\s+"?([^"\\n.]+)"?[^\\n.]{0,120}${quoted}`, "i");
  const m1 = huText.match(direct)?.[1]?.trim();
  if (m1) return m1;
  const m2 = huText.match(inverse)?.[1]?.trim();
  return m2 || undefined;
}

function normalizeOptionFlowKey(label?: string, expectedDestination?: string): string {
  return `${normalizeBranchText(label ?? "")}|${normalizeBranchText(expectedDestination ?? "")}`;
}

function scoreBranchCompleteness(branch: FunctionalBranchRef): number {
  let score = 0;
  if (branch.sourceLabel) score += 2;
  if (branch.expectedDestination) score += 3;
  if (branch.accessIntent !== "unknown") score += 2;
  if (branch.sourceRequirementId?.startsWith("option-flow:")) score += 2;
  return score;
}

function mapOptionFlowToFunctionalBranch(
  flow: OptionFlow,
  index: number,
  seenIds: Map<string, number>,
): FunctionalBranchRef | null {
  const sourceLabel = flow.optionLabel?.trim();
  const expectedDestination = flow.expectedResult?.trim();
  if (!sourceLabel || !expectedDestination) return null;
  const accessIntent: BranchAccessIntent = flow.requiresAuth === true
    ? "authenticated"
    : flow.requiresAuth === false
      ? "public"
      : inferAccessIntentFromText(`${sourceLabel} ${expectedDestination}`);
  const branchId = branchIdFromParts(`${sourceLabel}|${expectedDestination}|${accessIntent}`, seenIds);
  return {
    branchId,
    sourceLabel,
    sourceRequirementId: `option-flow:${index + 1}`,
    actionIntent: "select_option",
    expectedDestination,
    accessIntent,
    evidenceSource: "user_story",
    activation: { actionType: "select", targetIdentity: sourceLabel },
    destination: { semanticDeclaration: expectedDestination },
  };
}

function mergeFunctionalBranchSets(
  huDerivedBranches: FunctionalBranchRef[],
  optionFlowBranches: FunctionalBranchRef[],
): FunctionalBranchRef[] {
  const merged = new Map<string, FunctionalBranchRef>();
  for (const branch of [...huDerivedBranches, ...optionFlowBranches]) {
    const key = normalizeOptionFlowKey(branch.sourceLabel, branch.expectedDestination);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, branch);
      continue;
    }
    if (scoreBranchCompleteness(branch) > scoreBranchCompleteness(existing)) {
      merged.set(key, branch);
    }
  }
  return Array.from(merged.values());
}

function isLikelyBranchOption(label: string, huText: string, optionCount: number): boolean {
  const normalizedLabel = normalizeBranchText(label);
  const isSimpleCta = /^(continuar|confirmar|cancelar|volver|aceptar|guardar|enviar|imprimir|descargar)$/.test(normalizedLabel);
  if (isSimpleCta) return false;
  if (optionCount > 1) return true;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ctx = huText.match(new RegExp(`[^\\n.]{0,80}"${escaped}"[^\\n.]{0,80}`, "i"))?.[0] ?? "";
  return /\b(opcion|elige|selecciona|escoge|menu|conduce|dirige|lleva|ruta|destino)\b/i.test(ctx);
}

export function extractFunctionalBranchesFromHu(
  huText: string,
  visibleOptions: string[],
  explicitRoutePath: string[],
  optionFlows: OptionFlow[] = [],
): FunctionalBranchRef[] {
  const dedupedOptions = Array.from(new Set((visibleOptions ?? []).map((option) => option.trim()).filter(Boolean)));
  const branches: FunctionalBranchRef[] = [];
  const seenIds = new Map<string, number>();

  for (const label of dedupedOptions) {
    if (!isLikelyBranchOption(label, huText, dedupedOptions.length)) continue;
    const expectedDestination = extractExpectedDestination(label, huText);
    const evidenceLine = huText.split(/[\n\r]+/).find((line) => line.includes(label)) ?? "";
    const contextText = [label, expectedDestination ?? "", evidenceLine || huText].join(" ");
    const accessIntent = inferAccessIntentFromText(contextText);
    const evidenceSource = inferEvidenceSource(evidenceLine);
    const branchId = branchIdFromParts(`${label}|${expectedDestination ?? "none"}|${accessIntent}`, seenIds);
    branches.push({
      branchId,
      sourceLabel: label,
      sourceRequirementId: `option:${branches.length + 1}`,
      actionIntent: "select_option",
      expectedDestination,
      accessIntent,
      evidenceSource,
      activation: { actionType: "select", targetIdentity: label },
      ...(expectedDestination ? { destination: { semanticDeclaration: expectedDestination } } : {}),
    });
  }

  const optionFlowBranches = optionFlows
    .map((flow, index) => mapOptionFlowToFunctionalBranch(flow, index, seenIds))
    .filter((branch): branch is FunctionalBranchRef => branch !== null);
  const mergedBranches = mergeFunctionalBranchSets(branches, optionFlowBranches);

  if (mergedBranches.length === 0 && explicitRoutePath.length > 0) {
    const target = explicitRoutePath[explicitRoutePath.length - 1] ?? explicitRoutePath[0];
    const routeText = explicitRoutePath.join(" > ");
    mergedBranches.push({
      branchId: branchIdFromParts(`${routeText}|route`, seenIds),
      sourceLabel: explicitRoutePath[0],
      sourceRequirementId: "route:1",
      actionIntent: "navigate",
      expectedDestination: target,
      accessIntent: inferAccessIntentFromText(routeText),
      evidenceSource: "user_story",
      activation: { actionType: "navigate", targetIdentity: explicitRoutePath[0] },
      destination: { semanticDeclaration: target },
    });
  }

  return mergedBranches;
}

function inferScenarioAccessIntent(scenario: McpScenario): BranchAccessIntent {
  const text = [scenario.title, ...(scenario.steps ?? []), scenario.expectedResult ?? ""].filter(Boolean).join(" ");
  return inferAccessIntentFromText(text);
}

function sourceIssueKeyFromBranch(branch: FunctionalBranchRef): string | undefined {
  const sourceRequirementId = (branch.sourceRequirementId ?? "").trim();
  if (!sourceRequirementId) return undefined;
  const parts = sourceRequirementId.split(":");
  if (parts.length < 3) return undefined;
  return parts[1]?.trim().toUpperCase() || undefined;
}

function branchMatchesScenarioIssueKey(branch: FunctionalBranchRef, scenario: McpScenario): boolean {
  const scenarioIssueKey = scenario.sourceIssueKey?.trim().toUpperCase();
  if (!scenarioIssueKey) return true;
  const branchIssueKey = sourceIssueKeyFromBranch(branch);
  return !branchIssueKey || branchIssueKey === scenarioIssueKey;
}

function expectedActionIdentity(branch: FunctionalBranchRef): string {
  const sourceIdentity = normalizeActionIdentity(branch.sourceLabel ?? "");
  if (sourceIdentity) return sourceIdentity;
  return normalizeActionIdentity(branch.actionIntent ?? "");
}

function collectScenarioActionIdentities(scenario: McpScenario): string[] {
  const identities = new Set<string>();
  for (const step of scenario.steps ?? []) {
    const executedTarget = extractExecutedClickTarget(step);
    if (!executedTarget) continue;
    const identity = normalizeActionIdentity(executedTarget);
    if (identity) identities.add(identity);
  }
  return Array.from(identities);
}

function actionIdentityOverlap(expected: string, actual: string): number {
  if (!expected || !actual) return 0;
  const expectedTokens = new Set(expected.split(/\s+/).filter(Boolean));
  const actualTokens = new Set(actual.split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const token of expectedTokens) {
    if (actualTokens.has(token)) overlap++;
  }
  return overlap;
}

function actionIdentityMatched(expected: string, actualIdentities: string[]): boolean {
  if (!expected) return actualIdentities.length > 0;
  return actualIdentities.some((actual) => {
    if (actual === expected) return true;
    if (actual.includes(expected) || expected.includes(actual)) return true;
    return actionIdentityOverlap(expected, actual) > 0;
  });
}

function actionIdentityMatchStrength(expected: string, actual: string): number {
  if (!expected || !actual) return 0;
  if (actual === expected) return 100;
  if (actual.includes(expected) || expected.includes(actual)) return 80;
  const expectedTokens = expected.split(/\s+/).filter(Boolean);
  const overlap = actionIdentityOverlap(expected, actual);
  if (expectedTokens.length === 1) return overlap === 1 ? 40 : 0;
  return overlap === expectedTokens.length ? 60 : 0;
}

type ScenarioActionMatch = {
  expectedActionIdentity: string;
  actualActionIdentity: string;
  actionMatched: boolean;
};

function evaluateScenarioActionMatch(
  scenario: McpScenario,
  requiredBranch: FunctionalBranchRef,
): ScenarioActionMatch {
  const expectedIdentity = expectedActionIdentity(requiredBranch);
  const actionIdentities = collectScenarioActionIdentities(scenario);
  if (actionIdentities.length === 0) {
    return {
      expectedActionIdentity: expectedIdentity,
      actualActionIdentity: "",
      actionMatched: false,
    };
  }
  if (!expectedIdentity) {
    return {
      expectedActionIdentity: expectedIdentity,
      actualActionIdentity: actionIdentities[0] ?? "",
      actionMatched: true,
    };
  }
  let strongestActual = actionIdentities[0] ?? "";
  let strongestScore = actionIdentityMatchStrength(expectedIdentity, strongestActual);
  for (const actualIdentity of actionIdentities.slice(1)) {
    const score = actionIdentityMatchStrength(expectedIdentity, actualIdentity);
    if (score > strongestScore) {
      strongestActual = actualIdentity;
      strongestScore = score;
    }
  }
  return {
    expectedActionIdentity: expectedIdentity,
    actualActionIdentity: strongestActual,
    actionMatched: strongestScore > 0,
  };
}

function structuredBranchMetadataMatch(
  scenario: McpScenario,
  candidates: FunctionalBranchRef[],
): FunctionalBranchRef | null {
  const metadata = scenario.functionalBranch;
  if (!metadata) return null;
  const normalizedSource = normalizeBranchText(metadata.sourceLabel ?? "");
  const normalizedDestination = normalizeBranchText(metadata.expectedDestination ?? "");
  const normalizedAction = normalizeActionIdentity(metadata.sourceLabel ?? metadata.actionIntent ?? "");
  const accessIntent = metadata.accessIntent ?? "unknown";
  const matches = candidates.filter((branch) => {
    const sourceMatches = normalizedSource.length > 0
      && normalizeBranchText(branch.sourceLabel ?? "") === normalizedSource;
    const destinationMatches = normalizedDestination.length > 0
      && normalizeBranchText(branch.expectedDestination ?? "") === normalizedDestination;
    const actionMatches = normalizedAction.length > 0
      && expectedActionIdentity(branch) === normalizedAction;
    const accessMatches = accessIntent === "unknown" || branch.accessIntent === accessIntent;
    const signalCount = [sourceMatches, destinationMatches, actionMatches].filter(Boolean).length;
    return accessMatches && signalCount >= 2;
  });
  return matches.length === 1 ? matches[0] : null;
}

type BranchAssociationDecision = {
  branch: FunctionalBranchRef | null;
  associationMethod: "branch_id" | "structured_metadata" | "normalized_action" | "textual_fallback" | "none";
  expectedActionIdentity: string;
  actualActionIdentity: string;
  actionMatched: boolean;
  reasonCode?: string;
};

function decideScenarioBranchAssociation(
  scenario: McpScenario,
  branches: FunctionalBranchRef[],
  branchById: Map<string, FunctionalBranchRef>,
): BranchAssociationDecision {
  const scenarioActionIdentities = collectScenarioActionIdentities(scenario);
  const actualActionIdentity = scenarioActionIdentities[0] ?? "";
  const issueScopedBranches = branches.filter((branch) => branchMatchesScenarioIssueKey(branch, scenario));
  const aiBranchId = scenario.functionalBranch?.branchId
    || (typeof (scenario as any).branchId === "string" ? (scenario as any).branchId : undefined);

  if (aiBranchId && branchById.has(aiBranchId)) {
    const selected = branchById.get(aiBranchId)!;
    if (branchMatchesScenarioIssueKey(selected, scenario)) {
      const actionEvidence = evaluateScenarioActionMatch(scenario, selected);
      return {
        branch: selected,
        associationMethod: "branch_id",
        expectedActionIdentity: actionEvidence.expectedActionIdentity,
        actualActionIdentity: actionEvidence.actualActionIdentity,
        actionMatched: actionEvidence.actionMatched,
      };
    }
  }

  const structuredMatch = structuredBranchMetadataMatch(scenario, issueScopedBranches);
  if (structuredMatch) {
    const actionEvidence = evaluateScenarioActionMatch(scenario, structuredMatch);
    return {
      branch: structuredMatch,
      associationMethod: "structured_metadata",
      expectedActionIdentity: actionEvidence.expectedActionIdentity,
      actualActionIdentity: actionEvidence.actualActionIdentity,
      actionMatched: actionEvidence.actionMatched,
    };
  }

  const normalizedCandidates = issueScopedBranches
    .map((branch) => {
      const expectedIdentity = expectedActionIdentity(branch);
      if (!expectedIdentity || !actionIdentityIsDistinctive(expectedIdentity)) return null;
      let overlap = 0;
      for (const actualIdentity of scenarioActionIdentities) {
        overlap = Math.max(overlap, actionIdentityOverlap(expectedIdentity, actualIdentity));
      }
      return overlap > 0 ? { branch, expectedIdentity, overlap } : null;
    })
    .filter((entry): entry is { branch: FunctionalBranchRef; expectedIdentity: string; overlap: number } => entry !== null)
    .sort((a, b) => b.overlap - a.overlap);

  if (normalizedCandidates.length > 0) {
    const top = normalizedCandidates[0];
    const second = normalizedCandidates[1];
    if (!second || top.overlap > second.overlap) {
      const actionEvidence = evaluateScenarioActionMatch(scenario, top.branch);
      return {
        branch: top.branch,
        associationMethod: "normalized_action",
        expectedActionIdentity: actionEvidence.expectedActionIdentity,
        actualActionIdentity: actionEvidence.actualActionIdentity,
        actionMatched: actionEvidence.actionMatched,
      };
    }
    return {
      branch: null,
      associationMethod: "none",
      expectedActionIdentity: "",
      actualActionIdentity,
      actionMatched: false,
      reasonCode: "branch_association_ambiguous",
    };
  }

  const scoredCandidates = issueScopedBranches
    .map((branch) => ({ branch, score: scoreScenarioToBranch(scenario, branch) }))
    .sort((a, b) => b.score - a.score);
  if (scoredCandidates.length > 0) {
    const top = scoredCandidates[0];
    const second = scoredCandidates[1];
    const uniqueTopScore = !second || top.score > second.score + 15;
    if (top.score >= 90 && uniqueTopScore) {
      const actionEvidence = evaluateScenarioActionMatch(scenario, top.branch);
      return {
        branch: top.branch,
        associationMethod: "textual_fallback",
        expectedActionIdentity: actionEvidence.expectedActionIdentity,
        actualActionIdentity: actionEvidence.actualActionIdentity,
        actionMatched: actionEvidence.actionMatched,
      };
    }
  }

  return {
    branch: null,
    associationMethod: "none",
    expectedActionIdentity: "",
    actualActionIdentity,
    actionMatched: false,
  };
}

function scoreScenarioToBranch(scenario: McpScenario, branch: FunctionalBranchRef): number {
  const steps = scenario.steps ?? [];
  const scenarioText = normalizeBranchText([scenario.title, ...steps, scenario.expectedResult ?? ""].join(" "));
  let score = 0;
  if (branch.sourceLabel && scenarioText.includes(normalizeBranchText(branch.sourceLabel))) score += 80;
  if (branch.expectedDestination && scenarioText.includes(normalizeBranchText(branch.expectedDestination))) score += 35;
  const branchTokens = new Set(nonGenericTokens([branch.sourceLabel ?? "", branch.actionIntent].join(" ")));
  if (branchTokens.size > 0) {
    const scenarioTokens = new Set(nonGenericTokens(scenarioText));
    let overlap = 0;
    for (const token of branchTokens) {
      if (scenarioTokens.has(token)) overlap++;
    }
    score += overlap * 10;
  }
  const scenarioAccess = inferScenarioAccessIntent(scenario);
  if (
    branch.accessIntent !== "unknown" &&
    scenarioAccess !== "unknown" &&
    branch.accessIntent !== scenarioAccess
  ) {
    score -= 15;
  }
  return score;
}

export function assignFunctionalBranchesToScenarios(
  scenarios: McpScenario[],
  branches: FunctionalBranchRef[],
): McpScenario[] {
  if (branches.length === 0) return scenarios;
  const branchById = new Map(branches.map((branch) => [branch.branchId, branch]));
  return scenarios.map((scenario) => {
    const decision = decideScenarioBranchAssociation(scenario, branches, branchById);
    const hasStructuredLineage = Boolean(
      decision.branch
      && decision.branch.sourceRequirementId
      && (scenario.stepRequirementRefs ?? []).some((ref) => ref.requirementId === decision.branch!.sourceRequirementId),
    );
    const branchAuthority = Boolean(
      decision.branch
      && (decision.associationMethod === "branch_id"
        || hasStructuredLineage),
    );
    if (decision.branch && branchAuthority) {
      return {
        ...scenario,
        functionalBranch: decision.branch,
        branchAssociation: {
          branchId: decision.branch.branchId,
          sourceIssueKey: scenario.sourceIssueKey,
          associationMethod: decision.associationMethod,
          associationMatched: true,
          expectedActionIdentity: decision.expectedActionIdentity,
          actualActionIdentity: decision.actualActionIdentity,
          actionMatched: decision.actionMatched,
          destinationEvidenceKind: "none",
          destinationEvidenceSource: "association_only",
          reasonCode: decision.reasonCode,
        },
      };
    }
    return {
      ...scenario,
      branchAssociation: {
        branchId: "none",
        sourceIssueKey: scenario.sourceIssueKey,
        associationMethod: decision.associationMethod === "textual_fallback" ? "textual_fallback" : "none",
        associationMatched: false,
        expectedActionIdentity: decision.expectedActionIdentity,
        actualActionIdentity: decision.actualActionIdentity,
        actionMatched: false,
        destinationEvidenceKind: "none",
        destinationEvidenceSource: "association_missing",
        reasonCode: decision.reasonCode,
      },
    };
  });
}

function buildBranchRouteCandidates(
  knowledgeCtx: KnowledgeContext,
  explicitRoutePath: string[],
): BranchRouteCandidate[] {
  const candidates: BranchRouteCandidate[] = [];
  for (let i = 0; i < (knowledgeCtx.navigationHints ?? []).length; i++) {
    const hint = knowledgeCtx.navigationHints[i];
    const accessFromText = inferAccessIntentFromText([
      ...(hint.clickTargets ?? []),
      ...(hint.authTerms ?? []),
    ].join(" "));
    const accessIntent: BranchAccessIntent = hint.authTerms.length > 0
      ? "authenticated"
      : accessFromText;
    if (Array.isArray(hint.clickTargets) && hint.clickTargets.length > 0) {
      candidates.push({
        routeId: `knowledge-${i + 1}`,
        clickTargets: hint.clickTargets,
        accessIntent,
        source: "knowledge",
        destination: (hint as { destination?: string }).destination,
        destinationSignals: (hint as { destinationSignals?: string[] }).destinationSignals,
        destinationUrl: (hint as { destinationUrl?: string }).destinationUrl,
      });
    }
  }

  if (explicitRoutePath.length > 0) {
    candidates.push({
      routeId: "hu-route",
      clickTargets: explicitRoutePath,
      accessIntent: inferAccessIntentFromText(explicitRoutePath.join(" ")),
      source: "hu_route",
    });
  }
  return candidates;
}

type BranchRouteCompatibility = {
  compatible: boolean;
  reason: "branch_action_mismatch" | "destination_mismatch" | "access_mismatch" | "ok";
  score: number;
};

function evaluateBranchRouteCompatibility(
  branch: FunctionalBranchRef | undefined,
  scenario: McpScenario,
  candidate: BranchRouteCandidate,
): BranchRouteCompatibility {
  if (!branch) return { compatible: true, reason: "ok", score: 1 };

  const routeText = candidate.clickTargets.join(" ");
  const routeTokenSet = new Set(nonGenericTokens(routeText));
  const destinationEvidenceText = [candidate.destination, ...(candidate.destinationSignals ?? [])].filter(Boolean).join(" ");
  const destinationTokenSet = new Set(nonGenericTokens(destinationEvidenceText));
  const branchActionTokens = new Set(nonGenericTokens([branch.sourceLabel ?? "", branch.actionIntent].join(" ")));
  const branchDestinationTokens = new Set(nonGenericTokens(branch.expectedDestination ?? ""));
  const scenarioActionIdentities = collectScenarioActionIdentities(scenario);
  const branchExpectedIdentity = expectedActionIdentity(branch);
  const association = scenario.branchAssociation;

  let actionOverlap = 0;
  for (const token of branchActionTokens) {
    if (routeTokenSet.has(token)) actionOverlap++;
  }
  for (const identity of scenarioActionIdentities) {
    actionOverlap = Math.max(actionOverlap, actionIdentityOverlap(branchExpectedIdentity, identity));
  }
  const matchesByAssociation = association?.branchId === branch.branchId && association.actionMatched === true;
  const matchesBranchAction = matchesByAssociation
    || (branchActionTokens.size === 0 ? true : actionOverlap > 0);

  let destinationOverlap = 0;
  for (const token of branchDestinationTokens) {
    if (destinationTokenSet.has(token)) destinationOverlap++;
  }
  const matchesExpectedDestination = branchDestinationTokens.size === 0 ? true : destinationOverlap > 0;

  let accessIntentCompatible = true;
  if (branch.accessIntent === "public" && candidate.accessIntent === "authenticated") {
    accessIntentCompatible = false;
  } else if (branch.accessIntent === "authenticated" && candidate.accessIntent === "public") {
    accessIntentCompatible = false;
  }

  const compatible = matchesBranchAction && matchesExpectedDestination && accessIntentCompatible;
  if (!matchesBranchAction) {
    return { compatible: false, reason: "branch_action_mismatch", score: 0 };
  }
  if (!matchesExpectedDestination) {
    return { compatible: false, reason: "destination_mismatch", score: actionOverlap };
  }
  if (!accessIntentCompatible) {
    return { compatible: false, reason: "access_mismatch", score: actionOverlap + destinationOverlap };
  }
  return { compatible, reason: "ok", score: actionOverlap * 2 + destinationOverlap };
}

function renumberScenarioSteps(steps: string[]): string[] {
  return steps.map((step, index) => `${index + 1}. ${step.replace(/^\d+[\.)]\s*/, "").trim()}`);
}

function stripStepNumbering(steps: string[]): string[] {
  return steps.map((step) => step.replace(/^\d+[\.)]\s*/, "").trim()).filter(Boolean);
}

function uniqueClickPrefixFromCandidate(candidate: BranchRouteCandidate): string[] {
  const seen = new Set<string>();
  const prefix: string[] = [];
  for (const target of candidate.clickTargets) {
    const normalized = normalizeBranchText(target);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    prefix.push(`Clic en "${target}".`);
  }
  return prefix;
}

function extractClickTargetLabel(step: string): string | undefined {
  const match = step.replace(/^\d+[\.)]\s*/, "").trim().match(/^Clic en "(.+)"\.?$/i);
  return match?.[1]?.trim();
}

function applicableEntryTargets(entrySteps: Array<{ action?: string; target?: string; when?: string }>): string[] {
  const targets: string[] = [];
  for (const entryStep of entrySteps) {
    if (entryStep.action !== "click") continue;
    if (!entryStep.target || !entryStep.target.trim()) continue;
    const when = (entryStep.when ?? "").trim().toLowerCase();
    if (when && when !== "before_first_functional_step") continue;
    targets.push(entryStep.target.trim());
  }
  return targets;
}

export function applyCanonicalRoutePrefix(
  steps: string[],
  routeClickTargets: string[],
  entrySteps: Array<{ action?: string; target?: string; when?: string }>,
  stepRequirementRefs: Array<{ stepIndex: number }> = [],
): { steps: string[]; stepOrigins: Array<number | undefined>; changed: boolean } {
  const normalize = (value: string) => normalizeBranchText(value);
  const canonicalTargets: string[] = [];
  const seenTargets = new Set<string>();
  for (const target of [...applicableEntryTargets(entrySteps), ...routeClickTargets]) {
    const normalizedTarget = normalize(target);
    if (!normalizedTarget || seenTargets.has(normalizedTarget)) continue;
    seenTargets.add(normalizedTarget);
    canonicalTargets.push(target);
  }

  if (canonicalTargets.length === 0) {
    return { steps, stepOrigins: steps.map((_, index) => index), changed: false };
  }

  const referencedIndexes = new Set(stepRequirementRefs.map((ref) => ref.stepIndex));
  const existingCanonicalTargets = new Set<string>();
  const remainingSteps: Array<{ step: string; originalIndex: number }> = [];
  for (const [originalIndex, step] of steps.entries()) {
    const target = extractClickTargetLabel(step);
    const normalizedTarget = target ? normalize(target) : "";
    if (normalizedTarget && seenTargets.has(normalizedTarget)) {
      if (existingCanonicalTargets.has(normalizedTarget) && !referencedIndexes.has(originalIndex)) continue;
      existingCanonicalTargets.add(normalizedTarget);
    }
    remainingSteps.push({ step, originalIndex });
  }
  const missingPrefix = canonicalTargets
    .filter((target) => !existingCanonicalTargets.has(normalize(target)))
    .map((target, index) => ({ step: formatEntryStep(target, index), originalIndex: undefined as number | undefined }));
  const rebuilt = [...missingPrefix.map(({ step }) => step), ...remainingSteps.map(({ step }) => step)];
  const stepOrigins = [...missingPrefix.map(({ originalIndex }) => originalIndex), ...remainingSteps.map(({ originalIndex }) => originalIndex)];
  const changed = rebuilt.length !== steps.length || rebuilt.some((step, index) => step !== steps[index]);
  return { steps: changed ? rebuilt : steps, stepOrigins: changed ? stepOrigins : steps.map((_, index) => index), changed };
}

function scenarioIdentity(scenario: Pick<McpScenario, "scenarioId" | "sourceIssueKey" | "title">): string {
  return scenario.scenarioId ?? `${scenario.sourceIssueKey}:${scenario.title}`;
}

type BranchCoverageComputationOptions = {
  automatableOptionFlowsCount?: number;
  coverageRequirementsAvailable?: boolean;
};

function quotedTargets(step: string): string[] {
  return Array.from(step.matchAll(/"([^"]+)"/g)).map((match) => normalizeBranchText(match[1]));
}

function extractClickTargets(scenario: McpScenario): string[] {
  const targets: string[] = [];
  for (const rawStep of scenario.steps ?? []) {
    const step = rawStep.replace(/^\d+[\.)]\s*/, "").trim();
    if (!/^clic en\s+"/i.test(step)) continue;
    for (const target of quotedTargets(step)) {
      if (target) targets.push(target);
    }
  }
  return targets;
}

function extractAssertionTargets(scenario: McpScenario): string[] {
  const targets = new Set<string>();
  for (const rawStep of scenario.steps ?? []) {
    const step = rawStep.replace(/^\d+[\.)]\s*/, "").trim();
    if (!/^(validar que|verificar que|comprobar que|visualizar que|esperar que)/i.test(step)) continue;
    for (const target of quotedTargets(step)) {
      if (target) targets.add(target);
    }
  }
  return Array.from(targets).sort();
}

function isAuthStartBranchDestination(requiredBranch: FunctionalBranchRef): boolean {
  if (requiredBranch.accessIntent !== "authenticated") return false;
  const expectedDestination = normalizeBranchText(requiredBranch.expectedDestination ?? "");
  const actionIntent = normalizeBranchText(requiredBranch.actionIntent ?? "");
  return /\b(auth|autentic\w*|login|sesion|identific\w*|acceso|ingreso)\b/i.test(expectedDestination)
    || /\b(auth|autentic\w*|login|sesion|identific\w*|acceso|ingreso)\b/i.test(actionIntent);
}

function hasObservableAuthBoundary(assertionTargets: string[], scenario: McpScenario): boolean {
  const conceptualOnlyPattern = /\b(flujo|proceso|inicio)\s+de\s+autentic\w*\b/i;
  const boundaryPatterns = [
    /\b(authgate|authflow)\b/i,
    /\b(login|iniciar sesion|inicio de sesion)\b/i,
    /\b(tipo de identific\w*|seleccione tipo de identific\w*)\b/i,
    /\b(identific\w*|documento|cedula|credencial)\b/i,
  ];

  for (const target of assertionTargets) {
    const normalizedTarget = normalizeBranchText(target);
    if (conceptualOnlyPattern.test(normalizedTarget)) continue;
    if (boundaryPatterns.some((pattern) => pattern.test(normalizedTarget))) {
      return true;
    }
  }

  const normalizedSteps = normalizeBranchText((scenario.steps ?? []).join(" "));
  return /\b(authgate|authflow)\b/i.test(normalizedSteps)
    || /\b(tipo de identific\w*|seleccione tipo de identific\w*|identific\w*)\b/i.test(normalizedSteps);
}

function hasBranchActionAndDestination(
  scenario: McpScenario,
  requiredBranch: FunctionalBranchRef,
): { hasAction: boolean; hasDestination: boolean } {
  const actionMatch = evaluateScenarioActionMatch(scenario, requiredBranch);
  const assertionTargets = extractAssertionTargets(scenario);
  const expectedDestination = normalizeBranchText(requiredBranch.expectedDestination ?? "");
  const hasAction = actionMatch.actionMatched;
  let hasDestination = expectedDestination.length > 0
    ? assertionTargets.some((target) => target === expectedDestination || target.includes(expectedDestination) || expectedDestination.includes(target))
    : false;
  if (!hasDestination && isAuthStartBranchDestination(requiredBranch)) {
    hasDestination = hasObservableAuthBoundary(assertionTargets, scenario);
  }

  return { hasAction, hasDestination };
}

type DestinationEvidenceAssessment = {
  destinationMatched: boolean;
  destinationEvidenceKind: "route" | "heading" | "marker" | "auth_gate" | "auth_gate_pending_discovery" | "structured_metadata" | "none";
  destinationEvidenceSource: string;
};

export function evaluateScenarioDestinationEvidence(
  scenario: McpScenario,
  requiredBranch: FunctionalBranchRef,
): DestinationEvidenceAssessment {
  const sharedEvidence = evaluateDestinationEvidence({
    transitionDetected: Boolean((scenario as any).transitionDetected),
    transitionValidated: Boolean((scenario as any).transitionValidated),
    routeCompatibility: (scenario as any)._branchRouteCompatibility?.compatible,
    expectedRouteIdentity: (scenario as any).expectedRouteIdentity,
  });
  if (sharedEvidence.destinationValidation === "validated") return {
    destinationMatched: true,
    destinationEvidenceKind: "route",
    destinationEvidenceSource: sharedEvidence.destinationEvidenceSource,
  };
  const expectedDestination = normalizeBranchText(requiredBranch.expectedDestination ?? "");
  const assertionTargets = extractAssertionTargets(scenario);
  const routeCompatibility = (scenario as any)._branchRouteCompatibility as
    | { compatible?: boolean; reason?: string; routeId?: string | null }
    | undefined;
  const hasAssertionDestination = expectedDestination.length > 0
    ? assertionTargets.some((target) => target === expectedDestination || target.includes(expectedDestination) || expectedDestination.includes(target))
    : false;
  const isAuthBoundary = isAuthStartBranchDestination(requiredBranch);
  const hasAuthBoundary = isAuthBoundary && hasObservableAuthBoundary(assertionTargets, scenario);
  const routeId = routeCompatibility?.routeId ?? "none";

  // Auth intent gate_observation: destination is an auth gate pending Discovery validation.
  // Do not depend on textual heuristic; authority is scenario.authIntent.
  if (scenario.authIntent === "gate_observation") {
    return {
      destinationMatched: false,
      destinationEvidenceKind: "auth_gate_pending_discovery",
      destinationEvidenceSource: "auth_intent_gate_observation_pending_discovery",
    };
  }

  // If route compatibility explicitly failed by destination, keep it as definitive negative.
  if (routeCompatibility?.compatible === false && routeCompatibility.reason === "destination_mismatch") {
    return {
      destinationMatched: false,
      destinationEvidenceKind: "none",
      destinationEvidenceSource: `route:${routeId}:destination_mismatch`,
    };
  }

  if (isAuthBoundary) {
    return {
      destinationMatched: false,
      destinationEvidenceKind: "auth_gate_pending_discovery",
      destinationEvidenceSource: hasAuthBoundary
        ? "assertion_without_runtime_auth_boundary"
        : "observable_auth_boundary_missing",
    };
  }

  if (routeCompatibility?.compatible === true) {
    return {
      destinationMatched: true,
      destinationEvidenceKind: "route",
      destinationEvidenceSource: `route:${routeId}`,
    };
  }

  return {
    destinationMatched: false,
    destinationEvidenceKind: "none",
    destinationEvidenceSource: hasAssertionDestination ? "assertion_without_route_support" : "destination_not_observed",
  };
}

export function evaluateScenarioBranchCoverageSignals(
  scenario: McpScenario,
  requiredBranch: FunctionalBranchRef,
): {
  associationMatched: boolean;
  accessCompatible: boolean;
  hasAction: boolean;
  expectedActionIdentity: string;
  actualActionIdentity: string;
  hasDestination: boolean;
  hasRouteEvidence: boolean;
  functionalBranchCovered: boolean;
  destinationValidationStatus: "validated" | "pending_discovery" | "mismatch";
  destinationEvidenceKind: "route" | "heading" | "marker" | "auth_gate" | "auth_gate_pending_discovery" | "structured_metadata" | "none";
  destinationEvidenceSource: string;
  reasonCode: "ok" | "branch_action_mismatch" | "destination_mismatch" | "destination_pending_discovery" | "access_mismatch" | "route_evidence_insufficient";
} {
  const associationMatched = scenario.functionalBranch?.branchId === requiredBranch.branchId;
  const accessCompatible =
    requiredBranch.accessIntent === "unknown"
    || scenario.functionalBranch?.accessIntent === undefined
    || scenario.functionalBranch.accessIntent === requiredBranch.accessIntent;
  const actionEvidence = evaluateScenarioActionMatch(scenario, requiredBranch);
  const hasAction = actionEvidence.actionMatched;
  const destinationEvidence = evaluateScenarioDestinationEvidence(scenario, requiredBranch);
  const hasDestination = destinationEvidence.destinationMatched;
  const routeCompatible = (scenario as any)._branchRouteCompatibility?.compatible === true;
  const hasIntermediateFailure = Boolean((scenario as any)._intermediateRepairFailure);
  const hasRouteEvidence = !hasIntermediateFailure
    && scenario.nonExecutableCriteria !== "route_evidence_insufficient"
    && (scenario.mcpExecutable !== false || routeCompatible);
  const destinationPendingDiscovery = destinationEvidence.destinationEvidenceKind === "auth_gate_pending_discovery";
  const functionalRefsPresent = (scenario.stepRequirementRefs ?? []).some((ref) =>
    ref.requirementId === requiredBranch.sourceRequirementId && Number.isInteger(ref.stepIndex) && ref.stepIndex >= 0 && ref.stepIndex < (scenario.steps ?? []).length,
  );
  const dependencySatisfied = (scenario as any).dependencySatisfied !== false;
  const functionalBranchCovered = associationMatched && accessCompatible && hasAction && functionalRefsPresent && dependencySatisfied;
  const destinationValidationStatus = destinationEvidence.destinationMatched
    ? "validated"
    : destinationPendingDiscovery
      ? "pending_discovery"
      : destinationEvidence.destinationEvidenceSource === "destination_not_observed"
        || destinationEvidence.destinationEvidenceSource === "assertion_without_route_support"
        ? "pending_discovery"
        : "mismatch";
  const reasonCode = !accessCompatible
    ? "access_mismatch"
    : !hasAction
      ? "branch_action_mismatch"
       : !functionalBranchCovered
       ? "branch_action_mismatch"
       : !hasDestination
         ? destinationPendingDiscovery
          ? "destination_pending_discovery"
          : "destination_mismatch"
        : !hasRouteEvidence
          ? "route_evidence_insufficient"
          : "ok";
  return {
    associationMatched,
    accessCompatible,
    hasAction,
    expectedActionIdentity: actionEvidence.expectedActionIdentity,
    actualActionIdentity: actionEvidence.actualActionIdentity,
    hasDestination,
    hasRouteEvidence,
     functionalBranchCovered,
     destinationValidationStatus,
    destinationEvidenceKind: destinationEvidence.destinationEvidenceKind,
    destinationEvidenceSource: destinationEvidence.destinationEvidenceSource,
    reasonCode,
  };
}

function semanticScenarioStrength(scenario: McpScenario): number {
  const steps = scenario.steps ?? [];
  const executableSteps = steps.filter((step) => /^(?:\d+[\.)]\s*)?(Clic en|Validar que|Verificar que|Comprobar que|Visualizar que|Esperar que|Seleccionar|Ingresar|Completar)/i.test(step)).length;
  const clickTargets = extractClickTargets(scenario);
  const assertionTargets = extractAssertionTargets(scenario);
  const branch = scenario.functionalBranch;
  const branchChecks = branch ? hasBranchActionAndDestination(scenario, branch) : { hasAction: clickTargets.length > 0, hasDestination: assertionTargets.length > 0 };
  const routeCompatibility = (scenario as any)._branchRouteCompatibility;
  let routeEvidenceScore = 0;
  if (routeCompatibility?.compatible === true) routeEvidenceScore += 2;
  if (routeCompatibility?.routeId) routeEvidenceScore += 1;
  return executableSteps * 2
    + (branchChecks.hasAction ? 4 : 0)
    + (branchChecks.hasDestination ? 4 : 0)
    + routeEvidenceScore
    + clickTargets.length
    + assertionTargets.length;
}

export function buildScenarioSemanticSignature(scenario: McpScenario): string {
  const steps = (scenario.steps ?? []).map((step) => step.replace(/^\d+[\.)]\s*/, "").trim());
  const actionSequence = steps.map((step) => {
    if (/^clic en\s+"/i.test(step)) return `click:${quotedTargets(step).join("/")}`;
    if (/^(validar que|verificar que|comprobar que|visualizar que|esperar que)/i.test(step)) return "assert";
    if (/^(ingresar|completar|llenar)/i.test(step)) return "fill";
    if (/^seleccionar/i.test(step)) return "select";
    return normalizeBranchText(step);
  });
  const nonAssertionActionSequence = actionSequence.filter((action) => action !== "assert");
  const clickSequence = extractClickTargets(scenario).join(">");
  const assertionSet = extractAssertionTargets(scenario).join("|");
  const branchId = scenario.functionalBranch?.branchId ?? "none";
  const accessIntent = scenario.functionalBranch?.accessIntent ?? inferScenarioAccessIntent(scenario);
  const expectedDestination = normalizeBranchText(scenario.functionalBranch?.expectedDestination ?? "");
  const expectedResult = normalizeBranchText(scenario.expectedResult ?? "").replace(/\b(validar|verificar|comprobar|visualizar|mostrar)\b/g, "").trim();
  return [
    `branch:${branchId}`,
    `access:${accessIntent}`,
    `actions:${nonAssertionActionSequence.join(">")}`,
    `clicks:${clickSequence}`,
    `assertions:${assertionSet}`,
    `destination:${expectedDestination}`,
    `expected:${expectedResult}`,
  ].join("|");
}

export function dedupeScenariosBySemanticSignature<T extends McpScenario>(
  scenarios: T[],
): { scenarios: T[]; removed: number } {
  const bySignature = new Map<string, T>();
  let removed = 0;
  for (const scenario of scenarios) {
    const signature = buildScenarioSemanticSignature(scenario);
    const existing = bySignature.get(signature);
    if (!existing) {
      bySignature.set(signature, scenario);
      continue;
    }
    if (semanticScenarioStrength(scenario) > semanticScenarioStrength(existing)) {
      bySignature.set(signature, scenario);
    }
    removed++;
  }
  return { scenarios: Array.from(bySignature.values()), removed };
}

export function evaluateGenerationSuccess(
  responseVisibilityEqual: boolean,
  branchCoverage: BranchCoverageCheck,
  coverageRequirementsAvailable: boolean,
  integrityChecks: {
    omittedValid?: boolean;
    categoriesDisjoint?: boolean;
    functionalCoverageValid?: boolean;
    providerClaimComplianceValid?: boolean;
  } = {},
): GenerationSuccessCheck {
  const blockedReasons: GenerationSuccessCheck["blockedReasons"] = [];
  if (!responseVisibilityEqual) blockedReasons.push("response_visibility_mismatch");
  if (!branchCoverage.valid) blockedReasons.push("branch_coverage_invalid");
  if (!coverageRequirementsAvailable) blockedReasons.push("coverage_requirements_unavailable");
  if (integrityChecks.omittedValid === false) blockedReasons.push("omitted_invalid");
  if (integrityChecks.categoriesDisjoint === false) blockedReasons.push("category_overlap_detected");
  if (integrityChecks.functionalCoverageValid === false) blockedReasons.push("requirement_coverage_incomplete");
  if (integrityChecks.providerClaimComplianceValid === false) blockedReasons.push("provider_claim_compliance_invalid");
  return {
    generationSuccess: blockedReasons.length === 0,
    blockedReasons,
  };
}

export function markScenariosAsCoverageDiagnostics<T extends McpScenario>(
  scenarios: T[],
  branchCoverage: BranchCoverageCheck,
): T[] {
  const defaultReason = branchCoverage.reasonCode === "coverage_requirements_unavailable"
    ? "coverage_requirements_unavailable"
    : "branch_coverage_incomplete";
  return scenarios.map((scenario) => ({
    ...scenario,
    mcpExecutable: false,
    executionMode: "adaptive",
    nonExecutableCriteria: scenario.nonExecutableCriteria || defaultReason,
    automationStatus: "requires_route_discovery",
  }));
}

function deriveCoverageRequirementsFromFunctionalBranches(
  functionalBranches: FunctionalBranchRef[],
): Array<{
  id: string;
  sourceText: string;
  category: string;
  automatable: boolean;
  required: boolean;
  coveredBy: Array<{ scenarioId: string; evidenceSteps: number[]; confidence: number }>;
  status: string;
  reasonCode?: string;
}> {
  const requirements: Array<{
    id: string;
    sourceText: string;
    category: string;
    automatable: boolean;
    required: boolean;
    coveredBy: Array<{ scenarioId: string; evidenceSteps: number[]; confidence: number }>;
    status: string;
    reasonCode?: string;
  }> = [];
  let index = 0;
  for (const branch of functionalBranches) {
    const sourceLabel = branch.sourceLabel?.trim();
    const expectedDestination = branch.expectedDestination?.trim();
    if (sourceLabel) {
      requirements.push({
        id: `FB-${++index}`,
        sourceText: `Branch action: ${sourceLabel}`,
        category: "branch_action",
        automatable: true,
        required: true,
        coveredBy: [],
        status: "uncovered",
      });
    }
    if (expectedDestination) {
      requirements.push({
        id: `FB-${++index}`,
        sourceText: `Branch destination: ${expectedDestination}`,
        category: "branch_destination",
        automatable: true,
        required: true,
        coveredBy: [],
        status: "uncovered",
      });
    }
  }
  return requirements;
}

function ensureCoverageRequirementsAvailable(functionalBranches: FunctionalBranchRef[]): boolean {
  const existingRequirements = (globalThis as any).__coverageReqs;
  if (Array.isArray(existingRequirements)) return true;
  const derivedRequirements = deriveCoverageRequirementsFromFunctionalBranches(functionalBranches);
  if (derivedRequirements.length === 0) return false;
  (globalThis as any).__coverageReqs = derivedRequirements;
  console.log(
    `[coverage] fallback_requirements source=functional_branches requirements=${derivedRequirements.length} branches=${functionalBranches.length}`,
  );
  return true;
}

export function preserveScenarioOnIntermediateRepairFailure(
  scenario: McpScenario,
  repairResult: IntermediateRepairResult,
): McpScenario {
  const errorDiag = repairResult.diagnostics.find((diag) => diag.level === "error");
  return {
    ...scenario,
    steps: [...scenario.steps],
    mcpExecutable: false,
    nonExecutableCriteria: scenario.nonExecutableCriteria || "route_evidence_insufficient",
    automationStatus: "requires_route_discovery",
    _blockedReason: "route_evidence_insufficient",
    _intermediateRepairFailure: {
      reasonCode: repairResult.reasonCode,
      target: errorDiag?.target ?? "unknown",
      decision: errorDiag?.decision ?? "rejected_unresolvable",
      message: errorDiag?.message ?? "Intermediate path could not be repaired",
    },
  } as McpScenario;
}

export type VisibleScenarioSetComparison = {
  equal: boolean;
  finalVisibleIds: string[];
  responseVisibleIds: string[];
  missingInResponse: string[];
  unexpectedInResponse: string[];
};

export function compareVisibleScenarioSets(
  finalVisibleScenarios: Array<Pick<McpScenario, "scenarioId" | "sourceIssueKey" | "title">>,
  responseVisibleScenarios: Array<Pick<McpScenario, "scenarioId" | "sourceIssueKey" | "title">>,
): VisibleScenarioSetComparison {
  const finalVisibleIds = finalVisibleScenarios.map((scenario) => scenarioIdentity(scenario));
  const responseVisibleIds = responseVisibleScenarios.map((scenario) => scenarioIdentity(scenario));
  const finalVisibleSet = new Set(finalVisibleIds);
  const responseVisibleSet = new Set(responseVisibleIds);
  const missingInResponse = [...finalVisibleSet].filter((id) => !responseVisibleSet.has(id));
  const unexpectedInResponse = [...responseVisibleSet].filter((id) => !finalVisibleSet.has(id));
  return {
    equal: missingInResponse.length === 0 && unexpectedInResponse.length === 0,
    finalVisibleIds,
    responseVisibleIds,
    missingInResponse,
    unexpectedInResponse,
  };
}

export type ResponseAssemblyMetrics = {
  candidateIds: string[];
  visibleCandidateIds: string[];
  rejectedCandidateIds: string[];
  omitted: number;
  omittedValid: boolean;
  categoriesDisjoint: boolean;
  overlapIds: string[];
};

function extractRejectedScenarioIds(rejected: McpRejectedScenario[]): Set<string> {
  const rejectedIds = new Set<string>();
  for (const rejectedItem of rejected) {
    const explicitScenarioId = typeof (rejectedItem as any).scenarioId === "string"
      ? String((rejectedItem as any).scenarioId).trim()
      : "";
    if (explicitScenarioId) {
      rejectedIds.add(explicitScenarioId);
      continue;
    }
    const reasonMatch = rejectedItem.reason?.match(/\bscenarioId\s*[:=]\s*([^\s,;]+)/i);
    if (reasonMatch?.[1]) {
      rejectedIds.add(reasonMatch[1].trim());
    }
  }
  return rejectedIds;
}

export function computeResponseAssemblyMetrics(
  candidateScenarios: Array<Pick<McpScenario, "scenarioId" | "sourceIssueKey" | "title">>,
  executableScenarios: Array<Pick<McpScenario, "scenarioId" | "sourceIssueKey" | "title">>,
  adaptiveScenarios: Array<Pick<McpScenario, "scenarioId" | "sourceIssueKey" | "title">>,
  rejected: McpRejectedScenario[],
): ResponseAssemblyMetrics {
  const candidateIds = Array.from(new Set(candidateScenarios.map((scenario) => scenarioIdentity(scenario))));
  const candidateSet = new Set(candidateIds);
  const visibleIdsSet = new Set(
    [...executableScenarios, ...adaptiveScenarios]
      .map((scenario) => scenarioIdentity(scenario))
      .filter((id) => candidateSet.has(id)),
  );

  const explicitRejectedIds = extractRejectedScenarioIds(rejected);
  const rejectedCandidateIds = candidateIds.filter((id) => explicitRejectedIds.has(id));

  const omittedSet = new Set(candidateIds);
  for (const id of visibleIdsSet) omittedSet.delete(id);
  for (const id of rejectedCandidateIds) omittedSet.delete(id);

  const standardIds = Array.from(new Set(executableScenarios.map((scenario) => scenarioIdentity(scenario))));
  const adaptiveIdsSet = new Set(adaptiveScenarios.map((scenario) => scenarioIdentity(scenario)));
  const overlapIds = standardIds.filter((id) => adaptiveIdsSet.has(id));
  const categoriesDisjoint = overlapIds.length === 0;

  return {
    candidateIds,
    visibleCandidateIds: candidateIds.filter((id) => visibleIdsSet.has(id)),
    rejectedCandidateIds,
    omitted: omittedSet.size,
    omittedValid: omittedSet.size >= 0,
    categoriesDisjoint,
    overlapIds,
  };
}

type BranchRecoveryEvidenceCheck = {
  recoverable: boolean;
  reason:
    | "ok"
    | "missing_visible_action"
    | "missing_visible_destination"
    | "route_evidence_insufficient";
  routeId?: string;
};

export function evaluateBranchRecoveryEvidence(
  branch: FunctionalBranchRef | undefined,
  routeCandidates: BranchRouteCandidate[],
): BranchRecoveryEvidenceCheck {
  if (!branch?.sourceLabel) {
    return { recoverable: false, reason: "missing_visible_action" };
  }
  if (!branch.expectedDestination) {
    return { recoverable: false, reason: "missing_visible_destination" };
  }
  const probeScenario: McpScenario = {
    sourceIssueKey: "branch-recovery-probe",
    title: `Validar rama ${branch.sourceLabel}`,
    steps: [
      `1. Clic en "${branch.sourceLabel}".`,
      `2. Validar que se muestre "${branch.expectedDestination}".`,
    ],
    preconditions: [],
    expectedResult: `Se alcanza ${branch.expectedDestination}.`,
    type: "functional",
    database: "",
    isConverted: 0,
    automationType: "ui_discovery",
    setupStrategy: "no_login",
    appSlug: "probe",
    routeProfile: "",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: false,
    functionalBranch: branch,
  };
  for (const candidate of routeCandidates) {
    const compatibility = evaluateBranchRouteCompatibility(branch, probeScenario, candidate);
    if (compatibility.compatible) {
      return { recoverable: true, reason: "ok", routeId: candidate.routeId };
    }
  }
  return { recoverable: false, reason: "route_evidence_insufficient" };
}

export function applyBranchRoutePrefixRepair(
  scenarios: McpScenario[],
  routeCandidates: BranchRouteCandidate[],
): { scenarios: McpScenario[]; repairedCount: number; incompatibleCount: number } {
  let repairedCount = 0;
  let incompatibleCount = 0;

  const repairedScenarios = scenarios.map((scenario) => {
    const branch = scenario.functionalBranch;
    const actionEvidence = branch
      ? evaluateScenarioActionMatch(scenario, branch)
      : {
          expectedActionIdentity: scenario.branchAssociation?.expectedActionIdentity ?? "",
          actualActionIdentity: scenario.branchAssociation?.actualActionIdentity ?? "",
          actionMatched: scenario.branchAssociation?.actionMatched === true,
        };
    let selectedCandidate: BranchRouteCandidate | null = null;
    let selectedScore = Number.NEGATIVE_INFINITY;
    let lastReason: BranchRouteCompatibility["reason"] = "branch_action_mismatch";

    for (const candidate of routeCandidates) {
      if (!branch && routeCandidates.length > 1) {
        lastReason = "branch_action_mismatch";
        continue;
      }
      const compatibility = evaluateBranchRouteCompatibility(branch, scenario, candidate);
      if (!compatibility.compatible) {
        incompatibleCount++;
        lastReason = compatibility.reason;
        continue;
      }
      if (compatibility.score > selectedScore) {
        selectedScore = compatibility.score;
        selectedCandidate = candidate;
      }
    }

    if (!selectedCandidate) {
      return {
        ...scenario,
        steps: [...(scenario.steps ?? [])],
        _branchRouteCompatibility: {
          compatible: false,
          reason: lastReason,
          routeId: null,
        },
        branchAssociation: {
          ...(scenario.branchAssociation ?? {
            branchId: branch?.branchId ?? "none",
            sourceIssueKey: scenario.sourceIssueKey,
            associationMethod: branch?.branchId ? "branch_id" : "none",
            associationMatched: Boolean(branch?.branchId),
            expectedActionIdentity: actionEvidence.expectedActionIdentity,
            actualActionIdentity: actionEvidence.actualActionIdentity,
            actionMatched: false,
          }),
          branchId: branch?.branchId ?? scenario.branchAssociation?.branchId ?? "none",
          actionMatched: actionEvidence.actionMatched,
          destinationMatched: false,
          destinationEvidenceKind: "none",
          destinationEvidenceSource: "route_candidates:destination_mismatch_or_incompatible",
          reasonCode: lastReason,
        },
      } as McpScenario;
    }

    const existingSteps = stripStepNumbering(scenario.steps ?? []);
    const requiredPrefix = uniqueClickPrefixFromCandidate(selectedCandidate);
    const prefixTargets = new Set<string>();
    for (const prefixStep of requiredPrefix) {
      const clickMatch = prefixStep.match(/Clic en "(.+)"\./i);
      if (clickMatch?.[1]) prefixTargets.add(normalizeBranchText(clickMatch[1]));
    }

    const filteredSteps = existingSteps.map((step, originalIndex) => ({ step, originalIndex })).filter(({ step }) => {
      const clickMatch = step.match(/^Clic en "(.+)"\.?$/i);
      if (!clickMatch?.[1]) return true;
      return !prefixTargets.has(normalizeBranchText(clickMatch[1]));
    });
    const existingNorm = new Set(filteredSteps.map(({ step }) => normalizeBranchText(step)));
    const missingPrefix = requiredPrefix.filter((prefixStep) => {
      const clickMatch = prefixStep.match(/Clic en "(.+)"\./i);
      return clickMatch?.[1] ? !existingNorm.has(normalizeBranchText(clickMatch[1])) : false;
    });
    const merged = missingPrefix.length > 0
      ? [...missingPrefix.map((step) => ({ step, originalIndex: undefined as number | undefined })), ...filteredSteps]
      : filteredSteps;
    if (missingPrefix.length > 0) repairedCount++;
    return {
      ...scenario,
      steps: renumberScenarioSteps(merged.map(({ step }) => step)),
      ...(scenario.stepClaims ? {
        stepClaims: remapStepClaimsByOrigins(
          scenario.stepClaims,
          merged.map(({ originalIndex }) => originalIndex),
        ),
      } : {}),
      _branchRouteCompatibility: {
        compatible: true,
        reason: "ok",
        routeId: selectedCandidate.routeId,
      },
      branchAssociation: {
        ...(scenario.branchAssociation ?? {
          branchId: branch?.branchId ?? "none",
          sourceIssueKey: scenario.sourceIssueKey,
          associationMethod: branch?.branchId ? "branch_id" : "none",
          associationMatched: Boolean(branch?.branchId),
          expectedActionIdentity: actionEvidence.expectedActionIdentity,
          actualActionIdentity: actionEvidence.actualActionIdentity,
          actionMatched: false,
        }),
        branchId: branch?.branchId ?? scenario.branchAssociation?.branchId ?? "none",
        actionMatched: actionEvidence.actionMatched,
        destinationMatched: true,
        destinationEvidenceKind: "route",
        destinationEvidenceSource: `route:${selectedCandidate.routeId}`,
        reasonCode: actionEvidence.actionMatched ? "ok" : "branch_action_mismatch",
      },
    } as McpScenario;
  });

  return { scenarios: repairedScenarios, repairedCount, incompatibleCount };
}

export function computeBranchCoverageCheck(
  requiredBranches: FunctionalBranchRef[],
  finalScenarios: McpScenario[],
  options: BranchCoverageComputationOptions = {},
): BranchCoverageCheck {
  const automatableOptionFlowsCount = options.automatableOptionFlowsCount ?? 0;
  const coverageRequirementsAvailable = options.coverageRequirementsAvailable ?? true;
  const requiredBranchIds = Array.from(new Set(requiredBranches.map((branch) => branch.branchId)));
  const requiredById = new Map(requiredBranches.map((branch) => [branch.branchId, branch]));
  const coveredBranchIds = new Set<string>();
  const pendingBranchIds = new Set<string>();

  if (requiredBranchIds.length === 0) {
    if (automatableOptionFlowsCount > 0) {
      return {
        required: 0,
        covered: 0,
        missing: [],
        pending: [],
        unexpected: [],
        requiredBranchIds: [],
        coveredBranchIds: [],
        pendingBranchIds: [],
        reasonCode: "branch_extraction_mismatch",
        valid: false,
      };
    }
    return {
      required: 0,
      covered: 0,
      missing: [],
      pending: [],
      unexpected: [],
      requiredBranchIds: [],
      coveredBranchIds: [],
      pendingBranchIds: [],
      valid: true,
    };
  }

  for (const scenario of finalScenarios) {
    const branchId = scenario.functionalBranch?.branchId;
    if (!branchId) continue;
    const requiredBranch = requiredById.get(branchId);
    if (!requiredBranch) {
      coveredBranchIds.add(branchId);
      continue;
    }
    const coverageSignals = evaluateScenarioBranchCoverageSignals(scenario, requiredBranch);
    if (coverageSignals.functionalBranchCovered) {
      coveredBranchIds.add(branchId);
    }
    if (coverageSignals.destinationValidationStatus === "pending_discovery") {
      pendingBranchIds.add(branchId);
    }
  }

  const coveredRequired = requiredBranchIds.filter((branchId) => coveredBranchIds.has(branchId));
  const pending = requiredBranchIds.filter((branchId) => pendingBranchIds.has(branchId) && !coveredBranchIds.has(branchId)
    && finalScenarios.some((scenario) => {
      const requiredBranch = requiredById.get(branchId);
      return requiredBranch
        && scenario.functionalBranch?.branchId === branchId
        && evaluateScenarioBranchCoverageSignals(scenario, requiredBranch).functionalBranchCovered;
    }));
  const missing = requiredBranchIds.filter((branchId) => !coveredBranchIds.has(branchId) && !pendingBranchIds.has(branchId));
  const unexpected = Array.from(coveredBranchIds).filter((branchId) => !requiredById.has(branchId));
  const validByCoverage = missing.length === 0;
  const valid = validByCoverage && coverageRequirementsAvailable;

  return {
    required: requiredBranchIds.length,
    covered: coveredRequired.length,
    missing,
    pending,
    unexpected,
    requiredBranchIds,
    coveredBranchIds: coveredRequired,
    pendingBranchIds: Array.from(pendingBranchIds),
    reasonCode: coverageRequirementsAvailable ? undefined : "coverage_requirements_unavailable",
    valid,
  };
}

export type BranchCoverageReclassificationSummary = {
  considered: number;
  affected: number;
  changed: number;
  affectedScenarioIds: string[];
};

export function reclassifyScenariosByBranchCoverage(
  executableScenarios: McpScenario[],
  adaptiveScenarios: McpScenario[],
  requiredBranches: FunctionalBranchRef[],
  options: BranchCoverageComputationOptions = {},
): {
  executableScenarios: McpScenario[];
  adaptiveScenarios: McpScenario[];
  summary: BranchCoverageReclassificationSummary;
} {
  if (requiredBranches.length === 0 || executableScenarios.length === 0) {
    return {
      executableScenarios,
      adaptiveScenarios,
      summary: {
        considered: 0,
        affected: 0,
        changed: 0,
        affectedScenarioIds: [],
      },
    };
  }

  const preReclassificationCoverage = computeBranchCoverageCheck(
    requiredBranches,
    [...executableScenarios, ...adaptiveScenarios],
    options,
  );
  const missingBranchIds = new Set(preReclassificationCoverage.missing);
  const requiredById = new Map(requiredBranches.map((branch) => [branch.branchId, branch]));
  const retainedExecutable: McpScenario[] = [];
  const reclassifiedAsAdaptive: McpScenario[] = [];
  const affectedBranchScenarioIds = new Set<string>();
  let considered = 0;

  for (const scenario of executableScenarios) {
    const branchId = scenario.functionalBranch?.branchId;
    if (!branchId) {
      retainedExecutable.push(scenario);
      continue;
    }
    const requiredBranch = requiredById.get(branchId);
    if (!requiredBranch) {
      retainedExecutable.push(scenario);
      continue;
    }
    considered++;
    const coverageSignals = evaluateScenarioBranchCoverageSignals(scenario, requiredBranch);
    const reasonCode = coverageSignals.reasonCode;
    scenario.branchAssociation = {
      ...(scenario.branchAssociation ?? {
        branchId,
        sourceIssueKey: scenario.sourceIssueKey,
        associationMethod: "none",
        associationMatched: false,
        expectedActionIdentity: coverageSignals.expectedActionIdentity,
        actualActionIdentity: coverageSignals.actualActionIdentity,
        actionMatched: false,
      }),
      branchId,
      associationMatched: coverageSignals.associationMatched,
      expectedActionIdentity: coverageSignals.expectedActionIdentity,
      actualActionIdentity: coverageSignals.actualActionIdentity,
      actionMatched: coverageSignals.hasAction,
      destinationMatched: coverageSignals.hasDestination,
      destinationEvidenceKind: coverageSignals.destinationEvidenceKind,
      destinationEvidenceSource: coverageSignals.destinationEvidenceSource,
      reasonCode,
    };
    if (coverageSignals.functionalBranchCovered || !missingBranchIds.has(branchId) || reasonCode === "destination_pending_discovery") {
      retainedExecutable.push(scenario);
      continue;
    }

    affectedBranchScenarioIds.add(scenarioIdentity(scenario));
    const nonExecutableCriteria = coverageSignals.hasRouteEvidence
      ? "branch_coverage_incomplete"
      : "route_evidence_insufficient";
    reclassifiedAsAdaptive.push({
      ...scenario,
      executionMode: "adaptive",
      mcpExecutable: false,
      nonExecutableCriteria,
      automationStatus: "requires_route_discovery",
      _blockedReason: nonExecutableCriteria,
      _branchCoverageIncomplete: {
        branchId,
        hasAction: coverageSignals.hasAction,
        hasDestination: coverageSignals.hasDestination,
        accessCompatible: coverageSignals.accessCompatible,
        hasRouteEvidence: coverageSignals.hasRouteEvidence,
        reasonCode,
      },
    } as McpScenario);
  }

  return {
    executableScenarios: retainedExecutable,
    adaptiveScenarios: [...adaptiveScenarios, ...reclassifiedAsAdaptive],
    summary: {
      considered,
      affected: affectedBranchScenarioIds.size,
      changed: reclassifiedAsAdaptive.length,
      affectedScenarioIds: Array.from(affectedBranchScenarioIds),
    },
  };
}

function loadAppConfigSync(appSlug: string): Record<string, unknown> | null {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const appsDir = path.join(process.cwd(), "automations", "apps");
    const appConfigPath = path.join(appsDir, appSlug, "app.config.json");
    if (!fs.existsSync(appConfigPath)) return null;
    const content = fs.readFileSync(appConfigPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

type EntryStepConfig = {
  action: string;
  target: string;
  when?: string;
  reason?: string;
};

function buildRouteProfileForPrompt(
  targetAppSlug: string,
  requestRouteProfile?: McpRouteProfile,
  jiraSummary?: string,
  jiraDescription?: string,
  testrailSectionName?: string,
  scenarioTitles?: string[],
): { routeProfile: McpRouteProfile | null; source: string; entrySteps: EntryStepConfig[]; loginMode?: string } {
  console.log(`[route-profile] resolving routeProfile targetAppSlug=${targetAppSlug} requestRouteProfile=${requestRouteProfile?.name ?? "none"}`);

  // 1. Explicit routeProfile from request
  if (requestRouteProfile && requestRouteProfile.name) {
    const rp = requestRouteProfile as Record<string, unknown>;
    const es = Array.isArray(rp.entrySteps) ? rp.entrySteps as EntryStepConfig[] : [];
    console.log(`[route-profile] source=request name=${requestRouteProfile.name} entry=${requestRouteProfile.entry?.length ?? 0} entrySteps=${es.length} domainTerms=${Object.keys(requestRouteProfile.domainTerms ?? {}).length} visibleControls=${requestRouteProfile.visibleControls?.length ?? 0}`);
    return { routeProfile: requestRouteProfile, source: "request", entrySteps: es };
  }

  // 2. Load from app.config.json
  const appConfig = loadAppConfigSync(targetAppSlug);
  console.log(`[route-profile] appConfig loaded=${appConfig !== null} hasRouteProfile=${appConfig?.routeProfile !== undefined}`);
  const configRp = getRouteProfileFromConfig(appConfig);
  if (configRp) {
    const entry = configRp.entry as unknown[] | undefined;
    const aliases = configRp.aliases as Record<string, unknown> | undefined;
    const domainTerms = configRp.domainTerms as Record<string, unknown> | undefined;
    const visibleControls = configRp.visibleControls as unknown[] | undefined;
    const entrySteps = configRp.entrySteps as unknown[] | undefined;

    console.log(`[route-profile] configRp found name=${configRp.name} entry=${entry?.length ?? 0} aliases=${Object.keys(aliases ?? {}).length} domainTerms=${Object.keys(domainTerms ?? {}).length} visibleControls=${visibleControls?.length ?? 0} entrySteps=${entrySteps?.length ?? 0}`);

    if ((entry && entry.length > 0) || (aliases && Object.keys(aliases).length > 0)) {
      const es = Array.isArray(configRp.entrySteps) ? configRp.entrySteps as EntryStepConfig[] : [];
      console.log(`[route-profile] source=app_config returning routeProfile name=${configRp.name}`);
      return {
        routeProfile: {
          ...configRp,
          fieldProvenance: {
            entry: "explicit_trusted_config",
            aliases: "explicit_trusted_config",
            intermediates: "explicit_trusted_config",
            domainTerms: "explicit_trusted_config",
            visibleControls: "explicit_trusted_config",
            entrySteps: "explicit_trusted_config",
            targetPaths: Object.values((configRp.targetPaths ?? {}) as Record<string, { source?: string }>).every((path) => !path.source || ["config", "manual", "user_confirmed"].includes(path.source))
              ? "explicit_trusted_config"
              : "declared_hint",
          },
        } as unknown as McpRouteProfile,
        source: "app_config",
        entrySteps: es,
        loginMode: appConfig?.loginMode as string | undefined,
      };
    } else {
      console.log(`[route-profile] configRp found but entry/aliases validation failed - entry.length=${entry?.length ?? 0} aliases.keys=${Object.keys(aliases ?? {}).length}`);
    }
  } else {
    console.log(`[route-profile] configRp=null after getRouteProfileFromConfig`);
  }

  // 3. Seed for KIOSKO / Información de productos
  if (
    detectKioskoInfoProductos({
      targetAppSlug,
      jiraSummary,
      jiraDescription,
      testrailSectionName,
      scenarioTitles,
    })
  ) {
    const seed = {
      ...(seedKioskoInfoProductosRouteProfile() as unknown as McpRouteProfile),
      fieldProvenance: {
        entry: "declared_hint",
        aliases: "declared_hint",
        intermediates: "declared_hint",
        domainTerms: "declared_hint",
        visibleControls: "declared_hint",
        entrySteps: "declared_hint",
        targetPaths: "declared_hint",
      },
    } as McpRouteProfile;
    console.log(`[route-profile] source=seed_kiosko_info_productos name=${seed.name}`);
    return {
      routeProfile: seed,
      source: "seed_kiosko_info_productos",
      entrySteps: [],
      loginMode: appConfig?.loginMode as string | undefined,
    };
  }

  // 4. Default empty
  console.log(`[route-profile] source=default returning null routeProfile`);
  return { routeProfile: null, source: "default", entrySteps: [], loginMode: appConfig?.loginMode as string | undefined };
}

/**
 * Public entry point. The underlying generator (generateScenarioPreviewForIssue) is
 * architecturally single-issue: intent detection, route resolution and the
 * route-pending fallback builder are all anchored to one representative issue.
 * When a request matches multiple Jira issues (e.g. a whole sprint/status batch),
 * this wrapper runs the generator once per issue and merges the results, instead
 * of silently generating scenarios for only the first issue.
 */
export async function generateScenarioPreview(
  req: ScenarioPreviewRequest,
): Promise<ScenarioPreviewResponse | ScenarioPreviewError> {
  if (!req.projectKey) {
    return { ok: false, error: "invalid_request", message: "projectKey is required" };
  }
  if (!req.activeSprint && !req.sprintId) {
    return { ok: false, error: "invalid_request", message: "activeSprint: true or sprintId is required" };
  }
  (globalThis as any).__coverageReqs = undefined;

  // Discover which issue keys to process. If the caller already selected specific
  // issues, honor that selection; otherwise query Jira with the same filters that
  // generateScenarioPreviewForIssue applies internally.
  let issueKeys = req.selectedIssueKeys?.filter(Boolean) ?? [];
  if (issueKeys.length === 0) {
    const discoveryJiraConfig = requireJiraConfig(config);
    const discoveryJira = new JiraClient(discoveryJiraConfig);
    let discoverySprintId: number;
    if (req.activeSprint) {
      const active = await discoveryJira.getActiveSprint(req.projectKey);
      if (!active) {
        return { ok: false, error: "no_active_sprint", message: `No hay sprint activo para el proyecto ${req.projectKey}` };
      }
      discoverySprintId = active.id;
    } else {
      discoverySprintId = req.sprintId!;
    }
    const discovered = await loadJiraIssues(discoveryJiraConfig, req.projectKey, discoverySprintId, req.status, req.maxResults ?? 50);
    issueKeys = discovered.map((i) => i.key);
  }

  const maxIssues = Number(process.env.SCENARIO_PREVIEW_MAX_ISSUES) || 5;
  if (issueKeys.length > maxIssues) {
    console.log(`[scenarios:preview] limiting issues from ${issueKeys.length} to ${maxIssues}`);
    issueKeys = issueKeys.slice(0, maxIssues);
  }

  if (issueKeys.length === 0) {
    // Preserve the original "no issues found" response shape.
    return generateScenarioPreviewForIssue(req);
  }

  console.log(`[scenarios:preview] batch processing ${issueKeys.length} issue(s): ${issueKeys.join(", ")}`);

  const perIssueResults: ScenarioPreviewResponse[] = [];
  const issueFailures: McpRejectedScenario[] = [];

  for (let i = 0; i < issueKeys.length; i++) {
    const key = issueKeys[i];
    console.log(`[scenarios:preview] processing issue ${key} (${i + 1}/${issueKeys.length})`);
    const result = await generateScenarioPreviewForIssue({ ...req, selectedIssueKeys: [key] });
    if (!result.ok) {
      const errorResult = result as Extract<typeof result, { ok: false }>;
      console.error(`[scenarios:preview] issue ${key} failed: ${errorResult.error} - ${errorResult.message}`);
      issueFailures.push({ sourceIssueKey: key, reason: `generation_failed: ${errorResult.error} - ${errorResult.message}` });
      continue;
    }
    perIssueResults.push(result as ScenarioPreviewResponse);
  }

  if (perIssueResults.length === 0) {
    return {
      ok: false,
      error: "scenario_generation_failed",
      message: `All ${issueKeys.length} issue(s) failed to generate scenarios. First error: ${issueFailures[0]?.reason ?? "unknown"}`,
    };
  }

  return mergeScenarioPreviewResults(perIssueResults, issueFailures);
}

/**
 * Merge per-issue ScenarioPreviewResponse objects into a single batch response.
 * App-level fields (appSlug, routeProfile, testrail, ...) are taken from the first
 * result since they're identical across issues of the same request; per-issue
 * arrays (scenarios, rejected, blockedScenarios, warnings) are concatenated and
 * the summary counters are summed.
 */
function mergeScenarioPreviewResults(
  results: ScenarioPreviewResponse[],
  extraRejected: McpRejectedScenario[] = [],
): ScenarioPreviewResponse {
  const first = results[0];
  const summary = results.reduce((acc, r) => {
    const s = r.summary as unknown as Record<string, number>;
    for (const key of Object.keys(s)) {
      acc[key] = (acc[key] ?? 0) + (s[key] ?? 0);
    }
    return acc;
  }, {} as Record<string, number>);
  summary.rejected = (summary.rejected ?? 0) + extraRejected.length;

  return {
    ...first,
    source: { ...first.source, issuesFound: results.length },
    scenarios: results.flatMap((r) => r.scenarios),
    summary: summary as unknown as ScenarioPreviewResponse["summary"],
    rejected: [...results.flatMap((r) => r.rejected), ...extraRejected],
    blockedScenarios: results.flatMap((r) => r.blockedScenarios ?? []),
    warnings: results.flatMap((r) => r.warnings),
    adaptiveScenarios: results.flatMap((r) => (r as unknown as { adaptiveScenarios?: unknown[] }).adaptiveScenarios ?? []),
  } as ScenarioPreviewResponse;
}

async function generateScenarioPreviewForIssue(
  req: ScenarioPreviewRequest,
): Promise<ScenarioPreviewResponse | ScenarioPreviewError> {
  if (!req.projectKey) {
    return { ok: false, error: "invalid_request", message: "projectKey is required" };
  }
  if (!req.activeSprint && !req.sprintId) {
    return { ok: false, error: "invalid_request", message: "activeSprint: true or sprintId is required" };
  }

  // Resolve effective appSlug using fallback chain (request → APP_SLUG env → hardcoded default)
  const effectiveAppSlug = resolveAppSlug(req.appSlug);

  // Ensure app.knowledge.json exists (create empty if not)
  loadOrCreateKnowledgeContext(effectiveAppSlug);

  // Pass the resolved appSlug to the app resolver for priority resolution
  const appInference = resolveAppForPreview({
    targetAppSlug: req.targetAppSlug,
    targetAppName: req.targetAppName,
    testrailSectionName: req.testrailSectionName,
    requestAppSlug: effectiveAppSlug,
  });

  console.log(
    `[app-resolution] requestAppSlug=${effectiveAppSlug} requestTargetAppSlug=${req.targetAppSlug ?? "none"} inferenceSource=${appInference.source} inferredAppSlug=${appInference.appSlug} effectiveTargetAppSlug=${appInference.appSlug}`,
  );
  console.log(
    `[scenarios:preview] projectKey=${req.projectKey} sprintId=${req.sprintId ?? "active"} status=${req.status ?? "any"} appSlug=${effectiveAppSlug} targetAppSlug=${appInference.appSlug} inferenceSource=${appInference.source}`,
  );
  console.log(
    `[scenarios:preview] targetAppSlug=${appInference.appSlug} targetAppName=${appInference.appName}`,
  );
  console.log(
    `[scenarios:preview] appInference=${JSON.stringify(appInference)}`,
  );

  // Ensure functional app profile exists
  let appProfileResult;
  try {
    appProfileResult = await ensureFunctionalAppProfile({
      appSlug: appInference.appSlug,
      appName: appInference.appName,
      source: appInference.source,
      sectionName: req.testrailSectionName,
    });
  } catch (err) {
    console.error(`[scenarios:preview] ensureFunctionalAppProfile failed: ${err}`);
    appProfileResult = {
      appSlug: appInference.appSlug,
      appName: appInference.appName,
      appDir: "",
      appConfigPath: "",
      created: false,
      configCreated: false,
    };
  }

  const jiraConfig = requireJiraConfig(config);
  const jira = new JiraClient(jiraConfig);

  let sprintId: number;
  let sprintName: string;

  if (req.activeSprint) {
    const active = await jira.getActiveSprint(req.projectKey);
    if (!active) {
      return {
        ok: false,
        error: "no_active_sprint",
        message: `No hay sprint activo para el proyecto ${req.projectKey}`,
      };
    }
    sprintId = active.id;
    sprintName = active.name;
  } else {
    sprintId = req.sprintId!;
    sprintName = `Sprint ${sprintId}`;
  }

  const issues = await loadJiraIssues(
    jiraConfig,
    req.projectKey,
    sprintId,
    req.status,
    req.maxResults ?? 50,
  );

  console.log(`[scenarios:preview] loaded ${issues.length} jira issues`);

  // Filter by selectedIssueKeys if provided (from QA Lab UI selection)
  if (req.selectedIssueKeys && req.selectedIssueKeys.length > 0) {
    const selectedKeys = new Set(req.selectedIssueKeys);
    const filtered = issues.filter((i) => selectedKeys.has(i.key));
    console.log(`[scenario-preview] jira selectedIssueKeys=${JSON.stringify(req.selectedIssueKeys)} filtered=${filtered.length}/${issues.length}`);
    if (filtered.length === 0) {
      return { ok: false, error: "jira_issues_not_selected", message: "Ninguna de las historias seleccionadas coincide con los filtros aplicados." };
    }
    issues.length = 0;
    issues.push(...filtered);
  } else {
    console.log(`[scenario-preview] jira selectedIssueKeys=none`);
  }

  console.log(`[jira] selected issues count=${issues.length} keys=${JSON.stringify(issues.map((i) => i.key))}`);
  // Detect primary HU intent for guard logic
  const primaryIssueIntent: HuIntentDetection = issues.length > 0
    ? detectHuIntent(
        { summary: issues[0].summary, description: issues[0].description, acceptanceCriteria: issues[0].acceptanceCriteria },
        issues[0].key
      )
    : { intent: "unknown_flow", confidence: "low", reason: "no_issue", matchedSignals: [] };
  if (issues.length > 0) {
    console.log(`[scenario-preview] primaryHuIntent issue=${issues[0].key} intent=${primaryIssueIntent.intent}`);
  }
  // Derive effective intent from HU text analysis — this overrides the
  // classifier for catalog/private decisions. Multiproject-safe.
  let effectiveIntent = primaryIssueIntent.intent;
  let canonicalIntentResolution: CanonicalHuIntentResolution = resolveCanonicalHuIntent(primaryIssueIntent, "generic");
  if (issues.length > 0) {
    const huTextEarly = [issues[0].summary, issues[0].description, issues[0].acceptanceCriteria || ""].filter(Boolean).join(" ");
    const earlyModel = extractHuScenarioModel(huTextEarly);
    if (earlyModel?.mainIntent && earlyModel.mainIntent !== "generic") {
      effectiveIntent = earlyModel.mainIntent;
      canonicalIntentResolution = resolveCanonicalHuIntent(primaryIssueIntent, effectiveIntent);
    }
  }
  console.log(`[scenario-preview] effectiveIntent=${effectiveIntent} primaryIssueIntent=${primaryIssueIntent.intent}`);


  const maxIssues = Number(process.env.SCENARIO_PREVIEW_MAX_ISSUES) || 5;
  if (issues.length > maxIssues) {
    console.log(`[scenarios:preview] limiting issues from ${issues.length} to ${maxIssues}`);
    issues.length = maxIssues;
  }

  // Gather jira context for routeProfile seeding
  const jiraSummary = issues.length > 0 ? issues[0].summary : undefined;
  const jiraDescription = issues.length > 0 ? issues[0].description : undefined;

  // Build initial routeProfile (before AI generation)
  const { routeProfile: initialRouteProfile, source: rpSource, entrySteps: initialEntrySteps, loginMode } = buildRouteProfileForPrompt(
    appInference.appSlug,
    undefined,
    jiraSummary,
    jiraDescription,
    req.testrailSectionName,
  );

  console.log(`[scenarios:preview] routeProfile source=${rpSource}`);
  console.log(`[scenarios:preview] routeProfileName=${initialRouteProfile?.name ?? "null"}`);
  console.log(`[scenarios:preview] routeProfileEntry=${JSON.stringify(initialRouteProfile?.entry ?? [])}`);

  // Ensure catalog context for scenario generation (enrichment phase)
  const shouldSkipCatalogContext = !canonicalIntentResolution.catalogRelevant && !canonicalIntentResolution.productDetailRelevant;
  let enrichedRouteProfile, catalogDiagnostics;
  let catalogOptions;

  if (!shouldSkipCatalogContext) {
    const { ensureScenarioGenerationContext } = await import("./scenario-catalog-context");
    catalogOptions = req.catalogOptions ?? {
      useDiscoveredCatalog: process.env.AI_CATALOG_AUTO_DISCOVER === "true",
      catalogMode: process.env.AI_CATALOG_MODE === "refresh" ? "refresh" : "existing",
      coverageMode: process.env.AI_CATALOG_COVERAGE_MODE as "representative" | "exhaustive" || "representative",
      maxProductsPerCategory: parseInt(process.env.AI_CATALOG_MAX_PER_CATEGORY || "2", 10),
    };
    // Preview generation may consume static route hints and persisted Knowledge,
    // but live catalog discovery belongs to the explicit discovery workflow.
    const previewCatalogOptions = {
      ...catalogOptions,
      useDiscoveredCatalog: false,
    };
    const result = await ensureScenarioGenerationContext(
      appInference.appSlug,
      initialRouteProfile,
      previewCatalogOptions,
      (loginMode || "no_login") as LoginMode,
      config
    );
    enrichedRouteProfile = result.routeProfile;
    catalogDiagnostics = result.diagnostics;
  } else {
    console.log(`[catalog-context] skipped reason=preview_non_catalog_intent huIntent=${primaryIssueIntent.intent}`);
    catalogOptions = {
      useDiscoveredCatalog: false,
      catalogMode: "existing",
      coverageMode: "representative",
      maxProductsPerCategory: 2,
    };
  }

  // Use enriched routeProfile for scenario generation
  const routeProfileForGeneration = enrichedRouteProfile ?? initialRouteProfile;

  if (issues.length === 0) {
    return {
      ok: true,
      source: {
        mode: req.sourceMode ?? "jira",
        projectKey: req.projectKey,
        sprintId,
        status: req.status ?? null,
        issuesFound: 0,
      },
      testrail: {
        projectId: req.testrailProjectId ?? null,
        suiteId: req.testrailSuiteId ?? null,
        sectionId: req.testrailSectionId ?? null,
        sectionName: req.testrailSectionName ?? null,
      },
      appSlug: effectiveAppSlug,
      targetAppSlug: appInference.appSlug,
      targetAppName: appInference.appName,
      appInference,
      appProfilePath: appProfileResult.appConfigPath,
      summary: { generated: 0, valid: 0, invalid: 0, rejected: 0, blocked: 0, routePending: 0, automationReady: 0 },
      routeProfile: initialRouteProfile,
      scenarios: [],
      rejected: [],
      blockedScenarios: [],
      warnings: [`No Jira issues found for project ${req.projectKey}, sprint ${sprintName}`],
    };
  }

  const testrailMeta =
    req.testrailProjectId && req.testrailSuiteId
      ? {
          projectId: req.testrailProjectId,
          suiteId: req.testrailSuiteId,
          sectionId: req.testrailSectionId,
          sectionName: req.testrailSectionName,
        }
      : undefined;

  let generationResult;
  let huModel: any = null;
  let scenarioPlan: any = null;
  let huTextForAi = "";
  let huExplicitRoutePathForAi: string[] = [];
  let functionalBranchesForAi: FunctionalBranchRef[] = [];
  let automatableOptionFlowsForCoverage: OptionFlow[] = [];

  // Pre-compute HU model and scenario plan for AI prompt context
  if (issues.length > 0) {
    const optionFlowDetection = detectOptionFlows(issues[0]);
    automatableOptionFlowsForCoverage = optionFlowDetection.flows.filter(
      (flow) => flow.optionLabel?.trim() && flow.expectedResult?.trim(),
    );
    huTextForAi = [issues[0].summary, issues[0].description, issues[0].acceptanceCriteria || ""].filter(Boolean).join(" ");
    if (huTextForAi) {
      huModel = extractHuScenarioModel(huTextForAi);
      scenarioPlan = buildRoutePendingScenarioPlan(huModel);
      huExplicitRoutePathForAi = extractExplicitRoutePath(huTextForAi);
      functionalBranchesForAi = extractFunctionalBranchesFromHu(
        huTextForAi,
        huModel?.visibleOptions ?? [],
        huExplicitRoutePathForAi,
        automatableOptionFlowsForCoverage,
      );
      console.log(`[scenario-preview] aiPrompt huModel=enabled huPlan=enabled`);
      console.log(`[scenario-preview] aiPrompt plan complexity=${scenarioPlan.complexity} target=${scenarioPlan.scenarioCountTarget} variants=${scenarioPlan.variants.length}`);
      console.log(
        `[scenarios:functional-branches] preAi extracted=${functionalBranchesForAi.length} ids=${functionalBranchesForAi.map((branch) => branch.branchId).join(",") || "none"}`,
      );
    }
  }

  try {
    generationResult = await generateScenariosWithAi(
      issues,
      effectiveAppSlug,
      testrailMeta,
      appInference.appSlug,
      appInference.appName,
      routeProfileForGeneration,
      initialEntrySteps,
      loginMode,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      huModel,
      scenarioPlan,
      functionalBranchesForAi,
      { launchId: req.launchId },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scenarios:preview] failed error=${message}`);

    const [code, ...rest] = message.split("|");
    const detail = rest.join("|") || message;

    const errorMap: Record<string, { error: string; status: number }> = {
      AI_PROVIDER_UNAVAILABLE: { error: "ai_provider_unavailable", status: 503 },
      AI_GENERATION_TIMEOUT: { error: "ai_generation_timeout", status: 504 },
      AI_GENERATION_FAILED: { error: "ai_generation_failed", status: 502 },
      EMPTY_AI_RESPONSE: { error: "empty_ai_response", status: 502 },
      INVALID_AI_RESPONSE: { error: "invalid_ai_response", status: 502 },
      SKILL_NOT_FOUND: { error: "skill_not_found", status: 500 },
      AI_RETURNED_CSV: { error: "ai_returned_csv_instead_of_json", status: 502 },
    };

    const mapped = errorMap[code] || { error: "scenario_generation_failed", status: 502 };

    return {
      ok: false,
      error: mapped.error,
      message: detail,
    } as ScenarioPreviewError;
  }

  // Normalize scenarios to targetAppSlug
  let rawScenarios = generationResult.scenarios ?? [];
  if (appInference.appSlug && appInference.appSlug !== effectiveAppSlug) {
    rawScenarios = normalizeScenariosToTargetApp(rawScenarios, appInference.appSlug);
  }

  // Post-Codex: re-detect routeProfile from generated scenario titles
  // This catches cases where Jira summary didn't contain the module name but scenarios do
  const scenarioTitles = rawScenarios.map((s) => s.title);
  const postCodexDetection = detectKioskoInfoProductos({
    targetAppSlug: appInference.appSlug,
    jiraSummary,
    jiraDescription,
    testrailSectionName: req.testrailSectionName,
    scenarioTitles,
  });

  let resolvedRouteProfile = initialRouteProfile;
  if (postCodexDetection && (!initialRouteProfile || !initialRouteProfile.name)) {
    console.log(`[scenarios:preview] post-codex detection: KIOSKO/InfoProductos detected from scenario titles`);
    resolvedRouteProfile = {
      ...(seedKioskoInfoProductosRouteProfile() as unknown as McpRouteProfile),
      fieldProvenance: {
        entry: "declared_hint",
        aliases: "declared_hint",
        intermediates: "declared_hint",
        domainTerms: "declared_hint",
        visibleControls: "declared_hint",
        entrySteps: "declared_hint",
        targetPaths: "declared_hint",
      },
    };
  }

  // Log entry steps — prefer new format, fallback to old
  const oldEntrySteps = buildEntrySteps(resolvedRouteProfile as unknown as Record<string, unknown>);
  const configRp = resolvedRouteProfile ? (resolvedRouteProfile as Record<string, unknown>).entrySteps : undefined;
  const newEntrySteps = Array.isArray(configRp) && configRp.length > 0 ? configRp as EntryStepConfig[] : [];
  console.log(`[scenarios:preview] oldEntrySteps=${JSON.stringify(oldEntrySteps)} newEntrySteps=${JSON.stringify(newEntrySteps)}`);

  // Route-profile seeds are discovery hints, not authority for exact UI steps.
  // Do not delete unsupported claims here. Final provenance validation must be
  // able to reject the whole scenario without leaving a mutilated flow.

  // Log before normalize
  for (const sc of rawScenarios) {
    const firstSteps = (sc.steps ?? []).slice(0, 3);
    console.log(
      `[scenarios:preview] beforeNormalize scenarioTitle="${sc.title}" firstSteps=${JSON.stringify(firstSteps)}`,
    );
  }

  // Insert entry steps if routeProfile has entry — prefer new format
  // Skip catalog entry insertion for non-catalog intents to avoid contaminating
  // balance_inquiry / document_generation / payment_transfer / private scenarios
  // with steps like "Información de productos" from a catalog routeProfile.
  const isNonCatalogForInsertion = !canonicalIntentResolution.catalogRelevant && !canonicalIntentResolution.productDetailRelevant;
  if ((newEntrySteps.length > 0 || oldEntrySteps.length > 0) && !isNonCatalogForInsertion) {
    const entryFieldAuthority = resolvedRouteProfile?.fieldProvenance?.entry;
    const routeEntryAuthority = ["explicit_trusted_config", "validated_knowledge", "trusted_route"].includes(entryFieldAuthority ?? "unknown");
    rawScenarios = rawScenarios.map((sc) => {
      const branchAccess = sc.functionalBranch?.accessIntent;
      if (branchAccess === "authenticated") return sc;
      if (!routeEntryAuthority) return sc;
      if (!isEntryStepInsertionAuthorized(sc, functionalBranches)) {
        console.log(`[entry-steps] resolved=${newEntrySteps.length || oldEntrySteps.length} authorized=0 inserted=0 reason=canonical_authority_missing scenarioId=${scenarioIdentity(sc)}`);
        return sc;
      }
      const repaired = insertEntrySteps(sc, oldEntrySteps, newEntrySteps);
      if (repaired !== sc) {
        if (!generationResult.warnings) generationResult.warnings = [];
        const labels = newEntrySteps.length > 0
          ? newEntrySteps.filter((es) => es.action === "click").map((es) => es.target).join(" → ")
          : oldEntrySteps.join(" → ");
        generationResult.warnings.push(
          `Scenario "${sc.title}": entry_steps_inserted - Added missing entry steps: ${labels}`,
        );
      }
      return repaired;
    });
  } else if (isNonCatalogForInsertion && (newEntrySteps.length > 0 || oldEntrySteps.length > 0)) {
    const skippedLabels = newEntrySteps.length > 0
      ? newEntrySteps.filter((es: EntryStepConfig) => es.action === "click").map((es: EntryStepConfig) => es.target).join(" → ")
      : oldEntrySteps.join(" → ");
    console.log(`[scenarios:preview] insertEntryStepsSkipped=true reason=non_catalog_intent effectiveIntent=${effectiveIntent} requiredEntrySource=skipped_catalog_routeProfile_entry skippedLabels="${skippedLabels}"`);
  }

  // Log after normalize
  for (const sc of rawScenarios) {
    const firstSteps = (sc.steps ?? []).slice(0, 3);
    console.log(
      `[scenarios:preview] afterNormalize scenarioTitle="${sc.title}" firstSteps=${JSON.stringify(firstSteps)}`,
    );
  }

  // Declare rejected and routeResolutions early
  const rejected: McpRejectedScenario[] = generationResult.rejected ?? [];
  const warnings: string[] = generationResult.warnings ?? [];
  const routeResolutions = generationResult.routeResolutions;

  // Repair missing intermediate steps
  if (resolvedRouteProfile) {
    const derivedContext = buildDerivedExecutionContext(
      appInference.appSlug,
      resolvedRouteProfile,
      routeResolutions ?? new Map(),
      newEntrySteps.length > 0
        ? newEntrySteps.filter((es) => es.action === "click").map((es) => es.target)
        : oldEntrySteps
    );
    const branchRequiredClicks = collectBranchRequiredClicks(functionalBranchesForAi);
    const generationEffectiveAllowedClicks = generationResult.generationDiagnostics?.effectiveAllowedClicks ?? [];
    const mergedClickAuthority = mergeEffectiveAllowedClicks(
      derivedContext.allowedExecutableClicks,
      branchRequiredClicks,
      generationEffectiveAllowedClicks,
    );
    const derivedContextForRepair = {
      ...derivedContext,
      allowedExecutableClicks: mergedClickAuthority.effectiveAllowedClicks,
    };
    const effectiveAllowedClicksBeforeRepair =
      generationResult.generationDiagnostics?.effectiveAllowedClicksBeforeRepair
      ?? generationEffectiveAllowedClicks.length
      ?? mergedClickAuthority.effectiveAllowedClicks.length;
    console.log(
      `[scenarios:preview] intermediate-repair clickAuthority branchRequiredClicks=${branchRequiredClicks.length} ` +
      `effectiveAllowedClicksBeforeRepair=${effectiveAllowedClicksBeforeRepair} ` +
      `effectiveAllowedClicksAtIntermediateRepair=${derivedContextForRepair.allowedExecutableClicks.length}`,
    );

    console.log(
      `[scenarios:preview] intermediate-repair starting appSlug=${appInference.appSlug} ` +
        `scenariosCount=${rawScenarios.length} ` +
        `allowedClicks=${derivedContextForRepair.allowedExecutableClicks.length}`
    );

    rawScenarios = rawScenarios.map((sc) => {
      const resolution = routeResolutions?.get(sc.sourceIssueKey);
      const repairResult = repairMissingIntermediates(
        sc,
        resolvedRouteProfile,
        derivedContextForRepair,
        resolution,
        "medium" // Confidence threshold
      );

      logIntermediateRepair(sc.sourceIssueKey, sc.title, repairResult, appInference.appSlug);

      if (repairResult.repaired) {
        if (!generationResult.warnings) generationResult.warnings = [];
        generationResult.warnings.push(
          `Scenario "${sc.title}": intermediate_steps_inserted - Added ${repairResult.insertedCount} intermediate step(s)`
        );
          return {
            ...sc,
            steps: repairResult.repairedSteps,
            ...(repairResult.stepOrigins ? {
              stepRequirementRefs: sc.stepRequirementRefs?.flatMap((ref) => {
                const stepIndex = repairResult.stepOrigins!.findIndex((origin) => origin === ref.stepIndex);
                return stepIndex >= 0 ? [{ ...ref, stepIndex }] : [];
              }),
              stepClaims: remapStepClaimsByOrigins(sc.stepClaims, repairResult.stepOrigins),
            } : {}),
          };
      } else if (repairResult.reasonCode !== "no_repair_needed") {
        const errorDiag = repairResult.diagnostics.find((d) => d.level === "error");
        if (errorDiag) {
          const preservedScenario = preserveScenarioOnIntermediateRepairFailure(sc, repairResult);
          warnings.push(
            `Scenario "${sc.title}": route_evidence_insufficient - ${repairResult.reasonCode}: ${errorDiag.message}`,
          );
          console.log(
            `[intermediate-repair] scenario="${sc.title}" decision=preserved_for_branch_recovery reasonCode=${repairResult.reasonCode}`,
          );
          return preservedScenario;
        }
      }

      return sc;
    });

    console.log(
      `[scenarios:preview] intermediate-repair complete ` +
        `remainingScenarios=${rawScenarios.length} ` +
        `rejected=${rejected.length}`
    );
  }

  // -- Quick catalog intent check --
  const isCatalogIntent = canonicalIntentResolution.catalogRelevant || canonicalIntentResolution.productDetailRelevant;

  // Generate deterministic seeds for coverage guarantee
  if (catalogOptions.useDiscoveredCatalog && routeProfileForGeneration && isCatalogIntent) {
    const { generateDeterministicSeeds } = await import("./scenario-deterministic-seeds");

    // Use first issue as context for HU scope filtering
    // Seeds will only be generated for products aligned with HU scope
    const issueContext = issues.length > 0 ? issues[0] : null;

    // Load appConfig to get valid automationType and setupStrategy for seeds
    const appConfig = loadAppConfigSync(appInference.appSlug);
    const seedAppConfig = {
      automationType: (appConfig?.automationType as string) || "ui_discovery",
      setupStrategy: (appConfig?.setupStrategy as string) || "no_login",
    };

    const seeds = generateDeterministicSeeds(
      routeProfileForGeneration,
      rawScenarios,
      issueContext,
      appInference.appSlug,
      catalogOptions.coverageMode ?? "representative",
      seedAppConfig
    );

    if (seeds.length > 0) {
      console.log(
        `[scenarios:preview] adding ${seeds.length} deterministic seeds for coverage guarantee ` +
          `(mode=${catalogOptions.coverageMode ?? "representative"})`
      );
      rawScenarios.push(...seeds);
    } else {
      console.log(
        `[scenarios:preview] no seeds needed - AI coverage complete for aligned categories/products ` +
          `(mode=${catalogOptions.coverageMode ?? "representative"})`
      );
    }
  }

  // Build blockedScenarios from routeResolutions
  const blockedScenarios: import("./scenario-types").BlockedScenario[] = [];

  if (routeResolutions) {
    for (const [issueKey, resolution] of routeResolutions.entries()) {
      if (!resolution.canGenerate) {
        const issue = issues.find(i => i.key === issueKey);
        const errorDiagnostic = resolution.diagnostics.find(d => d.level === "error");
        const reasonCode = (errorDiagnostic?.code ?? "unknown") as import("./scenario-types").DiagnosticCode;

        let suggestedAction = "review_route_profile";
        if (reasonCode === "needs_route_profile") {
          suggestedAction = "configure_route_profile";
        } else if (reasonCode === "missing_parent_route") {
          suggestedAction = "add_parent_route";
        } else if (reasonCode === "missing_intermediate_step") {
          suggestedAction = "add_intermediate_steps";
        }

        blockedScenarios.push({
          sourceIssueKey: issueKey,
          title: issue?.summary ?? `Issue ${issueKey}`,
          status: "blocked",
          reasonCode,
          reason: resolution.missingRouteReason ?? "Route not backed",
          diagnostics: resolution.diagnostics,
          appSlug: appInference.appSlug,
          appProfilePath: appProfileResult.appConfigPath,
          suggestedAction
    });
  } else if (isNonCatalogForInsertion && (newEntrySteps.length > 0 || oldEntrySteps.length > 0)) {
    const skippedLabels = newEntrySteps.length > 0
      ? newEntrySteps.filter((es: EntryStepConfig) => es.action === "click").map((es: EntryStepConfig) => es.target).join(" → ")
      : oldEntrySteps.join(" → ");
    console.log(`[scenarios:preview] insertEntryStepsSkipped=true reason=non_catalog_intent effectiveIntent=${effectiveIntent} requiredEntrySource=skipped_catalog_routeProfile_entry skippedLabels="${skippedLabels}"`);
  }
    }
  }

  console.log(`[scenarios:preview] blockedScenarios=${blockedScenarios.length} from routeResolutions`);

  // Fallback: build blockedScenarios from rejected if routeResolutions didn't provide them
  const blockedFromRejected = new Set(blockedScenarios.map(b => b.sourceIssueKey));
  let fallbackCount = 0;

  for (const rej of rejected) {
    // Skip if already in blockedScenarios
    if (blockedFromRejected.has(rej.sourceIssueKey)) continue;

    // Detect route-first reasons
    const reasonLower = rej.reason.toLowerCase();
    let reasonCode: import("./scenario-types").DiagnosticCode | null = null;

    if (reasonLower.includes("needs_route_profile")) {
      reasonCode = "needs_route_profile";
    } else if (reasonLower.includes("missing_parent_route")) {
      reasonCode = "missing_parent_route";
    } else if (reasonLower.includes("missing_intermediate_step")) {
      reasonCode = "missing_intermediate_step";
    } else if (reasonLower.includes("missing_detail_selection_step")) {
      reasonCode = "missing_detail_selection_step";
    } else if (reasonLower.includes("ambiguous_route_target")) {
      reasonCode = "ambiguous_route_target";
    } else if (reasonLower.includes("unsupported_route_target")) {
      reasonCode = "unsupported_route_target";
    }

    // If route-first reason detected, create BlockedScenario
    if (reasonCode) {
      const issue = issues.find(i => i.key === rej.sourceIssueKey);
      const isError = reasonCode === "needs_route_profile" || reasonCode === "missing_parent_route";

      let suggestedAction = "review_route_profile";
      if (reasonCode === "needs_route_profile") {
        suggestedAction = "configure_route_profile";
      } else if (reasonCode === "missing_parent_route") {
        suggestedAction = "add_parent_route";
      } else if (reasonCode === "missing_intermediate_step") {
        suggestedAction = "add_intermediate_steps";
      }

      blockedScenarios.push({
        sourceIssueKey: rej.sourceIssueKey,
        title: issue?.summary ?? `Issue ${rej.sourceIssueKey}`,
        status: "blocked",
        reasonCode,
        reason: rej.reason,
        diagnostics: [
          {
            level: isError ? "error" : "warning",
            code: reasonCode,
            message: rej.reason.replace(`${reasonCode}: `, ""),
            context: { source: "rejected_fallback" }
          }
        ],
        appSlug: appInference.appSlug,
        appProfilePath: appProfileResult.appConfigPath,
        suggestedAction
      });

      fallbackCount++;
      console.log(`[blocked-scenarios] added sourceIssueKey=${rej.sourceIssueKey} reasonCode=${reasonCode} source=rejected_fallback`);
    }
  }

  console.log(`[blocked-scenarios] fromRouteResolutions=${blockedScenarios.length - fallbackCount} fromRejectedFallback=${fallbackCount} total=${blockedScenarios.length}`);

  // Check route mismatch for catalog-seeds guard after blockedScenarios is available
  const hasRouteMismatchForSeeds = blockedScenarios.some(b => b.reasonCode === "route_profile_intent_mismatch" || b.reason === "route_profile_intent_mismatch");
  if (!isCatalogIntent || hasRouteMismatchForSeeds) {
    console.log(`[catalog-seeds] skipped reason=intent_mismatch_or_non_catalog_intent huIntent=${primaryIssueIntent.intent}`);
  }

  const validated: ValidatedScenario[] = [];
  let validCount = 0;
  let invalidCount = 0;

  // Detect primary HU intent for guard logic
    console.log(`[scenario-preview] discovery disabled reason=preview_uses_hu_ai_and_knowledge_context`);
  console.log(`[scenario-preview] routePendingBuilder architecture=hu_generates_scenarios_knowledge_completes_route`);

  // Load knowledge context for historical hints (not for discovery)
  const huTextForContext = huTextForAi || (issues.length > 0 ? [issues[0].summary, issues[0].description, issues[0].acceptanceCriteria || ""].filter(Boolean).join(" ") : "");

  // Diagnostic: extract rich HU model (used for intent refinement before resolver)
  huModel = huTextForContext ? extractHuScenarioModel(huTextForContext) : null;
  const huExplicitRoutePath: string[] = huExplicitRoutePathForAi.length > 0
    ? huExplicitRoutePathForAi
    : (huTextForContext ? extractExplicitRoutePath(huTextForContext) : []);
  if (huModel) {
    console.log(`[scenario-preview] huModel intent=${huModel.mainIntent} subIntent=${huModel.subIntent} uiObligations=${huModel.uiObligations.length} nonUiRequirements=${huModel.nonUiRequirements.length}`);
    console.log(`[scenario-preview] huModel screens=${huModel.requiredScreens.length} fields=${huModel.requiredFields.length} selectable=${huModel.selectableEntities.length} buttons=${huModel.visibleButtons.length} warnings=${huModel.visibleWarnings.length} delivery=${huModel.deliverySignals}`);
    scenarioPlan = buildRoutePendingScenarioPlan(huModel);
    console.log(`[scenario-preview] huPlan complexity=${scenarioPlan.complexity} target=${scenarioPlan.scenarioCountTarget} variants=${scenarioPlan.variants.join(",")}`);
    console.log(`[scenario-preview] huPlan requirements data=${scenarioPlan.dataRequirements.length} excludedNonUi=${scenarioPlan.excludedNonUiRequirements.length}`);
  }
  // Store explicit route path on huModel for downstream use
  if (huExplicitRoutePath.length > 0 && huModel) {
    (huModel as any).explicitRoutePath = huExplicitRoutePath;
    console.log(`[hu-route] explicitRoutePath issue=${issues[0]?.key ?? "unknown"} path="${huExplicitRoutePath.join(" > ")}"`);
  }

  // Pass refined intent to knowledge context resolver (prefer huModel over primaryIssueIntent)
  const resolverIntent = huModel?.mainIntent && huModel.mainIntent !== "generic"
    ? huModel.mainIntent
    : primaryIssueIntent.intent;
  console.log(`[scenario-preview] resolverIntent=${resolverIntent} source=${huModel?.mainIntent !== "generic" && huModel?.mainIntent ? "huModel" : "primaryIssueIntent"} subIntent=${huModel?.subIntent ?? "none"} routePath="${huExplicitRoutePath.join(" > ")}"`);
  const knowledgeCtx = buildKnowledgeContextForScenarioGeneration(appInference.appSlug, huTextForContext, resolverIntent, huModel?.subIntent, huExplicitRoutePath);
  const functionalBranches = functionalBranchesForAi.length > 0
    ? functionalBranchesForAi
    : extractFunctionalBranchesFromHu(
      huTextForContext,
      huModel?.visibleOptions ?? [],
      huExplicitRoutePath,
      automatableOptionFlowsForCoverage,
    );
  canonicalIntentResolution = resolveCanonicalHuIntent(
    primaryIssueIntent,
    effectiveIntent,
    functionalBranches,
  );
  console.log(
    `[scenario-preview] canonicalIntent primary=${canonicalIntentResolution.primaryClassifierIntent} derived=${canonicalIntentResolution.derivedModelIntent} ` +
    `catalog=${canonicalIntentResolution.catalogRelevant} private=${canonicalIntentResolution.privateNavigationRelevant} ` +
    `detail=${canonicalIntentResolution.productDetailRelevant} transactional=${canonicalIntentResolution.transactionalRelevant} ` +
    `branches=${Object.keys(canonicalIntentResolution.branchIntents).length}`,
  );
  const hasBranchExtractionMismatch =
    automatableOptionFlowsForCoverage.length > 0 && functionalBranches.length === 0;
  if (hasBranchExtractionMismatch) {
    console.log(
      `[scenarios:functional-branches] reason=branch_extraction_mismatch optionFlows=${automatableOptionFlowsForCoverage.length} extracted=0`,
    );
    warnings.push("Functional branch extraction mismatch: option flows detected but no branches were generated.");
  }
  console.log(
    `[scenarios:functional-branches] extracted=${functionalBranches.length} ids=${functionalBranches.map((branch) => branch.branchId).join(",") || "none"}`,
  );
  const coverageRequirementsAvailable = ensureCoverageRequirementsAvailable(functionalBranches);

  // -- Check if route profile mismatch generate routePending fallback scenarios --
  const hasRouteMismatch = blockedScenarios.some(b => b.reasonCode === "route_profile_intent_mismatch" || b.reason === "route_profile_intent_mismatch" || b.suggestedAction === "run_transactional_route_discovery");
  const aiRejectedAllByQuality =
    generationResult?.generationDiagnostics?.aiCalled === true &&
    (generationResult?.generationDiagnostics?.finalValid ?? 0) === 0 &&
    (generationResult?.generationDiagnostics?.finalRejected ?? 0) > 0 &&
    issues.length > 0;
  let shouldFallback = validCount === 0 && rawScenarios.length === 0 && hasRouteMismatchForSeeds;
  let fallbackReason: string | undefined;
  if (aiRejectedAllByQuality && !shouldFallback) {
    shouldFallback = true;
    fallbackReason = "ai_rejected_all_by_quality";
  } else if (shouldFallback && hasRouteMismatchForSeeds) {
    fallbackReason = "route_profile_intent_mismatch";
  }
  console.log(`[scenario-preview] routePendingBuilder fallbackDecision hasRouteMismatch=${hasRouteMismatchForSeeds} aiRejectedAllByQuality=${aiRejectedAllByQuality} rawScenarios=${rawScenarios.length} valid=${validCount} shouldGenerate=${shouldFallback} issues=${issues.length}`);
  if (fallbackReason) {
    console.log(`[scenario-preview] routePendingBuilder fallbackReason=${fallbackReason}`);
  }
  let routePendingCount = 0;

  // Build prefix from knowledge context if available
  let candidatePrefixSteps;
  if (knowledgeCtx.available && knowledgeCtx.navigationHints.length > 0) {
    candidatePrefixSteps = knowledgeCtx.navigationHints[0].clickTargets;
    console.log(`[scenario-preview] routePendingBuilder prefixApplied source=app.knowledge steps=${knowledgeCtx.navigationHints[0].clickTargets.length} authStep=${knowledgeCtx.navigationHints[0].authTerms.length > 0}`);
  }

  if (shouldFallback && issues.length > 0) {
    const fallbackScenarios = generateRoutePendingScenarios(
      issues[0], resolverIntent, fallbackReason ?? "route_profile_intent_mismatch",
      candidatePrefixSteps ? "knowledge_prefix_pending" : "missing_initial_route",
      appInference.appSlug, candidatePrefixSteps,
      huModel, scenarioPlan,
      huExplicitRoutePath,
    );
    for (const fb of fallbackScenarios) {
      validated.push({ ...fb, validation: { valid: true, errors: [] } });
      routePendingCount++;
    }
    console.log(`[scenario-preview] routePendingBuilder fallbackScenarios=${fallbackScenarios.length}`);
    console.log(`[scenario-preview] routePendingBuilder attached=${fallbackScenarios.length} finalVisible=${validated.length}`);
  }

console.log(`[scenarios:preview] beforeValidation rawScenarios=${rawScenarios.length}`);

  // Normalize encoding before validation to fix mojibake
  const { detectMojibake } = await import("./target-normalization");
  const encodingNormalizedScenarios = rawScenarios.map((sc) => {
    const normalizedSteps = sc.steps?.map((step) => {
      const fixed = detectMojibake(step);
      return fixed.hasMojibake ? fixed.corrected : step;
    }) ?? [];

    const fixedTitle = detectMojibake(sc.title);

    return {
      ...sc,
      steps: normalizedSteps,
      title: fixedTitle.hasMojibake ? fixedTitle.corrected : sc.title,
    };
  });

  console.log(`[scenarios:preview] encodingNormalized=${encodingNormalizedScenarios.length}`);

  // Apply automatability filter BEFORE validation
  // Only UI-automatable scenarios can proceed to preview
  const { filterScenariosByAutomatability } = await import("./scenario-automatability-classifier");

  // Use first issue as HU context for classification
  const huContextForClassification = issues.length > 0 ? issues[0] : undefined;

  let { automatable: automatableScenarios, excluded: excludedRequirements } =
    filterScenariosByAutomatability(encodingNormalizedScenarios, huContextForClassification);
  automatableScenarios = assignFunctionalBranchesToScenarios(automatableScenarios, functionalBranches);
  for (const scenario of automatableScenarios) {
    const association = scenario.branchAssociation;
    const branchId = association?.branchId ?? scenario.functionalBranch?.branchId ?? "none";
    const sourceIssueKey = scenario.sourceIssueKey ?? "unknown";
    const associationMethod = association?.associationMethod ?? "none";
    const expectedActionIdentity = association?.expectedActionIdentity ?? "";
    const actualActionIdentity = association?.actualActionIdentity ?? "";
    const associationMatched = association?.associationMatched === true;
    const actionMatched = association?.actionMatched === true;
    const destinationMatched = association?.destinationMatched === true;
    const destinationEvidenceKind = association?.destinationEvidenceKind ?? "none";
    const destinationEvidenceSource = association?.destinationEvidenceSource ?? "none";
    const reasonCode = association?.reasonCode ?? "none";
    console.log(
      `[scenarios:branch-association] scenarioId=${scenarioIdentity(scenario)} sourceIssueKey=${sourceIssueKey} branchId=${branchId} ` +
      `associationMethod=${associationMethod} expectedActionIdentity="${expectedActionIdentity}" actualActionIdentity="${actualActionIdentity}" ` +
      `associationMatched=${associationMatched} actionMatched=${actionMatched} destinationMatched=${destinationMatched} ` +
      `destinationEvidenceKind=${destinationEvidenceKind} destinationEvidenceSource=${destinationEvidenceSource} reasonCode=${reasonCode}`,
    );
  }

  const branchScenarioBackups = new Map<string, McpScenario>();
  for (const scenario of automatableScenarios) {
    const branchId = scenario.functionalBranch?.branchId;
    if (!branchId || branchScenarioBackups.has(branchId)) continue;
    branchScenarioBackups.set(branchId, {
      ...scenario,
      steps: [...(scenario.steps ?? [])],
      preconditions: [...(scenario.preconditions ?? [])],
      functionalBranch: scenario.functionalBranch ? { ...scenario.functionalBranch } : undefined,
    });
  }

  console.log(
    `[scenarios:automatability] total=${encodingNormalizedScenarios.length} ` +
      `automatable=${automatableScenarios.length} excluded=${excludedRequirements.length}`
  );

  // Update catalogDiagnostics with excluded requirements
  if (catalogDiagnostics) {
    catalogDiagnostics.excludedRequirements = excludedRequirements;
    catalogDiagnostics.nonAutomatableRequirementCount = excludedRequirements.length;
    catalogDiagnostics.uiAutomatableRequirementCount = automatableScenarios.length;
  }

  // ── AI route-prefix repair per functional branch ──
  const isPrivateOrBalanceIntent = !canonicalIntentResolution.catalogRelevant &&
    !canonicalIntentResolution.productDetailRelevant;

  const routeProfileFlavor = detectRouteProfileIsCatalog(resolvedRouteProfile, knowledgeCtx.available ? undefined : undefined);
  const routeProfileIsCatalog = routeProfileFlavor.isCatalog;
  console.log(`[scenario-preview] routeProfile compatibility=${routeProfileIsCatalog ? "compatible" : "incompatible"} effectiveIntent=${effectiveIntent} classifierIntent=${primaryIssueIntent.intent} reason=${routeProfileFlavor.reason} confidence=${routeProfileFlavor.confidence}`);
  if (isPrivateOrBalanceIntent && routeProfileIsCatalog) {
    console.log(`[scenario-preview] ignoredRequiredEntryStep reason=private_intent_catalog_profile compatibility=${routeProfileFlavor.confidence} signals="${routeProfileFlavor.reason}"`);
  }

  const normLabel = (value: string) => normalizeBranchText(value);
  const routeCandidates = buildBranchRouteCandidates(knowledgeCtx, huExplicitRoutePath);
  console.log(`[scenarios:branch-route] candidates=${routeCandidates.length}`);

  if (routeCandidates.length > 0 && automatableScenarios.length > 0) {
    let repairedCount = 0;
    let incompatibleCount = 0;
    let contaminationRemoved = 0;
    const catalogContaminationTerms = isPrivateOrBalanceIntent
      ? /nombre del producto|beneficios|requisitos|solicitar|descripci[oó]n general|informaci[oó]n de productos|volver al listado de productos|cuentas de efectivo|d[oó]lares|euros|pesos/i
      : null;

    const protectedLabels = new Set<string>();
    for (const seg of huExplicitRoutePath) protectedLabels.add(normLabel(seg));
    if (huModel) {
      for (const value of (huModel.selectableEntities ?? [])) protectedLabels.add(normLabel(value));
      for (const value of (huModel.visibleButtons ?? [])) protectedLabels.add(normLabel(value));
      for (const value of (huModel.visibleWarnings ?? [])) protectedLabels.add(normLabel(value));
      for (const value of (huModel.visibleOptions ?? [])) protectedLabels.add(normLabel(value));
      for (const value of (huModel.requiredScreens ?? [])) protectedLabels.add(normLabel(value));
      for (const value of (huModel.requiredFields ?? [])) protectedLabels.add(normLabel(value));
    }
    for (const branch of functionalBranches) {
      if (branch.sourceLabel) protectedLabels.add(normLabel(branch.sourceLabel));
      if (branch.expectedDestination) protectedLabels.add(normLabel(branch.expectedDestination));
    }

    const extractLabel = (step: string): string | null => {
      const match = step.match(/"(.+?)"/);
      return match ? normLabel(match[1]) : null;
    };

    for (const scenario of automatableScenarios) {
      const scenarioBranch = scenario.functionalBranch;
      const actionEvidence = scenarioBranch
        ? evaluateScenarioActionMatch(scenario, scenarioBranch)
        : {
            expectedActionIdentity: scenario.branchAssociation?.expectedActionIdentity ?? "",
            actualActionIdentity: scenario.branchAssociation?.actualActionIdentity ?? "",
            actionMatched: scenario.branchAssociation?.actionMatched === true,
          };
      let existingSteps = stripStepNumbering(scenario.steps ?? []);
      let modified = false;

      if (catalogContaminationTerms && existingSteps.length > 0) {
        const before = existingSteps.length;
        const referencedIndexes = new Set((scenario.stepRequirementRefs ?? []).map((ref) => ref.stepIndex));
        const filteredWithOrigins = existingSteps
          .map((step, originalIndex) => ({ step, originalIndex }))
          .filter(({ step, originalIndex }) => {
            if (referencedIndexes.has(originalIndex)) return true;
          if (/prestamo|balance|tasa|monto|saldo|cuota|plazo|fecha|pago|desembolsado|cancelacion|amortizacion|correo|imprimir|volver/i.test(step)) return true;
          if (catalogContaminationTerms.test(step)) {
            const label = extractLabel(step);
            if (label && protectedLabels.has(label)) {
              console.log(`[scenario-preview] contaminationPreserved reason=hu_protected_label target="${label}"`);
              return true;
            }
            return false;
          }
          return true;
          });
        existingSteps = filteredWithOrigins.map(({ step }) => step);
        if (scenario.stepRequirementRefs) {
          scenario.stepRequirementRefs = scenario.stepRequirementRefs.flatMap((ref) => {
            const newIndex = filteredWithOrigins.findIndex(({ originalIndex }) => originalIndex === ref.stepIndex);
            return newIndex >= 0 ? [{ ...ref, stepIndex: newIndex }] : [];
          });
        }
        if (scenario.stepClaims) {
          scenario.stepClaims = remapStepClaimsByOrigins(
            scenario.stepClaims,
            filteredWithOrigins.map(({ originalIndex }) => originalIndex),
          );
        }
        const removed = before - existingSteps.length;
        if (removed > 0) {
          contaminationRemoved += removed;
          modified = true;
        }
      }

      let selectedCandidate: BranchRouteCandidate | null = null;
      let selectedScore = Number.NEGATIVE_INFINITY;
      let lastReason: BranchRouteCompatibility["reason"] = "branch_action_mismatch";

      for (const candidate of routeCandidates) {
        if (!scenarioBranch && routeCandidates.length > 1) {
          lastReason = "branch_action_mismatch";
          continue;
        }

        const compatibility = evaluateBranchRouteCompatibility(scenarioBranch, scenario, candidate);
        if (!compatibility.compatible) {
          incompatibleCount++;
          lastReason = compatibility.reason;
          console.log(
            `[scenarios:branch-route] scenarioId=${scenarioIdentity(scenario)} branchId=${scenarioBranch?.branchId ?? "none"} ` +
            `candidateRoute=${candidate.routeId} branchAccess=${scenarioBranch?.accessIntent ?? "unknown"} routeAccess=${candidate.accessIntent} ` +
            `compatible=false reason=${compatibility.reason}`,
          );
          continue;
        }
        if (compatibility.score > selectedScore) {
          selectedScore = compatibility.score;
          selectedCandidate = candidate;
        }
      }

      if (!selectedCandidate) {
        console.log(
          `[scenarios:branch-route] scenarioId=${scenarioIdentity(scenario)} branchId=${scenarioBranch?.branchId ?? "none"} ` +
          `candidateRoute=none branchAccess=${scenarioBranch?.accessIntent ?? "unknown"} routeAccess=unknown compatible=false reason=${lastReason}`,
        );
        warnings.push(
          `Scenario "${scenario.title}": branch_route_incompatible - No se aplico prefijo por incompatibilidad o evidencia insuficiente.`,
        );
        (scenario as any)._branchRouteCompatibility = {
          compatible: false,
          reason: lastReason,
          routeId: null,
        };
        scenario.branchAssociation = {
          ...(scenario.branchAssociation ?? {
            branchId: scenarioBranch?.branchId ?? "none",
            sourceIssueKey: scenario.sourceIssueKey,
            associationMethod: scenarioBranch?.branchId ? "branch_id" : "none",
            associationMatched: Boolean(scenarioBranch?.branchId),
            expectedActionIdentity: actionEvidence.expectedActionIdentity,
            actualActionIdentity: actionEvidence.actualActionIdentity,
            actionMatched: false,
          }),
          branchId: scenarioBranch?.branchId ?? scenario.branchAssociation?.branchId ?? "none",
          destinationMatched: false,
          destinationEvidenceKind: "none",
          destinationEvidenceSource: "route_candidates:destination_mismatch_or_incompatible",
          actionMatched: actionEvidence.actionMatched,
          reasonCode: lastReason,
        };
      } else {
        console.log(
          `[scenarios:branch-route] scenarioId=${scenarioIdentity(scenario)} branchId=${scenarioBranch?.branchId ?? "none"} ` +
          `candidateRoute=${selectedCandidate.routeId} branchAccess=${scenarioBranch?.accessIntent ?? "unknown"} routeAccess=${selectedCandidate.accessIntent} compatible=true reason=ok`,
        );
        (scenario as any)._branchRouteCompatibility = {
          compatible: true,
          reason: "ok",
          routeId: selectedCandidate.routeId,
        };
        scenario.branchAssociation = {
          ...(scenario.branchAssociation ?? {
            branchId: scenarioBranch?.branchId ?? "none",
            sourceIssueKey: scenario.sourceIssueKey,
            associationMethod: scenarioBranch?.branchId ? "branch_id" : "none",
            associationMatched: Boolean(scenarioBranch?.branchId),
            expectedActionIdentity: actionEvidence.expectedActionIdentity,
            actualActionIdentity: actionEvidence.actualActionIdentity,
            actionMatched: false,
          }),
          branchId: scenarioBranch?.branchId ?? scenario.branchAssociation?.branchId ?? "none",
          actionMatched: actionEvidence.actionMatched,
          destinationMatched: true,
          destinationEvidenceKind: "route",
          destinationEvidenceSource: `route:${selectedCandidate.routeId}`,
          reasonCode: actionEvidence.actionMatched ? "ok" : "branch_action_mismatch",
        };
      }

      const entryStepAuthorized = isEntryStepInsertionAuthorized(scenario, functionalBranches);
      const routePrefixTargets = entryStepAuthorized && selectedCandidate?.source === "knowledge" && knowledgeCtx.available
        ? selectedCandidate.clickTargets
        : [];
      const authorizedEntrySteps = entryStepAuthorized ? newEntrySteps : [];
      if (routePrefixTargets.length > 0 || authorizedEntrySteps.length > 0) {
      const canonicalPrefixResult = applyCanonicalRoutePrefix(
          existingSteps,
          routePrefixTargets,
          authorizedEntrySteps,
          scenario.stepRequirementRefs,
        );
      if (canonicalPrefixResult.changed) {
          existingSteps = canonicalPrefixResult.steps;
            if (scenario.stepRequirementRefs) {
            scenario.stepRequirementRefs = scenario.stepRequirementRefs.flatMap((ref) => {
              const finalIndex = canonicalPrefixResult.stepOrigins.findIndex((origin) => origin === ref.stepIndex);
              return finalIndex >= 0 ? [{ ...ref, stepIndex: finalIndex }] : [];
              });
            }
            if (scenario.stepClaims) {
              scenario.stepClaims = remapStepClaimsByOrigins(scenario.stepClaims, canonicalPrefixResult.stepOrigins);
            }
            modified = true;
        }
      }

      if (modified) {
        scenario.steps = renumberScenarioSteps(existingSteps);
        repairedCount++;
        console.log(`[scenario-preview] afterAiRoutePrefixRepair scenarioTitle="${scenario.title?.substring(0, 80)}" firstSteps=${JSON.stringify(scenario.steps.slice(0, 6))}`);
      }
    }

    console.log(`[scenario-preview] aiRoutePrefixRepair scenarios=${repairedCount} incompatible=${incompatibleCount}`);
    if (contaminationRemoved > 0) {
      console.log(`[scenario-preview] aiRoutePrefixRepair contaminationRemoved=${contaminationRemoved}`);
    }
  }

  // Only validate and process automatable scenarios
  // For non-catalog intents (private/balance), skip public routeProfile entry steps
  for (const sc of automatableScenarios) {
    const validation = validateScenario(
      sc,
      isPrivateOrBalanceIntent ? null : resolvedRouteProfile,
      undefined, undefined, undefined,
      isPrivateOrBalanceIntent ? true : undefined,
      effectiveIntent,
    );
    if (validation.valid) {
      validCount++;
    } else {
      invalidCount++;
      console.log(
        `[scenarios:preview] scenarioValidationFailed sourceIssueKey=${sc.sourceIssueKey} ` +
        `title="${sc.title}" errors=${JSON.stringify(validation.errors)}`
      );
      warnings.push(`Scenario "${sc.title}" failed validation: ${validation.errors.join("; ")}`);
    }
    validated.push({ ...sc, validation });
  }

  // Classify validated into executable / adaptive / blocked

  // Split steps into known (route-backed navigation) vs remaining (functional)
  function splitRouteBackedSteps(steps: string[], returnRemaining = false): string[] {
    const idx = steps.findIndex(s => !/^Clic en/i.test(s) && !/^Navegar a/i.test(s));
    if (idx < 0) return returnRemaining ? [] : steps;
    return returnRemaining ? steps.slice(idx) : steps.slice(0, idx);
  }

  const canonicalDependencies = new Map(
    buildRequirementAccounting([], functionalBranches, huTextForContext, issues[0]?.key).requirements
      .map((requirement) => [requirement.requirementId ?? requirement.id, requirement.prerequisiteRequirementIds ?? []] as const)
      .filter(([id]) => Boolean(id)),
  );
  for (const scenario of validated) {
    const gate = evaluateRequirementDependencyGate(scenario, canonicalDependencies);
    if (!gate.dependencySatisfied) {
      scenario.mcpExecutable = false;
      scenario.nonExecutableCriteria = gate.reason ?? "dependency_unresolved";
      (scenario as any).dependencySatisfied = false;
    }
  }
  const executableScenarios = validated.filter(s => s.validation?.valid && s.mcpExecutable !== false);
  const adaptiveScenarios: any[] = [];

  for (const sc of validated) {
    // Chain-blocked: scenarios with explicit _blockedReason (from buildPlanBasedScenarios)
    if ((sc as any)._blockedReason && sc.mcpExecutable === false) {
      const variantId = (sc as any)._variantId as string || "";

      // Build expected screen signals: only assertion texts, not click targets
      const allOf: string[] = [];
      const anyOf: string[] = [];
      for (const step of (sc.steps ?? [])) {
        // Only capture assertion targets, not click actions ("Validar que se muestre X", not "Clic en X")
        const assertMatch = step.match(/Validar que (?:se muestre |el bot[oó]n )?"([^"]+)"/i);
        if (assertMatch?.[1] && !/continuar|confirmar|cancelar|volver|enviar|imprimir/i.test(assertMatch[1])) {
          allOf.push(assertMatch[1]);
        }
      }
      // If allOf is empty, use variant-based signals
      if (allOf.length === 0 && variantId.includes("preview")) { allOf.push("Vista previa"); }
      else if (allOf.length === 0 && variantId.includes("delivery")) { allOf.push("Correo electrónico"); }
      else if (allOf.length === 0 && variantId.includes("confirmation")) { allOf.push("Confirmación"); }

      adaptiveScenarios.push({
        ...sc,                                                  // preserve full scenario (steps, expected, preconditions, validation, etc.)
        executionMode: "adaptive",
        targetScreen: variantId,
        knownSteps: splitRouteBackedSteps(sc.steps ?? []),
        remainingSteps: splitRouteBackedSteps(sc.steps ?? [], true),
        actualChain: (sc as any)._blockedChain ?? "",
        requiredChain: (sc as any)._requiredChain ?? "",
        expectedScreenSignals: { allOf, anyOf },
      });
    }
  }

  // Capture legacy routePending scenarios (from generateRoutePendingScenarios) as adaptive
  for (const sc of validated) {
    if (sc.mcpExecutable === false && !(sc as any)._blockedReason && sc.validation?.valid && (sc.steps ?? []).length > 0) {
      adaptiveScenarios.push({
        ...sc,
        executionMode: "adaptive",
        mcpExecutable: false,
        nonExecutableCriteria: "requires_route_discovery",
        automationStatus: "requires_route_discovery",
      });
      console.log(`[scenarios:classification-source] scenario="${sc.title?.slice(0,40)}" source=route_pending executionMode=adaptive`);
    }
  }

  if (functionalBranches.length > 0 && executableScenarios.length > 0) {
    const reclassified = reclassifyScenariosByBranchCoverage(
      executableScenarios,
      adaptiveScenarios,
      functionalBranches,
      {
        automatableOptionFlowsCount: automatableOptionFlowsForCoverage.length,
        coverageRequirementsAvailable,
      },
    );
    executableScenarios.length = 0;
    executableScenarios.push(...reclassified.executableScenarios);
    adaptiveScenarios.length = 0;
    adaptiveScenarios.push(...reclassified.adaptiveScenarios);
    console.log(
      `[scenarios:classification] branchCoverageReclassified considered=${reclassified.summary.considered} affected=${reclassified.summary.affected} ` +
      `changed=${reclassified.summary.changed} executableRemaining=${executableScenarios.length}`,
    );
    if (reclassified.summary.changed > 0) {
      for (const scenario of adaptiveScenarios) {
        if (!(scenario as any)._branchCoverageIncomplete) continue;
        console.log(
          `[scenarios:classification] scenarioId=${scenarioIdentity(scenario)} branchId=${scenario.functionalBranch?.branchId ?? "none"} ` +
          `previousCategory=executable finalCategory=adaptive reasonCode=${(scenario as any)._branchCoverageIncomplete?.reasonCode ?? "branch_coverage_incomplete"}`,
        );
      }
    }
    for (const scenario of executableScenarios) {
      if (!scenario.functionalBranch?.branchId) continue;
      const association = scenario.branchAssociation;
      if (!association) continue;
      console.log(
        `[scenarios:branch-association] scenarioId=${scenarioIdentity(scenario)} sourceIssueKey=${scenario.sourceIssueKey ?? "unknown"} branchId=${association.branchId} ` +
        `associationMethod=${association.associationMethod} expectedActionIdentity="${association.expectedActionIdentity}" ` +
        `actualActionIdentity="${association.actualActionIdentity}" associationMatched=${association.associationMatched === true} ` +
        `actionMatched=${association.actionMatched} destinationMatched=${association.destinationMatched === true} ` +
        `destinationEvidenceKind=${association.destinationEvidenceKind ?? "none"} ` +
        `destinationEvidenceSource=${association.destinationEvidenceSource ?? "none"} ` +
        `reasonCode=${association.reasonCode ?? "none"}`,
      );
    }
  }

  // Functional branch coverage does not grant execution authority. Provider
  // metadata is only a candidate until a trusted route/evidence is available.
  const readinessDegraded: McpScenario[] = [];
  const readinessExecutable: McpScenario[] = [];
  for (const scenario of executableScenarios) {
    const branchId = scenario.functionalBranch?.branchId;
    const branch = branchId ? functionalBranches.find((candidate) => candidate.branchId === branchId) : undefined;
    if (!branch) {
      readinessExecutable.push(scenario);
      continue;
    }
    const signals = evaluateScenarioBranchCoverageSignals(scenario, branch);
    const trustedExecutionAuthority = (scenario as any)._branchRouteCompatibility?.compatible === true
      || signals.destinationValidationStatus === "validated" && signals.hasRouteEvidence;
    const beforeExecutable = scenario.mcpExecutable === true;
    const beforeReadiness = (scenario as any).executionReadiness ?? "standard";
    if (!trustedExecutionAuthority && signals.destinationValidationStatus !== "validated") {
      scenario.mcpExecutable = false;
      (scenario as any).executionReadiness = "requires_route_discovery";
      readinessDegraded.push({
        ...scenario,
        executionMode: "adaptive",
        mcpExecutable: false,
        executionReadiness: "requires_route_discovery",
        automationStatus: "requires_route_discovery",
        nonExecutableCriteria: "requires_route_discovery",
      } as McpScenario);
      console.log(`[execution-readiness-gate] scenarioId=${scenarioIdentity(scenario)} functionalBranchCovered=${signals.functionalBranchCovered} destinationValidationStatus=${signals.destinationValidationStatus} trustedExecutionAuthority=${trustedExecutionAuthority} executionAuthoritySource=${trustedExecutionAuthority ? "route_or_validated_evidence" : "none"} mcpExecutableBeforeGate=${beforeExecutable} mcpExecutableAfterGate=false readinessBeforeGate=${beforeReadiness} readinessAfterGate=requires_route_discovery reasonCode=destination_authority_pending`);
    } else {
      readinessExecutable.push(scenario);
    }
  }
  if (readinessDegraded.length > 0) {
    executableScenarios.length = 0;
    executableScenarios.push(...readinessExecutable);
    adaptiveScenarios.push(...readinessDegraded);
  }

  // blockedScenarios contains only route-blocked (from routeResolutions) — NOT chain-blocked
  // adaptiveScenarios and blockedScenarios are mutually exclusive

  console.log(
    `[scenarios:preview] response executable=${executableScenarios.length} adaptive=${adaptiveScenarios.length} blocked=${blockedScenarios.length} rejected=${rejected.length} ` +
    `generated=${validated.length} valid=${validCount} routePending=${routePendingCount}`,
  );
  const initialAssemblyMetrics = computeResponseAssemblyMetrics(
    validated,
    executableScenarios,
    adaptiveScenarios,
    rejected,
  );
  console.log(
    `[scenarios:preview] responseAssembly candidates=${initialAssemblyMetrics.candidateIds.length} ` +
    `standard=${executableScenarios.length} adaptive=${adaptiveScenarios.length} ` +
    `omitted=${initialAssemblyMetrics.omitted} omittedValid=${initialAssemblyMetrics.omittedValid} ` +
    `categoriesDisjoint=${initialAssemblyMetrics.categoriesDisjoint}`,
  );

  // Reconcile with final visible candidates by identity, not just counts.
  const expectedVisibleCandidates = validated.filter((scenario) => {
    if ((scenario as any)._blockedReason && scenario.mcpExecutable === false) return true;
    if (scenario.mcpExecutable === false) return scenario.validation?.valid === true && (scenario.steps ?? []).length > 0;
    return scenario.validation?.valid === true;
  });
  const expectedVisibleIds = new Set(expectedVisibleCandidates.map((scenario) => scenarioIdentity(scenario)));
  const assembledVisibleIds = new Set([...executableScenarios, ...adaptiveScenarios].map((scenario) => scenarioIdentity(scenario)));
  const missingClassifiedIds = [...expectedVisibleIds].filter((id) => !assembledVisibleIds.has(id));
  const unexpectedClassifiedIds = [...assembledVisibleIds].filter((id) => !expectedVisibleIds.has(id));
  const classifiedOk = missingClassifiedIds.length === 0 && unexpectedClassifiedIds.length === 0;
  const classificationValid = classifiedOk
    && initialAssemblyMetrics.omittedValid
    && initialAssemblyMetrics.categoriesDisjoint;
  const visibleTotal = expectedVisibleIds.size;
  const classifiedTotal = assembledVisibleIds.size;
  console.log(
    `[scenarios:preview] classificationCheck visible=${visibleTotal} classified=${classifiedTotal} standard=${executableScenarios.length} adaptive=${adaptiveScenarios.length} ` +
    `valid=${classificationValid} idsValid=${classifiedOk} omitted=${initialAssemblyMetrics.omitted} omittedValid=${initialAssemblyMetrics.omittedValid} ` +
    `categoriesDisjoint=${initialAssemblyMetrics.categoriesDisjoint} overlapIds=${initialAssemblyMetrics.overlapIds.length} ` +
    `missingIds=${missingClassifiedIds.length} unexpectedIds=${unexpectedClassifiedIds.length}`,
  );

  const applySemanticDedupeToResponseBuckets = () => {
    const combined = [...executableScenarios, ...adaptiveScenarios] as McpScenario[];
    const dedupeResult = dedupeScenariosBySemanticSignature(combined);
    if (dedupeResult.removed === 0) return;
    const kept = new Set(dedupeResult.scenarios);
    const dedupedExecutable = executableScenarios.filter((scenario) => kept.has(scenario as McpScenario));
    const dedupedAdaptive = adaptiveScenarios.filter((scenario) => kept.has(scenario as McpScenario));
    executableScenarios.length = 0;
    executableScenarios.push(...dedupedExecutable);
    adaptiveScenarios.length = 0;
    adaptiveScenarios.push(...dedupedAdaptive);
    console.log(
      `[scenario-dedupe] removed=${dedupeResult.removed} retained=${dedupeResult.scenarios.length} standard=${executableScenarios.length} adaptive=${adaptiveScenarios.length}`,
    );
  };

  applySemanticDedupeToResponseBuckets();

  let finalVisibleScenarios: McpScenario[] = [...executableScenarios, ...adaptiveScenarios];
  let branchCoverage = computeBranchCoverageCheck(functionalBranches, finalVisibleScenarios, {
    automatableOptionFlowsCount: automatableOptionFlowsForCoverage.length,
    coverageRequirementsAvailable,
  });
  const branchRecoveryInsufficient: string[] = [];
  console.log(
    `[scenarios:branch-coverage] required=${branchCoverage.required} covered=${branchCoverage.covered} missing=${branchCoverage.missing.length} valid=${branchCoverage.valid}`,
  );

  if (branchCoverage.missing.length > 0) {
    for (const missingBranchId of branchCoverage.missing) {
      if (finalVisibleScenarios.some((scenario) => scenario.functionalBranch?.branchId === missingBranchId)) continue;
      const requiredBranch = functionalBranches.find((branch) => branch.branchId === missingBranchId);
      const backup = branchScenarioBackups.get(missingBranchId);
      const evidence = evaluateBranchRecoveryEvidence(requiredBranch, routeCandidates);
      if (!backup && !evidence.recoverable) {
        branchRecoveryInsufficient.push(missingBranchId);
        console.log(
          `[scenarios:branch-coverage] recovery branchId=${missingBranchId} source=deterministic_minimum status=failed reason=${evidence.reason}`,
        );
        warnings.push(`Branch ${missingBranchId}: route_evidence_insufficient`);
        continue;
      }
      const fallbackScenario: McpScenario = backup
        ? {
            ...backup,
            steps: [...(backup.steps ?? [])],
            preconditions: [...(backup.preconditions ?? [])],
            functionalBranch: backup.functionalBranch ? { ...backup.functionalBranch } : requiredBranch,
            scenarioId: `${backup.scenarioId ?? `${backup.sourceIssueKey}:${backup.title}`}:branch-recovery`,
          }
        : {
            sourceIssueKey: issues[0]?.key ?? "unknown",
            title: requiredBranch?.sourceLabel
              ? `Validar rama ${requiredBranch.sourceLabel}`
              : `Validar rama ${missingBranchId}`,
            steps: requiredBranch?.sourceLabel && requiredBranch.expectedDestination
              ? [
                  ...uniqueClickPrefixFromCandidate(
                    routeCandidates.find((candidate) => candidate.routeId === evidence.routeId)
                      ?? {
                        routeId: "none",
                        clickTargets: [],
                        accessIntent: "unknown",
                        source: "hu_route",
                      },
                  ).map((step, index) => `${index + 1}. ${step.replace(/^\d+[\.)]\s*/, "")}`),
                  `Clic en "${requiredBranch.sourceLabel}".`,
                  `Validar que se muestre "${requiredBranch.expectedDestination}".`,
                ]
              : [],
            preconditions: ["La aplicación está disponible."],
            expectedResult: requiredBranch?.expectedDestination
              ? `Se alcanza "${requiredBranch.expectedDestination}".`
              : "Se preserva la rama funcional requerida.",
            type: "functional",
            database: "",
            isConverted: 0,
            automationType: "ui_discovery",
            setupStrategy: "no_login",
            appSlug: appInference.appSlug,
            targetAppSlug: appInference.appSlug,
            routeProfile: resolvedRouteProfile?.name ?? "",
            dataRequirements: "N/A",
            nonExecutableCriteria: "requires_route_discovery",
            mcpExecutable: false,
            functionalBranch: requiredBranch,
            scenarioId: `${issues[0]?.key ?? "unknown"}:${missingBranchId}:generated-branch-recovery`,
          };
      if (!backup) {
        fallbackScenario.steps = renumberScenarioSteps(stripStepNumbering(fallbackScenario.steps));
      }

      const recoveryValidation = validateScenario(
        fallbackScenario,
        isPrivateOrBalanceIntent ? null : resolvedRouteProfile,
        undefined, undefined, undefined,
        isPrivateOrBalanceIntent ? true : undefined,
        effectiveIntent,
      );
      const recoveredScenario = { ...fallbackScenario, validation: recoveryValidation };
      adaptiveScenarios.push({
        ...recoveredScenario,
        executionMode: "adaptive",
        mcpExecutable: false,
        nonExecutableCriteria: recoveredScenario.nonExecutableCriteria || "requires_route_discovery",
        automationStatus: "requires_route_discovery",
      });
      console.log(`[scenarios:branch-coverage] recovery branchId=${missingBranchId} source=${backup ? "last_valid_scenario" : "deterministic_minimum"} validation=${recoveryValidation.valid}`);
    }

    finalVisibleScenarios = [...executableScenarios, ...adaptiveScenarios];
    branchCoverage = computeBranchCoverageCheck(functionalBranches, finalVisibleScenarios, {
      automatableOptionFlowsCount: automatableOptionFlowsForCoverage.length,
      coverageRequirementsAvailable,
    });
    if (branchRecoveryInsufficient.length > 0) {
      branchCoverage.insufficientEvidenceBranchIds = [...branchRecoveryInsufficient];
    }
    console.log(
      `[scenarios:branch-coverage] postRecovery required=${branchCoverage.required} covered=${branchCoverage.covered} missing=${branchCoverage.missing.length} valid=${branchCoverage.valid}`,
    );
  }
  // ── Post-validation fallback: under-generated or all-rejected ──
  const routePendingFallbackAlreadyGenerated = shouldFallback;
  const aiCalled = generationResult?.generationDiagnostics?.aiCalled === true;
  const aiGeneratedCount = (generationResult?.generationDiagnostics?.aiGenerated ?? 0);
  const scenarioTarget = huModel?.scenarioPlan?.scenarioCountTarget ?? scenarioPlan?.scenarioCountTarget ?? 0;
  const aiUnderGeneratedTarget = aiCalled && scenarioTarget > 0 &&
    aiGeneratedCount < Math.ceil(scenarioTarget * 0.6) && validCount < 3;
  const previewValidationZeroAfterAI = aiCalled && aiGeneratedCount > 0 && validCount === 0;
  const needsPostValidationFallback = !routePendingFallbackAlreadyGenerated &&
    (aiUnderGeneratedTarget || previewValidationZeroAfterAI) && issues.length > 0;

  if (aiUnderGeneratedTarget && routePendingFallbackAlreadyGenerated) {
    console.log(`[scenario-preview] postValidationFallback skipped reason=fallback_already_generated previousReason=${fallbackReason ?? "ai_rejected_all_by_quality"}`);
  } else if (aiUnderGeneratedTarget) {
    console.log(`[scenario-preview] fallbackReason=ai_under_generated_target target=${scenarioTarget} aiGenerated=${aiGeneratedCount}`);
  }
  if (previewValidationZeroAfterAI) {
    console.log(`[scenario-preview] fallbackReason=preview_validation_zero_after_ai`);
  }

  if (needsPostValidationFallback) {
    const postFallbackReason = aiUnderGeneratedTarget
      ? "ai_under_generated_target" : "preview_validation_zero_after_ai";
    const postFallbackScenarios = assignFunctionalBranchesToScenarios(
      generateRoutePendingScenarios(
      issues[0], resolverIntent, postFallbackReason,
      candidatePrefixSteps ? "knowledge_prefix_pending" : "missing_initial_route",
      appInference.appSlug, candidatePrefixSteps,
      huModel, scenarioPlan,
      huExplicitRoutePath,
      ),
      functionalBranches,
    );
    for (const fb of postFallbackScenarios) {
      const validatedFallback = { ...fb, validation: { valid: true, errors: [] as string[], warnings: [] as string[] } };
      validated.push(validatedFallback);
      adaptiveScenarios.push({
        ...validatedFallback,
        executionMode: "adaptive",
        mcpExecutable: false,
        nonExecutableCriteria: "requires_route_discovery",
        automationStatus: "requires_route_discovery",
      });
      routePendingCount++;
    }
    console.log(`[scenario-preview] routePendingBuilder postValidationFallback reason=${postFallbackReason} added=${postFallbackScenarios.length} totalRoutePending=${routePendingCount}`);
  }

  applySemanticDedupeToResponseBuckets();
  finalVisibleScenarios = [...executableScenarios, ...adaptiveScenarios];
  branchCoverage = computeBranchCoverageCheck(functionalBranches, finalVisibleScenarios, {
    automatableOptionFlowsCount: automatableOptionFlowsForCoverage.length,
    coverageRequirementsAvailable,
  });
  if (branchRecoveryInsufficient.length > 0) {
    branchCoverage.insufficientEvidenceBranchIds = [...branchRecoveryInsufficient];
  }
  if (branchCoverage.reasonCode === "branch_extraction_mismatch") {
    warnings.push("Branch coverage invalid: branch_extraction_mismatch.");
  }
  if (branchCoverage.reasonCode === "coverage_requirements_unavailable") {
    warnings.push("Branch coverage invalid: coverage_requirements_unavailable.");
  }
  if (!branchCoverage.valid && branchCoverage.missing.length > 0) {
    warnings.push(`Branch coverage incomplete: missing branchIds=${branchCoverage.missing.join(",")}`);
  }

  let responseVisibilityComparison = compareVisibleScenarioSets(
    finalVisibleScenarios,
    [...executableScenarios, ...adaptiveScenarios],
  );
  console.log(
    `[scenarios:preview] responseVisibilityCheck equal=${responseVisibilityComparison.equal} finalVisible=${responseVisibilityComparison.finalVisibleIds.length} responseVisible=${responseVisibilityComparison.responseVisibleIds.length} missing=${responseVisibilityComparison.missingInResponse.length} unexpected=${responseVisibilityComparison.unexpectedInResponse.length}`,
  );
  console.log(
    `[scenarios:branch-coverage] final required=${branchCoverage.required} covered=${branchCoverage.covered} missing=${branchCoverage.missing.length} valid=${branchCoverage.valid}`,
  );

  // Log generation diagnostics if available
  if (generationResult.generationDiagnostics) {
    const diag = generationResult.generationDiagnostics;
    // Merge service-layer fallback into diagnostics for accurate reporting
    const effectiveFallbackUsed = diag.fallbackUsed || shouldFallback || needsPostValidationFallback;
    const effectiveFallbackReason = diag.fallbackReason ?? fallbackReason ?? (needsPostValidationFallback ? (aiUnderGeneratedTarget ? "ai_under_generated_target" : "preview_validation_zero_after_ai") : undefined);
    console.log(
      `[scenarios:diagnostics] mode=${diag.generationMode} ` +
      `aiCalled=${diag.aiCalled} aiFailed=${diag.aiFailed ?? false} ` +
      `aiGenerated=${diag.aiGenerated} finalValid=${diag.finalValid} ` +
      `finalRejected=${diag.finalRejected} finalBlocked=${diag.finalBlocked} ` +
      `fallbackUsed=${effectiveFallbackUsed} fallbackReason=${effectiveFallbackReason ?? "none"}`
    );
  }

  // Log state mapping diagnostic
  console.log(
    `[scenarios:state-mapping] ` +
    `generationValid=${generationResult.generationDiagnostics?.finalValid ?? "unknown"} ` +
    `previewValid=${validCount} ` +
    `difference=${(generationResult.generationDiagnostics?.finalValid ?? 0) - validCount}`
  );

  // Enhance catalogDiagnostics with detailed metrics (Correction 5)
  if (catalogDiagnostics && issues.length > 0 && routeProfileForGeneration?.targetPaths) {
    const { filterTargetPathsByIssueScope } = await import("./scenario-hu-scope-filter");
    const { calculateDynamicScenarioLimit } = await import("./mcp-scenario-prompt-builder");
    const issueContext = issues[0];

    // HU scope filtering diagnostics
    const { alignedTargetPaths, diagnostics: scopeDiagnostics } = filterTargetPathsByIssueScope(
      issueContext,
      routeProfileForGeneration.targetPaths,
      routeProfileForGeneration
    );

    // Extract aligned categories
    const categorySet = new Set<string>();
    const explicitlyMentionedSet = new Set<string>();

    for (const tp of Object.values(alignedTargetPaths)) {
      if (tp.productMetadata?.category) {
        categorySet.add(tp.productMetadata.category);
      }
    }

    // Detect explicitly mentioned categories (from scope filter diagnostics)
    if (scopeDiagnostics.matchedKeywords && scopeDiagnostics.matchedKeywords.length > 0) {
      // Check which aligned categories were explicitly mentioned in HU
      const huCorpus = (issueContext.summary + " " + issueContext.description + " " + (issueContext.acceptanceCriteria || ""))
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

      for (const category of categorySet) {
        const normalizedCategory = category.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (huCorpus.includes(normalizedCategory)) {
          explicitlyMentionedSet.add(category);
        }
      }
    }

    catalogDiagnostics.issueAlignedTargetCount = scopeDiagnostics.alignedProducts;
    catalogDiagnostics.issueAlignedCategories = Array.from(categorySet);
    catalogDiagnostics.explicitlyMentionedCategories = Array.from(explicitlyMentionedSet);

    // Scenario budget diagnostics
    const alignedCategories = Array.from(categorySet);
    const dynamicScenarioLimit = calculateDynamicScenarioLimit(issues, routeProfileForGeneration, alignedCategories);

    catalogDiagnostics.scenarioBudgetResolved = dynamicScenarioLimit;
    catalogDiagnostics.scenarioBudgetSource = process.env.AI_SCENARIO_MAX_PER_ISSUE
      ? "env_override"
      : alignedCategories.length > 2
      ? "dynamic_broad_hu"
      : "default";

    // Seed context diagnostics (using generationSource, not sourceIssueKey)
    const seedScenarios = rawScenarios.filter((s) => s.generationSource === "deterministic_seed");
    const validatedSeeds = validated.filter((s) => s.generationSource === "deterministic_seed");
    const validSeeds = validatedSeeds.filter((s) => s.validation.valid);
    const invalidSeeds = validatedSeeds.filter((s) => !s.validation.valid);

    catalogDiagnostics.seedContextCount = seedScenarios.length;

    if (seedScenarios.length > 0) {
      const seedsByCategory: Record<string, number> = {};
      for (const seed of seedScenarios) {
        // Extract category from seed steps by matching against aligned products
        for (const [target, tp] of Object.entries(alignedTargetPaths)) {
          if (seed.steps?.some((step) => step.includes(target)) && tp.productMetadata?.category) {
            const cat = tp.productMetadata.category;
            seedsByCategory[cat] = (seedsByCategory[cat] || 0) + 1;
            break; // Only count once per seed
          }
        }
      }
      catalogDiagnostics.seedContextByCategory = seedsByCategory;

      // Add detailed seed diagnostics
      catalogDiagnostics.seedGeneratedCount = seedScenarios.length;
      catalogDiagnostics.seedValidCount = validSeeds.length;
      catalogDiagnostics.seedInvalidCount = invalidSeeds.length;

      if (invalidSeeds.length > 0) {
        catalogDiagnostics.seedInvalidReasons = invalidSeeds.map((s) => ({
          title: s.title,
          errors: s.validation.errors,
        }));
      }

      console.log(
        `[scenarios:seed-diagnostics] generated=${seedScenarios.length} ` +
          `valid=${validSeeds.length} invalid=${invalidSeeds.length}`
      );
    }

    // Coverage diagnostics (category-level coverage analysis)
    const categoryCoverage: Record<string, { total: number; covered: number; seeded: number }> = {};

    for (const category of categorySet) {
      const categoryProducts = Object.entries(alignedTargetPaths).filter(
        ([_, tp]) => tp.productMetadata?.category === category
      );

      const coveredProducts = new Set<string>();
      const seededProducts = new Set<string>();

      for (const scenario of rawScenarios) {
        const isSeeded = scenario.generationSource === "deterministic_seed";

        for (const [target, _tp] of categoryProducts) {
          if (scenario.steps?.some((step) => step.includes(`"${target}"`) || step.includes(`'${target}'`))) {
            coveredProducts.add(target);
            if (isSeeded) {
              seededProducts.add(target);
            }
          }
        }
      }

      categoryCoverage[category] = {
        total: categoryProducts.length,
        covered: coveredProducts.size,
        seeded: seededProducts.size,
      };
    }

    catalogDiagnostics.categoryCoverage = categoryCoverage;

    // Failure scenario diagnostics
    const huText = issueContext.summary + " " + issueContext.description + " " + (issueContext.acceptanceCriteria || "");
    const failurePatternMatches = huText.match(/escenario\s+(?:de\s+)?(?:fallo|error|negativ[oa]|excepci[oó]n)/gi);
    catalogDiagnostics.failureScenarioCountDetected = failurePatternMatches?.length || 0;

    const failureScenarios = rawScenarios.filter((s) =>
      s.title?.toLowerCase().includes("error") ||
      s.title?.toLowerCase().includes("fallo") ||
      s.title?.toLowerCase().includes("negativ") ||
      s.title?.toLowerCase().includes("excepción") ||
      s.title?.toLowerCase().includes("inválid")
    );
    catalogDiagnostics.failureScenarioCountGenerated = failureScenarios.length;

    console.log(
      `[scenarios:diagnostics] issueAligned=${catalogDiagnostics.issueAlignedTargetCount} ` +
      `categories=${catalogDiagnostics.issueAlignedCategories?.length} ` +
      `scenarioBudget=${catalogDiagnostics.scenarioBudgetResolved} ` +
      `seedContext=${catalogDiagnostics.seedContextCount} ` +
      `failureDetected=${catalogDiagnostics.failureScenarioCountDetected} ` +
      `failureGenerated=${catalogDiagnostics.failureScenarioCountGenerated}`
    );
  }

  let responseScenarios = [
    ...executableScenarios.map((scenario) => ({ ...scenario, executionMode: "standard" as const })),
    ...adaptiveScenarios.map((scenario) => ({
      ...scenario,
      executionMode: "adaptive" as const,
      mcpExecutable: false,
      nonExecutableCriteria: scenario.nonExecutableCriteria || "requires_route_discovery",
      automationStatus: scenario.automationStatus || "requires_route_discovery",
    })),
  ];
  const definitiveBranchCoverage = branchCoverage;
  let responseAssemblyMetrics = computeResponseAssemblyMetrics(
    validated,
    responseScenarios.filter((scenario: any) => scenario.executionMode === "standard"),
    responseScenarios.filter((scenario: any) => scenario.executionMode === "adaptive"),
    rejected,
  );
  if (!responseAssemblyMetrics.omittedValid) {
    warnings.push(`Response assembly invalid: omitted=${responseAssemblyMetrics.omitted}`);
  }
  if (!responseAssemblyMetrics.categoriesDisjoint) {
    warnings.push(`Response assembly invalid: overlapping categories=${responseAssemblyMetrics.overlapIds.length}`);
  }
  responseVisibilityComparison = compareVisibleScenarioSets(finalVisibleScenarios, responseScenarios);
  if (!responseVisibilityComparison.equal) {
    warnings.push(
      `Response visibility mismatch: missing=${responseVisibilityComparison.missingInResponse.length} unexpected=${responseVisibilityComparison.unexpectedInResponse.length}`,
    );
  }
  let generationSuccessCheck = evaluateGenerationSuccess(
    responseVisibilityComparison.equal,
    definitiveBranchCoverage,
    coverageRequirementsAvailable,
    {
      omittedValid: responseAssemblyMetrics.omittedValid,
      categoriesDisjoint: responseAssemblyMetrics.categoriesDisjoint,
    },
  );
  if (!generationSuccessCheck.generationSuccess) {
    warnings.push(
      `Generation gated: success=false reasons=${generationSuccessCheck.blockedReasons.join(",")} missingBranchIds=${definitiveBranchCoverage.missing.join(",") || "none"}`,
    );
    responseScenarios = markScenariosAsCoverageDiagnostics(responseScenarios, definitiveBranchCoverage);
    executableScenarios.length = 0;
    adaptiveScenarios.length = 0;
    adaptiveScenarios.push(...responseScenarios);
    finalVisibleScenarios = [...responseScenarios];
    responseAssemblyMetrics = computeResponseAssemblyMetrics(
      validated,
      responseScenarios.filter((scenario: any) => scenario.executionMode === "standard"),
      responseScenarios.filter((scenario: any) => scenario.executionMode === "adaptive"),
      rejected,
    );
    responseVisibilityComparison = compareVisibleScenarioSets(finalVisibleScenarios, responseScenarios);
    generationSuccessCheck = evaluateGenerationSuccess(
      responseVisibilityComparison.equal,
      definitiveBranchCoverage,
      coverageRequirementsAvailable,
      {
        omittedValid: responseAssemblyMetrics.omittedValid,
        categoriesDisjoint: responseAssemblyMetrics.categoriesDisjoint,
      },
    );
  }
  branchCoverage = definitiveBranchCoverage;
  console.log(
    `[scenarios:branch-coverage] response required=${branchCoverage.required} covered=${branchCoverage.covered} missing=${branchCoverage.missing.length} valid=${branchCoverage.valid} reason=${branchCoverage.reasonCode ?? "none"}`,
  );
  console.log(
    `[scenarios:preview] responseAssemblyFinal candidates=${responseAssemblyMetrics.candidateIds.length} ` +
    `visible=${responseAssemblyMetrics.visibleCandidateIds.length} rejectedInCandidates=${responseAssemblyMetrics.rejectedCandidateIds.length} ` +
    `omitted=${responseAssemblyMetrics.omitted} omittedValid=${responseAssemblyMetrics.omittedValid} ` +
    `categoriesDisjoint=${responseAssemblyMetrics.categoriesDisjoint} overlapIds=${responseAssemblyMetrics.overlapIds.length}`,
  );
  console.log(
    `[scenarios:preview] responseVisibilityFinal equal=${responseVisibilityComparison.equal} finalVisibleIds=${responseVisibilityComparison.finalVisibleIds.length} responseVisibleIds=${responseVisibilityComparison.responseVisibleIds.length}`,
  );
  let finalRequirementAccounting = buildRequirementAccounting(
    responseScenarios as McpScenario[],
    functionalBranches,
    huTextForContext,
    issues[0]?.key,
  );
  const requirementById = new Map(finalRequirementAccounting.requirements.map((requirement) => [requirement.requirementId ?? requirement.id, requirement]));
  const canonicalClaims = buildCanonicalClaims(finalRequirementAccounting.requirements);
  const canonicalClaimById = new Map(canonicalClaims.map((claim) => [claim.claimId, claim]));
  const configControls = resolvedRouteProfile && rpSource === "app_config"
    ? [
        ...(resolvedRouteProfile.visibleControls ?? []),
        ...(resolvedRouteProfile.entry ?? []).flatMap((entry) => [entry.businessLabel, entry.visibleLabel]),
        ...(resolvedRouteProfile.entrySteps ?? []).map((entry) => entry.target),
        ...Object.entries(resolvedRouteProfile.targetPaths ?? {})
          .filter(([, targetPath]) => !targetPath.source || ["config", "manual", "user_confirmed"].includes(targetPath.source))
          .flatMap(([target, targetPath]) => [target, targetPath.target, ...targetPath.requiredIntermediates]),
      ].filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const validatedRouteControls = resolvedRouteProfile && rpSource !== "app_config"
    ? Object.entries(resolvedRouteProfile.targetPaths ?? {})
        .filter(([, targetPath]) => targetPath.source === "runtime_discovery" && targetPath.confidence === "high")
        .flatMap(([target, targetPath]) => [target, targetPath.target, ...targetPath.requiredIntermediates])
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const validatedKnowledgeControls = knowledgeCtx.available
    ? (knowledgeCtx.navigationHints ?? []).flatMap((hint) => [...hint.clickTargets, ...hint.steps])
    : [];
  responseScenarios = responseScenarios.map((scenario: any) => {
    const providerClaims = Array.isArray(scenario.stepClaims) ? scenario.stepClaims : [];
    const claimRefs = providerClaims.flatMap((claim: any) => {
      const descriptor = canonicalClaimById.get(claim.claimId);
      return descriptor && Number.isInteger(claim.stepIndex)
        ? [{ stepIndex: claim.stepIndex, requirementId: descriptor.requirementId, facet: descriptor.facet }]
        : [];
    });
    const existingRefs = scenario.stepRequirementRefs ?? [];
    scenario.stepRequirementRefs = [...existingRefs, ...claimRefs].filter((ref: any, index: number, refs: any[]) =>
      refs.findIndex((candidate) => candidate.stepIndex === ref.stepIndex && candidate.requirementId === ref.requirementId && candidate.facet === ref.facet) === index,
    ).map((ref: any) => {
      const requirement = requirementById.get(ref.requirementId);
      const claimType = scenario.stepClaimTypes?.[ref.stepIndex];
      const facet = resolveRequirementFacet(requirement?.category, claimType, ref.facet);
      return facet ? { ...ref, facet } : ref;
    });
    const nonAutomatableRefs = (scenario.stepRequirementRefs ?? [])
      .map((ref: any) => requirementById.get(ref.requirementId))
      .filter((requirement: any) => requirement?.status === "nonAutomatable")
      .map((requirement: any) => requirement.requirementId ?? requirement.id);
    const branchId = scenario.functionalBranch?.branchId;
    const stepAuthority = (scenario.steps ?? []).map((step: string, stepIndex: number) => {
      const refs = (scenario.stepRequirementRefs ?? []).filter((ref: any) => ref.stepIndex === stepIndex);
      const referencedRequirements = refs.map((ref: any) => requirementById.get(ref.requirementId)).filter(Boolean);
      const requirement = referencedRequirements[0];
      const canonicalClaimsForStep = providerClaims
        .filter((claim: any) => claim.stepIndex === stepIndex)
        .map((claim: any) => canonicalClaimById.get(claim.claimId))
        .filter(Boolean);
      const canonicalClaimType = canonicalClaimsForStep[0]?.claimType;
      const claimType = resolveStepClaimType(
        canonicalClaimType ?? scenario.stepClaimTypes?.[stepIndex],
        referencedRequirements.map((candidate: any) => candidate.category),
      );
      const requirementFacet = resolveRequirementFacet(
        requirement?.category,
        claimType,
        refs[0]?.facet,
      );
      const expectedClaim = requirement && requirementFacet
        ? canonicalClaims.find((claim) => claim.requirementId === (requirement.requirementId ?? requirement.id) && claim.facet === requirementFacet)
        : undefined;
      const evaluation = evaluateStepAuthority({
        step,
        requirement,
        requirementFacet,
        branchId,
        claimType,
        configuredControls: configControls,
        configTrusted: rpSource === "app_config",
        validatedRouteControls,
        validatedKnowledgeControls,
      });
      const claimBindingValid = Boolean(expectedClaim && canonicalClaimsForStep.some((claim) => claim?.claimId === expectedClaim.claimId));
      return {
        stepIndex,
        requirementFacet,
        ...evaluation,
        authorityValid: evaluation.authorityValid && claimBindingValid,
        authorityReason: !claimBindingValid
          ? "provider step claim is missing or incompatible with canonical claim"
          : evaluation.authorityReason,
      };
    });
    const unsupportedFunctionalSteps = stepAuthority
      .filter((authority: any) => !authority.authorityValid && !["unknown", "technical_route"].includes(authority.claimType))
      .map((authority: any) => ({
        stepIndex: authority.stepIndex,
        producer: authority.sourceType === "provider" ? "provider" : authority.sourceType,
        provenance: authority.sourceType,
        reason: authority.sourceType === "provider"
          ? "functional claim has no structured authority"
          : "functional claim is outside its authority scope",
      }));
    scenario.stepClaimTypes = stepAuthority.map((authority: any) => authority.claimType);
    const provenanceIssues = unsupportedFunctionalSteps.map((step: any) =>
      `unsupported functional claim at step ${step.stepIndex}: ${step.reason}`,
    );
    const semanticIssues = [
      ...(nonAutomatableRefs.length > 0
        ? nonAutomatableRefs.map((id: string) => `nonAutomatable requirement is not demonstrated by scenario evidence: ${id}`)
        : []),
      ...provenanceIssues,
    ];
    return {
      ...scenario,
      stepAuthority,
      unsupportedFunctionalSteps,
      semanticValidity: semanticIssues.length > 0 ? "incomplete" : "valid",
      semanticIssues,
    };
  });
  const finalProviderClaimCompliance = evaluateProviderClaimCompliance(responseScenarios, canonicalClaims);
  generationResult.generationDiagnostics = {
    ...(generationResult.generationDiagnostics ?? {}),
    providerClaimCompliance: finalProviderClaimCompliance,
  };
  // Requirement coverage is measured over the final response scenario set.
  // Semantic validity remains independently reported by StepAuthority.
  finalRequirementAccounting = buildRequirementAccounting(
    responseScenarios as McpScenario[],
    functionalBranches,
    huTextForContext,
    issues[0]?.key,
  );
  for (const scenario of responseScenarios) {
    const eligibility = classifyScenarioPublicationEligibility(scenario, finalRequirementAccounting.requirements);
    Object.assign(scenario, eligibility);
    if (eligibility.launchClassification === "nonAutomatable") {
      scenario.mcpExecutable = false;
      scenario.executionMode = "nonAutomatable" as any;
    }
  }
  const nonAutomatableScenarioIds = new Set(
    responseScenarios
      .filter((scenario) => scenario.launchClassification === "nonAutomatable")
      .map((scenario) => scenarioIdentity(scenario)),
  );
  executableScenarios.splice(
    0,
    executableScenarios.length,
    ...executableScenarios.filter((scenario) => !nonAutomatableScenarioIds.has(scenarioIdentity(scenario))),
  );
  adaptiveScenarios.splice(
    0,
    adaptiveScenarios.length,
    ...adaptiveScenarios.filter((scenario) => !nonAutomatableScenarioIds.has(scenarioIdentity(scenario))),
  );
  const finalFunctionalCoverage = finalRequirementAccounting.functionalCoverage;
  const finalCoverageInvariant = evaluateFunctionalCoverageInvariant(finalRequirementAccounting.requirements);
  console.log(
    `[requirement-accounting-final] total=${finalRequirementAccounting.requirements.length} ` +
    `covered=${finalFunctionalCoverage.covered} ` +
    `nonAutomatable=${finalCoverageInvariant.nonAutomatable} ` +
    `incomplete=${finalCoverageInvariant.incomplete} ` +
    `missing=${finalFunctionalCoverage.missing.length} ` +
    `coverableRequired=${finalCoverageInvariant.coverableRequired} ` +
    `coverableSatisfied=${finalCoverageInvariant.coverableSatisfied} ` +
    `valid=${finalCoverageInvariant.valid}`,
  );
  console.log(`[requirement-accounting-trace] final scenarios=${responseScenarios.length} ids=${JSON.stringify(responseScenarios.map((scenario) => scenario.scenarioId ?? scenario.sourceIssueKey ?? "unknown"))}`);
  generationSuccessCheck = evaluateGenerationSuccess(
    responseVisibilityComparison.equal,
    definitiveBranchCoverage,
    coverageRequirementsAvailable,
    {
      omittedValid: responseAssemblyMetrics.omittedValid,
      categoriesDisjoint: responseAssemblyMetrics.categoriesDisjoint,
      functionalCoverageValid: finalCoverageInvariant.valid,
      providerClaimComplianceValid: generationResult.generationDiagnostics?.providerClaimCompliance
        ? generationResult.generationDiagnostics.providerClaimCompliance.missingClaims.length === 0
          && generationResult.generationDiagnostics.providerClaimCompliance.invalidClaims.length === 0
        : undefined,
    },
  );
  if (!generationSuccessCheck.generationSuccess) {
    warnings.push(`Generation gated: success=false reasons=${generationSuccessCheck.blockedReasons.join(",")}`);
  }
  console.log(
    `[generation-success] requirementAccountingStage=final ` +
    `requirementCoverageValid=${finalCoverageInvariant.valid} ` +
    `providerClaimComplianceValid=${generationResult.generationDiagnostics?.providerClaimCompliance
      ? generationResult.generationDiagnostics.providerClaimCompliance.missingClaims.length === 0
        && generationResult.generationDiagnostics.providerClaimCompliance.invalidClaims.length === 0
      : "unknown"}`,
  );
  console.log(
    `[scenarios:preview] generationSuccess=${generationSuccessCheck.generationSuccess} reasons=${generationSuccessCheck.blockedReasons.join(",") || "none"}`,
  );

  return {
    ok: true,
    source: {
      mode: req.sourceMode ?? "jira",
      projectKey: req.projectKey,
      sprintId,
      status: req.status ?? null,
      issuesFound: issues.length,
    },
    testrail: {
      projectId: req.testrailProjectId ?? null,
      suiteId: req.testrailSuiteId ?? null,
      sectionId: req.testrailSectionId ?? null,
      sectionName: req.testrailSectionName ?? null,
    },
    appSlug: effectiveAppSlug,
    targetAppSlug: appInference.appSlug,
    targetAppName: appInference.appName,
    appInference,
    appProfilePath: appProfileResult.appConfigPath,
    // All functional representations, including documentation-only scenarios, remain visible.
    scenarios: responseScenarios,
    summary: {
      generated: validated.length,
      visible: responseScenarios.length,
      standard: responseScenarios.filter((scenario: any) => scenario.launchClassification === "standard").length,
      adaptive: responseScenarios.filter((scenario: any) => scenario.launchClassification === "adaptive").length,
       valid: responseScenarios.filter((scenario: any) => scenario.semanticValidity === "valid").length,
       invalid: responseScenarios.filter((scenario: any) => scenario.semanticValidity !== "valid").length,
      rejected: rejected.length,
      blocked: blockedScenarios.length,
      routePending: routePendingCount,
      generationSuccess: generationSuccessCheck.generationSuccess,
    },
    routeProfile: resolvedRouteProfile,
    rejected,
    blockedScenarios,
    warnings,
    catalogDiagnostics,
    generationDiagnostics: generationResult.generationDiagnostics,
    canonicalClaims,
    providerClaimCompliance: finalProviderClaimCompliance,
    requirements: finalRequirementAccounting.requirements,
    functionalCoverage: finalRequirementAccounting.functionalCoverage,
    // Backward-compatible: same adaptive scenarios for launch payload
    adaptiveScenarios,
     coverage: (() => {
       const accounts = finalRequirementAccounting.requirements;
       const status = (value: string | undefined) => value ?? "incompleteRequirement";
       const covered = accounts.filter((r) => status(r.status) === "covered").length;
       const incomplete = finalCoverageInvariant.incomplete;
       const nonAutomatable = finalCoverageInvariant.nonAutomatable;
       const missing = finalRequirementAccounting.functionalCoverage.missing.length;
       return {
         status: finalRequirementAccounting.functionalCoverage.valid ? "complete" : "partial",
         complete: finalRequirementAccounting.functionalCoverage.valid,
         total: accounts.length,
         required: accounts.filter((r) => r.required).length,
         covered,
         uncovered: missing,
         missing,
         incompleteRequirement: incomplete,
         blocked: 0,
         nonAutomatable,
         requiredCovered: accounts.filter((r) => r.required && status(r.status) === "covered").length,
         requiredUncovered: accounts.filter((r) => r.required && status(r.status) === "missing").length,
         requiredBlocked: 0,
         blockedRequirements: [],
         coverageRequirementsAvailable: true,
         generationSuccess: generationSuccessCheck.generationSuccess,
         generationBlockedReasons: generationSuccessCheck.blockedReasons,
         branchCoverage,
         responseVisibilityComparison,
         coverableRequired: finalCoverageInvariant.coverableRequired,
         coverableSatisfied: finalCoverageInvariant.coverableSatisfied,
       };
     })(),
  };

/**
 * Detect if a routeProfile is catalog/listing oriented using structural signals,
 * not just label heuristics. Returns confidence: high, medium, or low.
 */
function detectRouteProfileIsCatalog(
  routeProfile: any,
  knowledgeItems?: any[],
): { isCatalog: boolean; confidence: "high" | "medium" | "low"; reason: string } {
  if (!routeProfile) return { isCatalog: false, confidence: "low", reason: "no_route_profile" };

  // ── Structural signals (weighted) ──
  let score = 0;
  const signals: string[] = [];

  // 1. targetPaths with product groups → strong catalog signal
  const targetPaths = (routeProfile.targetPaths ?? {});
  const targetPathKeys = Object.keys(targetPaths);
  if (targetPathKeys.length >= 3) { score += 3; signals.push("targetPaths_rich"); }
  else if (targetPathKeys.length >= 1) { score += 2; signals.push("targetPaths_present"); }

  // 2. targetPaths have productMetadata (subcategory, detailSections, etc.) → very strong
  const hasProductMetadata = targetPathKeys.some(
    (k: string) => !!(targetPaths[k] as any)?.productMetadata?.subcategory
  );
  if (hasProductMetadata) { score += 3; signals.push("product_metadata"); }

  // 3. entry labels contain catalog-pattern business keys (underscore format)
  const entries = (routeProfile.entry ?? []) as any[];
  const entryLabels = entries.map((e: any) =>
    (e.businessLabel ?? e.visibleLabel ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  );
  const catalogEntryPatterns = [/informacion_de_productos/, /productos/, /catalogo/];
  const hasCatalogEntry = entryLabels.some(l => catalogEntryPatterns.some(p => p.test(l)));
  if (hasCatalogEntry) { score += 1; signals.push("catalog_entry_label"); }

  // 4. visibleControls dominated by catalog section labels (Beneficios, Requisitos, etc.)
  const controls = (routeProfile.visibleControls ?? []) as string[];
  if (controls.length >= 5) {
    const catalogSectionTerms = /beneficios|requisitos|condiciones relevantes|descripci[oó]n general|informaci[oó]n legal|nombre del producto|solicitar|tasas/i;
    const catalogControls = controls.filter((c: string) => catalogSectionTerms.test(c));
    const ratio = catalogControls.length / Math.max(controls.length, 1);
    if (ratio >= 0.3) { score += 1; signals.push(`catalog_controls_ratio=${ratio.toFixed(1)}`); }
  }

  // 5. knowledge items signal compatible intent
  if (knowledgeItems && knowledgeItems.length > 0) {
    const hasFunctionalIntent = knowledgeItems.some(
      (k: any) => /intent:functional|intent:catalog/i.test((k.coverageRefs ?? []).join(" ")));
    if (hasFunctionalIntent) { score += 1; signals.push("knowledge_intent_functional"); }
  }

  const isCatalog = score >= 2;
  const confidence: "high" | "medium" | "low" =
    score >= 5 ? "high" : score >= 3 ? "medium" : "low";
  const reason = `score=${score} (${signals.join(", ") || "no_signals"})`;

  return { isCatalog, confidence, reason };
}

/**
 * Extract structured entities from HU text for scenario generation.
 * Multiproject - no hardcoded apps, modules or specific labels.
 */
function extractHuEntities(text: string): {
  documentType: string | null;
  action: string | null;
  requiredData: string[];
  hasPreview: boolean;
  hasConfirmation: boolean;
  hasCancel: boolean;
} {
  const lower = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const docs: [RegExp, string][] = [
    [/(?:carta\s+de\s+referencia\s+bancaria|carta\s+de\s+referencia)/i, "carta de referencia bancaria"],
    [/(?:estado\s+de\s+cuenta|extracto|movimiento)/i, "estado de cuenta"],
    [/carta/i, "carta"], [/certificacion|certificado/i, "certificacion"],
    [/constancia/i, "constancia"], [/comprobante/i, "comprobante"],
    [/documento/i, "documento"], [/reporte/i, "reporte"],
  ];
  let documentType: string | null = null;
  for (const [p, l] of docs) { if (p.test(lower)) { documentType = l; break; } }

  const acts: [RegExp, string][] = [
    [/(?:generar|emitir)\s+(?:una\s+)?(?:carta|certificacion|documento)/i, "Generar"],
    [/(?:descargar|exportar|imprimir)\s+(?:una\s+)?(?:carta|documento|reporte)/i, "Descargar"],
    [/(?:transferir|pagar|enviar)\s+(?:fondos|dinero|pago|monto)/i, "Transferir"],
    [/(?:registrar|crear|solicitar|contratar)\s+(?:una\s+)?(?:cuenta|tarjeta|producto)/i, "Solicitar"],
    [/(?:consultar|visualizar|ver)\s+(?:el\s+)?(?:saldo|estado|detalle)/i, "Consultar"],
  ];
  let action: string | null = null;
  for (const [p, v] of acts) { if (p.test(lower)) { action = v; break; } }

  const dataSignals: [RegExp, string][] = [
    [/\bdestinatario\b/i, "destinatario"], [/\brnc\b/i, "RNC"],
    [/\bcorreo\b|\bemail\b/i, "correo"], [/\bcuenta\b/i, "cuenta"],
    [/\bmonto\b/i, "monto"], [/\bmoneda\b/i, "moneda"],
    [/\bfecha\b/i, "fecha"], [/\bidioama\b/i, "idioma"],
    [/\bmotivo\b/i, "motivo"], [/\bperiodo\b/i, "periodo"],
    [/\brango\b/i, "rango de fechas"],
  ];
  const requiredData: string[] = [];
  for (const [p, l] of dataSignals) { if (p.test(lower) && !requiredData.includes(l)) requiredData.push(l); }

  const hasPreview = /\bvista\s+previa\b/i.test(lower);
  const hasConfirmation = /\bconfirmar\b|\bconfirmacion\b|\baceptar\b|\bgenerar\b/i.test(lower);
  const hasCancel = /\bcancelar\b|\bvolver\b|\bcancelacion\b|\bdescartar\b/i.test(lower);

  return { documentType, action, requiredData, hasPreview, hasConfirmation, hasCancel };
}

/**
 * Generate route-pending scenarios by intent. The HU determines intent, action and validations.
 * app.knowledge only supplies the navigation prefix. No discovery, no browser, no Playwright.
 */
function generateRoutePendingScenarios(
  issue: any, huIntent: string, reasonCode: string,
  routeStatus: "knowledge_prefix_pending" | "missing_initial_route",
  appSlug?: string, candidatePrefixSteps?: string[],
  huModel?: any, scenarioPlan?: any,
  huExplicitRoutePath?: string[],
): any[] {
  // If scenarioPlan is available, use plan-based dynamic generation
  // Exception: display-only intents (balance_inquiry, catalog, detail) skip plan-based
  // because they don't require form fills, confirmations, or data entry flows
  const isDisplayOnlyIntent = huIntent === "balance_inquiry" || huIntent === "catalog_listing" ||
    huIntent === "product_detail_flow" || /loan|balance/i.test(huIntent);
  if (scenarioPlan && !isDisplayOnlyIntent) {
    return buildPlanBasedScenarios(issue, huIntent, reasonCode, routeStatus, appSlug, candidatePrefixSteps, huModel, scenarioPlan);
  }

  const summary = issue.summary ?? "";
  const desc = issue.description ?? "";
  const criteria = issue.acceptanceCriteria ?? "";
  const huText = [summary, desc, criteria].filter(Boolean).join(" ");
  const huLower = huText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const entities = extractHuEntities(huText);
  const key = issue.key;
  const dType = entities.documentType ?? "la operacion";
  const required = entities.requiredData;
  const scenarios: any[] = [];

  const baseFields = { type: "functional", database: "", isConverted: 0,
    automationType: "ui_discovery", setupStrategy: "no_login",
    appSlug: appSlug ?? "unknown", targetAppSlug: appSlug ?? "unknown",
    routeProfile: "", dataRequirements: "", nonExecutableCriteria: "requires_route_discovery",
    mcpExecutable: false, generationSource: "fallback" as const };

  function prefixSteps(): string[] {
    const s: string[] = [];
    const normalize = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const alreadyIncluded = new Set<string>();

    // 1. Knowledge prefix (validated navigation prefix from app.knowledge)
    if (candidatePrefixSteps && candidatePrefixSteps.length > 0) {
      for (const t of candidatePrefixSteps) {
        const step = `Clic en "${t}".`;
        s.push(step);
        alreadyIncluded.add(normalize(t));
      }
    } else if (routeStatus === "knowledge_prefix_pending") {
      s.push("Ingresar al area funcional usando el prefijo de navegacion validado.");
    }

    // 2. HU explicit route (breadcrumb from HU text, e.g., "Consulta de balance > Préstamos")
    const routePath = huExplicitRoutePath ?? (huModel as any)?.explicitRoutePath ?? [];
    if (routePath.length > 0) {
      let addedCount = 0;
      for (const seg of routePath) {
        const normSeg = normalize(seg);
        if (!alreadyIncluded.has(normSeg)) {
          const step = `Clic en "${seg}".`;
          s.push(step);
          alreadyIncluded.add(normSeg);
          addedCount++;
        }
      }
      if (addedCount > 0) {
        console.log(`[scenario-preview] routePendingBuilder huRouteApplied steps=${addedCount} path="${routePath.join(" > ")}"`);
      }
    }

    if (s.length > 1 && (candidatePrefixSteps?.length ?? 0) > 0 && (routePath.length > 0)) {
      console.log(`[scenario-preview] routePendingBuilder finalPrefix source=knowledge+huRoute steps=${s.length}`);
    }

    if (/auth|identificac|login|otp|contrase/i.test(huLower)) s.push("Completar la autenticacion requerida.");
    return s;
  }
  const pfx = prefixSteps();
  const dataStep = required.length > 0 ? [required.length > 2 ? `Completar los datos requeridos: ${required.join(", ")}.` : `Completar ${required.join(" y ")}.`] : [];

  // Detect sub-intent
  const isBalance = /balance|saldo/.test(huLower) && /\\b(cuenta|producto|tarjeta)\\b/.test(huLower);
  const isStatement = /estado de cuenta|extracto|movimiento/.test(huLower);
  const isPayment = /transferir|transferencia|pagar|pago/.test(huLower) || (/enviar/.test(huLower) && /fondos|dinero/.test(huLower));
  const isRegistration = /registrar|crear|solicitar|contratar|apertura/.test(huLower) && /\\b(cuenta|tarjeta|producto|servicio)\\b/.test(huLower);
  const isMaintenance = /editar|modificar|cambiar|actualizar|eliminar|desactivar/.test(huLower);
  const isCatalog = huIntent === "catalog_listing_flow" || /listado|catalogo|productos?|categorias/i.test(huLower);

  console.log(`[scenario-preview] routePendingBuilder intent=${huIntent} strategy=intent_specific`);

  // Intent-specific generators
  function add(title: string, steps: string[], preconds: string[], expected: string) {
    scenarios.push({ ...baseFields, sourceIssueKey: key,
      title,
      steps: [...pfx, ...steps],
      preconditions: ["El usuario esta autenticado en la aplicacion." + (preconds.length ? " " + preconds.join(" ") : "")],
      expectedResult: expected });
  }

  if (huIntent === "balance_inquiry" || /balance|loan/.test(huIntent)) {
    const be = huModel?.businessEntity ?? {};
    const entitySingular = toTitleEntityLabel(be.singularLabel || "producto");
    const entityPlural = toTitleEntityLabel(be.pluralLabel || "productos");
    const entityTerm = (entitySingular.length > 3) ? entitySingular : "producto";
    const entityPluralTerm = (entityPlural.length > 3) ? entityPlural : "productos";
    console.log(`[scenario-preview] routePendingBuilder intent=${huIntent} entity=${entityTerm} source=${be.source ?? "fallback"}`);

    // Generic balance scenarios — driven by businessEntity, not hardcoded fields
    add(`Visualizar listado de ${entityPluralTerm} disponibles`,
      [`Validar que se muestre "Listado de ${entityPluralTerm}".`],
      [`El usuario tiene al menos un ${entityTerm} activo.`],
      `Listado de ${entityPluralTerm} visible.`);

    add(`Consultar detalle del ${entityTerm} seleccionado`,
      [`Seleccionar el primer ${entityTerm} visible del listado.`],
      [`El usuario tiene ${entityPluralTerm} registrados.`],
      `Detalle del ${entityTerm} visible.`);

    add(`Validar datos identificativos del ${entityTerm}`,
      [`Seleccionar el primer ${entityTerm} visible del listado.`,
        `Validar que se muestren los datos identificativos del ${entityTerm}.`,
        `Validar que se muestre la fecha y hora de la consulta.`],
      [], `Datos identificativos del ${entityTerm} visibles.`);

    add(`Validar campos financieros del ${entityTerm}`,
      [`Seleccionar el primer ${entityTerm} visible del listado.`,
        `Validar que los campos financieros principales esten visibles.`,
        `Validar que los montos se muestren con formato correcto.`,
        `Validar que las fechas se muestren con formato correcto.`],
      [], `Campos financieros del ${entityTerm} visibles y correctos.`);

    add(`Validar opciones posteriores del ${entityTerm}`,
      [`Seleccionar el primer ${entityTerm} visible del listado.`,
        `Validar que el boton "Volver al listado de ${entityPluralTerm}" este visible.`,
        `Validar que el boton "Volver al menu principal" este visible.`,
        `Validar las opciones de envio e impresion si estan disponibles.`],
      [], `Opciones posteriores del ${entityTerm} visibles.`);

    add(`Regresar al listado de ${entityPluralTerm}`,
      [`Clic en "Volver al listado de ${entityPluralTerm}".`,
        `Validar que se muestre "Listado de ${entityPluralTerm}".`],
      [`El usuario esta en el detalle de un ${entityTerm}.`],
      `Regreso al listado de ${entityPluralTerm} exitoso.`);

    // ── Granular coverage: detect format rules, post-actions, failure scenarios ──
    const huCtx = huModel ?? {};
    if (huCtx.requiredFields?.some((f: string) => /mount|amount|saldo|balance|pago/i.test(f)) || /\bmonto\b|\bpago\b|\bsaldo\b/i.test(huLower)) {
      add(`Validar formato de moneda en campos del ${entityTerm}`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Validar que los montos del ${entityTerm} se muestren con formato de moneda correcto.`],
        [], `Formato de moneda del ${entityTerm} validado.`);
    }
    if (huCtx.requiredFields?.some((f: string) => /fecha|date/i.test(f)) || /\bfecha\b/i.test(huLower)) {
      add(`Validar formato de fecha en datos del ${entityTerm}`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Validar que las fechas del ${entityTerm} se muestren con formato correcto.`],
        [], `Formato de fecha del ${entityTerm} validado.`);
    }
    if (/porcentaje|tasa\s+de|interes/i.test(huLower)) {
      add(`Validar formato porcentual en datos del ${entityTerm}`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Validar que los valores porcentuales del ${entityTerm} se muestren con formato correcto.`],
        [], `Formato porcentual del ${entityTerm} validado.`);
    }
    if (/numerico|campos\s+numericos/i.test(huLower)) {
      add(`Validar formato numerico en campos del ${entityTerm}`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Validar que los campos numericos del ${entityTerm} se muestren con formato correcto.`],
        [], `Formato numerico del ${entityTerm} validado.`);
    }
    if (/enviar.*correo|correo.*enviar|via\s+correo/i.test(huLower) && !/sin\s+env|no\s+envia/i.test(huLower)) {
      add(`Enviar balance del ${entityTerm} via correo`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Clic en "Enviar via correo".`,
          `Validar que se muestre la confirmacion de envio.`],
        [], `Envio del balance del ${entityTerm} por correo exitoso.`);
    }
    if (/imprimir\b/i.test(huLower) && !/no\s+imprimir|sin\s+impresion/i.test(huLower)) {
      add(`Imprimir balance del ${entityTerm}`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Clic en "Imprimir".`,
          `Validar que se muestre la opcion de impresion.`],
        [], `Impresion del balance del ${entityTerm} solicitada.`);
    }
    if (/generar.*tabla.*amortizacion|tabla.*amortizacion/i.test(huLower)) {
      add(`Generar tabla de amortizacion del ${entityTerm}`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Clic en "Generar tabla de amortizacion".`,
          `Validar que se muestre la tabla de amortizacion generada.`],
        [], `Tabla de amortizacion del ${entityTerm} generada.`);
    }
    if (/finalizar\s+sesion|cerrar\s+sesion/i.test(huLower)) {
      add(`Finalizar sesion desde el detalle del ${entityTerm}`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Clic en "Finalizar sesion".`,
          `Validar que se muestre la pantalla de confirmacion de cierre.`],
        [], `Sesion finalizada correctamente.`);
    }
    // Timeout / inactivity
    if (/inactividad|timeout|sin\s+actividad|segundos/i.test(huLower)) {
      const timeoutSc = `Validar cierre automatico por inactividad en detalle del ${entityTerm}`;
      add(timeoutSc,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Validar que tras el periodo de inactividad configurado se cierre la sesion.`],
        [], `Cierre automatico por inactividad ejecutado.`);
    }
    // Failure scenarios
    if (/sesion\s+expirada|expiracion\s+de\s+sesion/i.test(huLower)) {
      add(`Validar sesion expirada antes de consultar ${entityTerm}`,
        [`Validar que se muestre un mensaje de sesion expirada.`,
          `Validar que el sistema redirija a la pantalla de inicio.`],
        [`La sesion del usuario ha expirado.`], `Mensaje de sesion expirada visible.`);
    }
    if (/error.*core|core.*error|error.*conexion|backend.*error/i.test(huLower)) {
      add(`Validar error de conexion con el Core al consultar ${entityTerm}`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Validar que se muestre un mensaje de error de conexion.`],
        [`El servicio Core no esta disponible.`], `Mensaje de error de conexion visible.`);
    }
    if (/no\s+(posee|tiene|cuenta\s+con)\s+${entityPluralTerm}|sin\s+${entityPluralTerm}|cliente\s+sin/i.test(huLower)) {
      add(`Validar mensaje cuando el cliente no posee ${entityPluralTerm}`,
        [`Validar que se muestre un mensaje indicando que no hay ${entityPluralTerm} disponibles.`],
        [`El cliente no tiene ${entityPluralTerm} asociados.`], `Mensaje de ausencia de ${entityPluralTerm} visible.`);
    }
    if (/no\s+disponible|indisponible|inhabilitado/i.test(huLower)) {
      add(`Validar ${entityTerm} no disponible para consulta`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Validar que se muestre un mensaje de ${entityTerm} no disponible.`],
        [`El ${entityTerm} no esta disponible para consulta.`], `Mensaje de ${entityTerm} no disponible visible.`);
    }
    if (/datos\s+incompletos|campos?\s+incompletos?|informacion\s+incompleta/i.test(huLower)) {
      add(`Validar datos financieros incompletos del ${entityTerm}`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Validar que se muestre un mensaje indicando que los datos estan incompletos.`],
        [`Los datos del ${entityTerm} estan incompletos.`], `Mensaje de datos incompletos visible.`);
    }
    if (/estado\s+no\s+(validable|disponible|accesible)/i.test(huLower)) {
      add(`Validar estado del ${entityTerm} no disponible`,
        [`Seleccionar el primer ${entityTerm} visible del listado.`,
          `Validar que se muestre un mensaje de estado no disponible.`],
        [`El estado del ${entityTerm} no es validable.`], `Mensaje de estado no disponible visible.`);
    }
    if (/inconsistente|duplicado|inconsistencia/i.test(huLower)) {
      add(`Validar inconsistencia en listado de ${entityPluralTerm}`,
        [`Validar que el listado de ${entityPluralTerm} se muestre sin duplicados.`,
          `Validar que no se muestren elementos inconsistentes.`],
        [`Los datos del listado pueden ser inconsistentes.`], `Listado consistente validado.`);
    }

  } else if (huIntent === "transactional_document_flow" && (isBalance || isStatement)) {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=balance_inquiry`);
    const sel = required[0] || "el producto o cuenta";
    add("consultar " + dType, [`Seleccionar ${sel} a consultar.`, "Validar que se muestre el balance o detalle solicitado.", "Validar que el monto se muestre en formato correcto."], [], "El sistema muestra el balance o detalle correctamente.");
    if (required.length > 0) add("validacion de seleccion", ["Intentar consultar sin seleccionar un producto o cuenta.", "Validar que se muestre una indicacion de seleccion requerida."], [], "El sistema solicita seleccionar un producto o cuenta.");
    add("finalizacion de consulta", [`Seleccionar ${sel} a consultar.`, "Validar balance o detalle.", "Volver al listado o pantalla anterior."], [], "El usuario consulta y regresa correctamente.");

  } else if (huIntent === "transactional_document_flow" && isPayment) {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=payment_transfer`);
    const d = required.length > 0 ? required.map(r => `Completar ${r}.`) : ["Completar los datos requeridos."];
    add("operacion exitosa", [...d, "Revisar el resumen.", "Confirmar.", "Validar comprobante o resultado."], ["Los datos estan disponibles."], "Operacion completada exitosamente.");
    if (required.length > 0) add("validacion de campos", [`Intentar continuar sin completar ${required[0]}.`, "Validar mensaje de campo requerido."], [], "El sistema muestra validacion.");
    add("cancelacion", [...d, "Revisar resumen.", "Cancelar antes de confirmar.", "Validar que no se ejecute."], [], "Operacion cancelada.");

  } else if (huIntent === "transactional_document_flow" && isRegistration) {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=product_request`);
    const d = required.length > 0 ? required.map(r => `Completar ${r}.`) : ["Completar los campos requeridos."];
    add("solicitud exitosa", [...d, "Revisar resumen.", "Confirmar.", "Validar confirmacion."], ["Datos disponibles."], "Solicitud completada.");
    add("validacion", ["Intentar enviar sin datos requeridos.", "Validar mensaje de campos obligatorios."], [], "Validacion mostrada.");
    add("cancelacion", ["Cancelar antes de completar.", "Validar que no se procese."], [], "Solicitud cancelada.");

  } else if (huIntent === "transactional_document_flow" && isMaintenance) {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=crud_maintenance`);
    const d = required.length > 0 ? required.map(r => `Completar ${r}.`) : ["Completar datos."];
    add("actualizacion exitosa", [...d, "Confirmar.", "Validar confirmacion."], ["Datos disponibles."], "Actualizacion completada.");
    add("validacion", ["Intentar guardar sin datos requeridos.", "Validar mensaje."], [], "Validacion mostrada.");
    add("cancelar edicion", ["Modificar datos.", "Cancelar sin guardar.", "Validar que cambios no se apliquen."], [], "Cambios descartados.");

  } else if (huIntent === "transactional_document_flow") {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=document_generation`);
    add("generacion exitosa", [`Acceder a funcionalidad de ${dType}.`, ...dataStep, ...(entities.hasPreview ? [`Revisar vista previa de ${dType}.`] : []), ...(entities.hasConfirmation ? [`Confirmar generacion de ${dType}.`] : [`${entities.action || "Generar"} ${dType}.`]), `Validar que ${dType} se genere correctamente.`], ["App disponible."], `${dType} generado correctamente.`);
    add(required.length > 0 ? "validacion datos obligatorios" : "validacion general", required.length > 0 ? [`Acceder a ${dType}.`, `Intentar sin completar ${required[0]}.`, "Validar mensaje de campo requerido."] : [`Acceder a ${dType}.`, "Intentar sin datos.", "Validar mensaje."], [], "Validacion mostrada.");
    if (entities.hasConfirmation || entities.hasCancel) add("confirmacion / cancelacion", [`Acceder a ${dType}.`, ...dataStep, ...(entities.hasPreview ? [`Revisar vista previa.`] : []), entities.hasCancel ? "Cancelar." : "Confirmar.", entities.hasCancel ? "Validar que no se realice." : `Validar ${dType} generado.`], ["Datos disponibles."], entities.hasCancel ? "Operacion cancelada." : "Documento generado.");

  } else if (isCatalog) {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=catalog_browse`);
    add("visualizar listado", ["Navegar al listado.", "Validar opciones disponibles.", "Validar informacion basica."], ["Catalogo disponible."], "Listado visible.");
    add("seleccionar opcion", ["Navegar al listado.", "Seleccionar una opcion.", "Validar informacion detallada."], [], "Detalle visible.");
    add("volver al listado", ["Navegar al listado.", "Seleccionar opcion.", "Volver al listado.", "Validar listado."], [], "Navegacion correcta.");

  } else if (huIntent === "product_detail_flow") {
    console.log(`[scenario-preview] routePendingBuilder scenarioPlan intent=${huIntent} variants=product_detail`);
    add("visualizar detalle", ["Seleccionar producto.", "Validar informacion detallada.", "Validar secciones."], ["Producto disponible."], "Detalle visible.");
    add("explorar secciones", ["Seleccionar producto.", "Validar secciones.", entities.hasCancel ? "Volver al listado." : "Cerrar detalle."].filter(Boolean), [], "Secciones exploradas.");

  } else {
    console.log(`[scenario-preview] routePendingBuilder fallbackGeneric reason=intent_not_specialized`);
    add("flujo exitoso", [`Acceder a ${dType}.`, ...(required.length > 0 ? [`Completar ${required.join(", ")}.`] : []), entities.action ? `${entities.action} ${dType}.` : "Ejecutar operacion.", "Validar resultado."], ["App disponible."], "Operacion completada.");
    add("validacion", ["Ejecutar sin datos requeridos.", "Validar mensaje."], [], "Validacion mostrada.");
    add("cancelacion", ["Cancelar antes de completar.", "Validar que no se realice."], [], "Operacion cancelada.");
  }

  // ── Unified title contract: validate & repair all visible scenario titles ──
  let titlesPassed = 0;
  let titlesFixed = 0;
  let titlesRejected = 0;
  const cleanScenarios: typeof scenarios = [];
  const be = huModel?.businessEntity ?? {};
  const fallbackTerm = (be.singularLabel || be.normalizedKey || "elemento");
  const titleContext: ObjectResolutionContext = {
    huModel,
    entityTerm: (be.singularLabel || be.normalizedKey || "elemento"),
    featureName: huModel?.featureName,
  };

  for (const sc of scenarios) {
    const result = validateAndRepairScenarioTitle(sc.title ?? "", fallbackTerm, titleContext);
    if (result.rejected) {
      console.log(`[scenario-title-contract] rejected reason=unrepairable_title title="${sc.title?.slice(0,80)}"`);
      titlesRejected++;
      continue;
    }
    if (result.repaired) {
      console.log(`[scenario-title-contract] repaired reason=title_contract_violation old="${sc.title?.slice(0,60)}" new="${result.title.slice(0,60)}" object="${result.object ?? ""}" objectSource=${result.objectSource ?? "none"}`);
      titlesFixed++;
    } else {
      console.log(`[scenario-title-contract] valid title="${result.title.slice(0,60)}" object="${result.object ?? ""}" objectSource=${result.objectSource ?? "none"}`);
      titlesPassed++;
    }
    cleanScenarios.push({ ...sc, title: result.title });
  }

  console.log(`[scenario-title-contract] source=final-visible scenarios=${scenarios.length} titlesPassed=${titlesPassed} titlesFixed=${titlesFixed} titlesRejected=${titlesRejected}`);
  console.log(`[scenario-preview] routePendingBuilder generated=${cleanScenarios.length} quality=intent_specific_route_pending automationStatus=requires_route_discovery`);
  return cleanScenarios;
}

/**
 * Rich HU scenario model extracted from acceptance criteria.
 * Universal — no hardcoded projects, HUs, modules or labels.
 */
type HuScenarioModel = {
  mainIntent: string;
  subIntent: string;
  featureName: string;
  primaryAction: string | null;
  uiObligations: string[];
  nonUiRequirements: string[];
  requiredScreens: string[];
  requiredFields: string[];
  selectableEntities: string[];
  multiSelectEntities: string[];
  visibleOptions: string[];
  visibleButtons: string[];
  visibleWarnings: string[];
  previewSignals: boolean;
  confirmationSignals: boolean;
  returnOrCancelSignals: boolean;
  deliverySignals: boolean;
  searchSignals: boolean;
  dropdownSignals: boolean;
  dataRequirements: string[];
  rawSignals: string[];
};

/**
 * Extract explicit menu route from HU text.
 * Detects breadcrumb-like patterns: A > B, A → B, A / B, etc.
 * Generic — no hardcoded apps, modules, or labels.
 */
function extractExplicitRoutePath(huText: string): string[] {
  const t = huText.normalize("NFC");
  const segments: string[] = [];

  // Breadcrumb patterns: "seleccionó en el menú: A > B", "ruta: A > B", etc.
  const prefixPatterns = [
    /seleccion[oó] en el men[uú]\s*[:：]/i,
    /ruta(?:\s+\w+)?\s*[:：]/i,
    /men[uú]\s*[:：]/i,
    /opci[oó]n\s*[:：]/i,
    /navegaci[oó]n\s*[:：]/i,
  ];

  let routeFragment = "";
  for (const p of prefixPatterns) {
    const m = t.match(new RegExp(p.source + "\\s*(.+?)(?:\\.\\s|\\n|\\.$|$)", "i"));
    if (m && m[1]) {
      routeFragment = m[1].trim();
      break;
    }
  }

  if (!routeFragment) return segments;

  // Clean trailing period
  routeFragment = routeFragment.replace(/[.。]\s*$/, "").trim();

  // Split on separators: >, →, /
  const rawSegments = routeFragment.split(/\s*(?:&gt;|>|→|\/)\s*/);

  for (const seg of rawSegments) {
    const cleaned = seg
      .replace(/["""]/g, '"')
      .replace(/^[""]/, "")
      .replace(/[""]$/, "")
      .replace(/\s+/, " ")
      .replace(/[.。]\s*$/, "")
      .trim();
    if (cleaned.length > 1 && !/^\d+$/.test(cleaned)) {
      segments.push(cleaned);
    }
  }

  if (segments.length > 0) {
    console.log(`[hu-route] explicitRoutePath extracted=${segments.length} source=hu_text path="${segments.join(" > ")}"`);
  }

  return segments;
}

/**
 * Extract a rich scenario model from any HU text.
 * Generic — detects UI obligations and non-UI requirements from acceptance criteria.
 * No hardcoded HUs, apps, modules or labels.
 */
function extractHuScenarioModel(huText: string): HuScenarioModel {
  const t = huText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Detect main intent (mutually exclusive, prioritized)
  // Priority: statement > document > balance > payment > request > crud > catalog
  // "estado de cuenta" must dominate over incidental "balance" references
  const isStatement = /estado de cuenta|extracto|movimiento/.test(t);
  const isDoc = (isStatement && (/generar|emitir|descargar|enviar|correo/.test(t) || /estamos generando/.test(t)))
    || (/carta|certificacion|constancia|comprobante|documento/.test(t) && /generar|emitir|descargar/.test(t));
  const isLoanBalance = /prestamo/.test(t) && (/balance|saldo/.test(t) || /monto|tasa|plazo|cuota|desembolsado/.test(t));
  const isBalance = (!isStatement && /balance|saldo/.test(t) && /\b(cuenta|producto|tarjeta|prestamo|prestamos)\b/.test(t)) || isLoanBalance;
  const isPayment = /pagar|pago|transferir|transferencia|monto/.test(t) && !isStatement;
  const isRequest = /solicitar|contratar|apertura|registrar/.test(t) && /\b(cuenta|tarjeta|producto|servicio)\b/.test(t);
  const isCrud = /editar|modificar|cambiar|actualizar|eliminar|desactivar/.test(t) && !t.includes("no podra ser modificada");
  const isCatalog = /listado|catalogo|productos?|categorias/.test(t);

  let mainIntent = "generic";
  if (isStatement) mainIntent = "statement_generation";
  else if (isDoc) mainIntent = "document_generation";
  else if (isLoanBalance || isBalance) mainIntent = "balance_inquiry";
  else if (isPayment) mainIntent = "payment_transfer";
  else if (isRequest) mainIntent = "product_request";
  else if (isCrud) mainIntent = "maintenance_crud";
  else if (isCatalog) mainIntent = "catalog_listing";

  // Extract explicit route path early — used by intent resolution and business entity
  const explicitRouteSegments = extractExplicitRoutePath(huText);

  // Route-based intent resolution: explicit route first segment dominates text heuristics.
  // Post-actions like "enviar correo", "imprimir", "generar tabla" should not
  // change a "consulta de balance" route into document_generation.
  const routeResolved = resolveIntentFromExplicitRoute(t, explicitRouteSegments);
  if (routeResolved && routeResolved.intent !== mainIntent) {
    console.log(`[hu-intent-resolution] routeAction=${routeResolved.action} routeEntity=${routeResolved.entity ?? "none"} routeIntent=${routeResolved.intent} textIntent=${mainIntent} finalIntent=${routeResolved.intent} source=explicit_route reason=route_action_overrides_text_heuristics`);
    mainIntent = routeResolved.intent;
  }

  // Sub-intent refinement (action/feature-based only, not entity-based)
  let subIntent = "standard";
  if (/certificacion|certificado/.test(t) && mainIntent !== "statement_generation") subIntent = "certification";
  else if (/referencia/.test(t) && mainIntent !== "statement_generation") subIntent = "reference_letter";
  else if (mainIntent === "statement_generation" && /cuentas de efectivo|efectivo/.test(t)) subIntent = "cash_account_statement";
  else if (mainIntent === "statement_generation") subIntent = "account_statement";
  else if (/vista previa/.test(t)) subIntent = "with_preview";
  else if (/qr/.test(t)) subIntent = "with_qr";
  else if (/codigo de autenticacion/.test(t)) subIntent = "with_auth_code";

  // Extract business entity from explicit route last segment or HU text.
  // Generic — no hardcoded entity lists.
  const businessEntity = extractBusinessEntity(t, explicitRouteSegments);

  // Derive subIntent generically from mainIntent + entity when applicable
  if (subIntent === "standard" && businessEntity && mainIntent === "balance_inquiry") {
    subIntent = "entity_balance";
  }
  // Feature name from HU document type, falling back to the real business entity (e.g. "registro
  // de usuario", "prestamo") before the ultra-generic "operacion". Avoids labeling a registration/
  // validation HU as "documento" just because it mentions a document input field.
  const featureName =
    extractDocumentType(t) ||
    (businessEntity?.singularLabel && businessEntity.singularLabel.length >= 3 ? businessEntity.singularLabel : undefined) ||
    "operacion";

  // Primary action verb
  const primaryAction = extractPrimaryAction(t);

  // UI obligations: screen requirements
  const requiredScreens: string[] = [];
  const requiredFields: string[] = [];
  const selectableEntities: string[] = [];
  const multiSelectEntities: string[] = [];
  const visibleOptions: string[] = [];
  const visibleButtons: string[] = [];
  const visibleWarnings: string[] = [];

  // Detect UI obligations from HU text patterns
  const uiObligations: string[] = [];

  // Screens
  if (/formulario|pantalla|modal|ventana/.test(t)) { requiredScreens.push("form_screen"); uiObligations.push("form_screen"); }
  if (/vista previa|preview/.test(t)) { requiredScreens.push("preview_screen"); uiObligations.push("preview_screen"); }
  if (/confirmacion|resumen/.test(t)) { requiredScreens.push("confirmation_screen"); uiObligations.push("confirmation_screen"); }
  if (/resultado|comprobante|descarga/.test(t)) { requiredScreens.push("result_screen"); uiObligations.push("result_screen"); }
  if (/listado|resultados/.test(t)) { requiredScreens.push("list_screen"); uiObligations.push("list_screen"); }
  if (/detalle/.test(t)) { requiredScreens.push("detail_screen"); uiObligations.push("detail_screen"); }

  // Fields
  if (/completar|ingresar|llenar|campos|datos\s+requeridos/.test(t)) { requiredFields.push("data_entry_fields"); uiObligations.push("data_entry"); }
  if (/destinatario/.test(t)) { requiredFields.push("recipient"); uiObligations.push("recipient_field"); }
  if (/rnc\b/.test(t)) { requiredFields.push("rnc"); uiObligations.push("rnc_field"); }
  if (/correo|email/.test(t)) { requiredFields.push("email"); uiObligations.push("email_field"); }
  if (/monto/.test(t)) { requiredFields.push("amount"); uiObligations.push("amount_field"); }
  if (/fecha/.test(t)) { requiredFields.push("date"); uiObligations.push("date_field"); }
  if (/moneda/.test(t)) { requiredFields.push("currency"); uiObligations.push("currency_field"); }
  if (/periodo|rango/.test(t)) { requiredFields.push("period_range"); uiObligations.push("period_field"); }
  if (/motivo/.test(t)) { requiredFields.push("reason"); uiObligations.push("reason_field"); }

  // Selectable entities
  if (/producto|productos/.test(t)) { selectableEntities.push("product"); uiObligations.push("product_selection"); }
  if (/cuenta|cuentas/.test(t)) { selectableEntities.push("account"); uiObligations.push("account_selection"); }
  if (/tarjeta|tarjetas/.test(t)) { selectableEntities.push("card"); uiObligations.push("card_selection"); }
  if (/prestamo|prestamos/.test(t)) { selectableEntities.push("loan"); uiObligations.push("loan_selection"); }
  if (/deposito/.test(t)) { selectableEntities.push("deposit"); uiObligations.push("deposit_selection"); }
  if (/(mas de un|multiples|varios)\s+(producto|cuenta|tarjeta|prestamo|deposito)/.test(t)) { multiSelectEntities.push("multiple"); uiObligations.push("multi_select"); }
  // Statement-specific: period/month selection
  if (isStatement && /periodo|rango/.test(t)) { selectableEntities.push("period"); uiObligations.push("period_selection"); }
  if (isStatement && /(personalizado|3\s+meses|6\s+meses|12\s+meses|ultimos)/.test(t)) { selectableEntities.push("months_range"); uiObligations.push("months_range_selection"); }
  if (isStatement && /generando/.test(t)) uiObligations.push("generating_message");
  if (isStatement && /no\s+editable/.test(t)) uiObligations.push("non_editable");
  if (/numero\s+(unico\s+)?de\s+referencia/.test(t)) { selectableEntities.push("reference_number"); uiObligations.push("reference_number_display"); }

  // Visible buttons / labels / warnings
  if (/\"(.+?)\"/g.test(t)) {
    const quoted = [...t.matchAll(/\"(.+?)\"/g)].map(m => m[1]).slice(0, 5);
    visibleOptions.push(...quoted);
    if (quoted.length > 0) uiObligations.push("quoted_labels_found");
  }
  if (/confirmar/.test(t)) { visibleButtons.push("Confirmar"); uiObligations.push("confirm_button"); }
  if (/continuar/.test(t)) { visibleButtons.push("Continuar"); uiObligations.push("continue_button"); }
  if (/cancelar/.test(t)) { visibleButtons.push("Cancelar"); uiObligations.push("cancel_button"); }
  if (/volver/.test(t)) { visibleButtons.push("Volver"); uiObligations.push("return_button"); }
  if (/solicitar/.test(t)) { visibleButtons.push("Solicitar"); uiObligations.push("request_button"); }
  if (/generar/.test(t)) { visibleButtons.push("Generar"); uiObligations.push("generate_button"); }
  if (/descargar/.test(t)) { visibleButtons.push("Descargar"); uiObligations.push("download_button"); }

  // Warnings — always human-readable Spanish, matching actual UI text
  if (/advertencia|alerta|mensaje|importante|no podra ser modificada|no podra ser cambiada/.test(t)) {
    visibleWarnings.push("Esta accion no podra ser modificada despues de completada");
    uiObligations.push("warning_message");
  }
  if (/enmascarado|oculto|parcial/.test(t)) { visibleWarnings.push("Algunos datos pueden estar enmascarados por seguridad"); uiObligations.push("masked_data_warning"); }
  if (isStatement && /generando/.test(t)) { visibleWarnings.push("Estamos generando tu estado de cuenta, esto puede tomar unos minutos"); }
  if (isStatement && /no\s+editable/.test(t)) { visibleWarnings.push("El documento no es editable"); }
  if (/no\s+imprimir|no\s+impresion|sin\s+impresion|no\s+se\s+puede\s+imprimir/.test(t) && !visibleWarnings.includes("La impresion no esta disponible para este documento")) {
    visibleWarnings.push("La impresion no esta disponible para este documento");
  }

  // Flow signals
  const previewSignals = /vista previa/.test(t);
  const confirmationSignals = /confirmar/.test(t);
  const returnOrCancelSignals = /(volver|retornar|cancelar)/.test(t);
  const deliverySignals = /(enviar por correo|correo electronico|email)/.test(t);
  const searchSignals = /(buscar|busqueda|rnc)/.test(t);
  const dropdownSignals = /lista desplegable|seleccionar|opciones/.test(t);

  if (previewSignals) uiObligations.push("preview_flow");
  if (confirmationSignals) uiObligations.push("confirmation_flow");
  if (returnOrCancelSignals) uiObligations.push("return_or_cancel_flow");
  if (deliverySignals) uiObligations.push("delivery_flow");
  if (searchSignals) uiObligations.push("search_flow");
  if (dropdownSignals) uiObligations.push("dropdown_select");

  // Non-UI requirements (excluded from MCP steps)
  const nonUiRequirements: string[] = [];
  if (/b2000|core|backend/.test(t)) nonUiRequirements.push("backend_state");
  if (/base de datos|bd|db/.test(t)) nonUiRequirements.push("database_state");
  if (/auditori/.test(t)) nonUiRequirements.push("audit_trail");
  if (/calculo|calcular/.test(t)) nonUiRequirements.push("financial_calculation");
  if (/firma\s+(fisica|electronica|digital)/.test(t)) nonUiRequirements.push("physical_signature");
  if (/envio real|correo real/.test(t)) nonUiRequirements.push("real_email_send");
  if (/integracion/.test(t)) nonUiRequirements.push("internal_integration");
  // Statement-specific non-UI constraints
  if (isStatement && /generando/.test(t)) nonUiRequirements.push("async_generation_wait");
  if (isStatement && /correo\s+registrado/.test(t)) nonUiRequirements.push("registered_email_only");
  if (/no\s+imprimir|no\s+impresion|sin\s+impresion|no\s+se\s+puede\s+imprimir/.test(t)) nonUiRequirements.push("no_printing");
  if (/no\s+podra\s+ser\s+modificad|no\s+modificable|inmutable/.test(t)) nonUiRequirements.push("immutable_after_generation");

  // Data requirements
  const dataRequirements: string[] = [];
  if (selectableEntities.length > 0) dataRequirements.push("client_with_available_products");
  if (multiSelectEntities.length > 0) dataRequirements.push("client_with_multiple_products");

  // Selection metadata: only populated by future structural extractors.
  // No heuristics — multi-entity cases without explicit evidence remain blocked.
  const selectionMetadata: { parentEntity?: string; alternativeGroup?: string; selectionCardinality?: string } | undefined =
    (multiSelectEntities.length > 0) ? { selectionCardinality: "one_or_more" } : undefined;
  if (/correo|email/.test(t)) dataRequirements.push("client_with_registered_email");
  if (/rnc/.test(t)) dataRequirements.push("entity_with_valid_rnc");
  if (/buscar|busqueda/.test(t)) dataRequirements.push("valid_search_data");
  if (dropdownSignals) dataRequirements.push("available_list_options");

  // Raw signals for debugging
  const rawSignals: string[] = [];
  if (isDoc) rawSignals.push("document_generation");
  if (previewSignals) rawSignals.push("preview");
  if (confirmationSignals) rawSignals.push("confirmation");
  if (returnOrCancelSignals) rawSignals.push("return_or_cancel");
  if (deliverySignals) rawSignals.push("delivery");
  if (searchSignals) rawSignals.push("search");

  return {
    mainIntent, subIntent, featureName, primaryAction,
    uiObligations, nonUiRequirements, requiredScreens, requiredFields,
    selectableEntities, multiSelectEntities, visibleOptions, visibleButtons,
    visibleWarnings, previewSignals, confirmationSignals, returnOrCancelSignals,
    deliverySignals, searchSignals, dropdownSignals,
    dataRequirements, rawSignals, businessEntity, selectionMetadata,
  };
}

function extractDocumentType(t: string): string | null {
  // Specific document types — a match here is unambiguous (the HU is about THIS document).
  const specific: [RegExp, string][] = [
    [/(?:carta\s+de\s+referencia\s+bancaria|carta\s+de\s+referencia)/i, "carta de referencia bancaria"],
    [/(?:estado\s+de\s+cuenta|extracto)/i, "estado de cuenta"],
    [/certificacion|certificado/i, "certificacion"],
    [/constancia/i, "constancia"], [/comprobante/i, "comprobante"],
  ];
  for (const [p, l] of specific) { if (p.test(t)) return l; }

  // Generic terms ("documento", "carta", "reporte") are only a real FEATURE when the HU is about
  // producing that artifact. Otherwise words like "documento de identidad" / "tipo de documento"
  // are just input fields and must NOT become the feature name. Require a generation/emission
  // context near the term.
  const generationContext = /(?:generar|emitir|generacion|emision|descargar|exportar|imprimir|solicitar)/i.test(t);
  // Exclude the common identity-document input phrasing so it never counts as the feature.
  const isIdentityDocInput = /documento\s+de\s+identidad|tipo\s+de\s+documento|numero\s+de\s+documento/i.test(t);
  if (generationContext) {
    const generic: [RegExp, string][] = [
      [/\bcarta\b/i, "carta"],
      [/\bdocumento\b/i, "documento"],
      [/\breporte\b/i, "reporte"],
    ];
    for (const [p, l] of generic) {
      if (l === "documento" && isIdentityDocInput) continue;
      if (p.test(t)) return l;
    }
  }
  return null;
}

function extractPrimaryAction(t: string): string | null {
  const acts: [RegExp, string][] = [
    [/(?:generar|emitir)\s+(?:una\s+)?(?:carta|certificacion|documento)/i, "Generar"],
    [/(?:descargar|exportar|imprimir)\s+(?:una\s+)?(?:carta|documento|reporte)/i, "Descargar"],
    [/(?:transferir|pagar|enviar)\s+(?:fondos|dinero|pago|monto)/i, "Transferir"],
    [/(?:registrar|crear|solicitar|contratar)\s+(?:una\s+)?(?:cuenta|tarjeta|producto)/i, "Solicitar"],
    [/(?:consultar|visualizar|ver)\s+(?:el\s+)?(?:saldo|estado|detalle)/i, "Consultar"],
  ];
  for (const [p, v] of acts) { if (p.test(t)) return v; }
  return null;
}

/**
 * Sanitize a raw route/entity segment: trim, cut at newlines/periods, remove leading numbers
 * and narrative prefixes like "selecciono en el menu".
 */
function sanitizeRouteSegment(seg: string): string {
  let s = seg
    // Remove narrative prefixes that may appear within a route segment
    .replace(/^.*(?:seleccion[oó]\s+en\s+el\s+men[uú]|naveg[oó]\s+a\s+trav[eé]s\s+de|accedi[oó]\s+al\s+m[oó]dulo|ingres[oó]\s+en)\s*:?\s*/gi, "")
    .split(/[\n\r]/)[0]       // cut at newline
    .split(/\.\s{2,}/)[0]     // cut at period followed by space
    .split(/\s+\d+\s*$/)[0]   // cut trailing " 3" or " 12"
    .replace(/^\d+[\s.\-]*/, "") // remove leading "3. " or "12-"
    .replace(/^criterio\s+\d+\s*[:\-]?\s*/i, "") // remove "criterio 3:"
    .trim();
  // Remove trailing punctuation
  s = s.replace(/[.,;:]+$/, "").trim();
  return s;
}

/**
 * Parse explicit route from HU text into action + entity segments.
 */
function parseExplicitRoute(t: string): { segments: string[]; action: string; entity: string } | null {
  // Strip narrative prefix before colon when colon appears before route markers
  const colonIdx = t.indexOf(":");
  const gtIdx = t.indexOf(">");
  if (colonIdx >= 0 && colonIdx < gtIdx) {
    t = t.slice(colonIdx + 1);
  }

  // Find route pattern: segments separated by ">", bounded by newlines/periods
  const routeMatch = t.match(/([^\n\r.]+?(?:\s*>\s*[^\n\r.]+?)+)/);
  if (!routeMatch) return null;
  let raw = routeMatch[1];

  // ── Route window extraction: isolate route from surrounding narrative text ──
  // Action keywords that typically start a functional route segment
  const ROUTE_STARTS = /\b(consulta\s+de\s+balance|estados?\s+de\s+cuenta|generar\s+(?:cartas?|documentos?|certificaciones?|constancias?|comprobantes?)|informaci[oó]n\s+de\s+productos|c[aá]talogo\s+de\s+productos|solicitud(?:es)?\s+de|transferencias?\s+(?:de|a)|pagos?\s+(?:de|a)|certificados?\s+(?:de|a)|reclamaciones?\s+(?:de|a)|turnos?\s+(?:de|a)|citas?\s+(?:de|a)|consulta(?:r)?\s+(?:de\s+)?(?:saldo|balance|detalle)|visualizar\s+(?:listado|detalle))\b/i;

  // Find the START of the route: first actionable keyword before the first ">"
  const actionMatch = raw.match(ROUTE_STARTS);
  if (actionMatch && actionMatch.index !== undefined && actionMatch.index > 0) {
    raw = raw.slice(actionMatch.index);
  }

  // Cut trailing narrative connectors after the route
  const TRAILING_CONNECTORS = /\s+(?:para\s+continuar|deber[aá]\s*(?:seleccionar|navegar|acceder|ingresar|consultar)?|en\s+esta\s+pantalla|anexo\s+\d+|criterio\s+\d+|debe\s+(?:seleccionar|navegar|acceder|ingresar|consultar|visualizar)|y\s+validar\s+que|una\s+vez\s+seleccionado).*$/i;
  raw = raw.replace(TRAILING_CONNECTORS, "").trim();

  const segments = raw.split(/\s*>\s*/).map(s => sanitizeRouteSegment(s)).filter(s => s.length >= 3);
  if (segments.length < 1) return null;

  // If the first segment is >60 chars, it likely still has narrative prefix — trim further
  if (segments[0].length > 60) {
    const trimmed = segments[0].replace(/^.*?(consulta|estado|generar|informaci[oó]n|cat[aá]logo|solicitud|transferencia|pago|certificado|reclamaci[oó]n|turno|cita|visualizar)\b/i, "");
    if (trimmed.length < segments[0].length && trimmed.length >= 3) {
      segments[0] = sanitizeRouteSegment(segments[0].replace(/^.*?(?=(?:consulta|estado|generar|informaci[oó]n|cat[aá]logo|solicitud|transferencia|pago|certificado|reclamaci[oó]n|turno|cita|visualizar)\b)/i, ""));
    }
  }

  return {
    segments,
    action: segments[0],
    entity: segments[segments.length - 1],
  };
}

/**
 * Resolve main intent from explicit route's first action segment.
 * Generic — maps route verbs to intents without hardcoding specific routes.
 */
function resolveIntentFromExplicitRoute(t: string, explicitRouteSegments?: string[]): { action: string; entity: string | null; intent: string } | null {
  // Prefer explicit route segments if available (already parsed, most reliable)
  if (explicitRouteSegments && explicitRouteSegments.length >= 2) {
    const action = explicitRouteSegments[0];
    const entity = explicitRouteSegments[explicitRouteSegments.length - 1];
    if (/\bconsulta\s+de\s+balance\b|\bconsultar\s+balance\b|\bver\s+balance\b/i.test(action)) return { action, entity, intent: "balance_inquiry" };
    if (/\bconsulta\b|\bconsultar\b|\bver\b|\bvisualizar\b/i.test(action) && /\bbalance|\bsaldo/i.test(explicitRouteSegments.join(" "))) return { action, entity, intent: "balance_inquiry" };
    if (/\bestado\s+de\s+cuenta\b|\bextracto\b|\bmovimiento\b/i.test(action)) return { action, entity, intent: "statement_generation" };
    if (/\bgenerar\s+(?:carta|documento|certificacion|constancia|comprobante)\b|\bemitir\b|\bdescargar\b/i.test(action)) return { action, entity, intent: "document_generation" };
    if (/\bcarta\s+de\s+referencia\b|\bcarta\s+consular\b/i.test(action)) return { action, entity, intent: "document_generation" };
    if (/\binformacion\s+de\s+productos\b|\bcatalogo\b|\blistado/i.test(action)) return { action, entity, intent: "catalog_listing_flow" };
    if (/\bsolicit|\bcontrat|\bapertura\b|\bregistro\b/i.test(action)) return { action, entity, intent: "product_request" };
    if (/\bpago\b|\btransferencia\b|\btransferir\b/i.test(action)) return { action, entity, intent: "payment_transfer" };
    return { action, entity, intent: "generic" };
  }

  // Fallback: parse from full text
  const parsed = parseExplicitRoute(t);
  if (!parsed) return null;
  const { action, entity } = parsed;

  if (/\bconsulta\s+de\s+balance\b|\bconsultar\s+balance\b|\bver\s+balance\b/i.test(action)) {
    return { action, entity, intent: "balance_inquiry" };
  }
  if (/\bconsulta\b|\bconsultar\b|\bver\b|\bvisualizar\b/i.test(action) && /\bbalance|\bsaldo/i.test(t)) {
    return { action, entity, intent: "balance_inquiry" };
  }
  if (/\bestado\s+de\s+cuenta\b|\bextracto\b|\bmovimiento\b/i.test(action)) {
    return { action, entity, intent: "statement_generation" };
  }
  if (/\bgenerar\s+(?:carta|documento|certificacion|constancia|comprobante)\b|\bemitir\b|\bdescargar\b/i.test(action)) {
    return { action, entity, intent: "document_generation" };
  }
  if (/\bcarta\s+de\s+referencia\b|\bcarta\s+consular\b/i.test(action)) {
    return { action, entity, intent: "document_generation" };
  }
  if (/\binformacion\s+de\s+productos\b|\bcatalogo\b|\blistado/i.test(action)) {
    return { action, entity, intent: "catalog_listing_flow" };
  }
  if (/\bsolicit|\bcontrat|\bapertura\b|\bregistro\b/i.test(action)) {
    return { action, entity, intent: "product_request" };
  }
  if (/\bpago\b|\btransferencia\b|\btransferir\b/i.test(action)) {
    return { action, entity, intent: "payment_transfer" };
  }
  return { action, entity, intent: "generic" };
}

/**
 * Extract business entity from explicit route or HU text.
 * When explicitRoutePath is provided, uses it directly (avoids re-parsing full text).
 */
function extractBusinessEntity(t: string, explicitRouteSegments?: string[]): {
  rawLabel: string; normalizedKey: string; singularLabel: string; pluralLabel: string; source: string;
} | null {
  // 1. Use explicit route path if provided (already parsed, most reliable)
  if (explicitRouteSegments && explicitRouteSegments.length >= 2) {
    const last = explicitRouteSegments[explicitRouteSegments.length - 1];
    const singular = singularizeWord(last);
    return {
      rawLabel: last,
      normalizedKey: singular.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
      singularLabel: singular,
      pluralLabel: last,
      source: "explicit_route",
    };
  }

  // 2. Parse from full text using parseExplicitRoute
  const parsed = parseExplicitRoute(t);
  if (parsed && parsed.segments.length >= 2 && parsed.entity && parsed.entity.length >= 3) {
    const singular = singularizeWord(parsed.entity);
    return {
      rawLabel: parsed.entity,
      normalizedKey: singular.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
      singularLabel: singular,
      pluralLabel: parsed.entity,
      source: "explicit_route",
    };
  }

  // 3. Fallback: look for entity after action phrases in full text
  const actionMatch = t.match(/(?:consulta|balance|saldo)\s+(?:de\s+)?(?:la\s+|el\s+|los\s+|las\s+)?([a-záéíóúñ]{4,}(?:\s+[a-záéíóúñ]{3,})?)/i);
  const actionEntity = actionMatch?.[1]?.trim();
  if (actionEntity && actionEntity.length >= 4) {
    const singular = singularizeWord(actionEntity);
    return {
      rawLabel: actionEntity,
      normalizedKey: singular.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(),
      singularLabel: singular,
      pluralLabel: actionEntity.endsWith("s") ? actionEntity : `${actionEntity}s`,
      source: "hu_text_action_phrase",
    };
  }

  return null;
}

/** Generic singularization (reused from buildPlanBasedScenarios) */
function singularizeWord(w: string): string {
  const l = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (l.endsWith("es") && l.length > 3 && /[bcdfghjklmnpqrstvwxyz]es$/.test(l)) return w.slice(0, -2);
  if (l.endsWith("s") && l.length > 3 && /[aeiou]s$/.test(l)) return w.slice(0, -1);
  return w;
}

/** Unified title contract — validates and repairs any scenario title. */
function validateAndRepairScenarioTitle(
  title: string,
  fallbackTerm: string,
  context?: ObjectResolutionContext,
): { title: string; repaired: boolean; rejected: boolean; valid: boolean; reason?: string; object?: string | null; objectSource?: string | null } {
  if (!title) return { title, repaired: false, rejected: false, valid: false, reason: "empty_title", object: null, objectSource: null };
  let t = title;
  let repaired = false;

  // Remove hyphens used as separators
  if (/[–—]/.test(t) || /\s-\s/.test(t)) {
    t = t.replace(/[–—]/g, "").replace(/\s*-\s*/g, " ").trim();
    repaired = true;
  }
  // Remove snake_case
  if (/[a-z]+_[a-z]+/.test(t)) {
    t = t.replace(/_/g, " ").trim();
    repaired = true;
  }
  // Remove trailing internal tokens
  if (/\s+(flow|field|message|token|data_entry_fields)$/i.test(t)) {
    t = t.replace(/\s+(flow|field|message|token|data_entry_fields)\s*$/i, "").trim();
    repaired = true;
  }
  // Remove leading numerals from contaminated entity names ("prestamos 3" → remove trailing " 3")
  t = t.replace(/\s+\d+\s*$/, "").trim();
  // Remove narrative prefix contamination
  t = t.replace(/^(?:el\s+cliente\s+)?(?:seleccion[oó]\s+en\s+el\s+men[uú]:?\s*)/gi, "").trim();
  // Collapse multiple spaces
  t = t.replace(/\s{2,}/g, " ").trim();
  // Hard length limit: if > 100 chars, rebuild from fallback
  if (t.length > 100) {
    t = `Validar detalle de ${fallbackTerm}`;
    repaired = true;
  }
  // Too generic or too short after repair → rebuild
  if (t.length < 15 || /^(flujo|validacion|operacion|escenario)\s/i.test(t)) {
    t = `Validar detalle de ${fallbackTerm}`;
    repaired = true;
  }

  // ── Semantic contract layer: action + valid backed functional object + no dangling filler ──
  const semantic = validateSemanticScenarioTitle(t, context);
  if (!semantic.valid) {
    const repair = repairSemanticScenarioTitle(t, context);
    if (repair.repaired) {
      console.log(`[scenario-title-repair] source=deterministic reason=invalid_object oldTitle="${title}" newTitle="${repair.title}" objectSource=${repair.objectSource ?? "none"}`);
      t = repair.title;
      repaired = true;
    } else {
      console.log(`[scenario-title-contract] invalid reason=${semantic.reason ?? "unknown"} title="${title}" object="${semantic.object ?? ""}" objectSource=${semantic.objectSource ?? "none"}`);
      return { title: t, repaired, rejected: true, valid: false, reason: semantic.reason, object: semantic.object, objectSource: semantic.objectSource };
    }
  }

  // Apply title case only to the FIRST letter (preserves entity casing within)
  t = toScenarioTitleCase(t);
  if (t !== title) repaired = true;

  // Final check: if STILL failing, reject
  const FINAL_CHECK = /[–—]|\s-\s|_[a-z]+_[a-z]+|\s(flow|field|message|token|data_entry_fields)$/i;
  if (FINAL_CHECK.test(t) || t.length > 100) return { title: t, repaired, rejected: true, valid: false, reason: "syntactic_violation", object: semantic.object, objectSource: semantic.objectSource };

  return { title: t, repaired, rejected: false, valid: true, reason: undefined, object: semantic.object, objectSource: semantic.objectSource };
}

/** Lowercase entity label for natural casing in titles — avoids hardcoded entity lists. */
function toScenarioTitleCase(title: string): string {
  const t = title.trim().replace(/\s{2,}/g, " ");
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function toTitleEntityLabel(label: string): string {
  if (!label) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * Route Pending Scenario Plan
 * Defines how many and which scenario variants to generate based on HuScenarioModel.
 * Universal — no hardcoded HUs, modules, apps or labels.
 */
type RoutePendingScenarioPlan = {
  scenarioCountTarget: number;
  complexity: "simple" | "medium" | "rich";
  variants: string[];
  primaryVariant: string;
  requiresSelectionFlow: boolean;
  requiresMultiSelectionFlow: boolean;
  requiresInputFlow: boolean;
  requiresSearchFlow: boolean;
  requiresDropdownFlow: boolean;
  requiresPreviewFlow: boolean;
  requiresConfirmationFlow: boolean;
  requiresReturnOrCancelFlow: boolean;
  requiresDeliveryFlow: boolean;
  dataRequirements: string[];
  excludedNonUiRequirements: string[];
};

/**
 * Build a scenario plan from the HuScenarioModel.
 * Determines complexity, target count, and which variants to generate.
 * No hardcoded projects, HUs, modules, or labels.
 */
function buildRoutePendingScenarioPlan(huModel: HuScenarioModel): RoutePendingScenarioPlan {
  const m = huModel;

  // Calculate obligation score
  let score = m.uiObligations.length + m.requiredFields.length + m.selectableEntities.length
    + m.visibleButtons.length + m.visibleWarnings.length + m.visibleOptions.length;
  if (m.previewSignals) score += 2;
  if (m.deliverySignals) score += 2;
  if (m.searchSignals) score += 2;
  if (m.dropdownSignals) score += 1;
  if (m.confirmationSignals) score += 1;
  if (m.returnOrCancelSignals) score += 1;
  if (m.multiSelectEntities.length > 0) score += 1;

  const complexity: "simple" | "medium" | "rich" = score <= 5 ? "simple" : score <= 11 ? "medium" : "rich";

  // Build variant list — stable order
  const baseVariants: string[] = [];
  const addIf = (v: string, condition: boolean) => { if (condition) baseVariants.push(v); };

  addIf("happy_path", true);
  addIf("selection_flow", m.selectableEntities.length > 0);
  addIf("multi_selection_flow", m.multiSelectEntities.length > 0);
  addIf("required_fields_flow", m.requiredFields.length > 0);
  addIf("search_flow", m.searchSignals);
  addIf("dropdown_selection_flow", m.dropdownSignals || m.visibleOptions.length > 0);
  addIf("preview_review_flow", m.previewSignals);
  addIf("confirmation_flow", m.confirmationSignals);
  addIf("return_or_cancel_flow", m.returnOrCancelSignals);
  addIf("delivery_flow", m.deliverySignals);
  addIf("visible_warning_flow", m.visibleWarnings.length > 0);
  addIf("generating_in_progress_flow", m.uiObligations.includes("generating_message"));
  addIf("period_range_selection_flow", m.uiObligations.includes("months_range_selection"));
  addIf("reference_number_display_flow", m.uiObligations.includes("reference_number_display"));
  if (baseVariants.length <= 2) baseVariants.push("generic_validation_flow");

  // Determine target count
  const mustHave: string[] = ["happy_path"];
  if (m.requiredFields.length > 0) mustHave.push("required_fields_flow");
  if (m.selectableEntities.length > 0) mustHave.push("selection_flow");
  if (m.searchSignals) mustHave.push("search_flow");
  if (m.previewSignals) mustHave.push("preview_review_flow");
  if (m.deliverySignals) mustHave.push("delivery_flow");
  if (m.returnOrCancelSignals) {
    if (m.confirmationSignals) mustHave.push("confirmation_return_or_cancel_flow");
    else mustHave.push("return_or_cancel_flow");
  }
  if (m.visibleWarnings.length > 0 && !mustHave.includes("preview_review_flow")) {
    mustHave.push("visible_warning_flow");
  }
  // Statement-specific must-haves
  if (m.mainIntent === "statement_generation" && m.uiObligations.includes("generating_message")) {
    mustHave.push("generating_in_progress_flow");
  }
  if (m.mainIntent === "statement_generation" && m.uiObligations.includes("months_range_selection")) {
    mustHave.push("period_range_selection_flow");
  }

  const minCount = complexity === "simple" ? 2 : complexity === "medium" ? 4 : 5;
  const maxCount = complexity === "simple" ? 3 : complexity === "medium" ? 5 : 8;
  let target = Math.min(Math.max(baseVariants.length, minCount), maxCount);

  // Combine mustHave with baseVariants preserving order
  const variants: string[] = [];
  const allVariants = [...new Set([...mustHave, ...baseVariants])];
  for (const v of allVariants) {
    if (variants.length >= target) break;
    if (!variants.includes(v)) variants.push(v);
  }

  console.log(`[scenario-preview] huPlan debug target=${target} base=${baseVariants.length} mustHave=${mustHave.length < 5 ? mustHave.join(",") : mustHave.length + " variants"} final=${variants.join(",")}`);

  // Flags
  const requiresSelectionFlow = m.selectableEntities.length > 0;
  const requiresMultiSelectionFlow = m.multiSelectEntities.length > 0;
  const requiresInputFlow = m.requiredFields.length > 0 || m.deliverySignals;
  const requiresSearchFlow = m.searchSignals;
  const requiresDropdownFlow = m.dropdownSignals || m.visibleOptions.length > 0;
  const requiresPreviewFlow = m.previewSignals;
  const requiresConfirmationFlow = m.confirmationSignals;
  const requiresReturnOrCancelFlow = m.returnOrCancelSignals;
  const requiresDeliveryFlow = m.deliverySignals;

  // Data requirements
  const dataRequirements: string[] = [...m.dataRequirements];
  if (requiresSelectionFlow && !dataRequirements.includes("client_with_available_products")) dataRequirements.push("client_with_available_products");
  if (requiresMultiSelectionFlow && !dataRequirements.includes("client_with_multiple_products")) dataRequirements.push("client_with_multiple_products");
  if (requiresSearchFlow && !dataRequirements.includes("valid_search_data")) dataRequirements.push("valid_search_data");
  if (requiresDeliveryFlow && !dataRequirements.includes("client_with_registered_contact")) dataRequirements.push("client_with_registered_contact");
  if (requiresDropdownFlow && !dataRequirements.includes("available_list_options")) dataRequirements.push("available_list_options");

  return {
    scenarioCountTarget: target,
    complexity,
    variants,
    primaryVariant: variants[0] || "happy_path",
    requiresSelectionFlow,
    requiresMultiSelectionFlow,
    requiresInputFlow,
    requiresSearchFlow,
    requiresDropdownFlow,
    requiresPreviewFlow,
    requiresConfirmationFlow,
    requiresReturnOrCancelFlow,
    requiresDeliveryFlow,
    dataRequirements,
    excludedNonUiRequirements: [...m.nonUiRequirements],
  };
}

/**
 * Build route-pending scenarios from a scenario plan.
 * Generates one scenario per variant, up to scenarioCountTarget.
 * All scenarios are routePending (mcpExecutable=false, nonExecutableCriteria=requires_route_discovery).
 */
function buildPlanBasedScenarios(
  issue: any, huIntent: string, reasonCode: string,
  routeStatus: string, appSlug?: string, candidatePrefixSteps?: string[],
  huModel?: any, scenarioPlan?: any,
): any[] {
  const summary = issue.summary ?? "";
  const key = issue.key;
  const featureName = huModel?.featureName ?? summary ?? "operacion";
  const baseFields = {
    type: "functional", database: "", isConverted: 0,
    automationType: "ui_discovery", setupStrategy: "no_login",
    appSlug: appSlug ?? "unknown", targetAppSlug: appSlug ?? "unknown",
    routeProfile: "", dataRequirements: "", nonExecutableCriteria: "requires_route_discovery",
    mcpExecutable: false, generationSource: "fallback" as const,
  };

  function prefix(): string[] {
    const s: string[] = [];
    if (candidatePrefixSteps && candidatePrefixSteps.length > 0) s.push(...candidatePrefixSteps.map(t => `Clic en "${t}".`));
    return s;
  }

  // Helper: convert field name to MCP dataKey
  function toDataKey(field: string): string {
    const map: Record<string, string> = {
      destinatario: "destinatario_documento",
      rnc: "rnc_entidad",
      correo: "correo_contacto",
      email: "correo_contacto",
      monto: "monto_operacion",
      fecha: "fecha_operacion",
      periodo: "periodo_consulta",
      moneda: "moneda_operacion",
      motivo: "motivo_operacion",
      cuenta: "cuenta_origen",
      rango: "rango_fechas",
    };
    return map[field.toLowerCase()] ?? `${field.toLowerCase()}_dato`;
  }

  // Helper: normalize domain entity for MCP selection step
  function toSelectionEntity(entity: string): string {
    const map: Record<string, string> = {
      product: "producto",
      account: "cuenta",
      cash_account: "cuenta de efectivo",
      card: "tarjeta",
      credit_card: "tarjeta de credito",
      loan: "prestamo",
      deposit: "deposito",
      certificate: "certificado",
      document: "documento",
    };
    return map[entity.toLowerCase()] ?? entity;
  }

  // Helper: resolve the best business-readable entity label from multiple signals
  function resolveSelectableEntityLabel(): string {
    // 1. explicitRoutePath last segment
    const rp = huExplicitRoutePath ?? (huModel as any)?.explicitRoutePath ?? [];
    if (rp.length > 0) {
      const last = normalizeDisplay(rp[rp.length - 1]);
      if (last.length >= 4) return last;
    }
    // 2. selectableEntities — find first non-generic entity
    const raw = huModel?.selectableEntities ?? [];
    for (const e of raw) {
      const label = toSelectionEntity(e);
      if (label !== "producto" && label !== "elemento") return label;
    }
    // 3. huModel featureName / documentType
    if (huModel?.featureName && !/operacion/.test(huModel.featureName)) return huModel.featureName;
    // 4. last word fallback
    return "producto";
  }

  function normalizeDisplay(s: string): string {
    return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  }

  // Convert a Spanish entity phrase from plural to singular using generic
  // linguistic rules. No hardcoded HUs — pure Spanish grammar.
  function singularizeEntityLabel(label: string): string {
    const words = label.split(/\s+/);
    if (words.length === 0) return label;

    // Irregular plurals where stem changes (linguistic, not domain-specific)
    const irregular: Record<string, string> = { veces: "vez" };

    const singularized = words.map(w => {
      const l = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const orig = w; // preserve original casing/accents
      if (irregular[l]) return irregular[l];

      // Plural -es after consonant: árbol→árboles, solicitud→solicitudes
      if (l.endsWith("es") && l.length > 3 && /[bcdfghjklmnpqrstvwxyz]es$/.test(l)) {
        return orig.length > 2 ? orig.slice(0, -2) : orig;
      }
      // Plural -s after vowel: cuenta→cuentas, tarjeta→tarjetas
      if (l.endsWith("s") && l.length > 3 && /[aeiou]s$/.test(l)) {
        return orig.length > 2 ? orig.slice(0, -1) : orig;
      }
      return orig;
    });

    return singularized.join(" ");
  }

  // Detect Spanish grammatical gender for article agreement.
  // Returns "f" for feminine, "m" for masculine.
  function detectEntityGender(word: string): "f" | "m" {
    const l = word.toLowerCase();
    // Feminine by suffix
    if (/(?:cion|sion|dad|tad|tud|umbre|ie|cia|ncia|eza)$/.test(l)) return "f";
    // Feminine by ending in 'a'
    if (/a$/.test(l) && !/(?:ma|pa|ta|grama|problema|sistema|tema|idioma|poema|drama|clima|mapa|planeta|cometa|dia)$/.test(l)) return "f";
    return "m";
  }

  // Helper: build field entry step
  function buildFieldStep(field: string): string {
    return `Completar el campo ${field}.`;
  }

  // Helper: build selection step with ordinal
  function buildSelectionStep(entity: string, ordinal: "primer" | "segundo" = "primer"): string {
    // Resolve entity: if the passed entity is generic, use the resolved label
    let e = toSelectionEntity(entity);
    if (!e || e === "producto" || e === "elemento") {
      e = resolveSelectableEntityLabel();
      if (!e || e === "producto") e = "elemento";
    }
    e = toTitleEntityLabel(e);
    const gender = e.endsWith("a") ? "la" : "el";
    return ordinal === "primer"
      ? `Seleccionar ${gender} primer${gender === "la" ? "a" : ""} ${e} visible del listado.`
      : `Seleccionar ${gender} segund${gender === "la" ? "a" : "o"} ${e} visible del listado.`;
  }
  function buildVariantScenarios(): any[] {
    const variants = scenarioPlan?.variants ?? ["happy_path"];
    const target = scenarioPlan?.scenarioCountTarget ?? Math.min(variants.length, 3);
    const pfx = prefix();
    const m = huModel;

    // Filter internal field IDs that should not appear as literal field names in MCP steps
    const INTERNAL_IDS = new Set(["data_entry_fields", "data_entry", "required_fields", "fields", "generic_field",
      "recipient", "sender", "receiver", "destination", "source_field", "target_field",
      "rnc", "r_n_c", "date", "amount", "currency", "period", "reason", "motivo"]);
    const realFields = (m?.requiredFields ?? []).filter((f: string) => !INTERNAL_IDS.has(f.toLowerCase()));

    // Canonical semantic action classification — separates expected from detected
    type CanonicalAction = "confirm" | "cancel" | "return" | "generate" | "deliver" | "download" | "export" | "select" | "fill" | "validate" | "unknown";

    // Minimal alias fallback — confidence never exceeds 0.25. Structural types are NOT actions.
    const ALIAS_FALLBACK: Record<string, CanonicalAction> = {
      confirmar: "confirm", cancelar: "cancel", volver: "return", generar: "generate",
      enviar: "deliver", imprimir: "deliver", descargar: "download", exportar: "export",
    };

    // Detect action from CONTROL label only. semanticType indicates structural role, not functional action.
    // Aliases provide weak fallback — require corroborating requirement evidence to be trusted.
    function detectActionFromControl(label: string, _semanticType?: string): { action: CanonicalAction; confidence: number } {
      const key = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (ALIAS_FALLBACK[key]) return { action: ALIAS_FALLBACK[key], confidence: 0.25 };
      for (const [alias, action] of Object.entries(ALIAS_FALLBACK)) {
        if (key.includes(alias) && alias.length > 4) return { action, confidence: 0.15 };
      }
      return { action: "unknown", confidence: 0 };
    }

    // Score: compatibility (detected matches expected) + detected confidence.
    // Aliases alone (confidence ≤ 0.25) are NOT sufficient — require corroboration from expectedAction.
    function scoreControlCandidate(label: string, expectedAction: CanonicalAction, semanticType?: string): {
      label: string; detectedAction: CanonicalAction; compatible: boolean; score: number; confidence: number;
    } {
      const detected = detectActionFromControl(label, semanticType);
      const compatible = detected.action === expectedAction;
      // Higher score when expectedAction corroborates alias detection
      const score = compatible ? (0.3 + detected.confidence * 0.7 + (detected.confidence <= 0.25 ? 0.15 : 0)) : 0;
      return { label, detectedAction: detected.action, compatible, score, confidence: detected.confidence };
    }

    // Find best compatible control candidate
    function findBestControl(
      buttons: string[], expectedAction: CanonicalAction, semanticType?: string,
    ): { label: string; score: number; ambiguous: boolean; detectedAction: string } | null {
      const scored = buttons.map(b => scoreControlCandidate(b, expectedAction, semanticType)).filter(c => c.compatible).sort((a, b) => b.score - a.score);
      if (!scored.length) return null;
      const ambiguous = scored.length > 1 && scored[0].score - scored[1].score < 0.25;
      return { label: scored[0].label, score: scored[0].score, ambiguous, detectedAction: scored[0].detectedAction };
    }


    // Resolve the best validated business object for scenario titles.
    // Priority: featureName → entity → real field → selectable → warning. Skips buttons
    // (action labels like "Continuar" are structural, not flow objects).
    const resolvePlanTitleObject = (
      mh: any, featureNameCandidate: string, entityCandidate: string,
    ): { object: string; source: string; backed: boolean } | null => {
      const candidates: Array<{ value: string; source: string }> = [];
      if (featureNameCandidate && classifySemanticObject(featureNameCandidate).valid) candidates.push({ value: featureNameCandidate, source: "featureName" });
      if (entityCandidate && classifySemanticObject(entityCandidate).valid && !/operacion|elemento|producto/.test(normalizeObjText(entityCandidate))) candidates.push({ value: entityCandidate, source: "entity" });
      for (const f of (mh?.requiredFields ?? [])) {
        if (typeof f === "string" && classifySemanticObject(f).valid && !INTERNAL_IDS.has(f.toLowerCase())) candidates.push({ value: f, source: "field" });
      }
      for (const e of (mh?.selectableEntities ?? [])) {
        const label = mapBusinessEntityLabel(String(e));
        if (classifySemanticObject(label).valid) candidates.push({ value: label, source: "selectable" });
      }
      for (const w of (mh?.visibleWarnings ?? [])) {
        if (typeof w === "string" && classifySemanticObject(w).valid) candidates.push({ value: w, source: "warning" });
      }
      const picked = candidates.find((c) => c.source !== "selectable") ?? candidates[0];
      if (!picked) return null;
      return { object: picked.value, source: picked.source, backed: true };
    };

    // ── Title builder: produces business-readable Spanish, no variant IDs ──
    const entity = resolveSelectableEntityLabel();
    const titleObject = resolvePlanTitleObject(m, featureName, entity);
    const feat = titleObject?.object ?? "la operacion";
    console.log(`[functional-object] requirement=feature object="${feat}" source=${titleObject?.source ?? "none"} backed=${titleObject?.backed ?? false}`);
    const requiredFieldsObj = (m?.requiredFields ?? []).find(
      (f: any) => typeof f === "string" && classifySemanticObject(f).valid && !INTERNAL_IDS.has(f.toLowerCase()),
    );
    const requiredFieldsTitle = requiredFieldsObj
      ? `Completar datos requeridos de ${toTitleEntityLabel(requiredFieldsObj)}`
      : `Completar datos requeridos de ${feat}`;
    const scopes: Record<string, string> = {
      happy_path: `Ejecutar flujo completo de ${feat}`,
      selection_flow: `Seleccionar ${entity} para generar ${feat}`,
      multi_selection_flow: `Seleccionar multiples ${entity}s para ${feat}`,
      required_fields_flow: requiredFieldsTitle,
      search_flow: `Buscar ${entity} para ${feat}`,
      dropdown_selection_flow: `Seleccionar opcion de ${feat}`,
      preview_review_flow: `Revisar vista previa de ${feat}`,
      confirmation_flow: `Confirmar generacion de ${feat}`,
      confirmation_return_or_cancel_flow: `Confirmar o cancelar generacion de ${feat}`,
      return_or_cancel_flow: `Cancelar generacion de ${feat}`,
      delivery_flow: `Validar envio de ${feat} al correo registrado`,
      visible_warning_flow: `Validar restricciones de impresion y modificacion de ${feat}`,
      generating_in_progress_flow: `Validar mensaje de generacion del ${feat}`,
      period_range_selection_flow: `Seleccionar periodo para ${feat}`,
      reference_number_display_flow: `Validar numero unico de referencia del ${feat}`,
    };

    // ── Build all variant entries with typed functional branches ──
    const allVariantEntries: Array<{ id: string; title: string; branchType: string; branchId: string }> = [];
    for (const v of variants) {
      const baseBranchId = `${v}`;
      if (v === "period_range_selection_flow" && m?.selectableEntities?.includes("months_range")) {
        allVariantEntries.push(
          { id: v, title: `Seleccionar rango personalizado para generar ${feat}`, branchType: "default", branchId: `${baseBranchId}_custom` },
          { id: v, title: `Generar ${feat} de los ultimos tres meses`, branchType: "default", branchId: `${baseBranchId}_3m` },
          { id: v, title: `Generar ${feat} de los ultimos seis meses`, branchType: "default", branchId: `${baseBranchId}_6m` },
          { id: v, title: `Generar ${feat} de los ultimos doce meses`, branchType: "default", branchId: `${baseBranchId}_12m` },
        );
      } else if (v === "period_range_selection_flow") {
        allVariantEntries.push({ id: v, title: `Generar ${feat} con rango de fecha personalizado`, branchType: "default", branchId: baseBranchId });
      } else if (v === "selection_flow" && m?.multiSelectEntities?.length) {
        allVariantEntries.push({ id: v, title: scopes[v] ?? `Seleccionar ${entity} para generar ${feat}`, branchType: "single", branchId: `${baseBranchId}_single` });
        allVariantEntries.push({ id: v, title: `Seleccionar multiples ${entity}s para generar ${feat}`, branchType: "multiple", branchId: `${baseBranchId}_multi` });
      } else if (v === "confirmation_flow" || v === "confirmation_return_or_cancel_flow") {
        allVariantEntries.push({ id: v, title: `Confirmar generacion de ${feat}`, branchType: "confirm", branchId: `${baseBranchId}_confirm` });
        if (m?.visibleButtons?.some((b: string) => /cancelar|volver/i.test(b))) {
          allVariantEntries.push({ id: v, title: `Cancelar generacion de ${feat}`, branchType: "cancel", branchId: `${baseBranchId}_cancel` });
        }
        if (m?.visibleButtons?.some((b: string) => /volver/i.test(b))) {
          allVariantEntries.push({ id: v, title: `Volver desde generacion de ${feat}`, branchType: "return", branchId: `${baseBranchId}_return` });
        }
      } else if (v === "delivery_flow" && m?.deliverySignals) {
        allVariantEntries.push({ id: v, title: `Validar envio de ${feat} al correo registrado`, branchType: "delivery_alternative", branchId: `${baseBranchId}_email` });
        if (m?.visibleButtons?.some((b: string) => /imprimir/i.test(b))) {
          allVariantEntries.push({ id: v, title: `Validar impresion de ${feat}`, branchType: "delivery_alternative", branchId: `${baseBranchId}_print` });
        }
      } else if (v === "selection_flow") {
        allVariantEntries.push({ id: v, title: scopes[v] ?? `Seleccionar ${entity} para generar ${feat}`, branchType: "single", branchId: baseBranchId });
      } else {
        allVariantEntries.push({ id: v, title: scopes[v] ?? `Validar ${feat}`, branchType: "default", branchId: baseBranchId });
      }
    }

    // Phase inheritance: deduplicated, single submit, all fields/entities
    const prereqStepsCache: Map<string, string[]> = new Map();
    function buildPrerequisitePhaseSteps(): string[] {
      const phases: { type: string; steps: string[] }[] = [];

      // Selection phase: semantic classification based on evidence, not count
      const selEntities = (m?.selectableEntities ?? []).filter((e: any) => {
        const label = toSelectionEntity(String(e));
        return label && label !== "producto" && label !== "elemento";
      });
      if (selEntities.length) {
        // Detect relation: use selectionMetadata from huModel when available
        const selMeta = (m as any)?.selectionMetadata;
        const hasParent = selMeta?.parentEntity != null || selMeta?.alternativeGroup != null;
        const shareGroup = !selMeta?.alternativeGroup ? false : selEntities.every((e: any) => true); // all entities share same alternativeGroup from extractor
        const entityRelation = selEntities.length === 1 ? "single"
          : (!hasParent || !shareGroup || !selMeta) ? "unknown"
          : "alternative";

        if (entityRelation === "alternative") {
          const parentTerm = selMeta?.parentEntity || selMeta?.selectionGroup || resolveSelectableEntityLabel();
          console.log(`[entity-relation] entities=${selEntities.map((e: any) => toSelectionEntity(String(e))).join(",")} relation=alternative parent="${parentTerm}" cardinality=${selMeta?.selectionCardinality ?? "one"} action=single_selection`);
          phases.push({ type: "selection", steps: [buildSelectionStep(selEntities[0], "primer")] });
        } else if (entityRelation === "single") {
          phases.push({ type: "selection", steps: [buildSelectionStep(selEntities[0], "primer")] });
        } else {
          console.log(`[entity-relation] entities=${selEntities.map((e: any) => toSelectionEntity(String(e))).join(",")} relation=unknown action=blocked reason=selectable_entity_relation_unknown`);
          (m as any)._entitySelectionBlocked = true;
        }
      }

      // Data entry phase: filter undefined fields
      const entryFields = realFields.filter((f: string) => {
        const lower = f.toLowerCase();
        return !["email","correo","rnc","destinatario","recipient","undefined","null","none","field","generic"].includes(lower)
          && f.length > 2
          && !f.startsWith("data_")
          && !f.startsWith("required_");
      });
      if (entryFields.length) {
        const entrySteps: string[] = entryFields.map(f => buildFieldStep(f));
        phases.push({ type: "data_entry", steps: entrySteps });
      }

      // Submit phase: single "Continuar" after all selections + entries
      const needsSubmit = phases.length > 0;
      if (needsSubmit) {
        phases.push({ type: "submit", steps: ['Clic en "Continuar".'] });
      }

      // Deduplicate and flatten in topological order
      const seen = new Set<string>();
      const result: string[] = [];
      for (const p of phases) {
        if (!seen.has(p.type)) {
          seen.add(p.type);
          result.push(...p.steps);
        }
      }
      return result;
    }

    function getPrerequisiteSteps(variantId: string): string[] {
      if (prereqStepsCache.has(variantId)) return prereqStepsCache.get(variantId)!;
      const terminalPhases: Record<string, boolean> = {
        preview_review_flow: true, confirmation_flow: true, confirmation_return_or_cancel_flow: true,
        return_or_cancel_flow: true, delivery_flow: true, generating_in_progress_flow: true,
        visible_warning_flow: true, reference_number_display_flow: true,
      };
      const steps = terminalPhases[variantId] ? buildPrerequisitePhaseSteps() : [];
      prereqStepsCache.set(variantId, steps);
      if (steps.length) console.log(`[functional-chain] scenario variant=${variantId} resolved=${steps.length} deduped phases`);
      return steps;
    }

    // Generate all variants — coverage-driven, not truncated
    const result: any[] = [];

    for (const { id: v, title, branchType, branchId } of allVariantEntries) {
      // Skip variants when entity selection is blocked due to unknown relation
      if ((m as any)?._entitySelectionBlocked && (
        v === "selection_flow" || v === "multi_selection_flow" ||
        v === "preview_review_flow" || v === "confirmation_flow" ||
        v === "confirmation_return_or_cancel_flow" || v === "delivery_flow" ||
        v === "return_or_cancel_flow" || v === "generating_in_progress_flow"
      )) {
        console.log(`[entity-relation] blocked variant=${v} reason=selectable_entity_relation_unknown`);
        continue;
      }

      let steps: string[] = [...pfx];
      let expected = "La operacion se completa correctamente.";

      // Inherit prerequisite phase steps for terminal variants
      const prereqs = getPrerequisiteSteps(v);
      if (prereqs.length) {
        console.log(`[functional-chain] scenario="${title.slice(0,40)}" variant=${v} inherited=${prereqs.length} phases`);
        steps.push(...prereqs);
      }

      switch (v) {
        case "happy_path":
          if (m?.visibleButtons?.length) steps.push(`Clic en "${m.visibleButtons[0]}".`);
          else if (m?.primaryAction) steps.push(`${m.primaryAction} ${feat}.`);
          if (m?.visibleWarnings?.length) steps.push(`Validar que se muestre "${m.visibleWarnings[0]}".`);
          if (m?.confirmationSignals || m?.visibleButtons?.includes("Confirmar")) steps.push('Clic en "Confirmar".');
          steps.push(`Validar que ${feat} se complete correctamente.`);
          expected = `El flujo de ${feat} se completa exitosamente.`;
          break;

        case "selection_flow":
          if (branchType === "multiple") {
            steps.push(buildSelectionStep(m?.selectableEntities?.[0] ?? "elemento", "primer"));
            steps.push(buildSelectionStep(m?.selectableEntities?.[0] ?? "elemento", "segundo"));
            steps.push("Validar que al menos dos elementos esten marcados como seleccionados.");
            expected = `La seleccion multiple de ${entity} para ${feat} se completa correctamente.`;
          } else {
            steps.push(buildSelectionStep(m?.selectableEntities?.[0] ?? "elemento"));
            if (m?.visibleButtons?.includes("Continuar")) steps.push('Clic en "Continuar".');
            steps.push(`Validar que se muestre la confirmacion de seleccion.`);
            expected = `La seleccion de ${entity} para ${feat} se completa correctamente.`;
          }
          break;

        case "multi_selection_flow":
          steps.push(buildSelectionStep(m?.selectableEntities?.[0] ?? "elemento", "primer"));
          steps.push(buildSelectionStep(m?.selectableEntities?.[0] ?? "elemento", "segundo"));
          steps.push("Validar que al menos dos elementos esten marcados como seleccionados.");
          expected = "La seleccion multiple se completa correctamente.";
          break;

        case "required_fields_flow":
          // Exclude fields that belong to later screens (delivery, confirmation)
          const DELIVERY_FIELDS = new Set(["email", "correo", "rnc", "destinatario", "recipient"]);
          const formFields = realFields.filter((f: string) => !DELIVERY_FIELDS.has(f.toLowerCase()));
          if (!formFields.length) {
            console.log(`[scenario-contract] degraded scenario="${title}" reason=no_concrete_fields_for_required_flow`);
            // Keep the scenario but mark as non-executable (documents the requirement)
            steps.push("Completar los campos requeridos.");
            steps.push('Clic en "Continuar".');
            expected = "El sistema muestra las validaciones de campos requeridos.";
          }
          steps.push(buildFieldStep(formFields[0]));
          steps.push('Clic en "Continuar".');
          steps.push(`Validar que el campo ${formFields[0]} se muestre como requerido.`);
          expected = "El sistema muestra las validaciones de campos requeridos.";
          break;

        case "search_flow":
          if (realFields.includes("rnc") || realFields.includes("RNC")) {
            steps.push(buildFieldStep("rnc"));
          } else if (realFields.includes("destinatario")) {
            steps.push(buildFieldStep("destinatario"));
          } else {
            steps.push("Ingresar el termino de busqueda en el campo de busqueda.");
          }
          if (m?.visibleOptions?.length) steps.push(`Validar que se muestre "${m.visibleOptions[0]}".`);
          else steps.push("Validar que al menos un resultado de busqueda sea visible en el listado.");
          if (m?.selectableEntities?.length) steps.push(buildSelectionStep(m.selectableEntities[0]));
          else steps.push("Seleccionar la primera opcion visible del listado.");
          expected = "La busqueda muestra resultados y permite seleccionar.";
          break;

        case "dropdown_selection_flow":
          if (m?.visibleOptions?.length) {
            steps.push(`Validar que se muestre "${m.visibleOptions[0]}".`);
            steps.push(`Clic en "${m.visibleOptions[0]}".`);
          } else {
            steps.push("Validar que la lista de opciones este visible.");
            steps.push("Seleccionar la primera opcion disponible de la lista.");
          }
          if (m?.visibleButtons?.includes("Continuar")) steps.push('Clic en "Continuar".');
          expected = "La seleccion de opcion se completa correctamente.";
          break;

        case "preview_review_flow":
          steps.push('Validar que se muestre "Vista previa".');
          if (m?.visibleWarnings?.length) {
            for (const w of m.visibleWarnings) steps.push(`Validar que se muestre "${w}".`);
          }
          if (m?.visibleButtons?.includes("Volver")) steps.push('Clic en "Volver".');
          else if (m?.visibleButtons?.includes("Confirmar")) steps.push('Clic en "Confirmar".');
          expected = `La vista previa de ${feat} se muestra correctamente.`;
          break;

        case "confirmation_flow":
        case "confirmation_return_or_cancel_flow":
          if (branchType === "confirm") {
            const best = findBestControl((m?.visibleButtons ?? []), "confirm");
            if (!best) { console.log(`[functional-branch] blocked id=${branchId} reason=concrete_branch_target_missing`); continue; }
            if (best.ambiguous) { console.log(`[semantic-action] blocked branch=${branchId} reason=semantic_target_ambiguous`); continue; }
            console.log(`[semantic-action] branch=${branchId} expected=confirm detected=${best.detectedAction} compatible=true score=${best.score.toFixed(2)}`);
            steps.push(`Clic en "${best.label}".`);
            steps.push(`Validar que se muestre la confirmacion de ${feat}.`);
            expected = `La confirmacion de ${feat} se completa correctamente.`;
          } else if (branchType === "cancel") {
            const best = findBestControl((m?.visibleButtons ?? []), "cancel");
            if (!best) { console.log(`[functional-branch] blocked id=${branchId} reason=concrete_branch_target_missing`); continue; }
            if (best.ambiguous) { console.log(`[semantic-action] blocked branch=${branchId} reason=semantic_target_ambiguous`); continue; }
            steps.push(`Clic en "${best.label}".`);
            steps.push(`Validar que ${feat} no se ejecute o que se regrese a la pantalla anterior.`);
            expected = `La cancelacion de ${feat} se completa sin efectos.`;
          } else if (branchType === "return") {
            const best = findBestControl((m?.visibleButtons ?? []), "return");
            if (!best) { console.log(`[functional-branch] blocked id=${branchId} reason=concrete_branch_target_missing`); continue; }
            steps.push(`Clic en "${best.label}".`);
            steps.push("Validar que se regrese a la pantalla anterior correctamente.");
            expected = "El retorno a la pantalla anterior se completa correctamente.";
          } else { continue; }
          break;

        case "return_or_cancel_flow":
          if (m?.visibleButtons?.includes("Cancelar")) steps.push('Clic en "Cancelar".');
          else if (m?.visibleButtons?.includes("Volver")) steps.push('Clic en "Volver".');
          steps.push("Validar que el boton principal de accion no este habilitado o que la pantalla de confirmacion muestre la opcion de cancelar.");
          expected = "La operacion se cancela sin efectos secundarios.";
          break;

        case "delivery_flow":
          if (branchType === "delivery_alternative") {
            let best: { label: string; score: number; ambiguous: boolean } | null = null;
            for (const a of ["deliver", "download", "export"] as CanonicalAction[]) {
              const c = findBestControl((m?.visibleButtons ?? []), a);
              if (c && c.score > (best?.score ?? 0)) best = c;
            }
            if (!best) { console.log(`[functional-branch] blocked id=${branchId} reason=concrete_branch_target_missing`); continue; }
            steps.push(`Validar que se muestre "${best.label}".`);
            steps.push(`Clic en "${best.label}".`);
            steps.push(`Validar que se muestre la confirmacion de ${best.label.toLowerCase()}.`);
            expected = `La accion de ${best.label} se completa correctamente.`;
          } else {
            const best = findBestControl((m?.visibleButtons ?? []), "deliver");
            const btn = best?.label || "Correo";
            steps.push(`Validar que se muestre "${btn}".`);
            steps.push("Seleccionar la primera opcion de entrega visible del listado.");
            expected = `La entrega de ${feat} se completa correctamente.`;
          }
          break;

        case "visible_warning_flow":
          if (m?.visibleWarnings?.length) {
            for (const w of m.visibleWarnings) steps.push(`Validar que se muestre "${w}".`);
          }
          if (m?.visibleButtons?.includes("Continuar")) steps.push('Clic en "Continuar".');
          else if (m?.visibleButtons?.includes("Aceptar")) steps.push('Clic en "Aceptar".');
          expected = "Las restricciones visibles se muestran correctamente.";
          break;

        case "generating_in_progress_flow":
          steps.push('Validar que se muestre "Estamos generando tu estado de cuenta".');
          if (m?.visibleWarnings?.length) steps.push(`Validar que se muestre "${m.visibleWarnings.find((w: string) => w.includes("generando")) ?? m.visibleWarnings[0]}".`);
          steps.push("Validar que se muestre un indicador de progreso o espera.");
          expected = `Se muestra el mensaje de generacion de ${feat}.`;
          break;

        case "period_range_selection_flow":
          steps.push('Seleccionar la opcion de rango de fecha correspondiente.');
          steps.push('Validar que se muestren las opciones de periodo: ultimos 3 meses, ultimos 6 meses, ultimos 12 meses, rango personalizado.');
          if (m?.visibleOptions?.length) steps.push(`Seleccionar la opcion "${m.visibleOptions[0]}".`);
          else steps.push("Seleccionar la primera opcion de periodo visible del listado.");
          if (m?.visibleButtons?.includes("Continuar")) steps.push('Clic en "Continuar".');
          expected = `El periodo para ${feat} se selecciona correctamente.`;
          break;

        case "reference_number_display_flow":
          steps.push("Validar que se muestre un numero unico de referencia en el documento generado.");
          steps.push("Validar que el numero de referencia sea visible y no este vacio.");
          expected = "El numero unico de referencia se muestra correctamente.";
          break;

        default:
          steps.push(`Validar que ${m?.featureName ?? "la operacion"} se complete correctamente.`);
          if (m?.visibleWarnings?.length) steps.push(`Validar que se muestre "${m.visibleWarnings[0]}".`);
          expected = "La operacion se completa correctamente.";
      }

      result.push({
        ...baseFields,
        sourceIssueKey: key,
        title,
        steps,
        preconditions: ["El usuario esta autenticado en la aplicacion.", "La aplicacion esta disponible y accesible."],
        expectedResult: expected,
        _variantId: v,
        _branchId: branchId,
        _branchType: branchType,
        scenarioId: `${key}:${v}:${branchId}`,
      });
    }

    // ── Controlled data scenario: single entity skip list ──
    // Trigger when HU has selectable entities but no multi-select or explicit multi-option signal
    const hasSingleEntity = (m?.selectableEntities?.length ?? 0) > 0 && !m?.multiSelectEntities?.length;
    const entityPlural = toTitleEntityLabel(resolveSelectableEntityLabel());
    if (hasSingleEntity) {
      const entitySingular = toTitleEntityLabel(singularizeEntityLabel(entityPlural));
      const gender = detectEntityGender(entitySingular);
      const article = gender === "f" ? "una" : "un";
      const articleDef = gender === "f" ? "la" : "el";
      result.push({
        ...baseFields,
        sourceIssueKey: key,
        title: `Validar avance automatico cuando el cliente posee ${article} sola ${entitySingular}`,
        steps: [...pfx, `Validar que sin lista intermedia ${articleDef} ${entitySingular} unica sea reconocida como seleccionada.`],
        preconditions: [`El cliente posee exactamente ${article} ${entitySingular}.`, "El sistema debe aplicar controlledData para forzar ese escenario."],
        expectedResult: `El sistema avanza automaticamente sin mostrar listado de ${entityPlural}.`,
        controlledDataRequired: true,
        automationStatus: "requires_controlled_data",
        nonExecutableCriteria: "single_entity_required",
        _variantId: "single_entity_controlled_data",
      });
      console.log(`[scenario-preview] routePendingBuilder controlledDataRequired added reason=single_entity_required entityPlural=${entityPlural} entitySingular=${entitySingular}`);
    }

    return result;
  }

  const scenarios = buildVariantScenarios();

  // ── Functional fingerprint deduplication ──
  const fingerprint = (sc: any): string => {
    const stepsNorm = (sc.steps ?? []).join("|").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    const expNorm = (sc.expectedResult ?? "").toLowerCase();
    return `action:${sc._branchType}|variant:${sc._variantId}|stepsHash:${stepsNorm.slice(0,120)}|expected:${expNorm.slice(0,60)}`;
  };
  const seen = new Map<string, any>();
  const deduped: typeof scenarios = [];
  let dedupRemoved = 0;
  for (const sc of scenarios) {
    const fp = fingerprint(sc);
    const existing = seen.get(fp);
    if (existing) {
      // Keep the one with more concrete targets or more requirement evidence
      const scTargets = (sc.steps ?? []).filter((s: string) => /"[^"]+"/.test(s)).length;
      const exTargets = (existing.steps ?? []).filter((s: string) => /"[^"]+"/.test(s)).length;
      if (scTargets > exTargets) {
        (sc as any)._coveredReqIds = [...new Set([...((existing as any)._coveredReqIds ?? []), ...((sc as any)._coveredReqIds ?? [])])];
        seen.set(fp, sc); deduped[deduped.indexOf(existing)] = sc;
      } else {
        (existing as any)._coveredReqIds = [...new Set([...((existing as any)._coveredReqIds ?? []), ...((sc as any)._coveredReqIds ?? [])])];
      }
      dedupRemoved++;
      console.log(`[scenario-dedupe] removed="${sc.title?.slice(0,40)}" kept="${existing.title?.slice(0,40)}" reason=equivalent_functional_behavior`);
    } else {
      seen.set(fp, sc);
      deduped.push(sc);
    }
  }
  console.log(`[scenario-dedupe] generated=${scenarios.length} removed=${dedupRemoved} retained=${deduped.length}`);
  scenarios.length = 0;
  scenarios.push(...deduped);

  // ── MCP contract
  const MCP_VALID_VERBS = /^(Clic en|Validar que|Seleccionar|Ingresar|Esperar|Confirmar|Volver|Cancelar|Completar)/i;
  const INTERNAL_TOKEN_PATTERNS = /_[a-z]{3,}_|[a-z]+_[a-z]+_(flow|message|display|warning|error|data|field|pipe|event|signal|token|flag)/i;
  let mcpPassed = 0;
  let mcpFailed = 0;
  const contractClean: typeof scenarios = [];
  for (const sc of scenarios) {
    let scFailed = false;
    for (const step of (sc.steps ?? [])) {
      if (!MCP_VALID_VERBS.test(step)) {
        console.log(`[scenario-mcp-contract] invalidStep reason=missing_mcp_verb step="${step.slice(0, 80)}"`);
        mcpFailed++; scFailed = true;
      }
      if (INTERNAL_TOKEN_PATTERNS.test(step)) {
        const match = step.match(INTERNAL_TOKEN_PATTERNS)?.[0] ?? "?";
        console.log(`[scenario-mcp-contract] invalidStep reason=internal_variant_token token="${match}" step="${step.slice(0, 80)}"`);
        mcpFailed++; scFailed = true;
      }
      if (!scFailed) mcpPassed++;
    }
    if (scFailed) {
      console.log(`[scenario-mcp-contract] rejected scenario="${sc.title?.slice(0,60)}" reason=internal_contract_failed`);
    } else {
      contractClean.push(sc);
    }
  }
  console.log(`[scenario-mcp-contract] scenarios=${scenarios.length} contractClean=${contractClean.length} stepsPassed=${mcpPassed} stepsFailed=${mcpFailed}`);

  // ── Coverage tracking: semantic requirement↔scenario matching ──
  const coverageReqs: Array<{
    id: string; sourceText: string; category: string; automatable: boolean; required: boolean;
    coveredBy: Array<{ scenarioId: string; evidenceSteps: number[]; confidence: number }>;
    status: string; reasonCode?: string; optionalityEvidence?: string;
    originalText?: string; normalizedText?: string; action?: string; source?: string; uiEvidence?: string;
    functionalObject?: string | null; functionalObjectSource?: string | null; functionalObjectBacked?: boolean;
  }> = [];
  // Optionality: only mark required=false with explicit evidence
  const isExplicitlyOptional = (t: string): { isOptional: boolean; evidence: string } => {
    const p = [/opcional|cuando\s+aplique|si\s+aplica|si\s+est[aá]\s+disponible|solo\s+informativo|fuera\s+de\s+alcance|optional|when\s+applicable|if\s+available|informational\s+only|out\s+of\s+scope/i];
    for (const r of p) { if (r.test(t)) return { isOptional: true, evidence: t.match(r)?.[0] ?? "" }; }
    return { isOptional: false, evidence: "" };
  };
  let reqIdx = 0;
  const mkReq = (sourceText: string, category: string, source: string, uiEvidence: string, required = true, automatable = true) => {
    const originalText = sourceText;
    const normalizedText = originalText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return {
      id: `R${++reqIdx}`, sourceText, category, automatable, required,
      coveredBy: [], status: "uncovered",
      originalText, normalizedText,
      action: inferFunctionalAction(originalText),
      source, uiEvidence,
      optionalityEvidence: undefined as string | undefined,
    };
  };

  // From huModel fields with source text
  for (const f of (huModel?.requiredFields ?? [])) {
    const ft = String(f);
    if (!["data_entry_fields","data_entry","required_fields","fields","generic_field","recipient","rnc","date","amount","currency","period","reason","motivo"].includes(ft)) {
      coverageReqs.push(mkReq(ft, "input_field", "requiredFields", "requiredFields"));
    }
  }
  for (const e of (huModel?.selectableEntities ?? [])) {
    coverageReqs.push(mkReq(String(e), "selection", "selectableEntities", "selectableEntities"));
  }
  for (const b of (huModel?.visibleButtons ?? [])) {
    coverageReqs.push(mkReq(String(b), "button", "visibleButtons", "visibleButtons"));
  }
  for (const w of (huModel?.visibleWarnings ?? [])) {
    coverageReqs.push(mkReq(String(w).slice(0, 60), "warning", "visibleWarnings", "visibleWarnings"));
  }
  for (const obl of (huModel?.uiObligations ?? [])) {
    // Filter internal tags — only create requirements for concrete UI obligations, not structural hints
    const internalTags = /_screen$|_field$|_selection$|_button$|_flow$|_message$|_data$|_warning$/i;
    if (!internalTags.test(String(obl))) {
      coverageReqs.push(mkReq(String(obl), "obligation", "uiObligations", "uiObligations"));
    }
  }

  // Parse textual acceptance criteria into requirements
  const acText = issue?.acceptanceCriteria ?? "";
  if (acText) {
    const lines = acText.split(/[\n\r]+/).filter((l: string) => l.trim().length > 10);
    for (const line of lines) {
      const cleaned = line.replace(/^[\d.\-•\s]+/, "").trim();
      if (cleaned.length > 10 && !/^(?:criterio|requisito|escenario|dado|cuando|entonces)/i.test(cleaned)) {
        const cat = /validar|mostrar|visualizar|seleccionar|ingresar/i.test(cleaned) ? "ui_validation" : "acceptance_criteria";
        const opt = isExplicitlyOptional(cleaned);
        const req = mkReq(cleaned.slice(0, 100), cat, "acceptanceCriteria", "acceptanceCriteria", !opt.isOptional, /validar|mostrar|seleccionar|click|ingresar/i.test(cleaned));
        req.optionalityEvidence = opt.evidence || undefined;
        coverageReqs.push(req);
      }
    }
  }

  // Semantic matching function
  function matchRequirement(req: typeof coverageReqs[0], sc: any): { matched: boolean; evidenceSteps: number[]; confidence: number } {
    const steps = (sc.steps ?? []).map((s: string) => s.toLowerCase());
    const expected = (sc.expectedResult ?? "").toLowerCase();
    const allText = [...steps, expected].join(" ");
    const reqText = req.sourceText.toLowerCase();
    const evidenceSteps: number[] = [];
    let confidence = 0;

    if (req.category === "input_field" || req.category === "button") {
      // Match if any step contains the req source text
      for (let i = 0; i < steps.length; i++) {
        if (steps[i].includes(reqText) || steps[i].includes(reqText.replace(/_/g, " "))) {
          evidenceSteps.push(i); confidence = 0.8;
        }
      }
    } else if (req.category === "selection") {
      if (allText.includes("seleccionar") && (allText.includes(reqText) || allText.includes(reqText.replace(/_/g, " ")))) {
        evidenceSteps.push(0); confidence = 0.7;
      }
    } else if (req.category === "warning") {
      if (allText.includes("validar") && (allText.includes(reqText) || expected.includes(reqText))) {
        evidenceSteps.push(steps.length); confidence = 0.85;
      }
    } else if (req.category === "obligation") {
      const oblTerms = reqText.split(/[\s_]+/).filter((t: string) => t.length > 3);
      const matchedTerms = oblTerms.filter((t: string) => allText.includes(t));
      if (matchedTerms.length >= 2) { confidence = 0.6 + matchedTerms.length * 0.1; evidenceSteps.push(0); }
    }

    return { matched: confidence >= 0.6, evidenceSteps, confidence };
  }

  // Match all requirements against all scenarios
  for (const req of coverageReqs) {
    for (const sc of scenarios) {
      const { matched, evidenceSteps, confidence } = matchRequirement(req, sc);
      if (matched && !req.coveredBy.some(c => c.scenarioId === (sc._variantId || sc.title))) {
        req.coveredBy.push({ scenarioId: (sc._variantId ?? sc.title ?? "?"), evidenceSteps, confidence });
        req.status = "covered";
        console.log(`[coverage-match] requirement=${req.id} scenario=${req.coveredBy[req.coveredBy.length-1].scenarioId} category=${req.category} evidenceSteps=[${evidenceSteps.join(",")}] confidence=${confidence.toFixed(2)}`);
      }
    }
    if (req.status === "uncovered" && req.automatable) {
      console.log(`[coverage] requirement=${req.id} category=${req.category} source="${req.sourceText}" status=uncovered reason=no_matching_scenario`);
    }
  }

  const covered = coverageReqs.filter(r => r.status === "covered").length;
  const uncovered = coverageReqs.filter(r => r.status === "uncovered" && r.automatable).length;
  const blockedCov = coverageReqs.filter(r => r.status !== "covered" && !r.automatable).length;
  console.log(`[coverage] total=${coverageReqs.length} automatable=${coverageReqs.filter(r=>r.automatable).length} covered=${covered} uncovered=${uncovered} blocked=${blockedCov}`);

  // ── Reactive gap-closing: extend or generate scenarios for uncovered automatable requirements ──
  // ── Reactive gap-closing: semantic grouping + concrete targets ──
  const entityTerm = (huModel?.businessEntity as any)?.singularLabel
    ?? toTitleEntityLabel(resolveSelectableEntityLabel())
    ?? "elemento";

  const MAX_REPAIR_ITERATIONS = 2;
  for (let iter = 1; iter <= MAX_REPAIR_ITERATIONS; iter++) {
    // Helper for input field target extraction
  function compatibleInputTargets(): Array<{ value: string; source: string; compatible: boolean }> {
    const results: Array<{ value: string; source: string; compatible: boolean }> = [];
    for (const f of ((huModel?.requiredFields ?? []) as string[])) {
      if (!["data_entry_fields","data_entry","recipient","rnc","date","amount","currency","period","reason","motivo"].includes(f)) {
        results.push({ value: f, source: "requiredFields", compatible: true });
      }
    }
    return results;
  }

  const uncoveredReqs = coverageReqs.filter(r => r.automatable && r.status === "uncovered");
    if (uncoveredReqs.length === 0) break;

    // Semantic grouping: isolate requirements without object, classify action precisely
    const gapGroups: Map<string, { reqs: typeof uncoveredReqs; action: string; object: string }> = new Map();
    for (const r of uncoveredReqs) {
      // Precise action taxonomy — no "validar" fallback
      const action = inferFunctionalAction(r.sourceText);
      // Resolve the functional object BEFORE deciding there is none: original requirement,
      // huModel fields/buttons/selectables/warnings and requirement noun phrase are all backed sources.
      const resolved = resolveFunctionalObject(
        { id: r.id, sourceText: r.sourceText, originalText: (r as any).originalText ?? r.sourceText, action, category: r.category },
        { huModel, entityTerm, featureName },
      );
      const object = resolved.object ?? "";
      const objectSource = resolved.source;
      const backed = resolved.backed;
      (r as any).functionalObject = object || null;
      (r as any).functionalObjectSource = objectSource;
      (r as any).functionalObjectBacked = backed;
      if (object) {
        console.log(`[functional-object] requirement=${r.id} object="${object}" source=${objectSource} backed=${backed}`);
      } else {
        console.log(`[coverage-gap] isolated requirement=${r.id} reason=missing_object action=${action}`);
      }
      const key = object ? `${r.category}:${action}:${object}` : `${r.category}:${action}:isolated:${r.id}`;
      if (!gapGroups.has(key)) gapGroups.set(key, { reqs: [], action, object });
      gapGroups.get(key)!.reqs.push(r);
    }

    console.log(`[coverage-repair] iteration=${iter} gaps=${uncoveredReqs.length} groups=${gapGroups.size}`);

    for (const [key, group] of gapGroups) {
      const { reqs, action, object } = group;

      // Block requirements with unknown action and no object
      if (action === "unknown" && !object) {
        for (const r of reqs) {
          r.status = "blocked";
          (r as any).reasonCode = "requirement_semantics_incomplete";
        }
        console.log(`[coverage-gap] blocked group=${key} reason=requirement_semantics_incomplete`);
        continue;
      }

      // Get targets by category compatibility (not mixed)
      const targets: Array<{ value: string; source: string; compatible: boolean }> = [];
      for (const r of reqs) {
        if (r.category === "input_field" || r.category === "acceptance_criteria") {
          for (const f of ((huModel?.requiredFields ?? []) as string[])) {
            if (!["data_entry_fields","data_entry","recipient","rnc"].includes(f) && classifySemanticObject(f).valid) {
              targets.push({ value: f, source: "requiredFields", compatible: action === "fill" || action === "validate" });
            }
          }
        } else if (r.category === "selection") {
          for (const e of (huModel?.selectableEntities ?? [])) {
            const label = toSelectionEntity(String(e));
            if (label && label !== "producto" && label !== "elemento") {
              targets.push({ value: label, source: "selectableEntities", compatible: action === "select" || action === "validate" });
            }
          }
        } else if (r.category === "button") {
          for (const b of (huModel?.visibleButtons ?? [])) {
            if (typeof b === "string" && b.length > 2 && b.length < 50) {
              targets.push({ value: b, source: "visibleButtons", compatible: action === "submit" || action === "confirm" || action === "cancel" || action === "return" || action === "validate" });
            }
          }
        } else if (r.category === "warning" || r.category === "obligation" || r.category === "ui_validation") {
          // Resolve targets by action, not just visibleWarnings
          if (action === "validate") {
            for (const w of (huModel?.visibleWarnings ?? [])) {
              if (typeof w === "string" && w.length > 3 && w.length < 80 && classifySemanticObject(w).valid)
                targets.push({ value: w, source: "visibleWarnings", compatible: true });
            }
            for (const b of (huModel?.visibleButtons ?? [])) {
              if (typeof b === "string" && b.length > 2 && b.length < 50)
                targets.push({ value: b, source: "visibleButtons", compatible: true });
            }
          } else if (action === "select") {
            for (const e of (huModel?.selectableEntities ?? [])) {
              const label = toSelectionEntity(String(e));
              if (label && label !== "producto" && label !== "elemento")
                targets.push({ value: label, source: "selectableEntities", compatible: true });
            }
          } else if (action === "fill") {
            targets.push(...compatibleInputTargets());
          } else if (action === "generate" || action === "download" || action === "export") {
            for (const b of (huModel?.visibleButtons ?? [])) {
              if (typeof b === "string" && b.length > 2 && b.length < 50)
                targets.push({ value: b, source: "visibleButtons", compatible: true });
            }
          }
        }
      }

      // Filter for compatible targets only
      const compatibleTargets = targets.filter(t => t.compatible);
      for (const t of targets.filter(t => !t.compatible)) {
        console.log(`[coverage-target] requirement=${reqs[0]?.id} target="${t.value}" source=${t.source} compatible=false`);
      }

      if (compatibleTargets.length === 0 && action !== "validate" && action !== "unknown") {
        for (const r of reqs) {
          r.status = "blocked";
          (r as any).reasonCode = "no_compatible_target";
        }
        console.log(`[coverage-gap] blocked group=${key} reason=no_compatible_target`);
        continue;
      }

      // Build title: only from action + a validated business object, no foreign concepts
      const objectCandidates = [object, compatibleTargets[0]?.value].filter(
        (x): x is string => !!x && classifySemanticObject(x).valid,
      );
      const titleTarget = objectCandidates[0] ?? "";
      if (!titleTarget) {
        for (const r of reqs) {
          r.status = "blocked";
          (r as any).reasonCode = "invalid_functional_object";
        }
        console.log(`[coverage-gap] blocked group=${key} reason=invalid_functional_object object="${object || compatibleTargets[0]?.value || ""}"`);
        continue;
      }
      const huTokens = new Set([...(huModel?.selectableEntities ?? []).map((e: any) => toSelectionEntity(String(e))),
        ...((huModel?.visibleButtons ?? []) as string[]).slice(0, 5),
        entityTerm, object].map((s: string) => s.toLowerCase()));
      const title = action === "validate" ? `Validar ${titleTarget}` :
                    action === "select" ? `Seleccionar ${titleTarget}` :
                    action === "fill" ? `Completar ${titleTarget}` :
                    action === "confirm" ? `Confirmar ${titleTarget}` :
                    action === "submit" ? `Enviar ${titleTarget}` :
                    action === "cancel" ? `Cancelar ${titleTarget}` :
                    action === "return" ? `Volver de ${titleTarget}` :
                    action === "generate" ? `Generar ${titleTarget}` :
                    action === "download" ? `Descargar ${titleTarget}` :
                    action === "export" ? `Exportar ${titleTarget}` :
                    action === "search" ? `Buscar ${titleTarget}` :
                    action === "navigate" ? `Navegar a ${titleTarget}` :
                    `Validar ${titleTarget}`;

      // Prevent incoherent titles: action must match target semantic type
      const isButtonAction = ["submit","confirm","cancel","return","generate","download","export"].includes(action);
      const isButtonTarget = compatibleTargets.some(t => t.semanticType === "button");
      if (isButtonAction && compatibleTargets.length > 0 && !isButtonTarget) {
        console.log(`[coverage-title] rejected group=${key} reason=action_target_incoherent action=${action} targetTypes=${compatibleTargets.map(t=>t.semanticType).join(",")}`);
        continue;
      }

      // Foreign concept guard: skip operational/structural words
      const OPERATIONAL_WORDS = new Set(["proceso", "opcion", "resultado", "pantalla", "elemento", "correctamente",
        "seleccion", "validacion", "confirmacion", "detalle", "listado", "operacion", "funcion", "accion", "estado",
        "completado", "visible", "habilitado", "deshabilitado", "correcto", "requerido", "obligatorio",
        // MCP operational verbs — not business concepts
        "validar", "seleccionar", "completar", "ingresar", "confirmar", "cancelar", "volver", "generar",
        "descargar", "exportar", "buscar", "mostrar", "visualizar", "continuar", "siguiente", "enviar"]);
      const reqTokens = new Set(reqs.flatMap(r => r.sourceText.toLowerCase().split(/[\s,.;:]+/).filter(w => w.length > 3)));
      const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const foreignWords = titleWords.filter(w =>
        !reqTokens.has(w) && !huTokens.has(w) && w !== entityTerm.toLowerCase() && !OPERATIONAL_WORDS.has(w)
      );
      if (foreignWords.length > 0) {
        console.log(`[coverage-title] rejected group=${key} reason=foreign_business_concept terms="${foreignWords.join(",")}"`);
        continue;
      }

      // Build steps: action + compatible target
      const gapSteps: string[] = [];
      if (action === "select" && huModel?.selectableEntities?.length) {
        gapSteps.push(buildSelectionStep(huModel.selectableEntities[0]));
      } else if (action === "fill" && compatibleTargets.length) {
        gapSteps.push(`Completar el campo ${compatibleTargets[0].value}.`);
      } else if (compatibleTargets.length) {
        gapSteps.push(`Validar que se muestre "${compatibleTargets[0].value}".`);
      } else {
        gapSteps.push(`Validar ${object || entityTerm}.`);
      }

      const navPrefix = (candidatePrefixSteps ?? []).map((t: string) => `Clic en "${t}".`);
      const newSc: any = {
        sourceIssueKey: key,
        title,
        steps: [...navPrefix, ...gapSteps],
        expectedResult: `${title.replace(/^\w/, c => c.toUpperCase())} completado correctamente.`,
        preconditions: ["El usuario esta autenticado en la aplicacion."],
        _variantId: `gap_${iter}_${gapGroups.size}`,
        _coveredReqIds: reqs.map(r => r.id),
        type: "functional", database: "", isConverted: 0,
        automationType: "ui_discovery", setupStrategy: "no_login",
        appSlug: appSlug ?? "unknown", targetAppSlug: appSlug ?? "unknown",
        mcpExecutable: false, nonExecutableCriteria: "requires_route_discovery",
        generationSource: "coverage_gap" as const,
      };
      scenarios.push(newSc);
      console.log(`[coverage-gap] group=${key} action=${action} object="${object}" requirements=${reqs.map(r=>r.id).join(",")} strategy=generate_scenario title="${title}"`);
    }

    // Independent verification: reset and re-match from scratch
    for (const req of uncoveredReqs) req.status = "uncovered";
    for (const req of coverageReqs.filter(r => r.automatable)) {
      for (const sc of scenarios) {
        const { matched, evidenceSteps, confidence } = matchRequirement(req, sc);
        // Guard: prevent self-referential matches from gap scenarios
        const isGapScenario = (sc as any)._variantId?.startsWith("gap_");
        if (matched && evidenceSteps.length > 0 && confidence >= 0.6 && !(isGapScenario && confidence < 0.9)) {
          req.coveredBy.push({ scenarioId: (sc._variantId ?? sc.title ?? "?"), evidenceSteps, confidence });
          req.status = "covered";
        } else if (matched && evidenceSteps.length === 0) {
          console.log(`[coverage-match] rejected requirement=${req.id} scenario=${(sc as any)._variantId ?? "?"} reason=self_referential_text_only`);
        }
      }
    }

    const newUncovered = coverageReqs.filter(r => r.automatable && r.status === "uncovered").length;
    console.log(`[coverage-repair] iteration=${iter} uncoveredBefore=${uncoveredReqs.length} uncoveredAfter=${newUncovered}`);
    if (newUncovered === uncoveredReqs.length) break;
  }

  const finalCovered = coverageReqs.filter(r => r.status === "covered").length;
  const finalUncovered = coverageReqs.filter(r => r.automatable && r.status === "uncovered").length;
  if (finalUncovered > 0) {
    console.log(`[coverage] incomplete=true uncovered=${coverageReqs.filter(r => r.automatable && r.status === "uncovered").map(r => r.id).join(",")}`);
  }

  // ── Coverage reconciliation ──
  const coveredCount = coverageReqs.filter(r => r.status === "covered").length;
  const uncoveredCount = coverageReqs.filter(r => r.status === "uncovered" && r.automatable).length;
  const blockedCount = coverageReqs.filter(r => r.status === "blocked").length;
  const nonAutomatableCount = coverageReqs.filter(r => !r.automatable).length;
  const requiredBlockedC = coverageReqs.filter(r => r.required && r.status === "blocked").length;
  const requiredUncoveredC = coverageReqs.filter(r => r.required && r.status === "uncovered").length;
  console.log(`[coverage] total=${coverageReqs.length} covered=${coveredCount} uncovered=${uncoveredCount} blocked=${blockedCount} nonAutomatable=${nonAutomatableCount}`);
  console.log(`[coverage] required=${coverageReqs.filter(r=>r.required).length} requiredBlocked=${requiredBlockedC} requiredUncovered=${requiredUncoveredC}`);

  // Normalize: non-automatable must have explicit status
  for (const r of coverageReqs) {
    if (!r.automatable && r.status === "uncovered") r.status = "non_automatable";
  }
  (globalThis as any).__coverageReqs = coverageReqs;

  // Override: use only contract-clean scenarios
  scenarios.length = 0;
  scenarios.push(...contractClean);

  // ── Functional chain validator with anyOf alternatives ──
  function classifyStepType(step: string): string {
    if (/^Clic en/i.test(step)) {
      if (/continuar|confirmar|generar|enviar|solicitar|guardar/i.test(step)) return "submit";
      if (/cancelar|volver|cerrar|salir/i.test(step)) return "cancel";
      if (/seleccionar|primer[oa]?|segund[oa]?/i.test(step)) return "selection";
      return "navigation";
    }
    if (/^Completar|^Ingresar|^Llenar/i.test(step)) return "fill";
    if (/^Validar que.*(?:vista previa|preview|revisar|revisi[oó]n)/i.test(step)) return "preview";
    if (/^Validar que.*(?:confirmacion|confirmar|resumen)/i.test(step)) return "confirmation";
    if (/^Validar que.*(?:correo|email|envio|entreg|notificacion|enviar)/i.test(step)) return "delivery";
    if (/^Validar que/i.test(step)) return "assertion";
    return "unknown";
  }

  function buildFunctionalChain(steps: string[]): string[] {
    const chain: string[] = [];
    for (const s of steps) {
      const type = classifyStepType(s);
      if (type !== "unknown" && (chain.length === 0 || chain[chain.length - 1] !== type)) {
        chain.push(type);
      }
    }
    return chain;
  }

  function chainMatches(actual: string[], pattern: string[]): boolean {
    let pi = 0;
    for (const t of actual) { if (pi < pattern.length && t === pattern[pi]) pi++; }
    return pi === pattern.length;
  }

  // Determine if submit is required based on HU signals
  const hasAdvanceAction = (huModel?.visibleButtons ?? []).some((b: string) => /continuar|confirmar|generar|enviar/i.test(b));
  // realFields: filter internal IDs from requiredFields (same logic as inside buildVariantScenarios)
  const topLevelRealFields = ((huModel?.requiredFields ?? []) as string[]).filter(
    (f: string) => !["data_entry_fields","data_entry","required_fields","fields","generic_field","recipient","sender","receiver","destination","source_field","target_field","rnc","r_n_c","date","amount","currency","period","reason","motivo"].includes(f.toLowerCase())
  );
  const hasFields = topLevelRealFields.length > 0;
  const submitRequired = hasFields || hasAdvanceAction;
  if (submitRequired) {
    console.log(`[scenario-contract] submitRequired=true reason=${hasFields ? "required_fields" : "advance_action"}`);
  }

  // Alternative chain patterns per variant
  const CHAIN_REQUIREMENTS: Record<string, string[][]> = {
    preview_review_flow: submitRequired
      ? [["navigation","selection","submit"], ["navigation","fill","submit"], ["navigation","selection","fill","submit"]]
      : [["navigation","selection"], ["navigation","fill"]],
    delivery_flow: submitRequired
      ? [["navigation","selection","submit"], ["navigation","fill","submit"], ["navigation","preview","submit"], ["navigation","confirmation","submit"]]
      : [["navigation","selection"], ["navigation","preview"], ["navigation","confirmation"]],
    confirmation_flow: submitRequired
      ? [["navigation","selection","submit"], ["navigation","fill","submit"]]
      : [["navigation","selection"], ["navigation","fill"], ["navigation","preview"]],
    confirmation_return_or_cancel_flow: submitRequired
      ? [["navigation","selection","submit"], ["navigation","fill","submit"], ["navigation","preview"]]
      : [["navigation","selection"], ["navigation","preview"], ["navigation","confirmation"]],
    return_or_cancel_flow: [["navigation"]],
    generating_in_progress_flow: [["navigation","selection"], ["navigation","fill"]],
  };

  for (const sc of scenarios) {
    const variantId = sc._variantId as string | undefined;
    const altChains = variantId ? CHAIN_REQUIREMENTS[variantId] : undefined;
    if (altChains) {
      const chain = buildFunctionalChain(sc.steps ?? []);
      const chainStr = chain.join(">");
      const matched = altChains.some(pattern => chainMatches(chain, pattern));
      if (!matched) {
        const patterns = altChains.map(p => p.join(">")).join(" | ");
        console.log(`[scenario-contract] downgraded scenario="${sc.title?.slice(0,60)}" reason=missing_functional_chain requiredAnyOf="${patterns}" actual="${chainStr}"`);
        sc.mcpExecutable = false;
        sc.nonExecutableCriteria = "functional_prerequisite_missing";
        sc.automationStatus = "blocked";
        (sc as any)._blockedReason = `Cadena funcional incompleta: se requiere ${patterns}, actual ${chainStr}`;
        (sc as any)._blockedChain = chainStr;
        (sc as any)._requiredChain = patterns;
      } else {
        console.log(`[scenario-contract] chain scenario="${sc.title?.slice(0,40)}" variant=${variantId} actual=${chainStr} valid=true`);
      }
    }
  }

  // ── Unified title contract — shared with generateRoutePendingScenarios ──
  let titlePassed = 0;
  let titleFixed = 0;
  let titleFailed = 0;
  const titleClean: typeof scenarios = [];
  const titleFallback = (huModel?.businessEntity as any)?.singularLabel || resolveSelectableEntityLabel();
  const titleContext: ObjectResolutionContext = {
    huModel,
    entityTerm: titleFallback,
    featureName: huModel?.featureName,
  };

  for (const sc of scenarios) {
    const result = validateAndRepairScenarioTitle(sc.title ?? "", titleFallback, titleContext);
    if (result.rejected) {
      console.log(`[scenario-title-contract] rejected reason=unrepairable_title title="${sc.title?.slice(0,80)}"`);
      titleFailed++;
      continue;
    }
    if (result.repaired) {
      console.log(`[scenario-title-contract] repaired reason=title_contract_violation old="${sc.title?.slice(0,60)}" new="${result.title.slice(0,60)}" object="${result.object ?? ""}" objectSource=${result.objectSource ?? "none"}`);
      titleFixed++;
    } else {
      console.log(`[scenario-title-contract] valid title="${result.title.slice(0,60)}" object="${result.object ?? ""}" objectSource=${result.objectSource ?? "none"}`);
      titlePassed++;
    }
    titleClean.push({ ...sc, title: result.title });
  }

  console.log(`[scenario-title-contract] source=final-visible scenarios=${scenarios.length} titlesPassed=${titlePassed} titlesFixed=${titleFixed} titlesFailed=${titleFailed}`);

  scenarios.length = 0;
  scenarios.push(...titleClean);

  console.log(`[scenario-preview] routePendingBuilder planBased=true target=${scenarioPlan?.scenarioCountTarget ?? "?"} variants=${scenarioPlan?.variants?.length ?? "?"}`);
  console.log(`[scenario-preview] routePendingBuilder generated=${titleClean.length} quality=plan_based_route_pending automationStatus=requires_route_discovery`);
  return titleClean;
}
}
