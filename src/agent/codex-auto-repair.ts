import path from "node:path";
import { runCodexCli, formatCodexCliError, formatCodexTimeoutError } from "./codex-cli-runner";
import type { CodexAutoRepairInput, CodexAutoRepairResult } from "../types/codex-auto-repair.types";
import { normalizeAgentHandoffResponse, validateAgentHandoffResponse } from "./agent-response-validator";
import type { AgentHandoffRequest, AgentHandoffResponse } from "../types/agent-handoff.types";
import { readFile, writeFile } from "node:fs/promises";

export function buildCompactPrompt(input: CodexAutoRepairInput): string {
  const absDir = path.resolve(input.handoffDir);
  const absRequest = path.resolve(input.requestPath);
  const absInstructions = path.resolve(input.instructionsPath);
  const absSchema = path.resolve(input.schemaPath);
  const absResponse = path.resolve(input.responsePath);

  return [
    `You are repairing an ExecutionPlan response for web-ai-automation-runner.`,
    ``,
    `Work only inside this handoff directory:`,
    `${absDir}`,
    ``,
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
    `- Put repaired plans inside the top-level plans array.`,
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

  return [
    `You are a web automation planner agent.`,
    ``,
    `TASK:`,
    `1. Read: ${relRequest}`,
    `2. Read: ${relInstructions}`,
    `3. Read: ${relSchema}`,
    `4. Complete the agent-response.json file at: ${relResponse}`,
    ``,
    `RULES:`,
    `- Do NOT modify files outside the handoff directory.`,
    `- Do NOT generate Playwright code.`,
    `- Write an AgentHandoffResponse object to agent-response.json.`,
    `- Put repaired plans inside the top-level plans array.`,
    `- Do NOT invent sensitive data.`,
    `- If data is missing, mark it as requiredData/missing in the plan.`,
    `- The response must match agent-response.schema.json exactly.`,
    `- Save the final result in: ${relResponse}`,
    ``,
    `IMPORTANT: Write valid JSON to ${relResponse}. Do not output anything else.`
  ].join("\n");
}

function buildCodexPrompt(input: CodexAutoRepairInput): string {
  if (input.promptMode === "verbose") {
    return buildVerbosePrompt(input);
  }
  return buildCompactPrompt(input);
}

export async function runCodexAutoRepair(input: CodexAutoRepairInput): Promise<CodexAutoRepairResult> {
  const prompt = buildCodexPrompt(input);

  const runnerResult = await runCodexCli({
    command: input.codexCommand,
    extraArgs: input.codexExtraArgs,
    prompt,
    cwd: input.projectRoot,
    timeoutMs: input.timeoutMs
  });

  if (runnerResult.timedOut) {
    return {
      success: false,
      responsePath: input.responsePath,
      timedOut: true,
      exitCode: -1,
      error: formatCodexTimeoutError({
        command: input.codexCommand,
        extraArgs: input.codexExtraArgs,
        prompt,
        cwd: input.projectRoot,
        timeoutMs: input.timeoutMs
      }, input.handoffDir, input.responsePath)
    };
  }

  if (runnerResult.exitCode !== 0) {
    const runnerInput = {
      command: input.codexCommand,
      extraArgs: input.codexExtraArgs,
      prompt,
      cwd: input.projectRoot,
      timeoutMs: input.timeoutMs
    };
    return {
      success: false,
      responsePath: input.responsePath,
      exitCode: runnerResult.exitCode,
      error: formatCodexCliError(runnerResult, runnerInput)
    };
  }

  try {
    const responseContent = await readFile(input.responsePath, "utf-8");
    const parsedResponse = JSON.parse(responseContent) as unknown;
    const normalizedResponse = normalizeAgentHandoffResponse(parsedResponse);
    const response = normalizedResponse as AgentHandoffResponse;

    if (normalizedResponse !== parsedResponse) {
      await writeFile(input.responsePath, JSON.stringify(normalizedResponse, null, 2), "utf-8");
    }

    if (!response.plans || response.plans.length === 0) {
      return {
        success: false,
        responsePath: input.responsePath,
        error: "Agent response contains no plans."
      };
    }

    const requestContent = await readFile(input.requestPath, "utf-8");
    const request = JSON.parse(requestContent) as AgentHandoffRequest;

    const availableKeys = request.dataContextSummary?.availableKeys?.map((k) => (typeof k === "string" ? k : k.key)) ?? [];
    const validation = validateAgentHandoffResponse(response, {
      availableDataKeys: availableKeys
    });
    if (!validation.valid) {
      return {
        success: false,
        responsePath: input.responsePath,
        error: `Agent response validation failed: ${validation.issues.map((i) => i.message).join("; ")}`
      };
    }

    return {
      success: true,
      responsePath: input.responsePath
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      responsePath: input.responsePath,
      error: `Failed to read or parse agent response: ${message}`
    };
  }
}
