import type { ExecutionPlan, ExecutionPlanStep, PlanAction, PlanTarget } from "../types/execution-plan.types";
import type { PageObjectRegistry } from "../types/page-object.types";
import { deriveSemanticMethodIntent } from "./pom-classification";
import { findMethodBySemanticIntent } from "./page-object-registry";
import { getPreferredOwnerForIntent, METHOD_INTENT_NAME_MAP } from "../types/pom-ownership";
import { decodeJsStringLiteralBody, normalizeSemanticText, semanticallyEqualText } from "./semantic-text-normalization";
import type { AssertionPolarity } from "../scenarios/canonical-scenario";

// Local copies of the minimal source-scenario/oracle shapes to avoid a circular
// dependency with the spec-generation-hybrid module that consumes this contract.
export type ContractSourceScenarioAuth = {
  required?: boolean;
  gateDetected?: boolean;
  insertionAfterStepIndex?: number;
  detectedStage?: string;
  detectedBeforeStep?: string;
  flowAlias?: string;
  flowLanding?: string;
};

export type ContractObservableOracle = {
  id: string;
  requirement: string;
  type: string;
  backed: boolean;
  source?: "discovery" | "scenario" | "inferred";
  stepIndex?: number;
  requirementRefs?: string[];
  polarity?: AssertionPolarity;
  target?: string;
  evidence: string[];
  details?: Record<string, unknown>;
};

export type ContractSourceScenario = {
  title?: string;
  steps?: Array<{ index: number; action: string; description?: string; expected?: string; polarity?: AssertionPolarity; assertionImportance?: "blocking" | "contextual" | "optional"; canonicalAssertion?: import("../scenarios/canonical-scenario").CanonicalAssertion; conditionalAction?: import("../scenarios/canonical-scenario").CanonicalConditionalAction }>;
  expectedResult?: string;
  preconditions?: string[];
  observedAssertions?: string[];
  auth?: ContractSourceScenarioAuth;
  observableOracles?: ContractObservableOracle[];
  expectedResultRequirementRefs?: string[];
  stepStatuses?: Array<{ index: number; status: string }>;
  stepRequirementRefs?: Array<{ stepIndex: number; requirementId: string; facet?: string }>;
  stepClaims?: Array<{ stepIndex: number; claimId: string; requirementId?: string; facet?: string; required?: boolean; coverable?: boolean }>;
  requirements?: Array<{ requirementId: string; description: string; coverability?: string; polarity?: AssertionPolarity }>;
};

export type SpecStepOperation =
  | "navigate"
  | "login"
  | "click"
  | "fill"
  | "select"
  | "check"
  | "assertVisible"
  | "assertText"
  | "assertUrl"
  | "assertState"
  | "wait"
  | "noop";

export type SpecStepTarget = {
  strategy: string;
  value?: string;
  role?: string;
  name?: string;
  exact?: boolean;
};

export type SpecPageObjectImplementation = {
  kind: "page_object";
  owner: string;
  method: string;
  argument?: string;
  expectedArgs?: number;
  semanticActionIdentity?: string;
};

export type SpecRuntimeImplementation = {
  kind: "runtime";
  runtimeMethod: string;
};

export type SpecInlineImplementation = {
  kind: "inline";
  locator: string;
};

export type SpecStepImplementation =
  | SpecPageObjectImplementation
  | SpecRuntimeImplementation
  | SpecInlineImplementation;

export type SpecOracleMechanism = {
  source: "auth_gate_detector" | "heading_or_control" | "url_state";
  method: "detectAuthGate" | "expectPromotedVisible";
  scanner?: { source: "page_scanner"; method: "scanCurrentPage" };
  stabilization?: { source: "promoted_runtime"; method: "waitForPromotedUiStable" };
  expected: { oracleKind: string; stage?: string; target?: string; urlPattern?: string };
};

function oracleRequiresPolarity(type: string): boolean {
  return type === "navigation_transition" || type === "url_state";
}

export type SpecStepOracle = {
  type: string;
  backed: boolean;
  polarity?: AssertionPolarity;
  implementationKind?: string;
  mechanism?: SpecOracleMechanism;
  sourceActionStepIndex?: number;
  requirement?: string;
};

export type SpecExecutionContractStep = {
  contractStepIndex: number;
  scenarioStepIndex: number;
  originalText: string;
  operation: SpecStepOperation;
  conditional?: boolean;
  conditionalAction?: import("../scenarios/canonical-scenario").CanonicalConditionalAction;
  target?: SpecStepTarget;
  value?: string;
  valueKey?: string;
  required?: boolean;
  executionStatus: "executed" | "observed" | "skipped" | "unresolved" | "contextual_unresolved";
  implementation?: SpecStepImplementation;
  oracle?: SpecStepOracle;
  assertionIntent?: import("../scenarios/canonical-scenario").CanonicalAssertionIntent;
  polarity?: AssertionPolarity;
  subject?: string;
  trigger?: string;
  condition?: string;
  expectedState?: string;
  childExpectations?: string[];
  requirementRefs?: string[];
  sourceActionStepIndex?: number;
  resolvedExecutionTarget?: string;
  evidenceRefs: string[];
};

export type SpecExecutionContractAuth = {
  gateDetected: boolean;
  required?: boolean;
  stage?: string;
  insertionAfterStepIndex?: number;
  flowAlias?: string;
  flowLanding?: string;
  aggregate?: {
    kind: "auth_flow";
    helper: "ensureAuthenticated";
    bindingId: string;
    coveredScenarioStepIndices: number[];
  };
};

export type SpecExecutionContract = {
  version: string;
  scenarioId: string;
  title: string;
  appSlug?: string;
  sectionSlug?: string;
  auth?: SpecExecutionContractAuth;
  steps: SpecExecutionContractStep[];
  unresolvedRequiredOracles: Array<{ requirement: string; reason: string }>;
  diagnostics: {
    requiredScenarioSteps: number;
    representedScenarioSteps: number;
    missingScenarioSteps: Array<{ scenarioStepIndex: number; reason: string }>;
  };
};

export type SpecExecutionContractValidation = {
  valid: boolean;
  errors: string[];
};

export type BuildSpecExecutionContractOptions = {
  appSlug?: string;
  sectionSlug?: string;
  pageObjectRegistry?: PageObjectRegistry;
};

const CONTRACT_VERSION = "1.0";

function mapPlanAction(action: PlanAction): SpecStepOperation {
  switch (action) {
    case "navigate": return "navigate";
    case "login": return "login";
    case "click": return "click";
    case "fill": return "fill";
    case "select": return "select";
    case "check": return "check";
    case "uncheck": return "check";
    case "press": return "click";
    case "waitFor": return "wait";
    case "assertVisible": return "assertVisible";
    case "assertText": return "assertText";
    case "assertUrl": return "assertUrl";
    case "screenshot": return "noop";
    case "noop": return "noop";
    default: return "noop";
  }
}

function buildSpecStepTarget(target: PlanTarget | "APP_BASE_URL" | undefined): SpecStepTarget | undefined {
  if (!target || target === "APP_BASE_URL") return undefined;
  return {
    strategy: target.strategy,
    value: target.value,
    role: target.role,
    name: target.name,
    exact: target.exact
  };
}

function getStepTargetValue(step: ExecutionPlanStep): string {
  if (typeof step.target === "string") return step.target;
  return step.target?.value ?? step.target?.name ?? step.target?.role ?? "";
}

