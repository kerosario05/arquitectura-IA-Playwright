import "dotenv/config";
import { createAiProviderFromEnv } from "../src/ai/ai-provider-factory";

async function main(): Promise<void> {
  const provider = createAiProviderFromEnv();
  if (!provider) {
    console.error("AI provider disabled. Set AI_ENABLED=true and provider env vars.");
    process.exitCode = 1;
    return;
  }

  const response = await provider.completeJson({
    messages: [
      { role: "system", content: "Return JSON only." },
      { role: "user", content: "Respond with {\"decision\":\"no_safe_action\",\"reason\":\"connection test\"}" }
    ],
    temperature: 0,
    requireJson: true
  });

  console.log(JSON.stringify({
    provider: provider.providerName,
    model: provider.model,
    durationMs: response.durationMs,
    parsedJson: response.parsedJson ?? null,
    rawText: response.rawText
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
