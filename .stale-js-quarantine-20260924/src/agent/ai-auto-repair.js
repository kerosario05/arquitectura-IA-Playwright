"use strict";
/**
 * AI Auto-Repair Runner (Provider-Agnostic)
 *
 * Uses AI provider factory to support multiple providers (Copilot, Codex, etc.)
 * while maintaining the same interface as runCodexAutoRepair.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDeterministicRouteDecision = exports.buildCodexPrompt = void 0;
exports.runAiAutoRepair = runAiAutoRepair;
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = require("node:fs/promises");
const ai_provider_factory_1 = require("../ai/ai-provider-factory");
const ai_provider_types_1 = require("../ai/ai-provider.types");
const route_recovery_decision_validator_1 = require("./route-recovery-decision-validator");
const agent_response_validator_1 = require("./agent-response-validator");
const codex_auto_repair_1 = require("./codex-auto-repair");
const route_recovery_decision_schema_1 = require("../schemas/route-recovery-decision.schema");
// Re-export legacy functions that are still used
var codex_auto_repair_2 = require("./codex-auto-repair");
Object.defineProperty(exports, "buildCodexPrompt", { enumerable: true, get: function () { return codex_auto_repair_2.buildCodexPrompt; } });
Object.defineProperty(exports, "buildDeterministicRouteDecision", { enumerable: true, get: function () { return codex_auto_repair_2.buildDeterministicRouteDecision; } });
function resolveDecisionPaths(input) {
    const absDir = node_path_1.default.resolve(input.handoffDir);
    return {
        decisionPath: input.routeRecoveryDecisionPath
            ? node_path_1.default.resolve(input.routeRecoveryDecisionPath)
            : node_path_1.default.join(absDir, "route-recovery-decision.json"),
        decisionSchemaPath: input.routeRecoveryDecisionSchemaPath
            ? node_path_1.default.resolve(input.routeRecoveryDecisionSchemaPath)
            : node_path_1.default.join(absDir, "route-recovery-decision.schema.json")
    };
}
async function readPackContent(packPath) {
    if (!packPath)
        return {};
    try {
        const content = await (0, promises_1.readFile)(packPath, "utf-8");
        const pack = JSON.parse(content);
        return { content, pack };
    }
    catch {
        return {};
    }
}
function buildTopCandidateRecommendation(packPath, packContent) {
    if (!packPath || !packContent)
        return undefined;
    try {
        const pack = JSON.parse(packContent);
        const candidates = pack.topVisibleCandidates;
        if (!Array.isArray(candidates) || candidates.length === 0)
            return undefined;
        const best = candidates.reduce((best, c) => {
            const score = Number(c.score ?? 0);
            const rel = String(c.semanticRelation ?? "");
            const actionable = String(c.actionability ?? "");
            const isQualified = score >= 0.5 && !["unrelated", "static"].includes(rel) && actionable !== "static";
            const current = best;
            if (!current)
                return isQualified ? c : null;
            if (!isQualified)
                return current;
            return (score > Number(current.score ?? 0)) ? c : current;
        }, null);
        if (!best)
            return undefined;
        return {
            candidateId: String(best.id ?? ""),
            text: String(best.text ?? ""),
            relation: String(best.semanticRelation ?? ""),
            score: Number(best.score ?? 0),
            actionability: String(best.actionability ?? "")
        };
    }
    catch {
        return undefined;
    }
}
/**
 * Run AI auto-repair using the provider factory.
 * Supports multiple providers (Copilot, Codex, etc.) via AI_REPAIR_* config.
 */
