import type { extractHuDeclaredItems } from "../knowledge/hu-declared-persister";
import type { InputRequirement } from "../db/project-case-input-requirement-service";
import type { RuntimeInputRequirement } from "../testrail/testrail-runtime-transformer";
import type { RequirementStatus } from "./scenario-types";

export const CANONICAL_SCENARIO_SCHEMA_VERSION = "canonical-scenario-1" as const;

export type CanonicalizationMode =
  | "canonical_passthrough"
  | "deterministic_normalized"
  | "ai_normalized"
  | "unresolved";

export type AssertionPolarity = "positive" | "negative";

export type CanonicalAssertionIntent = "validation_present" | "transition_blocked" | "state_assertion";
export type CanonicalOracleType = "row_scoped_value" | "structural_row_count" | "entity_within_container";

export type CanonicalInputRequirement = InputRequirement & {
  valueRole?: "runtime_input" | "expected_oracle" | "runtime_derived_oracle";
  oracleSource?: string;
  dependsOn?: string[];
};

export type CanonicalAssertion = {
  intent: CanonicalAssertionIntent;
  subject?: string;
  trigger?: string;
  condition?: string;
  expectedState?: string;
  /** Structured relation for the action whose state constrains transition. */
  advanceAction?: string;
  childExpectations?: string[];
  /** Runtime oracle selected at the canonical boundary; never inferred from DOM text. */
  oracleType?: CanonicalOracleType;
  /** Generic prerequisite identity used by temporal eligibility checks. */
  prerequisite?: "source_value_resolved" | "row_added" | "entity_actions_completed" | "container_action_completed";
  /** Resolved only by the canonical adapter; downstream layers consume it. */
  polarity?: AssertionPolarity;
  polaritySource?: "canonical";
  polarityResolvedAt?: "canonical_adapter";
};

export type CanonicalConditionalAction = import("../discovery/step-intent-parser").ConditionalAction;

/**
 * Classifies only generic outcome semantics at the canonical boundary. Runtime
 * execution consumes these intents; it must not reinterpret application text.
 */
