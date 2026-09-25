"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarizeSemanticResponseShape = summarizeSemanticResponseShape;
exports.validateSemanticResponse = validateSemanticResponse;
exports.validateProjectGenerationReferences = validateProjectGenerationReferences;
exports.clearScenarioSemanticEnrichmentCache = clearScenarioSemanticEnrichmentCache;
exports.enrichScenarioInputSemantics = enrichScenarioInputSemantics;
const ai_provider_factory_1 = require("./ai-provider-factory");
const ai_json_validator_1 = require("./ai-json-validator");
const generation_profile_1 = require("../testrail/generation-profile");
const project_generation_config_1 = require("../data/project-generation-config");
const scenario_data_semantics_1 = require("./prompts/scenario-data-semantics");
const SEMANTIC_TYPES = new Set([
    "money", "phone", "email", "document_identifier", "job_title", "person_name",
    "quantity", "percentage", "date", "datetime", "generic_text", "unknown",
]);
const GENERATION_MODES = new Set(["synthetic", "configured_pool", "configured_dictionary", "manual"]);
const ROOT_KEYS = new Set(["status", "confidence", "semanticEvidence", "generationProfile"]);
const PROFILE_KEYS = new Set(["semanticType", "generationMode", "numeric", "phone", "poolRef", "dictionaryRef", "format"]);
const NUMERIC_KEYS = new Set(["integerOnly", "decimalScale", "min", "max", "step"]);
const PHONE_KEYS = new Set(["allowedPrefixes", "totalDigits", "maskPattern"]);
const FORMAT_KEYS = new Set(["pattern", "mask"]);
const enrichmentCache = new Map();
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every((key) => allowed.has(key));
}
function receivedType(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "array";
    return typeof value;
}
function schemaError(path, code, expected, value) {
    return { path, code, expected, receivedType: receivedType(value) };
}
function publicSchemaErrorCode(error) {
    if (error.path === "status" || error.path === "confidence")
        return "response_status_or_confidence_invalid";
    if (error.path === "semanticEvidence" || error.path.startsWith("semanticEvidence["))
        return "semantic_evidence_invalid";
    if (error.path === "generationProfile" || error.path.startsWith("generationProfile."))
        return error.code === "required" ? "resolved_profile_missing" : "generation_profile_shape_invalid";
    return "response_shape_invalid";
}
function firstUnknownKey(value, allowed, prefix) {
    const key = Object.keys(value).find((candidate) => !allowed.has(candidate));
    return key === undefined ? undefined : schemaError(`${prefix}.${key}`, "unknown_property", [...allowed].sort().join("|"), value[key]);
}
function validOptionalProfileObjects(profile) {
    if (profile.valueSetRef !== undefined && typeof profile.valueSetRef !== "string")
        return false;
    if (profile.semanticHint !== undefined && typeof profile.semanticHint !== "string")
        return false;
    if (profile.constraints !== undefined) {
        if (!isRecord(profile.constraints) || !hasOnlyKeys(profile.constraints, new Set(["min", "max", "step", "integerOnly", "decimalScale", "minLength", "maxLength", "pattern"])))
            return false;
        if (Object.entries(profile.constraints).some(([key, value]) => key === "integerOnly" ? typeof value !== "boolean" : typeof value !== "number" && typeof value !== "string"))
            return false;
    }
    if (profile.numeric !== undefined) {
        if (!isRecord(profile.numeric) || !hasOnlyKeys(profile.numeric, NUMERIC_KEYS))
            return false;
        if (profile.numeric.integerOnly !== undefined && typeof profile.numeric.integerOnly !== "boolean")
            return false;
        if (Object.entries(profile.numeric).some(([key, value]) => key !== "integerOnly" && (typeof value !== "number" || !Number.isFinite(value))))
            return false;
    }
    if (profile.phone !== undefined) {
        if (!isRecord(profile.phone) || !hasOnlyKeys(profile.phone, PHONE_KEYS))
            return false;
        if (profile.phone.allowedPrefixes !== undefined && (!Array.isArray(profile.phone.allowedPrefixes) || profile.phone.allowedPrefixes.some((value) => typeof value !== "string")))
            return false;
        if (profile.phone.totalDigits !== undefined && (typeof profile.phone.totalDigits !== "number" || !Number.isFinite(profile.phone.totalDigits)))
            return false;
        if (profile.phone.maskPattern !== undefined && typeof profile.phone.maskPattern !== "string")
            return false;
    }
    if (profile.format !== undefined) {
        if (!isRecord(profile.format) || !hasOnlyKeys(profile.format, new Set([...FORMAT_KEYS, "allowedPrefixes", "totalLength", "characterSet"])))
            return false;
        if (Object.entries(profile.format).some(([key, value]) => ["mask", "pattern", "characterSet"].includes(key) ? typeof value !== "string" : key === "totalLength" ? typeof value !== "number" : !Array.isArray(value) || value.some((prefix) => typeof prefix !== "string")))
            return false;
    }
    if (profile.poolRef !== undefined && typeof profile.poolRef !== "string")
        return false;
    if (profile.dictionaryRef !== undefined && typeof profile.dictionaryRef !== "string")
        return false;
    return true;
}
function summarizeSemanticResponseShape(value) {
    const record = isRecord(value) ? value : {};
    const evidence = record.semanticEvidence;
    const profile = isRecord(record.generationProfile) ? record.generationProfile : undefined;
    const summary = {
        topLevelKeys: Object.keys(record).sort(),
        statusType: receivedType(record.status),
        confidenceType: receivedType(record.confidence),
        semanticEvidenceType: receivedType(evidence),
        generationProfilePresent: profile !== undefined,
    };
    if (typeof record.status === "string")
        summary.statusValue = record.status;
    if (typeof record.confidence === "string")
        summary.confidenceValue = record.confidence;
    if (Array.isArray(evidence)) {
        summary.semanticEvidenceLength = evidence.length;
        const first = evidence[0];
        if (isRecord(first))
            summary.semanticEvidenceItemKeys = Object.keys(first).sort();
    }
    if (profile) {
        summary.generationProfileKeys = Object.keys(profile).sort();
        if (isRecord(profile.constraints))
            summary.constraintsKeys = Object.keys(profile.constraints).sort();
        if (isRecord(profile.format))
            summary.formatKeys = Object.keys(profile.format).sort();
    }
    return summary;
}
function validateSemanticResponse(value) {
    if (!isRecord(value))
        return { valid: false, errors: [schemaError("$", "invalid_type", "object", value)] };
    const unknownRoot = firstUnknownKey(value, ROOT_KEYS, "");
    if (unknownRoot)
        unknownRoot.path = unknownRoot.path.slice(1);
    if (unknownRoot)
        return { valid: false, errors: [unknownRoot] };
    if (value.status !== "resolved" && value.status !== "unresolved") {
        return { valid: false, errors: [schemaError("status", "invalid_enum", "resolved|unresolved", value.status)] };
    }
    if (!["high", "medium", "low"].includes(String(value.confidence))) {
        return { valid: false, errors: [schemaError("confidence", "invalid_enum", "high|medium|low", value.confidence)] };
    }
    if (!Array.isArray(value.semanticEvidence))
        return { valid: false, errors: [schemaError("semanticEvidence", "invalid_type", "array", value.semanticEvidence)] };
    for (const [index, item] of value.semanticEvidence.entries()) {
        if (!isRecord(item))
            return { valid: false, errors: [schemaError(`semanticEvidence[${index}]`, "invalid_type", "object", item)] };
        const unknownEvidence = firstUnknownKey(item, new Set(["source", "summary"]), `semanticEvidence[${index}]`);
        if (unknownEvidence)
            return { valid: false, errors: [unknownEvidence] };
        if (!["scenario", "requirement", "project_config"].includes(String(item.source)))
            return { valid: false, errors: [schemaError(`semanticEvidence[${index}].source`, "invalid_enum", "scenario|requirement|project_config", item.source)] };
        if (typeof item.summary !== "string")
            return { valid: false, errors: [schemaError(`semanticEvidence[${index}].summary`, "invalid_type", "string", item.summary)] };
    }
    if (value.status === "resolved" && !isRecord(value.generationProfile))
        return { valid: false, errors: [schemaError("generationProfile", "required", "object", value.generationProfile)] };
    if (value.generationProfile !== undefined) {
        const profile = value.generationProfile;
        if (!isRecord(profile))
            return { valid: false, errors: [schemaError("generationProfile", "invalid_type", "object", profile)] };
        const allowedProfileKeys = new Set([...PROFILE_KEYS, "valueKind", "sourceMode", "valueSetRef", "constraints", "semanticHint"]);
        const unknownProfile = firstUnknownKey(profile, allowedProfileKeys, "generationProfile");
        if (unknownProfile)
            return { valid: false, errors: [unknownProfile] };
        const technical = isRecord(profile) && (profile.valueKind !== undefined || profile.sourceMode !== undefined);
        if (!validOptionalProfileObjects(profile)
            || (technical ? !["string", "number", "boolean", "date", "datetime"].includes(String(profile.valueKind)) || !["synthetic", "configured_values", "manual"].includes(String(profile.sourceMode))
                : !SEMANTIC_TYPES.has(String(profile.semanticType)) || !GENERATION_MODES.has(String(profile.generationMode)))) {
            const path = technical
                ? (!(["string", "number", "boolean", "date", "datetime"].includes(String(profile.valueKind))) ? "generationProfile.valueKind" : "generationProfile.sourceMode")
                : (!SEMANTIC_TYPES.has(String(profile.semanticType)) ? "generationProfile.semanticType" : "generationProfile.generationMode");
            const expected = path.endsWith("valueKind") ? "string|number|boolean|date|datetime" : path.endsWith("sourceMode") ? "synthetic|configured_values|manual" : path.endsWith("semanticType") ? [...SEMANTIC_TYPES].join("|") : [...GENERATION_MODES].join("|");
            return { valid: false, errors: [schemaError(path, "invalid_enum", expected, profile[path.split(".").pop()])] };
        }
    }
    return { valid: true, response: value };
}
function validateProjectGenerationReferences(profile, config = {}) {
    const safeConfig = "valueSets" in config || "namedProfiles" in config
        ? (0, project_generation_config_1.toSemanticEnrichmentConfig)(config)
        : config;
    if (profile.sourceMode === "configured_values" && !safeConfig.availableValueSetRefs?.includes(profile.valueSetRef ?? "")) {
        return { valid: false, reason: "value_set_reference_not_configured" };
    }
    if (profile.generationMode === "configured_pool" && !safeConfig.availablePools?.includes(profile.poolRef ?? "")) {
        return { valid: false, reason: "pool_reference_not_configured" };
    }
    if (profile.generationMode === "configured_dictionary" && !safeConfig.availableDictionaries?.includes(profile.dictionaryRef ?? "")) {
        return { valid: false, reason: "dictionary_reference_not_configured" };
    }
    if (profile.semanticType === "phone" && profile.phone && (safeConfig.phoneProfiles?.length ?? 0) === 0) {
        return { valid: false, reason: "phone_profile_not_configured" };
    }
    return { valid: true };
}
function semanticInput(requirement, scenarioContext, config) {
    return {
        requirement: {
            key: requirement.key,
            label: requirement.label,
            fieldCapability: requirement.fieldCapability,
            inputRole: requirement.inputRole,
            valuePolicy: requirement.valuePolicy,
            scenarioDataPolicy: requirement.scenarioDataPolicy,
            generationProfile: requirement.generationProfile,
        },
        scenarioContext: {
            title: scenarioContext.title,
            preconditions: scenarioContext.preconditions,
            steps: scenarioContext.steps,
            expected: scenarioContext.expected,
        },
        projectGenerationConfig: config,
    };
}
function safeSemanticConfig(config) {
    return "valueSets" in config || "namedProfiles" in config || "pools" in config || "dictionaries" in config || "moneyProfiles" in config
        ? (0, project_generation_config_1.toSemanticEnrichmentConfig)(config)
        : config;
}
function stableSerialize(value) {
    if (Array.isArray(value))
        return `[${value.map(stableSerialize).join(",")}]`;
    if (isRecord(value))
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
}
function clearScenarioSemanticEnrichmentCache() {
    enrichmentCache.clear();
}
async function enrichScenarioInputSemantics(input) {
    try {
        const provider = input.provider ?? await (0, ai_provider_factory_1.createScenarioSemanticAiProvider)();
        const config = safeSemanticConfig(input.projectGenerationConfig ?? {});
        const semanticPayload = semanticInput(input.requirement, input.scenarioContext, config);
        const cacheKey = `${scenario_data_semantics_1.SCENARIO_DATA_SEMANTICS_VERSION}:${stableSerialize(semanticPayload)}`;
        const cached = enrichmentCache.get(cacheKey);
        if (cached)
            return cached;
        const completion = await provider.completeJson({
            purpose: "scenario_data_semantic_enrichment",
            requireJson: true,
            messages: [
                { role: "system", content: scenario_data_semantics_1.SCENARIO_DATA_SEMANTICS_INSTRUCTIONS },
                { role: "user", content: JSON.stringify(semanticPayload) },
            ],
            temperature: 0,
        });
        const parsed = completion.parsedJson ?? (0, ai_json_validator_1.parseJsonObjectText)(completion.rawText);
        const shape = validateSemanticResponse(parsed);
        if (!shape.valid) {
            if (process.env.DEBUG_SEMANTIC_ENRICHMENT_SCHEMA === "true") {
                const summary = summarizeSemanticResponseShape(parsed);
                const first = shape.errors[0];
                console.log("[semantic-enrichment:schema-rejected]");
                console.log(`topLevelKeys=${summary.topLevelKeys.join(",")}`);
                console.log(`generationProfileKeys=${summary.generationProfileKeys?.join(",") ?? ""}`);
                console.log(`firstErrorPath=${first.path}`);
                console.log(`firstErrorCode=${first.code}`);
                console.log(`expected=${first.expected}`);
                console.log(`receivedType=${first.receivedType}`);
            }
            const result = { status: "rejected", reason: "schema_validation_failed", validationErrors: shape.errors.map(publicSchemaErrorCode) };
            enrichmentCache.set(cacheKey, result);
            return result;
        }
        const response = shape.response;
        if (response.confidence === "low")
            return { status: "unresolved", confidence: response.confidence, semanticEvidence: response.semanticEvidence, reason: "low_confidence" };
        if (response.status !== "resolved" || !response.generationProfile)
            return { status: "unresolved", confidence: response.confidence, semanticEvidence: response.semanticEvidence, reason: "semantic_resolution_unresolved" };
        const profileValidation = (0, generation_profile_1.validateGenerationProfile)({ fieldCapability: input.requirement.fieldCapability, generationProfile: response.generationProfile });
        if (!profileValidation.valid) {
            const result = { status: "rejected", confidence: response.confidence, semanticEvidence: response.semanticEvidence, reason: "generation_profile_invalid", validationErrors: [profileValidation.reason ?? "profile_invalid"] };
            enrichmentCache.set(cacheKey, result);
            return result;
        }
        const configValidation = validateProjectGenerationReferences(response.generationProfile, config);
        if (!configValidation.valid) {
            const result = { status: "rejected", confidence: response.confidence, semanticEvidence: response.semanticEvidence, reason: "project_config_invalid", validationErrors: [configValidation.reason ?? "project_config_invalid"] };
            enrichmentCache.set(cacheKey, result);
            return result;
        }
        const result = { status: "accepted", confidence: response.confidence, semanticEvidence: response.semanticEvidence, generationProfile: response.generationProfile };
        enrichmentCache.set(cacheKey, result);
        return result;
    }
    catch (error) {
        return { status: "unresolved", reason: error instanceof Error ? error.message : String(error) };
    }
}
