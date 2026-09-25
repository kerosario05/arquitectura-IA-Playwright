"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractCanonicalInputRequirements = extractCanonicalInputRequirements;
exports.canonicalizeTestRailCase = canonicalizeTestRailCase;
const canonical_scenario_1 = require("../scenarios/canonical-scenario");
const testrail_normalizer_1 = require("./testrail-normalizer");
const step_intent_parser_1 = require("../discovery/step-intent-parser");
const testrail_input_requirements_adapter_1 = require("./testrail-input-requirements-adapter");
function extractCanonicalInputRequirements(rawCase) {
    return (0, testrail_input_requirements_adapter_1.extractTestRailInputRequirements)(rawCase).requirements
        .map(annotateCanonicalInputRequirement);
}
function uniqueNonEmpty(values) {
    return [...new Set(values.map((value) => value?.trim()).filter((value) => Boolean(value)))];
}
function splitExpectedResults(value) {
    return value ? uniqueNonEmpty(value.split(/\r?\n+/g)) : [];
}
function annotateCanonicalInputRequirement(requirement) {
    const isExpectedOracle = /(?:^|\.)expected_[a-z0-9_]+$/i.test(requirement.key);
    return {
        ...requirement,
        ...(isExpectedOracle
            ? { valueRole: "expected_oracle", oracleSource: "testrail_declaration" }
            : { valueRole: "runtime_input" }),
    };
}
function canonicalizeTestRailCase(rawCase, context = {}) {
    if (!Number.isInteger(rawCase.id) || rawCase.id <= 0) {
        throw new Error("cannot canonicalize TestRail case without a valid case id");
    }
    if (typeof rawCase.title !== "string" || rawCase.title.trim() === "") {
        throw new Error(`cannot canonicalize TestRail case ${rawCase.id} without a title`);
    }
    const normalized = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
    const sourceRef = {
        kind: "testrail",
        caseId: rawCase.id,
        ...(rawCase.section_id !== undefined ? { sectionId: rawCase.section_id } : {}),
        ...(context.suiteId !== undefined ? { suiteId: context.suiteId } : {}),
        ...(context.projectId !== undefined ? { projectId: context.projectId } : {}),
    };
    const originPrefix = `testrail:case:${rawCase.id}`;
    const requirements = [];
    const requirementByDescription = new Map();
    const requirementFor = (description, originRef) => {
        const key = description.trim();
        const existing = requirementByDescription.get(key);
        if (existing)
            return existing;
        const requirement = {
            requirementId: (0, canonical_scenario_1.canonicalRequirementId)(originRef),
            kind: "expected_result",
            description: key,
            origin: { originRef },
            ...((0, canonical_scenario_1.classifyCanonicalAssertionIntents)(key).length > 0 ? { assertionIntents: (0, canonical_scenario_1.classifyCanonicalAssertionIntents)(key) } : {}),
        };
        requirementByDescription.set(key, requirement);
        requirements.push(requirement);
        return requirement;
    };
    const steps = normalized.steps.map((step) => {
        const parsedIntent = (0, step_intent_parser_1.parseStepIntent)(step.action).find((intent) => intent.type !== "unknown");
        const expected = step.expected?.trim();
        const assertionLike = /^(?:validar|verificar|comprobar|assert|check|confirm)/i.test(step.action.trim());
        const canonicalAssertion = (0, canonical_scenario_1.parseCanonicalAssertion)(step.action);
        const requirement = expected
            ? requirementFor(expected, `${originPrefix}:step:${step.index}:expected`)
            : canonicalAssertion || assertionLike
                ? requirementFor(step.action, `${originPrefix}:step:${step.index}:assertion`)
                : undefined;
        const polarityResolution = canonicalAssertion
            ? (0, canonical_scenario_1.resolveCanonicalAssertionPolarity)(canonicalAssertion)
            : { reason: "ambiguous" };
        if (requirement && polarityResolution.polarity) {
            requirement.polarity = polarityResolution.polarity;
            requirement.polaritySource = "canonical";
            requirement.polarityResolvedAt = "canonical_adapter";
        }
        const resolvedAssertion = canonicalAssertion && polarityResolution.polarity
            ? {
                ...canonicalAssertion,
                polarity: polarityResolution.polarity,
                polaritySource: "canonical",
                polarityResolvedAt: "canonical_adapter",
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
        ...splitExpectedResults((0, testrail_normalizer_1.cleanExpectedResult)(rawCase.custom_expected)),
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
    const expectedResultRequirementRefs = expectedResults.map((expected) => requirementByDescription.get(expected)?.requirementId).filter((value) => Boolean(value));
    return {
        canonicalSchemaVersion: canonical_scenario_1.CANONICAL_SCENARIO_SCHEMA_VERSION,
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
            canonicalSchemaVersion: canonical_scenario_1.CANONICAL_SCENARIO_SCHEMA_VERSION,
        },
    };
}
