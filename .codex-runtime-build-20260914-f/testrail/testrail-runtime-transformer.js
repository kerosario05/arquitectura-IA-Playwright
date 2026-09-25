"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRuntimeInputRole = resolveRuntimeInputRole;
exports.transformTestRailCaseForRuntime = transformTestRailCaseForRuntime;
const testrail_normalizer_1 = require("./testrail-normalizer");
const testrail_requirement_converter_1 = require("./testrail-requirement-converter");
const testrail_requirement_proposal_engine_1 = require("./testrail-requirement-proposal-engine");
const field_capability_1 = require("./field-capability");
const runtime_value_policy_1 = require("./runtime-value-policy");
const scenario_data_policy_1 = require("./scenario-data-policy");
const ENTITY_LOCALIZATION = {
    account: "Cuenta",
    company: "Empresa",
    customer: "Cliente",
    employee: "Empleado",
    item: "Elemento",
    user: "Usuario",
};
function humanize(value) {
    return value
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^./, (char) => char.toUpperCase());
}
function indexedDatasetMetadata(key) {
    const segment = key.split(".").find((part) => /(?:[_-]\d+|\[\d+\])$/.test(part));
    const match = segment?.match(/^(.*?)(?:[_-](\d+)|\[(\d+)\])$/);
    if (!match?.[1])
        return undefined;
    const identity = match[1];
    return {
        datasetIdentity: identity,
        datasetOrdinal: Number(match[2] ?? match[3]),
        entityDisplayName: ENTITY_LOCALIZATION[identity.toLowerCase()] ?? humanize(identity),
    };
}
function semanticFieldLabel(label, metadata) {
    if (!label?.trim())
        return undefined;
    const value = label.trim();
    if (!metadata)
        return value;
    const entity = metadata.entityDisplayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const identity = humanize(metadata.datasetIdentity).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ordinal = String(metadata.datasetOrdinal);
    const suffix = new RegExp(`(?:\\s|[-_:])*?(?:${entity}|${identity})?\\s*${ordinal}\\s*$`, "i");
    const stripped = value.replace(suffix, "").trim();
    return stripped || value;
}
function inputRequirementLineage(requirement) {
    if (/(?:^|\.)expected_[a-z0-9_]+$/i.test(requirement.key)) {
        return { valueRole: "expected_oracle", oracleSource: "testrail_declaration" };
    }
    return {};
}
function structurallyReferencedRequirementKeys(normalizedScenario) {
    const keys = new Set();
    for (const step of normalizedScenario.steps) {
        for (const key of step.requirementRefs ?? [])
            keys.add(key);
        for (const key of step.inputIntent?.requirementRefs ?? [])
            keys.add(key);
    }
    return keys;
}
function resolveRuntimeInputRole(requirement, referencedKeys) {
    if (requirement.inputRole !== undefined)
        return requirement.inputRole;
    if (requirement.source === "contract" || requirement.provenance === "placeholder_reference")
        return "scenario";
    if (referencedKeys.has(requirement.key))
        return "scenario";
    return undefined;
}
function sameMetadata(left, right) {
    return left.label === right.label
        && left.controlType === right.controlType
        && left.required === right.required
        && left.sensitive === right.sensitive
        && JSON.stringify(left.allowedValues) === JSON.stringify(right.allowedValues);
}
function inputRequirementFromProposal(proposal) {
    return {
        key: proposal.key,
        ...(proposal.label !== undefined ? { label: proposal.label } : {}),
        ...(proposal.controlType !== undefined ? { controlType: proposal.controlType } : {}),
        ...(proposal.required !== undefined ? { required: proposal.required } : {}),
        ...(proposal.sensitive !== undefined ? { sensitive: proposal.sensitive } : {}),
        ...(proposal.allowedValues !== undefined ? { allowedValues: [...proposal.allowedValues] } : {}),
        ...(proposal.inputRole !== undefined ? { inputRole: proposal.inputRole } : {}),
        ...(proposal.inputUsage !== undefined ? { inputUsage: [...proposal.inputUsage] } : {}),
        ...(proposal.provenance !== undefined ? { provenance: proposal.provenance } : {}),
        ...(proposal.generationProfile !== undefined ? { generationProfile: proposal.generationProfile } : {}),
    };
}
function transformTestRailCaseForRuntime(rawCase, dependencies = {}) {
    const normalize = dependencies.normalize ?? testrail_normalizer_1.normalizeTestRailCase;
    const convert = dependencies.convert ?? ((input) => (0, testrail_requirement_converter_1.convertTestRailRequirements)(input));
    const propose = dependencies.propose ?? testrail_requirement_proposal_engine_1.proposeTestRailInputRequirements;
    const normalizedScenario = normalize(rawCase);
    const converterOutput = convert({ caseId: rawCase.id, rawCase });
    const proposalOutput = propose({ rawCase, converterOutput });
    const conflicts = [...converterOutput.conflicts];
    const referencedKeys = structurallyReferencedRequirementKeys(normalizedScenario);
    const runtimeRequirements = converterOutput.requirements.map((requirement) => {
        const fieldCapability = (0, field_capability_1.resolveFieldCapability)(requirement);
        const inputRole = resolveRuntimeInputRole({ ...requirement, source: "contract" }, referencedKeys);
        const dataset = indexedDatasetMetadata(requirement.key);
        const displayLabel = semanticFieldLabel(requirement.label, dataset)
            ?? requirement.label
            ?? requirement.key.split(".").at(-1);
        return {
            ...requirement,
            ...inputRequirementLineage(requirement),
            ...(displayLabel ? { displayLabel, semanticField: displayLabel } : {}),
            technicalLabel: requirement.key,
            ...(dataset ?? {}),
            ...(inputRole !== undefined ? { inputRole } : {}),
            source: "contract",
            provenance: "contract_declaration",
            fieldCapability,
            valuePolicy: (0, runtime_value_policy_1.resolveRuntimeInputValuePolicy)({ ...requirement, inputRole, fieldCapability }),
            scenarioDataPolicy: (0, scenario_data_policy_1.resolveScenarioDataPolicy)({ ...requirement, inputRole, source: "contract", fieldCapability }),
        };
    });
    const byKey = new Map(runtimeRequirements.map((requirement) => [requirement.key, requirement]));
    for (const proposal of proposalOutput.proposals) {
        const incoming = inputRequirementFromProposal(proposal);
        const existing = byKey.get(incoming.key);
        if (existing) {
            if (!sameMetadata(existing, incoming))
                conflicts.push({ key: incoming.key, existing, incoming });
            continue;
        }
        const fieldCapability = (0, field_capability_1.resolveFieldCapability)(incoming);
        const inputRole = resolveRuntimeInputRole(incoming, referencedKeys);
        const runtimeRequirement = {
            ...incoming,
            ...inputRequirementLineage(incoming),
            ...(inputRole !== undefined ? { inputRole } : {}),
            source: "runtime_inferred",
            fieldCapability,
            valuePolicy: (0, runtime_value_policy_1.resolveRuntimeInputValuePolicy)({ ...incoming, inputRole, fieldCapability }),
            scenarioDataPolicy: (0, scenario_data_policy_1.resolveScenarioDataPolicy)({ ...incoming, inputRole, source: "runtime_inferred", fieldCapability }),
        };
        byKey.set(runtimeRequirement.key, runtimeRequirement);
        runtimeRequirements.push(runtimeRequirement);
    }
    const resolvedKeys = new Set(runtimeRequirements.map((requirement) => requirement.key));
    const unresolvedPlaceholders = [...new Set([
            ...converterOutput.unresolvedPlaceholders,
            ...proposalOutput.unresolved,
        ])].filter((key) => !resolvedKeys.has(key));
    return {
        normalizedScenario,
        inputRequirements: runtimeRequirements,
        unresolvedPlaceholders,
        conflicts,
    };
}
