import type { RawTestRailCase } from "../types/testrail.types";
import {
  CANONICAL_SCENARIO_SCHEMA_VERSION,
  canonicalRequirementId,
  classifyCanonicalAssertionIntents,
  parseCanonicalAssertion,
  resolveCanonicalAssertionPolarity,
  type CanonicalRequirement,
  type CanonicalScenario,
} from "../scenarios/canonical-scenario";
import { cleanExpectedResult, normalizeTestRailCase } from "./testrail-normalizer";
import { parseStepIntent } from "../discovery/step-intent-parser";
import { extractTestRailInputRequirements } from "./testrail-input-requirements-adapter";

export type TestRailCanonicalAdapterContext = {
  suiteId?: number;
  projectId?: number;
};

export function extractCanonicalInputRequirements(rawCase: RawTestRailCase) {
  return extractTestRailInputRequirements(rawCase).requirements
    .map(annotateCanonicalInputRequirement);
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function splitExpectedResults(value: string | undefined): string[] {
  return value ? uniqueNonEmpty(value.split(/\r?\n+/g)) : [];
}

function annotateCanonicalInputRequirement(requirement: import("../db/project-case-input-requirement-service").InputRequirement) {
  const isExpectedOracle = /(?:^|\.)expected_[a-z0-9_]+$/i.test(requirement.key);
  return {
    ...requirement,
    ...(isExpectedOracle
      ? { valueRole: "expected_oracle" as const, oracleSource: "testrail_declaration" }
      : { valueRole: "runtime_input" as const }),
  };
}

export function canonicalizeTestRailCase(
  rawCase: RawTestRailCase,
  context: TestRailCanonicalAdapterContext = {},
): CanonicalScenario {
  if (!Number.isInteger(rawCase.id) || rawCase.id <= 0) {
    throw new Error("cannot canonicalize TestRail case without a valid case id");
  }
  if (typeof rawCase.title !== "string" || rawCase.title.trim() === "") {
    throw new Error(`cannot canonicalize TestRail case ${rawCase.id} without a title`);
  }

  const normalized = normalizeTestRailCase(rawCase);
  const sourceRef = {
    kind: "testrail" as const,
    caseId: rawCase.id,
    ...(rawCase.section_id !== undefined ? { sectionId: rawCase.section_id } : {}),
    ...(context.suiteId !== undefined ? { suiteId: context.suiteId } : {}),
    ...(context.projectId !== undefined ? { projectId: context.projectId } : {}),
  };
  const originPrefix = `testrail:case:${rawCase.id}`;

  const requirements: CanonicalRequirement[] = [];
  const requirementByDescription = new Map<string, CanonicalRequirement>();
  const requirementFor = (description: string, originRef: string): CanonicalRequirement => {
    const key = description.trim();
    const existing = requirementByDescription.get(key);
    if (existing) return existing;
    const requirement: CanonicalRequirement = {
      requirementId: canonicalRequirementId(originRef),
      kind: "expected_result",
      description: key,
      origin: { originRef },
      ...(classifyCanonicalAssertionIntents(key).length > 0 ? { assertionIntents: classifyCanonicalAssertionIntents(key) } : {}),
    };
    requirementByDescription.set(key, requirement);
    requirements.push(requirement);
    return requirement;
  };

  const steps = normalized.steps.map((step) => {
    const parsedIntent = parseStepIntent(step.action).find((intent) => intent.type !== "unknown");
    const expected = step.expected?.trim();
    const assertionLike = /^(?:validar|verificar|comprobar|assert|check|confirm)/i.test(step.action.trim());
    const canonicalAssertion = parseCanonicalAssertion(step.action);
    const requirement = expected
      ? requirementFor(expected, `${originPrefix}:step:${step.index}:expected`)
      : canonicalAssertion || assertionLike
        ? requirementFor(step.action, `${originPrefix}:step:${step.index}:assertion`)
        : undefined;
    const polarityResolution = canonicalAssertion
      ? resolveCanonicalAssertionPolarity(canonicalAssertion)
      : { reason: "ambiguous" as const };
    if (requirement && polarityResolution.polarity) {
      requirement.polarity = polarityResolution.polarity;
      requirement.polaritySource = "canonical";
      requirement.polarityResolvedAt = "canonical_adapter";
    }
    const resolvedAssertion = canonicalAssertion && polarityResolution.polarity
      ? {
          ...canonicalAssertion,
          polarity: polarityResolution.polarity,
          polaritySource: "canonical" as const,
          polarityResolvedAt: "canonical_adapter" as const,
        }
      : canonicalAssertion;
    return {
      order: step.index,
      action: step.action,
      ...(parsedIntent?.valueKey ? { valueKey: parsedIntent.valueKey } : {}),
      ...(parsedIntent?.entityScope ? { entityScope: parsedIntent.entityScope } : {}),
      ...(parsedIntent?.rowScope !== undefined ? { rowScope: parsedIntent.rowScope } : {}),
      ...(parsedIntent?.rowRelation ? { rowRelation: parsedIntent.rowRelation } : {}),
      ...(parsedIntent?.associatedField ? { associatedField: parsedIntent.associatedField } : {}),
      ...(parsedIntent?.selectionField ? { selectionField: parsedIntent.selectionField } : {}),
      ...(parsedIntent?.expectedValueKey ? { expectedValueKey: parsedIntent.expectedValueKey } : {}),
      ...(expected ? { expected } : {}),
      ...(requirement ? { requirementRefs: [requirement.requirementId] } : {}),
      ...(resolvedAssertion ? { canonicalAssertion: resolvedAssertion, ...(polarityResolution.polarity ? { polarity: polarityResolution.polarity } : {}) } : {}),
      ...(parsedIntent?.conditionalAction ? { conditionalAction: { ...parsedIntent.conditionalAction, condition: { ...parsedIntent.conditionalAction.condition } } } : {}),
      origin: {
        originRef: `${originPrefix}:step:${step.index}`,
        sourcePath: Array.isArray(rawCase.custom_steps_separated)
          ? `custom_steps_separated[${step.index - 1}]`
          : "custom_steps",
        sourceIndex: step.index - 1,
      },
    };
  });
  const expectedResults = uniqueNonEmpty([
    ...splitExpectedResults(cleanExpectedResult(rawCase.custom_expected)),
    ...steps.map((step) => step.expected),
  ]);
  // A case-level expected result is a narrative summary when the case already
  // contains step-owned assertion requirements. Keep it in expectedResults for
  // round-trip fidelity, but do not mint a second requirement identity for the
  // summary. Step requirements remain the authoritative obligations.
  const expectedResultRequirements = steps.some((step) => (step.requirementRefs?.length ?? 0) > 0)
    ? expectedResults.filter((expected) => steps.some((step) => step.expected === expected))
    : expectedResults;
  expectedResultRequirements.forEach((expected, index) => {
    requirementFor(expected, `${originPrefix}:expected:${index + 1}`);
  });
  const expectedResultRequirementRefs = expectedResults.map((expected) =>
    requirementByDescription.get(expected)?.requirementId
  ).filter((value): value is string => Boolean(value));

  return {
    canonicalSchemaVersion: CANONICAL_SCENARIO_SCHEMA_VERSION,
    scenarioId: `testrail-case-${rawCase.id}`,
    sourceRef,
    title: normalized.title,
    preconditions: normalized.preconditions ? [normalized.preconditions] : [],
    steps,
    expectedResults,
    expectedResultRequirementRefs,
    requirements,
    provenance: {
      sourceRef,
      adapterOrGenerator: "testrail-canonical-adapter",
      canonicalizationMode: "deterministic_normalized",
      originRefs: [originPrefix, `${originPrefix}:preconditions`, `${originPrefix}:steps`],
      canonicalSchemaVersion: CANONICAL_SCENARIO_SCHEMA_VERSION,
    },
  };
}