function isCompositeObservableState(oracle: ContractObservableOracle): boolean {
  const details = oracle.details ?? {};
  return details.composite === true || (oracle.evidence ?? []).some((e) => e.includes("composite_state"));
}

function resolveOracleImplementationKind(oracle: ContractObservableOracle): string | undefined {
  const details = oracle.details ?? {};
  if (oracle.type === "auth_gate") {
    if (typeof details.stage === "string" && details.stage.trim()) return "runtime_auth_state";
    if (typeof details.expectedUrl === "string" && details.expectedUrl.trim()) return "url_state";
    if (typeof oracle.target === "string" && oracle.target.trim()) return "heading_or_control";
    return "runtime_auth_state";
  }
  if (oracle.type === "navigation_transition") {
    if (typeof details.expectedUrl === "string" && details.expectedUrl.trim()) return "url_state";
    return "heading_or_control";
  }
  if (oracle.type === "url_state") return "url_state";
  if (oracle.type === "literal_visible_text" || oracle.type === "heading_or_control" || oracle.type === "page_object_state") {
    return "heading_or_control";
  }
  if (oracle.type === "runtime_state") return "runtime_auth_state";
  return undefined;
}

function buildAuthGateMechanism(oracle: ContractObservableOracle): SpecOracleMechanism | undefined {
  if (oracle.type !== "auth_gate") return undefined;
  const details = oracle.details ?? {};
  const stage = typeof details.stage === "string" && details.stage.trim() ? details.stage : undefined;
  return {
    source: "auth_gate_detector",
    method: "detectAuthGate",
    scanner: { source: "page_scanner", method: "scanCurrentPage" },
    stabilization: { source: "promoted_runtime", method: "waitForPromotedUiStable" },
    expected: { oracleKind: "auth_gate", ...(stage ? { stage } : {}) }
  };
}

function buildNavigationTransitionMechanism(oracle: ContractObservableOracle): SpecOracleMechanism | undefined {
  if (oracle.type !== "navigation_transition") return undefined;
  const details = oracle.details ?? {};
  const urlPattern = typeof details.expectedUrl === "string" && details.expectedUrl.trim()
    ? details.expectedUrl.trim()
    : undefined;
  if (urlPattern) {
    return {
      source: "url_state",
      method: "expectPromotedVisible",
      stabilization: { source: "promoted_runtime", method: "waitForPromotedUiStable" },
      expected: { oracleKind: "navigation_transition", urlPattern }
    };
  }
  // heading_or_control is only valid with a POST-transition heading/control observed
  // and backed by MCP. The causal action target (resolvedTarget/clickTarget) never
  // proves the navigation occurred and must not be used as the expected target.
  const postTransitionTarget = typeof details.postTransitionTarget === "string" && details.postTransitionTarget.trim()
    ? details.postTransitionTarget.trim()
    : undefined;
  if (postTransitionTarget) {
    return {
      source: "heading_or_control",
      method: "expectPromotedVisible",
      stabilization: { source: "promoted_runtime", method: "waitForPromotedUiStable" },
      expected: { oracleKind: "navigation_transition", target: postTransitionTarget }
    };
  }
  // No URL destination and no post-transition observable -> mechanism unresolved.
  return undefined;
}

function buildOracleMechanism(oracle: ContractObservableOracle): SpecOracleMechanism | undefined {
  return buildAuthGateMechanism(oracle) ?? buildNavigationTransitionMechanism(oracle);
}

function requiresOracleMechanism(oracleType: string): boolean {
  return oracleType === "auth_gate" || oracleType === "navigation_transition";
}

function findSourceActionStepIndex(
  oracle: ContractObservableOracle,
  planSteps: ExecutionPlanStep[]
): number | undefined {
  const details = oracle.details ?? {};
  if (typeof details.sourceActionStepIndex === "number") return details.sourceActionStepIndex;
  if (typeof oracle.stepIndex === "number") {
    // For transition/assertion after a click, find the most recent actionable step before this oracle.
    const oracleStep = planSteps.find((s) => s.index === oracle.stepIndex);
    if (oracleStep && oracleStep.action.startsWith("assert")) {
      for (let i = planSteps.indexOf(oracleStep) - 1; i >= 0; i -= 1) {
        const candidate = planSteps[i];
        if (candidate.action === "click" || candidate.action === "select" || candidate.action === "navigate") {
          return candidate.index;
        }
      }
    }
  }
  return undefined;
}

function resolveStepOracle(
  step: ExecutionPlanStep,
  observableOracles: ContractObservableOracle[],
  planSteps: ExecutionPlanStep[]
): { oracle?: SpecStepOracle; evidenceRefs: string[] } {
  const evidenceRefs: string[] = [];
  const direct = observableOracles.find((oracle) => oracle.stepIndex === step.index);
  if (direct) {
    evidenceRefs.push(`oracle:${direct.id}`);
    return {
      oracle: {
        type: direct.type,
        backed: direct.backed,
        polarity: direct.polarity,
        implementationKind: resolveOracleImplementationKind(direct),
        mechanism: buildOracleMechanism(direct),
        sourceActionStepIndex: findSourceActionStepIndex(direct, planSteps),
        requirement: direct.requirement
      },
      evidenceRefs
    };
  }

  // Composite state: multiple assertions backing a single expected narrative
  const composites = observableOracles.filter((oracle) =>
    isCompositeObservableState(oracle)
    && oracle.backed
    && oracle.stepIndex === undefined
  );
  if (composites.length > 0 && step.action.startsWith("assert")) {
    const first = composites[0];
    evidenceRefs.push(`composite:${first.id}`);
    return {
      oracle: {
        type: first.type,
        backed: true,
        implementationKind: resolveOracleImplementationKind(first),
        mechanism: buildOracleMechanism(first),
        requirement: first.requirement
      },
      evidenceRefs
    };
  }

  // Step-level assertions without a direct oracle are observed if they have expected text
  if (step.action.startsWith("assert") && step.expected?.trim()) {
    return {
      oracle: {
        type: "literal_visible_text",
        backed: true,
        implementationKind: "heading_or_control",
        requirement: step.expected.trim()
      },
      evidenceRefs: ["plan:assert_expected"]
    };
  }

  return { evidenceRefs };
}

