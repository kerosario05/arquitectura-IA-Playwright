"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const scenario_semantic_enricher_1 = require("./scenario-semantic-enricher");
const scenario_data_semantics_1 = require("./prompts/scenario-data-semantics");
const capability = { kind: "number" };
const requirement = { key: "fixture.amount", label: "Fixture amount", fieldCapability: capability, inputRole: "scenario", valuePolicy: "scenario_controlled", scenarioDataPolicy: "manual_required" };
const profile = { semanticType: "money", generationMode: "synthetic", numeric: { integerOnly: true, decimalScale: 0 } };
function provider(parsedJson, inspect) {
    return {
        providerType: "fake",
        providerName: "fixture",
        model: "fixture-model",
        async completeJson(request) {
            inspect?.(request);
            return { rawText: JSON.stringify(parsedJson), parsedJson: parsedJson, model: "fixture-model", providerName: "fixture", durationMs: 1 };
        },
    };
}
const validResponse = { status: "resolved", confidence: "high", semanticEvidence: [{ source: "requirement", summary: "structured fixture evidence" }], generationProfile: profile };
async function enrichScenarioInputSemantics(input) {
    (0, scenario_semantic_enricher_1.clearScenarioSemanticEnrichmentCache)();
    return (0, scenario_semantic_enricher_1.enrichScenarioInputSemantics)(input);
}
(0, node_test_1.default)("validates semantic enrichment before accepting a profile", async () => {
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider(validResponse) })).status, "accepted");
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, generationProfile: { ...profile, semanticType: "not-valid" } }) })).status, "rejected");
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, confidence: "low" }) })).status, "unresolved");
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, generationProfile: { ...profile, semanticType: "money" } }) })).status, "accepted");
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement: { ...requirement, fieldCapability: { kind: "email" } }, scenarioContext: {}, projectGenerationConfig: {}, provider: provider(validResponse) })).status, "rejected");
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement: { ...requirement, fieldCapability: { kind: "text" } }, scenarioContext: {}, projectGenerationConfig: { availablePools: ["fixture_pool"] }, provider: provider({ ...validResponse, generationProfile: { semanticType: "document_identifier", generationMode: "configured_pool", poolRef: "fixture_pool" } }) })).status, "accepted");
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, generationProfile: { semanticType: "document_identifier", generationMode: "configured_pool", poolRef: "missing" } }) })).status, "rejected");
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, generationProfile: { semanticType: "job_title", generationMode: "configured_dictionary", dictionaryRef: "missing" } }) })).status, "rejected");
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: { ...provider(validResponse), async completeJson() { throw new Error("provider failed"); } } })).status, "unresolved");
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ nope: true }) })).status, "rejected");
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ ...validResponse, extra: true }) })).status, "rejected");
    strict_1.default.equal((await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: { ...provider(validResponse), async completeJson() { return { rawText: "not-json", model: "fixture-model", providerName: "fixture", durationMs: 1 }; } } })).status, "unresolved");
    let serialized = "";
    const safe = await enrichScenarioInputSemantics({ requirement: { ...requirement, runtimeValue: "secret-value" }, scenarioContext: {}, projectGenerationConfig: {}, provider: provider(validResponse, (request) => { serialized = JSON.stringify(request); }) });
    strict_1.default.equal(safe.status, "accepted");
    strict_1.default.equal(serialized.includes("secret-value"), false);
});
(0, node_test_1.default)("reports the first semantic schema error with a safe path", () => {
    const extra = (0, scenario_semantic_enricher_1.validateSemanticResponse)({ status: "resolved", confidence: "high", semanticEvidence: [], extra: "secret" });
    strict_1.default.equal(extra.valid, false);
    if (!extra.valid)
        strict_1.default.deepEqual(extra.errors[0], {
            path: "extra",
            code: "unknown_property",
            expected: "confidence|generationProfile|semanticEvidence|status",
            receivedType: "string",
        });
    const invalidStatus = (0, scenario_semantic_enricher_1.validateSemanticResponse)({ status: "bad", confidence: "high", semanticEvidence: [] });
    strict_1.default.equal(invalidStatus.valid, false);
    if (!invalidStatus.valid)
        strict_1.default.equal(invalidStatus.errors[0].path, "status");
    const invalidEvidence = (0, scenario_semantic_enricher_1.validateSemanticResponse)({ status: "unresolved", confidence: "high", semanticEvidence: [{ source: "wrong", summary: "do not log" }] });
    strict_1.default.equal(invalidEvidence.valid, false);
    if (!invalidEvidence.valid)
        strict_1.default.equal(invalidEvidence.errors[0].path, "semanticEvidence[0].source");
    const invalidProfile = (0, scenario_semantic_enricher_1.validateSemanticResponse)({ status: "resolved", confidence: "high", semanticEvidence: [], generationProfile: { valueKind: "string", sourceMode: "synthetic", unknown: true } });
    strict_1.default.equal(invalidProfile.valid, false);
    if (!invalidProfile.valid)
        strict_1.default.equal(invalidProfile.errors[0].path, "generationProfile.unknown");
    const valid = (0, scenario_semantic_enricher_1.validateSemanticResponse)({ status: "resolved", confidence: "high", semanticEvidence: [], generationProfile: { valueKind: "string", sourceMode: "synthetic" } });
    strict_1.default.equal(valid.valid, true);
});
(0, node_test_1.default)("summarizes only semantic response structure", () => {
    const summary = (0, scenario_semantic_enricher_1.summarizeSemanticResponseShape)({
        status: "resolved", confidence: "high",
        semanticEvidence: [{ source: "requirement", summary: "secret user label" }],
        generationProfile: { valueKind: "string", sourceMode: "synthetic", constraints: { minLength: 2 }, format: { characterSet: "letters" } },
    });
    strict_1.default.deepEqual(summary.topLevelKeys, ["confidence", "generationProfile", "semanticEvidence", "status"]);
    strict_1.default.deepEqual(summary.generationProfileKeys, ["constraints", "format", "sourceMode", "valueKind"]);
    strict_1.default.equal(JSON.stringify(summary).includes("secret user label"), false);
});
(0, node_test_1.default)("emits structured schema diagnostics only when enabled", async () => {
    const original = process.env.DEBUG_SEMANTIC_ENRICHMENT_SCHEMA;
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    try {
        delete process.env.DEBUG_SEMANTIC_ENRICHMENT_SCHEMA;
        const publicResult = await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ status: "resolved", confidence: "high", semanticEvidence: [], extra: true }) });
        strict_1.default.equal(publicResult.reason, "schema_validation_failed");
        strict_1.default.deepEqual(publicResult.validationErrors, ["response_shape_invalid"]);
        strict_1.default.equal(logs.some((line) => line.includes("semantic-enrichment:schema-rejected")), false);
        process.env.DEBUG_SEMANTIC_ENRICHMENT_SCHEMA = "true";
        await enrichScenarioInputSemantics({ requirement, scenarioContext: {}, projectGenerationConfig: {}, provider: provider({ status: "resolved", confidence: "high", semanticEvidence: [], extra: true }) });
        strict_1.default.equal(logs.some((line) => line.includes("semantic-enrichment:schema-rejected")), true);
        strict_1.default.equal(logs.some((line) => line.includes("secret user label")), false);
    }
    finally {
        console.log = originalLog;
        if (original === undefined)
            delete process.env.DEBUG_SEMANTIC_ENRICHMENT_SCHEMA;
        else
            process.env.DEBUG_SEMANTIC_ENRICHMENT_SCHEMA = original;
    }
});
(0, node_test_1.default)("defines the strict semantic response contract without leaking configured values", async () => {
    const prompt = scenario_data_semantics_1.SCENARIO_DATA_SEMANTICS_INSTRUCTIONS;
    for (const key of ["status", "confidence", "semanticEvidence", "generationProfile", "valueKind", "sourceMode", "valueSetRef", "constraints", "format", "semanticHint"]) {
        strict_1.default.equal(prompt.includes(key), true, `prompt must define ${key}`);
    }
    for (const forbidden of ["decision", "result", "answer", "item", "type"]) {
        strict_1.default.equal(new RegExp(`[\\\"']${forbidden}[\\\"']\\s*:`).test(prompt), false, `prompt must not request legacy key ${forbidden}`);
    }
    for (const forbidden of ["semanticType", "generationMode", "poolRef", "dictionaryRef", "numeric", "phone"]) {
        strict_1.default.equal(new RegExp(`\\b${forbidden}\\b`).test(prompt), false, `prompt must not request legacy profile key ${forbidden}`);
    }
    for (const requiredText of ["Return ONLY the JSON object", "Do not return", "code fences", "configured_values", "valueSetRef"]) {
        strict_1.default.equal(prompt.includes(requiredText), true, `prompt must contain ${requiredText}`);
    }
    for (const unnecessary of ["SKILL.md", "roadmap", "full architecture"]) {
        strict_1.default.equal(prompt.includes(unnecessary), false);
    }
    let serialized = "";
    await enrichScenarioInputSemantics({
        requirement,
        scenarioContext: {},
        projectGenerationConfig: { valueSets: [{ ref: "safe", values: ["do-not-send"] }] },
        provider: provider(validResponse, (request) => { serialized = JSON.stringify(request); }),
    });
    strict_1.default.equal(serialized.includes("do-not-send"), false);
});
