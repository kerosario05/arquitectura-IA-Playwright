import { createAiProviderFromEnv } from "../ai-provider-factory";
import { AiProviderError } from "../ai-provider.types";
import { buildRepairContextPack, type RepairContextPack } from "./repair-context-pack";
import { validateRepairDecision, type RepairCandidateForValidation } from "./repair-decision-validator";
import type { RepairDecision } from "./repair-decision.schema";
import { buildRepairSystemPrompt } from "./repair-system-prompt";

export type AiRepairOrchestratorInput = {
  appSlug: string;
  failure: string;
  currentStep: string;
  currentUrl: string;
  snapshotSummary?: Record<string, unknown>;
  candidates: RepairCandidateForValidation[];
  runtimeEvidenceTrace?: unknown;
  structuralEvidence?: unknown;
  feedbackEvidence?: unknown;
  pendingAssertions?: string[];
  previousActions?: string[];
  previousFills?: string[];
  constraints?: string[];
};

export type AiRepairOrchestratorResult = {
  status: "repaired_plan" | "no_safe_action" | "needs_more_context" | "provider_disabled" | "invalid_response" | "provider_error";
  decision?: RepairDecision;
  diagnostics: Record<string, unknown>;
};

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.trim().toLowerCase() === "true";
}

export async function runAiRepairOrchestrator(input: AiRepairOrchestratorInput): Promise<AiRepairOrchestratorResult> {
  if (!bool("AI_REPAIR_ENABLED", false)) {
    return { status: "provider_disabled", diagnostics: { reason: "AI_REPAIR_ENABLED=false" } };
  }

  const provider = createAiProviderFromEnv();
  if (!provider) {
    return { status: "provider_disabled", diagnostics: { reason: "AI provider is disabled or missing." } };
  }

  const maxChars = Number(process.env.AI_REPAIR_MAX_CONTEXT_CHARS ?? "30000");
  const pack: RepairContextPack = buildRepairContextPack({
    ...input,
    maxChars: Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 30000
  });

  const prompt = [
    "Return ONLY a compact JSON object for repair decision.",
    "Do not propose selectors/xpath/css/testId.",
    "Do not propose browser actions.",
    "If safe candidate exists, return repaired_plan with candidateId.",
    "Otherwise return no_safe_action or needs_more_context.",
    JSON.stringify(pack)
  ].join("\n");
  const systemPrompt = buildRepairSystemPrompt();

  try {
    const completion = await provider.completeJson({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      temperature: 0,
      requireJson: true,
      requireJsonSchema: bool("AI_REQUIRE_JSON_SCHEMA", true)
    });

    const validation = validateRepairDecision(completion.parsedJson ?? completion.rawText, {
      candidates: input.candidates,
      blockSensitiveActions: bool("AI_REPAIR_BLOCK_SENSITIVE_ACTIONS", true),
      blockAuthSecrets: bool("AI_REPAIR_BLOCK_AUTH_SECRETS", true),
      blockPayments: bool("AI_REPAIR_BLOCK_PAYMENTS", true),
      blockTransfers: bool("AI_REPAIR_BLOCK_TRANSFERS", true),
      mustUseVisibleCandidate: bool("AI_REPAIR_MUST_USE_VISIBLE_CANDIDATE", true),
      mustReturnExistingCandidateId: bool("AI_REPAIR_MUST_RETURN_EXISTING_CANDIDATE_ID", true)
    });

    if (!validation.valid) {
      return {
        status: "invalid_response",
        diagnostics: {
          errorCode: validation.code,
          errorMessage: validation.message,
          provider: provider.providerName,
          scope: "target_not_found"
        }
      };
    }

    if (validation.decision.decision === "repaired_plan") {
      return {
        status: "repaired_plan",
        decision: validation.decision,
        diagnostics: { provider: provider.providerName, scope: "target_not_found" }
      };
    }
    if (validation.decision.decision === "needs_more_context") {
      return {
        status: "needs_more_context",
        decision: validation.decision,
        diagnostics: { provider: provider.providerName, scope: "target_not_found" }
      };
    }
    return {
      status: "no_safe_action",
      decision: validation.decision,
      diagnostics: { provider: provider.providerName, scope: "target_not_found" }
    };
  } catch (error) {
    if (error instanceof AiProviderError) {
      return {
        status: "provider_error",
        diagnostics: {
          code: error.code,
          message: error.message,
          details: error.diagnostics
        }
      };
    }
    return {
      status: "provider_error",
      diagnostics: {
        code: "ai_provider_http_error",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