function resolveImplementationDescriptor(
  step: ExecutionPlanStep,
  registry: PageObjectRegistry | undefined
): SpecStepImplementation | undefined {
  if (!registry || registry.pageObjects.length === 0) return undefined;

  const semanticIntent = deriveSemanticMethodIntent(step, "unknown", []);
  const resolved = findMethodBySemanticIntent(registry, semanticIntent, step);
  if (resolved) {
    // Registry lookup has legacy name-based fallbacks. A contract binding must
    // be capability-based, never just a similar method name.
    if (resolved.method.intent !== semanticIntent) return undefined;
    const stepTarget = getStepTargetValue(step);
    const targetBinding = resolved.method.targetBinding?.trim();
    // A POM descriptor is authoritative only when its structured target binding
    // belongs to this exact business target. Otherwise leave implementation
    // metadata unset so the runtime/scenario representation remains authoritative.
    if (step.action === "click" && stepTarget && (!targetBinding || normalizeSemanticText(targetBinding) !== normalizeSemanticText(stepTarget))) {
      return undefined;
    }
    const expectedArgs = resolved.method.parameters?.length ?? 0;
    // The contract currently carries one optional argument. Do not emit a
    // partial call for methods requiring multiple parameters.
    if (expectedArgs > 1) return undefined;
    const arg = stepTarget;
    return {
      kind: "page_object",
      owner: resolved.pageObject.className,
      method: resolved.method.name,
      expectedArgs,
      semanticActionIdentity: semanticIntent,
      ...(expectedArgs === 1 && arg ? { argument: arg } : {})
    };
  }

  const owner = getPreferredOwnerForIntent(semanticIntent);
  const methodName = METHOD_INTENT_NAME_MAP[semanticIntent];
  if (owner && owner !== "GenericPage" && methodName) {
    const ownerPO = registry.pageObjects.find((po) => po.className === owner && po.status === "active");
    const method = ownerPO?.methods.find((m) => m.name === methodName && m.available);
    if (method) {
      if (method.intent !== semanticIntent) return undefined;
      const expectedArgs = method.parameters?.length ?? 0;
      if (expectedArgs > 1) return undefined;
      return {
        kind: "page_object",
        owner: ownerPO!.className,
        method: method.name,
        expectedArgs,
        semanticActionIdentity: semanticIntent,
        ...(expectedArgs === 1 && getStepTargetValue(step)
          ? { argument: getStepTargetValue(step) }
          : {})
      };
    }
  }

  return undefined;
}

function resolveAuthContext(
  plan: ExecutionPlan,
  sourceScenario: ContractSourceScenario | undefined
): SpecExecutionContractAuth | undefined {
  const metadata = plan.metadata ?? {};
  const authRequired = sourceScenario?.auth?.required === true || metadata.authFlowRequired === true;
  const gateDetected = sourceScenario?.auth?.gateDetected === true || metadata.authGateDetectedDuringDiscovery === true;
  if (!authRequired && !gateDetected) return undefined;
  const scenarioSteps = sourceScenario?.steps ?? [];
  const authValuePlanSteps = plan.steps.filter((step) =>
    typeof step.valueKey === "string" && step.valueKey.startsWith("auth.")
  );
  const authValueScenarioIndexes = new Set<number>();
  for (const planStep of authValuePlanSteps) {
    const compatible = scenarioSteps.find((scenarioStep) =>
      scenarioStep.index === planStep.index
      || (scenarioStep.action && planStep.description && normalizeSemanticText(scenarioStep.action) === normalizeSemanticText(planStep.description))
    );
    if (compatible) authValueScenarioIndexes.add(compatible.index);
  }
  // The auth submit action is the first validated action immediately after the
  // last auth data binding. This is data-derived and works across app profiles;
  // it is not a text/position fallback for credentials.
  const lastAuthPlanIndex = Math.max(...authValuePlanSteps.map((step) => step.index), -1);
  const authSubmitPlanStep = lastAuthPlanIndex >= 0
    ? plan.steps.find((step) => step.index > lastAuthPlanIndex && step.action === "click")
    : undefined;
  if (authSubmitPlanStep) {
    const compatible = scenarioSteps.find((scenarioStep) =>
      scenarioStep.index === authSubmitPlanStep.index
      || (scenarioStep.action && authSubmitPlanStep.description && normalizeSemanticText(scenarioStep.action) === normalizeSemanticText(authSubmitPlanStep.description))
    );
    if (compatible) authValueScenarioIndexes.add(compatible.index);
  }
  const coveredScenarioStepIndices = [...authValueScenarioIndexes].sort((a, b) => a - b);
  return {
    gateDetected,
    required: authRequired,
    stage: sourceScenario?.auth?.detectedStage ?? metadata.authGateStage,
    insertionAfterStepIndex: sourceScenario?.auth?.insertionAfterStepIndex ?? metadata.authFlowInsertionAfterStepIndex,
    flowAlias: sourceScenario?.auth?.flowAlias ?? metadata.authFlowAlias,
    flowLanding: sourceScenario?.auth?.flowLanding ?? metadata.authFlowLanding,
    ...(coveredScenarioStepIndices.length > 0
      ? {
          aggregate: {
            kind: "auth_flow" as const,
            helper: "ensureAuthenticated" as const,
            bindingId: "auth-flow-aggregate",
            coveredScenarioStepIndices,
          }
        }
      : {})
  };
}

type ScenarioStepLike = { index: number; action: string; description?: string; expected?: string; assertionImportance?: "blocking" | "contextual" | "optional"; canonicalAssertion?: import("../scenarios/canonical-scenario").CanonicalAssertion; conditionalAction?: import("../scenarios/canonical-scenario").CanonicalConditionalAction };

function extractQuotedText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const quoted = value.match(/["'“”‘’]([^"'“”‘’]+)["'“”‘’]/);
  if (quoted) return quoted[1].trim();
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function classifyScenarioAction(action: string, canonicalAssertion?: ScenarioStepLike["canonicalAssertion"], conditionalAction?: ScenarioStepLike["conditionalAction"]): SpecStepOperation {
  if (conditionalAction) return conditionalAction.operation;
  if (canonicalAssertion) return "assertState";
  const lower = (action ?? "").trim().toLowerCase();
  if (!lower) return "noop";
  if (/^(noop|screenshot)$/.test(lower)) return "noop";
  if (/^(navigate|navegar|ir\s+a|visitar|abrir\s+url)\b/.test(lower)) return "navigate";
  if (/^(login|iniciar\s+sesi[oó]n|loguear|autenticar)\b/.test(lower)) return "login";
  if (/^(click|clic|tocar|pulsar|presionar|tap|abrir|acceder)\b/.test(lower)) return "click";
  if (/^(fill|ingresar|escribir|completar|llenar|digitar|type)\b/.test(lower)) return "fill";
  if (/^(select|elegir|seleccionar)\b/.test(lower)) return "select";
  if (/^(check|marcar|tildar)\b/.test(lower)) return "check";
  if (/^(wait|esperar)\b/.test(lower)) return "wait";
  if (/^(asserturl|validar\s+url)\b/.test(lower)) return "assertUrl";
  if (/^(asserttext)\b/.test(lower)) return "assertText";
  if (/^(assert|assertvisible|validar|validate|verificar|verify|comprobar|confirmar|expect|mostrar|muestra|visible|se\s+muestr|aparezc|existe|existan)\b/.test(lower)) return "assertVisible";
  return "noop";
}

function extractSelectSemanticTarget(text: string): string {
  const trimmed = text.trim();
  const verbMatch = trimmed.match(/^(seleccionar|seleccione|elegir|elija|escoger|escoja|select|choose)\s+/i);
  if (!verbMatch) return trimmed;
  const rest = trimmed.slice(verbMatch[0].length).trim();
  return rest.replace(/[.!?]+$/, "").trim() || trimmed;
}

function buildScenarioStepTarget(scenarioStep: ScenarioStepLike, operation: SpecStepOperation): SpecStepTarget | undefined {
  if (scenarioStep.conditionalAction) {
    return { strategy: "text", value: scenarioStep.conditionalAction.actionTarget };
  }
  if (scenarioStep.canonicalAssertion?.expectedState) {
    return { strategy: "text", value: scenarioStep.canonicalAssertion.expectedState };
  }
  const text = extractQuotedText(scenarioStep.expected) ?? extractQuotedText(scenarioStep.description);
  if (!text) return undefined;
  const value = operation === "select" ? extractSelectSemanticTarget(text) : text;
  if (!value) return undefined;
  return { strategy: "text", value };
}

