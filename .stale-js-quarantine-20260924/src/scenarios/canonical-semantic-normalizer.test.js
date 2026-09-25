"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const canonical_semantic_normalizer_1 = require("./canonical-semantic-normalizer");
const canonical_semantic_proposal_1 = require("./canonical-semantic-proposal");
const scenario = {
    canonicalSchemaVersion: "canonical-scenario-1",
    scenarioId: "scenario-1",
    sourceRef: { kind: "testrail", caseId: 1 },
    title: "Recover account",
    preconditions: ["Account exists"],
    steps: [{ order: 1, action: "Enter account", expected: "Account accepted", origin: { originRef: "step-1" } }],
    expectedResults: ["Recovery completes"],
    requirements: [],
    provenance: {
        sourceRef: { kind: "testrail", caseId: 1 },
        adapterOrGenerator: "test",
        canonicalizationMode: "deterministic_normalized",
        originRefs: ["case-1"],
        canonicalSchemaVersion: "canonical-scenario-1",
    },
};
function provider(output, calls = []) {
    return {
        providerType: "fake",
        providerName: "fake",
        model: "fixture-model",
        async completeJson(request) {
            calls.push(request);
            return { rawText: JSON.stringify(output), model: "fixture-model", providerName: "fake", durationMs: 1 };
        },
    };
}
(0, node_test_1.default)("accepts valid, partial, and low-confidence proposals with one provider call", async () => {
    for (const output of [
        { status: "resolved", confidence: "high", requirements: [], branches: [], stepRequirementLinks: [], unresolved: [] },
        { status: "partial", confidence: "medium", requirements: [], branches: [], stepRequirementLinks: [], unresolved: [{ code: "unclear", message: "Needs review" }] },
        { status: "unresolved", confidence: "low", requirements: [], branches: [], stepRequirementLinks: [], unresolved: [{ code: "ambiguous", message: "Insufficient evidence" }] },
    ]) {
        const calls = [];
        const result = await new canonical_semantic_normalizer_1.CanonicalSemanticNormalizer(provider(output, calls)).normalize(scenario);
        strict_1.default.equal(result.status, "accepted");
        strict_1.default.ok(result.proposal);
        strict_1.default.equal(calls.length, 1);
    }
});
(0, node_test_1.default)("rejects invalid provider JSON shape and provider failures without a second call", async () => {
    const invalid = await new canonical_semantic_normalizer_1.CanonicalSemanticNormalizer(provider({ title: "mutated", status: "resolved", confidence: "high", requirements: [], branches: [], stepRequirementLinks: [], unresolved: [] })).normalize(scenario);
    strict_1.default.deepEqual(invalid, { status: "rejected", reason: "schema_validation_failed" });
    const failing = { ...provider({}), async completeJson() { throw new Error("provider down"); } };
    const result = await new canonical_semantic_normalizer_1.CanonicalSemanticNormalizer(failing).normalize(scenario);
    strict_1.default.equal(result.status, "provider_error");
    strict_1.default.equal(result.reason, "provider down");
});
(0, node_test_1.default)("schema rejection currently exposes only the public reason", async () => {
    const invalid = {
        status: "resolved",
        confidence: "high",
        requirements: [{ proposalId: "p1" }],
        branches: [],
        stepRequirementLinks: [],
        unresolved: [],
    };
    const validation = (0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)(invalid, { stepOrders: [1] });
    strict_1.default.equal(validation.valid, false);
    strict_1.default.equal(validation.errors[0].path, "requirements[0].kind");
    strict_1.default.equal(validation.errors[0].expected, "required requirement proposal field");
    strict_1.default.equal(validation.errors[0].receivedType, "undefined");
    const result = await new canonical_semantic_normalizer_1.CanonicalSemanticNormalizer(provider(invalid)).normalize(scenario);
    strict_1.default.deepEqual(result, { status: "rejected", reason: "schema_validation_failed" });
});
(0, node_test_1.default)("summarizes shape safely and logs diagnostics only when debug is enabled", async () => {
    const invalid = { status: "resolved", confidence: "high", requirements: [{ proposalId: "p1", description: "secret action" }], branches: [], stepRequirementLinks: [], unresolved: [] };
    const summary = (0, canonical_semantic_proposal_1.summarizeCanonicalSemanticProposalShape)(invalid);
    strict_1.default.deepEqual(summary.requirementItemKeys, ["description", "proposalId"]);
    strict_1.default.equal("description" in summary, false);
    strict_1.default.equal(JSON.stringify(summary).includes("secret action"), false);
    const logs = [];
    const originalLog = console.log;
    const previous = process.env.DEBUG_CANONICAL_SEMANTIC_SCHEMA;
    try {
        console.log = (...args) => logs.push(args.join(" "));
        delete process.env.DEBUG_CANONICAL_SEMANTIC_SCHEMA;
        await new canonical_semantic_normalizer_1.CanonicalSemanticNormalizer(provider(invalid)).normalize(scenario);
        strict_1.default.equal(logs.length, 0);
        process.env.DEBUG_CANONICAL_SEMANTIC_SCHEMA = "true";
        await new canonical_semantic_normalizer_1.CanonicalSemanticNormalizer(provider(invalid)).normalize(scenario);
    }
    finally {
        console.log = originalLog;
        if (previous === undefined)
            delete process.env.DEBUG_CANONICAL_SEMANTIC_SCHEMA;
        else
            process.env.DEBUG_CANONICAL_SEMANTIC_SCHEMA = previous;
    }
    strict_1.default.equal(logs.some((line) => line.includes("[canonical-semantic:schema-rejected]")), true);
    strict_1.default.equal(logs.some((line) => line.includes("secret action")), false);
});
(0, node_test_1.default)("sends only compact functional context and the dedicated purpose", () => {
    const prompt = (0, canonical_semantic_normalizer_1.buildCanonicalSemanticNormalizationPrompt)(scenario);
    const parsed = JSON.parse(prompt.userContext);
    strict_1.default.deepEqual(Object.keys(parsed).sort(), ["expectedResults", "preconditions", "steps", "title"]);
    strict_1.default.equal(prompt.purpose, "canonical_scenario_semantic_normalization");
    strict_1.default.equal(prompt.system.includes("Return ONLY JSON"), true);
    strict_1.default.equal(prompt.system.includes("inputRequirements"), true);
    strict_1.default.equal(prompt.system.includes("repair-decision.schema.json"), false);
    strict_1.default.equal(prompt.userContext.includes("sourceRef"), false);
    strict_1.default.equal(prompt.userContext.includes("ProjectGenerationConfig"), false);
    strict_1.default.equal(prompt.userContext.includes("executionReadiness"), false);
});
(0, node_test_1.default)("documents the exact canonical semantic proposal contract", () => {
    const prompt = (0, canonical_semantic_normalizer_1.buildCanonicalSemanticNormalizationPrompt)(scenario);
    for (const field of ["proposalId", "kind", "description", "origin", "branchProposalId", "requirementProposalRefs", "stepOrder"]) {
        strict_1.default.equal(prompt.system.includes(field), true, `missing ${field}`);
    }
    strict_1.default.equal(prompt.system.includes("Do not use alternate field names."), true);
    const example = prompt.system.match(/```json\n([\s\S]*?)\n```/)?.[1];
    strict_1.default.equal(typeof example, "string");
    strict_1.default.equal(example?.includes("requirementIndexes"), false);
    strict_1.default.equal(example?.includes("text"), false);
    strict_1.default.equal(example?.includes("sourceSteps"), false);
    strict_1.default.equal(example?.includes("condition"), false);
    strict_1.default.equal(example?.includes("outcome"), false);
    const validation = (0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)(JSON.parse(example ?? "{}"), { stepOrders: [1, 2] });
    strict_1.default.equal(validation.valid, true, JSON.stringify(validation.errors));
});
