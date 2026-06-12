import path from "node:path";
import { runCodexCli, formatCodexCliError, formatCodexTimeoutError } from "./codex-cli-runner";
import type { CodexAutoRepairInput, CodexAutoRepairResult, TopCandidateRecommendation, RouteRecoveryPack } from "../types/codex-auto-repair.types";
import type { RouteRecoveryDecision } from "../types/route-recovery-decision.types";
import { normalizeAgentHandoffResponse, validateAgentHandoffResponse } from "./agent-response-validator";
import { validateRouteRecoveryDecision } from "./route-recovery-decision-validator";
import type { PlanAction } from "../types/execution-plan.types";
import type { AgentHandoffRequest, AgentHandoffResponse } from "../types/agent-handoff.types";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { routeRecoveryDecisionJsonSchema } from "../schemas/route-recovery-decision.schema";

function buildTopCandidateRecommendation(packPath?: string, packContent?: string): TopCandidateRecommendation | undefined {
  if (!packPath || !packContent) return undefined;
  try {
    const pack = JSON.parse(packContent);
    const candidates = pack.topVisibleCandidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
    // Pick the highest-scored candidate with a good relation
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

export function buildDeterministicRouteDecision(
  topCandidate: TopCandidateRecommendation,
  pack?: RouteRecoveryPack
): { decision: RouteRecoveryDecision; reason: string } | undefined {
  if (!pack) return undefined;

  if (topCandidate.score < 0.70) return undefined;
  const goodRelations = ["exact_match", "near_match", "parent_category", "broader_candidate", "related_action"];
  if (!goodRelations.includes(topCandidate.relation ?? "")) return undefined;
  if (topCandidate.actionability !== "clickable") return undefined;

  const candidateExists = pack.topVisibleCandidates.some((c) => c.id === topCandidate.candidateId);
  if (!candidateExists) return undefined;

  const hasFailedForCandidate = pack.actionHistorySummary.some(
    (a) => (a.target === topCandidate.candidateId || a.target === topCandidate.text) && a.status === "failed"
  );
  if (hasFailedForCandidate) return undefined;

  return {
    decision: {
      recoveryDecision: "repaired_plan",
      selectedCandidateId: topCandidate.candidateId,
      action: "click",
      confidence: topCandidate.score,
      sensitive: false,
      rationale: "Deterministic fallback: selected top visible candidate via semantic recovery."
    },
    reason: `Deterministic fallback: Codex response invalid; using top candidate '${topCandidate.candidateId}' (relation=${topCandidate.relation}, score=${topCandidate.score})`
  };
}

function buildTargetFromCandidate(
  candidateId: string,
  candidate?: { text?: string; role?: string; type?: string }
): { strategy: "role" | "text" | "testId"; value?: string; role?: string; name?: string } {
  if (candidate?.role && candidate?.text) {
    return { strategy: "role", role: candidate.role, name: candidate.text };
  }
  if (candidate?.text) {
    return { strategy: "text", value: candidate.text };
  }
  return { strategy: "testId", value: candidateId };
}

function buildAgentResponseFromRouteDecision(
  decision: RouteRecoveryDecision,
  candidateDetails?: { text?: string; role?: string; type?: string }
): { response: AgentHandoffResponse; errors: string[] } {
  const now = new Date().toISOString();
  const errors: string[] = [];

  switch (decision.recoveryDecision) {
    case "repaired_plan": {
      if (!decision.selectedCandidateId) {
        errors.push("selectedCandidateId is required for repaired_plan.");
      }
      return {
        response: {
          version: "1.0",
          generatedAt: now,
          recoveryDecision: "repaired_plan",
          plans: [
            {
              version: "1.0",
              source: "ai_generated",
              status: "validated",
              scenario: { source: "testrail", title: "Route recovery" },
              requiredData: [],
              steps: [
                {
                  index: 1,
                  action: decision.action as PlanAction,
                  target: buildTargetFromCandidate(decision.selectedCandidateId, candidateDetails)
                }
              ],
              createdAt: now
            }
          ],
          proposedObjects: [],
          unresolvedQuestions: [],
          rationale: [decision.rationale]
        },
        errors
      };
    }
    case "no_safe_action": {
      return {
        response: {
          version: "1.0",
          generatedAt: now,
          recoveryDecision: "no_safe_action",
          plans: [],
          proposedObjects: [],
          unresolvedQuestions: [],
          rationale: [decision.rationale]
        },
        errors
      };
    }
    case "needs_more_context": {
      return {
        response: {
          version: "1.0",
          generatedAt: now,
          recoveryDecision: "needs_more_context",
          plans: [],
          proposedObjects: [],
          unresolvedQuestions: decision.unresolvedQuestions.map((q) => ({ type: "missing_data" as const, message: q })),
          rationale: [decision.rationale]
        },
        errors
      };
    }
  }
}

export function buildCompactPrompt(input: CodexAutoRepairInput): string {
  const absDir = path.resolve(input.handoffDir);
  const absRequest = path.resolve(input.requestPath);
  const absInstructions = path.resolve(input.instructionsPath);
  const absSchema = path.resolve(input.schemaPath);
  const absResponse = path.resolve(input.responsePath);
  const absContext = input.contextPackPath ? path.resolve(input.contextPackPath) : undefined;

  return [
    `You are repairing an ExecutionPlan response for web-ai-automation-runner.`,
    ``,
    `Work only inside this handoff directory:`,
    `${absDir}`,
    ``,
    ...(absContext ? [`Context: read this file first:`, `${absContext}`, ``] : []),
    `Read:`,
    `${absRequest}`,
    `${absInstructions}`,
    `${absSchema}`,
    `${absResponse}`,
    ``,
    `Task:`,
    `Fill ${absResponse} with a valid response matching the schema.`,
    ``,
    `Rules:`,
    `- Modify only agent-response.json.`,
    `- Do not modify files outside the handoff directory.`,
    `- Do not generate Playwright code.`,
    `- The file must contain an AgentHandoffResponse object, not a bare ExecutionPlan.`,
    `- Always set recoveryDecision to repaired_plan, no_safe_action, or needs_more_context.`,
    `- Put repaired ExecutionPlan objects inside the top-level plans array.`,
    `- Do not modify Object Registry.`,
    `- Do not run tests.`,
    `- Do not run Playwright.`,
    `- Do not invent secrets or sensitive data.`,
    `- If data is missing, mark it as requiredData/missing in the ExecutionPlan.`,
    `- Finish immediately after writing agent-response.json.`,
    ``,
    `IMPORTANT: Write valid JSON to ${absResponse}. Do not output anything else.`
  ].join("\n");
}

function buildVerbosePrompt(input: CodexAutoRepairInput): string {
  const relRequest = path.relative(input.projectRoot, input.requestPath);
  const relInstructions = path.relative(input.projectRoot, input.instructionsPath);
  const relSchema = path.relative(input.projectRoot, input.schemaPath);
  const relResponse = path.relative(input.projectRoot, input.responsePath);
  const relContext = input.contextPackPath ? path.relative(input.projectRoot, input.contextPackPath) : undefined;

  return [
    `You are a web automation planner agent.`,
    ``,
    `TASK:`,
    `1. Read: ${relRequest}`,
    `2. Read: ${relInstructions}`,
    `3. Read: ${relSchema}`,
    ...(relContext ? [`4. Read: ${relContext}`, `5. Complete the agent-response.json file at: ${relResponse}`] : [`4. Complete the agent-response.json file at: ${relResponse}`]),
    ``,
    `RULES:`,
    `- Do NOT modify files outside the handoff directory.`,
    `- Do NOT generate Playwright code.`,
    `- Write an AgentHandoffResponse object to agent-response.json.`,
    `- Always include recoveryDecision and keep it consistent with the response body.`,
    `- Put repaired ExecutionPlan objects inside the top-level plans array.`,
    `- Do NOT invent sensitive data.`,
    `- If data is missing, mark it as requiredData/missing in the plan.`,
    `- The response must match agent-response.schema.json exactly.`,
    `- Save the final result in: ${relResponse}`,
    ``,
    `IMPORTANT: Write valid JSON to ${relResponse}. Do not output anything else.`
  ].join("\n");
}

function buildCompactRouteRecoveryPrompt(input: CodexAutoRepairInput): string {
  const absDir = path.resolve(input.handoffDir);
  const packPath = input.routeRecoveryPackPath ? path.resolve(input.routeRecoveryPackPath) : path.join(absDir, "route-recovery-pack.json");
  const decisionSchemaPath = input.routeRecoveryDecisionSchemaPath
    ? path.resolve(input.routeRecoveryDecisionSchemaPath)
    : path.join(absDir, "route-recovery-decision.schema.json");
  const decisionPath = input.routeRecoveryDecisionPath
    ? path.resolve(input.routeRecoveryDecisionPath)
    : path.join(absDir, "route-recovery-decision.json");
  const budget = input.planningBudget;

  const prefSec = budget?.preferredResponseSeconds ?? 30;
  const maxSec = budget?.maxPromptBudgetSeconds ?? 60;
  const maxRationale = budget?.maxRationaleChars ?? 1200;

  return [
    `You are a bounded current-snapshot semantic recovery planner.`,
    ``,
    `Work only in this handoff directory:`,
    `${absDir}`,
    `Do not analyze the repository.`,
    `Do not inspect source files.`,
    `Do not run commands.`,
    `Do not run tests.`,
    `Do not run Playwright.`,
    ``,
    `Read only:`,
    `1. ${decisionSchemaPath} (route-recovery-decision.schema.json)`,
    `2. selected-skill.md (in handoff dir)`,
    `3. ${packPath} (route-recovery-pack.json)`,
    ``,
    `Write only:`,
    `- ${decisionPath} (route-recovery-decision.json)`,
    ``,
    `Do not write agent-response.json.`,
    `Do not write ExecutionPlan.`,
    `Do not write generatedAt.`,
    `Do not write version.`,
    `Do not write createdAt.`,
    `Do not write plans.`,
    `Do not write proposedObjects.`,
    `Do not write an empty object.`,
    `The framework will build the final AgentHandoffResponse.`,
    ``,
    `Goal:`,
    `Given the failed step and semanticGoal, propose a safe next action.`,
    `Propose only the next safe segment, not the entire case.`,
    `Use only IDs present in route-recovery-pack.json.`,
    `First inspect topVisibleCandidates from route-recovery-pack.json.`,
    `Prefer current visible actionable candidates over historical known objects/routes/plans.`,
    `Use knownObjects, knownRoutes and knownPlans only as secondary evidence.`,
    `If the exact failed target is not visible, look for a safe visible parent category, broader menu option, or related action that moves toward semanticGoal.`,
    `You may propose a multi-step route only if every action references existing IDs.`,
    ``,
    `Budget:`,
    `- Prefer finishing within ${prefSec} seconds.`,
    `- Spend at most ${maxSec} seconds analyzing.`,
    `- Keep rationale under ${maxRationale} characters.`,
    `- If no safe route is found quickly, write no_safe_action.`,
    `- If the pack lacks needed information, write needs_more_context.`,
    ``,
    `Decision:`,
    `Choose exactly one decision type and write only the matching JSON object.`,
    `Do not copy placeholders.`,
    `Never leave placeholders in the final JSON.`,
    ``,
    `1. repaired_plan (preferred when a good visible candidate exists):`,
    `{`,
    `  "recoveryDecision": "repaired_plan",`,
    `  "selectedCandidateId": "<id from route-recovery-pack.json>",`,
    `  "action": "click",`,
    `  "confidence": 0.76,`,
    `  "sensitive": false,`,
    `  "rationale": "Short explanation for the selection."`,
    `}`,
    ``,
    `- selectedCandidateId must be from topVisibleCandidates in route-recovery-pack.json`,
    `- action should be click unless the pack clearly supports another action`,
    `- If a clickable parent_category candidate with score >= 0.70 is visible and not sensitive, prefer repaired_plan using that candidateId`,
    ``,
    `2. no_safe_action:`,
    `{`,
    `  "recoveryDecision": "no_safe_action",`,
    `  "rationale": "Explain why no safe visible candidate can be used."`,
    `}`,
    ``,
    `3. needs_more_context:`,
    `{`,
    `  "recoveryDecision": "needs_more_context",`,
    `  "unresolvedQuestions": ["Explain what context is missing."],`,
    `  "rationale": "The route-recovery-pack lacks enough evidence."`,
    `}`,
    ``,
    `Rules:`,
    `- Do not invent selectors, object IDs, route IDs, data, secrets, OTPs, customer values, or product facts.`,
    `- Do not use text-only selectors.`,
    `- Do not guess.`,
    `- Preserve sensitive-action safety.`,
    `- Submit/confirm/pay/send/login/OTP actions require sensitive: true.`,
    `- If you are unsure, choose no_safe_action or needs_more_context.`,
    `- Do not write fields outside the schema for the chosen decision.`,
    ``,
    `IMPORTANT: Write valid JSON to ${decisionPath}. Do not output anything else.`
  ].join("\n");
}

export function buildCodexPrompt(input: CodexAutoRepairInput): string {
  if (input.skillAwarePromptOverride) {
    return input.skillAwarePromptOverride;
  }
  if (input.promptMode === "compact-route-recovery") {
    return buildCompactRouteRecoveryPrompt(input);
  }
  if (input.promptMode === "verbose") {
    return buildVerbosePrompt(input);
  }
  return buildCompactPrompt(input);
}

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

async function tryDeterministicFallback(
  topCandidate: TopCandidateRecommendation,
  pack?: RouteRecoveryPack
): Promise<{ decision: RouteRecoveryDecision; reason: string } | undefined> {
  const result = buildDeterministicRouteDecision(topCandidate, pack);
  if (!result) return undefined;
  return result;
}

function canUseDeterministicFallback(decisionContent: string | undefined, decisionErrors: string[]): boolean {
  if (!decisionContent) {
    return true;
  }

  if (decisionErrors.length === 0) {
    return false;
  }

  const blockingCodes = new Set([
    "INVALID_ACTION",
    "CANDIDATE_NOT_IN_PACK",
    "INVALID_RECOVERY_DECISION"
  ]);

  for (const error of decisionErrors) {
    const code = error.split(":")[0]?.trim();
    if (code && blockingCodes.has(code)) {
      return false;
    }
  }

  return true;
}

export async function runCodexAutoRepair(input: CodexAutoRepairInput): Promise<CodexAutoRepairResult> {
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

  const prompt = buildCodexPrompt(input);

  const runnerResult = await runCodexCli({
    command: input.codexCommand,
    extraArgs: input.codexExtraArgs,
    prompt,
    cwd: input.projectRoot,
    timeoutMs: input.timeoutMs,
    showAgentLog: input.showAgentLog,
    heartbeatMs: input.heartbeatMs,
    handoffDir: input.handoffDir,
    attempt: input.attempt,
    stdoutLogPath: input.stdoutLogPath,
    stderrLogPath: input.stderrLogPath
  });

  // Pre-read pack content for diagnostics and fallback
  const { pack } = await readPackContent(input.routeRecoveryPackPath);
  const topCandidateRecommendation = buildTopCandidateRecommendation(input.routeRecoveryPackPath, pack ? JSON.stringify(pack) : undefined);

  const baseDiagnostics: Record<string, unknown> = {
    exitCode: runnerResult.exitCode,
    timedOut: runnerResult.timedOut,
    durationMs: runnerResult.durationMs,
    stdoutLogPath: runnerResult.stdoutLogPath,
    stderrLogPath: runnerResult.stderrLogPath,
    promptMode: input.promptMode ?? "compact",
    compactPrompt: input.compactPrompt === true || isCompactRecovery,
    preferredResponseSeconds: input.planningBudget?.preferredResponseSeconds,
    promptBudgetSeconds: input.planningBudget?.maxPromptBudgetSeconds,
    routeRecoveryPackPath: input.routeRecoveryPackPath,
    topCandidateRecommendation
  };

  if (runnerResult.timedOut) {
    return {
      success: false,
      responsePath: input.responsePath,
      timedOut: true,
      exitCode: -1,
      diagnostics: {
        ...baseDiagnostics,
        agentResponseExists: false,
        agentResponseValid: false,
        nextAction: "auto_repair_timeout"
      } as CodexAutoRepairResult["diagnostics"],
      error: formatCodexTimeoutError({
        command: input.codexCommand,
        extraArgs: input.codexExtraArgs,
        prompt,
        cwd: input.projectRoot,
        timeoutMs: input.timeoutMs,
        stdoutLogPath: input.stdoutLogPath,
        stderrLogPath: input.stderrLogPath
      }, input.handoffDir, input.responsePath)
    };
  }

  if (runnerResult.exitCode !== 0) {
    const runnerInput = {
      command: input.codexCommand,
      extraArgs: input.codexExtraArgs,
      prompt,
      cwd: input.projectRoot,
      timeoutMs: input.timeoutMs,
      stdoutLogPath: input.stdoutLogPath,
      stderrLogPath: input.stderrLogPath
    };
    return {
      success: false,
      responsePath: input.responsePath,
      exitCode: runnerResult.exitCode,
      diagnostics: {
        ...baseDiagnostics,
        agentResponseExists: false,
        agentResponseValid: false,
        nextAction: "auto_repair_cli_error"
      } as CodexAutoRepairResult["diagnostics"],
      error: formatCodexCliError(runnerResult, runnerInput)
    };
  }

  // --- Compact-route-recovery flow ---
  if (isCompactRecovery) {
    try {
      // Check if Codex wrote the decision file
      let decisionContent: string | undefined;
      try {
        decisionContent = await readFile(decisionPath, "utf-8");
      } catch {
        /* decision file not found */
      }

      let routeDecision: RouteRecoveryDecision | undefined;
      let decisionErrors: string[] = [];
      let finalAgentResponseBuiltBy: "codex_decision" | "deterministic_fallback" = "deterministic_fallback";

      if (decisionContent) {
        // Validate Codex-written decision
        const parsedDecision = JSON.parse(decisionContent) as unknown;
        const validation = validateRouteRecoveryDecision(parsedDecision, pack);
        decisionErrors = validation.issues.map((i) => `${i.code}: ${i.message}`);
        if (validation.valid && validation.decision) {
          routeDecision = validation.decision;
          finalAgentResponseBuiltBy = "codex_decision";
        }
      }

      // If Codex decision is missing or invalid, try deterministic fallback
      if (!routeDecision && topCandidateRecommendation && canUseDeterministicFallback(decisionContent, decisionErrors)) {
        const fallback = await tryDeterministicFallback(topCandidateRecommendation, pack);
        if (fallback) {
          routeDecision = fallback.decision;
          finalAgentResponseBuiltBy = "deterministic_fallback";
        }
      }

      if (!routeDecision) {
        return {
          success: false,
          responsePath: input.responsePath,
          diagnostics: {
            ...baseDiagnostics,
            agentResponseExists: !!decisionContent,
            agentResponseValid: false,
            routeRecoveryDecisionValid: false,
            routeRecoveryDecisionErrors: decisionErrors.length > 0 ? decisionErrors : undefined,
            nextAction: "auto_repair_invalid_response"
          } as CodexAutoRepairResult["diagnostics"],
          error: decisionErrors.length > 0
            ? decisionErrors.join("; ")
            : (decisionContent ? "Route recovery decision validation failed." : "Codex finished but route-recovery-decision.json was not produced.")
        };
      }

      // Look up candidate details for proper locator strategy
      const candidateDetails = routeDecision.recoveryDecision === "repaired_plan" && pack
        ? pack.topVisibleCandidates.find((c) => c.id === routeDecision.selectedCandidateId)
        : undefined;

      // Transform decision to AgentHandoffResponse
      const { response: agentResponse, errors: transformErrors } = buildAgentResponseFromRouteDecision(routeDecision, candidateDetails);

      // Validate the final AgentHandoffResponse
      const finalValidation = validateAgentHandoffResponse(agentResponse, { promptMode: "compact-route-recovery" });
      const finalErrors = [
        ...transformErrors.map((error) => `TRANSFORM_ERROR: ${error}`),
        ...finalValidation.issues.filter((i) => i.level === "error").map((i) => `${i.code}: ${i.message}`)
      ];

      // Write final agent-response.json
      await writeFile(input.responsePath, JSON.stringify(agentResponse, null, 2), "utf-8");

      if (finalErrors.length > 0) {
        return {
          success: false,
          responsePath: input.responsePath,
          diagnostics: {
            ...baseDiagnostics,
            agentResponseExists: true,
            agentResponseValid: false,
            routeRecoveryDecisionValid: finalAgentResponseBuiltBy === "codex_decision",
            routeRecoveryDecisionErrors: decisionErrors.length > 0 ? decisionErrors : undefined,
            finalAgentResponseBuiltBy,
            selectedCandidateId: routeDecision.recoveryDecision === "repaired_plan" ? routeDecision.selectedCandidateId : undefined,
            transformationErrors: transformErrors.length > 0 ? transformErrors : undefined,
            recoveryDecision: agentResponse.recoveryDecision,
            rawRecoveryDecision: agentResponse.recoveryDecision,
            validationErrors: finalErrors,
            nextAction: "auto_repair_invalid_response"
          } as CodexAutoRepairResult["diagnostics"],
          error: `Final agent response validation failed: ${finalErrors.join("; ")}`
        };
      }

      const recoveryDecision = agentResponse.recoveryDecision;
      const isNonPlan = recoveryDecision === "no_safe_action" || recoveryDecision === "needs_more_context";

      return {
        success: true,
        responsePath: input.responsePath,
        diagnostics: {
          ...baseDiagnostics,
          agentResponseExists: true,
          agentResponseValid: finalErrors.length === 0,
          routeRecoveryDecisionValid: finalAgentResponseBuiltBy === "codex_decision",
          routeRecoveryDecisionErrors: decisionErrors.length > 0 ? decisionErrors : undefined,
          finalAgentResponseBuiltBy,
          selectedCandidateId: routeDecision.recoveryDecision === "repaired_plan" ? routeDecision.selectedCandidateId : undefined,
          transformationErrors: transformErrors.length > 0 ? transformErrors : undefined,
          recoveryDecision,
          rawRecoveryDecision: recoveryDecision ?? "",
          nextAction: isNonPlan ? recoveryDecision : "repaired_plan"
        } as CodexAutoRepairResult["diagnostics"]
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        responsePath: input.responsePath,
        diagnostics: {
          ...baseDiagnostics,
          agentResponseExists: true,
          agentResponseValid: false,
          nextAction: "auto_repair_exception"
        } as CodexAutoRepairResult["diagnostics"],
        error: `Failed to process route recovery decision: ${message}`
      };
    }
  }

  // --- Non-compact / legacy flow (unchanged) ---
  try {
    try {
      await (await import("node:fs/promises")).access(input.responsePath);
    } catch {
      return {
        success: false,
        responsePath: input.responsePath,
        diagnostics: {
          ...baseDiagnostics,
          agentResponseExists: false,
          agentResponseValid: false,
          nextAction: "auto_repair_no_response"
        } as CodexAutoRepairResult["diagnostics"],
        error: "Codex finished but agent-response.json was not produced."
      };
    }

    const responseContent = await readFile(input.responsePath, "utf-8");
    const parsedResponse = JSON.parse(responseContent) as unknown;
    const normalizedResponse = normalizeAgentHandoffResponse(parsedResponse);
    const response = normalizedResponse as AgentHandoffResponse;
    const recoveryDecision = response.recoveryDecision;

    if (normalizedResponse !== parsedResponse) {
      await writeFile(input.responsePath, JSON.stringify(normalizedResponse, null, 2), "utf-8");
    }

    const requestContent = await readFile(input.requestPath, "utf-8");
    const request = JSON.parse(requestContent) as AgentHandoffRequest;

    const availableKeys = request.dataContextSummary?.availableKeys?.map((k) => (typeof k === "string" ? k : k.key)) ?? [];
    const validation = validateAgentHandoffResponse(response, {
      availableDataKeys: availableKeys,
      promptMode: input.promptMode
    });

    const generatedAtStr = typeof response.generatedAt === "string" ? response.generatedAt : "";
    const generatedAtValid = generatedAtStr.length > 0 && generatedAtStr !== "";
    const placeholdersDetected = validation.issues
      .filter((i) => i.code === "PLACEHOLDER_NOT_REPLACED")
      .map((i) => i.message.replace("Placeholder '", "").replace("' found in response. Replace with actual value before submitting.", ""));
    const validationErrors = validation.issues.filter((i) => i.level === "error").map((i) => `${i.code}: ${i.message}`);

    const diagnosticsBase = {
      ...baseDiagnostics,
      agentResponseExists: true,
      recoveryDecision,
      rawRecoveryDecision: recoveryDecision ?? "",
      generatedAtPresent: generatedAtStr.length > 0,
      generatedAtValid,
      placeholdersDetected: placeholdersDetected.length > 0 ? placeholdersDetected : undefined,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined
    } satisfies Record<string, unknown>;

    if (!validation.valid) {
      return {
        success: false,
        responsePath: input.responsePath,
        diagnostics: {
          ...diagnosticsBase,
          agentResponseValid: false,
          nextAction: "auto_repair_no_plan"
        } as CodexAutoRepairResult["diagnostics"],
        error: `Agent response validation failed: ${validation.issues.map((i) => i.message).join("; ")}`
      };
    }

    const isNonPlanDecision = recoveryDecision === "no_safe_action" || recoveryDecision === "needs_more_context";
    if (!isNonPlanDecision && (!response.plans || response.plans.length === 0)) {
      return {
        success: false,
        responsePath: input.responsePath,
        diagnostics: {
          ...diagnosticsBase,
          agentResponseValid: false,
          nextAction: "auto_repair_no_plan"
        } as CodexAutoRepairResult["diagnostics"],
        error: "Agent response contains no plans."
      };
    }

    return {
      success: true,
      responsePath: input.responsePath,
      diagnostics: {
        ...diagnosticsBase,
        agentResponseValid: true,
        nextAction: isNonPlanDecision ? recoveryDecision : "retry_execution",
        recoveryDecision: recoveryDecision ?? "repaired_plan"
      } as CodexAutoRepairResult["diagnostics"]
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      responsePath: input.responsePath,
      diagnostics: {
        ...baseDiagnostics,
        agentResponseExists: true,
        agentResponseValid: false,
        nextAction: "auto_repair_exception"
      } as CodexAutoRepairResult["diagnostics"],
      error: `Failed to read or parse agent response: ${message}`
    };
  }
}
