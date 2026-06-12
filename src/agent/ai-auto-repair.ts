/**
 * AI Auto-Repair Runner (Provider-Agnostic)
 *
 * Uses AI provider factory to support multiple providers (Copilot, Codex, etc.)
 * while maintaining the same interface as runCodexAutoRepair.
 */

import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRepairAiProvider } from "../ai/ai-provider-factory";
import { AiProviderError } from "../ai/ai-provider.types";
import type { CodexAutoRepairInput, CodexAutoRepairResult, TopCandidateRecommendation, RouteRecoveryPack } from "../types/codex-auto-repair.types";
import type { RouteRecoveryDecision } from "../types/route-recovery-decision.types";
import { validateRouteRecoveryDecision } from "./route-recovery-decision-validator";
import { validateAgentHandoffResponse } from "./agent-response-validator";
import { buildCodexPrompt } from "./codex-auto-repair";
import { routeRecoveryDecisionJsonSchema } from "../schemas/route-recovery-decision.schema";

// Re-export legacy functions that are still used
export { buildCodexPrompt, buildDeterministicRouteDecision } from "./codex-auto-repair";

function resolveDecisionPaths(input: CodexAutoRepairInput): {
  decisionPath: string;
  decisionSchemaPath: string;
} {
  const absDir = path.resolve(input.handoffDir);
  return {
    decisionPath: input.routeRecoveryDecisionPath
      ? path.resolve(input.routeRecoveryDecisionPath)
      : path.join(absDir, "route-recovery-decision.json"),
    decisionSchemaPath: input.routeRecoveryDecisionSchemaPath
      ? path.resolve(input.routeRecoveryDecisionSchemaPath)
      : path.join(absDir, "route-recovery-decision.schema.json")
  };
}

async function readPackContent(packPath?: string): Promise<{ content?: string; pack?: RouteRecoveryPack }> {
  if (!packPath) return {};
  try {
    const content = await readFile(packPath, "utf-8");
    const pack = JSON.parse(content) as RouteRecoveryPack;
    return { content, pack };
  } catch {
    return {};
  }
}

function buildTopCandidateRecommendation(packPath?: string, packContent?: string): TopCandidateRecommendation | undefined {
  if (!packPath || !packContent) return undefined;
  try {
    const pack = JSON.parse(packContent);
    const candidates = pack.topVisibleCandidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined;

    const best = candidates.reduce((best: unknown, c: Record<string, unknown>) => {
      const score = Number(c.score ?? 0);
      const rel = String(c.semanticRelation ?? "");
      const actionable = String(c.actionability ?? "");
      const isQualified = score >= 0.5 && !["unrelated", "static"].includes(rel) && actionable !== "static";
      const current = best as Record<string, unknown> | null;
      if (!current) return isQualified ? c : null;
      if (!isQualified) return current;
      return (score > Number((current as Record<string, unknown>).score ?? 0)) ? c : current;
    }, null) as Record<string, unknown> | null;

    if (!best) return undefined;
    return {
      candidateId: String(best.id ?? ""),
      text: String(best.text ?? ""),
      relation: String(best.semanticRelation ?? ""),
      score: Number(best.score ?? 0),
      actionability: String(best.actionability ?? "")
    };
  } catch {
    return undefined;
  }
}

/**
 * Run AI auto-repair using the provider factory.
 * Supports multiple providers (Copilot, Codex, etc.) via AI_REPAIR_* config.
 */
export async function runAiAutoRepair(input: CodexAutoRepairInput): Promise<CodexAutoRepairResult> {
  const startedAt = Date.now();
  const isCompactRecovery = input.promptMode === "compact-route-recovery";

  // Resolve decision paths for compact-route-recovery
  const { decisionPath, decisionSchemaPath } = isCompactRecovery
    ? resolveDecisionPaths(input)
    : { decisionPath: input.responsePath, decisionSchemaPath: "" };

  // Write decision schema file for compact-route-recovery
  if (isCompactRecovery) {
    await mkdir(path.dirname(decisionSchemaPath), { recursive: true });
    await writeFile(decisionSchemaPath, JSON.stringify(routeRecoveryDecisionJsonSchema, null, 2), "utf-8");
  }

  // Build prompt (reuse existing logic)
  const promptText = buildCodexPrompt(input);

  // Create AI provider via factory
  const provider = await createRepairAiProvider();
  console.log(`[ai-repair] purpose=repair provider=${provider.providerType} model=${provider.model}`);

  // Convert prompt to messages format
  const systemMessage = `You are an AI repair agent for Playwright test automation.
Your task is to analyze test failures and propose fixes by selecting appropriate UI candidates or actions.
Follow the instructions provided and output valid JSON.`;

  const messages = [
    { role: "system" as const, content: systemMessage },
    { role: "user" as const, content: promptText }
  ];

  // Pre-read pack content for diagnostics and fallback
  const { pack } = await readPackContent(input.routeRecoveryPackPath);
  const topCandidateRecommendation = buildTopCandidateRecommendation(
    input.routeRecoveryPackPath,
    pack ? JSON.stringify(pack) : undefined
  );

  const baseDiagnostics: Record<string, unknown> = {
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
    await writeFile(decisionPath, outputContent, "utf-8");

    // Validate response
    if (isCompactRecovery && response.parsedJson) {
      const validationResult = validateRouteRecoveryDecision(response.parsedJson as RouteRecoveryDecision, pack);

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
          } as CodexAutoRepairResult["diagnostics"]
        };
      } else {
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
          } as CodexAutoRepairResult["diagnostics"],
          error: `AI repair validation failed: ${errorMessages}`
        };
      }
    }

    // Standard handoff response validation
    if (response.parsedJson) {
      const validationResult = validateAgentHandoffResponse(response.parsedJson);

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
          } as CodexAutoRepairResult["diagnostics"]
        };
      } else {
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
          } as CodexAutoRepairResult["diagnostics"],
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
      } as CodexAutoRepairResult["diagnostics"],
      error: "AI provider returned invalid JSON"
    };

  } catch (error) {
    const durationMs = Date.now() - startedAt;
    baseDiagnostics.durationMs = durationMs;

    if (error instanceof AiProviderError) {
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
          } as CodexAutoRepairResult["diagnostics"],
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
        } as CodexAutoRepairResult["diagnostics"],
        error: `AI provider error: ${error.message}`
      };
    }

    console.error(`[ai-repair] unexpected error:`, error);
    throw error;
  }
}
