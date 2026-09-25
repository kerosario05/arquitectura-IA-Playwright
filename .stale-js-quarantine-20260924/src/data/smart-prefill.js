"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDisplayLabel = resolveDisplayLabel;
exports.validateSmartPrefillAiResponse = validateSmartPrefillAiResponse;
exports.resolveSmartPrefill = resolveSmartPrefill;
const synthetic_value_resolver_1 = require("./synthetic-value-resolver");
function normalizeKey(key) {
    return key.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function humanizeKey(key) {
    return (key.split(".").at(-1) ?? key)
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^./, (char) => char.toUpperCase());
}
function resolveDisplayLabel(requirement) {
    const candidates = [
        [requirement.label, "declared"],
        [requirement.canonicalLabel, "canonical"],
        [requirement.semanticLabel, "semantic"],
        [requirement.targetLabel, "target"],
    ];
    const found = candidates.find(([label]) => typeof label === "string" && label.trim());
    return found ? { label: found[0].trim(), source: found[1] } : { label: humanizeKey(requirement.key), source: "humanized" };
}
function isSecret(requirement) {
    const key = normalizeKey(requirement.key);
    return requirement.sensitive === true || requirement.fieldCapability?.kind === "password"
        || /(^|[._-])(password|pass|token|otp|secret|pin)([._-]|$)/.test(key);
}
function asKnownValue(value) {
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}
function lookup(values, key, fallbackSource) {
    if (!values)
        return undefined;
    const target = normalizeKey(key);
    const entry = Object.entries(values).find(([candidate]) => normalizeKey(candidate) === target)?.[1];
    const value = typeof entry === "object" && entry !== null && "value" in entry ? asKnownValue(entry.value) : asKnownValue(entry);
    if (value === undefined || (typeof value === "string" && !value.trim()))
        return undefined;
    if (typeof entry === "object" && entry !== null && "value" in entry) {
        const source = entry.source;
        if (["user_entered", "selection_runtime", "confirmed_replay", "qa_dataset", "project_config"].includes(source)) {
            return { value, source: source, verified: entry.verified === true };
        }
    }
    return { value, source: fallbackSource, verified: false };
}
function groupIdentity(requirement) {
    if (requirement.datasetIdentity?.trim())
        return requirement.datasetIdentity.trim();
    const segments = requirement.key.split(".");
    const scope = segments.find((segment) => /(?:[_-]\d+|\[\d+\])$/.test(segment));
    return scope ?? "general";
}
function semanticInput(requirement, label, locale) {
    return {
        key: requirement.key,
        label,
        semanticType: requirement.semanticType,
        sensitive: requirement.sensitive,
        fieldCapability: requirement.fieldCapability,
        datasetIdentity: groupIdentity(requirement),
        locale,
    };
}
function buildField(requirement, value, overrides = {}) {
    const label = resolveDisplayLabel(requirement);
    const semanticType = requirement.semanticType ?? (0, synthetic_value_resolver_1.inferSyntheticSemanticType)({ key: requirement.key, label: label.label, fieldCapability: requirement.fieldCapability });
    return {
        key: requirement.key,
        displayLabel: label.label,
        labelSource: label.source,
        semanticType,
        ...(value ? { value: value.value } : {}),
        source: value?.source ?? "missing",
        generated: false,
        verified: value?.verified === true,
        sensitive: isSecret(requirement),
        editable: true,
        datasetIdentity: groupIdentity(requirement),
        ...overrides,
    };
}
function validateSmartPrefillAiResponse(value, allowedKeys) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return { valid: false, reason: "object_required" };
    const root = value;
    if (!Array.isArray(root.fields) || Object.keys(root).some((key) => key !== "fields"))
        return { valid: false, reason: "strict_root_schema" };
    const fields = [];
    for (const item of root.fields) {
        if (!item || typeof item !== "object" || Array.isArray(item))
            return { valid: false, reason: "field_object_required" };
        const field = item;
        const expected = ["key", "semanticType", "displayLabel", "generatedValue", "confidence"];
        if (Object.keys(field).some((key) => !expected.includes(key)) || expected.some((key) => !(key in field)))
            return { valid: false, reason: "strict_field_schema" };
        if (typeof field.key !== "string" || !allowedKeys.has(normalizeKey(field.key)))
            return { valid: false, reason: "unknown_or_mutated_key" };
        if (typeof field.semanticType !== "string" || typeof field.displayLabel !== "string")
            return { valid: false, reason: "field_metadata_invalid" };
        if (asKnownValue(field.generatedValue) === undefined || typeof field.confidence !== "number" || field.confidence < 0 || field.confidence > 1)
            return { valid: false, reason: "field_value_invalid" };
        fields.push({ key: field.key, semanticType: field.semanticType, displayLabel: field.displayLabel, generatedValue: field.generatedValue, confidence: field.confidence });
    }
    return { valid: true, fields };
}
async function resolveSmartPrefill(input) {
    const result = [];
    const generatedByDataset = new Map();
    const unresolvedByGroup = new Map();
    const sourceMaps = [input.currentUserValues, input.selectionRuntimeValues, input.confirmedReplayValues, input.qaDatasetValues, input.projectConfigValues];
    for (const requirement of input.requirements) {
        const secret = isSecret(requirement);
        let known;
        for (const [index, sourceMap] of sourceMaps.entries()) {
            if (secret && index === 2)
                continue; // confirmed replay never carries secrets
            const fallbackSource = ["user_entered", "selection_runtime", "confirmed_replay", "qa_dataset", "project_config"][index];
            known = lookup(sourceMap, requirement.key, fallbackSource);
            if (known)
                break;
        }
        if (known) {
            result.push(buildField(requirement, known));
            continue;
        }
        if (secret) {
            result.push(buildField(requirement));
            continue;
        }
        if (requirement.inputRole === "supporting") {
            result.push(buildField(requirement));
            continue;
        }
        const label = resolveDisplayLabel(requirement).label;
        const dataset = groupIdentity(requirement);
        const relatedValues = generatedByDataset.get(dataset) ?? {};
        const customDeterministic = input.deterministicResolver
            ? await input.deterministicResolver({ requirement, displayLabel: label, datasetIdentity: dataset, relatedValues })
            : undefined;
        const deterministic = customDeterministic === undefined
            ? (0, synthetic_value_resolver_1.generateSemanticSyntheticValue)({ requirement: { ...semanticInput(requirement, label, input.locale), relatedValues }, seed: input.seed })
            : undefined;
        const deterministicValue = customDeterministic?.value ?? deterministic?.value;
        const deterministicSource = customDeterministic?.source ?? "deterministic_synthetic";
        if (customDeterministic?.blocked) {
            result.push(buildField(requirement));
            continue;
        }
        if (deterministicValue !== undefined) {
            result.push(buildField(requirement, undefined, { value: deterministicValue, source: deterministicSource, generated: true, verified: false }));
            const datasetValues = generatedByDataset.get(dataset) ?? {};
            datasetValues[requirement.key] = deterministicValue;
            generatedByDataset.set(dataset, datasetValues);
            continue;
        }
        const group = groupIdentity(requirement);
        unresolvedByGroup.set(group, [...(unresolvedByGroup.get(group) ?? []), requirement]);
    }
    let aiCalls = 0;
    const sensitiveKeysSentToAi = [];
    for (const [datasetIdentity, requirements] of unresolvedByGroup) {
        if (!input.aiFallback) {
            result.push(...requirements.map((requirement) => buildField(requirement)));
            continue;
        }
        aiCalls += 1;
        const allowedKeys = new Set(requirements.map((requirement) => normalizeKey(requirement.key)));
        const response = await input.aiFallback({
            datasetIdentity,
            locale: input.locale,
            fields: requirements.map((requirement) => {
                const label = resolveDisplayLabel(requirement).label;
                return { key: requirement.key, humanLabel: label, semanticType: requirement.semanticType ?? (0, synthetic_value_resolver_1.inferSyntheticSemanticType)({ key: requirement.key, label, fieldCapability: requirement.fieldCapability }), type: requirement.fieldCapability?.kind ?? "unknown", semanticHints: [label, requirement.key] };
            }),
        });
        const validated = validateSmartPrefillAiResponse(response, allowedKeys);
        if (!validated.valid) {
            result.push(...requirements.map((requirement) => buildField(requirement)));
            continue;
        }
        const returned = new Map(validated.fields.map((field) => [normalizeKey(field.key), field]));
        for (const requirement of requirements) {
            const field = returned.get(normalizeKey(requirement.key));
            if (!field) {
                result.push(buildField(requirement));
                continue;
            }
            result.push(buildField(requirement, undefined, { displayLabel: field.displayLabel, labelSource: "ai", semanticType: field.semanticType, value: field.generatedValue, source: "ai_synthetic", generated: true, verified: false, confidence: field.confidence }));
        }
    }
    return { fields: result, aiCalls, sensitiveKeysSentToAi };
}