function getScenarioStepOriginalText(scenarioStep: ScenarioStepLike): string {
  return scenarioStep.description?.trim() || scenarioStep.expected?.trim() || scenarioStep.action;
}

function normalizeOracleMatch(value: string): string {
  return normalizeSemanticText(value).replace(/\s+/g, " ").trim();
}

function oracleToStepOracle(
  oracle: ContractObservableOracle,
  planSteps: ExecutionPlanStep[]
): { oracle: SpecStepOracle; evidenceRefs: string[] } {
  return {
    oracle: {
      type: oracle.type,
      backed: oracle.backed,
      polarity: oracle.polarity,
      implementationKind: resolveOracleImplementationKind(oracle),
      mechanism: buildOracleMechanism(oracle),
      sourceActionStepIndex: findSourceActionStepIndex(oracle, planSteps),
      requirement: oracle.requirement
    },
    evidenceRefs: [`oracle:${oracle.id}`]
  };
}

function resolveScenarioStepOracle(
  scenarioStep: ScenarioStepLike,
  observableOracles: ContractObservableOracle[],
  planSteps: ExecutionPlanStep[]
): { oracle?: SpecStepOracle; evidenceRefs: string[] } {
  // 1. Direct evidence: a backed oracle bound to this scenario step index.
  const direct = observableOracles.find((oracle) => oracle.stepIndex === scenarioStep.index && oracle.backed);
  if (direct) {
    return oracleToStepOracle(direct, planSteps);
  }

  // 2. Reconcile by business target text (expected/description) against a backed oracle's
  //    requirement or target. This accepts non-literal backed oracles (auth_gate,
  //    navigation_transition, runtime_state, page_object_state) as valid backing.
  const stepText = extractQuotedText(scenarioStep.expected)
    ?? extractQuotedText(scenarioStep.description)
    ?? scenarioStep.expected?.trim()
    ?? scenarioStep.description?.trim();
  if (stepText) {
    const normalizedStepText = normalizeOracleMatch(stepText);
    if (normalizedStepText) {
      const reconciled = observableOracles.find((oracle) => {
        if (!oracle.backed) return false;
        const requirement = normalizeOracleMatch(oracle.requirement);
        const target = oracle.target ? normalizeOracleMatch(oracle.target) : "";
        return (requirement.length > 0 && (requirement === normalizedStepText || requirement.includes(normalizedStepText) || normalizedStepText.includes(requirement)))
          || (target.length > 0 && (target === normalizedStepText || target.includes(normalizedStepText) || normalizedStepText.includes(target)));
      });
      if (reconciled) {
        return oracleToStepOracle(reconciled, planSteps);
      }
    }
  }

  return { evidenceRefs: [] };
}

function findCompatiblePlanStep(
  scenarioStep: ScenarioStepLike,
  operation: SpecStepOperation,
  planSteps: ExecutionPlanStep[]
): ExecutionPlanStep | undefined {
  const scenarioTarget = extractQuotedText(scenarioStep.expected) ?? extractQuotedText(scenarioStep.description);
  const normalizedScenarioTarget = scenarioTarget ? normalizeOracleMatch(scenarioTarget) : "";

  // 1. Explicit scenarioStepIndex + same operation (traceable plan step).
  const byIndex = planSteps.find(
    (step) => step.index === scenarioStep.index && mapPlanAction(step.action) === operation
  );
  if (byIndex) {
    const indexedTarget = getStepTargetValue(byIndex);
    if (!normalizedScenarioTarget || normalizeOracleMatch(indexedTarget) === normalizedScenarioTarget) return byIndex;
    // An explicit step identity with a different target is authoritative evidence
    // that this plan metadata is foreign; do not fall back to an accidental match.
    return undefined;
  }

  // 2. Same operation + same normalized business target.
  if (normalizedScenarioTarget) {
    const byTarget = planSteps.filter((step) => {
      if (mapPlanAction(step.action) !== operation) return false;
      const planTarget = getStepTargetValue(step);
      return planTarget.length > 0 && normalizeOracleMatch(planTarget) === normalizedScenarioTarget;
    });
    if (byTarget.length === 1) return byTarget[0];
  }

  return undefined;
}

function resolveResolvedExecutionTarget(
  scenarioStep: ScenarioStepLike,
  operation: SpecStepOperation,
  observableOracles: ContractObservableOracle[]
): string | undefined {
  if (operation !== "select") return undefined;
  for (const oracle of observableOracles) {
    if (!oracle.backed) continue;
    const sourceIdx = typeof oracle.details?.sourceActionStepIndex === "number"
      ? (oracle.details.sourceActionStepIndex as number)
      : oracle.stepIndex;
    if (sourceIdx !== scenarioStep.index) continue;
    const target = typeof oracle.target === "string" && oracle.target.trim()
      ? oracle.target.trim()
      : undefined;
    if (target) return target;
  }
  return undefined;
}

function hasCanonicalRequiredness(
  sourceScenario: ContractSourceScenario | undefined,
  scenarioStepIndex: number,
  scenarioStep?: ScenarioStepLike
): boolean {
  const allRefs = sourceScenario?.stepRequirementRefs ?? [];
  const exactRefs = allRefs.filter((ref) => ref.stepIndex === scenarioStepIndex);
  const refs = exactRefs.length > 0
    ? exactRefs
    : allRefs.filter((ref) => ref.stepIndex === scenarioStepIndex - 1);
  const canonicalRequirements = sourceScenario?.requirements ?? [];
  const directText = normalizeSemanticText(
    `${scenarioStep?.action ?? ""} ${scenarioStep?.description ?? ""} ${scenarioStep?.expected ?? ""}`
  );
  const canonicalTextMatch = canonicalRequirements.some((requirement) => {
    if (requirement.coverability === "nonAutomatable") return false;
    const requirementText = normalizeSemanticText(requirement.description);
    return requirementText.length > 0 && (directText.includes(requirementText) || requirementText.includes(directText));
  });
  if (refs.length === 0) return canonicalTextMatch;
  const claims = sourceScenario?.stepClaims ?? [];
  return refs.every((ref) => {
    const claim = claims.find((candidate) =>
      (candidate.stepIndex === ref.stepIndex || candidate.stepIndex === scenarioStepIndex || candidate.stepIndex === scenarioStepIndex - 1)
      && (!candidate.requirementId || candidate.requirementId === ref.requirementId)
      && (!candidate.facet || !ref.facet || candidate.facet === ref.facet)
    );
    return claim?.required !== false && claim?.coverable !== false;
  });
}

function canonicalRequirementIds(sourceScenario: ContractSourceScenario | undefined, scenarioStepIndex: number): string[] {
  const allRefs = sourceScenario?.stepRequirementRefs ?? [];
  const exactRefs = allRefs.filter((ref) => ref.stepIndex === scenarioStepIndex);
  return (exactRefs.length > 0 ? exactRefs : allRefs.filter((ref) => ref.stepIndex === scenarioStepIndex - 1))
    .map((ref) => ref.requirementId);
}

