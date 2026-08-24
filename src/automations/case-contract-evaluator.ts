import { classifyScenarioAutomatability } from "../scenarios/scenario-automatability-classifier";
import type { McpScenario } from "../scenarios/scenario-types";
import { toVirtualCase, type VirtualCase } from "../types/scenario-preview.types";
import type { RawTestRailCase, TestScenario } from "../types/testrail.types";

export type CaseContractGapType =
  | "missing_target"
  | "missing_locator"
  | "missing_transition"
  | "missing_route_evidence"
  | "missing_test_data"
  | "manual_step"
  | "non_ui_step";

export type CaseContractRouteRecommendation =
  | "automation_from_case_contract"
  | "targeted_discovery"
  | "full_discovery"
  | "blocked";

export type CaseContractGap = {
  type: CaseContractGapType;
  stepNumber?: number;
  target?: string;
};

export type CaseContractSufficiencyResult = {
  sufficient: boolean;
  gaps: CaseContractGap[];
  recommendedRoute: CaseContractRouteRecommendation;
  reasonCode: string;
};

export type CaseContractMetadata = {
  routeProfileName?: string;
  navigationPrefix?: string;
  routeEvidence?: string;
  dataRequirements?: string;
};

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringField(rawCase: RawTestRailCase, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = rawCase[key];
    if (typeof value !== "string") continue;
    const normalized = nonEmpty(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeStepText(value: string): string {
  return value.replace(/^\d+[\.)]\s*/, "").trim();
}

function ensureTerminalDot(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function buildExecutableSteps(scenario: TestScenario): string[] {
  const executable: string[] = [];
  for (const step of scenario.steps) {
    const action = normalizeStepText(step.action);
    if (!action) continue;
    const expected = nonEmpty(step.expected);
    if (!expected) {
      executable.push(action);
      continue;
    }
    if (/^(validar|verificar|comprobar|esperar|assert)\b/i.test(action)) {
      executable.push(action);
      continue;
    }
    executable.push(`${ensureTerminalDot(action)} Validar que ${expected}.`);
  }
  return executable;
}

function buildExpectedResult(scenario: TestScenario): string {
  const fromRaw = nonEmpty((scenario.raw?.custom_expected as string | undefined));
  if (fromRaw) return fromRaw;
  const fromSteps = scenario.steps
    .map((step) => nonEmpty(step.expected))
    .filter((value): value is string => Boolean(value));
  if (fromSteps.length > 0) {
    return fromSteps.join(" | ");
  }
  return "Completar el flujo funcional sin errores.";
}

function buildDataRequirements(scenario: TestScenario, metadata: CaseContractMetadata): string {
  const hints = new Set<string>();
  const fromMetadata = nonEmpty(metadata.dataRequirements);
  if (fromMetadata) hints.add(fromMetadata);
  for (const step of scenario.steps) {
    for (const hint of step.dataHints ?? []) {
      const normalized = nonEmpty(hint);
      if (normalized) hints.add(normalized);
    }
  }
  return Array.from(hints).join(", ");
}

export function extractCaseContractMetadata(rawCase: RawTestRailCase): CaseContractMetadata {
  return {
    routeProfileName: readStringField(rawCase, [
      "custom_route_profile",
      "custom_route_profile_name",
      "routeProfile",
      "route_profile",
    ]),
    navigationPrefix: readStringField(rawCase, [
      "custom_navigation_prefix",
      "navigationPrefix",
      "navigation_prefix",
    ]),
    routeEvidence: readStringField(rawCase, [
      "custom_route_evidence",
      "routeEvidence",
      "route_evidence",
      "custom_cache_key",
      "custom_source",
    ]),
    dataRequirements: readStringField(rawCase, [
      "custom_data_requirements",
      "dataRequirements",
      "data_requirements",
    ]),
  };
}

export function buildMcpScenarioContractFromTestRailCase(input: {
  scenario: TestScenario;
  appSlug: string;
  metadata: CaseContractMetadata;
}): McpScenario {
  const sourceIssueKey = `TR-C${input.scenario.caseId}`;
  return {
    sourceIssueKey,
    scenarioId: sourceIssueKey,
    caseId: input.scenario.caseId,
    title: input.scenario.title,
    steps: buildExecutableSteps(input.scenario),
    preconditions: nonEmpty(input.scenario.preconditions)
      ? [input.scenario.preconditions as string]
      : [],
    expectedResult: buildExpectedResult(input.scenario),
    caseOracle: typeof input.scenario.raw?.custom_case_oracle === "string"
      ? input.scenario.raw.custom_case_oracle
      : undefined,
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug: input.appSlug,
    targetAppSlug: input.appSlug,
    routeProfile: input.metadata.routeProfileName ?? "",
    dataRequirements: buildDataRequirements(input.scenario, input.metadata),
    nonExecutableCriteria: "",
    mcpExecutable: true,
  };
}

export function buildVirtualCaseFromContract(input: {
  scenario: McpScenario;
  index: number;
  sectionSlug?: string;
  sectionName?: string;
  sectionId?: string | number;
  testRailCaseId?: number;
  metadata?: CaseContractMetadata;
}): VirtualCase {
  const vc = toVirtualCase(
    input.scenario,
    input.index,
    input.sectionSlug,
    input.sectionName,
    input.sectionId,
  );
  if (typeof input.testRailCaseId === "number" && Number.isInteger(input.testRailCaseId) && input.testRailCaseId > 0) {
    vc.testRailCaseId = input.testRailCaseId;
  }
  const navigationPrefix = nonEmpty(input.metadata?.navigationPrefix);
  if (navigationPrefix) {
    vc.navigationPrefix = navigationPrefix;
  }
  const routeEvidence = nonEmpty(input.metadata?.routeEvidence);
  if (routeEvidence) {
    vc.routeEvidence = routeEvidence;
  }
  return vc;
}

function extractTarget(step: string): string | undefined {
  const quoted = step.match(/"([^"]+)"/);
  if (quoted?.[1]) return quoted[1].trim();
  const prefixed = step.match(
    /(?:clic en|seleccionar|presionar|tap en|ingresar en|completar en|navegar a|ir a)\s+([^.,;]+)/i,
  );
  return prefixed?.[1]?.trim();
}

function isOperationalStep(step: string): boolean {
  return /^(?:\d+[\.)]\s*)?(clic en|seleccionar|presionar|tap en|ingresar|completar|escribir|digitar|navegar|ir a|validar|verificar|comprobar|esperar)\b/i.test(step);
}

