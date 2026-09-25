import type { ExecutionPlan, ExecutionPlanStep, PlanAction, PlanTarget } from "../types/execution-plan.types";
import type { PageObjectRegistry } from "../types/page-object.types";
import { deriveSemanticMethodIntent } from "./pom-classification";
import { findMethodBySemanticIntent } from "./page-object-registry";
import { getPreferredOwnerForIntent, METHOD_INTENT_NAME_MAP, ACTION_RUNTIME_METHOD_BY_OPERATION } from "../types/pom-ownership";
import { decodeJsStringLiteralBody, normalizeSemanticText, semanticallyEqualText } from "./semantic-text-normalization";
import { detectCredentialRole } from "../data/data-key-resolver";
import type { AssertionPolarity } from "../scenarios/canonical-scenario";
import {
  materializeTechnicalTarget,
  normalizeDiscoveryEvidence,
  normalizeRecordingEvidence,
  type CertifiedTechnicalTarget,
} from "./technical-target-materializer";

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
  steps?: Array<{ index: number; action: string; description?: string; expected?: string; valueKey?: string; entityScope?: string; rowRelation?: "next" | "added"; selectionField?: string; associatedField?: string; technicalTargetRef?: string; technicalTargetRefs?: string[]; technicalTargetCandidates?: Array<Record<string, unknown>>; semanticRuntimeEvidence?: import("../recording/structural-owner-identity").SemanticRuntimeEvidence; playwrightRecorderEvidence?: import("../recording/structural-owner-identity").PlaywrightRecorderEvidence; resolutionState?: "certified" | "runtime_resolution_required" | "unresolved_unrecoverable"; polarity?: AssertionPolarity; assertionImportance?: "blocking" | "contextual" | "optional"; canonicalAssertion?: import("../scenarios/canonical-scenario").CanonicalAssertion; conditionalAction?: import("../scenarios/canonical-scenario").CanonicalConditionalAction; controlIdentity?: string; recordingActionType?: "fill" | "select" | "click" | "check" | "uncheck" | "press" | "navigation" | "system_observation" }>;
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
  | "press"
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
  entityScope?: string;
  rowRelation?: "next" | "added";
  selectionField?: string;
  /**
   * The field-relation hint the scenario/plan already carries (e.g. "asociado a X" -- see
   * step-intent-parser.ts / testrail.types.ts), transported verbatim -- never re-derived here.
   * Lets `clickPromotedTarget` retry via the SAME shared field-scoped resolver
   * (resolveActionTarget's tryFieldScopedStructuralFallback) Discovery's own live walk already
   * used to pass this step, for `runtime_resolution_required` clicks only. Never used to certify
   * or upgrade resolutionState.
   */
  associatedField?: string;
  technicalTargetRef?: string;
  technicalTargetRefs?: string[];
  /**
   * `CanonicalInteraction.controlIdentity` transported verbatim (see `TestScenarioStep.
   * controlIdentity`, testrail.types.ts) -- content-derived, never positional. Paired with
   * `recordingActionType` below, this is the durable lineage back to the originating Recording
   * action; a caller needing to correlate MUST additionally verify (controlIdentity,
   * recordingActionType) uniqueness within the recording (see `isUniqueLineage`,
   * db/recording-route-observation-repository.ts) before treating it as authoritative.
   */
  controlIdentity?: string;
  /**
   * `RecordingExecutionAction.actionType` transported verbatim -- the recording's own structured
   * action kind (e.g. "select"/"check"/"click"), never inferred from step/target text. Lets a
   * downstream consumer (the deterministic compiler) recognize a selection-like action by real
   * structured authority instead of guessing from a role/label.
   */
  recordingActionType?: "fill" | "select" | "click" | "check" | "uncheck" | "press" | "navigation" | "system_observation";
  /**
   * The CORE-materialized technical identity for this step (see technical-target-materializer.ts),
   * produced from whichever evidence source built this contract (Recording or Discovery) through
   * the SAME materializer. Serializes into plan.json so `identityFromContractStep` can consume it
   * directly at promoted-spec runtime without a live Recording-file lookup.
   */
  certifiedTechnicalTarget?: CertifiedTechnicalTarget;
  /**
   * LAST-RESORT, EXECUTION-ONLY authority (see `SemanticRuntimeEvidence`'s own doc). Transported
   * verbatim from `RecordingExecutionAction.semanticRuntimeEvidence` -- never a certified
   * target/locator, never re-derived from `originalText`/scenario prose. Serializes into
   * plan.json alongside `certifiedTechnicalTarget` so `identityFromContractStep` can consume it
   * at promoted-spec runtime without a live Recording-file lookup.
   */
  semanticRuntimeEvidence?: import("../recording/structural-owner-identity").SemanticRuntimeEvidence;
  playwrightRecorderEvidence?: import("../recording/structural-owner-identity").PlaywrightRecorderEvidence;
  /**
   * Transported verbatim from the upstream authority (CanonicalInteraction.resolutionState /
   * RecordedActionReadiness.runtimeResolutionRequired in canonical-recording-contract.ts) --
   * never recalculated here. "runtime_resolution_required" means the upstream producer already
   * decided this step's identity is intentionally deferred to live resolution (not ambiguous/
   * invalid); "unresolved_unrecoverable" means upstream already decided no recoverable evidence
   * exists. Absent (most current sources don't carry this yet) means no upstream signal either
   * way -- callers must not infer a value in that case.
   */
  resolutionState?: "certified" | "runtime_resolution_required" | "unresolved_unrecoverable";
  /**
   * Structured auth-gate authority for THIS step. Set only when the contract's own auth
   * observation (`auth.gateDetected`) proves the scenario must traverse an auth gate AND this
   * `fill` step is one of the gate's credential fields. Lets the promoted runtime's contextual
   * guard distinguish an AUTH credential fill (compatible with the login/auth-gate screen) from a
   * BUSINESS form fill (which stays fail-closed there). Never derived from field text.
   */
  authGateExpected?: boolean;
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
    case "press": return "press";
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
  planSteps: ExecutionPlanStep[],
  scenarioStepIndex: number
): { oracle?: SpecStepOracle; evidenceRefs: string[] } {
  const evidenceRefs: string[] = [];
  // Oracles are indexed in scenario-step space (case-discovery-workflow.ts assigns
  // oracle.stepIndex from the scenario/recording's own step numbering). The validated
  // plan's step index can be shifted relative to the scenario (e.g. a leading navigate
  // step the scenario does not count), so binding must use the scenario step index here,
  // never the plan step's own index, or an oracle can attach to the wrong scenario step.
  const direct = observableOracles.find((oracle) => oracle.stepIndex === scenarioStepIndex);
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
  const runtimeMethod = ACTION_RUNTIME_METHOD_BY_OPERATION[step.action];
  const runtimeTarget = getStepTargetValue(step);
  // Validated plan actions remain executable through the public promoted
  // runtime even when no active POM owns the exact target. The semantic target
  // stays in the contract; this descriptor only declares the allowed method.
  const runtimeImplementation = runtimeMethod && runtimeTarget
    ? { kind: "runtime" as const, runtimeMethod }
    : undefined;

  if (!registry || registry.pageObjects.length === 0) return runtimeImplementation;
  // Recording-derived contracts keep the validated runtime target and data
  // binding authoritative. A generic runtime descriptor is preferable to a
  // credential-specific POM method (for example fillUsername/fillPassword),
  // which would change the auth-gate semantics of the generated spec.
  if (runtimeImplementation && step.action === "fill") return runtimeImplementation;

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

  return runtimeImplementation;
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

/**
 * Structured auth-gate credential-fill authority. Returns the scenario step indices whose `fill`
 * operation is a credential field of the auth gate the contract itself observed
 * (`auth.gateDetected`). Ownership comes ONLY from existing structured authority, never from step
 * order/position or field text:
 *   (a) the contract's own per-step auth aggregate (`auth.aggregate.coveredScenarioStepIndices`),
 *       used verbatim when present; or
 *   (b) the step's own data-key credential ROLE, resolved through the CORE
 *       `detectCredentialRole` classifier already used for credential resolution
 *       (`data-key-resolver.ts`), gated by the contract's own gate observation.
 * Missing authority yields nothing: the function FAILS CLOSED rather than fabricating auth
 * ownership by position, so a business field on a login surface is only ever marked when its own
 * data key resolves to a credential role.
 */
export function resolveAuthGateFillScenarioStepIndices(
  scenarioSteps: readonly ScenarioStepLike[],
  auth: SpecExecutionContractAuth | undefined,
  planSteps?: readonly { index: number; valueKey?: string }[],
): Set<number> {
  const result = new Set<number>();
  if (!auth || auth.gateDetected !== true) return result;
  const covered = auth.aggregate?.coveredScenarioStepIndices ?? [];
  if (covered.length > 0) {
    const coveredSet = new Set(covered);
    for (const step of scenarioSteps) {
      if (coveredSet.has(step.index) && step.recordingActionType === "fill") result.add(step.index);
    }
    return result;
  }
  const planValueKeyByIndex = new Map<number, string>();
  for (const planStep of planSteps ?? []) {
    if (typeof planStep.valueKey === "string" && planStep.valueKey.length > 0) {
      planValueKeyByIndex.set(planStep.index, planStep.valueKey);
    }
  }
  for (const step of scenarioSteps) {
    if (step.recordingActionType !== "fill") continue;
    const valueKey = planValueKeyByIndex.get(step.index) ?? step.valueKey;
    if (typeof valueKey === "string" && detectCredentialRole(valueKey) !== undefined) {
      result.add(step.index);
    }
  }
  return result;
}

export type ScenarioStepLike = { index: number; action: string; description?: string; expected?: string; valueKey?: string; entityScope?: string; rowRelation?: "next" | "added"; selectionField?: string; associatedField?: string; technicalTargetRef?: string; technicalTargetRefs?: string[]; technicalTargetCandidates?: Array<Record<string, unknown>>; semanticRuntimeEvidence?: import("../recording/structural-owner-identity").SemanticRuntimeEvidence; playwrightRecorderEvidence?: import("../recording/structural-owner-identity").PlaywrightRecorderEvidence; resolutionState?: "certified" | "runtime_resolution_required" | "unresolved_unrecoverable"; assertionImportance?: "blocking" | "contextual" | "optional"; canonicalAssertion?: import("../scenarios/canonical-scenario").CanonicalAssertion; conditionalAction?: import("../scenarios/canonical-scenario").CanonicalConditionalAction; controlIdentity?: string; recordingActionType?: "fill" | "select" | "click" | "check" | "uncheck" | "press" | "navigation" | "system_observation" };

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
  if (/^(check|marcar|tildar|uncheck|desmarcar)\b/.test(lower)) return "click";
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
  // FIRST_LOSS fix: for a press action, any quoted text in the scenario description ("Presionar
  // 'Enter'") is the KEY to send, never the click/business target -- the recorded target owner
  // (the textbox) comes from the validated plan step instead (see the caller's fallback to
  // buildSpecStepTarget(planStep.target)). The key itself already flows through unchanged via
  // planStep?.value, the same generic field a press action's key already used in the raw
  // execution-plan-executor.
  if (operation === "press") return undefined;
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
    // Recording contracts may omit a technical initial navigation, so the
    // contract index can be offset from the validated plan index. Continue to
    // the unique semantic match in that case; a same-operation target mismatch
    // is only foreign when no unique contract-compatible step exists.
  }

  const isPlanOperationCompatible = (step: ExecutionPlanStep): boolean =>
    mapPlanAction(step.action) === operation
    || (operation === "select"
      && step.action === "click"
      && (/\bselect\b/i.test(step.description ?? "") || step.target?.toString().includes("selection_keyboard_typeahead") === true));

  const planTargetMatchesScenario = (step: ExecutionPlanStep): boolean => {
    if (!normalizedScenarioTarget) return true;
    const planTarget = normalizeOracleMatch(getStepTargetValue(step));
    const originalTarget = typeof step.target === "object" && step.target?.metadata && typeof step.target.metadata.originalTarget === "string"
      ? normalizeOracleMatch(step.target.metadata.originalTarget)
      : "";
    return planTarget === normalizedScenarioTarget || originalTarget === normalizedScenarioTarget;
  };

  // A Recording contract starts with its first business action while the
  // validated plan may retain one leading navigate step. Use that explicit
  // structural offset only when the operation proves the candidate and the
  // business target still matches; never fall back to an ordinal locator.
  const leadingNavigateOffset = planSteps[0]?.action === "navigate" && operation !== "navigate" ? 1 : 0;
  if (leadingNavigateOffset > 0) {
    const shifted = planSteps.find((step) =>
      step.index === scenarioStep.index + leadingNavigateOffset
      && isPlanOperationCompatible(step)
      && planTargetMatchesScenario(step)
    );
    if (shifted) return shifted;
  }

  // A recording valueKey is a stronger binding than a shifted plan index and
  // is safe for repeated rows (entity_2 remains distinct from entity_1).
  if (scenarioStep.valueKey) {
    const byValueKey = planSteps.filter((step) =>
      isPlanOperationCompatible(step) && step.valueKey === scenarioStep.valueKey
    );
    if (byValueKey.length === 1) return byValueKey[0];
  }

  // 2. Same operation + same normalized business target.
  if (normalizedScenarioTarget) {
    const byTarget = planSteps.filter((step) => {
      if (!isPlanOperationCompatible(step)) return false;
      return planTargetMatchesScenario(step);
    });
    if (byTarget.length === 1) return byTarget[0];

  }

  // Some recorded selections are executed by a click-level plan action, and
  // state controls can be represented as a click-level plan action, but both
  // retain the exact structured description. That description is an explicit
  // semantic binding, not an ordinal/first/last fallback.
  const normalizedScenarioAction = normalizeOracleMatch(scenarioStep.action);
  const byDescription = planSteps.filter((step) => {
    if (!step.description || normalizeOracleMatch(step.description) !== normalizedScenarioAction) return false;
    const planTarget = getStepTargetValue(step);
    return !normalizedScenarioTarget
      || normalizeOracleMatch(planTarget) === normalizedScenarioTarget
      || normalizeOracleMatch(step.description).includes(normalizedScenarioTarget);
  });
  if (byDescription.length === 1) return byDescription[0];

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

  const contractAuth = resolveAuthContext(plan, sourceScenario);
  const authGateFillScenarioStepIndices = resolveAuthGateFillScenarioStepIndices(requiredScenarioSteps, contractAuth, plan.steps);

  const steps: SpecExecutionContractStep[] = requiredScenarioSteps.map((scenarioStep, index) => {
    // Operation always comes from the scenario step intent, never from the validated plan.
    let operation = classifyScenarioAction(scenarioStep.action, scenarioStep.canonicalAssertion, scenarioStep.conditionalAction);
    const isAssertion = operation.startsWith("assert");

    // Assertions are never enriched from the validated plan (never substituted with
    // navigate/click). Actions look up a traceable plan step for implementation only.
    let planStep = isAssertion
      ? undefined
      : findCompatiblePlanStep(scenarioStep, operation, plan.steps);

    // FIRST_LOSS fix: "presionar"/"pulsar" (Spanish) are genuinely ambiguous between a pointer
    // click and a keyboard key press -- classifyScenarioAction cannot and must not guess from
    // text alone. The validated plan's own recorded action is real structural authority, never
    // inferred from human-readable text. Two cases: (a) a plan step was already matched (by
    // index/target/description) but its OWN recorded action is genuinely "press" -- that
    // authority corrects the ambiguous text classification outright; (b) no click-compatible
    // plan step exists at all -- retry the lookup treating "press" as the candidate operation.
    // An ordinary click with a genuinely click-compatible plan step is completely unaffected.
    if (!isAssertion && operation === "click") {
      if (planStep?.action === "press") {
        operation = "press";
      } else if (!planStep) {
        const pressCandidate = findCompatiblePlanStep(scenarioStep, "press", plan.steps);
        if (pressCandidate) {
          operation = "press";
          planStep = pressCandidate;
        }
      }
    }

    let oracleResult = isAssertion
      ? resolveScenarioStepOracle(scenarioStep, observableOracles, plan.steps)
      : planStep
        ? resolveStepOracle(planStep, observableOracles, plan.steps, scenarioStep.index)
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

    // CORE Technical Target Materializer: recording-sourced steps carry rich structural
    // candidates (technicalTargetCandidates); discovery-sourced steps only have the plan's
    // resolved locator (planStep.target). Both are normalized to the SAME shared materializer —
    // never two separate certification paths — so the display label used above for `target`
    // never becomes the step's primary runtime identity when a stronger one exists.
    const recordingCandidate = Array.isArray(scenarioStep.technicalTargetCandidates)
      ? (scenarioStep.technicalTargetCandidates.find((c) => (c as Record<string, unknown>).validatedByInteraction === true)
        ?? scenarioStep.technicalTargetCandidates[0])
      : undefined;
    const displayLabel = target?.value ?? scenarioTargetText;
    const normalizedEvidence = recordingCandidate
      ? normalizeRecordingEvidence(recordingCandidate, { displayLabel, operation })
      : (planStep?.target && typeof planStep.target === "object"
        ? normalizeDiscoveryEvidence(planStep.target, { displayLabel, operation })
        : undefined);
    const certifiedTechnicalTarget = normalizedEvidence ? materializeTechnicalTarget(normalizedEvidence) : undefined;
    if (certifiedTechnicalTarget) {
      console.log(`[technical-target-materializer] scenarioStepIndex=${scenarioStep.index} source=${certifiedTechnicalTarget.certifiedFrom} tier=${certifiedTechnicalTarget.certificationTier} strategy=${certifiedTechnicalTarget.locatorCandidates[0]?.strategy}`);
    } else if (normalizedEvidence) {
      console.log(`[technical-target-materializer] scenarioStepIndex=${scenarioStep.index} source=${normalizedEvidence.source} result=uncertified`);
    }

    // The validated plan already records, via the existing `recorded:<strategy>` marker
    // (target-resolver.ts's recorded-target consumption path, e.g. field-scoped-fallback),
    // that this step's physical target was successfully re-resolved live and uniquely during
    // discovery. But `recorded:*` alone is NOT sufficient evidence of "defer to runtime" --
    // real steps 4 and 7 also carry a `recorded:*` plan marker while already having an
    // authoritative technicalTargetRef AND a non-ambiguous tier-1 certified structural target;
    // for those, `recorded:*` reflects nothing more than how the plan happened to be produced,
    // and must never downgrade already-strong, already-certified authority. Only when NEITHER
    // a technicalTargetRef NOR a non-ambiguous certified structural target already exists does
    // the `recorded:*` marker mean "physically resolved but still deferred/ambiguous, hand off
    // to the existing runtime resolver" (real step6's exact case). This never recalculates or
    // re-resolves anything: it only transports an already-persisted marker into the SAME
    // resolutionState field an explicit upstream scenarioStep.resolutionState already
    // populates, and never overrides an explicit upstream value or downgrades stronger
    // already-existing authority.
    const hasAuthoritativeTechnicalTargetRef = typeof scenarioStep.technicalTargetRef === "string"
      && scenarioStep.technicalTargetRef.trim().length > 0;
    const certifiedNonAmbiguousStructural = certifiedTechnicalTarget?.targetType === "structural"
      && certifiedTechnicalTarget.structuralContext?.identityAmbiguous !== true
      && !(typeof certifiedTechnicalTarget.structuralContext?.structuralIdentityMatchCount === "number"
        && certifiedTechnicalTarget.structuralContext.structuralIdentityMatchCount > 1);
    const planTargetStrategy = planStep?.target && typeof planStep.target === "object"
      ? (planStep.target as { strategy?: unknown }).strategy
      : undefined;
    const inferredFromValidatedPlan = !hasAuthoritativeTechnicalTargetRef
      && !certifiedNonAmbiguousStructural
      && typeof planTargetStrategy === "string"
      && planTargetStrategy.startsWith("recorded:")
      ? "runtime_resolution_required" as const
      : undefined;
    const resolutionState = scenarioStep.resolutionState ?? inferredFromValidatedPlan;
    if (!scenarioStep.resolutionState && inferredFromValidatedPlan) {
      console.log(`[execution-contract-step] scenarioStepIndex=${scenarioStep.index} resolutionState=${inferredFromValidatedPlan} source=validated_plan_recorded_marker planTargetStrategy=${planTargetStrategy}`);
    }

    return {
      contractStepIndex: index,
      scenarioStepIndex: scenarioStep.index,
      originalText: getScenarioStepOriginalText(scenarioStep),
      operation,
      ...(scenarioStep.conditionalAction ? { conditional: true, conditionalAction: scenarioStep.conditionalAction } : {}),
      target,
      value: planStep?.value,
      valueKey: planStep?.valueKey ?? scenarioStep.valueKey,
      ...(scenarioStep.entityScope ? { entityScope: scenarioStep.entityScope } : {}),
      ...(scenarioStep.rowRelation ? { rowRelation: scenarioStep.rowRelation } : {}),
      ...(scenarioStep.selectionField ? { selectionField: scenarioStep.selectionField } : {}),
      ...(scenarioStep.associatedField ? { associatedField: scenarioStep.associatedField } : {}),
      ...(scenarioStep.technicalTargetRef ? { technicalTargetRef: scenarioStep.technicalTargetRef } : {}),
      ...(scenarioStep.technicalTargetRefs ? { technicalTargetRefs: [...scenarioStep.technicalTargetRefs] } : {}),
      ...(scenarioStep.controlIdentity ? { controlIdentity: scenarioStep.controlIdentity } : {}),
      ...(scenarioStep.recordingActionType ? { recordingActionType: scenarioStep.recordingActionType } : {}),
      ...(operation === "fill" && authGateFillScenarioStepIndices.has(scenarioStep.index) ? { authGateExpected: true } : {}),
      ...(certifiedTechnicalTarget ? { certifiedTechnicalTarget } : {}),
      ...(scenarioStep.semanticRuntimeEvidence ? { semanticRuntimeEvidence: scenarioStep.semanticRuntimeEvidence } : {}),
      ...(scenarioStep.playwrightRecorderEvidence ? { playwrightRecorderEvidence: scenarioStep.playwrightRecorderEvidence } : {}),
      ...(resolutionState ? { resolutionState } : {}),
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
    auth: contractAuth,
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