export function classifyCanonicalAssertionIntents(description?: string): CanonicalAssertionIntent[] {
  const normalized = (description ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  const intents: CanonicalAssertionIntent[] = [];
  const validationSignal = /\b(validac|validar|validation|validate|error|invalid|invalido|incompleto|feedback|alerta|mensaje|errormessage)\w*/.test(normalized);
  const transitionSignal = /\b(continuar|continue|avanzar|advance|proceder|proceed|siguiente|next|transicion|transition)\w*/.test(normalized);
  const blockSignal = /\b(no permita|no permitir|no puede|cannot|must not|does not|bloque|impid|prevent|deten|hasta que|until)\w*/.test(normalized);
  if (validationSignal) intents.push("validation_present");
  if (transitionSignal && blockSignal) intents.push("transition_blocked");
  if (intents.length === 0 && /\b(validar|verificar|comprobar|confirmar|assert|check|validate|verify)\b/.test(normalized)) {
    intents.push("state_assertion");
  }
  return intents;
}

function trimAssertionPunctuation(value: string): string {
  return value.trim().replace(/[.!?]+$/, "").trim();
}

function assertionMarkerIndex(value: string): number {
  const match = value.match(/\b(validar|verificar|comprobar|confirmar|revisar|assert|check|validate|verify)\b/i);
  return match?.index ?? -1;
}

function hasActionBeforeAssertion(value: string): boolean {
  return /^(?:clic|click|hacer clic|presionar|tocar|seleccionar|escoger|elegir|ingresar|completar|escribir|digitar|navegar|abrir|ir a)\b/i.test(value.trim());
}

function extractQuotedSubject(value: string): string | undefined {
  const match = value.match(/["“‘']([^"”’']+)["”’']/);
  return match?.[1]?.trim() || undefined;
}

function splitChildExpectations(value: string): string[] {
  const parts = value
    .split(/\s+(?:y|e|and)\s+(?=(?:que|no|not|la|el|los|las|un|una|the|a|an)\b)/i)
    .map(trimAssertionPunctuation)
    .filter(Boolean);
  return parts.length > 1 ? parts : [];
}

function inferCanonicalOracleType(value: string, expectedState: string): CanonicalOracleType | undefined {
  const normalized = `${value} ${expectedState}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/\b(dentro|inside|within)\b/.test(normalized) && /\[[^\]]+\]/.test(normalized)) {
    return "entity_within_container";
  }
  if (/\b(?:segunda|second|nueva?|new|agreg(?:ue|ar|ada|ado)|added)\b.*\b(?:linea|fila|row|registro|record)\b|\b(?:linea|fila|row|registro|record)\b.*\b(?:agreg(?:ue|ar|ada|ado)|added|nueva?|new)\b/.test(normalized)) {
    return "structural_row_count";
  }
  if (/\[[^\]]+\]/.test(expectedState) && /\b(?:nombre|name|fecha|date|valor|value|campo|field)\b/.test(normalized)) {
    return "row_scoped_value";
  }
  return undefined;
}

/**
 * Converts one natural-language assertion step into structured metadata while
 * preserving the original step as the authoritative parent. This deliberately
 * uses generic linguistic markers; it never creates additional scenario steps.
 */
export function parseCanonicalAssertion(value?: string): CanonicalAssertion | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return undefined;
  const marker = assertionMarkerIndex(text);
  if (marker < 0) return undefined;
  const prefix = text.slice(0, marker).trim();
  if (hasActionBeforeAssertion(prefix)) return undefined;

  const assertionText = trimAssertionPunctuation(text.slice(marker));
  const normalized = assertionText
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
  const validationSignal = /\b(valid|validation|validar|verificar|error|invalid|invalido|incompleto|feedback|mensaje|alerta)\w*/.test(normalized);
  const transitionSignal = /\b(continuar|continue|avanzar|advance|proceder|proceed|siguiente|next|transicion|transition)\w*/.test(normalized);
  const blockSignal = /\b(no permita|no permitir|no puede|cannot|must not|does not|bloque|impid|prevent|deten|hasta que|until)\w*/.test(normalized);
  const intent: CanonicalAssertionIntent = transitionSignal && blockSignal
    ? "transition_blocked"
    : validationSignal
      ? "validation_present"
      : "state_assertion";

  const afterMarker = assertionText
    .replace(/^(?:validar|verificar|comprobar|confirmar|revisar|assert|check|validate|verify)\s*/i, "")
    .replace(/^que\s*,?\s*/i, "")
    .trim();
  const conditionMatch = afterMarker.match(/^(?:mientras|cuando|siempre que|si|until|until)\s+(.+?)(?:,|;|\s+-\s+)/i);
  const condition = conditionMatch?.[1] ? trimAssertionPunctuation(conditionMatch[1]) : undefined;
  const trigger = /\b(?:al salir|al dejar|al abandonar|on blur|when leaving|after leaving)\b/i.test(prefix)
    ? "leave_field"
    : undefined;
  const expectedState = trimAssertionPunctuation(conditionMatch
    ? afterMarker.slice(conditionMatch[0].length)
    : afterMarker);
  const advanceAction = intent === "transition_blocked"
    ? afterMarker.match(/\b(?:la\s+)?(?:acción|accion|action)\s+["“‘']([^"”’']+)["”’']/i)?.[1]?.trim()
    : undefined;
  const childExpectations = splitChildExpectations(expectedState);
  const oracleType = inferCanonicalOracleType(text, expectedState);
  const prerequisite = oracleType === "entity_within_container"
    ? "container_action_completed"
    : oracleType === "structural_row_count"
      ? "row_added"
      : oracleType === "row_scoped_value"
        ? "source_value_resolved"
        : undefined;

  return {
    intent,
    subject: extractQuotedSubject(text),
    ...(trigger ? { trigger } : {}),
    ...(condition ? { condition } : {}),
    ...(expectedState ? { expectedState } : {}),
    ...(advanceAction ? { advanceAction } : {}),
    ...(childExpectations.length > 0 ? { childExpectations } : {}),
    ...(oracleType ? { oracleType } : {}),
    ...(prerequisite ? { prerequisite } : {}),
  };
}

export type AssertionPolarityClassification = {
  polarity?: AssertionPolarity;
  reason: "presence" | "absence" | "ambiguous";
};

const NEGATIVE_ASSERTION_PATTERNS = [
  /\b(?:ya\s+)?no\b/i,
  /\bdejar(?:se)?\s+de\b/i,
  /\bdesaparec(?:er|e|ido|ida)\b/i,
  /\b(?:ausente|oculto|oculta|hidden|absent)\b/i,
  /\b(?:must|should|does)\s+not\b/i,
];

const POSITIVE_ASSERTION_PATTERNS = [
  /\b(?:se\s+)?muestre\b/i,
  /\b(?:estar|est[ée])\s+(?:visible|activo|activa|presente)\b/i,
  /\b(?:visible|activo|activa|presente|aparece|aparezca)\b/i,
  /\b(?:must|should)\s+(?:be|show|display|exist)\b/i,
];

/**
 * Classifies assertion intent once, at the semantic boundary. Downstream
 * layers must consume this field and never reinterpret natural language.
 */
export function classifyAssertionPolarity(expected?: string): AssertionPolarityClassification {
  const text = typeof expected === "string" ? expected.trim() : "";
  if (!text) return { reason: "ambiguous" };
  if (NEGATIVE_ASSERTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return { polarity: "negative", reason: "absence" };
  }
  if (POSITIVE_ASSERTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return { polarity: "positive", reason: "presence" };
  }
  return { reason: "ambiguous" };
}

export type TestRailCanonicalSourceRef = {
  kind: "testrail";
  caseId: number;
  sectionId?: number;
  suiteId?: number;
  projectId?: number;
};

export type JiraCanonicalSourceRef = {
  kind: "jira";
  issueKey: string;
  sprintId?: number;
  projectKey?: string;
};

export type CanonicalSourceRef = TestRailCanonicalSourceRef | JiraCanonicalSourceRef;

export type StepOrigin = {
  originRef: string;
  sourcePath?: string;
  sourceIndex?: number;
};

export type RequirementOrigin = {
  originRef: string;
  sourcePath?: string;
};

export type CanonicalStep = {
  order: number;
  action: string;
  valueKey?: string;
  entityScope?: string;
  rowScope?: number;
  rowRelation?: "next" | "added";
  associatedField?: string;
  selectionField?: string;
  expectedValueKey?: string;
  expected?: string;
  polarity?: AssertionPolarity;
  requirementRefs?: string[];
  canonicalAssertion?: CanonicalAssertion;
  conditionalAction?: CanonicalConditionalAction;
  origin: StepOrigin;
};

export type CanonicalRequirement = {
  requirementId: string;
  kind: string;
  description: string;
  polarity?: AssertionPolarity;
  polaritySource?: "canonical";
  polarityResolvedAt?: "canonical_adapter";
  assertionIntents?: CanonicalAssertionIntent[];
  branchId?: string;
  origin: RequirementOrigin;
  coverability?: RequirementStatus;
};

export type CanonicalPolarityResolution = {
  polarity?: AssertionPolarity;
  reason: "structured_transition" | "structured_presence" | "structured_state" | "presence" | "absence" | "ambiguous";
};

/**
 * Resolves polarity from structured assertion semantics only. This is the
 * canonical authority; renderers, contracts, and runtime probes must not
 * derive polarity from step order, target text, or observed DOM state.
 */
export function resolveCanonicalAssertionPolarity(
  assertion: Pick<CanonicalAssertion, "intent" | "expectedState">,
): CanonicalPolarityResolution {
  if (assertion.intent === "transition_blocked") {
    return { polarity: "negative", reason: "structured_transition" };
  }
  if (assertion.intent === "validation_present") {
    return { polarity: "positive", reason: "structured_presence" };
  }
  const state = assertion.expectedState?.trim();
  if (!state) return { reason: "ambiguous" };
  const classified = classifyAssertionPolarity(state);
  if (classified.polarity) return classified;
  // A declared state such as disabled/invalid/enabled is a positive assertion
  // about that state, not a negative transition. Unknown state semantics stay
  // unresolved and therefore fail closed.
  if (/\b(disabled|deshabilitad\w*|invalid|invalidad\w*|enabled|habilitad\w*)\b/i.test(state)) {
    return { polarity: "positive", reason: "structured_state" };
  }
  return { reason: "ambiguous" };
}

export type CanonicalBranch = {
  branchId: string;
  requirementRefs: string[];
  conditions?: string[];
  destinationIntent?: string;
};

export type CanonicalScenarioProvenance = {
  sourceRef: CanonicalSourceRef;
  adapterOrGenerator: string;
  canonicalizationMode: CanonicalizationMode;
  originRefs: string[];
  canonicalSchemaVersion: string;
};

export type CanonicalScenario = {
  canonicalSchemaVersion: typeof CANONICAL_SCENARIO_SCHEMA_VERSION;
  scenarioId: string;
  sourceRef: CanonicalSourceRef;
  title: string;
  preconditions: string[];
  steps: CanonicalStep[];
  expectedResults: string[];
  expectedResultRequirementRefs?: string[];
  requirements: CanonicalRequirement[];
  branches?: CanonicalBranch[];
  provenance: CanonicalScenarioProvenance;
};

export function canonicalRequirementId(originRef: string): string {
  return `requirement:${originRef}`;
}

export type StructuredReason = {
  code: string;
  message: string;
  path?: string;
};

export type CanonicalInputDerivationResult = {
  inputRequirements: RuntimeInputRequirement[];
  unresolved: StructuredReason[];
};

export type CanonicalEvaluation = {
  requirementAccounting: ExistingRequirementAccountingResult;
  executionReadiness: string;
  mcpExecutable?: boolean;
  reasons?: StructuredReason[];
};

// Keep the accounting contract sourced from its existing producer until it is exported directly.
export type ExistingRequirementAccountingResult = Parameters<typeof extractHuDeclaredItems>[0];