export function buildSpecExecutionContract(
  plan: ExecutionPlan,
  sourceScenario: ContractSourceScenario | undefined,
  options: BuildSpecExecutionContractOptions = {}
): SpecExecutionContract {
  const observableOracles = sourceScenario?.observableOracles ?? [];
  const unresolvedRequiredOracles: Array<{ requirement: string; reason: string }> = [];
  // Scenario steps are authoritative for WHICH steps exist. The validated plan only
  // enriches (target/implementation/evidence). Fall back to plan steps when the source
  // scenario carries no steps.
  const scenarioSteps: ScenarioStepLike[] = sourceScenario?.steps && sourceScenario.steps.length > 0
    ? sourceScenario.steps
    : plan.steps.map((step) => ({
        index: step.index,
        action: step.action,
        description: step.description,
        expected: step.expected
      }));

  const requiredScenarioSteps = scenarioSteps.filter((s) => {
    const action = (s.action ?? "").trim().toLowerCase();
    return action !== "noop" && action !== "screenshot";
  });

  const steps: SpecExecutionContractStep[] = requiredScenarioSteps.map((scenarioStep, index) => {
    // Operation always comes from the scenario step intent, never from the validated plan.
    const operation = classifyScenarioAction(scenarioStep.action, scenarioStep.canonicalAssertion, scenarioStep.conditionalAction);
    const isAssertion = operation.startsWith("assert");

    // Assertions are never enriched from the validated plan (never substituted with
    // navigate/click). Actions look up a traceable plan step for implementation only.
    const planStep = isAssertion
      ? undefined
      : findCompatiblePlanStep(scenarioStep, operation, plan.steps);

    let oracleResult = isAssertion
      ? resolveScenarioStepOracle(scenarioStep, observableOracles, plan.steps)
      : planStep
        ? resolveStepOracle(planStep, observableOracles, plan.steps)
        : resolveScenarioStepOracle(scenarioStep, observableOracles, plan.steps);
    const canonicalIds = canonicalRequirementIds(sourceScenario, scenarioStep.index);
    if (isAssertion && canonicalIds.length > 0 && oracleResult.oracle && !canonicalIds.includes(oracleResult.oracle.requirement ?? "")) {
      oracleResult = { evidenceRefs: [] };
    }
    const oracle = oracleResult.oracle;

    const implementation = planStep
      ? resolveImplementationDescriptor(planStep, options.pageObjectRegistry)
      : undefined;

    const target = buildScenarioStepTarget(scenarioStep, operation)
      ?? (planStep ? buildSpecStepTarget(planStep.target) : undefined);

    const resolvedExecutionTarget = resolveResolvedExecutionTarget(scenarioStep, operation, observableOracles);

    // Priority for assertion steps:
    // 1. backed oracle/evidence -> required=true, executed (never downgraded by an
    //    earlier provisional contextual classification).
    // 2. no backing AND explicitly contextual/non-blocking -> required=false,
    //    contextual_unresolved (kept traceable, never invalidates the contract).
    // 3. no backing AND not explicitly non-blocking -> required=true, unresolved.
    const assertionImportance = scenarioStep.assertionImportance ?? "blocking";
    const hasBackedOracle = Boolean(oracle && oracle.backed);
    const canonicalRequired = isAssertion && hasCanonicalRequiredness(sourceScenario, scenarioStep.index, scenarioStep);
    // A bare contextual verb is not enough to make an assertion blocking.  A
    // scenario assertion becomes required without a backed oracle only when
    // the persisted source also carries assertion authority (expected result,
    // observed assertion, canonical requirement/ref, or oracle metadata).
    const sourceHasAssertionAuthority = Boolean(
      sourceScenario
      && (
        Boolean(sourceScenario.expectedResult?.trim())
        || (sourceScenario.observedAssertions?.length ?? 0) > 0
        || (sourceScenario.requirements?.length ?? 0) > 0
        || (sourceScenario.stepRequirementRefs?.length ?? 0) > 0
        || (sourceScenario.stepClaims?.length ?? 0) > 0
        || observableOracles.some((candidate) => candidate.stepIndex === scenarioStep.index)
      )
    );
    const explicitScenarioAssertion = isAssertion && sourceHasAssertionAuthority;

    let required = scenarioStep.conditionalAction ? false : true;
    let executionStatus: SpecExecutionContractStep["executionStatus"] = "executed";
    if (scenarioStep.conditionalAction) {
      executionStatus = "skipped";
    } else if (planStep?.optional) {
      executionStatus = "skipped";
    } else if (isAssertion && !hasBackedOracle) {
      if (!canonicalRequired && !explicitScenarioAssertion && assertionImportance !== "blocking") {
        required = false;
        executionStatus = "contextual_unresolved";
      } else {
        executionStatus = "unresolved";
      }
    }

    const discoveredStatus = sourceScenario?.stepStatuses?.find(
      (item) => item.index === scenarioStep.index
    )?.status;
    if (discoveredStatus === "skipped_after_completion" && !canonicalRequired) {
      required = false;
      executionStatus = "skipped";
    }

    const scenarioTargetText = extractQuotedText(scenarioStep.expected) ?? extractQuotedText(scenarioStep.description) ?? "";
    const implementationSource = planStep ? "validated_plan" : (oracle && oracle.backed ? "oracle" : "scenario");
    console.log(
      `[execution-contract-step] contractStepIndex=${index} scenarioStepIndex=${scenarioStep.index} operation=${operation} scenarioTarget="${scenarioTargetText}" implementationSource=${implementationSource} planMatched=${Boolean(planStep)} required=${required} executionStatus=${executionStatus}`
    );
    if (oracle?.backed && (oracle.type === "auth_gate" || oracle.type === "navigation_transition")) {
      console.log(`[execution-contract-step] scenarioStepIndex=${scenarioStep.index} oracle=${oracle.type} implementationSource=${oracle.mechanism?.source ?? "none"} implementationMethod=${oracle.mechanism?.method ?? "none"} sourceActionStepIndex=${oracle.sourceActionStepIndex ?? "na"} stabilization=${oracle.mechanism?.stabilization?.method ?? "none"} backed=true required=${required}`);
    }

    return {
      contractStepIndex: index,
      scenarioStepIndex: scenarioStep.index,
      originalText: getScenarioStepOriginalText(scenarioStep),
      operation,
      ...(scenarioStep.conditionalAction ? { conditional: true, conditionalAction: scenarioStep.conditionalAction } : {}),
      target,
      value: planStep?.value,
      valueKey: planStep?.valueKey,
      required,
      executionStatus,
      implementation,
      oracle,
      ...(scenarioStep.canonicalAssertion ? {
        assertionIntent: scenarioStep.canonicalAssertion.intent,
        ...(scenarioStep.canonicalAssertion.polarity ? { polarity: scenarioStep.canonicalAssertion.polarity } : {}),
        subject: scenarioStep.canonicalAssertion.subject,
        trigger: scenarioStep.canonicalAssertion.trigger,
        condition: scenarioStep.canonicalAssertion.condition,
        expectedState: scenarioStep.canonicalAssertion.expectedState,
        childExpectations: scenarioStep.canonicalAssertion.childExpectations,
        requirementRefs: canonicalIds,
      } : canonicalIds.length > 0 ? { requirementRefs: canonicalIds } : {}),
      sourceActionStepIndex: oracle?.sourceActionStepIndex,
      resolvedExecutionTarget,
      evidenceRefs: oracleResult.evidenceRefs
    };
  });

  const missingScenarioSteps: Array<{ scenarioStepIndex: number; reason: string }> = [];
  for (const step of steps) {
    if (step.required !== false && step.operation.startsWith("assert") && !(step.oracle && step.oracle.backed)) {
      missingScenarioSteps.push({
        scenarioStepIndex: step.scenarioStepIndex,
        reason: "required_scenario_step_missing"
      });
    }
  }

  // Detect required oracles that could not be backed
  for (const oracle of observableOracles) {
    if (!oracle.backed && oracle.source !== "inferred") {
      const covered = steps.some((s) => s.oracle?.requirement === oracle.requirement);
      if (!covered) {
        unresolvedRequiredOracles.push({
          requirement: oracle.requirement,
          reason: "oracle_not_backed_by_runtime_evidence"
        });
      }
    }
  }

  const requiredScenarioStepCount = steps.filter((step) => step.required !== false).length;
  const representedScenarioSteps = requiredScenarioStepCount - missingScenarioSteps.length;
  console.log(`[execution-contract] requiredScenarioSteps=${requiredScenarioStepCount} representedScenarioSteps=${representedScenarioSteps} missing=${missingScenarioSteps.length}`);

  return {
    version: CONTRACT_VERSION,
    scenarioId: plan.scenario.externalId ?? `C${plan.scenario.caseId ?? ""}`,
    title: plan.scenario.title,
    appSlug: options.appSlug,
    sectionSlug: options.sectionSlug,
    auth: resolveAuthContext(plan, sourceScenario),
    steps,
    unresolvedRequiredOracles,
    diagnostics: {
      requiredScenarioSteps: requiredScenarioStepCount,
      representedScenarioSteps,
      missingScenarioSteps
    }
  };
}