async function runAiAutoRepair(input) {
    const startedAt = Date.now();
    const isCompactRecovery = input.promptMode === "compact-route-recovery";
    // Resolve decision paths for compact-route-recovery
    const { decisionPath, decisionSchemaPath } = isCompactRecovery
        ? resolveDecisionPaths(input)
        : { decisionPath: input.responsePath, decisionSchemaPath: "" };
    // Write decision schema file for compact-route-recovery
    if (isCompactRecovery) {
        await (0, promises_1.mkdir)(node_path_1.default.dirname(decisionSchemaPath), { recursive: true });
        await (0, promises_1.writeFile)(decisionSchemaPath, JSON.stringify(route_recovery_decision_schema_1.routeRecoveryDecisionJsonSchema, null, 2), "utf-8");
    }
    // Build prompt (reuse existing logic)
    const promptText = (0, codex_auto_repair_1.buildCodexPrompt)(input);
    // Create AI provider via factory
    const provider = await (0, ai_provider_factory_1.createRepairAiProvider)();
    console.log(`[ai-repair] purpose=repair provider=${provider.providerType} model=${provider.model}`);
    // Convert prompt to messages format
    const systemMessage = `You are an AI repair agent for Playwright test automation.
Your task is to analyze test failures and propose fixes by selecting appropriate UI candidates or actions.
Follow the instructions provided and output valid JSON.`;
    const messages = [
        { role: "system", content: systemMessage },
        { role: "user", content: promptText }
    ];
    // Pre-read pack content for diagnostics and fallback
    const { pack } = await readPackContent(input.routeRecoveryPackPath);
    const topCandidateRecommendation = buildTopCandidateRecommendation(input.routeRecoveryPackPath, pack ? JSON.stringify(pack) : undefined);
    const baseDiagnostics = {
        durationMs: 0,
        promptMode: input.promptMode ?? "compact",
        compactPrompt: input.compactPrompt === true || isCompactRecovery,
        preferredResponseSeconds: input.planningBudget?.preferredResponseSeconds,
        promptBudgetSeconds: input.planningBudget?.maxPromptBudgetSeconds,
        routeRecoveryPackPath: input.routeRecoveryPackPath,
        topCandidateRecommendation,
        provider: provider.providerType,
        model: provider.model
    };
    try {
        // Call AI provider
        const response = await provider.completeJson({
            messages,
            requireJson: true,
            requireJsonSchema: false,
            purpose: "repair",
        });
        const durationMs = Date.now() - startedAt;
        baseDiagnostics.durationMs = durationMs;
        console.log(`[ai-repair] completed durationMs=${durationMs} model=${response.model} provider=${response.providerName}`);
        // Write response to decision path
        const outputContent = response.rawText;
        await (0, promises_1.writeFile)(decisionPath, outputContent, "utf-8");
        // Validate response
        if (isCompactRecovery && response.parsedJson) {
            const validationResult = (0, route_recovery_decision_validator_1.validateRouteRecoveryDecision)(response.parsedJson, pack);
            if (validationResult.valid) {
                return {
                    success: true,
                    responsePath: decisionPath,
                    exitCode: 0,
                    diagnostics: {
                        ...baseDiagnostics,
                        agentResponseExists: true,
                        agentResponseValid: true,
                        routeRecoveryDecisionValid: true,
                        nextAction: "use_repaired_plan"
                    }
                };
            }
            else {
                const errorMessages = validationResult.issues.map(issue => issue.message).join(", ");
                return {
                    success: false,
                    responsePath: decisionPath,
                    exitCode: 1,
                    diagnostics: {
                        ...baseDiagnostics,
                        agentResponseExists: true,
                        agentResponseValid: false,
                        routeRecoveryDecisionValid: false,
                        routeRecoveryDecisionErrors: validationResult.issues.map(i => i.message),
                        nextAction: "validation_failed"
                    },
                    error: `AI repair validation failed: ${errorMessages}`
                };
            }
        }
        // Standard handoff response validation
        if (response.parsedJson) {
            const validationResult = (0, agent_response_validator_1.validateAgentHandoffResponse)(response.parsedJson);
            if (validationResult.valid) {
                return {
                    success: true,
                    responsePath: decisionPath,
                    exitCode: 0,
                    diagnostics: {
                        ...baseDiagnostics,
                        agentResponseExists: true,
                        agentResponseValid: true,
                        nextAction: "use_repaired_plan"
                    }
                };
            }
            else {
                const errorMessages = validationResult.issues.map(issue => issue.message).join(", ");
                return {
                    success: false,
                    responsePath: decisionPath,
                    exitCode: 1,
                    diagnostics: {
                        ...baseDiagnostics,
                        agentResponseExists: true,
                        agentResponseValid: false,
                        validationErrors: validationResult.issues.map(i => i.message),
                        nextAction: "validation_failed"
                    },
                    error: `AI repair validation failed: ${errorMessages}`
                };
            }
        }
        // No parsed JSON
        return {
            success: false,
            responsePath: decisionPath,
            exitCode: 1,
            diagnostics: {
                ...baseDiagnostics,
                agentResponseExists: true,
                agentResponseValid: false,
                nextAction: "invalid_json"
            },
            error: "AI provider returned invalid JSON"
        };
    }
    catch (error) {
        const durationMs = Date.now() - startedAt;
        baseDiagnostics.durationMs = durationMs;
        if (error instanceof ai_provider_types_1.AiProviderError) {
            if (error.code === "ai_provider_timeout") {
                console.error(`[ai-repair] timeout after ${durationMs}ms provider=${provider.providerType}`);
                return {
                    success: false,
                    responsePath: input.responsePath,
                    timedOut: true,
                    exitCode: -1,
                    diagnostics: {
                        ...baseDiagnostics,
                        timedOut: true,
                        agentResponseExists: false,
                        agentResponseValid: false,
                        nextAction: "auto_repair_timeout"
                    },
                    error: `AI provider (${provider.providerType}) timed out after ${input.timeoutMs}ms`
                };
            }
            console.error(`[ai-repair] error code=${error.code} message=${error.message}`);
            return {
                success: false,
                responsePath: input.responsePath,
                exitCode: 1,
                diagnostics: {
                    ...baseDiagnostics,
                    agentResponseExists: false,
                    agentResponseValid: false,
                    nextAction: "ai_provider_error"
                },
                error: `AI provider error: ${error.message}`
            };
        }
        console.error(`[ai-repair] unexpected error:`, error);
        throw error;
    }
}
