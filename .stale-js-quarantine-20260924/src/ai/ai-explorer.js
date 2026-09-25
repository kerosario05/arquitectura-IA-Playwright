"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIExplorer = void 0;
exports.validateAiExplorerOutputShape = validateAiExplorerOutputShape;
exports.createNoopAiExplorerProvider = createNoopAiExplorerProvider;
exports.createAIExplorer = createAIExplorer;
function isValidAction(value) {
    return ["click", "fill", "select", "assert", "wait", "stop"].includes(value);
}
function isFiniteConfidence(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function validateAiExplorerOutputShape(output) {
    if (!output || typeof output !== "object")
        return false;
    const candidate = output;
    if (!candidate.action || !isValidAction(candidate.action))
        return false;
    if (typeof candidate.target !== "string")
        return false;
    if (!isFiniteConfidence(candidate.confidence))
        return false;
    if (typeof candidate.reason !== "string")
        return false;
    if (!Array.isArray(candidate.alternatives))
        return false;
    if (typeof candidate.risk !== "string")
        return false;
    if (typeof candidate.requiresHumanApproval !== "boolean")
        return false;
    return candidate.alternatives.every((alternative) => {
        if (!alternative || typeof alternative !== "object")
            return false;
        const item = alternative;
        return isValidAction(item.action)
            && typeof item.target === "string"
            && typeof item.reason === "string"
            && (item.candidateId === undefined || typeof item.candidateId === "string");
    });
}
class AIExplorer {
    provider;
    adapter;
    constructor(provider, adapter) {
        this.provider = provider;
        this.adapter = adapter;
    }
    async propose(input) {
        const output = await this.adapter.propose(input);
        if (output === null) {
            return null;
        }
        if (!validateAiExplorerOutputShape(output)) {
            throw new Error(`AI explorer provider "${this.adapter.name}" returned an invalid JSON contract.`);
        }
        return output;
    }
}
exports.AIExplorer = AIExplorer;
function createNoopAiExplorerProvider(provider = "custom") {
    return {
        name: `${provider}-noop`,
        async propose(_input) {
            return null;
        }
    };
}
function createAIExplorer(options) {
    const provider = options?.provider ?? "custom";
    const adapter = options?.adapter ?? createNoopAiExplorerProvider(provider);
    return new AIExplorer(provider, adapter);
}