export function validateSpecExecutionContract(
  contract: SpecExecutionContract
): SpecExecutionContractValidation {
  const errors: string[] = [];

  for (let i = 0; i < contract.steps.length; i += 1) {
    const step = contract.steps[i];
    if (step.contractStepIndex !== i) {
      errors.push(`contract_step_index_mismatch:expected=${i}:actual=${step.contractStepIndex}`);
    }
    if (step.executionStatus === "unresolved" && step.operation.startsWith("assert")) {
      errors.push(`execution_contract_unresolved:step=${step.scenarioStepIndex}:operation=${step.operation}`);
    }
    if (
      step.required !== false
      && step.oracle?.backed === true
      && requiresOracleMechanism(step.oracle.type)
      && !step.oracle.mechanism
    ) {
      errors.push(`required_oracle_mechanism_unresolved:scenarioStepIndex=${step.scenarioStepIndex}:oracleType=${step.oracle.type}`);
      console.log(`[execution-contract] valid=false reason=required_oracle_mechanism_unresolved scenarioStepIndex=${step.scenarioStepIndex} oracleType=${step.oracle.type}`);
    }
    if (
      step.required !== false
      && step.oracle?.backed === true
      && oracleRequiresPolarity(step.oracle.type)
      && step.oracle.polarity === undefined
    ) {
      errors.push(`required_oracle_polarity_unresolved:scenarioStepIndex=${step.scenarioStepIndex}:oracleType=${step.oracle.type}`);
    }
    if (step.implementation?.kind === "page_object") {
      const expectedArgs = step.implementation.expectedArgs;
      if (expectedArgs !== undefined) {
        const actualArgs = step.implementation.argument === undefined ? 0 : 1;
        if (actualArgs !== expectedArgs) {
          errors.push(`page_object_method_signature_mismatch:${step.implementation.owner}.${step.implementation.method}:expectedArgs=${expectedArgs}:actualArgs=${actualArgs}`);
        }
      }
      if (!step.implementation.semanticActionIdentity) {
        errors.push(`page_object_method_semantic_mismatch:step=${step.scenarioStepIndex}:missing_action_identity`);
      }
    }
  }

  for (const unresolved of contract.unresolvedRequiredOracles) {
    errors.push(`execution_contract_unresolved:requirement=${unresolved.requirement}:reason=${unresolved.reason}`);
  }

  const aggregate = contract.auth?.aggregate;
  if (aggregate) {
    const unique = new Set(aggregate.coveredScenarioStepIndices);
    if (unique.size !== aggregate.coveredScenarioStepIndices.length) {
      errors.push("auth_aggregate_duplicate_coverage");
    }
    for (const scenarioStepIndex of aggregate.coveredScenarioStepIndices) {
      const step = contract.steps.find((candidate) => candidate.scenarioStepIndex === scenarioStepIndex);
      if (!step) errors.push(`auth_aggregate_unknown_step:${scenarioStepIndex}`);
      else if (step.required === false) errors.push(`auth_aggregate_non_required_step:${scenarioStepIndex}`);
    }
  }

  for (const missing of contract.diagnostics?.missingScenarioSteps ?? []) {
    errors.push(`required_scenario_step_missing:scenarioStepIndex=${missing.scenarioStepIndex}:reason=${missing.reason}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function normalizeTechnicalEvidenceTarget(value: string): string {
  return value.trim().toLowerCase().replace(/^["']|["']$/g, "");
}

const TECHNICAL_EVIDENCE_KEYS = new Set([
  "auth_gate_detected",
  "auth_stage",
  "gateType",
  "confidence",
  "backed",
  "source",
  "oracleType",
  "satisfied_by",
  "transition_observed",
  "click_target",
  "resolved_target",
  "action_type",
  "post_click_ui_change",
  "observed_assertion_match",
  "structural_evidence_present",
  "feedback_evidence_present",
  "discovery_status",
  "backing_evidence_missing"
]);

function isTechnicalEvidenceMetadata(value: string): boolean {
  const normalized = normalizeTechnicalEvidenceTarget(value);
  if (!normalized) return false;
  if (TECHNICAL_EVIDENCE_KEYS.has(normalized)) return true;
  if (TECHNICAL_EVIDENCE_KEYS.has(normalized.split(":")[0])) return true;
  for (const key of TECHNICAL_EVIDENCE_KEYS) {
    if (normalized === key || normalized.startsWith(`${key}:`) || normalized.endsWith(`:${key}`)) return true;
  }
  return false;
}

function extractRuntimeTargetValue(body: string): string | undefined {
  const stringForm = /\btarget\s*:\s*(['"])((?:\\.|(?!\1)[^])*)\1/.exec(body);
  if (stringForm) return decodeJsStringLiteralBody(stringForm[2]);
  const objectForm = /\btarget\s*:\s*\{[^{}]*?\bvalue\s*:\s*(['"])((?:\\.|(?!\1)[^])*)\1/.exec(body);
  if (objectForm) return decodeJsStringLiteralBody(objectForm[2]);
  return undefined;
}

function extractBalancedBraces(body: string, startIdx: number): string | undefined {
  let depth = 0;
  let i = startIdx;
  let inString: string | null = null;
  let escaped = false;
  while (i < body.length) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; i += 1; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(startIdx + 1, i);
    }
    i += 1;
  }
  return undefined;
}

function extractActionCallbackBody(callBody: string): string | undefined {
  const actionKey = /\baction\s*:/g;
  let keyMatch: RegExpExecArray | null;
  let searchFrom = 0;
  while ((keyMatch = actionKey.exec(callBody)) !== null) {
    let i = keyMatch.index + keyMatch[0].length;
    while (i < callBody.length && /\s/.test(callBody[i])) i += 1;
    const asyncMatch = /^async\b/.exec(callBody.slice(i));
    if (asyncMatch) i += asyncMatch[0].length;
    while (i < callBody.length && /\s/.test(callBody[i])) i += 1;
    if (callBody[i] === "(") {
      let depth = 0;
      while (i < callBody.length) {
        if (callBody[i] === "(") depth += 1;
        else if (callBody[i] === ")") { depth -= 1; if (depth === 0) { i += 1; break; } }
        i += 1;
      }
    }
    while (i < callBody.length && /\s/.test(callBody[i])) i += 1;
    if (callBody[i] === "=" && callBody[i + 1] === ">") i += 2;
    else { searchFrom = i; continue; }
    while (i < callBody.length && /\s/.test(callBody[i])) i += 1;
    if (callBody[i] !== "{") { searchFrom = i; continue; }
    return extractBalancedBraces(callBody, i);
  }
  return undefined;
}

function extractQualifiedMethodCalls(body: string): Array<{ receiver: string; method: string }> {
  const calls: Array<{ receiver: string; method: string }> = [];
  const regex = /\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    calls.push({ receiver: match[1], method: match[2] });
  }
  return calls;
}

function extractStringLiterals(body: string): string[] {
  const literals: string[] = [];
  let i = 0;
  let depth = 0;
  let inCall = false;
  let callDepth = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let value = "";
      while (j < body.length && body[j] !== quote) {
        if (body[j] === "\\") {
          value += body[j];
          if (j + 1 < body.length) value += body[j + 1];
          j += 2;
          continue;
        }
        value += body[j];
        j += 1;
      }
      if (j < body.length && inCall && depth - callDepth >= 0) {
        if (value.trim().length > 0) literals.push(decodeJsStringLiteralBody(value));
      }
      i = j < body.length ? j + 1 : body.length;
      continue;
    }
    if (ch === "(") {
      const isFuncCall = i > 0 && /[a-zA-Z_$\d]/.test(body[i - 1]);
      depth += 1;
      if (isFuncCall && !inCall) { inCall = true; callDepth = depth; }
      i += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth < callDepth) { inCall = false; callDepth = 0; }
      i += 1;
      continue;
    }
    i += 1;
  }
  return literals;
}

function extractRuntimeStepCalls(specContent: string): Array<{ method: string; stepIndex: number; target?: string; position: number; rawBody: string }> {
  const calls: Array<{ method: string; stepIndex: number; target?: string; position: number; rawBody: string }> = [];
  const regex = /promotedRuntime\.([A-Za-z_]\w*)\s*\(\s*\{([\s\S]*?)\}\s*\)/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(specContent)) !== null) {
    const method = match[1];
    const body = match[2] ?? "";
    const stepIndexMatch = /\bstepIndex\s*:\s*(\d+)\b/.exec(body);
    if (stepIndexMatch) {
      calls.push({
        method,
        stepIndex: Number(stepIndexMatch[1]),
        target: extractRuntimeTargetValue(body),
        position: match.index,
        rawBody: body
      });
    }
  }
  return calls;
}

function extractDirectNavigationCalls(specContent: string): Array<{ kind: string; position: number }> {
  const calls: Array<{ kind: string; position: number }> = [];
  const gotoRegex = /await\s+page\.goto\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = gotoRegex.exec(specContent)) !== null) {
    calls.push({ kind: "page.goto", position: match.index });
  }
  return calls;
}

function isBootstrapNavigation(
  navigation: { kind: string; position: number },
  traceContext: { firstFunctionalStepPosition?: number; hasContractNavigateStep: boolean }
): boolean {
  if (traceContext.hasContractNavigateStep) return false;
  if (traceContext.firstFunctionalStepPosition === undefined) return false;
  return navigation.position < traceContext.firstFunctionalStepPosition;
}

type AuthFlowCompletionCall = {
  kind: string;
  position: number;
  bindingId?: string;
  coveredScenarioStepIndices: number[];
};

function extractAuthFlowCompletionCalls(specContent: string): AuthFlowCompletionCall[] {
  const calls: AuthFlowCompletionCall[] = [];
  const regex = /authFlow\.ensureAuthenticated\s*\(([^;]*?)\)\s*;?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(specContent)) !== null) {
    const body = match[1] ?? "";
    const bindingId = /["']?bindingId["']?\s*:\s*["']([^"']+)["']/.exec(body)?.[1];
    const coverageBody = /["']?coveredScenarioStepIndices["']?\s*:\s*\[([^\]]*)\]/.exec(body)?.[1] ?? "";
    const coveredScenarioStepIndices = [...coverageBody.matchAll(/\b\d+\b/g)].map((item) => Number(item[0]));
    calls.push({ kind: "authFlow.ensureAuthenticated", position: match.index, bindingId, coveredScenarioStepIndices });
  }
  return calls;
}

export function extractAuthFlowAggregateBindings(specContent: string): Array<{
  bindingId?: string;
  coveredScenarioStepIndices: number[];
  position: number;
}> {
  return extractAuthFlowCompletionCalls(specContent).map((call) => ({
    bindingId: call.bindingId,
    coveredScenarioStepIndices: call.coveredScenarioStepIndices,
    position: call.position,
  }));
}

function getContractTargetValue(step: SpecExecutionContractStep): string | undefined {
  return step.target?.value ?? step.target?.name ?? step.target?.role;
}

export type TraceFidelityResult = {
  status: "passed" | "failed";
  errors: string[];
  expected: number;
  implemented: number;
};

export function computeTraceFidelity(
  specContent: string,
  contract: SpecExecutionContract
): TraceFidelityResult {
  const errors: string[] = [];
  const runtimeCalls = extractRuntimeStepCalls(specContent);
  const directNavigations = extractDirectNavigationCalls(specContent);
  const authCompletions = extractAuthFlowCompletionCalls(specContent);

  const callsByStepIndex = new Map<number, typeof runtimeCalls>();
  for (const call of runtimeCalls) {
    const existing = callsByStepIndex.get(call.stepIndex) ?? [];
    existing.push(call);
    callsByStepIndex.set(call.stepIndex, existing);
  }

  const contractStepIndexes = new Set(contract.steps.map((s) => s.scenarioStepIndex));
  const requiredSteps = contract.steps.filter((step) => step.required !== false);
  const aggregate = contract.auth?.aggregate;
  const declaredAggregateCoverage = new Set(aggregate?.coveredScenarioStepIndices ?? []);
  const validAggregateCall = aggregate
    ? authCompletions.filter((call) =>
        call.bindingId === aggregate.bindingId
        && call.coveredScenarioStepIndices.length === aggregate.coveredScenarioStepIndices.length
        && call.coveredScenarioStepIndices.every((index) => declaredAggregateCoverage.has(index))
      )
    : [];
  const aggregateCoverage = validAggregateCall.length === 1 ? declaredAggregateCoverage : new Set<number>();
  let implemented = 0;
  let lastPosition = -1;

  if (aggregate) {
    if (authCompletions.length === 0) {
      errors.push(`missing_auth_flow_aggregate_binding:bindingId=${aggregate.bindingId}`);
    } else if (authCompletions.length !== 1) {
      errors.push(`auth_flow_aggregate_duplicate_execution:count=${authCompletions.length}`);
    } else if (validAggregateCall.length !== 1) {
      errors.push(`auth_flow_aggregate_partial_or_invalid_binding:bindingId=${aggregate.bindingId}`);
    }
    if (validAggregateCall.length === 1) implemented += aggregate.coveredScenarioStepIndices.length;
  }

  if (aggregateCoverage.size > 0) {
    for (const call of runtimeCalls) {
      if (aggregateCoverage.has(call.stepIndex)) {
        errors.push(`auth_flow_aggregate_duplicate_manual_step:stepIndex=${call.stepIndex}`);
      }
    }
  }

  for (const step of contract.steps) {
    if (aggregateCoverage.has(step.scenarioStepIndex)) {
      continue;
    }
    const calls = callsByStepIndex.get(step.scenarioStepIndex) ?? [];
    if (calls.length === 0) {
      if (step.required !== false) {
        errors.push(`missing_contract_step:stepIndex=${step.scenarioStepIndex}:contractStepIndex=${step.contractStepIndex}:operation=${step.operation}`);
      }
      continue;
    }
    if (step.required !== false) implemented += 1;

    const firstCall = calls.reduce(( earliest, current ) => (current.position < earliest.position ? current : earliest), calls[0]);
    if (firstCall.position < lastPosition) {
      errors.push(`contract_step_order_changed:stepIndex=${step.scenarioStepIndex}:contractStepIndex=${step.contractStepIndex}`);
    }
    lastPosition = firstCall.position;

    const expectedTarget = getContractTargetValue(step);
    if (expectedTarget) {
      const targetPreserved = calls.some((call) =>
        call.target && normalizeOracleMatch(call.target) === normalizeOracleMatch(expectedTarget)
      );
      if (!targetPreserved && step.required !== false) {
        errors.push(`contract_target_changed:stepIndex=${step.scenarioStepIndex}:contractStepIndex=${step.contractStepIndex}:expected="${expectedTarget}"`);
      }
      const candidateBusinessTarget = calls.map((call) => call.target ?? "").filter(Boolean).join("|");
      console.log(`[trace-fidelity-target] scenarioStepIndex=${step.scenarioStepIndex} contractBusinessTarget="${expectedTarget}" candidateBusinessTarget="${candidateBusinessTarget}" matched=${targetPreserved}`);
    }

    if (step.operation === "select" && step.resolvedExecutionTarget) {
      const expectedResolved = normalizeOracleMatch(step.resolvedExecutionTarget);
      let resolvedTargetPreserved = false;
      let candidateResolvedTarget: string | undefined;
      let callbackFound = false;
      let rawBodyLength = 0;
      let candidateLiterals: string[] = [];
      for (const call of calls) {
        if (!call.rawBody) continue;
        rawBodyLength = call.rawBody.length;
        const callbackBody = extractActionCallbackBody(call.rawBody);
        if (callbackBody === undefined) continue;
        callbackFound = true;
        const literals = extractStringLiterals(callbackBody);
        candidateLiterals = literals;
        if (literals.some((lit) => semanticallyEqualText(lit, step.resolvedExecutionTarget!))) {
          resolvedTargetPreserved = true;
          break;
        }
        if (!candidateResolvedTarget && literals.length > 0) {
          candidateResolvedTarget = literals.join("|");
        }
      }
      console.log(`[trace-resolved-target] step=${step.scenarioStepIndex} expected="${step.resolvedExecutionTarget}" normalized="${expectedResolved}" callbackFound=${callbackFound} rawBodyLength=${rawBodyLength} candidateLiterals=${JSON.stringify(candidateLiterals)} preserved=${resolvedTargetPreserved}`);
      if (!resolvedTargetPreserved) {
        const candidateSuffix = candidateResolvedTarget ? `:candidateResolvedTarget="${candidateResolvedTarget}"` : "";
        errors.push(`contract_resolved_target_not_implemented:stepIndex=${step.scenarioStepIndex}:contractStepIndex=${step.contractStepIndex}:expectedResolvedTarget="${step.resolvedExecutionTarget}"${candidateSuffix}`);
      }
    }

    if (step.operation.startsWith("assert") && step.oracle) {
      const oraclePreserved = calls.some((call) =>
        call.method === "expectPromotedVisible" || call.method === "expectPromotedState"
      );
      if (!oraclePreserved && step.required !== false) {
        errors.push(`contract_oracle_changed:stepIndex=${step.scenarioStepIndex}:contractStepIndex=${step.contractStepIndex}:expectedType=${step.oracle.type}`);
      }
    }

    // For page_object click steps, the action callback must invoke the contractual
    // owner.method — not a method belonging to another action.
    if (step.implementation?.kind === "page_object" && step.operation === "click") {
      const impl = step.implementation;
      const expectedMethod = impl.method;
      if (expectedMethod) {
        const observed: string[] = [];
        let methodImplemented = false;
        for (const call of calls) {
          const callbackBody = extractActionCallbackBody(call.rawBody);
          if (callbackBody === undefined) continue;
          for (const qc of extractQualifiedMethodCalls(callbackBody)) {
            observed.push(`${qc.receiver}.${qc.method}`);
            if (qc.method === expectedMethod) methodImplemented = true;
          }
        }
        if (!methodImplemented) {
          errors.push(
            `callback_implementation_mismatch:stepIndex=${step.scenarioStepIndex}:expectedOwner=${impl.owner}:expectedMethod=${impl.method}:observedCalls=${[...new Set(observed)].join(",") || "none"}`
          );
        }
      }
    }

    for (const call of calls) {
      if (call.target && isTechnicalEvidenceMetadata(call.target)) {
        errors.push(`unauthorized_runtime_implementation:stepIndex=${step.scenarioStepIndex}:contractStepIndex=${step.contractStepIndex}:target="${call.target}"`);
      }
    }
  }

  for (const call of runtimeCalls) {
    if (!contractStepIndexes.has(call.stepIndex)) {
      errors.push(`extraneous_business_step:stepIndex=${call.stepIndex}:method=${call.method}`);
    }
  }

  const contractRequiresAuthCompletion = contract.auth?.required === true;
  if (!contractRequiresAuthCompletion && authCompletions.length > 0) {
    errors.push(`extraneous_business_step:kind=authFlow.ensureAuthenticated:count=${authCompletions.length}`);
  }

  const hasContractNavigateStep = contract.steps.some((s) => s.operation === "navigate");
  const firstFunctionalStepPosition = runtimeCalls.length > 0
    ? Math.min(...runtimeCalls.map((call) => call.position))
    : undefined;
  const bootstrapNavigations = directNavigations.filter((navigation) => isBootstrapNavigation(
    navigation,
    { firstFunctionalStepPosition, hasContractNavigateStep }
  ));
  const functionalNavigations = directNavigations.length - bootstrapNavigations.length;
  if (!hasContractNavigateStep && functionalNavigations > 0) {
    errors.push(`extraneous_business_step:kind=page.goto:count=${functionalNavigations}`);
  }

  return {
    status: errors.length === 0 ? "passed" : "failed",
    errors,
    expected: requiredSteps.length,
    implemented
  };
}

export function computeExecutionContractMetrics(contract: SpecExecutionContract): {
  chars: number;
  stepCount: number;
  executableStepCount: number;
} {
  return {
    chars: JSON.stringify(contract).length,
    stepCount: contract.steps.length,
    executableStepCount: contract.steps.filter((s) => s.operation !== "noop").length
  };
}
