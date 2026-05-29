import "dotenv/config";
import { createAiProviderFromEnv, readAiProviderConfigFromEnv } from "../src/ai/ai-provider-factory";
import { CodexCliProvider } from "../src/ai/providers/codex-cli-provider";
import { OpenAICompatibleProvider } from "../src/ai/openai-compatible-provider";
import { resolveCodexCliPath } from "../src/agent/codex-cli-resolver";

async function main(): Promise<void> {
  const config = readAiProviderConfigFromEnv();
  if (!config) {
    console.error("AI provider disabled. Set AI_ENABLED=true and provider env vars.");
    process.exitCode = 1;
    return;
  }

  // For connectivity test, enable stdout JSON fallback regardless of env config.
  // This allows test-ai-provider.ts to validate connectivity even when Codex
  // responds via stdout instead of writing repair-decision.json.
  // AI Repair / discovery use the factory-created provider without this fallback.
  if (config.provider === "codex_cli") {
    config.allowStdoutJsonFallback = true;
  }

  let provider: ReturnType<typeof createAiProviderFromEnv> extends Promise<infer T> ? T : never;

  if (config.provider === "openai_compatible") {
    provider = new OpenAICompatibleProvider(config) as any;
  } else if (config.provider === "codex_cli") {
    if (!config.command) {
      config.command = await resolveCodexCliPath({}).then(r => r.found ? r.command : "codex");
    }
    provider = new CodexCliProvider(config) as any;
  } else {
    console.error(`Unsupported provider: ${config.provider}`);
    process.exitCode = 1;
    return;
  }

  const response = await provider.completeJson({
    messages: [
      {
        role: "system",
        content: "You are a repair decision system. Analyze the request and return a valid RepairDecision JSON."
      },
      {
        role: "user",
        content: "Connection test: determine if the AI provider is working. If there is no safe action to take, respond with decision no_safe_action and reason 'connection test'."
      }
    ],
    temperature: 0,
    requireJson: true
  });

  if (response.diagnostics?.warning) {
    console.warn(`WARNING: ${response.diagnostics.warning}`);
    if (response.diagnostics.exitCode !== undefined) {
      console.warn(`  exitCode: ${response.diagnostics.exitCode}`);
    }
    if (response.diagnostics.stderr) {
      console.warn(`  stderr: ${response.diagnostics.stderr.slice(0, 200)}`);
    }
  }

  const parsed = response.parsedJson;
  const isValidRepairDecision = parsed && typeof parsed.decision === "string" && typeof parsed.reason === "string";

  console.log(JSON.stringify({
    provider: provider.providerName,
    model: provider.model,
    durationMs: response.durationMs,
    validRepairDecision: isValidRepairDecision,
    decision: parsed?.decision ?? null,
    reason: parsed?.reason ?? null,
    parsedJson: parsed ?? null,
    diagnostics: response.diagnostics ?? null
  }, null, 2));

  if (!isValidRepairDecision) {
    console.error("ERROR: Response is not a valid RepairDecision (missing decision or reason fields).");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
