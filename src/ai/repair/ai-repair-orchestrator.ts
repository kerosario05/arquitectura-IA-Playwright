import { createRepairAiProvider, type AiProvider } from "../ai-provider-factory";
import { AiProviderError } from "../ai-provider.types";
import { buildRepairContextPack, type RepairContextPack, type RepairEvidence } from "./repair-context-pack";
import { validateRepairDecision, type RepairCandidateForValidation, type RepairEvidenceForValidation } from "./repair-decision-validator";
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
  // Route recovery fields
  failureType?: "target_not_found" | "route_not_found" | "navigation_dead_end" | "wrong_screen" | "assertion_not_satisfied" | "ambiguous_selection" | "missing_intermediate_step";
  targetRoute?: string;
  currentScreen?: {
    url: string;
    title: string;
    visibleHeadings?: string[];
    visibleNavItems?: string[];
    visibleActions?: string[];
    visibleTextSummary?: string[];
    visibleDialogs?: string[];
    visibleForms?: string[];
    visibleLists?: string[];
  };
  routeHistory?: {
    failedRoutePaths?: string[];
    visitedUrls?: string[];
  };
  // Assertion resolution fields
  assertionTarget?: string;
  assertionText?: string;
  evidenceCandidates?: RepairEvidence[];
  // Selection resolution fields
  selectionTarget?: string;
  selectionIntent?: string;
  selectionCandidates?: RepairCandidateForValidation[];
  // Provider injection for testing (optional)
  provider?: AiProvider;
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

  // Resolve effective provider/model for logging (AI_REPAIR_* takes priority over general vars)
  const effectiveProvider = process.env.AI_REPAIR_PROVIDER?.trim() || process.env.AI_PROVIDER?.trim() || "unknown";
  const effectiveModel = process.env.AI_REPAIR_MODEL?.trim() || process.env.AI_MODEL?.trim() || "unknown";
  console.log(`[ai-repair] enabled provider=${effectiveProvider} model=${effectiveModel}`);

  // Use injected provider if present (for tests), otherwise create from repair-specific config
  let provider: AiProvider;
  if (input.provider) {
    provider = input.provider;
  } else {
    try {
      provider = await createRepairAiProvider();
    } catch (err) {
      const code = err instanceof AiProviderError ? err.code : "ai_provider_config_missing";
      const message = err instanceof Error ? err.message : String(err);
      console.log(`[ai-repair] provider_error code=${code} message=${message}`);
      return {
        status: "provider_error",
        diagnostics: { code, message, invocationsConsumed: 0 }
      };
    }
  }

  const maxChars = Number(process.env.AI_REPAIR_MAX_CONTEXT_CHARS ?? "30000");
  const pack: RepairContextPack = buildRepairContextPack({
    ...input,
    maxChars: Number.isFinite(maxChars) && maxChars > 0 ? maxChars : 30000
  });

  const prompt = [
    "CRITICAL: Return ONLY valid JSON. No explanations, no markdown, no text outside the JSON.",
    "Context pack:",
    JSON.stringify(pack),
    "",
    "Respond with JSON object containing: decision, reason, and optional fields per schema."
  ].join("\n");
  const systemPrompt = buildRepairSystemPrompt();

  try {
    console.log(`[ai-repair] invocation started purpose=repair provider=${provider.providerName} model=${provider.model}`);
    const invocationStart = Date.now();
    const completion = await provider.completeJson({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      purpose: "repair",
      temperature: 0,
      requireJson: true,
      requireJsonSchema: bool("AI_REQUIRE_JSON_SCHEMA", true)
    });

    const invocationDurationMs = Date.now() - invocationStart;
    const exitCode = completion.diagnostics?.exitCode ?? "unknown";
    const reportedTokens = completion.usage?.totalPhysicalTokens ?? "unknown";
    console.log(`[ai-repair] completed purpose=repair provider=${provider.providerName} model=${provider.model} durationMs=${invocationDurationMs} exitCode=${exitCode} tokens=${reportedTokens}`);

    const validation = validateRepairDecision(completion.parsedJson ?? completion.rawText, {
      candidates: input.candidates,
      evidenceCandidates: input.evidenceCandidates,
      selectionCandidates: input.selectionCandidates,
      blockSensitiveActions: bool("AI_REPAIR_BLOCK_SENSITIVE_ACTIONS", true),
      blockAuthSecrets: bool("AI_REPAIR_BLOCK_AUTH_SECRETS", true),
      blockPayments: bool("AI_REPAIR_BLOCK_PAYMENTS", true),
      blockTransfers: bool("AI_REPAIR_BLOCK_TRANSFERS", true),
      mustUseVisibleCandidate: bool("AI_REPAIR_MUST_USE_VISIBLE_CANDIDATE", true),
      mustReturnExistingCandidateId: bool("AI_REPAIR_MUST_RETURN_EXISTING_CANDIDATE_ID", true),
      failedRoutePaths: input.routeHistory?.failedRoutePaths
    });

    if (!validation.valid) {
      console.log(`[ai-repair] validation failed: code=${validation.code} message=${validation.message}`);
      console.log(`[ai-repair] raw response: ${JSON.stringify(completion.parsedJson).substring(0, 500)}`);
      return {
        status: "invalid_response",
        diagnostics: {
          errorCode: validation.code,
          errorMessage: validation.message,
          provider: provider.providerName,
          failureType: input.failureType ?? "target_not_found",
          repairType: (completion.parsedJson as any)?.repairType,
          scope: input.failureType ?? "target_not_found"
        }
      };
    }

    if (validation.decision.decision === "repaired_plan") {
      return {
        status: "repaired_plan",
        decision: validation.decision,
        diagnostics: {
          provider: provider.providerName,
          failureType: input.failureType ?? "target_not_found",
          repairType: validation.decision.repairType,
          scope: input.failureType ?? "target_not_found",
          selectedEvidenceId: validation.decision.evidenceId ?? null,
          evidenceType: validation.decision.evidenceId
            ? input.evidenceCandidates?.find((e) => e.evidenceId === validation.decision!.evidenceId)?.type ?? null
            : null,
          assertionStatus: validation.decision.assertionStatus ?? null,
          selectedCandidateId: validation.decision.candidateId ?? null,
          selectionStatus: validation.decision.selectionStatus ?? null,
          candidateCount: input.selectionCandidates?.length ?? input.candidates.length
        }
      };
    }
    if (validation.decision.decision === "needs_more_context") {
      return {
        status: "needs_more_context",
        decision: validation.decision,
        diagnostics: {
          provider: provider.providerName,
          failureType: input.failureType ?? "target_not_found",
          repairType: validation.decision.repairType,
          scope: input.failureType ?? "target_not_found"
        }
      };
    }
    return {
      status: "no_safe_action",
      decision: validation.decision,
      diagnostics: {
        provider: provider.providerName,
        failureType: input.failureType ?? "target_not_found",
        repairType: validation.decision.repairType,
        scope: input.failureType ?? "target_not_found"
      }
    };
  } catch (error) {
    if (error instanceof AiProviderError) {
      console.log(`[ai-repair] provider_error code=${error.code} message=${error.message}`);
      return {
        status: "provider_error",
        diagnostics: {
          code: error.code,
          message: error.message,
          details: error.diagnostics,
          invocationsConsumed: 1
        }
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[ai-repair] provider_error code=ai_provider_http_error message=${message}`);
    return {
      status: "provider_error",
      diagnostics: {
        code: "ai_provider_http_error",
        message,
        invocationsConsumed: 1
      }
    };
  }
}
