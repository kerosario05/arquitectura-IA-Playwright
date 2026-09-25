"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CanonicalSemanticNormalizer = exports.CANONICAL_SEMANTIC_NORMALIZATION_PURPOSE = void 0;
exports.buildCanonicalSemanticNormalizationPrompt = buildCanonicalSemanticNormalizationPrompt;
exports.createCanonicalSemanticNormalizer = createCanonicalSemanticNormalizer;
const ai_provider_factory_1 = require("../ai/ai-provider-factory");
const canonical_semantic_proposal_1 = require("./canonical-semantic-proposal");
exports.CANONICAL_SEMANTIC_NORMALIZATION_PURPOSE = "canonical_scenario_semantic_normalization";
function compactContext(scenario) {
    return {
        title: scenario.title,
        preconditions: scenario.preconditions,
        steps: scenario.steps.map(({ order, action, expected }) => ({ order, action, ...(expected !== undefined ? { expected } : {}) })),
        expectedResults: scenario.expectedResults,
    };
}
function buildCanonicalSemanticNormalizationPrompt(scenario) {
    return {
        purpose: exports.CANONICAL_SEMANTIC_NORMALIZATION_PURPOSE,
        system: [
            "Identify only implicit functional requirements, branches, and links in the supplied canonical scenario.",
            "Do not change title, preconditions, steps, expectedResults, or source identity.",
            "Do not create steps, definitive requirement IDs, inputRequirements, namedProfileRef, locators, route proof, runtime evidence, or execution authority.",
            "Use status resolved, partial, or unresolved and confidence high, medium, or low.",
            "Return ONLY JSON with keys status, confidence, requirements, branches, stepRequirementLinks, unresolved.",
            "Each requirement must use exactly proposalId (a local identity such as r1), kind, description, and origin.",
            "Each origin may contain only stepOrders and sourceFragmentRefs; do not include full source text.",
            "Each branch must use branchProposalId, requirementProposalRefs, and may use conditions or destinationIntent.",
            "Each stepRequirementLinks item must use stepOrder and requirementProposalRefs, referring to local proposalId values.",
            "Do not use alternate field names.",
            "Do not use text, sourceSteps, condition, outcome, or requirementIndexes as alternate contract fields.",
            "Example of the complete valid shape:",
            "```json",
            JSON.stringify({
                status: "resolved",
                confidence: "high",
                requirements: [
                    { proposalId: "r1", kind: "action", description: "requirement one", origin: { stepOrders: [1] } },
                    { proposalId: "r2", kind: "state", description: "requirement two", origin: { stepOrders: [2] }, branchProposalId: "b1" },
                ],
                branches: [
                    { branchProposalId: "b1", requirementProposalRefs: ["r1", "r2"] },
                ],
                stepRequirementLinks: [
                    { stepOrder: 1, requirementProposalRefs: ["r1"] },
                    { stepOrder: 2, requirementProposalRefs: ["r2"] },
                ],
                unresolved: [],
            }, null, 2),
            "```",
        ].join("\n"),
        userContext: JSON.stringify(compactContext(scenario)),
    };
}
class CanonicalSemanticNormalizer {
    provider;
    constructor(provider) {
        this.provider = provider;
    }
    async normalize(scenario) {
        const prompt = buildCanonicalSemanticNormalizationPrompt(scenario);
        const request = {
            messages: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.userContext },
            ],
            purpose: prompt.purpose,
            requireJson: true,
            requireJsonSchema: true,
        };
        let response;
        try {
            response = await this.provider.completeJson(request);
        }
        catch (error) {
            return { status: "provider_error", reason: error instanceof Error ? error.message : String(error) };
        }
        let parsed = response.parsedJson;
        if (!parsed) {
            try {
                parsed = JSON.parse(response.rawText);
            }
            catch {
                return { status: "rejected", reason: "schema_validation_failed" };
            }
        }
        const validation = (0, canonical_semantic_proposal_1.validateCanonicalSemanticNormalizationProposal)(parsed, {
            stepOrders: scenario.steps.map((step) => step.order),
        });
        if (!validation.valid) {
            if (process.env.DEBUG_CANONICAL_SEMANTIC_SCHEMA?.toLowerCase() === "true") {
                const summary = (0, canonical_semantic_proposal_1.summarizeCanonicalSemanticProposalShape)(parsed);
                const firstError = validation.errors[0];
                console.log("[canonical-semantic:schema-rejected]", Object.entries(summary).map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value ?? "undefined"}`).join(" "), `firstErrorPath=${firstError?.path ?? "undefined"}`, `firstErrorCode=${firstError?.code ?? "undefined"}`, `expected=${firstError?.expected ?? "undefined"}`, `receivedType=${firstError?.receivedType ?? "undefined"}`, `receivedKeys=${firstError?.receivedKeys?.join(",") ?? "undefined"}`);
            }
            return { status: "rejected", reason: "schema_validation_failed" };
        }
        return { status: "accepted", proposal: parsed };
    }
}
exports.CanonicalSemanticNormalizer = CanonicalSemanticNormalizer;
async function createCanonicalSemanticNormalizer() {
    return new CanonicalSemanticNormalizer(await (0, ai_provider_factory_1.createCanonicalSemanticAiProvider)());
}