function isNavigationStep(step: string): boolean {
  return /^(?:\d+[\.)]\s*)?(clic en|seleccionar|presionar|tap en|navegar|ir a)\b/i.test(step);
}

function isAssertionStep(step: string): boolean {
  return /^(?:\d+[\.)]\s*)?(validar|verificar|comprobar|esperar)\b/i.test(step);
}

function isDataInputStep(step: string): boolean {
  return /^(?:\d+[\.)]\s*)?(ingresar|completar|escribir|digitar|introducir)\b/i.test(step);
}

function isGenericTarget(target: string): boolean {
  return /^(boton|bot[oó]n|opcion|opci[oó]n|campo|elemento|item|seccion|secci[oó]n|pantalla|modulo|m[oó]dulo)$/i.test(target.trim());
}

function dedupeGaps(gaps: CaseContractGap[]): CaseContractGap[] {
  const seen = new Set<string>();
  const unique: CaseContractGap[] = [];
  for (const gap of gaps) {
    const key = `${gap.type}|${gap.stepNumber ?? 0}|${gap.target ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(gap);
  }
  return unique;
}

export function evaluateCaseContractSufficiency(input: {
  scenario: McpScenario;
  appSlug?: string;
  sectionSlug?: string;
  metadata: CaseContractMetadata;
  hasRouteProfileConfig: boolean;
}): CaseContractSufficiencyResult {
  const gaps: CaseContractGap[] = [];
  const steps = (input.scenario.steps ?? []).map(normalizeStepText).filter(Boolean);
  const hasRouteEvidence = Boolean(
    nonEmpty(input.metadata.routeProfileName)
    || nonEmpty(input.metadata.navigationPrefix)
    || nonEmpty(input.metadata.routeEvidence)
    || input.hasRouteProfileConfig,
  );

  if (!nonEmpty(input.appSlug) || !nonEmpty(input.sectionSlug)) {
    gaps.push({ type: "missing_route_evidence" });
  }
  if (!hasRouteEvidence) {
    gaps.push({ type: "missing_route_evidence" });
  }
  if (steps.length === 0) {
    gaps.push({ type: "missing_transition" });
  }

  let operationalCount = 0;
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (!isOperationalStep(step)) continue;
    operationalCount += 1;
    const target = extractTarget(step);
    if (!target) {
      gaps.push({ type: "missing_target", stepNumber: index + 1 });
      continue;
    }
    if (isGenericTarget(target)) {
      gaps.push({ type: "missing_locator", stepNumber: index + 1, target });
    }
  }

  if (operationalCount === 0) {
    gaps.push({ type: "missing_transition" });
  }

  const hasTransitionEvidence = steps.some(isNavigationStep)
    && (steps.some(isAssertionStep) || Boolean(nonEmpty(input.scenario.expectedResult)));
  if (!hasTransitionEvidence) {
    gaps.push({ type: "missing_transition" });
  }

  const requiresInputData = steps.some(isDataInputStep);
  const hasDataRequirements = Boolean(nonEmpty(input.scenario.dataRequirements))
    || (input.scenario.preconditions ?? []).some((entry) =>
      /\b(usuario|cliente|cuenta|identificacion|identificaci[oó]n|otp|pin|token|clave|password|dato)\b/i.test(entry),
    );
  if (requiresInputData && !hasDataRequirements) {
    gaps.push({ type: "missing_test_data" });
  }

  const automatability = classifyScenarioAutomatability(input.scenario);
  if (!automatability.isAutomatable) {
    const gapType: CaseContractGapType = automatability.classification === "non_automatable_manual"
      ? "manual_step"
      : "non_ui_step";
    gaps.push({ type: gapType });
  }

  const uniqueGaps = dedupeGaps(gaps);
  const gapTypes = new Set(uniqueGaps.map((gap) => gap.type));

  if (gapTypes.has("manual_step") || gapTypes.has("non_ui_step")) {
    return {
      sufficient: false,
      gaps: uniqueGaps,
      recommendedRoute: "blocked",
      reasonCode: automatability.reasonCode ?? "non_automatable_contract",
    };
  }

  if (gapTypes.has("missing_test_data")) {
    return {
      sufficient: false,
      gaps: uniqueGaps,
      recommendedRoute: "blocked",
      reasonCode: "missing_test_data",
    };
  }

  if (uniqueGaps.length === 0) {
    return {
      sufficient: true,
      gaps: uniqueGaps,
      recommendedRoute: "automation_from_case_contract",
      reasonCode: "contract_sufficient",
    };
  }

  const targetedGapTypes = new Set<CaseContractGapType>([
    "missing_target",
    "missing_locator",
    "missing_transition",
  ]);
  const hasOnlyTargetedGaps = uniqueGaps.every((gap) => targetedGapTypes.has(gap.type));
  if (hasOnlyTargetedGaps && hasRouteEvidence) {
    return {
      sufficient: false,
      gaps: uniqueGaps,
      recommendedRoute: "targeted_discovery",
      reasonCode: "targeted_gap_resolution_required",
    };
  }

  return {
    sufficient: false,
    gaps: uniqueGaps,
    recommendedRoute: "full_discovery",
    reasonCode: gapTypes.has("missing_route_evidence")
      ? "missing_route_evidence"
      : "contract_insufficient_for_fast_path",
  };
}
